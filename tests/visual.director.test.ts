import { describe, expect, it } from "vitest";
import {
  type AudienceName,
  type ProjectKnowledge,
  buildNarrativePlan,
  buildSlidePlan,
  buildVisualDeck,
  formatValidationReport,
  narrativeContentHash,
  slidePlanContentHash,
  stableStringify,
  validateArclumeDeck,
} from "../src/index.js";
import { clone, loadFixture } from "./helpers/fixtures.js";

const rich = () => loadFixture<ProjectKnowledge>("knowledge/valid/rich.json");
const wide = () => loadFixture<ProjectKnowledge>("planning/wide-knowledge.json");
const sparse = () => loadFixture<ProjectKnowledge>("planning/sparse-knowledge.json");

function build(
  k: ProjectKnowledge,
  audience: AudienceName,
  opts: Parameters<typeof buildVisualDeck>[0]["theme"] | undefined = undefined,
) {
  const narrative = buildNarrativePlan(k, { audience });
  const slidePlan = buildSlidePlan(k, narrative);
  const r = buildVisualDeck({
    knowledge: k,
    narrative,
    slidePlan,
    ...(opts ? { theme: opts } : {}),
  });
  return { narrative, slidePlan, ...r };
}

function knowledgeIdSet(k: ProjectKnowledge): Set<string> {
  const ids = new Set<string>([k.project.id]);
  for (const key of Object.keys(k) as Array<keyof ProjectKnowledge>) {
    const v = k[key];
    if (Array.isArray(v))
      for (const e of v)
        if (e && typeof e === "object" && "id" in e) ids.add((e as { id: string }).id);
  }
  return ids;
}

describe("VisualDirector — deck construction", () => {
  it("turns a SlidePlan into a schema- and context-valid ArclumeDeck", () => {
    const { deck, validation } = build(rich(), "executive");
    expect(validation.valid, formatValidationReport(validation)).toBe(true);
    expect(deck.irVersion).toBe("0.2.0");
    expect(deck.slides.length).toBeGreaterThan(0);
    deck.slides.forEach((s, i) => expect(s.index).toBe(i));
    expect(deck.slides[0]?.kind).toBe("cover");
    expect(deck.slides.at(-1)?.kind).toBe("closing");
  });

  it("binds the deck to its three inputs by hash", () => {
    const { deck, narrative, slidePlan } = build(wide(), "technical");
    expect(deck.provenance.knowledgeHash).toBe(wide().meta?.contentHash);
    expect(deck.provenance.narrativeRef).toBe(narrativeContentHash(narrative));
    expect(deck.provenance.slidePlanRef).toBe(slidePlanContentHash(slidePlan));
  });

  it("rejects a stale / mixed artifact set", () => {
    const { deck, narrative } = build(rich(), "executive");
    const otherNarrative = buildNarrativePlan(wide(), { audience: "executive" });
    const r = validateArclumeDeck(deck, { narrative: otherNarrative });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "deck/narrative-ref-mismatch")).toBe(true);
    // sanity: the real narrative still validates
    expect(validateArclumeDeck(deck, { narrative }).valid).toBe(true);
  });

  it("preserves every keyMessage verbatim (whitespace only)", () => {
    for (const audience of ["executive", "technical", "general"] as const) {
      const { deck, slidePlan } = build(wide(), audience);
      deck.slides.forEach((s, i) => {
        const planned = slidePlan.slides[i];
        expect(planned).toBeDefined();
        const norm = (t: string) => t.replace(/\s+/g, " ").trim();
        expect(norm(s.keyMessage)).toBe(norm(planned?.keyMessage ?? ""));
        expect(s.id).toBe(planned?.id);
        expect(s.narrativePurpose).toBe(planned?.narrativePurpose);
      });
    }
  });

  it("invents no knowledge: every metric / risk / diagram reference resolves", () => {
    const k = rich();
    const ids = knowledgeIdSet(k);
    const metricIds = new Set(k.metrics.map((m) => m.id));
    const riskOrGap = new Set([...k.risks.map((r) => r.id), ...k.gaps.map((g) => g.id)]);
    const relIds = new Set(k.relations.map((r) => r.id));
    const temporal = new Set([...k.phases.map((p) => p.id), ...k.milestones.map((m) => m.id)]);
    const { deck } = build(k, "technical");

    for (const s of deck.slides) {
      for (const b of s.blocks) {
        if (b.type === "metric" && b.metricId) expect(metricIds.has(b.metricId)).toBe(true);
        if (b.type === "metric-grid")
          for (const m of b.metrics) if (m.metricId) expect(metricIds.has(m.metricId)).toBe(true);
        if (b.type === "risk" && b.riskId) expect(riskOrGap.has(b.riskId)).toBe(true);
        if (b.type === "timeline")
          for (const it of b.items) if (it.id) expect(temporal.has(it.id)).toBe(true);
        if (b.type === "roadmap")
          for (const ph of b.phases) if (ph.id) expect(temporal.has(ph.id)).toBe(true);
      }
    }
    for (const d of deck.diagrams) {
      const spec = d.spec as {
        nodes?: Array<{ entityId: string }>;
        edges?: Array<{ relationId: string }>;
        steps?: Array<{ ref: string }>;
        items?: Array<{ ref: string }>;
      };
      for (const n of spec.nodes ?? []) expect(ids.has(n.entityId)).toBe(true);
      for (const e of spec.edges ?? [])
        if ("relationId" in e) expect(relIds.has(e.relationId)).toBe(true);
      for (const st of spec.steps ?? []) expect(ids.has(st.ref)).toBe(true);
      for (const it of spec.items ?? []) expect(ids.has(it.ref)).toBe(true);
    }
  });

  it("marks exactly one block per slide as the primary idea", () => {
    const { deck } = build(wide(), "executive");
    for (const s of deck.slides) {
      const emphasised = s.blocks.filter((b) => b.emphasis === true);
      expect(emphasised.length).toBeLessThanOrEqual(1);
      if (s.blocks.length > 0) expect(emphasised.length).toBe(1);
    }
  });

  it("is deterministic and independent of knowledge collection order", () => {
    const k = wide();
    const shuffled = clone(k) as unknown as Record<string, unknown>;
    for (const key of Object.keys(shuffled)) {
      if (Array.isArray(shuffled[key])) shuffled[key] = [...(shuffled[key] as unknown[])].reverse();
    }
    for (const audience of ["executive", "technical", "general"] as const) {
      const a = build(k, audience).deck;
      const b = build(k, audience).deck;
      expect(stableStringify(a)).toBe(stableStringify(b));
      const c = build(shuffled as unknown as ProjectKnowledge, audience).deck;
      expect(stableStringify(c)).toBe(stableStringify(a));
    }
  });
});

describe("VisualDirector — visual intent resolution", () => {
  it("accepts architecture when a real relation backs it, downgrades otherwise", () => {
    const { deck, decisions } = build(rich(), "technical");
    const arch = decisions.filter((d) => d.requestedIntent === "architecture");
    expect(arch.length).toBeGreaterThan(0);
    for (const d of arch) {
      if (d.resolvedVisual === "architecture") {
        expect(["accepted"]).toContain(d.outcome);
        // there is an architecture diagram with at least one edge
        const dg = deck.diagrams.find((x) => x.diagramType === "architecture");
        expect(dg).toBeDefined();
        expect((dg?.spec as { edges: unknown[] }).edges.length).toBeGreaterThan(0);
      }
    }
  });

  it("downgrades architecture to a summary/relationship when no relation connects two nodes", () => {
    // sparse knowledge has no components + relations
    const { decisions } = build(sparse(), "technical");
    const arch = decisions.find((d) => d.requestedIntent === "architecture");
    if (arch) expect(["summary", "relationship"]).toContain(arch.resolvedVisual);
  });

  it("only builds a metrics visual when a real metric value (or FACT claim) exists", () => {
    const { deck } = build(sparse(), "executive");
    for (const s of deck.slides) {
      expect(s.blocks.some((b) => b.type === "metric" || b.type === "metric-grid")).toBe(false);
    }
    const richDeck = build(rich(), "general").deck;
    expect(
      richDeck.slides.some((s) =>
        s.blocks.some((b) => b.type === "metric" || b.type === "metric-grid"),
      ),
    ).toBe(true);
  });

  it("records an explainable decision for every slide", () => {
    const { deck, decisions } = build(rich(), "executive");
    for (const s of deck.slides) {
      const forSlide = decisions.filter((d) => d.slideId === s.id);
      expect(forSlide.some((d) => d.code.startsWith("visual-"))).toBe(true);
      expect(forSlide.some((d) => d.code === "layout-selected")).toBe(true);
      expect(forSlide.some((d) => d.code === "blocks-selected")).toBe(true);
      for (const d of forSlide) expect(d.reason.length).toBeGreaterThan(0);
    }
  });
});

describe("VisualDirector — sparse vs rich", () => {
  it("sparse knowledge produces a small, honest deck with no fabricated visuals", () => {
    const { deck, validation } = build(sparse(), "executive");
    expect(validation.valid).toBe(true);
    expect(deck.diagrams).toHaveLength(0);
    for (const s of deck.slides) {
      expect(
        s.blocks.every(
          (b) =>
            b.type === "text" || b.type === "risk" || b.type === "status" || b.type === "callout",
        ),
      ).toBe(true);
    }
  });

  it("rich knowledge exercises a structural diagram, metrics, risk and status", () => {
    const { deck } = build(rich(), "executive");
    const kinds = new Set(deck.slides.flatMap((s) => s.blocks.map((b) => b.type)));
    expect(kinds.has("architecture")).toBe(true);
    expect([...kinds].some((k) => k === "metric" || k === "metric-grid")).toBe(true);
    expect(kinds.has("risk")).toBe(true);
    expect(kinds.has("status")).toBe(true);
    expect(new Set(deck.slides.map((s) => s.layout)).size).toBeGreaterThan(1);
  });
});
