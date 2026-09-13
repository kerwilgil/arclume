/**
 * Export coverage — a deck carrying Visual Engine dataflow + lifecycle diagrams
 * (Visual + Narrative Intelligence, Slice 1 — Visual Engine Completeness).
 *
 * The dataflow / lifecycle diagrams route to the visual engine, render, sanitize and
 * validate; the resolved artifacts then flow through the canonical HTML
 * renderer and the PPTX exporter with no loss of the diagram identity.
 */

import { describe, expect, it } from "vitest";
import { buildDeckPptx, validatePptxPackage } from "../src/export/index.js";
import {
  applyDiagramEnginePreference,
  assertRenderOutput,
  renderCanonicalDeckHtml,
  resolveDiagramEngines,
} from "../src/index.js";
import type { ArclumeDeck, DiagramIR } from "../src/index.js";
import { richDeck } from "./helpers/decks.js";

const NATIVE = "arclume.native.v1";

const dataflow: DiagramIR = {
  id: "dgm-df",
  engine: "visual",
  diagramType: "dataflow",
  title: "Ingest path",
  spec: {
    format: NATIVE,
    kind: "dataflow",
    condensed: false,
    stages: [{ label: "Source" }, { label: "Process" }, { label: "Store" }],
    nodes: [
      { id: "df-client", type: "frontend", label: "Client", stage: 0, row: 0 },
      { id: "df-api", type: "backend", label: "API", stage: 1, row: 0 },
      { id: "df-db", type: "database", label: "Database", stage: 2, row: 0 },
    ],
    flows: [
      { id: "df-f1", from: "df-client", to: "df-api", label: "request" },
      { id: "df-f2", from: "df-api", to: "df-db", label: "persist" },
    ],
  },
};

const lifecycle: DiagramIR = {
  id: "dgm-lc",
  engine: "visual",
  diagramType: "lifecycle",
  title: "Job lifecycle",
  spec: {
    format: NATIVE,
    kind: "lifecycle",
    condensed: false,
    lanes: [
      { id: "main", label: "Phase" },
      { id: "terminal", label: "Outcome" },
    ],
    states: [
      { id: "lc-created", type: "start", label: "Created", lane: "main", col: 0 },
      { id: "lc-proc", type: "active", label: "Processing", lane: "main", col: 1 },
      { id: "lc-done", type: "success", label: "Completed", lane: "terminal", col: 0 },
      { id: "lc-failed", type: "failure", label: "Failed", lane: "terminal", col: 1 },
    ],
    transitions: [
      { id: "lc-t1", from: "lc-created", to: "lc-proc", label: "start" },
      { id: "lc-t2", from: "lc-proc", to: "lc-done", label: "ok", route: "straight" },
      { id: "lc-t3", from: "lc-proc", to: "lc-failed", label: "error", route: "bottom-channel" },
    ],
  },
};

/** richDeck with a dataflow + lifecycle diagram wired into the diagram slide. */
function deckWithDataflowLifecycle(): ArclumeDeck {
  const base = richDeck();
  const slides = base.slides.map((s) =>
    s.id === "sld-arch"
      ? {
          ...s,
          blocks: [
            ...s.blocks,
            { id: "b-df", type: "diagram" as const, diagramRef: "dgm-df" },
            { id: "b-lc", type: "diagram" as const, diagramRef: "dgm-lc" },
          ],
        }
      : s,
  );
  return { ...base, diagrams: [...base.diagrams, dataflow, lifecycle], slides };
}

describe("export — dataflow + lifecycle", () => {
  it("both diagrams resolve through the visual engine to a validated SVG artifact", async () => {
    const deck = applyDiagramEnginePreference(deckWithDataflowLifecycle(), { preference: "auto" });
    expect(deck.diagrams.find((d) => d.id === "dgm-df")?.engine).toBe("visual");
    expect(deck.diagrams.find((d) => d.id === "dgm-lc")?.engine).toBe("visual");

    const { diagramArtifacts, report } = await resolveDiagramEngines(deck);
    for (const id of ["dgm-df", "dgm-lc"]) {
      const art = diagramArtifacts.get(id);
      expect(art?.kind).toBe("svg");
      if (art?.kind === "svg") {
        expect(art.svg).toContain("<svg");
        expect(art.engineUsed).toBe("visual");
      }
    }
    for (const entry of report.diagrams.filter(
      (e) => e.diagramId === "dgm-df" || e.diagramId === "dgm-lc",
    )) {
      expect(entry.outcome).toBe("resolved");
    }
  });

  it("HTML export embeds both sanitized SVGs and passes the structural self-check", async () => {
    const deck = applyDiagramEnginePreference(deckWithDataflowLifecycle(), { preference: "auto" });
    const { diagramArtifacts } = await resolveDiagramEngines(deck);
    const { html } = renderCanonicalDeckHtml({ deck, diagramArtifacts });

    expect(() => assertRenderOutput(deck, html)).not.toThrow();
    expect(html).toContain('data-diagram-id="dgm-df"');
    expect(html).toContain('data-diagram-id="dgm-lc"');
    // Structural node identities survive into the document.
    for (const id of [
      "df-client",
      "df-api",
      "df-db",
      "lc-created",
      "lc-proc",
      "lc-done",
      "lc-failed",
    ]) {
      expect(html).toContain(`data-step-id="${id}"`);
    }
    // No remote reference slipped in with the new engines.
    const withoutXmlns = html.replaceAll('xmlns="http://www.w3.org/2000/svg"', "");
    expect(withoutXmlns).not.toMatch(/(?:href|src)\s*=\s*["']\s*https?:/i);
  });

  it("PPTX export succeeds with a valid package + receipt for a deck with dataflow + lifecycle", async () => {
    const deck = applyDiagramEnginePreference(deckWithDataflowLifecycle(), { preference: "auto" });
    const { diagramArtifacts } = await resolveDiagramEngines(deck);
    const { bytes, receipt } = await buildDeckPptx({ deck, diagramArtifacts });
    expect(bytes.byteLength).toBeGreaterThan(0);
    // Structural/semantic determinism is the contract (not bytes): a stable digest.
    expect(receipt.output.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(validatePptxPackage(bytes, deck)).toEqual([]);
  });
});
