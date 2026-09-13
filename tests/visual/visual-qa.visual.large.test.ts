/**
 * Visual QA — dense Visual Engine architecture (Block 7I).
 *
 * A ~40-node DAG is near the practical envelope. It must render
 * through the Visual Engine with no critical geometry errors; nothing is truncated.
 */

import { describe, expect, it } from "vitest";
import {
  applyDiagramEnginePreference,
  renderCanonicalDeckHtml,
  resolveDiagramEngines,
  runVisualQa,
} from "../../src/index.js";
import { CANONICAL_VIEWPORT } from "../../src/index.js";
import { richDeck } from "./helpers/decks.js";

const NODE_COUNT = 40;

describe("Visual QA — dense Visual Engine architecture", () => {
  it("renders a 40-node DAG with no fatal geometry findings", async () => {
    const base = richDeck();
    const nodes = Array.from({ length: NODE_COUNT }, (_, i) => ({
      id: `n${String(i).padStart(2, "0")}`,
      label: `Component ${i}`,
      entityId: `cmp-${String(i).padStart(2, "0")}`,
    }));
    // a wide DAG: layer i → layer i+1 (10 per layer × 4 layers)
    const edges = [];
    for (let i = 0; i < NODE_COUNT - 10; i += 1) {
      edges.push({
        id: `e-${i}`,
        relationId: `rel-${i}`,
        from: `n${String(i).padStart(2, "0")}`,
        to: `n${String(i + 10).padStart(2, "0")}`,
      });
    }
    const diagram = {
      id: "dgm-large",
      engine: "visual" as const,
      diagramType: "architecture" as const,
      title: "Dense grid",
      spec: { format: "arclume.native.v1", kind: "architecture", nodes, edges },
    };
    const deck = {
      ...base,
      diagrams: [...base.diagrams, diagram],
      slides: [
        ...base.slides,
        {
          id: "sld-large",
          index: base.slides.length,
          sectionId: "sec-body",
          kind: "diagram" as const,
          title: "Dense grid",
          keyMessage: "A forty-node system at a glance.",
          narrativePurpose: "architecture" as const,
          layout: "full-bleed-visual" as const,
          blocks: [{ id: "b-large", type: "architecture" as const, diagramRef: diagram.id }],
          diagramRef: diagram.id,
          checks: {},
        },
      ],
    };
    const requested = applyDiagramEnginePreference(deck, { preference: "auto" });
    const { diagramArtifacts, report } = await resolveDiagramEngines(requested);
    const artifact = diagramArtifacts.get("dgm-large");
    expect(artifact).toMatchObject({ kind: "svg", engineUsed: "visual" });

    const { html } = renderCanonicalDeckHtml({ deck: requested, diagramArtifacts });
    // full provenance: all 40 nodes present
    for (const n of nodes) {
      expect(html).toContain(`data-entity-id="${n.entityId}"`);
    }
    expect(report.diagrams.find((d) => d.diagramId === "dgm-large")?.outcome).toBe("resolved");

    const run = await runVisualQa(html, { viewports: [CANONICAL_VIEWPORT] });
    const diagramErrors = run.findings.filter(
      (f) => f.severity === "error" && f.code.startsWith("visual/diagram"),
    );
    expect(diagramErrors).toEqual([]);
    const codes = run.findings.map((f) => f.code);
    expect(codes).not.toContain("visual/network-request");
    expect(codes).not.toContain("visual/page-error");
    expect(codes).not.toContain("visual/console-error");
    // The dense slide itself must not be flagged as overflowing or off-slide.
    const largeSlideErrors = run.findings.filter(
      (f) => f.slideId === "sld-large" && f.severity === "error",
    );
    expect(largeSlideErrors.map((f) => f.code)).toEqual([]);
  }, 120_000);
});
