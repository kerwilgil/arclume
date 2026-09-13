import { beforeAll, describe, expect, it } from "vitest";
import { DECK_CSP } from "../../src/index.js";
import type { VisualQaRun } from "../../src/index.js";
import { pipelineDeck, richDeck } from "./helpers/decks.js";
import { codesOf, qaCanonical, qaHtmlCanonical } from "./helpers/run.js";

/**
 * Runtime proof in a real browser: zero network requests, zero console errors,
 * zero uncaught page errors, zero dialogs — for both themes.
 */
describe("Visual QA — browser runtime validation", () => {
  let minimal: VisualQaRun;
  let executive: VisualQaRun;
  let allBlocks: VisualQaRun;

  beforeAll(async () => {
    minimal = await qaHtmlCanonical(
      pipelineDeck("planning/wide-knowledge.json", "technical", "minimal").html,
    );
    executive = await qaHtmlCanonical(
      pipelineDeck("planning/wide-knowledge.json", "executive", "executive").html,
    );
    allBlocks = (await qaCanonical(richDeck())).run;
  }, 180_000);

  it("makes no network request (minimal theme)", () => {
    expect(codesOf(minimal)).not.toContain("visual/network-request");
  });

  it("makes no network request (executive theme)", () => {
    expect(codesOf(executive)).not.toContain("visual/network-request");
  });

  it("raises no console error, page error or dialog (either theme)", () => {
    for (const run of [minimal, executive, allBlocks]) {
      expect(codesOf(run)).not.toContain("visual/console-error");
      expect(codesOf(run)).not.toContain("visual/page-error");
      expect(codesOf(run)).not.toContain("visual/unexpected-dialog");
      expect(codesOf(run)).not.toContain("visual/browser-launch");
    }
  });

  it("the even-the-external-image rich fixture still makes no network request", () => {
    // richDeck() carries an <image> block with an https src; Phase 5 replaces it
    // with a placeholder, so nothing is fetched at runtime.
    expect(codesOf(allBlocks)).not.toContain("visual/network-request");
  });

  it("the rendered document carries the strict no-network CSP", () => {
    expect(DECK_CSP).toContain("default-src 'none'");
    expect(DECK_CSP).toContain("connect-src 'none'");
  });
});
