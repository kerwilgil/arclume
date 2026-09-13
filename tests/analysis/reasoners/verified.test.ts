/**
 * `reviewCandidate` / `runVerifiedAnalysis` orchestration, tested standalone
 * against fake `Reasoner`s — never a real provider. Exercises the reviewer
 * failure policy (spec R): a reviewer that throws NEVER silently promotes
 * the primary's candidate.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AnalysisResult } from "../../../src/analysis/analysis-result.js";
import type {
  Reasoner,
  ReasonerCapabilities,
  ReasonerRequest,
} from "../../../src/analysis/reasoner.js";
import {
  reviewCandidate,
  reviewerPromptBuilderFor,
  runVerifiedAnalysis,
} from "../../../src/analysis/reasoners/verified.js";
import { type PreparedAnalysis, prepareAnalysis } from "../../../src/pipeline/run.js";
import { sampleAnalysisResult } from "../../helpers/reasoner-fixtures.js";

class FakeReasoner implements Reasoner {
  constructor(
    readonly capabilities: ReasonerCapabilities,
    private readonly behavior: (request: ReasonerRequest) => AnalysisResult | Error,
  ) {}

  async analyze(request: ReasonerRequest) {
    const outcome = this.behavior(request);
    if (outcome instanceof Error) throw outcome;
    return {
      analysis: outcome,
      reasoner: { id: this.capabilities.id, version: this.capabilities.version },
    };
  }
}

function fakeCaps(id: string): ReasonerCapabilities {
  return { id, version: "0.1.0", deterministic: true, network: false };
}

let dir = "";
let prepared: PreparedAnalysis;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "arclume-verified-test-"));
  writeFileSync(join(dir, "README.md"), "# Verified mode fixture\n\nA fixture project.\n");
  prepared = await prepareAnalysis([{ kind: "path", path: dir }]);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("reviewCandidate", () => {
  it("returns 'approved' when the reviewer echoes back an identical result", async () => {
    const candidate = sampleAnalysisResult();
    const reviewer = new FakeReasoner(fakeCaps("fake-reviewer"), () => sampleAnalysisResult());
    const outcome = await reviewCandidate(reviewer, prepared, candidate, "fake-primary");
    expect(outcome.status).toBe("approved");
    if (outcome.status === "approved") {
      expect(outcome.analysis).toEqual(candidate);
      expect(outcome.primaryReasonerId).toBe("fake-primary");
      expect(outcome.reviewer.id).toBe("fake-reviewer");
    }
  });

  it("returns 'corrected' when the reviewer returns a different (still valid) result", async () => {
    const candidate = sampleAnalysisResult("original-name");
    const corrected = sampleAnalysisResult("corrected-name");
    const reviewer = new FakeReasoner(fakeCaps("fake-reviewer"), () => corrected);
    const outcome = await reviewCandidate(reviewer, prepared, candidate, "fake-primary");
    expect(outcome.status).toBe("corrected");
    if (outcome.status === "corrected") {
      expect(outcome.analysis.project.name).toBe("corrected-name");
    }
  });

  it("returns 'reviewer-failed' (never throws) when the reviewer throws — never silently promotes the candidate", async () => {
    const candidate = sampleAnalysisResult();
    const reviewer = new FakeReasoner(
      fakeCaps("fake-reviewer"),
      () => new Error("reviewer exploded"),
    );
    const outcome = await reviewCandidate(reviewer, prepared, candidate, "fake-primary");
    expect(outcome.status).toBe("reviewer-failed");
    if (outcome.status === "reviewer-failed") {
      expect(outcome.primaryCandidate).toEqual(candidate);
      expect(outcome.primaryReasonerId).toBe("fake-primary");
      expect(outcome.reviewerId).toBe("fake-reviewer");
      // analyzePrepared() wraps a raw thrown Error into a generic
      // ReasonerError (the original is preserved as `.cause`) — reason
      // surfaces that generic, non-leaky message rather than a raw stack.
      expect(outcome.reason).toBe("the reasoner failed to produce an analysis");
    }
  });

  it("returns 'reviewer-failed' when the reviewer's result fails ARCLUME's own schema validation — even though the reviewer itself didn't throw", async () => {
    const candidate = sampleAnalysisResult();
    // A reviewer whose adapter forgot to validate its own output before
    // returning: analyzePrepared's defense-in-depth check must still catch
    // it, and reviewCandidate must still report failure, not a corrupted
    // "corrected" result.
    const malformedReviewer: Reasoner = {
      capabilities: fakeCaps("fake-reviewer"),
      analyze: async () => ({
        analysis: { nope: true } as unknown as AnalysisResult,
        reasoner: { id: "fake-reviewer", version: "0.1.0" },
      }),
    };
    const outcome = await reviewCandidate(malformedReviewer, prepared, candidate, "fake-primary");
    expect(outcome.status).toBe("reviewer-failed");
  });

  it("returns 'reviewer-failed' when the reviewer's result identity doesn't match its declared capabilities", async () => {
    const candidate = sampleAnalysisResult();
    const impersonator: Reasoner = {
      capabilities: fakeCaps("fake-reviewer"),
      analyze: async () => ({
        analysis: sampleAnalysisResult(),
        reasoner: { id: "someone-else", version: "9.9.9" }, // spoofed identity
      }),
    };
    const outcome = await reviewCandidate(impersonator, prepared, candidate, "fake-primary");
    expect(outcome.status).toBe("reviewer-failed");
  });

  it("never runs an analysis twice against the same source (uses the pre-computed candidate, not a re-run of the primary)", async () => {
    let reviewerCallCount = 0;
    const candidate = sampleAnalysisResult();
    const reviewer = new FakeReasoner(fakeCaps("fake-reviewer"), () => {
      reviewerCallCount += 1;
      return sampleAnalysisResult();
    });
    await reviewCandidate(reviewer, prepared, candidate, "fake-primary");
    expect(reviewerCallCount).toBe(1);
  });
});

describe("runVerifiedAnalysis", () => {
  it("runs the primary, then the reviewer, and reports 'approved' end to end", async () => {
    const primary = new FakeReasoner(fakeCaps("fake-primary"), () => sampleAnalysisResult());
    const reviewer = new FakeReasoner(fakeCaps("fake-reviewer"), () => sampleAnalysisResult());
    const outcome = await runVerifiedAnalysis(primary, reviewer, prepared);
    expect(outcome.status).toBe("approved");
    if (outcome.status === "approved") {
      expect(outcome.primaryReasonerId).toBe("fake-primary");
    }
  });

  it("never calls the reviewer at all if the primary itself fails", async () => {
    let reviewerCalled = false;
    const primary = new FakeReasoner(fakeCaps("fake-primary"), () => new Error("primary down"));
    const reviewer = new FakeReasoner(fakeCaps("fake-reviewer"), () => {
      reviewerCalled = true;
      return sampleAnalysisResult();
    });
    await expect(runVerifiedAnalysis(primary, reviewer, prepared)).rejects.toThrow();
    expect(reviewerCalled).toBe(false);
  });
});

describe("reviewerPromptBuilderFor", () => {
  it("builds a reviewer prompt that references the candidate being reviewed", () => {
    const candidate = sampleAnalysisResult("the-candidate-project");
    const builder = reviewerPromptBuilderFor(candidate);
    const chatPrompt = builder(prepared.request);
    expect(chatPrompt.user).toContain("the-candidate-project");
  });
});
