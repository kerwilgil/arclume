/** Visual Engine adapter — workflow mapping. */

import { describe, expect, it } from "vitest";
import { stableStringify } from "../../../src/determinism/hash.js";
import {
  VISUAL_ENGINE_COMPONENT_TYPE_SENTINEL,
  adaptDiagramToVisualEngine,
} from "../../../src/engines/visual/index.js";
import type {
  VisualEngineAdaptation,
  VisualEngineWorkflowRequest,
} from "../../../src/engines/visual/index.js";
import type { DiagramIR } from "../../../src/types/deck.js";
import { workflowDiagram } from "./helpers.js";

const workflowRequest = (
  d: DiagramIR,
): { adapted: VisualEngineAdaptation; request: VisualEngineWorkflowRequest } => {
  const adapted = adaptDiagramToVisualEngine(d);
  if (adapted.kind !== "ok") throw new Error("expected a successful adaptation");
  const request = adapted.request;
  if (request.diagram_type !== "workflow") throw new Error("expected a workflow request");
  return { adapted, request };
};

describe("Visual Engine adapter — workflow", () => {
  it("orders steps by explicit index into col 0..n-1", () => {
    const { request } = workflowRequest(workflowDiagram(4));
    const cols = request.nodes.map((n) => [n.id, n.col] as const);
    expect(cols).toEqual([
      ["s-1", 0],
      ["s-2", 1],
      ["s-3", 2],
      ["s-4", 3],
    ]);
  });

  it("respects explicit index even when authored order differs", () => {
    const diagram = workflowDiagram(3);
    const spec = diagram.spec as { steps: Array<{ id: string; index: number }> };
    spec.steps = [...spec.steps].reverse();
    const { adapted, request } = workflowRequest(diagram);
    expect(request.nodes.map((n) => n.id)).toEqual(["s-1", "s-2", "s-3"]);
    expect(adapted.ordering.stepOrder).toEqual(["s-1", "s-2", "s-3"]);
  });

  it("uses a single 'main' lane labelled with the diagram title", () => {
    const { request } = workflowRequest(workflowDiagram(2));
    expect(request.lanes).toEqual([{ id: "main", label: "Delivery Flow" }]);
    for (const n of request.nodes) {
      expect(n.lane).toBe("main");
      expect(n.type).toBe(VISUAL_ENGINE_COMPONENT_TYPE_SENTINEL);
    }
  });

  it("accepts exactly 6 steps and rejects 7 with visual-engine/layout-capacity", () => {
    expect(adaptDiagramToVisualEngine(workflowDiagram(6)).kind).toBe("ok");
    const seven = adaptDiagramToVisualEngine(workflowDiagram(7));
    expect(seven.kind).toBe("error");
    if (seven.kind === "error") expect(seven.code).toBe("visual-engine/layout-capacity");
  });

  it("emits mainPath only when every consecutive pair is an authored edge", () => {
    const withPath = workflowRequest(workflowDiagram(4));
    expect(withPath.request.mainPath).toEqual(["s-1", "s-2", "s-3", "s-4"]);

    const gapped = workflowDiagram(3);
    (
      gapped.spec as { edges: Array<{ id: string; from: string; to: string; relationId: string }> }
    ).edges = [{ id: "jump", from: "s-1", to: "s-3", relationId: "rel-jump" }];
    const adapted = adaptDiagramToVisualEngine(gapped);
    if (adapted.kind !== "ok") throw new Error("expected ok");
    expect("mainPath" in adapted.request).toBe(false);
  });

  it("never invents edges: the request carries exactly the authored edges", () => {
    const d = workflowDiagram(3);
    (
      d.spec as { edges: Array<{ id: string; from: string; to: string; relationId: string }> }
    ).edges = [{ id: "jump", from: "s-1", to: "s-3", relationId: "rel-jump" }];
    const { request } = workflowRequest(d);
    expect(request.edges.map((e) => [e.id, e.from, e.to])).toEqual([["jump", "s-1", "s-3"]]);
    expect("mainPath" in request).toBe(false);
  });

  it("accepts both 'workflow' and 'process' as the native kind", () => {
    const d = workflowDiagram(2);
    (d.spec as { kind: string }).kind = "workflow";
    expect(adaptDiagramToVisualEngine(d).kind).toBe("ok");
  });

  it("is deterministic for the same input", () => {
    const a = workflowRequest(workflowDiagram(5));
    const b = workflowRequest(workflowDiagram(5));
    expect(stableStringify(a.request)).toBe(stableStringify(b.request));
  });

  it("rejects non-integer indexes", () => {
    const d = workflowDiagram(2);
    (d.spec as { steps: Array<Record<string, unknown>> }).steps = [
      { id: "s1", label: "A", index: 1.5 },
      { id: "s2", label: "B", index: 2 },
    ];
    const adapted = adaptDiagramToVisualEngine(d);
    expect(adapted.kind).toBe("error");
    if (adapted.kind === "error") expect(adapted.code).toBe("visual-engine/adapter-invalid-input");
  });

  it("rejects a missing index (never synthesized from array position)", () => {
    const d = workflowDiagram(2);
    (d.spec as { steps: Array<Record<string, unknown>> }).steps = [
      { id: "s1", label: "A" },
      { id: "s2", label: "B", index: 1 },
    ];
    const adapted = adaptDiagramToVisualEngine(d);
    expect(adapted.kind).toBe("error");
    if (adapted.kind === "error") expect(adapted.code).toBe("visual-engine/adapter-invalid-input");
  });

  it("rejects a negative index", () => {
    const d = workflowDiagram(2);
    (d.spec as { steps: Array<Record<string, unknown>> }).steps = [
      { id: "s1", label: "A", index: -1 },
      { id: "s2", label: "B", index: 0 },
    ];
    const adapted = adaptDiagramToVisualEngine(d);
    expect(adapted.kind).toBe("error");
    if (adapted.kind === "error") expect(adapted.code).toBe("visual-engine/adapter-invalid-input");
  });

  it("rejects duplicate indexes (no id tie-break)", () => {
    const d = workflowDiagram(2);
    (d.spec as { steps: Array<Record<string, unknown>> }).steps = [
      { id: "s1", label: "A", index: 1 },
      { id: "s2", label: "B", index: 1 },
    ];
    const adapted = adaptDiagramToVisualEngine(d);
    expect(adapted.kind).toBe("error");
    if (adapted.kind === "error") expect(adapted.code).toBe("visual-engine/adapter-invalid-input");
  });

  it("honours a shuffled array with unique explicit indexes", () => {
    const d = workflowDiagram(3);
    (d.spec as { steps: Array<Record<string, unknown>> }).steps = [
      { id: "s-3", label: "C", index: 2, ref: "proc-3" },
      { id: "s-1", label: "A", index: 0, ref: "proc-1" },
      { id: "s-2", label: "B", index: 1, ref: "proc-2" },
    ];
    const { adapted, request } = workflowRequest(d);
    expect(adapted.ordering.stepOrder).toEqual(["s-1", "s-2", "s-3"]);
    expect(request.nodes.map((n) => [n.id, n.col])).toEqual([
      ["s-1", 0],
      ["s-2", 1],
      ["s-3", 2],
    ]);
  });
});
