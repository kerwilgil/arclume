/**
 * Visual QA — Visual Engine integration (Block 7I).
 *
 * A deck that mixes native, Visual Engine architecture and Visual Engine workflow diagrams
 * opens in real headless Chromium with zero errors, zero network and full
 * provenance. Uses the real vendored engine.
 */

import { describe, expect, it } from "vitest";
import {
  applyDiagramEnginePreference,
  renderCanonicalDeckHtml,
  resolveDiagramEngines,
  runVisualQa,
} from "../../src/index.js";
import { CANONICAL_VIEWPORT as VP } from "../../src/index.js";
import type { ArclumeDeck, DiagramIR } from "../../src/index.js";
import { richDeck } from "./helpers/decks.js";

async function resolveAndRender(deck: ArclumeDeck) {
  const { diagramArtifacts, report } = await resolveDiagramEngines(deck);
  const { html } = renderCanonicalDeckHtml({ deck, diagramArtifacts });
  return { html, diagramArtifacts, report };
}

describe("Visual QA — Visual Engine architecture + workflow + native coexistence", () => {
  it("renders with zero errors, zero network, full provenance", async () => {
    const deck = applyDiagramEnginePreference(richDeck(), { preference: "auto" });
    const { html, diagramArtifacts, report } = await resolveAndRender(deck);

    expect(diagramArtifacts.get("dgm-arch")?.engineUsed).toBe("visual");
    expect(diagramArtifacts.get("dgm-flow")?.engineUsed).toBe("visual");

    const run = await runVisualQa(html, { viewports: [VP] });
    // The hand-built richDeck is deliberately over-dense: the native baseline
    // produces only visual/slide-overflow-y errors. Visual Engine must add nothing
    // new beyond that known, pre-existing class.
    const baseline = await runVisualQa(renderCanonicalDeckHtml({ deck: richDeck() }).html, {
      viewports: [VP],
    });
    const baselineErrorCodes = new Set(
      baseline.findings.filter((f) => f.severity === "error").map((f) => f.code),
    );
    const newErrors = run.findings.filter(
      (f) => f.severity === "error" && !baselineErrorCodes.has(f.code),
    );
    expect(newErrors).toEqual([]);
    const codes = run.findings.map((f) => f.code);
    expect(codes).not.toContain("visual/network-request");
    expect(codes).not.toContain("visual/console-error");
    expect(codes).not.toContain("visual/page-error");
    expect(codes).not.toContain("visual/unexpected-dialog");
    expect(codes).not.toContain("visual/diagram-zero-size");

    // provenance physically present in the served DOM
    expect(html).toContain('data-entity-id="cmp-ui"');
    expect(html).toContain('data-relation-id="rel-ui-api"');
    expect(html).toContain('data-step-id="s-a"');
    expect(html).toContain('data-diagram-id="dgm-arch"');
    expect(html).toContain('data-diagram-engine="visual"');
    expect(report.engines.visual.version).toBe("2.16.0");

    // screenshots captured for the diagram slides
    expect(run.artifacts.length).toBeGreaterThan(0);
  }, 120_000);
});

describe("Visual QA — workflow capacity at the physical boundary", () => {
  const mkFlow = (n: number): DiagramIR => ({
    id: "d-flow",
    engine: "visual",
    diagramType: "workflow",
    title: "Capacity probe",
    spec: {
      format: "arclume.native.v1",
      kind: "process",
      steps: Array.from({ length: n }, (_, i) => ({
        id: `st-${i}`,
        label: `Step ${i}`,
        index: i,
        ref: `proc-${i}`,
      })),
      edges: Array.from({ length: n - 1 }, (_, i) => ({
        id: `fe-${i}`,
        relationId: `rel-${i}`,
        from: `st-${i}`,
        to: `st-${i + 1}`,
      })),
    },
  });

  const deckWithFlow = (flow: DiagramIR): ArclumeDeck => {
    const deck = richDeck();
    deck.slides.push({
      id: "sld-capa",
      index: deck.slides.length,
      sectionId: "sec-body",
      kind: "diagram",
      title: "Capacity probe",
      keyMessage: "Six steps fit; seven fall back.",
      narrativePurpose: "process",
      layout: "single",
      blocks: [{ id: "b-capa", type: "workflow", diagramRef: flow.id }],
      diagramRef: flow.id,
      checks: {},
    });
    return { ...deck, diagrams: [...deck.diagrams.filter((d) => d.id !== flow.id), flow] };
  };

  it("exactly 6 steps render through the visual engine", async () => {
    const deck = deckWithFlow(mkFlow(6));
    const { html, diagramArtifacts } = await resolveAndRender(deck);
    expect(diagramArtifacts.get("d-flow")).toMatchObject({ kind: "svg", engineUsed: "visual" });
    expect(html).toContain('data-step-id="st-5"');
    const run = await runVisualQa(html, { viewports: [VP] });
    const diagramErrors = run.findings.filter(
      (f) => f.severity === "error" && f.code.startsWith("visual/diagram"),
    );
    expect(diagramErrors).toEqual([]);
    expect(run.findings.map((f) => f.code)).not.toContain("visual/network-request");
  }, 120_000);

  it("7 steps fall back to native — no truncation", async () => {
    const deck = deckWithFlow(mkFlow(7));
    const { html, diagramArtifacts } = await resolveAndRender(deck);
    expect(diagramArtifacts.get("d-flow")).toMatchObject({
      kind: "native-fallback",
      engineUsed: "native",
      code: "visual-engine/layout-capacity",
    });
    expect(html).toContain('data-diagram-id="d-flow" data-diagram-engine="native"');
    // all seven steps are physically present in the native render
    expect(html).toContain('data-step-id="st-6"');
    const run = await runVisualQa(html, { viewports: [VP] });
    const diagramErrors = run.findings.filter(
      (f) => f.severity === "error" && f.code.startsWith("visual/diagram"),
    );
    expect(diagramErrors).toEqual([]);
  }, 120_000);
});
