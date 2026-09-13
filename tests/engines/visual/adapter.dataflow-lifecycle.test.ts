/**
 * Visual Engine adapter + engine round-trip — dataflow & lifecycle
 * (Visual + Narrative Intelligence, Slice 1 — Visual Engine Completeness).
 *
 * Each kind is covered for: schema (request shape), render (real vendored CLI),
 * validation (sanitize + post-engine round-trip), provenance (identity sets that
 * survive the engine), and determinism.
 */

import { describe, expect, it } from "vitest";
import { stableStringify } from "../../../src/determinism/hash.js";
import {
  type SanitizedSvg,
  type VisualEngineAdaptation,
  adaptDiagramToVisualEngine,
  sanitizeVisualEngineSvgRegion,
  validateSanitizedDiagram,
} from "../../../src/engines/visual/index.js";
import { applyDiagramEnginePreference } from "../../../src/pipeline/diagram-engine-preference.js";
import { resolveDiagramEngines } from "../../../src/pipeline/resolve-diagrams.js";
import type { ArclumeDeck, DiagramIR } from "../../../src/types/deck.js";
import { dataflowDiagram, expectationFor, lifecycleDiagram, renderFixtureFor } from "./helpers.js";

const deck = (diagrams: DiagramIR[]): ArclumeDeck => ({ diagrams }) as unknown as ArclumeDeck;

interface Fixture {
  adaptation: Extract<VisualEngineAdaptation, { kind: "ok" }>;
  sanitized: SanitizedSvg;
  html: string;
}

async function fixture(diagram: DiagramIR): Promise<Fixture> {
  const adaptation = adaptDiagramToVisualEngine(diagram);
  if (adaptation.kind !== "ok")
    throw new Error(`fixture must adapt: ${JSON.stringify(adaptation)}`);
  const html = await renderFixtureFor(diagram);
  const sanitized = sanitizeVisualEngineSvgRegion(html, expectationFor(diagram));
  return { adaptation, sanitized, html };
}

/* ================================================================= */
/* dataflow                                                           */
/* ================================================================= */

describe("Visual Engine adapter — dataflow", () => {
  it("schema: emits a schema_version-1 dataflow request with stages/nodes/flows", () => {
    const adapted = adaptDiagramToVisualEngine(dataflowDiagram());
    expect(adapted.kind).toBe("ok");
    if (adapted.kind !== "ok") return;
    const req = adapted.request;
    if (req.diagram_type !== "dataflow") throw new Error("expected dataflow request");
    expect(req.schema_version).toBe(1);
    expect(req.stages.map((s) => s.label)).toEqual(["Source", "Process", "Store"]);
    expect(req.nodes.map((n) => n.id)).toEqual(["df-client", "df-api", "df-db"]);
    expect(req.flows.map((f) => f.id)).toEqual(["df-f1", "df-f2"]);
    // Legend hidden, animation off — same policy as architecture/workflow.
    expect(req.meta.legend?.mode).toBe("hidden");
    expect(req.meta.animation).toBe("none");
    expect(adapted.visualKind).toBe("dataflow");
  });

  it("validation: rejects unknown stage, dangling flow, duplicate id, too few nodes", () => {
    const bad = (spec: Record<string, unknown>): string => {
      const r = adaptDiagramToVisualEngine(
        dataflowDiagram({ spec: { format: "arclume.native.v1", ...spec } }),
      );
      return r.kind === "error" ? r.code : "did-not-fail";
    };
    expect(bad({ kind: "dataflow", stages: [{ label: "A" }], nodes: [], flows: [] })).toBe(
      "visual-engine/adapter-invalid-input",
    );
    expect(
      bad({
        kind: "dataflow",
        stages: [{ label: "A" }, { label: "B" }],
        nodes: [
          { id: "x", type: "frontend", label: "X", stage: 0, row: 0 },
          { id: "y", type: "database", label: "Y", stage: 9, row: 0 },
        ],
        flows: [],
      }),
    ).toBe("visual-engine/adapter-invalid-input");
    expect(
      bad({
        kind: "dataflow",
        stages: [{ label: "A" }, { label: "B" }],
        nodes: [
          { id: "x", type: "frontend", label: "X", stage: 0, row: 0 },
          { id: "y", type: "database", label: "Y", stage: 1, row: 0 },
        ],
        flows: [{ id: "f", from: "x", to: "ghost", label: "l" }],
      }),
    ).toBe("visual-engine/adapter-invalid-input");
  });

  it("render: produces an <svg> with data-node-id / data-edge-id for every node/flow", async () => {
    const { html } = await fixture(dataflowDiagram());
    expect(html).toContain("<svg");
    for (const id of ["df-client", "df-api", "df-db"]) {
      expect(html).toContain(`data-node-id="${id}"`);
    }
    for (const id of ["df-f1", "df-f2"]) {
      expect(html).toContain(`data-edge-id="${id}"`);
    }
  });

  it("validation: a faithful engine round-trip passes post-engine validation", async () => {
    const { adaptation, sanitized } = await fixture(dataflowDiagram());
    expect(() => validateSanitizedDiagram(sanitized, adaptation)).not.toThrow();
  });

  it("provenance: node & relation identity sets round-trip into the sanitized SVG", async () => {
    const { adaptation, sanitized } = await fixture(dataflowDiagram());
    expect(new Set(sanitized.summary.nodes)).toEqual(new Set(["df-client", "df-api", "df-db"]));
    expect(new Set(sanitized.summary.relations.map((r) => r.relationId))).toEqual(
      new Set(["df-f1", "df-f2"]),
    );
    for (const id of adaptation.ordering.stepOrder) {
      expect(sanitized.svg).toContain(`data-step-id="${id}"`);
    }
    for (const id of adaptation.provenance.relationIds) {
      expect(sanitized.svg).toContain(`data-relation-id="${id}"`);
    }
    // Direction survives: df-api → df-db, not the reverse.
    const f2 = sanitized.summary.relations.find((r) => r.relationId === "df-f2");
    expect(f2).toMatchObject({ from: "df-api", to: "df-db" });
  });

  it("determinism: same spec → byte-identical request JSON", () => {
    const a = adaptDiagramToVisualEngine(dataflowDiagram());
    const b = adaptDiagramToVisualEngine(dataflowDiagram());
    if (a.kind !== "ok" || b.kind !== "ok") throw new Error("both must adapt");
    expect(stableStringify(a.request)).toBe(stableStringify(b.request));
    expect(a.specHash).toBe(b.specHash);
  });
});

/* ================================================================= */
/* lifecycle                                                          */
/* ================================================================= */

describe("Visual Engine adapter — lifecycle", () => {
  it("schema: emits a schema_version-1 lifecycle request with lanes/states/transitions", () => {
    const adapted = adaptDiagramToVisualEngine(lifecycleDiagram());
    expect(adapted.kind).toBe("ok");
    if (adapted.kind !== "ok") return;
    const req = adapted.request;
    if (req.diagram_type !== "lifecycle") throw new Error("expected lifecycle request");
    expect(req.schema_version).toBe(1);
    expect(req.lanes.map((l) => l.id)).toEqual(["main", "terminal"]);
    expect(req.states.map((s) => s.id)).toEqual(["lc-created", "lc-proc", "lc-done", "lc-failed"]);
    expect(req.states.map((s) => s.type)).toEqual(["start", "active", "success", "failure"]);
    expect(req.transitions.map((t) => t.id)).toEqual(["lc-t1", "lc-t2", "lc-t3"]);
    expect(adapted.visualKind).toBe("lifecycle");
  });

  it("validation: rejects unknown lane, invalid state type, unknown transition endpoint", () => {
    const bad = (spec: Record<string, unknown>): string => {
      const r = adaptDiagramToVisualEngine(
        lifecycleDiagram({ spec: { format: "arclume.native.v1", ...spec } }),
      );
      return r.kind === "error" ? r.code : "did-not-fail";
    };
    expect(
      bad({
        kind: "lifecycle",
        lanes: [{ id: "L", label: "L" }],
        states: [{ id: "s", type: "nonsense", label: "S", lane: "L", col: 0 }],
        transitions: [],
      }),
    ).toBe("visual-engine/adapter-invalid-input");
    expect(
      bad({
        kind: "lifecycle",
        lanes: [{ id: "L", label: "L" }],
        states: [{ id: "s", type: "start", label: "S", lane: "OTHER", col: 0 }],
        transitions: [],
      }),
    ).toBe("visual-engine/adapter-invalid-input");
    expect(
      bad({
        kind: "lifecycle",
        lanes: [{ id: "L", label: "L" }],
        states: [
          { id: "a", type: "start", label: "A", lane: "L", col: 0 },
          { id: "b", type: "success", label: "B", lane: "L", col: 1 },
        ],
        transitions: [{ id: "t", from: "a", to: "ghost" }],
      }),
    ).toBe("visual-engine/adapter-invalid-input");
  });

  it("render: produces an <svg> with data-node-id / data-edge-id for every state/transition", async () => {
    const { html } = await fixture(lifecycleDiagram());
    expect(html).toContain("<svg");
    for (const id of ["lc-created", "lc-proc", "lc-done", "lc-failed"]) {
      expect(html).toContain(`data-node-id="${id}"`);
    }
    for (const id of ["lc-t1", "lc-t2", "lc-t3"]) {
      expect(html).toContain(`data-edge-id="${id}"`);
    }
  });

  it("validation: a faithful engine round-trip passes post-engine validation", async () => {
    const { adaptation, sanitized } = await fixture(lifecycleDiagram());
    expect(() => validateSanitizedDiagram(sanitized, adaptation)).not.toThrow();
  });

  it("provenance: state & transition identity sets round-trip; branch direction preserved", async () => {
    const { sanitized } = await fixture(lifecycleDiagram());
    expect(new Set(sanitized.summary.nodes)).toEqual(
      new Set(["lc-created", "lc-proc", "lc-done", "lc-failed"]),
    );
    expect(new Set(sanitized.summary.relations.map((r) => r.relationId))).toEqual(
      new Set(["lc-t1", "lc-t2", "lc-t3"]),
    );
    const fail = sanitized.summary.relations.find((r) => r.relationId === "lc-t3");
    expect(fail).toMatchObject({ from: "lc-proc", to: "lc-failed" });
  });

  it("determinism: same spec → byte-identical request JSON", () => {
    const a = adaptDiagramToVisualEngine(lifecycleDiagram());
    const b = adaptDiagramToVisualEngine(lifecycleDiagram());
    if (a.kind !== "ok" || b.kind !== "ok") throw new Error("both must adapt");
    expect(stableStringify(a.request)).toBe(stableStringify(b.request));
  });
});

/* ================================================================= */
/* pipeline routing + explicit fallback                              */
/* ================================================================= */

describe("dataflow & lifecycle — pipeline routing and non-silent fallback", () => {
  it("applyDiagramEnginePreference routes both to visual engine under 'visual' and 'auto'", () => {
    for (const preference of ["visual", "auto"] as const) {
      const out = applyDiagramEnginePreference(deck([dataflowDiagram(), lifecycleDiagram()]), {
        preference,
      });
      expect(out.diagrams.map((d) => d.engine)).toEqual(["visual", "visual"]);
    }
    const nativePref = applyDiagramEnginePreference(deck([dataflowDiagram()]), {
      preference: "native",
    });
    expect(nativePref.diagrams[0]?.engine).toBe("native");
  });

  it("resolveDiagramEngines resolves both to a real visual engine SVG artifact", async () => {
    const routed = applyDiagramEnginePreference(deck([dataflowDiagram(), lifecycleDiagram()]), {
      preference: "visual",
    });
    const { diagramArtifacts, report } = await resolveDiagramEngines(routed);
    expect(diagramArtifacts.get("d-df")?.kind).toBe("svg");
    expect(diagramArtifacts.get("d-lc")?.kind).toBe("svg");
    expect(report.diagrams.every((e) => e.outcome === "resolved")).toBe(true);
  });

  it("an unrenderable visual engine dataflow (bad geometry) falls back LOUDLY, never silently", async () => {
    // Two nodes in the same stage/row → vendored layout validator rejects it →
    // visual-engine/render-failed (fallbackable). The fallback must be reported.
    const broken = dataflowDiagram({
      spec: {
        format: "arclume.native.v1",
        kind: "dataflow",
        stages: [{ label: "A" }, { label: "B" }],
        nodes: [
          { id: "x", type: "frontend", label: "X", stage: 0, row: 0 },
          { id: "y", type: "backend", label: "Y", stage: 0, row: 0 },
        ],
        flows: [{ id: "f", from: "x", to: "y", label: "collides" }],
      },
    });
    const routed = applyDiagramEnginePreference(deck([broken]), { preference: "visual" });
    const { diagramArtifacts, report } = await resolveDiagramEngines(routed);
    expect(diagramArtifacts.get("d-df")).toMatchObject({
      kind: "native-fallback",
      code: "visual-engine/render-failed",
    });
    expect(report.diagrams[0]).toMatchObject({
      outcome: "fallback",
      code: "visual-engine/render-failed",
    });
    expect(report.diagrams[0]?.warnings.length ?? 0).toBeGreaterThan(0);
  });

  it("with fallbackOnError: false an unrenderable dataflow is fatal (no silent native swap)", async () => {
    const broken = dataflowDiagram({
      spec: {
        format: "arclume.native.v1",
        kind: "dataflow",
        stages: [{ label: "A" }, { label: "B" }],
        nodes: [
          { id: "x", type: "frontend", label: "X", stage: 0, row: 0 },
          { id: "y", type: "backend", label: "Y", stage: 0, row: 0 },
        ],
        flows: [{ id: "f", from: "x", to: "y", label: "collides" }],
      },
    });
    const routed = applyDiagramEnginePreference(deck([broken]), { preference: "visual" });
    await expect(resolveDiagramEngines(routed, { fallbackOnError: false })).rejects.toMatchObject({
      code: "visual-engine/render-failed",
    });
  });
});
