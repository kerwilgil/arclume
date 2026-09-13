import { beforeAll, describe, expect, it } from "vitest";
import type { VisualQaRun } from "../../src/index.js";
import {
  LONG_KEY_MESSAGE,
  codeStressDeck,
  cycleArchitectureDeck,
  longKeyMessageDeck,
  pipelineDeck,
  richDeck,
  sparseDeck,
  stepsOnlyProcessDeck,
  tableStressDeck,
} from "./helpers/decks.js";
import { codesOf, errorsOf, qaCanonical, qaHtmlCanonical } from "./helpers/run.js";

/**
 * One Chromium pass per fixture on the canonical desktop viewport.
 *
 * The genuine end-to-end decks (straight from the pipeline) must be clean —
 * zero ERROR findings. The Phase 5 hand-built `richDeck()` deliberately crams
 * every block type onto few slides; Visual QA legitimately flags it as
 * over-dense (a positive test on real renderer output).
 */
describe("Visual QA — deck regressions (canonical desktop)", () => {
  const runs: Record<string, VisualQaRun> = {};

  beforeAll(async () => {
    const rich = pipelineDeck("planning/wide-knowledge.json", "executive", "executive");
    runs["pipelineRich"] = await qaHtmlCanonical(rich.html);
    const sparsePipe = pipelineDeck("planning/sparse-knowledge.json", "general", "minimal");
    runs["pipelineSparse"] = await qaHtmlCanonical(sparsePipe.html);

    runs["allBlocks"] = (await qaCanonical(richDeck())).run;
    runs["sparse"] = (await qaCanonical(sparseDeck())).run;
    runs["cycle"] = (await qaCanonical(cycleArchitectureDeck())).run;
    runs["longKey"] = (await qaCanonical(longKeyMessageDeck())).run;
    runs["table"] = (await qaCanonical(tableStressDeck())).run;
    runs["code"] = (await qaCanonical(codeStressDeck())).run;
    runs["steps"] = (await qaCanonical(stepsOnlyProcessDeck())).run;
  }, 240_000);

  it("a real pipeline deck (executive theme, ~12 slides) has zero errors", () => {
    const run = runs["pipelineRich"] as VisualQaRun;
    expect(errorsOf(run)).toEqual([]);
    expect(run.valid).toBe(true);
  });

  it("a real pipeline deck (minimal theme, sparse knowledge) has zero errors", () => {
    expect(errorsOf(runs["pipelineSparse"] as VisualQaRun)).toEqual([]);
  });

  it("records a real Chromium identity", () => {
    const b = (runs["pipelineRich"] as VisualQaRun).browser;
    expect(b.name).toBe("chromium");
    expect(b.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(b.platform.length).toBeGreaterThan(0);
    expect(b.deviceScaleFactor).toBe(1);
  });

  it("captures one canonical stage screenshot per slide plus a viewer overview", () => {
    const run = runs["pipelineRich"] as VisualQaRun;
    const slideShots = run.screenshots.filter((s) => s.kind === "slide");
    const viewerShots = run.screenshots.filter((s) => s.kind === "viewer");
    expect(slideShots.length).toBe(run.viewports[0]?.slideCount);
    expect(viewerShots.length).toBe(1);
    for (const s of slideShots) {
      expect(s.width).toBe(1280);
      expect(s.height).toBe(720);
      expect(s.bytes).toBeGreaterThan(0);
      expect(s.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(s.path).toMatch(/^screenshots\/slide-\d{3}-[A-Za-z0-9._-]+\.png$/);
    }
    expect(viewerShots[0]?.width).toBe(1440);
    expect(viewerShots[0]?.height).toBe(900);
  });

  it("slide screenshot filenames are stable and 1-based", () => {
    const names = (runs["allBlocks"] as VisualQaRun).screenshots
      .filter((s) => s.kind === "slide")
      .map((s) => s.path);
    expect(names[0]).toBe("screenshots/slide-001-sld-cover.png");
    expect(names.at(-1)).toBe("screenshots/slide-011-sld-close.png");
  });

  it("the all-blocks stress fixture is genuinely over-dense — the detector catches it", () => {
    const run = runs["allBlocks"] as VisualQaRun;
    // real renderer output, real Chromium layout: the crammed slides overflow
    expect(codesOf(run)).toContain("visual/slide-overflow-y");
    // but nothing is missing / zero-size / networking
    expect(codesOf(run)).not.toContain("visual/zero-size-element");
    expect(codesOf(run)).not.toContain("visual/diagram-zero-size");
    expect(codesOf(run)).not.toContain("visual/network-request");
    expect(codesOf(run)).not.toContain("visual/page-error");
    expect(run.screenshots.filter((s) => s.kind === "slide").length).toBe(11);
  });

  it("the sparse hand-built deck passes with no filler and no errors", () => {
    expect(errorsOf(runs["sparse"] as VisualQaRun)).toEqual([]);
    expect(
      (runs["sparse"] as VisualQaRun).screenshots.filter((s) => s.kind === "slide").length,
    ).toBe(3);
  });

  it("architecture cycle A→B→C→A renders in real Chromium with no error", () => {
    const run = runs["cycle"] as VisualQaRun;
    expect(errorsOf(run)).toEqual([]);
    expect(codesOf(run)).not.toContain("visual/diagram-zero-size");
    expect(codesOf(run)).not.toContain("visual/diagram-clipped");
  });

  it("a ~230-char key message renders verbatim, unclipped, no overflow", () => {
    expect(errorsOf(runs["longKey"] as VisualQaRun)).toEqual([]);
    expect(LONG_KEY_MESSAGE.length).toBeGreaterThan(219);
    expect(LONG_KEY_MESSAGE.length).toBeLessThan(241);
  });

  it("table stress scrolls locally (horizontal) but never breaks the slide", () => {
    const run = runs["table"] as VisualQaRun;
    expect(errorsOf(run)).toEqual([]);
    const local = run.findings.filter((f) => f.code === "visual/local-scroll");
    expect(local.length).toBeGreaterThan(0);
    for (const f of local) expect(f.severity).toBe("info");
  });

  it("code stress uses local horizontal scroll, no global slide overflow", () => {
    const run = runs["code"] as VisualQaRun;
    expect(errorsOf(run)).toEqual([]);
    expect(codesOf(run)).not.toContain("visual/slide-overflow-x");
  });

  it("a steps-only process diagram renders with no synthetic arrows and no error", () => {
    expect(errorsOf(runs["steps"] as VisualQaRun)).toEqual([]);
  });
});
