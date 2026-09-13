/**
 * Deterministic structural checks on the rendered output. This is not Visual QA
 * (that is Phase 6) — it only proves the HTML is well-formed enough to trust:
 * every slide / block / referenced diagram made it into the DOM, the document
 * carries no NUL byte, and the renderer introduced no remote dependency.
 *
 * The network post-check distinguishes **active renderer-authored surface** from
 * **escaped visible deck content**:
 *
 *  - the whole document is scanned only for *live markup* that could reach the
 *    network (`<script src>`, `<link>`, `<iframe>`, a remote / protocol-relative
 *    `src=` / `href=`). Escaped deck text carries `&lt;` / `&quot;`, so it can
 *    never form one of these;
 *  - the single renderer-authored `<script>` body is scanned for networking
 *    APIs (`fetch(`, `XMLHttpRequest`, `new WebSocket`, `sendBeacon`,
 *    `EventSource`, dynamic `import(`);
 *  - the single renderer-authored `<style>` body is scanned for `@import` and a
 *    remote / protocol-relative `url(...)`.
 *
 * A `CodeBlock` (or any other block) that merely *shows* `fetch("/api")` or
 * `@import url("https://…")` as text is valid and must render, not be rejected.
 *
 * Integrity failures throw `RenderError`. Representational limitations that
 * already have a visible fallback are surfaced as warnings by the callers.
 */

import { RenderError } from "../../errors.js";
import { isDiagramBlock } from "../../types/blocks.js";
import type { ArclumeDeck } from "../../types/deck.js";

/**
 * Live markup anywhere in the document that would fetch over the network. Each
 * pattern needs a literal `<tag` or a literal quote right after `=`, so escaped
 * deck content (`&lt;script`, `src=&quot;http…`) can never match.
 */
export const ACTIVE_MARKUP_PATTERNS: ReadonlyArray<{ re: RegExp; what: string }> = [
  { re: /<script[^>]+\bsrc\s*=/i, what: "<script src>" },
  { re: /<link\b/i, what: "<link>" },
  { re: /<iframe\b/i, what: "<iframe>" },
  { re: /<embed\b/i, what: "<embed>" },
  { re: /<object\b/i, what: "<object>" },
  { re: /<base\b/i, what: "<base>" },
  { re: /\bsrc\s*=\s*["']https?:/i, what: 'src="http(s):"' },
  { re: /\bhref\s*=\s*["']https?:/i, what: 'href="http(s):"' },
  { re: /\bsrc\s*=\s*["']\/\//i, what: 'src="//"' },
  { re: /\bhref\s*=\s*["']\/\//i, what: 'href="//"' },
];

/** Networking APIs forbidden inside the renderer-authored `<script>` body. */
export const SCRIPT_NETWORK_PATTERNS: ReadonlyArray<{ re: RegExp; what: string }> = [
  { re: /\bfetch\s*\(/, what: "fetch(" },
  { re: /\bXMLHttpRequest\b/, what: "XMLHttpRequest" },
  { re: /\bnew\s+WebSocket\b/, what: "new WebSocket" },
  { re: /\bnavigator\s*\.\s*sendBeacon\b/, what: "navigator.sendBeacon" },
  { re: /\bnew\s+EventSource\b/, what: "new EventSource" },
  { re: /\bimport\s*\(/, what: "dynamic import()" },
];

/** Remote references forbidden inside the renderer-authored `<style>` body. */
export const STYLE_REMOTE_PATTERNS: ReadonlyArray<{ re: RegExp; what: string }> = [
  { re: /@import\b/i, what: "@import" },
  { re: /\burl\(\s*["']?\s*https?:/i, what: "url(http(s):)" },
  { re: /\burl\(\s*["']?\s*\/\//i, what: "url(//)" },
];

/**
 * The document carries exactly one inline `<script>` (the viewer runtime, no
 * `src`, no `type`). Any `</script>` from deck content is escaped, so the first
 * `<script>…</script>` in the raw HTML is always the renderer's.
 */
export function extractInlineScript(html: string): string {
  const matches = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
  if (matches.length !== 1) {
    throw new RenderError(`expected exactly one inline <script>, found ${matches.length}`, {
      code: "render/script-count",
    });
  }
  return matches[0]?.[1] ?? "";
}

/** The document carries exactly one inline `<style>` (the shared stylesheet). */
export function extractInlineStyle(html: string): string {
  const matches = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)];
  if (matches.length !== 1) {
    throw new RenderError(`expected exactly one inline <style>, found ${matches.length}`, {
      code: "render/style-count",
    });
  }
  return matches[0]?.[1] ?? "";
}

export function assertRenderOutput(deck: ArclumeDeck, html: string): void {
  const fail = (code: string, message: string): never => {
    throw new RenderError(message, { code });
  };

  if (typeof html !== "string" || html.length === 0) {
    fail("render/empty-output", "the renderer produced an empty document");
  }
  if (!html.startsWith("<!doctype html>")) {
    fail("render/malformed-document", "the rendered document does not start with <!doctype html>");
  }
  if (html.indexOf(String.fromCharCode(0)) !== -1) {
    fail("render/nul-byte", "the rendered document contains a NUL byte");
  }

  // 1) live markup, whole document
  for (const { re, what } of ACTIVE_MARKUP_PATTERNS) {
    if (re.test(html)) {
      fail(
        "render/remote-resource-leak",
        `the rendered document contains forbidden network markup (${what})`,
      );
    }
  }

  // 2) the renderer-authored <script> body only
  const script = extractInlineScript(html);
  for (const { re, what } of SCRIPT_NETWORK_PATTERNS) {
    if (re.test(script)) {
      fail(
        "render/remote-resource-leak",
        `the viewer runtime contains a forbidden networking API (${what})`,
      );
    }
  }

  // 3) the renderer-authored <style> body only
  const style = extractInlineStyle(html);
  for (const { re, what } of STYLE_REMOTE_PATTERNS) {
    if (re.test(style)) {
      fail(
        "render/remote-resource-leak",
        `the stylesheet contains a forbidden remote reference (${what})`,
      );
    }
  }

  // 4) everything the deck declared reached the DOM
  for (const slide of deck.slides ?? []) {
    if (!html.includes(`data-slide-id="${slide.id}"`)) {
      fail("render/slide-missing", `slide "${slide.id}" is not present in the rendered output`);
    }
    for (const block of slide.blocks ?? []) {
      if (!html.includes(`data-block-id="${block.id}"`)) {
        fail("render/block-missing", `block "${block.id}" is not present in the rendered output`);
      }
    }
  }

  const known = new Set((deck.diagrams ?? []).map((d) => d.id));
  const referenced = new Set<string>();
  for (const slide of deck.slides ?? []) {
    for (const block of slide.blocks ?? []) {
      if (
        isDiagramBlock(block) &&
        typeof block.diagramRef === "string" &&
        known.has(block.diagramRef)
      ) {
        referenced.add(block.diagramRef);
      }
    }
  }
  for (const id of referenced) {
    if (!html.includes(`data-diagram-id="${id}"`)) {
      fail(
        "render/diagram-missing",
        `diagram "${id}" is referenced by a block but not present in the rendered output`,
      );
    }
  }
}
