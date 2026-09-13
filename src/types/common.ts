/**
 * Shared type definitions for the Arclume Core.
 *
 * These types are a hand-maintained developer-ergonomics mirror of
 * `schemas/common.schema.json`. The JSON Schema is the single source of truth
 * for validation; these types exist so TypeScript callers get autocompletion
 * and compile-time checks. Keep the two in sync.
 */

/** Stable, human-authorable identifier: `^[A-Za-z][A-Za-z0-9_-]*$`, 1–128 chars. */
export type Id = string;

/** SemVer 2.0.0 core (with optional pre-release), e.g. `0.1.0`. */
export type SemVer = string;

/** RFC 3339 date-time. Only present when explicitly injected by a caller. */
export type IsoDateTime = string;

/** Free-form date as found in a source ("Q3 2026", "next sprint"). Not parsed in Phase 1. */
export type DateHint = string;

/** Lowercase hex SHA-256 prefixed with `sha256:`. */
export type ContentHash = string;

/** Git commit SHA, abbreviated (7) to full (40) hex. */
export type CommitSha = string;

/** Epistemic status of a statement. */
export type FactType = "FACT" | "INFERENCE" | "UNKNOWN" | "RECOMMENDATION";

/** Confidence in `[0, 1]`. */
export type Confidence = number;

/**
 * A pointer into a source. Discriminated by `kind`; designed to grow.
 * Every variant may also carry `commit` and `note`.
 */
export type Locator = FileLocator | PageLocator | UrlLocator | FragmentLocator | TextRangeLocator;

interface LocatorCommon {
  /** Git commit the locator is pinned to, when applicable. */
  commit?: CommitSha;
  /** Short human hint. */
  note?: string;
}

export interface FileLocator extends LocatorCommon {
  kind: "file";
  /** POSIX-style, source-root-relative path. No leading slash, no `..` segments. */
  path: string;
  lineStart?: number;
  lineEnd?: number;
}

export interface PageLocator extends LocatorCommon {
  kind: "page";
  page: number;
  pageEnd?: number;
}

export interface UrlLocator extends LocatorCommon {
  kind: "url";
  url: string;
}

export interface FragmentLocator extends LocatorCommon {
  kind: "fragment";
  /** Named section, heading path, or selector inside the source. */
  anchor: string;
}

export interface TextRangeLocator extends LocatorCommon {
  kind: "text-range";
  charStart: number;
  charEnd: number;
}

/** A reference from a statement back to a specific place in a source. */
export interface SourceRef {
  sourceId: Id;
  locator?: Locator;
  /** Verbatim excerpt supporting the reference. */
  quote?: string;
}

export type SourceKind =
  | "repo"
  | "directory"
  | "markdown"
  | "text"
  | "json"
  | "yaml"
  | "pdf"
  | "docx"
  | "url"
  | "other";

/** A material an Arclume artifact was derived from. */
export interface Source {
  id: Id;
  kind: SourceKind;
  title: string;
  /** Path or URL exactly as supplied. Not resolved by the Core. */
  uri?: string;
  hash?: ContentHash;
  mediaType?: string;
  retrievedAt?: IsoDateTime;
  note?: string;
}

/**
 * A statement with an explicit epistemic status.
 *
 * A claim whose `factType` is `FACT` MUST carry at least one resolvable
 * `sourceRef` — enforced by semantic validation, not by JSON Schema. Content
 * without sufficient evidence is never silently promoted to `FACT`.
 */
export interface Claim {
  id: Id;
  statement: string;
  factType: FactType;
  confidence?: Confidence;
  sourceRefs: SourceRef[];
  /** Ids of entities or other claims this claim provides evidence for. */
  supports?: Id[];
  note?: string;
}

/**
 * Deck-side vehicle that attaches source references (and optionally a
 * classification or a link to a knowledge `Claim`) to a slide or block.
 */
export interface Evidence {
  claimId?: Id;
  factType?: FactType;
  statement?: string;
  confidence?: Confidence;
  sourceRefs: SourceRef[];
}

export type RelationType =
  | "DEPENDS_ON"
  | "PART_OF"
  | "PRODUCES"
  | "CONSUMES"
  | "MITIGATES"
  | "OWNS"
  | "PRECEDES"
  | "MEASURES"
  | "IMPLEMENTS"
  | "THREATENS"
  | "DECIDES"
  | "USES_TECHNOLOGY"
  | "RESPONSIBLE_FOR"
  | "DERIVED_FROM"
  | "RELATES_TO";

/** A typed, directed, sourced edge between two entities. */
export interface Relation {
  id: Id;
  from: Id;
  to: Id;
  type: RelationType;
  label?: string;
  sourceRefs: SourceRef[];
}
