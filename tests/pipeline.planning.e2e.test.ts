import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  StubReasoner,
  formatValidationReport,
  narrativeContentHash,
  readNarrativeArtifact,
  readSlidePlanArtifact,
  runPipeline,
  runPlanning,
  stableStringify,
  validateNarrativePlan,
  validateSlidePlan,
  writeArtifacts,
} from "../src/index.js";
import { sampleRepoPath } from "./helpers/tmp-repo.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

describe("end-to-end: sample-repo -> ProjectKnowledge -> NarrativePlan -> SlidePlan", () => {
  it("plans an executive deck that is valid, deterministic and evidence-backed", async () => {
    const out = await runPipeline(sampleRepoPath(), new StubReasoner());
    const { narrative, slidePlan, narrativeValidation, slideValidation } = runPlanning(
      out.knowledge,
      { audience: "executive" },
    );

    expect(narrativeValidation.valid, formatValidationReport(narrativeValidation)).toBe(true);
    expect(slideValidation.valid, formatValidationReport(slideValidation)).toBe(true);

    // one cover, one closing, contiguous indexes
    expect(slidePlan.slides.filter((s) => s.kind === "cover")).toHaveLength(1);
    expect(slidePlan.slides.filter((s) => s.kind === "closing")).toHaveLength(1);
    slidePlan.slides.forEach((s, i) => expect(s.index).toBe(i));

    // one idea per slide
    const messages = slidePlan.slides.map((s) => s.keyMessage.toLowerCase());
    expect(new Set(messages).size).toBe(messages.length);

    // narrative link + provenance
    expect(slidePlan.narrativeRef).toBe(narrativeContentHash(narrative));
    expect(slidePlan.knowledgeHash).toBe(out.knowledge.meta?.contentHash);

    // every knowledgeRef resolves; every sourceRef resolves
    const knownIds = new Set<string>([out.knowledge.project.id]);
    for (const key of Object.keys(out.knowledge) as Array<keyof typeof out.knowledge>) {
      const v = out.knowledge[key];
      if (Array.isArray(v))
        for (const e of v)
          if (e && typeof e === "object" && "id" in e) knownIds.add((e as { id: string }).id);
    }
    const sourceIds = new Set(out.knowledge.sources.map((s) => s.id));
    for (const s of slidePlan.slides) {
      for (const id of s.knowledgeRefs) expect(knownIds.has(id)).toBe(true);
      for (const ref of s.sourceRefs) expect(sourceIds.has(ref.sourceId)).toBe(true);
    }

    // explainable
    expect(slidePlan.decisions.some((d) => d.code === "slide-added")).toBe(true);

    // deterministic
    const again = runPlanning(out.knowledge, { audience: "executive" });
    expect(stableStringify(again.narrative)).toBe(stableStringify(narrative));
    expect(stableStringify(again.slidePlan)).toBe(stableStringify(slidePlan));
  });

  it("writes narrative-plan.json and slide-plan.json that round-trip", async () => {
    const out = await runPipeline(sampleRepoPath(), new StubReasoner());
    const { narrative, slidePlan } = runPlanning(out.knowledge, { audience: "technical" });

    const dir = mkdtempSync(join(tmpdir(), "arclume-plan-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));

    writeArtifacts(dir, {
      ingestion: out.ingestion,
      sourceDigest: out.sourceDigest,
      analysisDigest: out.analysisDigest,
      analysis: out.analysis,
      reasoner: out.reasoner,
      knowledge: out.knowledge,
      narrative,
      slidePlan,
    });

    expect(existsSync(join(dir, "narrative-plan.json"))).toBe(true);
    expect(existsSync(join(dir, "slide-plan.json"))).toBe(true);

    const nBack = readNarrativeArtifact(dir);
    const sBack = readSlidePlanArtifact(dir);
    expect(validateNarrativePlan(nBack, out.knowledge).valid).toBe(true);
    expect(validateSlidePlan(sBack, { narrative: nBack, knowledge: out.knowledge }).valid).toBe(
      true,
    );
    expect(nBack.audience).toBe("technical");
    expect(sBack.narrativeRef).toBe(narrativeContentHash(nBack));
  });

  it("technical and executive plans of the same knowledge are different decks", async () => {
    const out = await runPipeline(sampleRepoPath(), new StubReasoner());
    const exec = runPlanning(out.knowledge, { audience: "executive" });
    const tech = runPlanning(out.knowledge, { audience: "technical" });
    expect(stableStringify(exec.slidePlan.slides.map((s) => s.narrativePurpose))).not.toBe(
      stableStringify(tech.slidePlan.slides.map((s) => s.narrativePurpose)),
    );
  });
});
