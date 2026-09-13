import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  StubReasoner,
  buildDeck,
  formatValidationReport,
  narrativeContentHash,
  readDeckArtifact,
  runDeck,
  runPipeline,
  runPlanning,
  slidePlanContentHash,
  stableStringify,
  validateArclumeDeck,
  writeArtifacts,
} from "../src/index.js";
import { sampleRepoPath } from "./helpers/tmp-repo.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

describe("end-to-end: sample-repo → ProjectKnowledge → NarrativePlan → SlidePlan → ArclumeDeck", () => {
  it("builds a valid, deterministic, evidence-backed deck (no browser)", async () => {
    const out = await runPipeline(sampleRepoPath(), new StubReasoner());
    const { narrative, slidePlan } = runPlanning(out.knowledge, { audience: "technical" });
    const { deck, decisions, validation } = buildDeck(out.knowledge, narrative, slidePlan);

    expect(validation.valid, formatValidationReport(validation)).toBe(true);
    expect(deck.irVersion).toBe("0.2.0");

    // structure
    expect(deck.slides.filter((s) => s.kind === "cover")).toHaveLength(1);
    expect(deck.slides.filter((s) => s.kind === "closing")).toHaveLength(1);
    deck.slides.forEach((s, i) => expect(s.index).toBe(i));

    // 1:1 binding with the slide plan + key message integrity
    expect(deck.slides.map((s) => s.id)).toEqual(slidePlan.slides.map((s) => s.id));
    deck.slides.forEach((s, i) => {
      const norm = (t: string) => t.replace(/\s+/g, " ").trim();
      expect(norm(s.keyMessage)).toBe(norm(slidePlan.slides[i]?.keyMessage ?? ""));
    });

    // hash bindings
    expect(deck.provenance.knowledgeHash).toBe(out.knowledge.meta?.contentHash);
    expect(deck.provenance.narrativeRef).toBe(narrativeContentHash(narrative));
    expect(deck.provenance.slidePlanRef).toBe(slidePlanContentHash(slidePlan));

    // explainable
    expect(
      decisions.some((d) => d.code === "visual-accepted" || d.code === "visual-downgraded"),
    ).toBe(true);

    // deterministic
    const again = buildDeck(out.knowledge, narrative, slidePlan);
    expect(stableStringify(again.deck)).toBe(stableStringify(deck));
  });

  it("runDeck chains every stage and keeps them inspectable", async () => {
    const out = await runPipeline(sampleRepoPath(), new StubReasoner());
    const r = runDeck(out.knowledge, { audience: "executive" });
    expect(r.narrativeValidation.valid).toBe(true);
    expect(r.slideValidation.valid).toBe(true);
    expect(r.deckValidation.valid).toBe(true);
    expect(r.deck.slides.length).toBe(r.slidePlan.slides.length);
    expect(r.deck.theme.name).toBe("executive");
  });

  it("writes arclume-deck.json alongside the plan artifacts and round-trips", async () => {
    const out = await runPipeline(sampleRepoPath(), new StubReasoner());
    const { narrative, slidePlan } = runPlanning(out.knowledge, { audience: "general" });
    const { deck } = buildDeck(out.knowledge, narrative, slidePlan);

    const dir = mkdtempSync(join(tmpdir(), "arclume-deck-"));
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
      deck,
    });
    expect(existsSync(join(dir, "arclume-deck.json"))).toBe(true);
    const back = readDeckArtifact(dir);
    expect(
      validateArclumeDeck(back, { knowledge: out.knowledge, narrative, slidePlan }).valid,
    ).toBe(true);
    expect(back.provenance.slidePlanRef).toBe(slidePlanContentHash(slidePlan));
  });

  it("a technical and an executive deck of the same knowledge differ in visual spec", async () => {
    const out = await runPipeline(sampleRepoPath(), new StubReasoner());
    const tech = runDeck(out.knowledge, { audience: "technical" }).deck;
    const exec = runDeck(out.knowledge, { audience: "executive" }).deck;
    expect(stableStringify(tech.slides.map((s) => s.narrativePurpose))).not.toBe(
      stableStringify(exec.slides.map((s) => s.narrativePurpose)),
    );
  });
});
