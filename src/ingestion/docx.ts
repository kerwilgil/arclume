/**
 * DOCX ingestion (Phase 8) — safe OPC parsing into normalized text plus
 * deterministic fragment anchors.
 *
 * Never executes: VBA (rejected at package level), OLE, embedded packages,
 * external relationships (any TargetMode="External" other than a hyperlink,
 * which is kept as inert text metadata), DOCTYPE/entities (saxes is strict).
 *
 * Anchors (deterministic across re-parses because they derive from document
 * order, never from byte offsets):
 *   paragraphs   p/<n>        (n = 1-based index across body paragraphs)
 *   headings     h/<depth>/(n) (n = 1-based paragraph index)
 *   table cells  tbl/<i>/r<j>/c<k> (1-based table, row, column)
 */

import { SaxesParser, type SaxesTagPlain } from "saxes";
import { IngestionError } from "../errors.js";
import { normalizeText } from "./binary.js";
import { openDocxPackage } from "./docx-zip.js";
import type { DocumentLineFragment, DocxOutline, IngestionIssue } from "./types.js";

export const DOCX_PARSER_VERSION = "0.1.0";
export const DOCX_INGESTION_VERSION = DOCX_PARSER_VERSION;

export interface DocxParseResult {
  content: string;
  outline: DocxOutline;
  paragraphCount: number;
  tableCount: number;
  issues: IngestionIssue[];
}

interface Run {
  text: string;
  hyperlinkUrl?: string;
}

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

function fail(code: string, message: string): never {
  throw new IngestionError(message, { code, severity: "fatal" });
}

/* ------------------------------------------------------------------ */
/* relationships                                                       */
/* ------------------------------------------------------------------ */

/**
 * Audit ONE `.rels` part. External relationships are fatal except hyperlinks,
 * which become inert metadata. Runs for every `.rels` in the package.
 */
function auditRelsPart(partName: string, relsXml: string): void {
  const parser = new SaxesParser({});
  let firstError: Error | undefined;
  parser.on("error", (err) => {
    firstError ??= err;
  });
  parser.on("opentag", (tag: SaxesTagPlain) => {
    if (!tag.name.endsWith("Relationship")) return;
    const attrs = tag.attributes as Record<string, string>;
    const mode = attrs["TargetMode"];
    const type = attrs["Type"] ?? "";
    if (mode !== "External") return;
    if (type.endsWith("/hyperlink")) return; // inert surface only
    fail(
      "ingestion/docx-unsafe-package",
      `${partName}: external relationship of type "${type}" is not allowed`,
    );
  });
  try {
    parser.write(relsXml).close();
  } catch (err) {
    if (err instanceof IngestionError) throw err;
    fail("ingestion/docx-invalid", `${partName}: parse failure (${(err as Error).message})`);
  }
  if (firstError) {
    fail("ingestion/docx-invalid", `${partName}: parse failure (${firstError.message})`);
  }
}

/** Parse `word/_rels/document.xml.rels`; hyperlinks are the only external targets kept (inert). */
function readHyperlinkRels(relsXml: string | null): Map<string, string> {
  const map = new Map<string, string>();
  if (relsXml === null) return map;
  const parser = new SaxesParser({});
  let firstError: Error | undefined;
  parser.on("error", (err) => {
    firstError ??= err;
  });
  parser.on("opentag", (tag: SaxesTagPlain) => {
    if (!tag.name.endsWith("Relationship")) return;
    const attrs = tag.attributes as Record<string, string>;
    const target = attrs["Target"];
    const mode = attrs["TargetMode"];
    const type = attrs["Type"] ?? "";
    const id = attrs["Id"] ?? "";
    if (mode !== "External") return; // internal references are structural
    if (type.endsWith("/hyperlink") && typeof target === "string" && id !== "") {
      map.set(id, target); // inert metadata — never fetched
      return;
    }
    // everything else external is an unsafe external resource
    fail(
      "ingestion/docx-unsafe-package",
      `external relationship of type "${type}" to "${String(target)}"`,
    );
  });
  try {
    parser.write(relsXml).close();
  } catch (err) {
    if (err instanceof IngestionError) throw err;
    fail("ingestion/docx-invalid", `rels parse failure: ${(err as Error).message}`);
  }
  if (firstError) fail("ingestion/docx-invalid", `rels parse failure: ${firstError.message}`);
  return map;
}

/* ------------------------------------------------------------------ */
/* document.xml                                                        */
/* ------------------------------------------------------------------ */

interface Cursor {
  lines: string[];
  fragments: DocumentLineFragment[];
  paragraphIndex: number;
  tableIndex: number;
  headingPath: string[];
  issues: IngestionIssue[];
}

function pushLine(cur: Cursor, text: string, anchor: string, depth: number | undefined): void {
  while (cur.headingPath.length > (depth ?? 0)) cur.headingPath.pop();
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length === 0) return;
  const lineStart = cur.lines.length + 1;
  cur.lines.push(trimmed);
  cur.fragments.push({ anchor, lineStart, lineEnd: lineStart });
}

/** Parse `word/document.xml` into normalized text + fragments. */
function parseDocumentXml(xml: string, hyperlinkRels: Map<string, string>): Cursor {
  const cur: Cursor = {
    lines: [],
    fragments: [],
    paragraphIndex: 0,
    tableIndex: 0,
    headingPath: [],
    issues: [],
  };

  const parser = new SaxesParser({});
  let firstError: Error | undefined;
  parser.on("error", (err) => {
    firstError ??= err;
  });

  // walking state
  let inBody = false;
  let inParagraph = false;
  let inTable = false;
  let inTableCell = false;
  let cellRow = 0;
  let cellCol = 0;
  let currentStyle = "";
  let currentHasNumbering = false;
  let pendingRuns: Run[] = [];
  let pendingText = "";
  let pendingLink: string | undefined;

  parser.on("opentag", (t: SaxesTagPlain) => {
    const name = t.name.includes(":") ? (t.name.split(":")[1] ?? t.name) : t.name;
    if (name.startsWith(":")) return;
    switch (name) {
      case "body":
        inBody = true;
        break;
      case "p":
      case "paragraph":
        if (!inBody || inTable) break;
        inParagraph = true;
        pendingRuns = [];
        pendingText = "";
        pendingLink = undefined;
        cur.paragraphIndex += 1;
        currentStyle = "";
        currentHasNumbering = false;
        break;
      case "pStyle": {
        const v =
          (t.attributes as Record<string, string>)["val"] ??
          (t.attributes as Record<string, string>)[`${W}|val`];
        if (typeof v === "string") currentStyle = v;
        break;
      }
      case "numPr":
        if (inParagraph) currentHasNumbering = true;
        break;
      case "hyperlink": {
        const rid =
          (t.attributes as Record<string, string>)["id"] ??
          (t.attributes as Record<string, string>)[`${R}|id`];
        if (typeof rid === "string") pendingLink = rid;
        break;
      }
      case "tbl":
        inTable = true;
        cur.tableIndex += 1;
        break;
      case "tr":
        if (inTable) cellRow += 1;
        cellCol = 0;
        break;
      case "tc":
        if (inTable) {
          inTableCell = true;
          cellCol += 1;
          pendingText = "";
          pendingLink = undefined;
        }
        break;
      default:
        break;
    }
  });

  parser.on("closetag", (t: SaxesTagPlain) => {
    const name = t.name.includes(":") ? (t.name.split(":")[1] ?? t.name) : t.name;
    switch (name) {
      case "p": {
        if (!inParagraph) break;
        inParagraph = false;
        const text = pendingText.replace(/\s+/g, " ").trim();
        const linkId = pendingLink;
        if (text.length === 0) {
          pendingLink = undefined;
          return;
        }
        const hyperlink = linkId ? hyperlinkRels.get(linkId) : undefined;
        pendingLink = undefined;
        const body = hyperlink !== undefined ? `${text} (${hyperlink})` : text;
        const styleLower = currentStyle.toLowerCase();
        const headingMatch = /^heading\s*(\d+)$/.exec(styleLower);
        if (headingMatch) {
          const depthVal = Math.min(6, Math.max(1, Number(headingMatch[1])));
          while (cur.headingPath.length >= depthVal) cur.headingPath.pop();
          cur.headingPath.push(body);
          pushLine(cur, body, `h/${depthVal}/${cur.paragraphIndex}`, depthVal);
        } else if (currentStyle === "Title") {
          cur.headingPath = [body];
          pushLine(cur, body, `h/1/${cur.paragraphIndex}`, 1);
        } else if (currentHasNumbering) {
          pushLine(cur, `• ${body}`, `p/${cur.paragraphIndex}`, undefined);
        } else {
          pushLine(cur, body, `p/${cur.paragraphIndex}`, undefined);
        }
        break;
      }
      case "tc": {
        if (!inTableCell) break;
        inTableCell = false;
        const text = pendingText.replace(/\s+/g, " ").trim();
        pendingText = "";
        if (text.length > 0) {
          pushLine(cur, text, `tbl/${cur.tableIndex}/r${cellRow}/c${cellCol}`, undefined);
        }
        break;
      }
      case "tbl":
        inTable = false;
        inTableCell = false;
        cellRow = 0;
        cellCol = 0;
        break;
      default:
        break;
    }
  });

  parser.on("text", (text: string) => {
    if (inParagraph || inTableCell) pendingText += text;
  });

  try {
    parser.write(xml).close();
  } catch (err) {
    fail("ingestion/docx-invalid", `document.xml parse failure: ${(err as Error).message}`);
  }
  if (firstError) fail("ingestion/docx-invalid", `document.xml: ${firstError.message}`);
  return cur;
}

/* ------------------------------------------------------------------ */

/**
 * Parse a DOCX buffer. Bytes in → normalized text + outline + issues.
 */
export function parseDocx(bytes: Uint8Array): DocxParseResult {
  if (bytes.byteLength === 0) {
    fail("ingestion/docx-invalid", "empty DOCX input buffer");
  }

  const pkg = openDocxPackage(bytes);
  const docXml = pkg.read("word/document.xml");
  if (docXml === null) {
    fail("ingestion/docx-invalid", "word/document.xml is absent — not a DOCX document");
  }
  const relsXml = pkg.read("word/_rels/document.xml.rels");
  const stylesXml = pkg.read("word/styles.xml");
  const contentTypes = pkg.read("[Content_Types].xml");
  void contentTypes;
  void stylesXml;

  // Every `.rels` part may carry relationships; the policy is global, never
  // scoped to the document.xml one.
  for (const entry of pkg.entriesIncludingUnsafe) {
    if (!entry.endsWith(".rels")) continue;
    const xml = new TextDecoder().decode(pkg.readAudit(entry));
    auditRelsPart(entry, xml);
  }

  const xml = new TextDecoder("utf-8").decode(docXml);
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
    fail("ingestion/docx-invalid", "DOCTYPE/ENTITY declarations are not allowed");
  }
  const hyperlinkRels = readHyperlinkRels(
    relsXml === null ? null : new TextDecoder("utf-8").decode(relsXml),
  );
  const cur = parseDocumentXml(xml, hyperlinkRels);

  const content = normalizeText(cur.lines.join("\n"));
  return {
    content,
    paragraphCount: cur.paragraphIndex,
    tableCount: cur.tableIndex,
    outline: {
      kind: "docx",
      fragments: cur.fragments,
      paragraphCount: cur.paragraphIndex,
      tableCount: cur.tableIndex,
    },
    issues: cur.issues,
  };
}
