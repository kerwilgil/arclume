import { describe, expect, it } from "vitest";
import { renderDeckHtml, runVisualQa } from "../../src/index.js";
import { CANONICAL_VIEWPORT } from "../../src/index.js";
import { sparseDeck } from "./helpers/decks.js";
import {
  CLIP_SNIPPET,
  CONSOLE_ERROR_SNIPPET,
  DIALOG_SNIPPET,
  NETWORK_SNIPPET,
  OFF_SLIDE_SNIPPET,
  OVERFLOW_Y_SNIPPET,
  PAGE_ERROR_SNIPPET,
  injectBeforeBodyEnd,
  injectIntoHead,
  injectIntoSlide,
} from "./helpers/inject.js";

// sparseDeck slide 1 is a plain `single`-layout content slide (no flex centering)
const BODY = "s-body";

/**
 * Positive detector tests: a deliberate defect is spliced into an otherwise
 * valid, rendered document; Visual QA must produce the matching finding.
 * (The renderer is never re-run over the tampered HTML.)
 */
const base = (): string => renderDeckHtml(sparseDeck()).html;

async function qa(html: string) {
  return runVisualQa(html, { viewports: [CANONICAL_VIEWPORT], screenshots: false });
}
const codes = (run: Awaited<ReturnType<typeof qa>>) => run.findings.map((f) => f.code);

describe("Visual QA — positive detectors", () => {
  it("catches a deliberate vertical slide overflow", async () => {
    const run = await qa(injectIntoSlide(base(), BODY, OVERFLOW_Y_SNIPPET));
    expect(codes(run)).toContain("visual/slide-overflow-y");
    const f = run.findings.find((x) => x.code === "visual/slide-overflow-y");
    expect(f?.severity).toBe("error");
  });

  it("catches clipped text (overflow:hidden + fixed tiny height)", async () => {
    const run = await qa(injectIntoSlide(base(), BODY, CLIP_SNIPPET));
    expect(codes(run)).toContain("visual/text-clipped");
  });

  it("catches an element rendered off the slide", async () => {
    const run = await qa(injectIntoSlide(base(), BODY, OFF_SLIDE_SNIPPET));
    expect(codes(run)).toContain("visual/off-slide");
    const f = run.findings.find((x) => x.code === "visual/off-slide");
    expect(f?.blockId).toBe("b-offscreen");
  });

  it("catches a real network request", async () => {
    const run = await qa(injectBeforeBodyEnd(base(), NETWORK_SNIPPET));
    expect(codes(run)).toContain("visual/network-request");
    const f = run.findings.find((x) => x.code === "visual/network-request");
    expect(f?.severity).toBe("error");
    expect(String(f?.metrics?.["request"])).toContain("http://127.0.0.1:9/");
  });

  it("catches a console.error", async () => {
    const run = await qa(injectBeforeBodyEnd(base(), CONSOLE_ERROR_SNIPPET));
    expect(codes(run)).toContain("visual/console-error");
  });

  it("catches an uncaught page error", async () => {
    const run = await qa(injectIntoHead(base(), PAGE_ERROR_SNIPPET));
    expect(codes(run)).toContain("visual/page-error");
  });

  it("catches (and dismisses) an unexpected dialog", async () => {
    const run = await qa(injectBeforeBodyEnd(base(), DIALOG_SNIPPET));
    expect(codes(run)).toContain("visual/unexpected-dialog");
  });

  it("a clean document produces none of those findings", async () => {
    const run = await qa(base());
    for (const c of [
      "visual/slide-overflow-y",
      "visual/text-clipped",
      "visual/off-slide",
      "visual/network-request",
      "visual/console-error",
      "visual/page-error",
      "visual/unexpected-dialog",
    ]) {
      expect(codes(run)).not.toContain(c);
    }
    expect(run.valid).toBe(true);
  });
});
