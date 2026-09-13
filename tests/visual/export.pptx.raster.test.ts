/**
 * Phase 8 final trust-boundary: the SVG→PNG fallback is REAL. When the writer
 * rejects SVG (forced through the test-only seam), the SAME validated SVG
 * bytes are rasterized offline by Chromium into a PNG that ACTUALLY lands
 * inside the PPTX media/ — and the receipt carries the loud
 * `export/pptx-svg-rasterized` warning.
 */

import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { buildDeckPptx, validatePptxPackage } from "../../src/export/index.js";
import { applyDiagramEnginePreference, resolveDiagramEngines } from "../../src/index.js";
import { richDeck } from "../helpers/decks.js";

describe("PPTX SVG→PNG raster fallback (forced, real Chromium)", () => {
  it("forces SVG rejection → real PNG media inside the package + warning", async () => {
    const deck = applyDiagramEnginePreference(richDeck(), { preference: "auto" });
    const { diagramArtifacts } = await resolveDiagramEngines(deck);
    const { bytes, receipt } = await buildDeckPptx(
      { deck, diagramArtifacts },
      { forceSvgRasterization: true },
    );

    // the package is still a fully valid PPTX
    expect(validatePptxPackage(bytes, deck)).toEqual([]);

    // real PNG media is embedded where SVG would have been
    const parts = unzipSync(new Uint8Array(bytes)) as Record<string, Uint8Array>;
    const media = Object.keys(parts).filter((k) => k.startsWith("ppt/media/"));
    const pngs = media.filter((k) => k.endsWith(".png"));
    const svgs = media.filter((k) => k.endsWith(".svg"));
    expect(svgs).toEqual([]); // no SVG was embedded — the writer "rejected" it
    expect(pngs.length).toBeGreaterThan(0);
    // the PNG is a real raster, not a stub: starts with the PNG magic bytes
    const first = parts[pngs[0] as string] as Uint8Array;
    expect([first[0], first[1], first[2], first[3]]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(first.length).toBeGreaterThan(400);

    // the rasterization is loud, never silent
    expect(receipt.validation.warnings).toContain("export/pptx-svg-rasterized");
  });

  it("without the force flag, diagrams stay vector SVG", async () => {
    const deck = applyDiagramEnginePreference(richDeck(), { preference: "auto" });
    const { diagramArtifacts } = await resolveDiagramEngines(deck);
    const { bytes } = await buildDeckPptx({ deck, diagramArtifacts });
    const parts = unzipSync(new Uint8Array(bytes)) as Record<string, Uint8Array>;
    const media = Object.keys(parts).filter((k) => k.startsWith("ppt/media/"));
    expect(media.some((k) => k.endsWith(".svg"))).toBe(true);
  });

  it("per-diagram actual-SVG probe: one rejected SVG falls back to PNG, others stay SVG", async () => {
    const deck = applyDiagramEnginePreference(richDeck(), { preference: "auto" });
    const { diagramArtifacts } = await resolveDiagramEngines(deck);

    // Every diagram referenced by a slide passes through media resolution.
    const referenced = new Set<string>();
    for (const slide of deck.slides) {
      for (const block of slide.blocks) {
        if ("diagramRef" in block && typeof block.diagramRef === "string") {
          referenced.add(block.diagramRef);
        }
      }
    }
    expect(referenced.size).toBeGreaterThan(1);
    const rejectedId = [...referenced][0] as string;

    const { bytes, receipt } = await buildDeckPptx(
      { deck, diagramArtifacts },
      { rejectSvgForDiagramIds: [rejectedId] },
    );

    // the final package is still a valid PPTX
    expect(validatePptxPackage(bytes, deck)).toEqual([]);

    const parts = unzipSync(new Uint8Array(bytes)) as Record<string, Uint8Array>;
    const media = Object.keys(parts).filter((k) => k.startsWith("ppt/media/"));
    const svgs = media.filter((k) => k.endsWith(".svg"));
    // exactly one diagram lost its SVG media; every accepted one kept it
    expect(svgs.length).toBe(referenced.size - 1);

    // the rasterization is loud, never silent
    expect(receipt.validation.warnings).toContain("export/pptx-svg-rasterized");
  });
});
