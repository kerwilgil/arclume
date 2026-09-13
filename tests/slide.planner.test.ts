import { describe, expect, it } from "vitest";
import {
  type AudienceName,
  type NarrativePlan,
  type ProjectKnowledge,
  buildNarrativePlan,
  buildSlidePlan,
  narrativeContentHash,
  planSlides,
  stableStringify,
  validateSlidePlan,
} from "../src/index.js";
import { loadFixture } from "./helpers/fixtures.js";

const rich = () => loadFixture<ProjectKnowledge>("knowledge/valid/rich.json");
const wide = () => loadFixture<ProjectKnowledge>("planning/wide-knowledge.json");
const sparse = () => loadFixture<ProjectKnowledge>("planning/sparse-knowledge.json");

function plan(
  k: ProjectKnowledge,
  audience: AudienceName,
  opts: Parameters<typeof buildSlidePlan>[2] = {},
): { narrative: NarrativePlan; slidePlan: ReturnType<typeof buildSlidePlan> } {
  const narrative = buildNarrativePlan(k, { audience });
  const slidePlan = buildSlidePlan(k, narrative, opts);
  const v = validateSlidePlan(slidePlan, { narrative, knowledge: k });
  expect(v.valid, JSON.stringify(v.errors)).toBe(true);
  return { narrative, slidePlan };
}

describe("SlidePlan — contract", () => {
  it("is versioned, provenanced and linked to its narrative", () => {
    const { narrative, slidePlan } = plan(rich(), "executive");
    expect(slidePlan.planVersion).toBe("0.1.0");
    expect(slidePlan.narrativeRef).toBe(narrativeContentHash(narrative));
    expect(slidePlan.knowledgeHash).toBe(rich().meta?.contentHash);
    expect(slidePlan.meta?.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("indexes are 0-based and contiguous", () => {
    const { slidePlan } = plan(wide(), "technical");
    slidePlan.slides.forEach((s, i) => expect(s.index).toBe(i));
  });

  it("one key message per slide — specific, backed, distinct from the title", () => {
    const { slidePlan } = plan(wide(), "general");
    const seen = new Set<string>();
    for (const s of slidePlan.slides) {
      const norm = s.keyMessage.replace(/\s+/g, " ").trim().toLowerCase();
      expect(norm.length).toBeGreaterThan(0);
      expect(norm).not.toBe(s.title.replace(/\s+/g, " ").trim().toLowerCase());
      expect(seen.has(norm)).toBe(false);
      seen.add(norm);
    }
  });

  it("has exactly one cover and one closing", () => {
    const { slidePlan } = plan(rich(), "technical");
    expect(slidePlan.slides.filter((s) => s.kind === "cover")).toHaveLength(1);
    expect(slidePlan.slides.filter((s) => s.kind === "closing")).toHaveLength(1);
    expect(slidePlan.slides[0]?.kind).toBe("cover");
    expect(slidePlan.slides.at(-1)?.kind).toBe("closing");
  });

  it("keeps provenance: every sourceRef resolves to a known source", () => {
    const k = rich();
    const sourceIds = new Set(k.sources.map((s) => s.id));
    const { slidePlan } = plan(k, "executive");
    for (const s of slidePlan.slides) {
      for (const ref of s.sourceRefs) expect(sourceIds.has(ref.sourceId)).toBe(true);
    }
    // the cover still carries the project's provenance
    expect(slidePlan.slides[0]?.sourceRefs.length).toBeGreaterThan(0);
  });
});

describe("SlidePlan — determinism", () => {
  it("byte-identical across runs for the same audience", () => {
    const k = wide();
    const n = buildNarrativePlan(k, { audience: "executive" });
    expect(stableStringify(buildSlidePlan(k, n))).toBe(stableStringify(buildSlidePlan(k, n)));
  });
});

describe("SlidePlan — budget", () => {
  it("defaults keep a rich deck within 8..16 slides", () => {
    const { slidePlan } = plan(rich(), "executive");
    expect(slidePlan.slides.length).toBeGreaterThanOrEqual(8);
    expect(slidePlan.slides.length).toBeLessThanOrEqual(16);
    expect(slidePlan.targetSlideCount).toBe(12);
  });

  it("under budget: keeps the short deck and records planning/under-budget — no fabrication", () => {
    const { slidePlan } = plan(sparse(), "executive");
    expect(slidePlan.slides.length).toBeLessThan(slidePlan.budget.minSlides);
    expect(slidePlan.notes.some((n) => n.code === "planning/under-budget")).toBe(true);
    // nothing invented: no metrics/architecture/roadmap slide from bare knowledge
    expect(slidePlan.slides.some((s) => s.kind === "metrics")).toBe(false);
    expect(slidePlan.slides.some((s) => s.kind === "roadmap")).toBe(false);
    expect(slidePlan.slides.some((s) => s.visualIntent === "architecture")).toBe(false);
    expect(slidePlan.slides.some((s) => s.visualIntent === "metrics")).toBe(false);
  });

  it("over budget: merges then drops the lowest-priority slides, with notes and decisions", () => {
    const { slidePlan } = plan(wide(), "technical", {
      minSlides: 4,
      targetSlides: 5,
      maxSlides: 6,
    });
    expect(slidePlan.slides.length).toBe(6);
    expect(slidePlan.notes.some((n) => n.code === "planning/over-budget-resolved")).toBe(true);
    expect(slidePlan.decisions.some((d) => d.code === "over-budget-resolved")).toBe(true);
    // cover + closing survive
    expect(slidePlan.slides[0]?.kind).toBe("cover");
    expect(slidePlan.slides.at(-1)?.kind).toBe("closing");
  });

  it("clamps an inconsistent budget and notes it", () => {
    const { slidePlan } = plan(rich(), "general", { minSlides: 10, maxSlides: 4 });
    expect(slidePlan.budget.maxSlides).toBeGreaterThanOrEqual(slidePlan.budget.minSlides);
    expect(slidePlan.notes.some((n) => n.code === "planning/budget-clamped")).toBe(true);
  });
});

describe("SlidePlan — grouping & splitting", () => {
  it("splits an oversized section into contiguous parts (non-executive)", () => {
    const { slidePlan } = plan(wide(), "technical");
    const splits = slidePlan.decisions.filter((d) => d.code === "topic-split");
    expect(splits.length).toBeGreaterThan(0);
    const parts = slidePlan.slides.filter((s) => /\(\d+\/\d+\)$/.test(s.title));
    expect(parts.length).toBeGreaterThanOrEqual(2);
  });

  it("executive never splits — it stays lean", () => {
    const { slidePlan } = plan(wide(), "executive");
    expect(slidePlan.decisions.some((d) => d.code === "topic-split")).toBe(false);
  });
});

describe("SlidePlan — visual & epistemic integrity", () => {
  it("a metrics slide references a real metric or supporting claim", () => {
    const k = rich();
    const metricIds = new Set(k.metrics.map((m) => m.id));
    const { slidePlan } = plan(k, "executive");
    for (const s of slidePlan.slides) {
      if (s.kind === "metrics" || s.visualIntent === "metrics") {
        const backed = s.knowledgeRefs.some((id) => metricIds.has(id)) || s.claimRefs.length > 0;
        expect(backed).toBe(true);
      }
    }
  });

  it("architecture visual intent is only chosen when a relation backs it", () => {
    const k = rich();
    const relIds = new Set(k.relations.map((r) => r.id));
    const { slidePlan } = plan(k, "technical");
    for (const s of slidePlan.slides) {
      if (s.visualIntent === "architecture") {
        const refs = [...s.knowledgeRefs, ...(s.visualCandidates ?? [])];
        expect(refs.some((id) => relIds.has(id))).toBe(true);
      }
    }
  });

  it("roadmap / timeline slides are backed by phases, milestones or PRECEDES", () => {
    const k = wide();
    const temporal = new Set<string>([
      ...k.phases.map((p) => p.id),
      ...k.milestones.map((m) => m.id),
      ...k.relations.filter((r) => r.type === "PRECEDES").map((r) => r.id),
    ]);
    const { slidePlan } = plan(k, "technical");
    for (const s of slidePlan.slides) {
      if (s.kind === "roadmap" || s.visualIntent === "roadmap") {
        const refs = [...s.knowledgeRefs, ...(s.visualCandidates ?? [])];
        expect(refs.some((id) => temporal.has(id))).toBe(true);
      }
    }
  });

  it("does not invent a metrics/architecture/roadmap slide from sparse knowledge", () => {
    const { slidePlan } = plan(sparse(), "technical", { minSlides: 4 });
    for (const s of slidePlan.slides) {
      expect(["metrics"]).not.toContain(s.kind);
      expect(["architecture", "roadmap", "metrics"]).not.toContain(s.visualIntent);
    }
  });
});

describe("SlidePlan — explainability", () => {
  it("records slide-added and visual-intent-selected decisions", () => {
    const { slidePlan } = plan(rich(), "executive");
    expect(slidePlan.decisions.some((d) => d.code === "slide-added")).toBe(true);
    expect(slidePlan.decisions.some((d) => d.code === "visual-intent-selected")).toBe(true);
    for (const d of slidePlan.decisions) {
      expect(d.decision.length).toBeGreaterThan(0);
      expect(d.reason.length).toBeGreaterThan(0);
    }
  });
});

describe("planSlides pipeline wrapper", () => {
  it("returns the real validation result", () => {
    const narrative = buildNarrativePlan(rich(), { audience: "general" });
    const out = planSlides(rich(), narrative);
    expect(out.validation.valid).toBe(true);
  });
});
