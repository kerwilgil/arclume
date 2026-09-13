/**
 * Verified mode: primary Reasoner -> candidate AnalysisResult -> reviewer
 * Reasoner (same transport, a different prompt built from
 * {@link buildReviewerPrompt}) -> corrected AnalysisResult -> the same
 * `validateAnalysisResult` gate every mode goes through.
 *
 * Reviewer failure policy (spec R): a reviewer that errors, times out, or
 * returns something that fails schema validation NEVER silently degrades to
 * the primary's unreviewed candidate. {@link reviewCandidate} returns a
 * `{status: "reviewer-failed"}` outcome carrying the primary's candidate so
 * the caller (the Web API) can offer the user an explicit choice: retry as
 * Fast (accepting the unreviewed candidate on purpose) or fix the reviewer
 * configuration and try Verified again. Fast mode never runs a reviewer at
 * all, so it can never hit this path.
 *
 * `reviewCandidate` is the one real building block: it takes an
 * already-produced candidate and just runs the reviewer step, through the
 * SAME `analyzePrepared()` defense-in-depth call every other mode uses (it
 * re-checks reasoner identity and re-validates the schema regardless of the
 * adapter's own `validateAndWrap` — never trusting a single layer alone).
 * This matches the Web API's two-HTTP-call design (`.../analyze` then
 * separately `.../review`, so each UI progress state maps to one real
 * backend call — see App.tsx) — the primary already ran and its candidate is
 * sitting in `ws.pendingCandidate` by the time `.../review` is called, so
 * re-running it here would be wrong. `runVerifiedAnalysis` composes primary
 * + reviewer in one call for any single-shot (non-web) caller, built on the
 * same function.
 */

import { type PreparedAnalysis, analyzePrepared } from "../../pipeline/run.js";
import type { AnalysisResult } from "../analysis-result.js";
import type { Reasoner, ReasonerRequest } from "../reasoner.js";
import { buildReviewerPrompt } from "./prompt.js";

export interface ReasonerIdentity {
  id: string;
  version: string;
}

export type VerifiedOutcome =
  | {
      status: "approved";
      analysis: AnalysisResult;
      primaryReasonerId: string;
      reviewer: ReasonerIdentity;
    }
  | {
      status: "corrected";
      analysis: AnalysisResult;
      primaryReasonerId: string;
      reviewer: ReasonerIdentity;
    }
  | {
      status: "reviewer-failed";
      primaryCandidate: AnalysisResult;
      primaryReasonerId: string;
      reviewerId: string;
      reason: string;
    };

/**
 * Runs `reviewer` against an already-produced `candidate` (the primary's
 * validated result) and classifies the outcome. Never throws: a reviewer
 * failure — transport error, timeout, malformed/invalid response — comes
 * back as a `reviewer-failed` outcome, never a silent pass-through of
 * `candidate` as if it had been reviewed.
 */
export async function reviewCandidate(
  reviewer: Reasoner,
  prepared: PreparedAnalysis,
  candidate: AnalysisResult,
  primaryReasonerId: string,
): Promise<VerifiedOutcome> {
  let reviewed: Awaited<ReturnType<typeof analyzePrepared>>;
  try {
    // The reviewer reasoner must already be constructed with a promptBuilder
    // bound to `buildReviewerPrompt` (see registry.ts buildReasoner's
    // `promptBuilder` parameter) — reusing that same transport with a
    // different prompt is the whole point of the injectable prompt builder.
    // Concretely, buildReviewerPrompt(request, candidate) is what actually
    // gets sent; `prepared.request` still carries the original
    // documents/hints for adapters that want them alongside the candidate.
    reviewed = await analyzePrepared(prepared, reviewer);
  } catch (err) {
    return {
      status: "reviewer-failed",
      primaryCandidate: candidate,
      primaryReasonerId,
      reviewerId: reviewer.capabilities.id,
      reason: err instanceof Error ? err.message : String(err),
    };
  }

  const corrected = reviewed.analysis;
  const unchanged = JSON.stringify(corrected) === JSON.stringify(candidate);
  return {
    status: unchanged ? "approved" : "corrected",
    analysis: corrected,
    primaryReasonerId,
    reviewer: reviewed.reasoner,
  };
}

/** Runs the primary reasoner, then {@link reviewCandidate} against its
 * result — a single-call convenience for callers that don't need the
 * two-step (`.../analyze` then `.../review`) split the Web API uses. */
export async function runVerifiedAnalysis(
  primary: Reasoner,
  reviewer: Reasoner,
  prepared: PreparedAnalysis,
): Promise<VerifiedOutcome> {
  // analyzePrepared() already runs the candidate through schema validation
  // and the reasoner-identity check (every adapter funnels through
  // validateAndWrap too) — a malformed primary result throws here exactly as
  // Fast mode would, before any reviewer step runs.
  const primaryResult = await analyzePrepared(prepared, primary);
  return reviewCandidate(reviewer, prepared, primaryResult.analysis, primaryResult.reasoner.id);
}

/** Binds `buildReviewerPrompt` to a specific candidate — pass the result as
 * the `promptBuilder` when building the reviewer's `Reasoner` instance. */
export function reviewerPromptBuilderFor(
  candidate: AnalysisResult,
): (request: ReasonerRequest) => ReturnType<typeof buildReviewerPrompt> {
  return (request: ReasonerRequest) => buildReviewerPrompt(request, candidate);
}
