import { beforeAll, describe, expect, it } from "vitest";
import { compareScreenshots, renderDeckHtml, runVisualQa } from "../../src/index.js";
import { CANONICAL_VIEWPORT } from "../../src/index.js";
import { sparseDeck } from "./helpers/decks.js";

/**
 * Screenshot comparison utility. Deliberately not a committed-golden system:
 * comparison only holds within the same browser build / platform / config.
 */
describe("Visual QA — screenshot comparison", () => {
  let shotA: Buffer;
  let shotB: Buffer;

  beforeAll(async () => {
    const html = renderDeckHtml(sparseDeck()).html;
    const run1 = await runVisualQa(html, { viewports: [CANONICAL_VIEWPORT] });
    const run2 = await runVisualQa(html, { viewports: [CANONICAL_VIEWPORT] });
    const a = run1.artifacts.find((s) => s.kind === "slide" && s.index === 1);
    const b = run2.artifacts.find((s) => s.kind === "slide" && s.index === 1);
    if (!a || !b) throw new Error("expected cover screenshots from both runs");
    shotA = a.buffer;
    shotB = b.buffer;
  }, 120_000);

  it("a screenshot compared against itself has zero differing pixels", () => {
    const diff = compareScreenshots(shotA, shotA);
    expect(diff.sizeMismatch).toBe(false);
    expect(diff.differentPixels).toBe(0);
    expect(diff.ratio).toBe(0);
    expect(diff.pass).toBe(true);
  });

  it("the same page rendered twice differs by at most a negligible fraction", () => {
    const diff = compareScreenshots(shotA, shotB, { threshold: 0.1 });
    expect(diff.sizeMismatch).toBe(false);
    expect(diff.ratio).toBeLessThan(0.001);
  });

  it("a deliberate style change is detected", () => {
    // repaint the cover with an obvious overlay via a tampered document
    const tampered = renderDeckHtml(sparseDeck()).html.replace(
      "</head>",
      "<style>.arclume-stage{background:#ff00ff !important}</style></head>",
    );
    return runVisualQa(tampered, { viewports: [CANONICAL_VIEWPORT] }).then((run) => {
      const changed = run.artifacts.find((s) => s.kind === "slide" && s.index === 1);
      if (!changed) throw new Error("expected a cover screenshot");
      const diff = compareScreenshots(shotA, changed.buffer, { threshold: 0.1 });
      expect(diff.differentPixels).toBeGreaterThan(0);
      expect(diff.ratio).toBeGreaterThan(0.01);
    });
  });

  it("mismatched dimensions are reported, not thrown", () => {
    // a valid 1x1 PNG vs the real 1280x720 cover
    const onePx = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+P+/HgAFhAJ/wlseKgAAAABJRU5ErkJggg==",
      "base64",
    );
    const diff = compareScreenshots(onePx, shotA);
    expect(diff.sizeMismatch).toBe(true);
    expect(diff.differentPixels).toBe(-1);
    expect(diff.pass).toBe(false);
  });
});
