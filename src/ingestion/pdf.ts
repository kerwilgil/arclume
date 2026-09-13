/**
 * PDF ingestion (Phase 8) — text-layer extraction via pdfjs-dist, fully offline.
 *
 *  - bytes in, normalized text + page map out; never renders, never evaluates
 *    embedded Javascript/actions, never touches the network or the filesystem;
 *  - encrypted / password-protected documents fail (`ingestion/pdf-encrypted`);
 *  - malformed documents fail (`ingestion/pdf-invalid`);
 *  - a document without a text layer is NOT silently "read": it produces empty
 *    content plus a `ingestion/pdf-no-text` gap issue (handled by the caller).
 */

import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { IngestionError } from "../errors.js";
import { countLines, normalizeText } from "./binary.js";
import type { IngestionIssue, PdfOutline, PdfPageLineRange } from "./types.js";

export const PDF_PARSER_VERSION = "0.1.0";
export const PDF_INGESTION_VERSION = PDF_PARSER_VERSION;

export interface PdfLimits {
  maxPages: number;
  maxExtractedChars: number;
}

export const DEFAULT_PDF_LIMITS: PdfLimits = {
  maxPages: 500,
  maxExtractedChars: 4_000_000,
};

export interface PdfParseResult {
  content: string;
  outline: PdfOutline;
  pages: number;
  hasTextLayer: boolean;
  /** Non-fatal structural notes (embedded attachments/action surface). */
  issues: IngestionIssue[];
}

interface TextItem {
  str?: string;
  transform?: number[];
  hasEOL?: boolean;
}

/** Group text items into physical lines by their y coordinate. */
function itemsToLines(items: readonly TextItem[]): string[] {
  const byY = new Map<number, Array<{ x: number; str: string }>>();
  for (const item of items) {
    const str = typeof item.str === "string" ? item.str : "";
    const tr = item.transform;
    const x = tr ? tr[4] : 0;
    const y = tr ? tr[5] : 0;
    const key = Math.round((y ?? 0) * 10) / 10; // pdf y is a float; bucket it
    const row = byY.get(key) ?? [];
    row.push({ x: x ?? 0, str });
    byY.set(key, row);
  }
  // pdf y grows bottom→up: sort descending for reading order
  const ys = [...byY.keys()].sort((a, b) => b - a);
  const lines: string[] = [];
  for (const y of ys) {
    const row = byY.get(y);
    if (!row) continue;
    row.sort((a, b) => a.x - b.x);
    const line = row
      .map((r) => r.str)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (line.length > 0) lines.push(line);
  }
  return lines;
}

/**
 * Extract the text layer of a PDF. Pure with respect to the input bytes; any
 * failure path throws `IngestionError` with a stable code.
 */
export async function parsePdf(
  bytes: Uint8Array,
  limits: PdfLimits = DEFAULT_PDF_LIMITS,
): Promise<PdfParseResult> {
  if (bytes.byteLength === 0) {
    throw new IngestionError("empty PDF input buffer", { code: "ingestion/pdf-invalid" });
  }

  let doc: Awaited<ReturnType<typeof getDocument>["promise"]>;
  try {
    doc = await getDocument({
      data: new Uint8Array(bytes),
      isEvalSupported: false,
      // Text extraction must not depend on host fonts.
      useSystemFonts: false,
      disableFontFace: true,
      verbosity: 0,
    }).promise;
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    const code = /password|encrypt/i.test(msg)
      ? "ingestion/pdf-encrypted"
      : "ingestion/pdf-invalid";
    throw new IngestionError(`cannot parse PDF: ${msg}`, { code });
  }

  try {
    const pages = doc.numPages;
    if (pages > limits.maxPages) {
      throw new IngestionError(`PDF declares ${pages} pages (limit ${limits.maxPages})`, {
        code: "ingestion/resource-limit",
      });
    }

    // Observe (never execute) embedded action/attachment surfaces.
    const issues: IngestionIssue[] = [];
    try {
      const hasJS = await doc.hasJSActions();
      if (hasJS) {
        issues.push({
          code: "ingestion/pdf-embedded-artifacts",
          severity: "warning",
          message: "PDF declares embedded JavaScript/actions — completely ignored",
        });
      }
      const attachments = await doc.getAttachments().catch(() => null);
      if (attachments !== null && typeof attachments === "object") {
        const count = Object.keys(attachments).length;
        if (count > 0) {
          issues.push({
            code: "ingestion/pdf-embedded-artifacts",
            severity: "warning",
            message: `PDF contains ${count} embedded attachment(s) — never extracted`,
          });
        }
      }
    } catch {
      // observation must never break ingestion
    }

    const linesAll: string[] = [];
    const pageRanges: PdfPageLineRange[] = [];
    let totalChars = 0;
    let anyText = false;

    for (let p = 1; p <= pages; p += 1) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent({ disableNormalization: false });
      const lines = itemsToLines(tc.items as readonly TextItem[]);
      if (lines.length > 0) {
        anyText = true;
        const lineStart = linesAll.length + 1;
        linesAll.push(...lines);
        pageRanges.push({ page: p, lineStart, lineEnd: linesAll.length });
        totalChars += lines.reduce((acc, l) => acc + l.length + 1, 0);
        if (totalChars > limits.maxExtractedChars) {
          throw new IngestionError(
            `PDF extracted text exceeds ${limits.maxExtractedChars} characters`,
            { code: "ingestion/resource-limit" },
          );
        }
      } else {
        pageRanges.push({ page: p });
      }
      page.cleanup();
    }

    const content = normalizeText(linesAll.join("\n"));
    if (!anyText) {
      issues.push({
        code: "ingestion/pdf-no-text",
        severity: "gap",
        message: "PDF has no text layer — pages are images only; nothing is read",
      });
    }
    return {
      content,
      pages,
      hasTextLayer: anyText,
      outline: { kind: "pdf", pages, pageRanges, hasTextLayer: anyText },
      issues,
    };
  } finally {
    await doc.destroy().catch(() => undefined);
  }
}
