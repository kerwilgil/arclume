import { describe, expect, it } from "vitest";
import {
  type AnalysisResult,
  type Reasoner,
  type ReasonerCapabilities,
  StubReasoner,
  buildKnowledge,
  emptyAnalysisResult,
  runAnalyze,
} from "../src/index.js";
import { fakeIngestion } from "./helpers/fake-ingestion.js";
import { sampleRepoPath } from "./helpers/tmp-repo.js";

function analysis(over: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    analysisVersion: "0.1.0",
    project: { name: "Demo", evidence: [] },
    entities: [],
    relations: [],
    claims: [],
    gaps: [],
    ...over,
  };
}

describe("buildKnowledge returns the real validation result", () => {
  it("surfaces a genuine warning instead of a fabricated clean result", () => {
    const out = buildKnowledge({
      analysis: analysis({
        // an INFERENCE with no evidence is valid but un-traceable -> warning
        claims: [{ statement: "It probably uses a queue.", factType: "INFERENCE", evidence: [] }],
      }),
      ingestion: fakeIngestion(),
      sourceDigest: "sha256:x",
    });
    expect(out.validation.valid).toBe(true);
    expect(out.validation.errors).toEqual([]);
    expect(out.validation.warnings.map((w) => w.code)).toContain("claim/inference-without-basis");
  });

  it("reports no warnings when the knowledge is clean", () => {
    const out = buildKnowledge({
      analysis: analysis(),
      ingestion: fakeIngestion(),
      sourceDigest: "sha256:x",
    });
    expect(out.validation.valid).toBe(true);
    expect(out.validation.warnings).toEqual([]);
  });
});

describe("analysisDigest folds in analysis-affecting hints", () => {
  const repo = sampleRepoPath();

  it("changes with audience and with focus, and is stable for equal hints", async () => {
    const base = await runAnalyze(repo, new StubReasoner());
    const execs = await runAnalyze(repo, new StubReasoner(), { hints: { audience: "execs" } });
    const execs2 = await runAnalyze(repo, new StubReasoner(), { hints: { audience: "execs" } });
    const eng = await runAnalyze(repo, new StubReasoner(), { hints: { audience: "engineers" } });
    const focus = await runAnalyze(repo, new StubReasoner(), {
      hints: { focus: ["security", "latency"] },
    });

    expect(execs.analysisDigest).not.toBe(base.analysisDigest);
    expect(execs.analysisDigest).not.toBe(eng.analysisDigest);
    expect(execs2.analysisDigest).toBe(execs.analysisDigest);
    expect(focus.analysisDigest).not.toBe(base.analysisDigest);
    // hints never leak into the source digest
    expect(execs.sourceDigest).toBe(base.sourceDigest);
  });

  it("treats focus as an unordered set", async () => {
    const a = await runAnalyze(repo, new StubReasoner(), {
      hints: { focus: ["security", "latency"] },
    });
    const reordered = await runAnalyze(repo, new StubReasoner(), {
      hints: { focus: ["latency", "security", "security"] },
    });
    const fewer = await runAnalyze(repo, new StubReasoner(), { hints: { focus: ["latency"] } });

    expect(reordered.analysisDigest).toBe(a.analysisDigest);
    expect(fewer.analysisDigest).not.toBe(a.analysisDigest);
  });
});

describe("the reasoner result identity must match its capabilities", () => {
  const caps: ReasonerCapabilities = {
    id: "fixed",
    version: "1.2.3",
    deterministic: true,
    network: false,
  };
  const make = (resId: string, resVersion: string): Reasoner => ({
    capabilities: caps,
    analyze: () =>
      Promise.resolve({
        analysis: emptyAnalysisResult("X"),
        reasoner: { id: resId, version: resVersion },
      }),
  });

  it("passes when id and version match", async () => {
    const out = await runAnalyze(sampleRepoPath(), make("fixed", "1.2.3"));
    expect(out.reasoner).toEqual({ id: "fixed", version: "1.2.3" });
  });

  it("fails on a mismatched id", async () => {
    await expect(runAnalyze(sampleRepoPath(), make("other", "1.2.3"))).rejects.toMatchObject({
      code: "reasoner/identity-mismatch",
    });
  });

  it("fails on a mismatched version", async () => {
    await expect(runAnalyze(sampleRepoPath(), make("fixed", "9.9.9"))).rejects.toMatchObject({
      code: "reasoner/identity-mismatch",
    });
  });
});
