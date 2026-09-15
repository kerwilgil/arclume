/**
 * Visual Engine adapter — sequence
 * (Visual + Narrative Intelligence, Slice 1 — Visual Engine Completeness).
 *
 * Slice 1 does NOT route `sequence` through the pipeline to the visual engine: the native
 * sequence model carries {steps, edges} (ordered actions anchored to knowledge
 * refs), not the {participants, messages} a visual engine sequence needs. These tests
 * prove the adapter + vendored renderer are correct and vendored-schema-valid,
 * ready to wire once a participant-aware sequence model lands, AND that the
 * pipeline keeps `sequence` on the native engine explicitly (never silently).
 */

import { describe, expect, it } from "vitest";
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
import { expectationFor, renderFixtureFor, sequenceVisualEngineDiagram } from "./helpers.js";

const deck = (diagrams: DiagramIR[]): ArclumeDeck => ({ diagrams }) as unknown as ArclumeDeck;

describe("Visual Engine adapter — sequence (unit, not pipeline-wired in Slice 1)", () => {
  it("schema: emits a schema_version-1 sequence request with participants/messages", () => {
    const adapted = adaptDiagramToVisualEngine(sequenceVisualEngineDiagram());
    expect(adapted.kind).toBe("ok");
    if (adapted.kind !== "ok") return;
    const req = adapted.request;
    if (req.diagram_type !== "sequence") throw new Error("expected sequence request");
    expect(req.schema_version).toBe(1);
    expect(req.participants.map((p) => p.id)).toEqual(["sq-ui", "sq-api", "sq-idp"]);
    expect(req.messages.map((m) => m.id)).toEqual(["sq-m1", "sq-m2", "sq-m3"]);
    expect(adapted.visualKind).toBe("sequence");
  });

  it("validation: rejects <2 participants, unknown message endpoint, bad y, bad variant", () => {
    const bad = (spec: Record<string, unknown>): string => {
      const r = adaptDiagramToVisualEngine(
        sequenceVisualEngineDiagram({ spec: { format: "arclume.native.v1", ...spec } }),
      );
      return r.kind === "error" ? r.code : "did-not-fail";
    };
    expect(
      bad({
        kind: "sequence",
        participants: [{ id: "a", type: "backend", label: "A" }],
        messages: [],
      }),
    ).toBe("visual-engine/adapter-invalid-input");
    expect(
      bad({
        kind: "sequence",
        participants: [
          { id: "a", type: "backend", label: "A" },
          { id: "b", type: "backend", label: "B" },
        ],
        messages: [{ id: "m", from: "a", to: "ghost", y: 200, label: "x" }],
      }),
    ).toBe("visual-engine/adapter-invalid-input");
    expect(
      bad({
        kind: "sequence",
        participants: [
          { id: "a", type: "backend", label: "A" },
          { id: "b", type: "backend", label: "B" },
        ],
        messages: [{ id: "m", from: "a", to: "b", y: 10, label: "x" }],
      }),
    ).toBe("visual-engine/adapter-invalid-input");
    expect(
      bad({
        kind: "sequence",
        participants: [
          { id: "a", type: "backend", label: "A" },
          { id: "b", type: "backend", label: "B" },
        ],
        messages: [{ id: "m", from: "a", to: "b", y: 200, label: "x", variant: "nonsense" }],
      }),
    ).toBe("visual-engine/adapter-invalid-input");
  });

  it("render: the vendored sequence renderer produces an <svg> carrying every participant + message id", async () => {
    const diagram = sequenceVisualEngineDiagram();
    const html = await renderFixtureFor(diagram);
    expect(html).toContain("<svg");
    for (const id of ["sq-ui", "sq-api", "sq-idp"]) {
      expect(html).toContain(`data-node-id="${id}"`);
    }
    for (const id of ["sq-m1", "sq-m2", "sq-m3"]) {
      expect(html).toContain(`data-edge-id="${id}"`);
    }
    // Return message direction is carried on the message group.
    expect(html).toContain('data-edge-from="sq-idp" data-edge-to="sq-api"');
  });

  it("sanitize + validate: participant AND message identity sets round-trip, direction preserved", async () => {
    // The vendored sequence renderer places message metadata on a <g>, not a
    // <path>; the sanitizer now binds relations off that <g> too (deduped
    // across the message group and its context <g>).
    const diagram = sequenceVisualEngineDiagram();
    const adaptation = adaptDiagramToVisualEngine(diagram);
    if (adaptation.kind !== "ok") throw new Error("fixture must adapt");
    const html = await renderFixtureFor(diagram);
    const sanitized: SanitizedSvg = sanitizeVisualEngineSvgRegion(html, expectationFor(diagram));

    expect(new Set(sanitized.summary.nodes)).toEqual(new Set(["sq-ui", "sq-api", "sq-idp"]));
    expect(new Set(sanitized.summary.relations.map((r) => r.relationId))).toEqual(
      new Set(["sq-m1", "sq-m2", "sq-m3"]),
    );
    // Each message id is recorded exactly once despite appearing on two <g>s.
    expect(sanitized.summary.relations).toHaveLength(3);
    // Return-message direction survives: sq-idp → sq-api.
    const m3 = sanitized.summary.relations.find((r) => r.relationId === "sq-m3");
    expect(m3).toMatchObject({ from: "sq-idp", to: "sq-api" });

    expect(() =>
      validateSanitizedDiagram(
        sanitized,
        adaptation as Extract<VisualEngineAdaptation, { kind: "ok" }>,
      ),
    ).not.toThrow();
  });
});

describe("sequence stays on the native engine in Slice 1", () => {
  it("applyDiagramEnginePreference: sequence resolves to native under every preference", () => {
    const seq: DiagramIR = {
      id: "d-seq",
      engine: "native",
      diagramType: "sequence",
      title: "S",
      spec: {
        format: "arclume.native.v1",
        kind: "sequence",
        condensed: false,
        steps: [
          { id: "q-1", label: "A", ref: "cmp-a", index: 0 },
          { id: "q-2", label: "B", ref: "cmp-b", index: 1 },
        ],
        edges: [{ id: "sq-1", from: "q-1", to: "q-2", relationId: "rel-a-b" }],
      },
    };
    for (const preference of ["native", "visual", "auto"] as const) {
      const out = applyDiagramEnginePreference(deck([{ ...seq }]), { preference });
      expect(out.diagrams[0]?.engine).toBe("native");
    }
  });

  it("resolveDiagramEngines: a native sequence produces no visual engine artifact and a native report entry", async () => {
    const seq: DiagramIR = {
      id: "d-seq",
      engine: "native",
      diagramType: "sequence",
      title: "S",
      spec: {
        format: "arclume.native.v1",
        kind: "sequence",
        condensed: false,
        steps: [
          { id: "q-1", label: "A", ref: "cmp-a", index: 0 },
          { id: "q-2", label: "B", ref: "cmp-b", index: 1 },
        ],
        edges: [{ id: "sq-1", from: "q-1", to: "q-2", relationId: "rel-a-b" }],
      },
    };
    const { diagramArtifacts, report } = await resolveDiagramEngines(deck([seq]));
    expect(diagramArtifacts.has("d-seq")).toBe(false);
    expect(report.diagrams[0]).toMatchObject({ engineUsed: "native", outcome: "native" });
  });
});
