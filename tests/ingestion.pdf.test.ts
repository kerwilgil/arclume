/**
 * Phase 8 — PDF ingestion (unit, fully offline, no network).
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SAFETY_LIMITS, ingestInputs, parseBinaryDocument } from "../src/index.js";
import { parsePdf } from "../src/ingestion/pdf.js";
import type { IngestionIssue } from "../src/ingestion/types.js";
import type { Source } from "../src/types/common.js";
import { buildImageOnlyPdf, buildTextPdf } from "./helpers/fixture-builders.js";

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "arclume-p8-pdf-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const fakeSource: Source = { id: "pdf-test", kind: "pdf", title: "probe.pdf" };

describe("PDF ingestion (pdfjs-dist, offline)", () => {
  it("extracts a two-page text layer with page→line mapping", async () => {
    const pdf = buildTextPdf([
      ["Hello from page one", "and its second line"],
      ["Second page content"],
    ]);
    const parsed = await parsePdf(pdf);
    expect(parsed.pages).toBe(2);
    expect(parsed.hasTextLayer).toBe(true);
    expect(parsed.content).toContain("Hello from page one");
    expect(parsed.content).toContain("Second page content");
    const ranges = parsed.outline.pageRanges;
    expect(ranges.length).toBe(2);
    // page 1 carries the first two lines; page 2 the third
    expect(ranges[0]).toMatchObject({ page: 1, lineStart: 1, lineEnd: 2 });
    expect(ranges[1]).toMatchObject({ page: 2, lineStart: 3, lineEnd: 3 });
  });

  it("empty page yields a range without lines", async () => {
    const pdf = buildTextPdf([["First"], [], ["Third"]]);
    const parsed = await parsePdf(pdf);
    expect(parsed.pages).toBe(3);
    const ranges = parsed.outline.pageRanges;
    expect(ranges[1]).toEqual({ page: 2 });
    expect(ranges[2]).toMatchObject({ page: 3, lineStart: 2 });
  });

  it("image-only PDF is a gap, never a lie", async () => {
    const pdf = buildImageOnlyPdf(1);
    const issues: IngestionIssue[] = [];
    const document = await parseBinaryDocument(fakeSource, "pdf", "image.pdf", pdf, issues);
    expect(document.content).toBe("");
    expect(document.outline.kind).toBe("pdf");
    expect((document.outline as { hasTextLayer: boolean }).hasTextLayer).toBe(false);
    // the gap is loud and carries evidence identity
    expect(issues.some((i) => i.code === "ingestion/pdf-no-text")).toBe(true);
    const issue = issues.find((i) => i.code === "ingestion/pdf-no-text");
    expect(issue?.severity).toBe("gap");
    expect(issue?.sourceId).toBe(fakeSource.id);
    expect(issue?.documentId).toBe(document.id);
    expect(issue?.path).toBe("image.pdf");
  });

  it("malformed bytes fail closed", async () => {
    await expect(parsePdf(Buffer.from("not a pdf at all"))).rejects.toMatchObject({
      code: "ingestion/pdf-invalid",
    });
  });

  it("over-size inputs fail before parsing when invoked via the walker", async () => {
    const pdf = buildTextPdf([["Tiny body"]]);
    const file = join(dir, "big.pdf");
    // sparse: claim headroom but write a ~200-byte header plus placeholder read
    writeFileSync(file, Buffer.concat([pdf, Buffer.alloc(0)]));
    const result = await ingestInputs([file], {
      limits: { ...DEFAULT_SAFETY_LIMITS, maxPdfBytes: 16 },
    });
    // the PDF is too large for the test limit → skipped, never parsed
    expect(result.skipped.some((s) => s.reason === "too-large")).toBe(true);
    expect(result.documents.length).toBe(0);
  });

  it("works in an environment with no canvas / no DOM", async () => {
    // pdfjs-dist runs its legacy build in Node entirely off `canvas`
    const pdf = buildTextPdf([["canvas-free extraction works"]]);
    const parsed = await parsePdf(pdf);
    expect(parsed.content).toContain("canvas-free extraction works");
  });
});

describe("PDF ingestion — end-to-end walk integration", () => {
  it("a directory with PDFs produces child sources with content hashes", async () => {
    const a = buildTextPdf([["Doc A body"]]);
    const b = buildTextPdf([["Doc B body"]]);
    writeFileSync(join(dir, "a.pdf"), a);
    writeFileSync(join(dir, "b.pdf"), b);
    const result = await ingestInputs([dir]);
    const pdfSources = result.sources.filter((s: { kind: string }) => s.kind === "pdf");
    expect(pdfSources.length).toBe(2);
    expect(
      pdfSources.every(
        (s: { hash?: string; uri?: string }) => s.hash?.startsWith("sha256:") === true,
      ),
    ).toBe(true);
    expect(pdfSources.every((s: { uri?: string }) => s.uri && !s.uri.startsWith("C:"))).toBe(true);
    const ids = new Set(pdfSources.map((s: { id: string }) => s.id));
    expect(ids.size).toBe(2);
  });
});
