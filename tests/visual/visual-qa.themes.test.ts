import { beforeAll, describe, expect, it } from "vitest";
import { compareScreenshots, renderDeckHtml, runVisualQa } from "../../src/index.js";
import { CANONICAL_VIEWPORT } from "../../src/index.js";
import type { VisualQaRun } from "../../src/index.js";
import { richDeckExecutive, richDeckMinimal } from "./helpers/decks.js";
import { errorsOf } from "./helpers/run.js";

/**
 * Both Phase 4 themes run through real Chromium; the same content under the two
 * themes must produce a genuinely different raster (proof there really are two
 * visual representations, not one).
 */
describe("Visual QA — themes", () => {
  let minimal: VisualQaRun;
  let executive: VisualQaRun;

  beforeAll(async () => {
    minimal = await runVisualQa(renderDeckHtml(richDeckMinimal()).html, {
      viewports: [CANONICAL_VIEWPORT],
    });
    executive = await runVisualQa(renderDeckHtml(richDeckExecutive()).html, {
      viewports: [CANONICAL_VIEWPORT],
    });
  }, 120_000);

  it("minimal theme: no runtime/network/diagram/zero-size errors", () => {
    const codes = minimal.findings.map((f) => f.code);
    expect(codes).not.toContain("visual/network-request");
    expect(codes).not.toContain("visual/page-error");
    expect(codes).not.toContain("visual/diagram-zero-size");
    expect(codes).not.toContain("visual/zero-size-element");
  });

  it("executive theme: no runtime/network/diagram/zero-size errors", () => {
    const codes = executive.findings.map((f) => f.code);
    expect(codes).not.toContain("visual/network-request");
    expect(codes).not.toContain("visual/page-error");
    expect(codes).not.toContain("visual/diagram-zero-size");
    expect(codes).not.toContain("visual/zero-size-element");
  });

  it("the cover slide renders visibly differently between the two themes", () => {
    const mCover = minimal.artifacts.find((a) => a.kind === "slide" && a.index === 1);
    const eCover = executive.artifacts.find((a) => a.kind === "slide" && a.index === 1);
    if (!mCover || !eCover) throw new Error("cover screenshots missing");
    const diff = compareScreenshots(mCover.buffer, eCover.buffer, { threshold: 0.1 });
    expect(diff.sizeMismatch).toBe(false);
    expect(diff.differentPixels).toBeGreaterThan(0);
  });

  it("both themes captured a screenshot for every slide", () => {
    expect(minimal.artifacts.filter((a) => a.kind === "slide").length).toBe(11);
    expect(executive.artifacts.filter((a) => a.kind === "slide").length).toBe(11);
  });

  it("neither theme adds contrast-low errors on principal text tokens", () => {
    for (const run of [minimal, executive]) {
      const low = run.findings.filter(
        (f) => f.code === "visual/contrast-low" && f.severity === "error",
      );
      expect(low).toEqual([]);
    }
  });
});
