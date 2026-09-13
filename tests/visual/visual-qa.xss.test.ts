import { describe, expect, it } from "vitest";
import { renderDeckHtml, runVisualQa } from "../../src/index.js";
import { CANONICAL_VIEWPORT } from "../../src/index.js";
import { xssDeck } from "./helpers/decks.js";
import { openDeck } from "./helpers/page.js";

/**
 * A deck whose visible strings are XSS payloads must open completely inert in a
 * real browser: no dialog, no page error, no network, no injected executable
 * DOM (`window.__arclume_xss__` is never set).
 */
describe("Visual QA — XSS fixture opens inert", () => {
  it("runs through Visual QA with no dialog / page-error / network finding", async () => {
    const html = renderDeckHtml(xssDeck()).html;
    const run = await runVisualQa(html, { viewports: [CANONICAL_VIEWPORT], screenshots: false });
    const codes = run.findings.map((f) => f.code);
    expect(codes).not.toContain("visual/unexpected-dialog");
    expect(codes).not.toContain("visual/page-error");
    expect(codes).not.toContain("visual/console-error");
    expect(codes).not.toContain("visual/network-request");
  });

  it("no payload executed — the marker global is never set, no <script> from the deck ran", async () => {
    const html = renderDeckHtml(xssDeck()).html;
    const opened = await openDeck(html);
    try {
      const marker = await opened.page.evaluate(
        () => (window as unknown as { __arclume_xss__?: boolean }).__arclume_xss__ ?? false,
      );
      expect(marker).toBe(false);
      // exactly one <script> (the viewer runtime) actually executed
      const scriptCount = await opened.page.evaluate(
        () => document.querySelectorAll("script").length,
      );
      expect(scriptCount).toBe(1);
      // the payload text is present but escaped (as text, not markup)
      const hasEscaped = await opened.page.evaluate(() =>
        document.body.innerHTML.includes("&lt;script&gt;"),
      );
      expect(hasEscaped).toBe(true);
    } finally {
      await opened.close();
    }
  });
});
