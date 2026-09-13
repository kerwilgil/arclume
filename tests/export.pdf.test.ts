/**
 * Phase 8 — PDF export unit tests (profiles, receipts, structural checks).
 * Real Chromium rendering lives in tests/visual/export.pdf.visual.test.ts.
 */

import { describe, expect, it } from "vitest";
import { ASPECT_BROWSER_PX, buildPdfPrintProfile, validatePdfExport } from "../src/export/index.js";
import { buildMarkedContentOnlyPdf, buildTextPdf } from "./helpers/fixture-builders.js";

describe("PDF print profile", () => {
  it("provides the exporters' physical mapping", () => {
    const p = buildPdfPrintProfile("16:9");
    expect(p.widthPx).toBe(1280);
    expect(p.heightPx).toBe(720);
    expect(p.version).toBe("0.1.0");
    expect(p.cssSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(p.css).toContain("@page");
    expect(p.css).toContain("page-break-after");

    const p1610 = buildPdfPrintProfile("16:10");
    expect(p1610.heightPx).toBe(800);
    const p43 = buildPdfPrintProfile("4:3");
    expect(p43.heightPx).toBe(960);

    // identical input → identical cssSha256 (deterministic export identity)
    expect(buildPdfPrintProfile("16:9").cssSha256).toBe(p.cssSha256);
  });

  it("physical dimensions cover all three aspect ratios", () => {
    expect(ASPECT_BROWSER_PX["16:9"]).toEqual({ width: 1280, height: 720 });
    expect(ASPECT_BROWSER_PX["16:10"]).toEqual({ width: 1280, height: 800 });
    expect(ASPECT_BROWSER_PX["4:3"]).toEqual({ width: 1280, height: 960 });
  });
});

describe("PDF structural validation (against pdf.js)", () => {
  it("detects page-count mismatch (no silent acceptance)", async () => {
    const one = buildTextPdf([["Only one page"]]);
    const two = await validatePdfExport(one, 2, "16:9");
    expect(two.errors.join("|")).toContain("export/page-count-mismatch");
  });

  it("accepts a valid one-page document", async () => {
    const one = buildTextPdf([["Hello deck"]]);
    const r = await validatePdfExport(one, 1, "16:9");
    // builder pages are 612x792pt (letter portrait), so page-dimension checks are
    // expected to fail — the honest invariant is the header + count + operators.
    expect(r.errors.some((e) => e.startsWith("export/pdf-invalid-header"))).toBe(false);
    expect(r.errors.some((e) => e.startsWith("export/page-count-mismatch"))).toBe(false);
    expect(r.errors.some((e) => e.startsWith("export/blank-page"))).toBe(false);
    // physical-dimension mismatch is reported (builder box is not the profile's)
    expect(r.errors.some((e) => e.startsWith("export/page-dimensions"))).toBe(true);
  });

  it("a page with ONLY save/restore + marked-content operators is blank", async () => {
    // BMC/BDC/EMC are structure bookkeeping — they must NOT count as content.
    const marked = buildMarkedContentOnlyPdf();
    const r = await validatePdfExport(marked, 1, "16:9");
    expect(r.errors.some((e) => e.startsWith("export/blank-page"))).toBe(true);
  });
});
