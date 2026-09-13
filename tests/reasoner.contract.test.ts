import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AgentReasoner,
  type AnalysisResult,
  type Reasoner,
  ReasonerError,
  type ReasonerRequest,
  type ReasonerResult,
  StubReasoner,
  buildKnowledge,
  runAnalyze,
  validateAnalysisResult,
  validateProjectKnowledge,
} from "../src/index.js";
import { fakeIngestion, fakeRequest } from "./helpers/fake-ingestion.js";
import { sampleRepoPath } from "./helpers/tmp-repo.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

const validAnalysis: AnalysisResult = {
  analysisVersion: "0.1.0",
  project: { name: "X", evidence: [{ documentId: "doc-x", lineStart: 1, lineEnd: 1 }] },
  entities: [
    {
      kind: "component",
      name: "Core",
      key: "component:core",
      evidence: [{ documentId: "doc-x", lineStart: 3, lineEnd: 3 }],
    },
  ],
  relations: [
    {
      fromKey: "component:core",
      toKey: "project",
      type: "PART_OF",
      evidence: [{ documentId: "doc-x" }],
    },
  ],
  claims: [
    {
      statement: "It runs in production.",
      factType: "FACT",
      evidence: [{ documentId: "doc-x", lineStart: 2, lineEnd: 2 }],
    },
  ],
  gaps: [{ question: "What is the retention window?" }],
};

describe("StubReasoner", () => {
  it("returns a schema-valid AnalysisResult", async () => {
    const analyzed = await runAnalyze(sampleRepoPath(), new StubReasoner());
    expect(validateAnalysisResult(analyzed.analysis).valid).toBe(true);
    expect(analyzed.reasoner).toEqual({ id: "stub", version: "0.1.0" });
  });

  it("is deterministic for the same request", async () => {
    const a = await runAnalyze(sampleRepoPath(), new StubReasoner());
    const b = await runAnalyze(sampleRepoPath(), new StubReasoner());
    expect(JSON.stringify(a.analysis)).toBe(JSON.stringify(b.analysis));
  });
});

describe("AgentReasoner", () => {
  it("accepts a valid inline AnalysisResult", async () => {
    const r = new AgentReasoner({ result: validAnalysis });
    const out = await r.analyze(fakeRequest as ReasonerRequest);
    expect(out.analysis).toEqual(validAnalysis);
    expect(out.reasoner).toEqual({ id: "agent", version: "0.1.0" });
  });

  it("loads a valid AnalysisResult from a JSON file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "arclume-agent-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const file = join(dir, "analysis.json");
    writeFileSync(file, JSON.stringify(validAnalysis));
    const r = new AgentReasoner({ resultPath: file });
    const out = await r.analyze(fakeRequest as ReasonerRequest);
    expect(out.analysis.project.name).toBe("X");
  });

  it("rejects a schema-invalid result", async () => {
    const bad = { ...validAnalysis } as Record<string, unknown>;
    delete bad["entities"];
    const r = new AgentReasoner({ result: bad });
    await expect(r.analyze(fakeRequest as ReasonerRequest)).rejects.toMatchObject({
      code: "reasoner/malformed-output",
    });
  });

  it("rejects a non-object result", async () => {
    const r = new AgentReasoner({ result: "not an analysis" });
    await expect(r.analyze(fakeRequest as ReasonerRequest)).rejects.toBeInstanceOf(ReasonerError);
  });

  it("wraps a throwing loader", async () => {
    const r = new AgentReasoner({
      load: () => {
        throw new Error("boom");
      },
    });
    await expect(r.analyze(fakeRequest as ReasonerRequest)).rejects.toMatchObject({
      code: "reasoner/loader-failed",
    });
  });
});

describe("the pipeline never trusts a reasoner blindly", () => {
  it("surfaces a reasoner that rejects", async () => {
    const failing: Reasoner = {
      capabilities: { id: "failing", version: "0.0.0", deterministic: true, network: false },
      analyze(): Promise<ReasonerResult> {
        return Promise.reject(new Error("model unavailable"));
      },
    };
    await expect(runAnalyze(sampleRepoPath(), failing)).rejects.toMatchObject({
      code: "reasoner/analyze-failed",
      stage: "REASONER",
    });
  });

  it("rejects a reasoner returning a malformed AnalysisResult", async () => {
    const rogue: Reasoner = {
      capabilities: { id: "rogue", version: "0.0.0", deterministic: true, network: false },
      analyze(): Promise<ReasonerResult> {
        return Promise.resolve({
          analysis: { analysisVersion: "0.1.0" } as unknown as AnalysisResult,
          reasoner: { id: "rogue", version: "0.0.0" },
        });
      },
    };
    await expect(runAnalyze(sampleRepoPath(), rogue)).rejects.toMatchObject({
      code: "reasoner/malformed-output",
    });
  });
});

describe("builder hardens well-formed but broken analysis", () => {
  it("downgrades a FACT whose evidence points at an unknown document", () => {
    const analysis: AnalysisResult = {
      ...validAnalysis,
      claims: [
        {
          statement: "Unbacked assertion.",
          factType: "FACT",
          evidence: [{ documentId: "ghost-doc" }],
        },
      ],
    };
    const { knowledge, report } = buildKnowledge({
      analysis,
      ingestion: fakeIngestion(),
      sourceDigest: "sha256:x",
    });
    expect(report.stats.factsDowngraded).toBe(1);
    expect(report.notes.some((n) => n.code === "builder/evidence-unresolved")).toBe(true);
    expect(knowledge.claims[0]?.factType).toBe("INFERENCE");
    expect(validateProjectKnowledge(knowledge).valid).toBe(true);
  });

  it("drops a relation with an unresolved endpoint", () => {
    const analysis: AnalysisResult = {
      ...validAnalysis,
      relations: [{ fromKey: "component:nope", toKey: "project", type: "PART_OF", evidence: [] }],
    };
    const { knowledge, report } = buildKnowledge({
      analysis,
      ingestion: fakeIngestion(),
      sourceDigest: "sha256:x",
    });
    expect(report.stats.relationsDropped).toBe(1);
    expect(knowledge.relations).toEqual([]);
    expect(validateProjectKnowledge(knowledge).valid).toBe(true);
  });

  it("allows an entity with no evidence (empty sourceRefs)", () => {
    const analysis: AnalysisResult = {
      ...validAnalysis,
      entities: [{ kind: "capability", name: "Reporting", evidence: [] }],
      relations: [],
      claims: [],
    };
    const { knowledge } = buildKnowledge({
      analysis,
      ingestion: fakeIngestion(),
      sourceDigest: "sha256:x",
    });
    expect(knowledge.capabilities[0]?.sourceRefs).toEqual([]);
    expect(validateProjectKnowledge(knowledge).valid).toBe(true);
  });

  it("turns an UNKNOWN claim into a gap", () => {
    const analysis: AnalysisResult = {
      ...validAnalysis,
      claims: [{ statement: "Does it scale to 10k rps?", factType: "UNKNOWN", evidence: [] }],
    };
    const { knowledge, report } = buildKnowledge({
      analysis,
      ingestion: fakeIngestion(),
      sourceDigest: "sha256:x",
    });
    expect(report.notes.some((n) => n.code === "builder/unknown-to-gap")).toBe(true);
    expect(knowledge.claims.some((c) => c.statement.includes("10k rps"))).toBe(false);
    expect(knowledge.gaps.some((g) => g.question.includes("10k rps"))).toBe(true);
  });

  it("builds a minimal valid knowledge from an empty analysis", () => {
    const analysis: AnalysisResult = {
      analysisVersion: "0.1.0",
      project: { name: "Empty", evidence: [] },
      entities: [],
      relations: [],
      claims: [],
      gaps: [],
    };
    const { knowledge } = buildKnowledge({
      analysis,
      ingestion: fakeIngestion(),
      sourceDigest: "sha256:x",
    });
    expect(validateProjectKnowledge(knowledge).valid).toBe(true);
    expect(knowledge.project.name).toBe("Empty");
  });
});
