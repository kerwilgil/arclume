/** Visual Engine fallback policy. */

import { describe, expect, it } from "vitest";
import { resolveDiagramEngines } from "../../../src/pipeline/resolve-diagrams.js";
import type { ArclumeDeck, DiagramIR } from "../../../src/types/deck.js";
import { architectureDiagram, workflowDiagram } from "./helpers.js";

/** Only the decks' `diagrams` field is read by the resolver. */
const deck = (diagrams: DiagramIR[]): ArclumeDeck => ({ diagrams }) as unknown as ArclumeDeck;

describe("Visual Engine fallback policy", () => {
  it("unsupported diagram kind → native fallback with loud report", async () => {
    // A kind visual engine has no adapter for at all (sequence/dataflow/lifecycle are
    // recognized now; a malformed one of those is a fatal integrity error, not a
    // fallback). "mindmap" exercises the defensive default → unsupported-diagram.
    const mm: DiagramIR = {
      ...architectureDiagram({ id: "d-mm" }),
      diagramType: "architecture",
      spec: { format: "arclume.native.v1", kind: "mindmap", nodes: [], edges: [] },
    };
    const { diagramArtifacts, report } = await resolveDiagramEngines(deck([mm]));
    const artifact = diagramArtifacts.get("d-mm");
    expect(artifact).toMatchObject({
      kind: "native-fallback",
      code: "visual-engine/unsupported-diagram",
    });
    expect(report.diagrams[0]).toMatchObject({
      outcome: "fallback",
      code: "visual-engine/unsupported-diagram",
    });
  });

  it("binary unavailable → native fallback", async () => {
    const { diagramArtifacts } = await resolveDiagramEngines(deck([architectureDiagram()]), {
      runner: { cliPath: "C:/nope/nothing.mjs" },
    });
    expect(diagramArtifacts.get("d-arch")).toMatchObject({
      kind: "native-fallback",
      code: "visual-engine/engine-unavailable",
    });
  });

  it("process failure → native fallback", async () => {
    const broken = architectureDiagram();
    broken.spec = {
      format: "arclume.native.v1",
      kind: "architecture",
      nodes: [{ id: "wide-node", label: "X".repeat(200), entityId: "cmp-wide" }],
      edges: [],
    };
    const { diagramArtifacts } = await resolveDiagramEngines(deck([broken]));
    // Visual engine's own layout constraints reject this; that is a render failure.
    expect(diagramArtifacts.get("d-arch")).toMatchObject({
      kind: "native-fallback",
      code: "visual-engine/render-failed",
    });
  });

  it("fallbackOnError: false makes environment failures fatal", async () => {
    await expect(
      resolveDiagramEngines(deck([architectureDiagram()]), {
        fallbackOnError: false,
        runner: { cliPath: "C:/nope/nothing.mjs" },
      }),
    ).rejects.toMatchObject({ code: "visual-engine/engine-unavailable" });
  });

  it("more than 6 workflow steps falls back; exactly 6 resolves", async () => {
    const ok = await resolveDiagramEngines(deck([workflowDiagram(6)]));
    expect(ok.diagramArtifacts.get("d-flow")?.kind).toBe("svg");

    const over = await resolveDiagramEngines(deck([workflowDiagram(7)]));
    expect(over.diagramArtifacts.get("d-flow")).toMatchObject({
      kind: "native-fallback",
      code: "visual-engine/layout-capacity",
    });
  });
});
