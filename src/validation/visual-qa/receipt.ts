/**
 * The Visual QA receipt + the `visual-qa.json` serializer.
 *
 * Identity rule: the receipt's canonical hash inputs are the HTML, the deck
 * identity, the renderer / Visual QA versions, the browser + platform, the
 * config, the result summary and the screenshot hashes. Never a temp path, a
 * timestamp, a PID or a username.
 */

import { contentHash } from "../../determinism/hash.js";
import { VisualQaError } from "../../errors.js";
import { HTML_RENDERER_VERSION } from "../../renderers/html/index.js";
import { DELIVERY_MANIFEST_VERSION, VISUAL_QA_VERSION } from "../../version.js";
import type { Viewport, VisualQaOptions, VisualQaReceipt, VisualQaResult } from "./types.js";
import { sha256Utf8 } from "./util.js";

/**
 * The serializable `visual-qa.json` body. Every field is explicitly picked so a
 * screenshot buffer (or any other stray property) can never leak into the JSON,
 * even if a caller hands in a `VisualQaRun` or a sloppy fake.
 */
export function visualQaJson(result: VisualQaResult): VisualQaResult {
  return {
    version: result.version,
    valid: result.valid,
    browser: {
      name: result.browser.name,
      version: result.browser.version,
      platform: result.browser.platform,
      deviceScaleFactor: result.browser.deviceScaleFactor,
    },
    input: { htmlSha256: result.input.htmlSha256 },
    viewports: result.viewports.map((v) => ({
      viewport: v.viewport,
      width: v.width,
      height: v.height,
      deviceScaleFactor: v.deviceScaleFactor,
      slideCount: v.slideCount,
      findings: v.findings,
      errors: v.errors,
      warnings: v.warnings,
      info: v.info,
    })),
    findings: result.findings.map((f) => {
      const out: (typeof result.findings)[number] = {
        code: f.code,
        severity: f.severity,
        viewport: f.viewport,
        message: f.message,
      };
      if (f.slideId !== undefined) out.slideId = f.slideId;
      if (f.slideIndex !== undefined && f.slideIndex >= 0) out.slideIndex = f.slideIndex;
      if (f.blockId !== undefined) out.blockId = f.blockId;
      if (f.diagramId !== undefined) out.diagramId = f.diagramId;
      if (f.metrics !== undefined) out.metrics = { ...f.metrics };
      return out;
    }),
    screenshots: result.screenshots.map((s) => ({
      viewport: s.viewport,
      slideId: s.slideId,
      index: s.index,
      kind: s.kind,
      width: s.width,
      height: s.height,
      bytes: s.bytes,
      sha256: s.sha256,
      path: s.path,
    })),
    summary: {
      errors: result.summary.errors,
      warnings: result.summary.warnings,
      info: result.summary.info,
    },
  };
}

/** Deterministic hash of the QA config that affects the result. */
export function visualQaConfigHash(
  viewports: readonly Viewport[],
  options: VisualQaOptions,
): string {
  const canonical = {
    visualQaVersion: VISUAL_QA_VERSION,
    viewports: [...viewports]
      .map((v) => ({
        name: v.name,
        width: v.width,
        height: v.height,
        deviceScaleFactor: v.deviceScaleFactor,
      }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
    captureViewport: options.captureViewport ?? null,
    aspectRatio: options.aspectRatio ?? null,
    contrast: options.contrast !== false,
    screenshots: options.screenshots !== false,
  };
  return contentHash(canonical).slice("sha256:".length);
}

export interface ReceiptInput {
  result: VisualQaResult;
  html: string;
  deckIrVersion: string;
  deckContentHash?: string | undefined;
  configHash: string;
  /** Engine identity, included ONLY when an engine produced final output. */
  engines?: { visual?: { version: string; commit: string } } | undefined;
}

export function buildVisualQaReceipt(input: ReceiptInput): VisualQaReceipt {
  const { result } = input;

  // The receipt must certify the exact HTML that Visual QA opened — never a
  // different document. `result.input.htmlSha256` is computed inside
  // `runVisualQa` from its own input; if the caller passes an `html` that does
  // not hash to it, the receipt would silently bind the wrong document.
  const htmlSha256 = sha256Utf8(input.html);
  if (result.input.htmlSha256 !== htmlSha256) {
    throw new VisualQaError(
      "buildVisualQaReceipt: SHA-256(html) does not match result.input.htmlSha256 — " +
        "the receipt would certify a different HTML than Visual QA validated",
      { code: "visual/receipt-input-mismatch" },
    );
  }

  const slideShots = result.screenshots
    .filter((s) => s.kind === "slide")
    .map((s) => ({ slideId: s.slideId, sha256: s.sha256, bytes: s.bytes }))
    .sort((a, b) => (a.slideId < b.slideId ? -1 : a.slideId > b.slideId ? 1 : 0));

  const receipt: VisualQaReceipt = {
    receiptVersion: DELIVERY_MANIFEST_VERSION,
    deck: {
      irVersion: input.deckIrVersion,
      ...(input.deckContentHash ? { contentHash: input.deckContentHash } : {}),
    },
    renderer: { version: HTML_RENDERER_VERSION },
    visualQa: { version: result.version, configHash: input.configHash },
    browser: {
      name: "chromium",
      version: result.browser.version,
      platform: result.browser.platform,
    },
    inputs: { htmlSha256 },
    ...(input.engines !== undefined ? { engines: input.engines } : {}),
    result: {
      valid: result.valid,
      errors: result.summary.errors,
      warnings: result.summary.warnings,
    },
    screenshots: slideShots,
  };
  return receipt;
}
