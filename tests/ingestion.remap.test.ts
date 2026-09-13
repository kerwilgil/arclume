/**
 * Phase 8 final trust-boundary: collision remap must rebind EVERY identity —
 * `SourceDocument.id/sourceId`, `UrlSnapshot.documentId`, and crucially
 * `IngestionIssue.documentId/documentId`. The old implementation mutated
 * `document.id` first and then searched for the OLD id — a lookup that could
 * never match, leaving stale issue→document references.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ingestInputs } from "../src/index.js";
import { buildImageOnlyPdf } from "./helpers/fixture-builders.js";

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "arclume-remap-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("ingestion collision remap", () => {
  it("two colliding source ids: issue.documentId is remapped to the NEW document id", async () => {
    // Two identical-by-id inputs, each a single image-only PDF (→ the parsed
    // document carries an `ingestion/pdf-no-text` issue with documentId).
    const a = join(dir, "in-a");
    const b = join(dir, "in-b");
    mkdirSync(a, { recursive: true });
    mkdirSync(b, { recursive: true });
    writeFileSync(join(a, "report-alpha.pdf"), buildImageOnlyPdf(1));
    writeFileSync(join(b, "report-beta.pdf"), buildImageOnlyPdf(1));

    const result = await ingestInputs(
      [
        { kind: "path", path: a },
        { kind: "path", path: b },
      ],
      { sourceId: "colliding-source" },
    );

    // two directory inputs → two root sources + one child source per PDF
    expect(result.sources.length).toBe(4);
    const sourceIds = new Set(result.sources.map((s) => s.id));
    expect(sourceIds.size).toBe(4);
    const docIds = new Set(result.documents.map((d) => d.id));
    expect(docIds.size).toBe(2);

    const issues = result.issues.filter(
      (i) => i.code === "ingestion/pdf-no-text" && i.documentId !== undefined,
    );
    expect(issues.length).toBe(2);
    for (const issue of issues) {
      // no stale ids: issue.sourceId is a real source, issue.documentId is a
      // real document, and that document belongs to that same source.
      expect(sourceIds.has(issue.sourceId as string)).toBe(true);
      expect(docIds.has(issue.documentId as string)).toBe(true);
      const doc = result.documents.find((d) => d.id === issue.documentId);
      expect(doc?.sourceId).toBe(issue.sourceId);
    }
  });
});
