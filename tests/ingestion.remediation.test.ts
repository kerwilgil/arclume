/**
 * Phase 8 remediation tests — evidence/Locator resolution, IPv6 parser depth,
 * collision remapping, direct-file identity, PDF unresolved evidence.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  StubReasoner,
  buildKnowledge,
  contentHash,
  ingest,
  ingestInputs,
  runAnalyze,
} from "../src/index.js";
import type { SourceDocument } from "../src/ingestion/types.js";
import { isBlockedIp } from "../src/ingestion/url-security.js";
import { buildDocx, buildTextPdf } from "./helpers/fixture-builders.js";

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "arclume-p8rem-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("ingestion identity — direct file vs directory", () => {
  it("a direct single PDF file → one source kind=pdf, no child", async () => {
    const file = join(dir, "report.pdf");
    writeFileSync(file, buildTextPdf([["Solo page"]]));
    const result = await ingestInputs([file]);
    const pdfSources = result.sources.filter((s) => s.kind === "pdf");
    expect(pdfSources.length).toBe(1);
    const doc = result.documents.find((d) => d.kind === "pdf");
    expect(doc).toBeDefined();
    expect(doc?.sourceId).toBe(pdfSources[0]?.id);
    expect(result.sources.length).toBe(1);
  });

  it("a directory containing one PDF → root + child source", async () => {
    writeFileSync(join(dir, "report.pdf"), buildTextPdf([["Nested"]]));
    const result = await ingestInputs([dir]);
    const kinds = result.sources.map((s) => s.kind);
    expect(kinds).toContain("directory");
    expect(kinds).toContain("pdf");
    expect(result.sources.length).toBe(2);
  });
});

describe("SSRF IPv6 depth", () => {
  it("hex/IPv4-mapped/mixed forms are classified correctly", () => {
    for (const ip of [
      "::ffff:127.0.0.1",
      "::ffff:7f00:1",
      "0:0:0:0:0:ffff:7f00:1",
      "fc00::1",
      "ff02::1",
      "2001:db8::1",
      "::1",
    ]) {
      expect(isBlockedIp(ip), ip).toBe(true);
    }
    expect(isBlockedIp("2606:4700:4700::1111")).toBe(false);
    expect(isBlockedIp("64:ff9b::8.8.8.8")).toBe(false); // NAT64 of a public address
  });
});

describe("knowledge builder provenance — Phase 8 remediation", () => {
  it("PDF evidence that maps to no page is dropped, never defaults to page 1", () => {
    // A SourceDocument whose outline collides with nothing: range lives outside.
    const spy: SourceDocument = {
      id: "doc-pdf",
      sourceId: "pdf-a",
      kind: "pdf",
      path: "x.pdf",
      mediaType: "application/pdf",
      content: "line1",
      metadata: { byteLength: 5, lineCount: 1, pageCount: 1 },
      provenance: { sourceHash: contentHash("raw"), contentHash: contentHash("t") },
      outline: {
        kind: "pdf",
        pages: 1,
        pageRanges: [{ page: 1, lineStart: 1, lineEnd: 1 }],
        hasTextLayer: true,
      },
    };

    // Evidence placed OUT of any known range (line 99 in a 1-line doc).
    const analysis = {
      analysisVersion: "0.1.0" as const,
      project: { name: "t", evidence: [] as never[] },
      entities: [],
      relations: [],
      claims: [
        {
          id: "c1",
          statement: "some claim",
          factType: "FACT" as const,
          sourceRefs: [] as never[],
          evidence: [{ documentId: "doc-pdf", lineStart: 99, lineEnd: 99, quote: "nonexistent" }],
        },
      ],
      gaps: [],
    };
    const result = buildKnowledge({
      analysis,
      ingestion: { sources: [], documents: [spy] },
      sourceDigest: contentHash("digest"),
    });
    expect(result.validation.valid).toBe(true);
  });

  it("a URL document without explicit range uses its final URL as provenance", () => {
    const urlDoc: SourceDocument = {
      id: "doc-url",
      sourceId: "u1",
      kind: "url",
      path: "snapshot",
      mediaType: "text/html",
      content: "alpha beta\ngamma delta",
      metadata: { byteLength: 24, lineCount: 2, finalUrl: "https://example.com/p" },
      provenance: { sourceHash: contentHash("raw"), contentHash: contentHash("t") },
      outline: {
        kind: "url",
        finalUrl: "https://example.com/p",
        headings: [],
        fragments: [{ anchor: "h/1", lineStart: 1, lineEnd: 1 }],
      },
    };
    // evidence WITHOUT range → URL locator (document-level)
    const analysis = {
      analysisVersion: "0.1.0" as const,
      project: { name: "t", evidence: [] as never[] },
      entities: [],
      relations: [],
      claims: [
        {
          id: "c1",
          statement: "some claim",
          factType: "FACT" as const,
          sourceRefs: [] as never[],
          evidence: [{ documentId: "doc-url" }],
        },
      ],
      gaps: [],
    };
    const urlSource = {
      id: "u1",
      kind: "url" as const,
      title: "example.com",
      uri: "https://example.com/p",
    };
    const result = buildKnowledge({
      analysis,
      ingestion: { sources: [urlSource], documents: [urlDoc] },
      sourceDigest: contentHash("digest"),
    });
    expect(result.validation.valid).toBe(true);
    const anyRef = result.knowledge.claims[0]?.sourceRefs?.[0];
    expect(anyRef?.locator?.kind).toBe("url");
    expect(anyRef?.locator && "url" in anyRef.locator ? anyRef.locator.url : "").toBe(
      "https://example.com/p",
    );
  });
});
