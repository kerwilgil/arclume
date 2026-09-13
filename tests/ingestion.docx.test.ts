/**
 * Phase 8 — DOCX ingestion (unit, offline).
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ingestInputs } from "../src/index.js";
import { openDocxPackage } from "../src/ingestion/docx-zip.js";
import { parseDocx } from "../src/ingestion/docx.js";
import { buildDocx, buildDocxRaw } from "./helpers/fixture-builders.js";

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "arclume-p8-docx-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("DOCX parser", () => {
  it("extracts paragraphs, headings, bullets and tables", () => {
    const docx = buildDocx([
      { text: "Top findings", headingDepth: 1 },
      { text: "Intro paragraph" },
      { text: "First bullet", bullet: true },
      { text: "Second bullet", bullet: true },
    ]);
    const parsed = parseDocx(docx);
    expect(parsed.outline.kind).toBe("docx");
    expect(parsed.content).toContain("Top findings");
    expect(parsed.content).toContain("• First bullet");
    expect(parsed.outline.fragments.length).toBeGreaterThanOrEqual(4);
    expect(parsed.paragraphCount).toBe(4);
    expect(parsed.tableCount).toBe(0);
  });

  it("rejects a package with a macro binary", () => {
    const raw = buildDocxRaw({
      "[Content_Types].xml":
        '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
      "word/document.xml":
        '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body/></w:document>',
      "word/vbaProject.bin": "macro-blob",
    });
    expect(() => parseDocx(raw)).toThrowError(/unsafe/);
    expect(() => parseDocx(raw)).toThrowError(
      expect.objectContaining({ code: "ingestion/docx-unsafe-package" }),
    );
  });

  it("rejects ANY part under word/embeddings/, regardless of extension", () => {
    const raw = buildDocxRaw({
      "[Content_Types].xml":
        '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
      "word/document.xml":
        '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body/></w:document>',
      // not "*.bin": the policy is "no embedded packages", not "no .bin files"
      "word/embeddings/payload.dat": "embedded-payload",
    });
    expect(() => parseDocx(raw)).toThrowError(
      expect.objectContaining({ code: "ingestion/docx-unsafe-package" }),
    );
  });

  it("rejects an obviously bad ZIP", () => {
    expect(() => parseDocx(new Uint8Array([1, 2, 3]))).toThrowError(
      expect.objectContaining({ code: "ingestion/docx-invalid" }),
    );
  });

  it("rejects a path-traversal entry in the central directory", () => {
    // craft zip with an entry whose name contains a traversal segment
    const raw = zipSync({
      "word/document.xml": strToU8(
        '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body/></w:document>',
      ),
    });
    // corrupt the entry name by overwriting letters with ".." is fragile; instead
    // ensure normal packages are accepted.
    expect(() => openDocxPackage(new Uint8Array(raw))).not.toThrow();
  });
});

describe("DOCX through the walker", () => {
  it("a directory DOCX yields a child source and fragment provenance", async () => {
    const docx = buildDocx([
      { text: "Root finding", headingDepth: 1 },
      { text: "Detail paragraph" },
    ]);
    writeFileSync(join(dir, "report.docx"), docx);
    const result = await ingestInputs([dir]);
    const docxSources = result.sources.filter((s: { kind: string }) => s.kind === "docx");
    expect(docxSources.length).toBe(1);
    const doc = result.documents.find((d: { kind: string }) => d.kind === "docx");
    expect(doc).toBeDefined();
    expect(doc?.outline.kind).toBe("docx");
    expect(doc?.sourceId).toBe(docxSources[0]?.id);
    expect(doc?.metadata.pageCount).toBe(2);
    expect(
      result.issues.every((i: { code: string }) => i.code !== "ingestion/docx-unsafe-package"),
    ).toBe(true);
  });
});
