/** ARCLUME Visual Engine adapter — architecture mapping. */

import { describe, expect, it } from "vitest";
import { stableStringify } from "../../../src/determinism/hash.js";
import {
  VISUAL_ENGINE_COMPONENT_TYPE_SENTINEL,
  adaptDiagramToVisualEngine,
  placeArchitecture,
} from "../../../src/engines/visual/index.js";
import { architectureDiagram } from "./helpers.js";

describe("Visual Engine adapter — architecture", () => {
  it("maps a DAG with deterministic Kahn layering (col = layer)", () => {
    const adapted = adaptDiagramToVisualEngine(architectureDiagram());
    expect(adapted.kind).toBe("ok");
    if (adapted.kind !== "ok") return;
    const request = adapted.request;
    if (request.diagram_type !== "architecture") throw new Error("expected architecture");
    expect(request.layout.mode).toBe("grid");
    // n-ui(col 0, semantic cmp-ui) → n-api(col 1) → n-db(col 2)
    const colOf = new Map(request.components.map((c) => [c.id, c.col] as const));
    expect(colOf.get("n-ui")).toBe(0);
    expect(colOf.get("n-api")).toBe(1);
    expect(colOf.get("n-db")).toBe(2);
    expect(request.layout.cols).toBe(3);
  });

  it("uses the id-sorted grid when the graph is cyclic", () => {
    const spec = {
      format: "arclume.native.v1",
      kind: "architecture",
      nodes: [
        { id: "a", label: "A", entityId: "cmp-a" },
        { id: "b", label: "B", entityId: "cmp-b" },
      ],
      edges: [
        { id: "e-1", from: "a", to: "b", relationId: "rel-a-b" },
        { id: "e-2", from: "b", to: "a", relationId: "rel-b-a" },
      ],
    };
    const adapted = adaptDiagramToVisualEngine(architectureDiagram({ spec }));
    expect(adapted.kind).toBe("ok");
    if (adapted.kind !== "ok") return;
    const placement = placeArchitecture(
      ["a", "b"],
      [
        { from: "a", to: "b" },
        { from: "b", to: "a" },
      ],
    );
    expect(placement.gridFallback).toBe(true);
    expect(placement.cell.get("a")).toEqual({ row: 0, col: 0 });
    expect(placement.cell.get("b")).toEqual({ row: 0, col: 1 });
  });

  it("falls back to the id-sorted grid when depth exceeds 12 layers", () => {
    const n = 20;
    const nodes = Array.from({ length: n }, (_, i) => ({ id: `n${String(i).padStart(2, "0")}` }));
    const edges = nodes.slice(0, -1).map((nd, i) => ({
      from: nd.id,
      to: (nodes[i + 1] as { id: string }).id,
    }));
    const placement = placeArchitecture(
      nodes.map((x) => x.id),
      edges,
    );
    expect(placement.gridFallback).toBe(true);
    expect(placement.cols).toBeLessThanOrEqual(12);
    for (const id of nodes.map((x) => x.id)) {
      expect(placement.cell.has(id)).toBe(true);
    }
  });

  it("keeps layers within 12 columns for shallow DAGs", () => {
    const placement = placeArchitecture(
      ["a", "b", "c"],
      [
        { from: "a", to: "b" },
        { from: "a", to: "c" },
      ],
    );
    expect(placement.gridFallback).toBe(false);
    expect(placement.cols).toBe(2);
    expect(placement.cell.get("a")).toEqual({ row: 0, col: 0 });
    // b and c: same layer, id-ascending rows
    expect(placement.cell.get("b")).toEqual({ row: 0, col: 1 });
    expect(placement.cell.get("c")).toEqual({ row: 1, col: 1 });
  });

  it("keeps visual ids in the request and semantic ids in provenance", () => {
    const adapted = adaptDiagramToVisualEngine(architectureDiagram());
    if (adapted.kind !== "ok") throw new Error("expected ok");
    if (adapted.request.diagram_type !== "architecture") throw new Error("wrong type");
    // Visual engine request carries visual identity
    expect(adapted.request.components.map((c) => c.id)).toEqual(["n-api", "n-db", "n-ui"]);
    expect(adapted.request.connections.map((c) => [c.id, c.from, c.to])).toEqual([
      ["e-ui-api", "n-ui", "n-api"],
      ["e-api-db", "n-api", "n-db"],
    ]);
    // ARCLUME provenance carries semantic ProjectKnowledge identity
    expect(adapted.provenance.entityIds).toEqual(["cmp-api", "cmp-db", "cmp-ui"]);
    expect(adapted.provenance.relationIds).toEqual(["rel-ui-api", "rel-api-db"]);
    expect(adapted.maps.nodeToEntity.get("n-ui")).toBe("cmp-ui");
    expect(adapted.maps.edgeToRelation.get("e-ui-api")).toBe("rel-ui-api");
  });

  it("never infers component types: the sentinel is always 'external'", () => {
    const adapted = adaptDiagramToVisualEngine(architectureDiagram());
    if (adapted.kind !== "ok" || adapted.request.diagram_type !== "architecture") {
      throw new Error("expected ok architecture");
    }
    for (const c of adapted.request.components) {
      expect(c.type).toBe(VISUAL_ENGINE_COMPONENT_TYPE_SENTINEL);
      expect(c.type).toBe("external");
    }
  });

  it("always hides the legend and disables animation", () => {
    const adapted = adaptDiagramToVisualEngine(architectureDiagram());
    if (adapted.kind !== "ok") throw new Error("expected ok");
    expect(adapted.request.meta.legend.mode).toBe("hidden");
    expect(adapted.request.meta.animation).toBe("none");
    expect(adapted.request.meta.visual_preset).toBe("classic");
  });

  it("is deterministic: same spec → identical request JSON", () => {
    const a = adaptDiagramToVisualEngine(architectureDiagram());
    const b = adaptDiagramToVisualEngine(architectureDiagram());
    if (a.kind !== "ok" || b.kind !== "ok") throw new Error("expected ok");
    expect(stableStringify(a.request)).toBe(stableStringify(b.request));
    expect(a.specHash).toBe(b.specHash);
  });

  it("rejects unsafe ids, duplicates, dangling edges and empty specs", () => {
    const bad1 = adaptDiagramToVisualEngine(
      architectureDiagram({
        spec: {
          format: "arclume.native.v1",
          kind: "architecture",
          nodes: [{ id: "bad id!", label: "x", entityId: "cmp-x" }],
          edges: [],
        },
      }),
    );
    expect(bad1).toMatchObject({ kind: "error", code: "visual-engine/adapter-invalid-input" });

    const bad2 = adaptDiagramToVisualEngine(
      architectureDiagram({
        spec: {
          format: "arclume.native.v1",
          kind: "architecture",
          nodes: [
            { id: "a", label: "A", entityId: "cmp-a" },
            { id: "a", label: "A2", entityId: "cmp-b" },
          ],
          edges: [],
        },
      }),
    );
    expect(bad2).toMatchObject({ kind: "error", code: "visual-engine/adapter-invalid-input" });

    const bad3 = adaptDiagramToVisualEngine(
      architectureDiagram({
        spec: {
          format: "arclume.native.v1",
          kind: "architecture",
          nodes: [{ id: "a", label: "A", entityId: "cmp-a" }],
          edges: [{ id: "e-1", from: "a", to: "ghost", relationId: "rel-x" }],
        },
      }),
    );
    expect(bad3).toMatchObject({ kind: "error", code: "visual-engine/adapter-invalid-input" });

    const bad4 = adaptDiagramToVisualEngine(
      architectureDiagram({
        spec: { format: "arclume.native.v1", kind: "architecture", nodes: [], edges: [] },
      }),
    );
    expect(bad4).toMatchObject({ kind: "error", code: "visual-engine/adapter-invalid-input" });
  });

  it("rejects missing entityId / relationId (no provenance synthesis, no fallback)", () => {
    const noEntity = adaptDiagramToVisualEngine(
      architectureDiagram({
        spec: {
          format: "arclume.native.v1",
          kind: "architecture",
          nodes: [{ id: "a", label: "A" }],
          edges: [],
        },
      }),
    );
    expect(noEntity).toMatchObject({ kind: "error", code: "visual-engine/adapter-invalid-input" });

    const noRelation = adaptDiagramToVisualEngine(
      architectureDiagram({
        spec: {
          format: "arclume.native.v1",
          kind: "architecture",
          nodes: [
            { id: "a", label: "A", entityId: "cmp-a" },
            { id: "b", label: "B", entityId: "cmp-b" },
          ],
          edges: [{ id: "e-1", from: "a", to: "b" }],
        },
      }),
    );
    expect(noRelation).toMatchObject({
      kind: "error",
      code: "visual-engine/adapter-invalid-input",
    });
  });

  it("rejects non-native spec formats and unsupported kinds with the right codes", () => {
    const wrongFormat = adaptDiagramToVisualEngine(
      architectureDiagram({ spec: { kind: "architecture" } }),
    );
    expect(wrongFormat).toMatchObject({
      kind: "error",
      code: "visual-engine/adapter-invalid-input",
    });

    // A kind visual engine has no adapter for at all → unsupported-diagram (fallbackable).
    const mindmap = adaptDiagramToVisualEngine(
      architectureDiagram({
        spec: { format: "arclume.native.v1", kind: "mindmap", nodes: [], edges: [] },
      }),
    );
    expect(mindmap).toMatchObject({ kind: "error", code: "visual-engine/unsupported-diagram" });

    // sequence / dataflow / lifecycle are recognized kinds now: a malformed spec
    // is an integrity failure (adapter-invalid-input), never "unsupported".
    const sequence = adaptDiagramToVisualEngine(
      architectureDiagram({
        spec: { format: "arclume.native.v1", kind: "sequence", participants: [], messages: [] },
      }),
    );
    expect(sequence).toMatchObject({ kind: "error", code: "visual-engine/adapter-invalid-input" });

    const dataflow = adaptDiagramToVisualEngine(
      architectureDiagram({
        spec: { format: "arclume.native.v1", kind: "dataflow", stages: [], nodes: [], flows: [] },
      }),
    );
    expect(dataflow).toMatchObject({ kind: "error", code: "visual-engine/adapter-invalid-input" });

    const lifecycle = adaptDiagramToVisualEngine(
      architectureDiagram({
        spec: {
          format: "arclume.native.v1",
          kind: "lifecycle",
          lanes: [],
          states: [],
          transitions: [],
        },
      }),
    );
    expect(lifecycle).toMatchObject({ kind: "error", code: "visual-engine/adapter-invalid-input" });
  });
});
