import { describe, expect, it } from "vitest";
import {
  type AudienceName,
  type ProjectKnowledge,
  buildNarrativePlan,
  planNarrative,
  stableStringify,
  validateNarrativePlan,
} from "../src/index.js";
import { clone, loadFixture } from "./helpers/fixtures.js";

const rich = () => loadFixture<ProjectKnowledge>("knowledge/valid/rich.json");
const wide = () => loadFixture<ProjectKnowledge>("planning/wide-knowledge.json");
const sparse = () => loadFixture<ProjectKnowledge>("planning/sparse-knowledge.json");

function plan(k: ProjectKnowledge, audience: AudienceName) {
  const p = buildNarrativePlan(k, { audience });
  expect(
    validateNarrativePlan(p, k).valid,
    JSON.stringify(validateNarrativePlan(p, k).errors),
  ).toBe(true);
  return p;
}

/** Shuffle every array in a ProjectKnowledge (semantically identical). */
function shuffled(k: ProjectKnowledge): ProjectKnowledge {
  const c = clone(k) as unknown as Record<string, unknown>;
  for (const key of Object.keys(c)) {
    if (Array.isArray(c[key])) c[key] = [...(c[key] as unknown[])].reverse();
  }
  return c as unknown as ProjectKnowledge;
}

describe("NarrativePlanner — contract", () => {
  it("produces a versioned, schema-valid plan with opening + closing sections", () => {
    const p = plan(rich(), "executive");
    expect(p.narrativeVersion).toBe("0.1.0");
    expect(p.sections[0]?.id).toBe("sec-opening");
    expect(p.sections.at(-1)?.id).toBe("sec-closing");
    expect(p.meta?.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(p.knowledgeHash).toBe(rich().meta?.contentHash);
  });

  it("derives a specific throughline from the knowledge, not a generic opener", () => {
    const p = plan(rich(), "general");
    expect(p.throughline).toContain("OrderFlow");
    expect(p.throughline.toLowerCase()).not.toMatch(/^this (presentation|deck|document)/);
    expect(p.throughline).toContain("purchase-order approval");
  });

  it("every section knowledgeRef is a real ProjectKnowledge id", () => {
    const k = wide();
    const ids = new Set<string>([k.project.id]);
    for (const key of Object.keys(k) as Array<keyof ProjectKnowledge>) {
      const v = k[key];
      if (Array.isArray(v))
        for (const e of v)
          if (e && typeof e === "object" && "id" in e) ids.add((e as { id: string }).id);
    }
    for (const section of plan(k, "technical").sections) {
      for (const ref of section.knowledgeRefs) expect(ids.has(ref)).toBe(true);
    }
  });
});

describe("NarrativePlanner — audience differentiation", () => {
  it("executive, technical and general are structurally different decks", () => {
    const k = wide();
    const exec = plan(k, "executive");
    const tech = plan(k, "technical");
    const gen = plan(k, "general");

    const titles = (p: ReturnType<typeof plan>) => p.sections.map((s) => s.id).join("|");
    expect(titles(exec)).not.toBe(titles(tech));
    expect(titles(tech)).not.toBe(titles(gen));

    const purposes = (p: ReturnType<typeof plan>) =>
      new Set(p.sections.map((s) => s.narrativePurpose));
    // executive leads with impact + evidence
    expect(purposes(exec).has("impact")).toBe(true);
    expect(purposes(exec).has("evidence")).toBe(true);
    // technical carries architecture + process, not impact
    expect(purposes(tech).has("architecture")).toBe(true);
    expect(purposes(tech).has("process")).toBe(true);
    expect(purposes(tech).has("impact")).toBe(false);
    // general leads with problem + capability
    expect(purposes(gen).has("problem")).toBe(true);
    expect(purposes(gen).has("capability")).toBe(true);
  });

  it("the same audience is byte-identical across runs; different audiences differ", () => {
    const k = wide();
    expect(stableStringify(buildNarrativePlan(k, { audience: "executive" }))).toBe(
      stableStringify(buildNarrativePlan(k, { audience: "executive" })),
    );
    expect(stableStringify(buildNarrativePlan(k, { audience: "executive" }))).not.toBe(
      stableStringify(buildNarrativePlan(k, { audience: "technical" })),
    );
  });

  it("is independent of the order of the knowledge collections", () => {
    const k = wide();
    for (const audience of ["executive", "technical", "general"] as const) {
      expect(stableStringify(buildNarrativePlan(shuffled(k), { audience }))).toBe(
        stableStringify(buildNarrativePlan(k, { audience })),
      );
    }
  });
});

describe("NarrativePlanner — selection & omission", () => {
  it("selection.selected are exactly the ids that landed in a section", () => {
    const p = plan(wide(), "technical");
    const used = new Set<string>();
    for (const s of p.sections) for (const id of s.knowledgeRefs) used.add(id);
    used.delete(wide().project.id);
    expect([...p.selection.selected].sort()).toEqual([...used].sort());
  });

  it("every omission carries a reason from the allowed set", () => {
    const allowed = new Set([
      "irrelevant-to-audience",
      "redundant",
      "insufficient-evidence",
      "low-priority",
      "slide-budget",
      "superseded",
    ]);
    const p = plan(wide(), "executive");
    for (const o of p.selection.omitted) expect(allowed.has(o.reason)).toBe(true);
    // executive gives dependencies/actors/requirements a weight of 1 or low → not "irrelevant"
    // but marks nothing selected+omitted at once
    const sel = new Set(p.selection.selected);
    for (const o of p.selection.omitted) expect(sel.has(o.id)).toBe(false);
  });

  it("records a section-omitted decision when knowledge cannot support a section", () => {
    // sparse knowledge has no components / metrics / results → executive drops
    // architecture, impact and evidence rather than inventing empty slides
    const p = plan(sparse(), "executive");
    const dropped = p.decisions.filter((d) => d.code === "section-omitted").map((d) => d.sectionId);
    expect(dropped).toContain("sec-architecture");
    expect(dropped).toContain("sec-impact");
    expect(dropped).toContain("sec-evidence");
    const ids = p.sections.map((s) => s.id);
    expect(ids).not.toContain("sec-architecture");
    expect(ids).not.toContain("sec-impact");
    // the one capability section IS kept — it has real backing
    expect(ids).toContain("sec-capabilities");
    // the single low-severity gap is surfaced (as a risk-shaped section), never invented
    expect(ids).toContain("sec-risks");
    expect(p.sections.find((s) => s.id === "sec-risks")?.knowledgeRefs).toEqual(["gap-scale"]);
  });
});

describe("NarrativePlanner — epistemic integrity", () => {
  it("never promotes a RECOMMENDATION or bare INFERENCE into a FACT-backed section", () => {
    const k = clone(rich());
    k.claims = [
      {
        id: "clm-rec",
        statement: "Adopt a queue for the webhook.",
        factType: "RECOMMENDATION",
        sourceRefs: [{ sourceId: "brief" }],
      },
      { id: "clm-inf", statement: "It probably scales.", factType: "INFERENCE", sourceRefs: [] },
    ];
    k.results = [];
    k.metrics = [];
    const p = plan(k, "executive");
    // evidence and impact sections only accept FACT claims / results / metrics —
    // with none present they are dropped, not filled with the recommendation
    expect(p.sections.map((s) => s.id)).not.toContain("sec-evidence");
    expect(p.sections.map((s) => s.id)).not.toContain("sec-impact");
    // the RECOMMENDATION never lands in any section
    for (const s of p.sections) expect(s.knowledgeRefs).not.toContain("clm-rec");
    expect(validateNarrativePlan(p, k).valid).toBe(true);
  });
});

describe("planNarrative pipeline wrapper", () => {
  it("returns the real validation result and never a fabricated one", () => {
    const out = planNarrative(rich(), { audience: "general" });
    expect(out.validation.valid).toBe(true);
    expect(Array.isArray(out.validation.warnings)).toBe(true);
  });

  it("defaults to the general audience", () => {
    expect(planNarrative(rich()).narrative.audience).toBe("general");
  });
});
