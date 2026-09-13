/** Canonical render — Visual Engine artifacts (Block 7G). */

import { describe, expect, it } from "vitest";
import {
  applyDiagramEnginePreference,
  renderCanonicalDeckHtml,
  resolveDiagramEngines,
} from "../../src/index.js";
import { richDeck } from "../helpers/decks.js";

describe("renderCanonicalDeckHtml — Visual Engine artifacts", () => {
  it("embeds the sanitized Visual Engine SVG for architecture and workflow", async () => {
    const deck = applyDiagramEnginePreference(richDeck(), { preference: "auto" });
    const { diagramArtifacts } = await resolveDiagramEngines(deck);
    const { html } = renderCanonicalDeckHtml({ deck, diagramArtifacts });

    expect(html).toContain('data-diagram-id="dgm-arch" data-diagram-engine="visual"');
    expect(html).toContain('data-diagram-id="dgm-flow" data-diagram-engine="visual"');
    expect(html).toContain('data-entity-id="cmp-ui"');
    expect(html).toContain('data-relation-id="rel-ui-api"');
    expect(html).toContain('data-step-id="s-a"');
    // native diagrams still render natively
    expect(html).toContain('data-diagram-id="dgm-seq" data-diagram-engine="native"');
    // and the placeholder legacy path is NOT in play
    expect(html).not.toContain("render/unsupported-diagram-engine");
    expect(html).not.toContain("Phase 7).</div>");
  });

  it("is stable across runs (same deck → same artifact → same HTML)", async () => {
    const deck = applyDiagramEnginePreference(richDeck(), { preference: "auto" });
    const a = await resolveDiagramEngines(deck);
    const b = await resolveDiagramEngines(deck);
    const htmlA = renderCanonicalDeckHtml({ deck, diagramArtifacts: a.diagramArtifacts }).html;
    const htmlB = renderCanonicalDeckHtml({ deck, diagramArtifacts: b.diagramArtifacts }).html;
    expect(htmlA).toBe(htmlB);
  });

  it("a native-fallback artifact renders the native diagram with the fallback warning", async () => {
    const deck = richDeck();
    const flow = deck.diagrams.find((d) => d.id === "dgm-flow");
    if (flow === undefined) throw new Error("missing diagram");
    const steps = Array.from({ length: 7 }, (_, i) => ({
      id: `s-${i}`,
      label: `S${i}`,
      index: i,
      ref: `proc-${i}`,
    }));
    flow.spec = {
      format: "arclume.native.v1",
      kind: "process",
      steps,
      edges: steps.slice(0, -1).map((s, i) => ({
        id: `e-${i}`,
        relationId: `rel-${i}`,
        from: s.id,
        to: (steps[i + 1] as { id: string }).id,
      })),
    };
    const requested = applyDiagramEnginePreference(deck, { preference: "auto" });
    const { diagramArtifacts } = await resolveDiagramEngines(requested);
    const { html, report } = renderCanonicalDeckHtml({
      deck: requested,
      diagramArtifacts,
    });
    expect(html).toContain('data-diagram-id="dgm-flow" data-diagram-engine="native"');
    expect(report.warnings.some((w) => w.code === "visual-engine/fallback-native")).toBe(true);
  });
});
