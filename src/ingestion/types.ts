/**
 * Ingestion types: what discovery finds, what a parsed document looks like, and
 * the options that bound the whole stage.
 *
 * `SourceDocument` is the normalized, serializable, Reasoner-independent unit
 * that flows out of ingestion. It is always traceable back to a Phase 1
 * `Source` (via `sourceId`) and to an exact place inside it (via `path` +
 * per-outline line numbers).
 */

import type { Source } from "../types/common.js";
import type { UrlTransport } from "./url-transport.js";

export type SourceDocumentKind = "markdown" | "text" | "json" | "yaml" | "pdf" | "docx" | "url";

/** Why a discovered file was not turned into a `SourceDocument`. */
export type SkipReason =
  | "ignored" // matched a .gitignore rule
  | "denylisted" // matched Arclume's own security denylist directory
  | "sensitive" // name looks like a secret / credential file
  | "binary" // content is not text
  | "too-large" // exceeds maxFileBytes
  | "total-budget" // would exceed maxTotalBytes
  | "too-deep" // exceeds maxDepth
  | "too-many" // exceeds maxFiles
  | "unsupported" // extension not in the MVP set
  | "outside-root" // resolved outside the input root
  | "symlink" // a symbolic link (never followed)
  | "parse-error" // the file could not be parsed as its declared kind
  | "unreadable"; // an IO error while reading

export interface SkippedInput {
  /** POSIX, root-relative path (best effort for outside-root / symlink cases). */
  path: string;
  reason: SkipReason;
  detail?: string;
}

export interface DiscoveredFile {
  /** POSIX, root-relative. */
  path: string;
  kind: SourceDocumentKind | "unsupported" | "binary";
  byteLength: number;
  included: boolean;
}

export interface DiscoveryResult {
  /** The Phase 1 Source this traversal produced (repo or directory). */
  source: Source;
  /** Absolute, normalized root that was walked. */
  rootAbsPath: string;
  files: DiscoveredFile[];
  skipped: SkippedInput[];
}

export interface SourceDocumentMetadata {
  title?: string;
  language?: string;
  headings?: string[];
  byteLength: number;
  lineCount: number;
  pageCount?: number;
  finalUrl?: string;
  httpStatus?: number;
}

/**
 * A URL-derived snapshot. It carries acquisition identity (`requestedUrl` →
 * `finalUrl`, status, MIME) and content identity (`bodyHash`), never a clock.
 */
export interface UrlSnapshot {
  sourceId: string;
  documentId: string;
  requestedUrl: string;
  normalizedRequestedUrl: string;
  finalUrl: string;
  mediaType: string;
  httpStatus: number;
  /** `sha256:<64hex>` of the response body bytes. */
  bodyHash: string;
  bodyBytes: number;
  parserVersion: string;
}

/** A stage-local note raised during ingestion that is NOT a hard skip. */
export type IngestionIssueSeverity = "warning" | "gap" | "fatal";

export interface IngestionIssue {
  code: string;
  severity: IngestionIssueSeverity;
  message: string;
  sourceId?: string;
  documentId?: string;
  path?: string;
  input?: string;
  detail?: string;
}

export interface SourceDocumentProvenance {
  /** `sha256:` of the raw bytes as read from disk. */
  sourceHash: string;
  /** `sha256:` of the normalized `content` (LF endings, no BOM). */
  contentHash: string;
}

export interface MarkdownSection {
  heading: string;
  depth: number;
  /** 1-based line of the heading. */
  line: number;
  /** 1-based line of the last line belonging to this section. */
  endLine: number;
}

export interface MarkdownCodeBlock {
  lang?: string;
  line: number;
  endLine: number;
}

export interface MarkdownLink {
  text: string;
  url: string;
  line: number;
}

export interface MarkdownOutline {
  kind: "markdown";
  title?: string;
  sections: MarkdownSection[];
  codeBlocks: MarkdownCodeBlock[];
  links: MarkdownLink[];
}

export interface StructuredOutline {
  kind: "json" | "yaml";
  /** Dotted key paths present in the parsed value (bounded). */
  keyPaths: string[];
  /** True when the top-level parsed value is a plain object. */
  rootIsObject: boolean;
}

export interface TextOutline {
  kind: "text";
  lineCount: number;
}

/** One page of a PDF, and its exact line span in the normalized content. */
export interface PdfPageLineRange {
  page: number;
  lineStart?: number;
  lineEnd?: number;
}

export interface PdfOutline {
  kind: "pdf";
  pages: number;
  /** Exactly `pages` entries, pages 1..pages, strictly ordered, non-overlapping. */
  pageRanges: PdfPageLineRange[];
  hasTextLayer: boolean;
}

/** A deterministic line-range anchor (paragraph/table cell/heading span). */
export interface DocumentLineFragment {
  anchor: string;
  lineStart: number;
  lineEnd: number;
}

export interface DocxOutline {
  kind: "docx";
  fragments: DocumentLineFragment[];
  paragraphCount: number;
  tableCount: number;
}

export interface UrlOutline {
  kind: "url";
  title?: string;
  headings: Array<{ text: string; depth: number; line: number }>;
  fragments?: DocumentLineFragment[];
  finalUrl: string;
}

export type DocumentOutline =
  | MarkdownOutline
  | StructuredOutline
  | TextOutline
  | PdfOutline
  | DocxOutline
  | UrlOutline;

export interface SourceDocument {
  /** Deterministic: derived from `sourceId` + `path`. */
  id: string;
  sourceId: string;
  kind: SourceDocumentKind;
  /** POSIX, source-root-relative. */
  path: string;
  mediaType: string;
  /** Normalized UTF-8 text: LF line endings, no BOM. */
  content: string;
  metadata: SourceDocumentMetadata;
  provenance: SourceDocumentProvenance;
  outline: DocumentOutline;
}

export interface SafetyLimits {
  maxFiles: number;
  /** md/txt/json/yaml (unchanged Phase 2 budget). */
  maxTextFileBytes: number;
  maxPdfBytes: number;
  maxDocxBytes: number;
  maxTotalBytes: number;
  maxDepth: number;
  /**
   * Deprecated alias for `maxTextFileBytes`, accepted for compatibility with
   * Phase 2 callers.
   */
  maxFileBytes?: number;
}

export const DEFAULT_SAFETY_LIMITS: SafetyLimits = {
  maxFiles: 4000,
  maxTextFileBytes: 2 * 1024 * 1024, // 2 MiB
  maxPdfBytes: 32 * 1024 * 1024, // 32 MiB
  maxDocxBytes: 32 * 1024 * 1024, // 32 MiB
  maxTotalBytes: 64 * 1024 * 1024, // 64 MiB
  maxDepth: 24,
};

/** Per-kind per-file byte gate, applied to stat() before any read. */
export function maxFileBytesForKind(limits: SafetyLimits, kind: SourceDocumentKind): number {
  switch (kind) {
    case "pdf":
      return limits.maxPdfBytes;
    case "docx":
      return limits.maxDocxBytes;
    default:
      return limits.maxTextFileBytes;
  }
}

/** Path or URL input. Plain strings stay filesystem paths — no magic URL sniffing. */
export type IngestionInput = string | { kind: "path"; path: string } | { kind: "url"; url: string };

export interface UrlIngestionOptions {
  timeoutMs?: number;
  maxRedirects?: number;
  maxCompressedBytes?: number;
  maxDecompressedBytes?: number;
  maxHeaderBytes?: number;
  maxHtmlNodes?: number;
  maxExtractedChars?: number;
  maxTableCells?: number;
  /**
   * Test-only injection of the transport/DNS boundary. The security policy is
   * NOT configurable; this boundary only substitutes the wire.
   */
  transport?: UrlTransport;
}

export interface IngestionOptions {
  limits?: Partial<SafetyLimits>;
  /** Extra ignore globs, applied on top of .gitignore + the built-in denylist. */
  extraIgnore?: string[];
  /** When false, a present `.gitignore` is not consulted. Default true. */
  respectGitignore?: boolean;
  /**
   * Explicit id for the produced `Source`. When omitted, a deterministic id is
   * derived from the root basename (portable, but two roots sharing a basename
   * would collide — pass this for multi-input runs).
   */
  sourceId?: string;
  /** URL acquisition policy (applied only to `{kind:"url"}` inputs). */
  url?: UrlIngestionOptions;
}

export interface IngestionResult {
  sources: Source[];
  documents: SourceDocument[];
  discovery: DiscoveryResult[];
  skipped: SkippedInput[];
  issues: IngestionIssue[];
  urlSnapshots: UrlSnapshot[];
}
