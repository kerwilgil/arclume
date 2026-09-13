import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  StubReasoner,
  formatValidationReport,
  readAnalysisArtifact,
  readKnowledgeArtifact,
  runPipeline,
  validateProjectKnowledge,
  writeArtifacts,
} from "../src/index.js";
import { sampleRepoPath } from "./helpers/tmp-repo.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

describe("end-to-end: sample-repo -> ProjectKnowledge", () => {
  it("discovers, ingests, analyzes, builds and validates", async () => {
    const out = await runPipeline(sampleRepoPath(), new StubReasoner());

    const docPaths = out.ingestion.documents.map((d) => d.path);
    expect(docPaths).toContain("README.md");
    expect(docPaths).toContain("config/default.yaml");
    expect(docPaths).toContain("docs/architecture.md");

    const skipped = new Map(out.ingestion.skipped.map((s) => [s.path, s.reason]));
    expect(skipped.get("notes.local.md")).toBe("ignored");
    expect(skipped.get("src/index.ts")).toBe("unsupported");

    expect(out.report.stats.entities).toBeGreaterThan(0);
    expect(out.report.stats.evidenceUnresolved).toBe(0);

    const validation = validateProjectKnowledge(out.knowledge);
    expect(validation.valid, formatValidationReport(validation)).toBe(true);

    const componentNames = out.knowledge.components.map((c) => c.name).sort();
    expect(componentNames).toEqual(["Ingest", "Rules", "Store"]);

    const factTypes = new Set(out.knowledge.claims.map((c) => c.factType));
    expect(factTypes.has("FACT")).toBe(true);
    expect(factTypes.has("INFERENCE")).toBe(true);

    expect(out.knowledge.gaps.length).toBeGreaterThanOrEqual(2);

    // every sourceRef resolves to a provenance source
    const sourceIds = new Set(out.knowledge.sources.map((s) => s.id));
    for (const c of out.knowledge.components) {
      for (const ref of c.sourceRefs) expect(sourceIds.has(ref.sourceId)).toBe(true);
    }
  });

  it("writes inspectable per-stage artifacts that round-trip", async () => {
    const out = await runPipeline(sampleRepoPath(), new StubReasoner());
    const dir = mkdtempSync(join(tmpdir(), "arclume-out-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));

    writeArtifacts(dir, {
      ingestion: out.ingestion,
      sourceDigest: out.sourceDigest,
      analysisDigest: out.analysisDigest,
      analysis: out.analysis,
      reasoner: out.reasoner,
      knowledge: out.knowledge,
    });

    for (const f of ["manifest.json", "sources.json", "analysis.json", "project-knowledge.json"]) {
      expect(existsSync(join(dir, f)), f).toBe(true);
    }
    expect(existsSync(join(dir, "documents", "index.json"))).toBe(true);

    const analysisBack = readAnalysisArtifact(dir);
    expect(analysisBack.reasoner).toEqual(out.reasoner);
    const knowledgeBack = readKnowledgeArtifact(dir);
    expect(validateProjectKnowledge(knowledgeBack).valid).toBe(true);
    expect(knowledgeBack.project.name).toBe(out.knowledge.project.name);
  });
});
