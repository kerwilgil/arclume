/**
 * Visual QA — Visual Engine XSS corpus (Block 7I).
 *
 * XSS payloads as Visual Engine diagram labels / titles must open completely inert
 * in real Chromium: no dialogs, no errors, no marker execution.
 */

import { describe, expect, it } from "vitest";
import {
  applyDiagramEnginePreference,
  renderCanonicalDeckHtml,
  resolveDiagramEngines,
  runVisualQa,
} from "../../src/index.js";
import type { ArclumeDeck, DiagramIR } from "../../src/index.js";
import { CANONICAL_VIEWPORT } from "../../src/index.js";
import { richDeck } from "./helpers/decks.js";
import { openDeck } from "./helpers/page.js";

const CORPUS = [
  "<script>alert(1)</script>",
  "<img src=x onerror=alert(1)>",
  "</svg><script>alert(2)</script>",
  '" onclick="alert(3)',
  "& < > \" '",
  "javascript:alert(1)",
  "url(https://evil.example)",
];

function corpusDeck(): ArclumeDeck {
  const base = richDeck();
  const diagrams: DiagramIR[] = CORPUS.map((label, i) => ({
    id: `dgm-xss-${i}`,
    engine: "visual",
    diagramType: "architecture",
    title: `Payload ${i}: ${label}`,
    spec: {
      format: "arclume.native.v1",
      kind: "architecture",
      nodes: [
        { id: "n-a", label, entityId: "cmp-x" },
        { id: "n-b", label: "Peer", entityId: "cmp-peer" },
      ],
      edges: [{ id: "e-1", from: "n-a", to: "n-b", relationId: "rel-x" }],
    },
  }));
  // Reference the payloads from slides so they reach the DOM.
  const blocks = diagrams.map((d, i) => ({
    id: `b-xss-${i}`,
    type: "architecture" as const,
    diagramRef: d.id,
  }));
  const deck: ArclumeDeck = {
    ...base,
    diagrams: [...base.diagrams, ...diagrams],
    slides: [
      ...base.slides.map((s, i) => ({ ...s, index: i })),
      {
        id: "sld-xss",
        index: base.slides.length,
        sectionId: "sec-body",
        kind: "diagram",
        title: "XSS payloads",
        keyMessage: "Every payload is text, never markup.",
        narrativePurpose: "risk",
        layout: "grid",
        blocks,
        checks: {},
      },
    ],
  };
  return deck;
}

describe("Visual QA — Visual Engine XSS corpus", () => {
  it("every payload renders as inert text through the full engine pipeline", async () => {
    const deck = corpusDeck();
    const { diagramArtifacts } = await resolveDiagramEngines(deck);
    const { html } = renderCanonicalDeckHtml({ deck, diagramArtifacts });

    const run = await runVisualQa(html, {
      viewports: [CANONICAL_VIEWPORT],
      screenshots: false,
    });
    const codes = run.findings.map((f) => f.code);
    expect(codes).not.toContain("visual/unexpected-dialog");
    expect(codes).not.toContain("visual/page-error");
    expect(codes).not.toContain("visual/console-error");
    expect(codes).not.toContain("visual/network-request");

    const opened = await openDeck(html);
    try {
      const marker = await opened.page.evaluate(
        () => (window as unknown as { __arclume_xss__?: boolean }).__arclume_xss__ ?? false,
      );
      expect(marker).toBe(false);
      expect(await opened.page.evaluate(() => document.querySelectorAll("script").length)).toBe(1);
    } finally {
      await opened.close();
    }
  }, 120_000);
});
