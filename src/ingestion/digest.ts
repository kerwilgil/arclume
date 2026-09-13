/**
 * Deterministic digest of an ingested source set.
 *
 * The digest is a pure function of each document's `sourceId`, `path`, `kind`
 * and normalized-content hash. Documents are sorted before hashing, so the
 * order in which discovery happened to find files does not affect the result.
 * Changing any file's content, adding or removing a file, changes the digest.
 */

import type { ReasonerFile } from "../analysis/reasoner.js";
import { contentHash } from "../determinism/hash.js";
import type { SourceDocument } from "./types.js";

/**
 * Schema version of {@link sourceDigest}. Phase 2 used `v = 1`, hashing only
 * `(sourceId, path, kind, contentHash)` per document. Phase 8 moves to `v = 2`:
 * it folds in the *outline* (layout evidence) and a deterministic inventory
 * of all discovered files (included or not), so a change in what the Reasoner
 * can see always invalidates the digest.
 */
const DIGEST_SCHEMA_VERSION = 2;

/** A Reasoner-visible file row as it participates in the digest. */
export interface SourceDigestFile {
  sourceId: string;
  path: string;
  kind: string;
  included: boolean;
  byteLength: number;
}

/**
 * Schema version of the {@link analysisDigest} cache key. Bumped to 2 when the
 * key started folding in analysis-affecting hints (audience / focus) in addition
 * to the reasoner identity; any pre-existing cached digest is intentionally
 * invalidated by the bump.
 */
const ANALYSIS_DIGEST_SCHEMA_VERSION = 2;

export function sourceDigest(
  documents: readonly SourceDocument[],
  files?: readonly ReasonerFile[] | readonly SourceDigestFile[],
): string {
  const docs = documents
    .map((d) => ({
      id: d.id,
      sourceId: d.sourceId,
      path: d.path,
      kind: d.kind,
      contentHash: d.provenance.contentHash,
      outlineHash: contentHash(d.outline),
    }))
    .sort((a, b) => {
      if (a.sourceId !== b.sourceId) return a.sourceId < b.sourceId ? -1 : 1;
      return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
    });
  const fileRows = (files ?? [])
    .map((f) => ({
      sourceId: f.sourceId,
      path: f.path,
      kind: f.kind,
      included: f.included,
      byteLength: f.byteLength,
    }))
    .sort((a, b) => {
      if (a.sourceId !== b.sourceId) return a.sourceId < b.sourceId ? -1 : 1;
      return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
    });
  if (fileRows.length === 0) {
    return contentHash({ v: DIGEST_SCHEMA_VERSION, documents: docs });
  }
  return contentHash({ v: DIGEST_SCHEMA_VERSION, documents: docs, files: fileRows });
}

export interface AnalysisDigestInput {
  sourceDigest: string;
  reasoner: { id: string; version: string };
  /**
   * Any analysis-affecting configuration. Everything a Reasoner can read from
   * the `ReasonerRequest` and let change its output must appear here, already
   * canonicalized by the caller (see {@link canonicalAnalysisConfig}). Two runs
   * with the same effective config must pass a byte-identical object.
   */
  config?: Record<string, unknown>;
}

/**
 * Cache key for an analysis: the source digest plus the reasoner identity and
 * the canonicalized analysis configuration (advisory hints included). Folding in
 * the hints closes a cache-collision hole where the same source + reasoner but a
 * different `audience` / `focus` returned a stale analysis.
 */
export function analysisDigest(input: AnalysisDigestInput): string {
  return contentHash({
    v: ANALYSIS_DIGEST_SCHEMA_VERSION,
    kind: "analysis-digest",
    sourceDigest: input.sourceDigest,
    reasoner: input.reasoner,
    config: input.config ?? {},
  });
}

/**
 * Canonical, order-independent view of the analysis-affecting request config.
 *
 * `audience` is a free-text scalar. `focus` is treated as a **set** of topic
 * hints: it is de-duplicated and sorted, so `["a","b"]` and `["b","a","a"]`
 * produce the same digest. If `focus` ever needs to be an ordered sequence this
 * function (and the digest version) must change deliberately.
 */
export function canonicalAnalysisConfig(hints: {
  audience?: string;
  focus?: string[];
}): { hints: { audience: string; focus: string[] } } {
  return {
    hints: {
      audience: hints.audience ?? "",
      focus: [...new Set(hints.focus ?? [])].sort(),
    },
  };
}
