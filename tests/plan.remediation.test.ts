import { describe, expect, it } from "vitest";
import {
  type NarrativePlan,
  type PlannedSlide,
  type PlanningDecision,
  type PlanningNote,
  type ProjectKnowledge,
  type SlideBudget,
  type SlidePlan,
  applyBudget,
  buildNarrativePlan,
  buildSlidePlan,
  narrativeContentHash,
  slidePlanContentHash,
  validateNarrativePlan,
  validateSlidePlan,
} from "../src/index.js";
import { clone, loadFixture } from "./helpers/fixtures.js";

const wide = () => loadFixture<ProjectKnowledge>("planning/wide-knowledge.json");
const FAKE_HASH = `sha256:${"f".repeat(64)}`;

function contentSlide(over: Partial<PlannedSlide>): PlannedSlide {
  return {
    id: "s",
    index: 0,
    sectionId: "sec-x",
    kind: "content",
    title: "T",
    keyMessage: "a distinct message",
    narrativePurpose: "risk",
    knowledgeRefs: [],
    claimRefs: [],
    sourceRefs: [],
    contentIntent: "content",
    visualIntent: "summary",
    density: "low",
    priority: 5,
    ...over,
  };
}

const cover = contentSlide({ id: "cover", kind: "cover", title: "Deck", keyMessage: "cover msg" });
const closing = contentSlide({
  id: "closing",
  kind: "closing",
  title: "Next",
  keyMessage: "closing msg",
});
const tightBudget: SlideBudget = { minSlides: 1, targetSlides: 2, maxSlides: 3 };

/* ------------------------------------------------------------------ */
/* P1 — budget merge integrity                                         */
/* ------------------------------------------------------------------ */

describe("budget merge — same-section safe merge", () => {
  it("preserves knowledge, claims and provenance from BOTH inputs and drops the split counter", () => {
    const a1 = contentSlide({
      id: "a1",
      sectionId: "sec-x",
      title: "Topic (1/2)",
      keyMessage: "first half message",
      knowledgeRefs: ["k1"],
      claimRefs: ["c1"],
      sourceRefs: [{ sourceId: "s1" }],
    });
    const a2 = contentSlide({
      id: "a2",
      sectionId: "sec-x",
      title: "Topic (2/2)",
      keyMessage: "second half message",
      knowledgeRefs: ["k2"],
      claimRefs: ["c2"],
      sourceRefs: [{ sourceId: "s2" }],
    });
    const decisions: PlanningDecision[] = [];
    const notes: PlanningNote[] = [];
    const out = applyBudget([cover, a1, a2, closing], tightBudget, decisions, notes);

    const merged = out.find((s) => s.kind === "content");
    expect(merged, "a merged content slide survives").toBeTruthy();
    if (!merged) return;

    expect(merged.knowledgeRefs).toEqual(["k1", "k2"]);
    expect(merged.claimRefs).toEqual(["c1", "c2"]);
    const sourceIds = merged.sourceRefs.map((r) => r.sourceId).sort();
    expect(sourceIds).toEqual(["s1", "s2"]);
    expect(merged.sectionId).toBe("sec-x");
    expect(merged.title).toBe("Topic");
    expect(/\(\d+\/\d+\)/.test(merged.title)).toBe(false);
    out.forEach((s, i) => expect(s.index).toBe(i));

    const md = decisions.find((d) => d.code === "topics-merged");
    expect(md?.sectionId).toBe("sec-x");
  });
});

describe("budget merge — cross-section is never automatic", () => {
  it("two adjacent same-purpose slides in different sections are dropped, not fused", () => {
    const a = contentSlide({ id: "a", sectionId: "sec-a", title: "Security-related knowledge" });
    const b = contentSlide({ id: "b", sectionId: "sec-b", title: "Risks" });
    const decisions: PlanningDecision[] = [];
    const notes: PlanningNote[] = [];
    const out = applyBudget([cover, a, b, closing], tightBudget, decisions, notes);

    expect(decisions.some((d) => d.code === "topics-merged")).toBe(false);
    expect(decisions.some((d) => d.code === "over-budget-resolved")).toBe(true);
    expect(out).toHaveLength(3);
    expect(out[0]?.kind).toBe("cover");
    expect(out.at(-1)?.kind).toBe("closing");
    // whichever survived kept its own identity — no slide now claims both sections
    const titles = out.map((s) => s.title);
    expect(titles).not.toContain("Security-related knowledge → Risks");
  });
});

describe("budget merge — semantic recomputation through the real planner", () => {
  it("a merged split section recovers its section title and a message for the whole set", () => {
    const k = wide();
    const narrative = buildNarrativePlan(k, { audience: "general" });

    const full = buildSlidePlan(k, narrative); // default budget: split parts intact
    const p1 = full.slides.find((s) => s.id === "slide-can-do-1");
    const p2 = full.slides.find((s) => s.id === "slide-can-do-2");
    expect(p1?.title).toMatch(/\(1\/2\)$/);
    expect(p2?.title).toMatch(/\(2\/2\)$/);
    const bothRefs = [
      ...new Set([...(p1?.knowledgeRefs ?? []), ...(p2?.knowledgeRefs ?? [])]),
    ].sort();

    const tight = buildSlidePlan(k, narrative, { minSlides: 4, targetSlides: 5, maxSlides: 6 });
    const md = tight.decisions.find((d) => d.code === "topics-merged");
    expect(md, "a merge happened").toBeTruthy();
    const merged = tight.slides.find((s) => s.id === md?.slideId);
    expect(merged, "the merged slide survived the budget").toBeTruthy();
    if (!merged) return;

    expect(merged.title).toBe("What it can do");
    expect(/\(\d+\/\d+\)/.test(merged.title)).toBe(false);
    expect([...merged.knowledgeRefs].sort()).toEqual(bothRefs);
    expect(merged.keyMessage.length).toBeGreaterThan(0);
    expect(merged.keyMessage.replace(/\s+/g, " ").trim().toLowerCase()).not.toBe(
      merged.title.toLowerCase(),
    );
    expect(merged.contentIntent).toMatch(/merged/);
    tight.slides.forEach((s, i) => expect(s.index).toBe(i));

    const v = validateSlidePlan(tight, { narrative, knowledge: k });
    expect(v.valid, JSON.stringify(v.errors)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* P1 — artifact binding                                               */
/* ------------------------------------------------------------------ */

describe("artifact binding — NarrativePlan ↔ ProjectKnowledge", () => {
  it("a stale knowledgeHash is an ERROR, not a warning", () => {
    const p = clone(buildNarrativePlan(wide(), { audience: "executive" }));
    delete p.meta;
    p.knowledgeHash = FAKE_HASH;
    const r = validateNarrativePlan(p, wide());
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "narrative/knowledge-hash-mismatch")).toBe(true);
  });

  it("a missing knowledgeHash against hashed knowledge is an ERROR", () => {
    const p = clone(buildNarrativePlan(wide(), { audience: "executive" }));
    delete p.meta;
    delete p.knowledgeHash;
    const r = validateNarrativePlan(p, wide());
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "narrative/knowledge-hash-missing")).toBe(true);
  });
});

describe("artifact binding — SlidePlan ↔ narrative / knowledge", () => {
  const narrative = () => buildNarrativePlan(wide(), { audience: "executive" });

  it("a stale narrativeRef is an ERROR", () => {
    const n = narrative();
    const p = clone(buildSlidePlan(wide(), n));
    delete p.meta;
    p.narrativeRef = `sha256:${"a".repeat(64)}`;
    const r = validateSlidePlan(p, { narrative: n });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "plan/narrative-ref-mismatch")).toBe(true);
  });

  it("a SlidePlan.knowledgeHash that does not match the ProjectKnowledge is an ERROR", () => {
    const n = narrative();
    const p = clone(buildSlidePlan(wide(), n));
    delete p.meta;
    p.knowledgeHash = FAKE_HASH;
    const r = validateSlidePlan(p, { knowledge: wide() });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "plan/knowledge-hash-mismatch")).toBe(true);
  });

  it("narrative and slide plan built from different knowledge baselines is an ERROR", () => {
    const n = clone(narrative());
    const p = clone(buildSlidePlan(wide(), n));
    delete p.meta;
    n.knowledgeHash = FAKE_HASH; // slide plan still carries the real one
    const r = validateSlidePlan(p, { narrative: n });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "plan/narrative-knowledge-hash-mismatch")).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* P1 — self content-hash validation                                   */
/* ------------------------------------------------------------------ */

describe("self content-hash — tampering is detected", () => {
  it("NarrativePlan: editing the throughline without re-hashing is INVALID", () => {
    const p = clone(buildNarrativePlan(wide(), { audience: "general" }));
    p.throughline = `${p.throughline} WideCorp also consolidates twelve back-office tools.`;
    expect(p.meta?.contentHash).not.toBe(narrativeContentHash(p));
    const r = validateNarrativePlan(p);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "narrative/content-hash-mismatch")).toBe(true);
  });

  it("SlidePlan: editing a slide keyMessage without re-hashing is INVALID", () => {
    const n = buildNarrativePlan(wide(), { audience: "general" });
    const p = clone(buildSlidePlan(wide(), n));
    const target = p.slides[1] as PlannedSlide;
    target.keyMessage = `Tampered — ${target.keyMessage}`;
    expect(p.meta?.contentHash).not.toBe(slidePlanContentHash(p));
    const r = validateSlidePlan(p);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "plan/content-hash-mismatch")).toBe(true);
  });

  it("an untampered plan's meta.contentHash matches its canonical hash", () => {
    const n = buildNarrativePlan(wide(), { audience: "technical" });
    const s = buildSlidePlan(wide(), n);
    expect(n.meta?.contentHash).toBe(narrativeContentHash(n));
    expect(s.meta?.contentHash).toBe(slidePlanContentHash(s));
  });
});

/* ------------------------------------------------------------------ */
/* P1 — knowledge selection is a true partition                        */
/* ------------------------------------------------------------------ */

describe("knowledge selection partition", () => {
  const nat = (): NarrativePlan => clone(buildNarrativePlan(wide(), { audience: "technical" }));

  it("selected ∩ deprioritized is an ERROR", () => {
    const p = nat();
    delete p.meta;
    expect(p.selection.selected.length).toBeGreaterThan(0);
    p.selection.deprioritized.push(p.selection.selected[0] as string);
    const r = validateNarrativePlan(p);
    expect(r.errors.some((e) => e.code === "narrative/selection-conflict")).toBe(true);
  });

  it("deprioritized ∩ omitted is an ERROR", () => {
    const p = nat();
    delete p.meta;
    expect(p.selection.deprioritized.length).toBeGreaterThan(0);
    p.selection.omitted.push({
      id: p.selection.deprioritized[0] as string,
      reason: "low-priority",
    });
    const r = validateNarrativePlan(p);
    expect(r.errors.some((e) => e.code === "narrative/selection-conflict")).toBe(true);
  });

  it("a duplicate id inside one selection list is an ERROR", () => {
    const p = nat();
    delete p.meta;
    p.selection.selected.push(p.selection.selected[0] as string);
    const r = validateNarrativePlan(p);
    expect(r.errors.some((e) => e.code === "narrative/selection-duplicate")).toBe(true);
  });

  it("a classifiable knowledge id missing from every list is an ERROR", () => {
    const p = nat();
    delete p.meta;
    const gone = p.selection.omitted.pop() ?? { id: p.selection.deprioritized.pop() as string };
    expect(gone.id).toBeTruthy();
    // ensure it is not present elsewhere
    p.selection.selected = p.selection.selected.filter((id) => id !== gone.id);
    p.selection.deprioritized = p.selection.deprioritized.filter((id) => id !== gone.id);
    const r = validateNarrativePlan(p, wide());
    expect(r.valid).toBe(false);
    expect(
      r.errors.some((e) => e.code === "narrative/selection-unclassified" && e.entityId === gone.id),
    ).toBe(true);
  });

  it("a real plan is a clean partition of every classifiable id", () => {
    const p = buildNarrativePlan(wide(), { audience: "technical" });
    const r = validateNarrativePlan(p, wide());
    expect(r.errors).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* P1 — explainability after budget                                    */
/* ------------------------------------------------------------------ */

describe("post-budget explainability", () => {
  it("no surviving slide keeps a stale split marker after a sibling is dropped", () => {
    // different `kind` ⇒ the two parts cannot auto-merge; the budget drops one.
    const p1 = contentSlide({
      id: "p1",
      sectionId: "sec-y",
      kind: "content",
      title: "Deep dive (1/2)",
      keyMessage: "part 1 message",
      knowledgeRefs: ["k1"],
      priority: 2,
    });
    const p2 = contentSlide({
      id: "p2",
      sectionId: "sec-y",
      kind: "diagram",
      title: "Deep dive (2/2)",
      keyMessage: "part 2 message",
      knowledgeRefs: ["k2"],
      priority: 9, // lowest importance ⇒ dropped first
    });
    const decisions: PlanningDecision[] = [];
    const notes: PlanningNote[] = [];
    const out = applyBudget([cover, p1, p2, closing], tightBudget, decisions, notes);

    expect(out).toHaveLength(3);
    for (const s of out) expect(/\(\d+\/\d+\)$/.test(s.title)).toBe(false);
    expect(decisions.some((d) => d.code === "split-marker-repaired")).toBe(true);
  });

  it("every surviving slide still resolves against knowledge and narrative", () => {
    const k = wide();
    const n = buildNarrativePlan(k, { audience: "technical" });
    const p = buildSlidePlan(k, n, { minSlides: 4, targetSlides: 5, maxSlides: 6 });
    const r = validateSlidePlan(p, { narrative: n, knowledge: k });
    expect(r.valid, JSON.stringify(r.errors)).toBe(true);
    // a complete split is left untouched
    const repaired = p.decisions.filter((d) => d.code === "split-marker-repaired");
    for (const d of repaired) {
      const still = p.slides.find((s) => s.id === d.slideId);
      if (still) expect(/\(\d+\/\d+\)$/.test(still.title)).toBe(false);
    }
  });
});
