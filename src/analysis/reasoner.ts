/**
 * The Reasoner boundary.
 *
 * The Core never imports a model SDK. Analysis enters through this interface.
 * A Reasoner returns an {@link AnalysisResult} (candidates + evidence); it never
 * returns a `ProjectKnowledge`. The pipeline always runs the result through
 * schema validation and then the KnowledgeBuilder.
 */

import type { SourceDocumentKind } from "../ingestion/types.js";
import type { AnalysisResult } from "./analysis-result.js";

export interface ReasonerCapabilities {
  /** Stable identifier of this implementation, e.g. `stub`, `agent`. */
  id: string;
  /** SemVer of this implementation's behaviour. */
  version: string;
  /** True if `analyze` is a pure function of its request. */
  deterministic: boolean;
  /** True if `analyze` may perform network I/O. */
  network: boolean;
  /** Optional cap on the total request content size the impl will accept. */
  maxInputBytes?: number;
}

/** A trimmed, Reasoner-facing view of one ingested document. */
export interface ReasonerDocument {
  id: string;
  sourceId: string;
  path: string;
  kind: SourceDocumentKind;
  content: string;
  outline: unknown;
}

/** A trimmed view of one discovered file (included or skipped). */
export interface ReasonerFile {
  /** The `Source.id` this file was discovered under. Part of its identity: a
   *  bare `path` is not unique across multiple input roots. */
  sourceId: string;
  path: string;
  kind: string;
  included: boolean;
  byteLength: number;
}

export interface ReasonerRequest {
  sourceDigest: string;
  documents: ReasonerDocument[];
  files: ReasonerFile[];
  /**
   * Advisory only; a Reasoner may ignore these. They still affect the analysis
   * cache key: `focus` is treated as an unordered set (de-duplicated + sorted)
   * when the `analysisDigest` is computed.
   */
  hints?: {
    audience?: string;
    focus?: string[];
  };
}

export interface ReasonerResult {
  analysis: AnalysisResult;
  reasoner: { id: string; version: string };
  /** Optional, implementation-defined counters (tokens, ms, …). */
  usage?: Record<string, number>;
}

export interface Reasoner {
  readonly capabilities: ReasonerCapabilities;
  analyze(request: ReasonerRequest): Promise<ReasonerResult>;
}
