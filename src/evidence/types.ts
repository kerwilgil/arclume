/**
 * Source Evidence contracts (Visual + Narrative Intelligence, Slice 2B).
 *
 * A *verifiable* source reference points at a concrete place in a Git
 * repository: a source-root-relative POSIX path, an optional 1-based inclusive
 * line range, and the revision (commit SHA or a restricted ref) the range is
 * pinned to. `verifyGitEvidence` checks that reference **locally and
 * hermetically** — no network, no Git hooks, no repo scripts, no reads outside
 * the target tree — and returns one of three verdicts:
 *
 *  - `VERIFIED`    — the repo, the revision, the file at that revision and the
 *                    line range all exist and are internally consistent.
 *  - `UNVERIFIED`  — the reference is well-formed but something it names does
 *                    not check out (unknown revision, missing file, a line
 *                    range past the end of the file, an unsafe path …).
 *  - `UNAVAILABLE` — verification could not run at all (no repo, `git` missing,
 *                    a timeout). The reference is neither confirmed nor denied.
 *
 * The verifier never invents a commit, a file or a line count: every value in
 * `EvidenceVerification.checked` is echoed back from Git output or the input,
 * never synthesised.
 */

import type { CommitSha, SourceRef } from "../types/common.js";

export type EvidenceVerdict = "VERIFIED" | "UNVERIFIED" | "UNAVAILABLE";

/**
 * Auditable, closed set of reasons a verification reached its verdict. Stable
 * slugs — safe to switch on, log and assert in tests. Never a free-form string.
 */
export type EvidenceReasonCode =
  // VERIFIED
  | "verified"
  // UNVERIFIED — the reference is well-formed but does not check out
  | "revision-unsafe"
  | "revision-missing"
  | "locator-not-file"
  | "locator-missing"
  | "path-unsafe"
  | "path-missing"
  | "path-not-blob"
  | "line-range-invalid"
  | "line-range-out-of-bounds"
  // UNAVAILABLE — verification could not run
  | "repo-missing"
  | "repo-not-git"
  | "git-unavailable"
  | "git-timeout"
  | "git-error";

/** A source reference resolved to the concrete inputs a Git check needs. */
export interface GitEvidenceQuery {
  /** Absolute path to the repository working tree (trusted, caller-supplied). */
  repoRoot: string;
  /** Source-root-relative POSIX path. Validated with `isSafeRelativeLocatorPath`. */
  path: string;
  /** Commit SHA (7–64 hex) or a restricted ref name. Never an expression. */
  revision: string;
  /** 1-based, inclusive. Omit both to verify only that the file exists. */
  lineStart?: number;
  lineEnd?: number;
}

/** What the verifier actually confirmed — echoed from Git / the query, never faked. */
export interface EvidenceChecked {
  repoRoot: string;
  /** The revision string as supplied. */
  revision?: string;
  /** The full 40-hex commit the revision resolved to, when it resolved. */
  commit?: CommitSha;
  /** The safe relative path that was looked up. */
  path?: string;
  lineStart?: number;
  lineEnd?: number;
  /** Total lines in the file at that revision (trailing newline not counted). */
  lineCount?: number;
}

export interface EvidenceVerification {
  verdict: EvidenceVerdict;
  reasonCode: EvidenceReasonCode;
  /** One-line human detail. Not machine-parsed; `reasonCode` is the contract. */
  detail: string;
  checked: EvidenceChecked;
}

/**
 * Provenance envelope: a `SourceRef` plus (optionally) the verification verdict
 * for it. Diagram model nodes / edges carry these so a future Evidence
 * Inspector (Slice 3) can show Source → Knowledge → Visual without re-deriving
 * anything. The verification is only attached when a repo was available to
 * check against; otherwise the raw `ref` still travels.
 */
export interface EvidenceRef {
  ref: SourceRef;
  verification?: EvidenceVerification;
}
