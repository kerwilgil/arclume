/**
 * Source Evidence public surface (Slice 2B).
 *
 * Local, hermetic verification of Git source references — no network, no Git
 * hooks, no repo scripts, no reads outside the target tree. Produces a
 * `VERIFIED` / `UNVERIFIED` / `UNAVAILABLE` verdict with an auditable
 * `reasonCode`.
 */

export type {
  EvidenceVerdict,
  EvidenceReasonCode,
  GitEvidenceQuery,
  EvidenceChecked,
  EvidenceVerification,
  EvidenceRef,
} from "./types.js";
export {
  verifyGitEvidence,
  verifySourceRefEvidence,
  attachEvidence,
  isSafeRevision,
  countBlobLines,
  type SourceRefEvidenceOptions,
} from "./git-evidence.js";
export {
  inspectProjectKnowledge,
  type ClaimEvidenceItem,
  type EvidenceInspectorOptions,
  type EvidenceProof,
  type EvidenceSummary,
  type EvidenceVerificationStatus,
} from "./inspect.js";
