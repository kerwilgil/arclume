import { describe, expect, it } from "vitest";
import {
  type ProjectKnowledge,
  buildArchitectureModel,
  buildFlowModel,
  buildKnowledgeView,
  buildTimelineModel,
  modelKnowledgeRefs,
  nativeDiagramAdapter,
} from "../src/index.js";
import { DEFAULT_VISUAL_LIMITS } from "../src/visual/types.js";
import { loadFixture } from "./helpers/fixtures.js";

const rich = () => loadFixture<ProjectKnowledge>("knowledge/valid/rich.json");
const wide = () => loadFixture<ProjectKnowledge>("planning/wide-knowledge.json");
const L = DEFAULT_VISUAL_LIMITS;

describe("native architecture model", () => {
  it("nodes trace to component ids and edges to relation ids", () => {
    const k = rich();
    const view = buildKnowledgeView(k);
    const ids = [
      ...k.components.map((c) => c.id),
      ...k.dependencies.map((d) => d.id),
      ...k.relations.map((r) => r.id),
    ];
    const model = buildArchitectureModel(view, ids, L);
    expect(model).not.toBeNull();
    if (!model || model.kind !== "architecture") return;

    const entityIds = new Set([...k.components, ...k.dependencies].map((e) => e.id));
    const relIds = new Set(k.relations.map((r) => r.id));
    for (const n of model.nodes) expect(entityIds.has(n.entityId)).toBe(true);
    for (const e of model.edges) {
      expect(relIds.has(e.relationId)).toBe(true);
      expect(model.nodes.some((n) => n.id === e.from)).toBe(true);
      expect(model.nodes.some((n) => n.id === e.to)).toBe(true);
    }
  });

  it("returns null when no relation connects two node entities (no invented topology)", () => {
    const k = rich();
    const view = buildKnowledgeView(k);
    // pass a single component and no relations
    expect(buildArchitectureModel(view, [k.components[0]?.id ?? "x"], L)).toBeNull();
  });

  it("respects the node limit and marks the model condensed", () => {
    const k = wide();
    const view = buildKnowledgeView(k);
    const ids = [...k.components.map((c) => c.id), ...k.relations.map((r) => r.id)];
    const model = buildArchitectureModel(view, ids, { ...L, maxDiagramNodes: 3 });
    if (model && model.kind === "architecture") {
      expect(model.nodes.length).toBeLessThanOrEqual(3);
      expect(model.condensed).toBe(true);
    }
  });
});

describe("native flow model", () => {
  it("uses the real steps of a process entity", () => {
    const k = rich();
    const view = buildKnowledgeView(k);
    const model = buildFlowModel(view, [k.processes[0]?.id ?? "x"], "process", L);
    expect(model).not.toBeNull();
    if (!model || model.kind !== "process") return;
    expect(model.steps.length).toBeGreaterThan(0);
    for (const s of model.steps) expect(s.ref).toBe(k.processes[0]?.id);
  });

  it("returns null with no process steps and no PRECEDES relations", () => {
    const k = rich();
    const view = buildKnowledgeView(k);
    expect(buildFlowModel(view, [k.components[0]?.id ?? "x"], "sequence", L)).toBeNull();
  });
});

describe("native timeline / roadmap model", () => {
  it("roadmap items trace to phase ids and carry only real dates/status", () => {
    const k = rich();
    const view = buildKnowledgeView(k);
    const model = buildTimelineModel(
      view,
      k.phases.map((p) => p.id),
      "roadmap",
      L,
    );
    expect(model).not.toBeNull();
    if (!model || model.kind !== "roadmap") return;
    const phaseIds = new Set(k.phases.map((p) => p.id));
    for (const it of model.items) {
      expect(phaseIds.has(it.ref)).toBe(true);
      if (it.date) expect(typeof it.date).toBe("string");
    }
  });

  it("timeline needs dated temporal evidence", () => {
    const k = rich();
    const view = buildKnowledgeView(k);
    const model = buildTimelineModel(
      view,
      k.milestones.map((m) => m.id),
      "timeline",
      L,
    );
    expect(model).not.toBeNull();
    if (model && model.kind === "timeline") {
      const msIds = new Set(k.milestones.map((m) => m.id));
      for (const it of model.items) expect(msIds.has(it.ref)).toBe(true);
    }
  });
});

describe("native diagram adapter", () => {
  it("emits an arclume.native.v1 spec whose refs all resolve", () => {
    const k = rich();
    const view = buildKnowledgeView(k);
    const model = buildArchitectureModel(
      view,
      [
        ...k.components.map((c) => c.id),
        ...k.dependencies.map((d) => d.id),
        ...k.relations.map((r) => r.id),
      ],
      L,
    );
    if (!model) throw new Error("expected an architecture model");
    const ir = nativeDiagramAdapter.toDiagramIR(model, "dgm-x", "Architecture");
    expect(ir.engine).toBe("native");
    expect(ir.diagramType).toBe("architecture");
    expect((ir.spec as { format: string }).format).toBe("arclume.native.v1");

    const idSet = new Set<string>([k.project.id]);
    for (const key of Object.keys(k) as Array<keyof ProjectKnowledge>) {
      const v = k[key];
      if (Array.isArray(v))
        for (const e of v)
          if (e && typeof e === "object" && "id" in e) idSet.add((e as { id: string }).id);
    }
    for (const ref of modelKnowledgeRefs(model)) expect(idSet.has(ref)).toBe(true);
  });
});
