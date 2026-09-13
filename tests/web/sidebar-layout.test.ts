/**
 * 1.0.1 sidebar clipping fix — structural CSS guard.
 *
 * The 1.0.0 layout gave `.sidebar` `max-height: 100vh` without pinning it,
 * so a long main column (Help scrolled to the bottom) left an empty gap
 * where the sidebar had already ended. The fix pins the rail sticky at the
 * top with a full-viewport height. These tests lock that contract so a
 * future stylesheet refactor cannot silently reintroduce the clipping.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", "web", "src", "styles.css"),
  "utf8",
);

/** Extract the `{ … }` body of a top-level rule whose selector is exactly
 * `selector` (e.g. `.sidebar`, not `.sidebar-utility`). */
function ruleBody(selector: string, scope: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?:^|[}\\s])${escaped}\\s*\\{([^}]*)\\}`, "m");
  const match = scope.match(re);
  expect(match, `rule for ${selector} not found`).not.toBeNull();
  // Comments document the rule but are not declarations — strip them so a
  // prose mention (e.g. "not max-height") never trips a negative assertion.
  return ((match as RegExpMatchArray)[1] ?? "").replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("sidebar layout — 1.0.1 clipping fix", () => {
  it("the desktop sidebar is sticky, pinned to the top, full viewport height", () => {
    const body = ruleBody(".sidebar", css);
    expect(body).toMatch(/position:\s*sticky/);
    expect(body).toMatch(/top:\s*0/);
    expect(body).toMatch(/align-self:\s*start/);
    expect(body).toMatch(/height:\s*100vh/);
    expect(body).toMatch(/height:\s*100dvh/);
    expect(body).toMatch(/overflow-y:\s*auto/);
    // The clipped 1.0.0 rule is gone: no max-height cap on the desktop rail.
    expect(body).not.toMatch(/max-height/);
  });

  it("the app shell still spans at least the viewport height", () => {
    expect(ruleBody(".app", css)).toMatch(/min-height:\s*100vh/);
    expect(ruleBody(".app", css)).toMatch(/grid-template-columns:\s*220px 1fr/);
  });

  it("the narrow (single-column) layout resets the sticky rail to a plain top bar", () => {
    const media = css.match(/@media\s*\(max-width:\s*860px\)\s*\{([\s\S]*)\}\s*$/);
    expect(media, "the 860px media block must exist").not.toBeNull();
    const body = ruleBody(".sidebar", (media as RegExpMatchArray)[1] ?? "");
    expect(body).toMatch(/position:\s*static/);
    expect(body).toMatch(/height:\s*auto/);
    expect(body).toMatch(/overflow-y:\s*visible/);
  });
});
