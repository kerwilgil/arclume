import { describe, expect, it } from "vitest";
import {
  DEFAULT_VISUAL_LIMITS,
  type ProjectKnowledge,
  type SlidePlan,
  buildKnowledgeView,
  buildSlideBlocks,
  executiveTheme,
  minimalTheme,
  resolveVisual,
  runDeck,
  themeTokensRef,
  validateArclumeDeck,
} from "../src/index.js";
import { clone, loadFixture } from "./helpers/fixtures.js";

const rich = () => loadFixture<ProjectKnowledge>("knowledge/valid/rich.json");
const L = DEFAULT_VISUAL_LIMITS;

/* ------------------------------------------------------------------ */
/* helpers for the unit-level quote / status checks                     */
/* ------------------------------------------------------------------ */

const EMPTY_COLLECTIONS = {
  capabilities: [],
  components: [],
  actors: [],
  dependencies: [],
  processes: [],
  phases: [],
  milestones: [],
  metrics: [],
  risks: [],
  decisions: [],
  requirements: [],
  technologies: [],
  results: [],
  constraints: [],
  relations: [],
  claims: [],
  gaps: [],
};

function knowledge(over: Partial<ProjectKnowledge>): ProjectKnowledge {
  return {
    knowledgeVersion: "0.1.0",
    project: { id: "proj", name: "Demo", sourceRefs: [] },
    sources: [{ id: "brief", kind: "pdf", title: "The brief" }],
    ...EMPTY_COLLECTIONS,
    ...over,
  } as ProjectKnowledge;
}

function plannedSlide(over: Record<string, unknown>) {
  return {
    id: "slide-x",
    index: 1,
    sectionId: "sec-x",
    kind: "content",
    title: "X",
    keyMessage: "a message",
    narrativePurpose: "evidence",
    knowledgeRefs: [],
    claimRefs: [],
    sourceRefs: [],
    contentIntent: "content",
    visualIntent: "quote",
    density: "low",
    priority: 5,
    ...over,
  } as Parameters<typeof buildSlideBlocks>[0]["slide"];
}

/* ------------------------------------------------------------------ */
/* P1 — quote must be verbatim evidence                                 */
/* ------------------------------------------------------------------ */

describe("quote integrity", () => {
  it("ACCEPTs quote only when a verbatim SourceRef.quote exists, and uses it exactly", () => {
    const k = knowledge({
      claims: [
        {
          id: "clm-1",
          statement: "The pilot cut cycle time dramatically.",
          factType: "FACT",
          sourceRefs: [{ sourceId: "brief", quote: "cycle time fell from 4d to 1.2d" }],
        },
      ],
    });
    const view = buildKnowledgeView(k);
    const slide = plannedSlide({
      visualIntent: "quote",
      claimRefs: ["clm-1"],
      knowledgeRefs: ["clm-1"],
    });

    const r = resolveVisual(slide, view, L);
    expect(r.visualKind).toBe("quote");
    expect(r.outcome).toBe("accepted");

    const built = buildSlideBlocks({
      slide,
      view,
      visualKind: "quote",
      limits: L,
      mintId: (b) => `b-${b}`,
    });
    const q = built.blocks.find((b) => b.type === "quote");
    expect(q).toBeDefined();
    if (q && q.type === "quote") {
      expect(q.text).toBe("cycle time fell from 4d to 1.2d");
      expect(q.text).not.toBe("The pilot cut cycle time dramatically.");
      expect(q.attribution).toBe("The brief");
    }
  });

  it("a sourced claim WITHOUT a verbatim quote never becomes a QuoteBlock", () => {
    const k = knowledge({
      claims: [
        {
          id: "clm-2",
          statement: "It probably scales to 10k/day.",
          factType: "INFERENCE",
          sourceRefs: [{ sourceId: "brief" }], // sourced, but no `quote`
        },
      ],
    });
    const view = buildKnowledgeView(k);
    const slide = plannedSlide({
      visualIntent: "quote",
      claimRefs: ["clm-2"],
      knowledgeRefs: ["clm-2"],
    });

    const r = resolveVisual(slide, view, L);
    expect(r.visualKind).toBe("summary");
    expect(r.outcome).toBe("downgraded");

    const built = buildSlideBlocks({
      slide,
      view,
      visualKind: "quote",
      limits: L,
      mintId: (b) => `b-${b}`,
    });
    expect(built.blocks.some((b) => b.type === "quote")).toBe(false);
    expect(built.blocks.some((b) => b.type === "text")).toBe(true);
  });

  it("a result statement without a verbatim quote never becomes a QuoteBlock", () => {
    const k = knowledge({
      results: [
        { id: "res-1", statement: "Cycle time fell 70%.", sourceRefs: [{ sourceId: "brief" }] },
      ],
    });
    const view = buildKnowledgeView(k);
    const slide = plannedSlide({ visualIntent: "quote", knowledgeRefs: ["res-1"] });

    expect(resolveVisual(slide, view, L).visualKind).toBe("summary");
    const built = buildSlideBlocks({
      slide,
      view,
      visualKind: "quote",
      limits: L,
      mintId: (b) => `b-${b}`,
    });
    expect(built.blocks.some((b) => b.type === "quote")).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* P1 — status must not invent project health                           */
/* ------------------------------------------------------------------ */

describe("status epistemic integrity", () => {
  function statusBlock(
    phaseStatuses: Array<"planned" | "active" | "done" | "blocked" | "cancelled">,
    gaps: number,
  ) {
    const k = knowledge({
      phases: phaseStatuses.map((s, i) => ({
        id: `ph-${i}`,
        name: `Phase ${i}`,
        status: s,
        sourceRefs: [{ sourceId: "brief" }],
      })),
      gaps: Array.from({ length: gaps }, (_, i) => ({ id: `gap-${i}`, question: `Q${i}?` })),
      project: { id: "proj", name: "Demo", status: "In pilot with two customers.", sourceRefs: [] },
    });
    const view = buildKnowledgeView(k);
    const refs = [...k.phases.map((p) => p.id), ...k.gaps.map((g) => g.id)];
    const slide = plannedSlide({ visualIntent: "status", knowledgeRefs: refs });
    const built = buildSlideBlocks({
      slide,
      view,
      visualKind: "status",
      limits: L,
      mintId: (b) => `b-${b}`,
    });
    return built.blocks.find((b) => b.type === "status");
  }

  it("an active phase does not become amber by inference", () => {
    const b = statusBlock(["active"], 0);
    expect(b?.type).toBe("status");
    if (b?.type === "status") expect(b.state).toBe("unknown");
  });

  it("all phases done does not become green unless explicitly supported", () => {
    const b = statusBlock(["done", "done"], 0);
    if (b?.type === "status") expect(b.state).toBe("unknown");
  });

  it("a blocked phase keeps the textual fact but invents no red health rating", () => {
    const b = statusBlock(["blocked", "active"], 0);
    if (b?.type === "status") {
      expect(b.state).toBe("unknown");
      expect(`${b.label} ${b.detail ?? ""}`).toMatch(/blocked/i);
    }
  });

  it("open gaps do not force amber", () => {
    const b = statusBlock(["planned"], 3);
    if (b?.type === "status") {
      expect(b.state).toBe("unknown");
      expect(`${b.label} ${b.detail ?? ""}`).toMatch(/open question/i);
    }
  });

  it("the status block keeps its provenance", () => {
    const b = statusBlock(["active"], 1);
    expect(b?.sourceRefs?.length ?? 0).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ */
/* P1 — native diagram topology integrity                               */
/* ------------------------------------------------------------------ */

describe("native diagram topology integrity", () => {
  const base = () => {
    const k = rich();
    const { deck, narrative, slidePlan } = runDeck(k, { audience: "technical" });
    return { k, deck, narrative, slidePlan };
  };

  function archDiagram(deck: { diagrams: Array<{ diagramType: string; spec?: unknown }> }) {
    return deck.diagrams.find(
      (d) =>
        d.diagramType === "architecture" &&
        (d.spec as { format?: string })?.format === "arclume.native.v1",
    );
  }

  it("the untampered deck validates clean against its inputs", () => {
    const { deck, k, narrative, slidePlan } = base();
    expect(validateArclumeDeck(deck, { knowledge: k, narrative, slidePlan }).valid).toBe(true);
  });

  it("a legitimate relation drawn between the wrong endpoints is INVALID", () => {
    const { deck, k, narrative, slidePlan } = base();
    const d = clone(deck);
    const dg = archDiagram(d);
    const spec = dg?.spec as {
      nodes: Array<{ id: string; entityId: string }>;
      edges: Array<{ from: string; to: string }>;
    };
    // repoint the first edge's `from` at a different existing node
    const other = spec.nodes.find((n) => n.id !== spec.edges[0]?.from);
    if (spec.edges[0] && other) spec.edges[0].from = other.id;
    const r = validateArclumeDeck(d, { knowledge: k, narrative, slidePlan });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "deck/diagram-topology-mismatch")).toBe(true);
  });

  it("a legitimate relation reversed is INVALID", () => {
    const { deck, k, narrative, slidePlan } = base();
    const d = clone(deck);
    const spec = archDiagram(d)?.spec as { edges: Array<{ from: string; to: string }> };
    if (spec.edges[0]) {
      const { from, to } = spec.edges[0];
      spec.edges[0].from = to;
      spec.edges[0].to = from;
    }
    const r = validateArclumeDeck(d, { knowledge: k, narrative, slidePlan });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "deck/diagram-topology-mismatch")).toBe(true);
  });

  it("a legitimate relation with the wrong relationType is INVALID", () => {
    const { deck, k, narrative, slidePlan } = base();
    const d = clone(deck);
    const spec = archDiagram(d)?.spec as { edges: Array<{ relationType: string }> };
    if (spec.edges[0]) spec.edges[0].relationType = "MITIGATES";
    const r = validateArclumeDeck(d, { knowledge: k, narrative, slidePlan });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "deck/diagram-relation-type-mismatch")).toBe(true);
  });

  it("an edge endpoint that is not an internal node is INVALID", () => {
    const { deck, k, narrative, slidePlan } = base();
    const d = clone(deck);
    const spec = archDiagram(d)?.spec as { edges: Array<{ from: string }> };
    if (spec.edges[0]) spec.edges[0].from = "n-ghost-node";
    const r = validateArclumeDeck(d, { knowledge: k, narrative, slidePlan });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "deck/diagram-endpoint-missing")).toBe(true);
  });

  it("a node missing entityId is INVALID", () => {
    const { deck, k, narrative, slidePlan } = base();
    const d = clone(deck);
    const spec = archDiagram(d)?.spec as { nodes: Array<Record<string, unknown>> };
    if (spec.nodes[0]) delete spec.nodes[0]["entityId"];
    const r = validateArclumeDeck(d, { knowledge: k, narrative, slidePlan });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "deck/diagram-node-ref-missing")).toBe(true);
  });

  it("a native diagram node with an unknown entityId is INVALID", () => {
    const { deck, k, narrative, slidePlan } = base();
    const d = clone(deck);
    const spec = archDiagram(d)?.spec as { nodes: Array<{ entityId: string }> };
    if (spec.nodes[0]) spec.nodes[0].entityId = "ghost-entity";
    const r = validateArclumeDeck(d, { knowledge: k, narrative, slidePlan });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "deck/unknown-diagram-ref")).toBe(true);
  });

  it("a flow edge backed by a non-PRECEDES relation is INVALID", () => {
    // hand-build a minimal deck with a native process spec whose edge cites a
    // real relation of the wrong type
    const k = rich();
    const { deck, narrative, slidePlan } = runDeck(k, { audience: "technical" });
    const d = clone(deck);
    const rel = k.relations.find((r) => r.type !== "PRECEDES");
    if (!rel) throw new Error("fixture needs a non-PRECEDES relation");
    d.diagrams.push({
      id: "dgm-fake-flow",
      engine: "native",
      diagramType: "workflow",
      spec: {
        format: "arclume.native.v1",
        kind: "process",
        condensed: false,
        steps: [
          { id: `s-${rel.from}`, label: "A", ref: rel.from, index: 0 },
          { id: `s-${rel.to}`, label: "B", ref: rel.to, index: 1 },
        ],
        edges: [{ id: "f-x", from: `s-${rel.from}`, to: `s-${rel.to}`, relationId: rel.id }],
      },
    });
    const r = validateArclumeDeck(d, { knowledge: k, narrative, slidePlan });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "deck/diagram-relation-type-mismatch")).toBe(true);
  });

  it("a native step missing its ref is INVALID", () => {
    const k = rich();
    const { deck, narrative, slidePlan } = runDeck(k, { audience: "technical" });
    const d = clone(deck);
    d.diagrams.push({
      id: "dgm-fake-flow2",
      engine: "native",
      diagramType: "workflow",
      spec: {
        format: "arclume.native.v1",
        kind: "sequence",
        condensed: false,
        steps: [{ id: "s-1", label: "A", index: 0 }],
        edges: [],
      },
    });
    const r = validateArclumeDeck(d, { knowledge: k, narrative, slidePlan });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "deck/diagram-edge-incomplete")).toBe(true);
  });

  it("a native process edge with from/to but no relationId is INVALID", () => {
    const k = rich();
    const { deck, narrative, slidePlan } = runDeck(k, { audience: "technical" });
    const d = clone(deck);
    d.diagrams.push({
      id: "dgm-flow-no-rel",
      engine: "native",
      diagramType: "workflow",
      spec: {
        format: "arclume.native.v1",
        kind: "process",
        condensed: false,
        steps: [
          { id: "s-a", label: "A", ref: "cmp-ui", index: 0 },
          { id: "s-b", label: "B", ref: "cmp-api", index: 1 },
        ],
        // structural edge with endpoints but no provenance — must be rejected
        edges: [{ id: "f-x", from: "s-a", to: "s-b" }],
      },
    });
    const r = validateArclumeDeck(d, { knowledge: k, narrative, slidePlan });
    expect(r.valid).toBe(false);
    const hit = r.errors.find((e) => e.code === "deck/diagram-edge-incomplete");
    expect(hit).toBeDefined();
    expect(hit?.message).toContain("relationId");
  });

  it("a native sequence edge with from/to but no relationId is INVALID", () => {
    const k = rich();
    const { deck, narrative, slidePlan } = runDeck(k, { audience: "technical" });
    const d = clone(deck);
    d.diagrams.push({
      id: "dgm-seq-no-rel",
      engine: "native",
      diagramType: "workflow",
      spec: {
        format: "arclume.native.v1",
        kind: "sequence",
        condensed: false,
        steps: [
          { id: "s-a", label: "A", ref: "cmp-ui", index: 0 },
          { id: "s-b", label: "B", ref: "cmp-api", index: 1 },
        ],
        edges: [{ id: "f-x", from: "s-a", to: "s-b" }],
      },
    });
    const r = validateArclumeDeck(d, { knowledge: k, narrative, slidePlan });
    expect(r.valid).toBe(false);
    const hit = r.errors.find((e) => e.code === "deck/diagram-edge-incomplete");
    expect(hit).toBeDefined();
    expect(hit?.message).toContain("relationId");
  });
});

/* ------------------------------------------------------------------ */
/* P1 — theme integrity                                                 */
/* ------------------------------------------------------------------ */

describe("theme integrity", () => {
  const ctx = () => {
    const k = rich();
    const { deck, narrative, slidePlan } = runDeck(k, {
      audience: "executive",
      theme: "executive",
    });
    return { k, deck, narrative, slidePlan };
  };

  it("a correct theme + tokensRef validates", () => {
    const { deck, k, narrative, slidePlan } = ctx();
    expect(deck.theme.tokensRef).toBe(themeTokensRef(executiveTheme));
    expect(validateArclumeDeck(deck, { knowledge: k, narrative, slidePlan }).valid).toBe(true);
  });

  it("minimal name + executive tokensRef is INVALID", () => {
    const { deck, k, narrative, slidePlan } = ctx();
    const d = clone(deck);
    d.theme.name = "minimal";
    // tokensRef still the executive one
    const r = validateArclumeDeck(d, { knowledge: k, narrative, slidePlan });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "deck/theme-tokens-ref-mismatch")).toBe(true);
  });

  it("a tampered tokensRef is INVALID", () => {
    const { deck, k, narrative, slidePlan } = ctx();
    const d = clone(deck);
    d.theme.tokensRef = "tokens:executive:deadbeefdeadbeef";
    const r = validateArclumeDeck(d, { knowledge: k, narrative, slidePlan });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "deck/theme-tokens-ref-mismatch")).toBe(true);
  });

  it("a missing tokensRef on an implemented theme is INVALID", () => {
    const { deck, k, narrative, slidePlan } = ctx();
    const d = clone(deck) as unknown as { theme: Record<string, unknown> };
    delete d.theme["tokensRef"];
    const r = validateArclumeDeck(d as unknown as typeof deck, {
      knowledge: k,
      narrative,
      slidePlan,
    });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "deck/theme-tokens-ref-missing")).toBe(true);
  });

  it("an unknown / unimplemented theme is an ERROR (not a warning)", () => {
    const { deck, k, narrative, slidePlan } = ctx();
    const d = clone(deck) as unknown as { theme: { name: string } };
    d.theme.name = "corporate";
    const r = validateArclumeDeck(d as unknown as typeof deck, {
      knowledge: k,
      narrative,
      slidePlan,
    });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "deck/theme-unimplemented")).toBe(true);
    expect(r.warnings.some((w) => w.code === "deck/theme-unimplemented")).toBe(false);
  });

  it("minimal + its own tokensRef also validates", () => {
    const k = rich();
    const { deck, narrative, slidePlan } = runDeck(k, { audience: "technical", theme: "minimal" });
    expect(deck.theme.tokensRef).toBe(themeTokensRef(minimalTheme));
    expect(validateArclumeDeck(deck, { knowledge: k, narrative, slidePlan }).valid).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* P1 — narrative text binding                                          */
/* ------------------------------------------------------------------ */

describe("narrative binding — throughline is verbatim", () => {
  it("an altered throughline is an ERROR when the NarrativePlan is supplied", () => {
    const k = rich();
    const { deck, narrative, slidePlan } = runDeck(k, { audience: "executive" });
    const d = clone(deck);
    d.narrative.throughline = "A completely different narrative claim about the project.";
    const r = validateArclumeDeck(d, { knowledge: k, narrative, slidePlan });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "deck/throughline-altered")).toBe(true);
    expect(r.warnings.some((w) => w.code === "deck/throughline-altered")).toBe(false);
  });

  it("the verbatim throughline validates", () => {
    const k = rich();
    const { deck, narrative, slidePlan } = runDeck(k, { audience: "executive" });
    expect(validateArclumeDeck(deck, { knowledge: k, narrative, slidePlan }).valid).toBe(true);
  });
});
