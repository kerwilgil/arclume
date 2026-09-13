/**
 * Ingestion orchestration: walk → normalize → parse → `SourceDocument[]`.
 *
 * Text paths are synchronous (`ingest`), exactly as in Phase 2. URL inputs
 * require the asynchronous `ingestInputs` surface — `ingest()` refuses them
 * rather than faking a path.
 *
 * Phase 8 adds:
 *  - per-format size limits (text 2 MiB, PDF/DOCX 32 MiB);
 *  - child Sources for PDF/DOCX inside a directory (real provenance identity);
 *  - `UrlSnapshot`s and stage-local `IngestionIssue`s;
 *  - URL inputs (`{kind:"url", url}`) — fetched, never executed.
 */

import { createHash } from "node:crypto";
import { ArclumeError, DiscoveryError } from "../errors.js";
import { deriveId } from "../knowledge/ids.js";
import type { Source } from "../types/common.js";
import { countLines, normalizeText } from "./binary.js";
import { type WalkedFile, walkRoot } from "./discover.js";
import { parseDocx } from "./docx.js";
import { parseDocument } from "./parsers.js";
import { parsePdf } from "./pdf.js";
import type {
  IngestionInput,
  IngestionIssue,
  IngestionOptions,
  IngestionResult,
  SkippedInput,
  SourceDocument,
  SourceDocumentKind,
  UrlSnapshot,
} from "./types.js";
import type { UrlIngestOutcome } from "./url.js";
import { ingestUrl } from "./url.js";

export const MEDIA_TYPES: Record<SourceDocumentKind, string> = {
  markdown: "text/markdown",
  text: "text/plain",
  json: "application/json",
  yaml: "application/yaml",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  url: "text/html",
};

export function sha256PrefixedBytes(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function sha256PrefixedText(text: string): string {
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

/* ------------------------------------------------------------------ */
/* per-document builders                                              */
/* ------------------------------------------------------------------ */

function buildTextDocument(
  sourceId: string,
  kind: Exclude<SourceDocumentKind, "pdf" | "docx" | "url">,
  path: string,
  raw: Uint8Array,
): { document: SourceDocument } | { skip: SkippedInput } {
  const content = normalizeText(Buffer.from(raw).toString("utf8"));
  let parsed: ReturnType<typeof parseDocument>;
  try {
    parsed = parseDocument(kind, content, path);
  } catch (err) {
    const detail = err instanceof ArclumeError ? err.message : String(err);
    return { skip: { path, reason: "parse-error", detail } };
  }
  return {
    document: {
      id: deriveId("doc", sourceId, path),
      sourceId,
      kind,
      path,
      mediaType: MEDIA_TYPES[kind],
      content,
      metadata: {
        ...parsed.metadata,
        byteLength: Buffer.byteLength(content, "utf8"),
        lineCount: countLines(content),
      },
      provenance: {
        sourceHash: sha256PrefixedBytes(raw),
        contentHash: sha256PrefixedText(content),
      },
      outline: parsed.outline,
    },
  };
}

/** Parse a PDF/DOCX document (never executes the payload). */
export async function parseBinaryDocument(
  source: Source,
  kind: "pdf" | "docx",
  path: string,
  raw: Uint8Array,
  issues: IngestionIssue[],
  extra?: { finalUrl?: string; httpStatus?: number },
): Promise<SourceDocument> {
  let parsed: { content: string; outline: SourceDocument["outline"]; issues: IngestionIssue[] };
  let pageCount: number;
  if (kind === "pdf") {
    const pdfParsed = await parsePdf(raw);
    parsed = { content: pdfParsed.content, outline: pdfParsed.outline, issues: pdfParsed.issues };
    pageCount = pdfParsed.pages;
  } else {
    const docxParsed = parseDocx(raw);
    parsed = {
      content: docxParsed.content,
      outline: docxParsed.outline,
      issues: docxParsed.issues,
    };
    pageCount = docxParsed.paragraphCount;
  }
  const content = parsed.content;
  const lineCount = countLines(content);
  const metadata: SourceDocument["metadata"] = {
    byteLength: raw.byteLength,
    lineCount,
    pageCount,
  };
  if (extra?.finalUrl !== undefined) metadata.finalUrl = extra.finalUrl;
  if (extra?.httpStatus !== undefined) metadata.httpStatus = extra.httpStatus;
  const document: SourceDocument = {
    id: deriveId("doc", source.id, path),
    sourceId: source.id,
    kind,
    path,
    mediaType: MEDIA_TYPES[kind],
    content,
    metadata,
    provenance: {
      sourceHash: sha256PrefixedBytes(raw),
      contentHash: sha256PrefixedText(content),
    },
    outline: parsed.outline,
  };
  for (const issue of parsed.issues) {
    issues.push({ ...issue, sourceId: source.id, documentId: document.id, path });
  }
  return document;
}

/* ------------------------------------------------------------------ */
/* per-input assembly                                                  */
/* ------------------------------------------------------------------ */

interface OneInput {
  source: Source;
  childSources: Source[];
  documents: SourceDocument[];
  discovery: IngestionResult["discovery"][number] | undefined;
  skipped: SkippedInput[];
  issues: IngestionIssue[];
  urlSnapshot: UrlSnapshot | undefined;
  binaryPending: Array<{
    file: WalkedFile & { kind: "pdf" | "docx"; bytes: Buffer };
    source: Source;
  }>;
}

function ingestPathSync(input: string, options: IngestionOptions): OneInput {
  const walk = walkRoot(input, options);
  const documents: SourceDocument[] = [];
  const skipped: SkippedInput[] = [...walk.skipped];
  const issues: IngestionIssue[] = [];
  const childSources: Source[] = [];
  const binaryPending: OneInput["binaryPending"] = [];

  for (const file of walk.files) {
    if (!file.included || file.bytes === undefined) continue;
    const kind = file.kind as SourceDocumentKind;
    if (kind === "pdf" || kind === "docx") {
      // Directory walk → one child Source per binary document; single-file
      // input → the root Source IS the document (no redundant child).
      if (walk.singleFile) {
        binaryPending.push({
          file: file as WalkedFile & { kind: "pdf" | "docx"; bytes: Buffer },
          source: walk.source,
        });
        continue;
      }
      const relativePosixPath = file.path;
      const childKind = kind;
      const child: Source = {
        id: deriveId(childKind, walk.source.id, relativePosixPath),
        kind: childKind,
        title: relativePosixPath.split("/").pop() || relativePosixPath,
        uri: relativePosixPath,
        hash: sha256PrefixedBytes(file.bytes),
        mediaType: MEDIA_TYPES[childKind],
      };
      childSources.push(child);
      binaryPending.push({
        file: file as WalkedFile & { kind: "pdf" | "docx"; bytes: Buffer },
        source: child,
      });
      continue;
    }
    const result = buildTextDocument(
      walk.source.id,
      kind as Exclude<SourceDocumentKind, "pdf" | "docx" | "url">,
      file.path,
      file.bytes,
    );
    if ("document" in result) documents.push(result.document);
    else skipped.push(result.skip);
  }

  const discovery = {
    source: walk.source,
    rootAbsPath: walk.rootAbsPath,
    files: walk.files.map((f) => ({
      path: f.path,
      kind: f.kind,
      byteLength: f.byteLength,
      included: f.included,
    })),
    skipped: walk.skipped,
  };

  return {
    source: walk.source,
    childSources,
    documents,
    discovery,
    skipped,
    issues,
    urlSnapshot: undefined,
    binaryPending,
  };
}

async function ingestOneAsync(input: IngestionInput, options: IngestionOptions): Promise<OneInput> {
  if (typeof input !== "string" && input.kind === "url") {
    const urlOpts = options.url;
    const transport = urlOpts?.transport;
    const outcome: UrlIngestOutcome = await ingestUrl(input.url, transport, {
      ...(urlOpts?.timeoutMs !== undefined ? { timeoutMs: urlOpts.timeoutMs } : {}),
      ...(urlOpts?.maxRedirects !== undefined ? { maxRedirects: urlOpts.maxRedirects } : {}),
      ...(urlOpts?.maxCompressedBytes !== undefined
        ? { maxCompressedBytes: urlOpts.maxCompressedBytes }
        : {}),
      ...(urlOpts?.maxDecompressedBytes !== undefined
        ? { maxDecompressedBytes: urlOpts.maxDecompressedBytes }
        : {}),
      ...(urlOpts?.maxHeaderBytes !== undefined ? { maxHeaderBytes: urlOpts.maxHeaderBytes } : {}),
      ...(urlOpts?.maxHtmlNodes !== undefined ? { maxHtmlNodes: urlOpts.maxHtmlNodes } : {}),
      ...(urlOpts?.maxExtractedChars !== undefined
        ? { maxExtractedChars: urlOpts.maxExtractedChars }
        : {}),
      ...(urlOpts?.maxTableCells !== undefined ? { maxTableCells: urlOpts.maxTableCells } : {}),
    });
    return {
      source: outcome.source,
      childSources: [],
      documents: outcome.documents,
      discovery: undefined,
      skipped: outcome.skipped,
      issues: outcome.issues,
      urlSnapshot: outcome.snapshot,
      binaryPending: [],
    };
  }
  void input;
  throw new DiscoveryError("illegal ingestion input kind", { code: "discovery/unsupported" });
}

/* ------------------------------------------------------------------ */
/* collation                                                           */
/* ------------------------------------------------------------------ */

function disambiguateCollisions(inputs: OneInput[]): void {
  const counts = new Map<string, number>();
  for (const one of inputs) counts.set(one.source.id, (counts.get(one.source.id) ?? 0) + 1);

  // group by collided root id
  const groups = new Map<string, OneInput[]>();
  for (const one of inputs) {
    if ((counts.get(one.source.id) ?? 0) > 1) {
      const g = groups.get(one.source.id) ?? [];
      g.push(one);
      groups.set(one.source.id, g);
    }
  }
  for (const members of groups.values()) {
    // deterministic assignment key: per-input content digest + source title
    const keyed = members.map((one) => ({
      one,
      key: `${contentKey(one)} ${one.source.title}`,
    }));
    keyed.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    keyed.forEach(({ one }, i) => {
      if (i === 0) return; // the first member keeps the base id
      const uniqueId = deriveId(one.source.kind, one.source.title, String(i), contentKey(one));
      remapInput(one, uniqueId);
    });
  }
}

function contentKey(one: OneInput): string {
  const docPart = one.documents.map((d) => `${d.path}:${d.provenance.contentHash}`).join("|");
  const skipPart = one.skipped.map((s) => s.path).join(",");
  return sha256PrefixedText(`${docPart}||${skipPart}||${one.source.title}`);
}

function remapInput(one: OneInput, uniqueId: string): void {
  // Build BOTH id maps BEFORE mutating anything: old ids → new ids. Mutating
  // `document.id` first and then searching by the OLD id can never match.
  const sourceIdMap = new Map<string, string>();
  sourceIdMap.set(one.source.id, uniqueId);
  for (const child of one.childSources) {
    sourceIdMap.set(child.id, deriveId(child.kind, uniqueId, child.uri ?? ""));
  }
  const documentIdMap = new Map<string, string>();
  for (const d of one.documents) {
    const ns = sourceIdMap.get(d.sourceId);
    if (ns !== undefined) {
      documentIdMap.set(d.id, deriveId("doc", ns, d.path));
    }
  }

  // Apply the source-id map: SourceDocument.sourceId, UrlSnapshot.sourceId,
  // IngestionIssue.sourceId — and the Source objects themselves.
  for (const child of one.childSources) {
    const next = sourceIdMap.get(child.id);
    if (next !== undefined) child.id = next;
  }
  for (const d of one.documents) {
    const ns = sourceIdMap.get(d.sourceId);
    if (ns !== undefined) d.sourceId = ns;
    const nd = documentIdMap.get(d.id);
    if (nd !== undefined) d.id = nd;
  }
  for (const i of one.issues) {
    if (i.sourceId !== undefined) {
      const ns = sourceIdMap.get(i.sourceId);
      if (ns !== undefined) i.sourceId = ns;
    }
    if (i.documentId !== undefined) {
      const nd = documentIdMap.get(i.documentId);
      if (nd !== undefined) i.documentId = nd;
    }
  }
  if (one.urlSnapshot) {
    one.urlSnapshot.sourceId = uniqueId;
    const nd = documentIdMap.get(one.urlSnapshot.documentId);
    if (nd !== undefined) one.urlSnapshot.documentId = nd;
  }
  one.source = { ...one.source, id: uniqueId };
  if (one.discovery) one.discovery.source = one.source;
}

function collate(inputs: OneInput[]): IngestionResult {
  const sources: Source[] = [];
  const documents: SourceDocument[] = [];
  const discovery: IngestionResult["discovery"] = [];
  const skipped: SkippedInput[] = [];
  const issues: IngestionIssue[] = [];
  const urlSnapshots: UrlSnapshot[] = [];

  disambiguateCollisions(inputs);

  for (const one of inputs) {
    sources.push(one.source, ...one.childSources);
    documents.push(...one.documents);
    if (one.discovery !== undefined) discovery.push(one.discovery);
    skipped.push(...one.skipped);
    issues.push(...one.issues);
    if (one.urlSnapshot) urlSnapshots.push(one.urlSnapshot);
  }

  sources.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  documents.sort((a, b) =>
    a.sourceId === b.sourceId
      ? a.path < b.path
        ? -1
        : a.path > b.path
          ? 1
          : 0
      : a.sourceId < b.sourceId
        ? -1
        : 1,
  );
  skipped.sort((a, b) =>
    a.path === b.path ? (a.reason < b.reason ? -1 : 1) : a.path < b.path ? -1 : 1,
  );
  issues.sort((a, b) => {
    const k = (i: IngestionIssue) =>
      `${i.severity}${i.code}${i.sourceId ?? ""}${i.documentId ?? ""}${i.path ?? ""}${i.input ?? ""}${i.message}`;
    const ka = k(a);
    const kb = k(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  urlSnapshots.sort((a, b) => (a.sourceId < b.sourceId ? -1 : 1));

  return { sources, documents, discovery, skipped, issues, urlSnapshots };
}

/* ------------------------------------------------------------------ */
/* public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Synchronous filesystem ingestion (Phase 2 contract unchanged). Accepts the
 * same input shapes as `ingestInputs` but refuses URLs explicitly.
 */
export function ingest(
  inputs: string | readonly IngestionInput[],
  options: IngestionOptions = {},
): IngestionResult {
  const list: (string | { kind: "path"; path: string })[] = (
    Array.isArray(inputs) ? [...inputs] : [inputs]
  ).map((i) => {
    if (typeof i === "string" || i.kind === "path") return i;
    throw new DiscoveryError(
      "synchronous ingest() cannot fetch a URL — use ingestInputs() (Phase 8)",
      { code: "discovery/url-requires-async", severity: "fatal" },
    );
  }) as (string | { kind: "path"; path: string })[];
  const pending = list.map((i) => ingestPathSync(typeof i === "string" ? i : i.path, options));
  if (pending.some((p) => p.binaryPending.length > 0)) {
    throw new DiscoveryError(
      "synchronous ingest() cannot parse PDF/DOCX in Phase 8 — use ingestInputs()",
      { code: "discovery/binary-requires-async", severity: "fatal" },
    );
  }
  return collate(pending);
}

/**
 * Full Phase 8 ingestion: paths (incl. PDF/DOCX binaries) + URLs, async.
 */
export async function ingestInputs(
  inputs: IngestionInput | readonly IngestionInput[],
  options: IngestionOptions = {},
): Promise<IngestionResult> {
  const norm: IngestionInput[] = Array.isArray(inputs) ? [...inputs] : [inputs];

  const ones: OneInput[] = [];
  for (const input of norm) {
    if (typeof input === "string" || input.kind === "path") {
      const path = typeof input === "string" ? input : input.path;
      const one = ingestPathSync(path, options);
      for (const pending of one.binaryPending) {
        try {
          const parsed = await parseBinaryDocument(
            pending.source,
            pending.file.kind,
            pending.file.path,
            pending.file.bytes,
            one.issues,
          );
          one.documents.push(parsed);
        } catch (err) {
          // fail-soft per input: the binary document is skipped loudly; other
          // documents/inputs of this run continue.
          const message = (err as Error).message;
          const code = (err as { code?: string }).code ?? "ingestion/next-invalid";
          one.skipped.push({ path: pending.file.path, reason: "parse-error", detail: message });
          one.issues.push({
            code,
            severity: "fatal",
            message,
            sourceId: pending.source.id,
            path: pending.file.path,
          });
        }
      }
      ones.push(one);
    } else {
      ones.push(await ingestOneAsync(input, options));
    }
  }
  return collate(ones);
}
