/**
 * Phase 8 — PDF export (real Chromium, real pages).
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderDeckPdf, validatePdfExport } from "../../src/export/index.js";
import { renderCanonicalDeckHtml } from "../../src/index.js";
import { richDeck, sparseDeck } from "./helpers/decks.js";

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "arclume-p8-export-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("PDF export (Chromium)", () => {
  it("renders a sparse deck to a 3-page 16:9 PDF", async () => {
    const deck = sparseDeck();
    renderCanonicalDeckHtml({ deck }); // sanity: canonical render works ahead of export
    const out = await renderDeckPdf({ deck });
    const check = await validatePdfExport(out.bytes, deck.slides.length, "16:9");
    expect(check.errors).toEqual([]);
    expect(out.receipt.format).toBe("pdf");
    expect(out.receipt.slideCount).toBe(deck.slides.length);
  });

  it("renders the rich deck (mixed blocks) without losing pages", async () => {
    const deck = richDeck();
    const out = await renderDeckPdf({ deck });
    const check = await validatePdfExport(out.bytes, deck.slides.length, "16:9");
    expect(check.errors).toEqual([]);
    expect(out.receipt.slideCount).toBe(deck.slides.length);
  });

  it("dimensión física exacta: 960 × 540 pt en 16:9", async () => {
    const deck = sparseDeck();
    const out = await renderDeckPdf({ deck });
    const check = await validatePdfExport(out.bytes, deck.slides.length, "16:9");
    expect(check.errors.filter((e) => e.startsWith("export/page-dimensions"))).toEqual([]);
  });

  it("dimensión física exacta: 960 × 600 pt en 16:10", async () => {
    const deck = sparseDeck();
    deck.theme = { ...deck.theme, aspectRatio: "16:10" };
    const out = await renderDeckPdf({ deck });
    const check = await validatePdfExport(out.bytes, deck.slides.length, "16:10");
    expect(check.errors.filter((e) => e.startsWith("export/page-dimensions"))).toEqual([]);
  });

  it("dimensión física exacta: 960 × 720 pt en 4:3", async () => {
    const deck = sparseDeck();
    deck.theme = { ...deck.theme, aspectRatio: "4:3" };
    const out = await renderDeckPdf({ deck });
    const check = await validatePdfExport(out.bytes, deck.slides.length, "4:3");
    expect(check.errors.filter((e) => e.startsWith("export/page-dimensions"))).toEqual([]);
  });
});
