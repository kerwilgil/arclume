/**
 * Sequence: participant-aware model → Visual Engine routing (Visual Intelligence,
 * Slice 2a).
 *
 * A `sequence` flow whose steps map to ≥2 distinct actor/component entities is
 * projected onto Visual Engine participants + messages and routes to the Visual Engine
 * sequence renderer; a step-list sequence stays native. The decision is
 * structural and deterministic; provenance survives the engine.
 */

import { describe, expect, it } from "vitest";
import {
  type ProjectKnowledge,
  buildFlowModel,
  buildKnowledgeView,
  nativeDiagramAdapter,
} from "../src/index.js";
import { applyDiagramEnginePreference } from "../src/pipeline/diagram-engine-preference.js";
import { resolveDiagramEngines } from "../src/pipeline/resolve-diagrams.js";
import type { ArclumeDeck, DiagramIR } from "../src/types/deck.js";
import { DEFAULT_VISUAL_LIMITS } from "../src/visual/types.js";
import { loadFixture } from "./helpers/fixtures.js";

const L = DEFAULT_VISUAL_LIMITS;
const seqK = () => loadFixture<ProjectKnowledge>("knowledge/valid/sequence-flow.json");
const rich = () => loadFixture<ProjectKnowledge>("knowledge/valid/rich.json");
const deck = (diagrams: DiagramIR[]): ArclumeDeck => ({ diagrams }) as unknown as ArclumeDeck;

function seqModel(k: ProjectKnowledge) {
  const view = buildKnowledgeView(k);
  const ids = [...k.components.map((c) => c.id), ...k.relations.map((r) => r.id)];
  return buildFlowModel(view, ids, "sequence", L);
}

describe("participant-aware sequence model", () => {
  it("derives participants ONLY from real actor/component entities the steps anchor to", () => {
    const model = seqModel(seqK());
    expect(model?.kind).toBe("sequence");
    if (model?.kind !== "sequence" || !model.participants) throw new Error("expected participants");
    expect(model.participants.map((p) => p.entityId).sort()).toEqual([
      "cmp-api",
      "cmp-psp",
      "cmp-web",
    ]);
    // component.kind → vendored componentType
    const typeOf = new Map(model.participants.map((p) => [p.entityId, p.type]));
    expect(typeOf.get("cmp-web")).toBe("frontend");
    expect(typeOf.get("cmp-api")).toBe("backend");
    expect(typeOf.get("cmp-psp")).toBe("external");
  });

  it("messages keep sender, receiver, order and the relation's own label + id", () => {
    const model = seqModel(seqK());
    if (model?.kind !== "sequence" || !model.messages) throw new Error("expected messages");
    // relations sorted by id: rel-api-psp, rel-psp-api, rel-web-api
    expect(model.messages.map((m) => [m.from, m.to, m.label])).toEqual([
      ["cmp-api", "cmp-psp", "authorize"],
      ["cmp-psp", "cmp-api", "auth result"],
      ["cmp-web", "cmp-api", "submit order"],
    ]);
    expect(model.messages.map((m) => m.ref)).toEqual(["rel-api-psp", "rel-psp-api", "rel-web-api"]);
    // y is strictly increasing and within the adapter's floor.
    const ys = model.messages.map((m) => m.y);
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
    expect(ys[0]).toBeGreaterThanOrEqual(160);
  });

  it("a single-process step list has one participant → no projection, stays native", () => {
    const model = buildFlowModel(
      buildKnowledgeView(rich()),
      [rich().processes[0]?.id ?? "x"],
      "sequence",
      L,
    );
    expect(model?.kind).toBe("sequence");
    if (model?.kind !== "sequence") return;
    expect(model.participants).toBeUndefined();
  });

  it("determinism: same knowledge → identical participants + messages regardless of id order", () => {
    const k = seqK();
    const a = seqModel(k);
    const shuffled: ProjectKnowledge = {
      ...k,
      components: [...k.components].reverse(),
      relations: [...k.relations].reverse(),
    };
    const b = seqModel(shuffled);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("sequence engine routing", () => {
  it("participant-aware sequence → visual engine under 'visual'/'auto', native under 'native'", () => {
    const model = seqModel(seqK());
    if (model?.kind !== "sequence") throw new Error("expected sequence");
    const ir = nativeDiagramAdapter.toDiagramIR(model, "dgm-seq", "Handshake");
    const spec = ir.spec as { kind?: string; participants?: unknown[] };
    expect(spec.kind).toBe("sequence");
    expect(Array.isArray(spec.participants)).toBe(true);

    for (const preference of ["visual", "auto"] as const) {
      expect(
        applyDiagramEnginePreference(deck([{ ...ir }]), { preference }).diagrams[0]?.engine,
      ).toBe("visual");
    }
    expect(
      applyDiagramEnginePreference(deck([{ ...ir }]), { preference: "native" }).diagrams[0]?.engine,
    ).toBe("native");
  });

  it("a step-list sequence spec is never routed to the visual engine", () => {
    const nativeIr: DiagramIR = {
      id: "d",
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
        edges: [],
      },
    };
    for (const preference of ["visual", "auto"] as const) {
      expect(
        applyDiagramEnginePreference(deck([nativeIr]), { preference }).diagrams[0]?.engine,
      ).toBe("native");
    }
  });

  it("end to end: the routed sequence resolves to a validated Visual Engine SVG artifact", async () => {
    const model = seqModel(seqK());
    if (model?.kind !== "sequence") throw new Error("expected sequence");
    const ir = nativeDiagramAdapter.toDiagramIR(model, "dgm-seq", "Handshake");
    const routed = applyDiagramEnginePreference(deck([ir]), { preference: "auto" });
    expect(routed.diagrams[0]?.engine).toBe("visual");

    const { diagramArtifacts, report } = await resolveDiagramEngines(routed);
    const art = diagramArtifacts.get("dgm-seq");
    expect(art?.kind).toBe("svg");
    if (art?.kind === "svg") {
      expect(art.svg).toContain("<svg");
      expect(art.engineUsed).toBe("visual");
      // participant + message identity survives the engine
      for (const id of ["cmp-web", "cmp-api", "cmp-psp"]) {
        expect(art.svg).toContain(`data-step-id="${id}"`);
      }
    }
    expect(report.diagrams[0]?.outcome).toBe("resolved");
  });
});
