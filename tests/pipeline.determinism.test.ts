import { describe, expect, it } from "vitest";
import {
  StubReasoner,
  buildKnowledge,
  runAnalyze,
  runPipeline,
  sourceDigest,
  stableJson,
  stableStringify,
} from "../src/index.js";
import { sampleRepoPath } from "./helpers/tmp-repo.js";

describe("the Phase 2 pipeline is deterministic", () => {
  it("produces a byte-identical ProjectKnowledge across runs", async () => {
    const a = await runPipeline(sampleRepoPath(), new StubReasoner());
    const b = await runPipeline(sampleRepoPath(), new StubReasoner());
    expect(stableStringify(a.knowledge)).toBe(stableStringify(b.knowledge));
    expect(stableJson(a.knowledge)).toBe(stableJson(b.knowledge));
  });

  it("produces a byte-identical AnalysisResult across runs", async () => {
    const a = await runAnalyze(sampleRepoPath(), new StubReasoner());
    const b = await runAnalyze(sampleRepoPath(), new StubReasoner());
    expect(stableStringify(a.analysis)).toBe(stableStringify(b.analysis));
    expect(a.sourceDigest).toBe(b.sourceDigest);
  });

  it("does not depend on the order documents are given to the builder", async () => {
    const analyzed = await runAnalyze(sampleRepoPath(), new StubReasoner());
    const forward = buildKnowledge(analyzed).knowledge;

    const shuffled = {
      analysis: analyzed.analysis,
      ingestion: {
        sources: analyzed.ingestion.sources,
        documents: [...analyzed.ingestion.documents].reverse(),
      },
      sourceDigest: analyzed.sourceDigest,
    };
    const reversed = buildKnowledge(shuffled).knowledge;
    expect(stableStringify(reversed)).toBe(stableStringify(forward));
  });

  it("keeps the source digest independent of document order", async () => {
    const { ingestion } = await runAnalyze(sampleRepoPath(), new StubReasoner());
    expect(sourceDigest([...ingestion.documents].reverse())).toBe(
      sourceDigest(ingestion.documents),
    );
  });
});
