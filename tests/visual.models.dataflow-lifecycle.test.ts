/**
 * Knowledge-derived dataflow + lifecycle models (Visual Intelligence, Slice 2B).
 *
 * `buildDataflowModel` turns real PRODUCES / CONSUMES / DERIVED_FROM relations
 * into a directed data graph; `buildLifecycleModel` turns a real
 * phase + PRECEDES state structure into states + transitions. Neither invents
 * a node or an edge, both are deterministic, and both route cleanly through
 * the Slice 2a geometry planner + Visual Engine adapter.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_VISUAL_LIMITS,
  type ProjectKnowledge,
  buildDataflowModel,
  buildKnowledgeView,
  buildLifecycleModel,
  modelKnowledgeRefs,
  nativeDiagramAdapter,
} from "../src/index.js";
import { applyDiagramEnginePreference } from "../src/pipeline/diagram-engine-preference.js";
import { resolveDiagramEngines } from "../src/pipeline/resolve-diagrams.js";
import type { ArclumeDeck, DiagramIR } from "../src/types/deck.js";

const L = DEFAULT_VISUAL_LIMITS;

const EMPTY = {
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
    ...EMPTY,
    ...over,
  } as ProjectKnowledge;
}

const sr = [{ sourceId: "brief" }];

function dataflowKnowledge(): ProjectKnowledge {
  return knowledge({
    components: [
      { id: "cmp-a", name: "Importer", kind: "service", sourceRefs: sr },
      { id: "cmp-b", name: "Warehouse", kind: "store", sourceRefs: sr },
      { id: "cmp-c", name: "Dashboard", kind: "ui", sourceRefs: sr },
    ],
    relations: [
      { id: "rel-2", from: "cmp-c", to: "cmp-b", type: "CONSUMES", sourceRefs: sr },
      { id: "rel-1", from: "cmp-a", to: "cmp-b", type: "PRODUCES", sourceRefs: sr },
    ],
  });
}

function dataflowIds(k: ProjectKnowledge): string[] {
  return [...k.components.map((c) => c.id), ...k.relations.map((r) => r.id)];
}

const deckOf = (diagrams: DiagramIR[]): ArclumeDeck => ({ diagrams }) as unknown as ArclumeDeck;

describe("buildDataflowModel — from PRODUCES / CONSUMES relations", () => {
  it("derives a directed data graph; PRODUCES keeps direction, CONSUMES reverses it", () => {
    const k = dataflowKnowledge();
    const model = buildDataflowModel(buildKnowledgeView(k), dataflowIds(k), L);
    expect(model?.kind).toBe("dataflow");
    if (model?.kind !== "dataflow") return;

    // every node traces to a real entity, every flow to a real relation
    expect(model.nodes.map((n) => n.entityId).sort()).toEqual(["cmp-a", "cmp-b", "cmp-c"]);
    expect(model.flows.map((f) => f.relationId).sort()).toEqual(["rel-1", "rel-2"]);

    const flow = new Map(model.flows.map((f) => [f.relationId, [f.from, f.to]]));
    expect(flow.get("rel-1")).toEqual(["df-cmp-a", "df-cmp-b"]); // A PRODUCES B  →  A → B
    expect(flow.get("rel-2")).toEqual(["df-cmp-b", "df-cmp-c"]); // C CONSUMES B  →  B → C
  });

  it("layers nodes into stages by longest path and maps entity kind → node type", () => {
    const k = dataflowKnowledge();
    const model = buildDataflowModel(buildKnowledgeView(k), dataflowIds(k), L);
    if (model?.kind !== "dataflow") throw new Error("expected dataflow");
    const stageOf = new Map(model.nodes.map((n) => [n.entityId, n.stage]));
    expect(stageOf.get("cmp-a")).toBe(0);
    expect(stageOf.get("cmp-b")).toBe(1);
    expect(stageOf.get("cmp-c")).toBe(2);
    expect(model.stages).toHaveLength(3);

    const typeOf = new Map(model.nodes.map((n) => [n.entityId, n.type]));
    expect(typeOf.get("cmp-a")).toBe("backend"); // service
    expect(typeOf.get("cmp-b")).toBe("database"); // store
    expect(typeOf.get("cmp-c")).toBe("frontend"); // ui

    // the geometry planner assigns row — the model does not
    for (const n of model.nodes) expect(n.row).toBeUndefined();
  });

  it("returns null when no PRODUCES / CONSUMES / DERIVED_FROM relation is referenced", () => {
    const k = knowledge({
      components: [
        { id: "cmp-a", name: "A", sourceRefs: sr },
        { id: "cmp-b", name: "B", sourceRefs: sr },
      ],
      relations: [{ id: "rel-x", from: "cmp-a", to: "cmp-b", type: "DEPENDS_ON", sourceRefs: sr }],
    });
    expect(buildDataflowModel(buildKnowledgeView(k), dataflowIds(k), L)).toBeNull();
  });

  it("drops a back edge to keep the graph acyclic and marks the model condensed", () => {
    const k = knowledge({
      components: [
        { id: "cmp-a", name: "A", kind: "service", sourceRefs: sr },
        { id: "cmp-b", name: "B", kind: "store", sourceRefs: sr },
      ],
      relations: [
        { id: "rel-ab", from: "cmp-a", to: "cmp-b", type: "PRODUCES", sourceRefs: sr },
        { id: "rel-ba", from: "cmp-b", to: "cmp-a", type: "PRODUCES", sourceRefs: sr },
      ],
    });
    const model = buildDataflowModel(buildKnowledgeView(k), dataflowIds(k), L);
    if (model?.kind !== "dataflow") throw new Error("expected dataflow");
    expect(model.flows).toHaveLength(1);
    expect(model.condensed).toBe(true);
  });

  it("is deterministic and independent of relation input order", () => {
    const k1 = dataflowKnowledge();
    const k2 = knowledge({
      components: [...dataflowKnowledge().components].reverse(),
      relations: [...dataflowKnowledge().relations].reverse(),
    });
    const a = buildDataflowModel(buildKnowledgeView(k1), dataflowIds(k1), L);
    const b = buildDataflowModel(buildKnowledgeView(k2), dataflowIds(k2), L);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("adapts to a DiagramIR that the Visual Engine resolves (geometry planner runs)", async () => {
    const k = dataflowKnowledge();
    const model = buildDataflowModel(buildKnowledgeView(k), dataflowIds(k), L);
    if (model?.kind !== "dataflow") throw new Error("expected dataflow");
    const ir = nativeDiagramAdapter.toDiagramIR(model, "dgm-df", "Ingest path");
    const deck = applyDiagramEnginePreference(deckOf([ir]), { preference: "visual" });
    expect(deck.diagrams[0]?.engine).toBe("visual");
    const { report } = await resolveDiagramEngines(deck);
    expect(report.diagrams[0]?.outcome).toBe("resolved");
  });

  it("modelKnowledgeRefs exposes the entity + relation provenance", () => {
    const k = dataflowKnowledge();
    const model = buildDataflowModel(buildKnowledgeView(k), dataflowIds(k), L);
    if (!model) throw new Error("expected model");
    expect(modelKnowledgeRefs(model).sort()).toEqual(["cmp-a", "cmp-b", "cmp-c", "rel-1", "rel-2"]);
  });
});

function lifecycleKnowledge(): ProjectKnowledge {
  return knowledge({
    phases: [
      { id: "ph-1", name: "Build", status: "done", sourceRefs: sr },
      { id: "ph-2", name: "Pilot", status: "active", sourceRefs: sr },
      { id: "ph-3", name: "Rollout", status: "planned", sourceRefs: sr },
    ],
    relations: [
      { id: "rel-p2", from: "ph-2", to: "ph-3", type: "PRECEDES", sourceRefs: sr },
      { id: "rel-p1", from: "ph-1", to: "ph-2", type: "PRECEDES", sourceRefs: sr },
    ],
  });
}

const lifecycleIds = (k: ProjectKnowledge): string[] => [
  ...k.phases.map((p) => p.id),
  ...k.relations.map((r) => r.id),
];

describe("buildLifecycleModel — only from a real phase + PRECEDES structure", () => {
  it("builds states + transitions; the first phase in PRECEDES order is `start`", () => {
    const k = lifecycleKnowledge();
    const model = buildLifecycleModel(buildKnowledgeView(k), lifecycleIds(k), L);
    expect(model?.kind).toBe("lifecycle");
    if (model?.kind !== "lifecycle") return;

    expect(model.lanes).toEqual([{ id: "main", label: "Lifecycle" }]);
    expect(model.states.map((s) => s.ref)).toEqual(["ph-1", "ph-2", "ph-3"]);
    const typeOf = new Map(model.states.map((s) => [s.ref, s.type]));
    expect(typeOf.get("ph-1")).toBe("start");
    expect(typeOf.get("ph-2")).toBe("active");
    expect(typeOf.get("ph-3")).toBe("neutral");

    expect(model.transitions.map((t) => t.relationId).sort()).toEqual(["rel-p1", "rel-p2"]);
    for (const t of model.transitions) {
      expect(model.states.some((s) => s.id === t.from)).toBe(true);
      expect(model.states.some((s) => s.id === t.to)).toBe(true);
    }
    // the geometry planner assigns the column — the model does not
    for (const s of model.states) expect(s.col).toBeUndefined();
  });

  it("returns null with fewer than two referenced phases", () => {
    const k = knowledge({
      phases: [{ id: "ph-1", name: "Only", status: "active", sourceRefs: sr }],
    });
    expect(buildLifecycleModel(buildKnowledgeView(k), lifecycleIds(k), L)).toBeNull();
  });

  it("returns null when phases are present but no PRECEDES connects them", () => {
    const k = knowledge({
      phases: [
        { id: "ph-1", name: "A", status: "done", sourceRefs: sr },
        { id: "ph-2", name: "B", status: "active", sourceRefs: sr },
      ],
      relations: [{ id: "rel-x", from: "ph-1", to: "ph-2", type: "DEPENDS_ON", sourceRefs: sr }],
    });
    expect(buildLifecycleModel(buildKnowledgeView(k), lifecycleIds(k), L)).toBeNull();
  });

  it("returns null when PRECEDES connects non-phase entities", () => {
    const k = knowledge({
      phases: [
        { id: "ph-1", name: "A", status: "done", sourceRefs: sr },
        { id: "ph-2", name: "B", status: "active", sourceRefs: sr },
      ],
      components: [
        { id: "cmp-a", name: "A", sourceRefs: sr },
        { id: "cmp-b", name: "B", sourceRefs: sr },
      ],
      relations: [{ id: "rel-c", from: "cmp-a", to: "cmp-b", type: "PRECEDES", sourceRefs: sr }],
    });
    const ids = [...lifecycleIds(k), ...k.components.map((c) => c.id)];
    expect(buildLifecycleModel(buildKnowledgeView(k), ids, L)).toBeNull();
  });

  it("condenses a chain longer than the lane budget", () => {
    const phases = Array.from({ length: 8 }, (_v, i) => ({
      id: `ph-${i + 1}`,
      name: `Phase ${i + 1}`,
      status: "planned" as const,
      sourceRefs: sr,
    }));
    const relations = Array.from({ length: 7 }, (_v, i) => ({
      id: `rel-${i + 1}`,
      from: `ph-${i + 1}`,
      to: `ph-${i + 2}`,
      type: "PRECEDES" as const,
      sourceRefs: sr,
    }));
    const k = knowledge({ phases, relations });
    const model = buildLifecycleModel(buildKnowledgeView(k), lifecycleIds(k), L);
    if (model?.kind !== "lifecycle") throw new Error("expected lifecycle");
    expect(model.states.length).toBeLessThanOrEqual(5);
    expect(model.condensed).toBe(true);
  });

  it("is deterministic and independent of input order", () => {
    const k1 = lifecycleKnowledge();
    const k2 = knowledge({
      phases: [...lifecycleKnowledge().phases].reverse(),
      relations: [...lifecycleKnowledge().relations].reverse(),
    });
    const a = buildLifecycleModel(buildKnowledgeView(k1), lifecycleIds(k1), L);
    const b = buildLifecycleModel(buildKnowledgeView(k2), lifecycleIds(k2), L);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("adapts to a DiagramIR that the Visual Engine resolves (geometry planner runs)", async () => {
    const k = lifecycleKnowledge();
    const model = buildLifecycleModel(buildKnowledgeView(k), lifecycleIds(k), L);
    if (model?.kind !== "lifecycle") throw new Error("expected lifecycle");
    const ir = nativeDiagramAdapter.toDiagramIR(model, "dgm-lc", "Delivery lifecycle");
    const deck = applyDiagramEnginePreference(deckOf([ir]), { preference: "visual" });
    expect(deck.diagrams[0]?.engine).toBe("visual");
    const { report } = await resolveDiagramEngines(deck);
    expect(report.diagrams[0]?.outcome).toBe("resolved");
  });

  it("modelKnowledgeRefs exposes the phase + transition provenance", () => {
    const k = lifecycleKnowledge();
    const model = buildLifecycleModel(buildKnowledgeView(k), lifecycleIds(k), L);
    if (!model) throw new Error("expected model");
    expect(modelKnowledgeRefs(model).sort()).toEqual(["ph-1", "ph-2", "ph-3", "rel-p1", "rel-p2"]);
  });
});
