import { describe, expect, it } from "vitest";
import {
  type NarrativePlan,
  type ProjectKnowledge,
  type SlidePlan,
  buildNarrativePlan,
  buildSlidePlan,
  validateNarrativePlan,
  validateSlidePlan,
} from "../src/index.js";
import { clone, loadFixture } from "./helpers/fixtures.js";

const wide = () => loadFixture<ProjectKnowledge>("planning/wide-knowledge.json");

function narrative(): NarrativePlan {
  return buildNarrativePlan(wide(), { audience: "executive" });
}
function slidePlan(): SlidePlan {
  return buildSlidePlan(wide(), narrative());
}

describe("narrative-plan schema is strict", () => {
  it("rejects an unknown property", () => {
    const p = clone(narrative()) as unknown as Record<string, unknown>;
    p["colour"] = "blue";
    const r = validateNarrativePlan(p);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "schema/additional-properties")).toBe(true);
  });

  it("rejects an unknown audience", () => {
    const p = clone(narrative()) as unknown as Record<string, unknown>;
    p["audience"] = "board-of-directors";
    expect(validateNarrativePlan(p).valid).toBe(false);
  });

  it("rejects a section with no narrativePurpose", () => {
    const p = clone(narrative());
    delete (p.sections[1] as unknown as Record<string, unknown>)["narrativePurpose"];
    expect(validateNarrativePlan(p).valid).toBe(false);
  });
});

describe("narrative-plan semantic rules", () => {
  it("flags a generic throughline as an error", () => {
    const p = clone(narrative());
    p.throughline = "This presentation provides an overview of the project.";
    const r = validateNarrativePlan(p);
    expect(r.errors.some((e) => e.code === "narrative/throughline-generic")).toBe(true);
  });

  it("flags duplicate section ids", () => {
    const p = clone(narrative());
    if (p.sections[2]) p.sections[2].id = p.sections[1]?.id ?? "sec-x";
    const r = validateNarrativePlan(p);
    expect(r.errors.some((e) => e.code === "narrative/duplicate-section-id")).toBe(true);
  });

  it("flags a knowledgeRef that is not in the ProjectKnowledge", () => {
    const p = clone(narrative());
    p.sections[1]?.knowledgeRefs.push("ghost-entity");
    const r = validateNarrativePlan(p, wide());
    expect(r.errors.some((e) => e.code === "narrative/unknown-knowledge-ref")).toBe(true);
  });

  it("flags an id that is both selected and omitted", () => {
    const p = clone(narrative());
    const picked = p.selection.selected[0];
    if (picked) p.selection.omitted.push({ id: picked, reason: "low-priority" });
    const r = validateNarrativePlan(p);
    expect(r.errors.some((e) => e.code === "narrative/selection-conflict")).toBe(true);
  });

  it("a real plan validates clean against its knowledge", () => {
    const r = validateNarrativePlan(narrative(), wide());
    expect(r.errors).toEqual([]);
  });
});

describe("slide-plan schema is strict", () => {
  it("rejects an unknown property on a slide", () => {
    const p = clone(slidePlan());
    (p.slides[1] as unknown as unknown as Record<string, unknown>)["colour"] = "red";
    const r = validateSlidePlan(p);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "schema/additional-properties")).toBe(true);
  });

  it("rejects a keyMessage over the hard cap", () => {
    const p = clone(slidePlan());
    if (p.slides[1]) p.slides[1].keyMessage = "x".repeat(300);
    expect(validateSlidePlan(p).valid).toBe(false);
  });

  it("rejects an invalid visualIntent", () => {
    const p = clone(slidePlan()) as unknown as { slides: Array<Record<string, unknown>> };
    if (p.slides[1]) p.slides[1]["visualIntent"] = "explode";
    expect(validateSlidePlan(p as unknown as SlidePlan).valid).toBe(false);
  });
});

describe("slide-plan semantic rules", () => {
  it("flags non-contiguous slide indexes", () => {
    const p = clone(slidePlan());
    if (p.slides[2]) p.slides[2].index = 99;
    const r = validateSlidePlan(p);
    expect(r.errors.some((e) => e.code === "plan/slide-index-mismatch")).toBe(true);
  });

  it("flags a second cover slide", () => {
    const p = clone(slidePlan());
    if (p.slides[2]) p.slides[2].kind = "cover";
    const r = validateSlidePlan(p);
    expect(r.errors.some((e) => e.code === "plan/duplicate-cover")).toBe(true);
  });

  it("flags a metrics slide with no metric or claim reference", () => {
    const p = clone(slidePlan());
    if (p.slides[1]) {
      p.slides[1].kind = "metrics";
      p.slides[1].visualIntent = "metrics";
      p.slides[1].knowledgeRefs = [];
      p.slides[1].claimRefs = [];
    }
    const r = validateSlidePlan(p, { knowledge: wide() });
    expect(r.errors.some((e) => e.code === "plan/metrics-without-metric-refs")).toBe(true);
  });

  it("flags a roadmap slide with no temporal knowledge behind it", () => {
    const p = clone(slidePlan());
    if (p.slides[1]) {
      p.slides[1].kind = "roadmap";
      p.slides[1].visualIntent = "roadmap";
      p.slides[1].knowledgeRefs = [wide().capabilities[0]?.id ?? "cap-1"];
      delete (p.slides[1] as unknown as Record<string, unknown>)["visualCandidates"];
    }
    const r = validateSlidePlan(p, { knowledge: wide() });
    expect(r.errors.some((e) => e.code === "plan/roadmap-without-temporal")).toBe(true);
  });

  it("flags a budget violation with no explaining note", () => {
    const p = clone(slidePlan());
    p.budget = {
      minSlides: p.slides.length + 5,
      targetSlides: p.slides.length + 5,
      maxSlides: p.slides.length + 10,
    };
    p.notes = p.notes.filter((n) => n.code !== "planning/under-budget");
    const r = validateSlidePlan(p);
    expect(r.errors.some((e) => e.code === "plan/budget-under-unreported")).toBe(true);
  });

  it("flags an architecture intent with no relation (warning)", () => {
    const p = clone(slidePlan());
    if (p.slides[1]) {
      p.slides[1].visualIntent = "architecture";
      p.slides[1].knowledgeRefs = [wide().project.id];
      delete (p.slides[1] as unknown as Record<string, unknown>)["visualCandidates"];
    }
    const r = validateSlidePlan(p, { knowledge: wide() });
    expect(r.warnings.some((w) => w.code === "plan/architecture-without-relationship")).toBe(true);
  });

  it("flags a slide whose sectionId is not in the narrative", () => {
    const n = narrative();
    const p = clone(buildSlidePlan(wide(), n));
    if (p.slides[1]) p.slides[1].sectionId = "sec-nowhere";
    const r = validateSlidePlan(p, { narrative: n });
    expect(r.errors.some((e) => e.code === "plan/unknown-section")).toBe(true);
  });

  it("a real plan validates clean against its narrative and knowledge", () => {
    const n = narrative();
    const r = validateSlidePlan(buildSlidePlan(wide(), n), { narrative: n, knowledge: wide() });
    expect(r.errors).toEqual([]);
  });
});
