/**
 * Evidence Inspector — the deterministic, presentation-friendly view of
 * every claim and risk in a `ProjectKnowledge` with verification status.
 *
 * This is a *read* model: it never spawns git per render, never mutates the
 * knowledge, and never introduces a new verification path. It reuses
 * `verifySourceRefEvidence` — the same hermetic Git verifier the Core already
 * carries — so a claim that the Core marks VERIFIED on the CLI reads the same
 * way here.
 *
 * Performance: computed once per (knowledgeHash) on demand and cached. The web
 * layer is expected to hold the result for the workspace; this module's job is
 * to produce the payload deterministically at one point in time, not on every
 * fetch.
 */

import type { FactType, SourceRef } from "../types/common.js";
import type { ProjectKnowledge } from "../types/knowledge.js";
import { verifySourceRefEvidence } from "./git-evidence.js";
import type { EvidenceVerification } from "./types.js";

export type EvidenceVerificationStatus = "verified" | "unverified" | "unavailable";

/** A single reviewable piece of evidence on a claim (or a risk). */
export interface EvidenceProof {
  sourceId: string;
  /** Relative POSIX path inside the source (only for file locators). */
  path?: string;
  lineStart?: number;
  lineEnd?: number;
  commit?: string;
  quote?: string;
  locatorKind?: string;
  /** Git-verifier verdict for this ref. "unavailable" when no repo was given. */
  verification: EvidenceVerificationStatus;
  /** Stable reason code from the verifier (e.g. `verified`, `path-missing`). */
  reasonCode?: string;
  /** Verbatim excerpt from the verification detail, if any. */
  detail?: string;
}

export interface ClaimEvidenceItem {
  id: string;
  statement: string;
  factType: FactType;
  /** Rollup of `proofs`: the best attainable status. */
  verification: EvidenceVerificationStatus;
  proofs: EvidenceProof[];
}

export interface EvidenceSummary {
  claims: ClaimEvidenceItem[];
  risks: ClaimEvidenceItem[];
  counts: {
    claims: number;
    risks: number;
    verifiedRefs: number;
    unverifiedRefs: number;
    unavailableRefs: number;
  };
}

export interface EvidenceInspectorOptions {
  /** The directory (or parent dir of a file) to verify file locators against. */
  repoRoot?: string;
  /** Revision to assume when a locator carries no commit. */
  fallbackRevision?: string;
}

function locatorSummary(ref: SourceRef): {
  path?: string;
  lineStart?: number;
  lineEnd?: number;
  commit?: string;
  locatorKind?: string;
} {
  const loc = ref.locator;
  const out: {
    path?: string;
    lineStart?: number;
    lineEnd?: number;
    commit?: string;
    locatorKind?: string;
  } = {};
  if (!loc || typeof loc !== "object") return out;
  if (loc.kind === "file") {
    if (typeof loc.path === "string") out.path = loc.path;
    if (typeof loc.lineStart === "number") out.lineStart = loc.lineStart;
    if (typeof loc.lineEnd === "number") out.lineEnd = loc.lineEnd;
  }
  const commit = (loc as { commit?: string }).commit;
  if (typeof commit === "string") out.commit = commit;
  const kind = (loc as { kind?: string }).kind;
  if (typeof kind === "string") out.locatorKind = kind;
  return out;
}

function aggregateStatus(refs: readonly EvidenceVerification[]): EvidenceVerificationStatus {
  if (refs.length === 0) return "unavailable";
  const verdicts = refs.map((r) => r.verdict);
  if (verdicts.some((v) => v === "VERIFIED")) return "verified";
  if (verdicts.some((v) => v === "UNVERIFIED")) return "unverified";
  return "unavailable";
}

export function inspectProjectKnowledge(
  knowledge: ProjectKnowledge,
  options: EvidenceInspectorOptions = {},
): EvidenceSummary {
  const claims: ClaimEvidenceItem[] = [];
  let verifiedRefs = 0;
  let unverifiedRefs = 0;
  let unavailableRefs = 0;

  const inspect = (
    id: string,
    statement: string,
    factType: FactType,
    sourceRefs: readonly SourceRef[],
  ): ClaimEvidenceItem => {
    const verifications: EvidenceVerification[] = [];
    const proofs: EvidenceProof[] = [];
    for (const ref of sourceRefs) {
      const v: EvidenceVerification = options.repoRoot
        ? verifySourceRefEvidence(ref, {
            repoRoot: options.repoRoot,
            ...(options.fallbackRevision !== undefined
              ? { fallbackRevision: options.fallbackRevision }
              : {}),
          })
        : // No repo root to check against: the locator is not a file locator we
          // can prove, so the best we can say is "unavailable".
          {
            verdict: "UNAVAILABLE",
            reasonCode: "repo-missing",
            detail: "no local repo is available to verify this source ref",
            checked: { repoRoot: options.repoRoot ?? "" },
          };
      verifications.push(v);
      if (v.verdict === "VERIFIED") verifiedRefs += 1;
      else if (v.verdict === "UNVERIFIED") unverifiedRefs += 1;
      else unavailableRefs += 1;
      const { path, lineStart, lineEnd, commit, locatorKind } = locatorSummary(ref);
      const proof: EvidenceProof = {
        sourceId: ref.sourceId,
        verification:
          v.verdict === "VERIFIED"
            ? "verified"
            : v.verdict === "UNVERIFIED"
              ? "unverified"
              : "unavailable",
        reasonCode: v.reasonCode,
        detail: v.detail,
      };
      if (path !== undefined) proof.path = path;
      if (lineStart !== undefined) proof.lineStart = lineStart;
      if (lineEnd !== undefined) proof.lineEnd = lineEnd;
      if (commit !== undefined) proof.commit = commit;
      if (ref.quote !== undefined) proof.quote = ref.quote.slice(0, 300);
      if (locatorKind !== undefined) proof.locatorKind = locatorKind;
      proofs.push(proof);
    }
    return {
      id,
      statement,
      factType,
      verification: aggregateStatus(verifications),
      proofs,
    };
  };

  for (const c of knowledge.claims ?? []) {
    claims.push(inspect(c.id, c.statement, c.factType, c.sourceRefs));
  }
  const risks: ClaimEvidenceItem[] = [];
  for (const r of knowledge.risks ?? []) {
    risks.push(inspect(r.id, r.statement, r.factType, r.sourceRefs));
  }

  return {
    claims,
    risks,
    counts: {
      claims: claims.length,
      risks: risks.length,
      verifiedRefs,
      unverifiedRefs,
      unavailableRefs,
    },
  };
}
