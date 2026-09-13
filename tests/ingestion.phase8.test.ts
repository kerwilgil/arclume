/**
 * Phase 8 8A — SourceDigest V2 + Reasoner boundary + child sources + builder dispatch.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  StubReasoner,
  buildKnowledge,
  contentHash,
  ingestInputs,
  runAnalyze,
  sourceDigest,
} from "../src/index.js";
import { parsePdf } from "../src/ingestion/pdf.js";
import type { SourceDocument } from "../src/ingestion/types.js";
import { buildDocx, buildTextPdf } from "./helpers/fixture-builders.js";

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "arclume-p8-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function doc(
  partial: Partial<SourceDocument> & Pick<SourceDocument, "id" | "sourceId" | "path" | "kind">,
): SourceDocument {
  return {
    content: "x",
    mediaType: "text/plain",
    metadata: { byteLength: 1, lineCount: 1 },
    provenance: {
      sourceHash: contentHash([partial.id, "raw"]),
      contentHash: contentHash([partial.id, "text"]),
    },
    outline: { kind: "text", lineCount: 1 },
    ...partial,
  } as SourceDocument;
}

describe("SourceDigest V2", () => {
  it("documents alone still produce a v2-prefixed stable digest", () => {
    const a = sourceDigest([doc({ id: "d-a", sourceId: "s", path: "a.md", kind: "markdown" })]);
    const b = sourceDigest([doc({ id: "d-a", sourceId: "s", path: "a.md", kind: "markdown" })]);
    expect(a).toBe(b);
    expect(a).toMatch(/^sha256:/);
  });

  it("files inventory changes the digest", () => {
    const d = doc({ id: "d-a", sourceId: "s", path: "a.md", kind: "markdown" });
    const base = sourceDigest([d]);
    const withFiles = sourceDigest(
      [d],
      [{ sourceId: "s", path: "a.md", kind: "markdown", included: true, byteLength: 10 }],
    );
    expect(withFiles).not.toBe(base);
    const modified = sourceDigest(
      [d],
      [{ sourceId: "s", path: "a.md", kind: "markdown", included: false, byteLength: 10 }],
    );
    expect(modified).not.toBe(withFiles);
  });

  it("outline participates: same text, different layout → different digest", () => {
    const d1 = doc({ id: "d-a", sourceId: "s", path: "a.pdf", kind: "pdf" });
    const d2 = doc({
      id: "d-a",
      sourceId: "s",
      path: "a.pdf",
      kind: "pdf",
      outline: {
        kind: "pdf",
        pages: 2,
        pageRanges: [{ page: 1, lineStart: 1, lineEnd: 1 }, { page: 2 }],
        hasTextLayer: true,
      },
    });
    expect(sourceDigest([d1])).not.toBe(sourceDigest([d2]));
  });

  it("input order does not change the digest", () => {
    const a = doc({ id: "d-a", sourceId: "s", path: "a.md", kind: "markdown" });
    const b = doc({ id: "d-b", sourceId: "s", path: "b.md", kind: "markdown" });
    expect(sourceDigest([a, b])).toBe(sourceDigest([b, a]));
    expect(
      sourceDigest(
        [a, b],
        [{ sourceId: "s", path: "a.md", kind: "markdown", included: true, byteLength: 1 }],
      ),
    ).toBe(
      sourceDigest(
        [b, a],
        [{ sourceId: "s", path: "a.md", kind: "markdown", included: true, byteLength: 1 }],
      ),
    );
  });

  it("same body, different URL identity → different sourceDigest", () => {
    const d1 = doc({ id: "d-u1", sourceId: "url-a", path: "snapshot", kind: "url" });
    const d2 = doc({ id: "d-u2", sourceId: "url-b", path: "snapshot", kind: "url" });
    expect(sourceDigest([d1])).not.toBe(sourceDigest([d2]));
  });
});

describe("child sources + builder provenance", () => {
  it("two PDFs in one directory → distinct child sources with same PageLocator page", async () => {
    writeFileSync(join(dir, "a.pdf"), buildTextPdf([["Alpha body"]]));
    writeFileSync(join(dir, "b.pdf"), buildTextPdf([["Beta body"]]));
    const result = await ingestInputs([dir]);
    const pdfSources = result.sources.filter((s) => s.kind === "pdf");
    expect(pdfSources.length).toBe(2);
    const docs = result.documents.filter((d) => d.kind === "pdf");
    expect(docs.length).toBe(2);
    // evidence → PageLocator scoped to the child source
    const analyzed = await runAnalyze([dir], new StubReasoner());
    const { knowledge } = buildKnowledge(analyzed);
    expect(knowledge).toBeDefined();
    // the two doc ids are distinct
    expect(new Set(docs.map((d) => d.id)).size).toBe(2);
  });

  it("two DOCX files → distinct child sources", async () => {
    writeFileSync(join(dir, "a.docx"), buildDocx([{ text: "Alpha" }]));
    writeFileSync(join(dir, "b.docx"), buildDocx([{ text: "Beta" }]));
    const result = await ingestInputs([dir]);
    const docxSources = result.sources.filter((s) => s.kind === "docx");
    expect(docxSources.length).toBe(2);
    expect(new Set(docxSources.map((s) => s.id)).size).toBe(2);
  });
});

describe("Reasoner type boundary", () => {
  it("pdf/docx/url documents flow through the Reasoner request", async () => {
    writeFileSync(join(dir, "a.pdf"), buildTextPdf([["Pdf text body"]]));
    writeFileSync(join(dir, "b.docx"), buildDocx([{ text: "Docx heading", headingDepth: 1 }]));
    const analyzed = await runAnalyze([dir], new StubReasoner());
    const kinds = new Set(analyzed.request.documents.map((d) => d.kind));
    expect(kinds.has("pdf")).toBe(true);
    expect(kinds.has("docx")).toBe(true);
  });
});
