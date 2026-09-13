/**
 * URL ingestion (Phase 8) — acquisition with streaming, bounded byte budgets.
 *
 * Never buffers an unbounded response: each body chunk is counted BEFORE it is
 * accepted, and decompression happens by streaming zlib with its own byte
 * counter. A violation aborts immediately — it does not materialize the
 * payload and THEN measure it.
 *
 *  - acquisition is inherently non-deterministic; everything downstream is
 *    deterministic over the captured bytes;
 *  - no cookies, no Authorization forwarding, no proxies, no downgrades;
 *  - DNS pin: the socket connects EXACTLY to a validated address;
 *  - identity: never a clock.
 */

import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { Transform as TransformPass } from "node:stream";
import * as zlib from "node:zlib";
import { IngestionError } from "../errors.js";
import { deriveId } from "../knowledge/ids.js";
import type { Source } from "../types/common.js";
import { countLines, normalizeText } from "./binary.js";
import { parseDocx } from "./docx.js";
import { parseDocument } from "./parsers.js";
import { parsePdf } from "./pdf.js";
import type {
  IngestionIssue,
  SkippedInput,
  SourceDocument,
  SourceDocumentKind,
  UrlSnapshot,
} from "./types.js";
import { assertAllAddressesAllowed, normalizeRequestedUrl } from "./url-security.js";
import {
  DEFAULT_URL_LIMITS,
  type UrlLimits,
  type UrlTransport,
  createDefaultTransport,
  resolveUrlLimits,
} from "./url-transport.js";

export const URL_INGESTION_VERSION = "0.1.0";

export type { UrlLimits, UrlTransport };
export { DEFAULT_URL_LIMITS, resolveUrlLimits };

/* ------------------------------------------------------------------ */
/* errors                                                              */
/* ------------------------------------------------------------------ */

function fail(code: string, message: string): never {
  throw new IngestionError(message, { code, severity: "fatal" });
}

/* ------------------------------------------------------------------ */
/* bounded streaming body reading                                      */
/* ------------------------------------------------------------------ */

/**
 * Read a streaming body with both budgets enforced while data flows.
 *
 *      source chunks
 *        → compressedByte counter (hard cap)
 *        → streaming inflate (when encoded)
 *        → decompressedByte counter (hard cap)
 *
 * A violation aborts immediately; nothing downstream materializes the payload.
 */
export async function readBoundedBody(
  body: AsyncIterable<Uint8Array>,
  encoding: string,
  limits: UrlLimits,
): Promise<Buffer> {
  const enc = encoding.toLowerCase().trim();
  let decoder: NodeJS.ReadWriteStream | null = null;
  if (enc === "gzip" || enc === "x-gzip") decoder = zlib.createGunzip();
  else if (enc === "deflate") decoder = zlib.createInflate();
  else if (enc === "br") decoder = zlib.createBrotliDecompress();
  else if (enc === "" || enc === "identity") decoder = null;
  else fail("ingestion/unsupported-media-type", `unsupported Content-Encoding "${enc}"`);

  // Stream: source → compressed counter → decoder → decompressed counter → collect.
  const compressed = counterTransform(limits.maxCompressedBytes, "compressed");
  const decompressed = counterTransform(limits.maxDecompressedBytes, "decompressed");
  const src = Readable.from(body);

  const end =
    decoder === null
      ? src.pipe(compressed).pipe(decompressed)
      : src.pipe(compressed).pipe(decoder).pipe(decompressed);

  const parts: Buffer[] = [];
  try {
    for await (const chunk of end) {
      parts.push(chunk as Buffer);
    }
  } finally {
    src.destroy();
    if (decoder !== null) {
      const d = decoder as unknown as { destroy?: () => void };
      if (typeof d.destroy === "function") d.destroy();
    }
  }
  return Buffer.concat(parts);
}

/** A Transform that hard-fails the stream when a byte budget is exceeded. */
function counterTransform(maxBytes: number, label: string) {
  let total = 0;
  return new TransformPass({
    transform(chunk: Buffer, _enc, cb) {
      total += chunk.length;
      if (total > maxBytes) {
        cb(
          new IngestionError(
            `${label} body exceeds ${maxBytes} bytes (budget enforced while streaming)`,
            { code: "ingestion/url-too-large" },
          ),
        );
        return;
      }
      cb(null, chunk);
    },
  });
}

/* ------------------------------------------------------------------ */
/* acquisition                                                         */
/* ------------------------------------------------------------------ */

async function fetchHop(
  rawUrl: string,
  limits: UrlLimits,
  transport: UrlTransport,
): Promise<{
  finalUrl: string;
  status: number;
  mediaType: string;
  contentType: string;
  body: Buffer;
  issues: IngestionIssue[];
}> {
  let current = normalizeRequestedUrl(rawUrl);
  const seen = new Set<string>([current]);
  for (let hop = 0; hop <= limits.maxRedirects; hop += 1) {
    const url = new URL(current);
    const host = url.hostname;
    if (url.username !== "" || url.password !== "") {
      fail("ingestion/url-invalid", "credentials in URL are rejected");
    }
    const answers = await transport.resolve(host);
    assertAllAddressesAllowed(answers, host);
    const sorted = [...answers].sort();
    const pinned = sorted[0] as string;

    const head = await transport.request({
      url,
      address: pinned,
      timeoutMs: limits.timeoutMs,
      maxHeaderBytes: limits.maxHeaderBytes,
    });

    const status = head.status;
    const location = head.headers["location"];
    const isRedirect = typeof location === "string" && status >= 300 && status < 400;
    if (isRedirect) {
      const locs = Array.isArray(location) ? location[0] : location;
      if (locs === undefined) fail("ingestion/url-redirect-blocked", "redirect without Location");
      const next = normalizeRequestedUrl(new URL(locs as string, current).href);
      if (new URL(current).protocol === "https:" && new URL(next).protocol === "http:") {
        fail("ingestion/url-redirect-blocked", "https→http downgrade");
      }
      if (seen.has(next)) fail("ingestion/url-redirect-blocked", `redirect loop at ${next}`);
      seen.add(next);
      current = next;
      continue;
    }
    if (status < 200 || status >= 300) {
      fail("ingestion/url-invalid", `HTTP ${status}`);
    }
    const lenHeader = head.headers["content-length"];
    if (typeof lenHeader === "string") {
      const n = Number(lenHeader);
      if (Number.isFinite(n) && n > limits.maxCompressedBytes) {
        fail("ingestion/url-too-large", `Content-Length ${n} exceeds ${limits.maxCompressedBytes}`);
      }
    }

    const encoding = readHeaderString(head.headers, "content-encoding");
    const body = await readBoundedBody(head.body, encoding, limits);
    return {
      finalUrl: current,
      status,
      mediaType:
        readHeaderString(head.headers, "content-type").split(";")[0]?.trim().toLowerCase() ?? "",
      contentType: readHeaderString(head.headers, "content-type"),
      body,
      issues: [],
    };
  }
  fail("ingestion/url-redirect-blocked", `redirect chain exceeded ${limits.maxRedirects}`);
}

function readHeaderString(
  headers: Record<string, string | string[] | undefined>,
  key: string,
): string {
  const v = headers[key];
  if (Array.isArray(v)) return v[0] ?? "";
  return typeof v === "string" ? v : "";
}

/* ------------------------------------------------------------------ */
/* content dispatch                                                    */
/* ------------------------------------------------------------------ */

interface Dispatched {
  kind: SourceDocumentKind;
  content: string;
  outline: unknown;
  issues: IngestionIssue[];
}

async function dispatchContent(
  mediaType: string,
  body: Buffer,
  finalUrl: string,
  limits: UrlLimits,
): Promise<Dispatched> {
  if (mediaType === "application/pdf") {
    const pdf = await parsePdf(new Uint8Array(body));
    return { kind: "pdf", content: pdf.content, outline: pdf.outline, issues: pdf.issues };
  }
  if (mediaType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    const d = parseDocx(new Uint8Array(body));
    return { kind: "docx", content: d.content, outline: d.outline, issues: d.issues };
  }
  if (mediaType === "application/json") {
    const text = normalizeText(body.toString("utf8"));
    const p = parseDocument("json", text, "snapshot");
    return { kind: "url", content: p.content, outline: p.outline, issues: [] };
  }
  if (mediaType === "text/plain") {
    return {
      kind: "url",
      content: normalizeText(body.toString("utf8")),
      outline: { kind: "url", finalUrl, headings: [], fragments: [] },
      issues: [],
    };
  }
  if (mediaType === "text/html" || mediaType === "") {
    const html = body.toString("utf8");
    const extracted = extractHtml(html, finalUrl, limits);
    return { kind: "url", content: extracted.content, outline: extracted.outline, issues: [] };
  }
  fail("ingestion/unsupported-media-type", `unsupported media type "${mediaType}"`);
}

/* ------------------------------------------------------------------ */
/* HTML extraction (parse5)                                            */
/* ------------------------------------------------------------------ */

import { parse as parseHtml } from "parse5";
import type { DefaultTreeAdapterMap } from "parse5";

type HtmlNode = DefaultTreeAdapterMap["node"];
type HtmlElement = DefaultTreeAdapterMap["element"];

const SKIP_TAGS = new Set([
  "script",
  "style",
  "noscript",
  "template",
  "iframe",
  "object",
  "embed",
  "head",
  "svg",
  "math",
]);

const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

interface HtmlState {
  lines: string[];
  headings: Array<{ text: string; depth: number; line: number }>;
  nodes: number;
  tableCells: number;
  chars: number;
  limits: UrlLimits;
}

function nodeText(el: HtmlElement, acc: string[]): void {
  for (const child of (el.childNodes ?? []) as HtmlNode[]) {
    if (child.nodeName === "#text") {
      const v = (child as unknown as { value?: string }).value ?? "";
      const norm = v.replace(/\s+/g, " ");
      if (norm.trim().length > 0) acc.push(norm);
    } else {
      nodeText(child as HtmlElement, acc);
    }
  }
}

function walkDom(node: HtmlNode, state: HtmlState): void {
  const el = node as HtmlElement;
  const tag = el.tagName as string | undefined;
  if (tag !== undefined) {
    if (SKIP_TAGS.has(tag)) return;
    state.nodes += 1;
    if (state.nodes > state.limits.maxHtmlNodes) {
      fail("ingestion/resource-limit", `HTML exceeds ${state.limits.maxHtmlNodes} nodes`);
    }
    if (tag === "td" || tag === "th") {
      state.tableCells += 1;
      if (state.tableCells > state.limits.maxTableCells) {
        fail("ingestion/resource-limit", `HTML table exceeds ${state.limits.maxTableCells} cells`);
      }
    }
    if (HEADING_TAGS.has(tag)) {
      const acc: string[] = [];
      nodeText(el, acc);
      const text = acc.join(" ").replace(/\s+/g, " ").trim();
      if (text.length > 0) {
        const depth = Number(tag.slice(1));
        state.headings.push({ text, depth, line: state.lines.length + 1 });
        state.lines.push(text);
      }
      return;
    }
    if (tag === "p" || tag === "li" || tag === "blockquote" || tag === "pre") {
      const acc: string[] = [];
      nodeText(el, acc);
      const text = acc.join(" ").replace(/\s+/g, " ").trim();
      if (text.length > 0) {
        state.lines.push(text);
        state.chars += text.length;
        if (state.chars > state.limits.maxExtractedChars) {
          fail(
            "ingestion/resource-limit",
            `HTML text exceeds ${state.limits.maxExtractedChars} characters`,
          );
        }
      }
      return;
    }
    if (tag === "td" || tag === "th") {
      const acc: string[] = [];
      nodeText(el, acc);
      const t = acc.join(" ").replace(/\s+/g, " ").trim();
      if (t.length > 0) {
        state.lines.push(t);
      }
      return;
    }
  }
  const children = (el.childNodes ?? []) as HtmlNode[];
  for (const child of children) walkDom(child, state);
}

function extractHtml(
  html: string,
  finalUrl: string,
  limits: UrlLimits,
): {
  content: string;
  outline: {
    kind: "url";
    finalUrl: string;
    headings: Array<{ text: string; depth: number; line: number }>;
    fragments: Array<{ anchor: string; lineStart: number; lineEnd: number }>;
  };
} {
  const doc = parseHtml(html);
  const state: HtmlState = { lines: [], headings: [], nodes: 0, tableCells: 0, chars: 0, limits };
  walkDom(doc, state);
  const fragments: Array<{ anchor: string; lineStart: number; lineEnd: number }> = [];
  const sortedHeadings = [...state.headings].sort((a, b) => a.line - b.line);
  for (let i = 0; i < sortedHeadings.length; i += 1) {
    const h = sortedHeadings[i];
    if (!h) continue;
    const next = sortedHeadings[i + 1];
    fragments.push({
      anchor: `h/${i + 1}`,
      lineStart: h.line,
      lineEnd: (next ? next.line - 1 : state.lines.length) || h.line,
    });
  }
  return {
    content: normalizeText(state.lines.join("\n")),
    outline: { kind: "url", finalUrl, headings: state.headings, fragments },
  };
}

/* ------------------------------------------------------------------ */
/* public entry                                                        */
/* ------------------------------------------------------------------ */

export interface UrlIngestOutcome {
  source: Source;
  documents: SourceDocument[];
  snapshot: UrlSnapshot;
  issues: IngestionIssue[];
  skipped: SkippedInput[];
}

/** Acquisition → snapshot → deterministic parse. Async and network-bound. */
export async function ingestUrl(
  rawUrl: string,
  transport: UrlTransport = createDefaultTransport(),
  overrides?: Partial<UrlLimits>,
): Promise<UrlIngestOutcome> {
  const limits = resolveUrlLimits(overrides);
  const normalizedRequestedUrl = normalizeRequestedUrl(rawUrl);
  const hop = await fetchHop(normalizedRequestedUrl, limits, transport);
  const mediaType = hop.mediaType;
  const bodyHash = `sha256:${createHash("sha256").update(hop.body).digest("hex")}`;

  const source: Source = {
    id: deriveId("url", normalizedRequestedUrl),
    kind: "url",
    title: new URL(hop.finalUrl).hostname, // cosmetic only; identity lives in the id/hash
    uri: rawUrl,
    hash: bodyHash,
    mediaType: mediaType === "" ? "text/html" : mediaType,
  };

  const dispatched = await dispatchContent(mediaType, hop.body, hop.finalUrl, limits);
  const content = dispatched.content;
  const lineCount = countLines(content);
  const document: SourceDocument = {
    id: deriveId("doc", source.id, "snapshot"),
    sourceId: source.id,
    kind: dispatched.kind,
    path: "snapshot",
    mediaType: mediaType === "" ? "text/html" : mediaType,
    content,
    metadata: {
      byteLength: hop.body.length,
      lineCount,
      finalUrl: hop.finalUrl,
      httpStatus: hop.status,
    },
    provenance: {
      sourceHash: bodyHash,
      contentHash: `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`,
    },
    outline: dispatched.outline as SourceDocument["outline"],
  };

  const snapshot: UrlSnapshot = {
    sourceId: source.id,
    documentId: document.id,
    requestedUrl: rawUrl,
    normalizedRequestedUrl,
    finalUrl: hop.finalUrl,
    mediaType: document.mediaType,
    httpStatus: hop.status,
    bodyHash,
    bodyBytes: hop.body.length,
    parserVersion: URL_INGESTION_VERSION,
  };

  const issues: IngestionIssue[] = [];
  for (const issue of dispatched.issues) {
    issues.push({ ...issue, sourceId: source.id, documentId: document.id, input: rawUrl });
  }
  if (content.trim().length === 0) {
    issues.push({
      code: "ingestion/url-empty-content",
      severity: "gap",
      message: "the fetched document produced no extractable text",
      sourceId: source.id,
      documentId: document.id,
      input: rawUrl,
    });
  }

  return { source, documents: [document], snapshot, issues, skipped: [] };
}
