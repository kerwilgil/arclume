import { describe, expect, it } from "vitest";
import { renderDeckHtml, runVisualQa, validateRenderedDeck } from "../../src/index.js";
import { CANONICAL_VIEWPORT } from "../../src/index.js";
import { sparseDeck } from "./helpers/decks.js";

/**
 * `validateRenderedDeck` asserts a binding between an ArclumeDeck and its HTML,
 * so it must require the HTML to be the *canonical* render of that deck — byte
 * for byte. Phase 5's renderer is deterministic; anything else is not "the
 * render of this deck".
 */
describe("Visual QA — hard ArclumeDeck ↔ HTML binding", () => {
  it("1. a deck + its canonical HTML passes and runs QA", async () => {
    const deck = sparseDeck();
    const html = renderDeckHtml(deck).html;
    const run = await validateRenderedDeck(deck, html, { viewports: [CANONICAL_VIEWPORT] });
    expect(run.valid).toBe(true);
    expect(run.browser.name).toBe("chromium");
  }, 60_000);

  it("2. deck A + HTML of deck B (same slide IDs) → visual/html-deck-mismatch", async () => {
    const deckA = sparseDeck();
    const deckB = sparseDeck({ meta: { title: "A completely different title" } });
    const htmlB = renderDeckHtml(deckB).html;
    // both decks carry the same slide ids
    expect(htmlB).toContain('data-slide-id="s-cover"');
    await expect(validateRenderedDeck(deckA, htmlB)).rejects.toMatchObject({
      code: "visual/html-deck-mismatch",
    });
  });

  it("3. deck + HTML with a modified stylesheet → visual/html-deck-mismatch", async () => {
    const deck = sparseDeck();
    const html = renderDeckHtml(deck).html.replace(
      "</style>",
      ".arclume-stage{outline:2px solid red}</style>",
    );
    await expect(validateRenderedDeck(deck, html)).rejects.toMatchObject({
      code: "visual/html-deck-mismatch",
    });
  });

  it("4. deck + HTML with a block's text changed (slide IDs intact) → visual/html-deck-mismatch", async () => {
    const deck = sparseDeck();
    const html = renderDeckHtml(deck).html.replace(
      "That is the whole deck.",
      "That is NOT the whole deck.",
    );
    expect(html).toContain('data-slide-id="s-body"');
    await expect(validateRenderedDeck(deck, html)).rejects.toMatchObject({
      code: "visual/html-deck-mismatch",
    });
  });

  it("5. runVisualQa still QAs a standalone modified document", async () => {
    const deck = sparseDeck();
    const modified = renderDeckHtml(deck).html.replace(
      "</body>",
      "<!-- a standalone annotation --></body>",
    );
    const run = await runVisualQa(modified, {
      viewports: [CANONICAL_VIEWPORT],
      screenshots: false,
    });
    expect(run.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(run.browser.name).toBe("chromium");
  }, 60_000);

  it("the mismatch error explains it is not the canonical render", async () => {
    const deck = sparseDeck();
    const html = `${renderDeckHtml(deck).html}\n<!-- trailing -->`;
    await expect(validateRenderedDeck(deck, html)).rejects.toThrow(/canonical render/i);
  });
});
