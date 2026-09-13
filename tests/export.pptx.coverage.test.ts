/**
 * Phase 8 — PPTX block coverage matrix and Visual Engine diagram embedding.
 */

import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { blockHandlerMatrix, buildDeckPptx, requireAllBlocksCovered } from "../src/export/index.js";
import type { BlockType, DiagramIR } from "../src/index.js";

const BLOCK_TYPES: BlockType[] = [
  "text",
  "metric",
  "metric-grid",
  "comparison",
  "timeline",
  "roadmap",
  "risk",
  "status",
  "callout",
  "quote",
  "table",
  "image",
  "code",
  "diagram",
  "architecture",
  "workflow",
];
import { resolveVisualEngineDiagram } from "../src/engines/visual/index.js";
import { buildDeckPptx as _b } from "../src/export/pptx.js";
import type { ArclumeDeck } from "../src/types/deck.js";
import { richDeck } from "./helpers/decks.js";

describe("PPTX block coverage", () => {
  it("every known BlockType has a handler", () => {
    const covered = Object.keys(blockHandlerMatrix);
    const missing = BLOCK_TYPES.filter((t) => !covered.includes(t));
    expect(missing).toEqual([]);
    const audit = requireAllBlocksCovered([...BLOCK_TYPES]);
    expect(audit.covered).toBe(true);
  });

  it("all sixteen block types render through the exporter without damage", async () => {
    const deck = richDeck();
    const { bytes, receipt } = await buildDeckPptx({ deck });
    expect(receipt.validation.valid).toBe(true);
    expect(bytes.length).toBeGreaterThan(2000);
    const entries = unzipSync(new Uint8Array(bytes));
    const all = Object.keys(entries);
    expect(all.some((n) => n === "ppt/presentation.xml")).toBe(true);
  });
});

describe("PPTX Visual Engine diagram embedding", () => {
  it("embeds the sanitized Visual Engine SVG as image content (not raw prose)", async () => {
    const diagram: DiagramIR = {
      id: "d-a",
      engine: "visual",
      diagramType: "architecture",
      title: "Topology",
      spec: {
        format: "arclume.native.v1",
        kind: "architecture",
        nodes: [
          { id: "n-ui", label: "UI", entityId: "cmp-ui" },
          { id: "n-api", label: "API", entityId: "cmp-api" },
        ],
        edges: [{ id: "e-1", from: "n-ui", to: "n-api", relationId: "rel-1" }],
      },
    };
    const artifact = await resolveVisualEngineDiagram(diagram);
    const deck: ArclumeDeck = {
      irVersion: "0.2.0",
      meta: { title: "T" },
      project: { name: "P" },
      audience: { preset: "general" },
      narrative: {
        preset: "general",
        throughline: "x",
        sections: [{ id: "sec-only", title: "Only", purpose: "All" }],
      },
      theme: {
        name: "minimal",
        aspectRatio: "16:9",
        mode: "light",
        tokensRef: "tokens:minimal:test",
      },
      provenance: { sources: [{ id: "s", kind: "text", title: "x" }] },
      slides: [
        {
          id: "s1",
          index: 0,
          kind: "diagram",
          title: "Graph",
          keyMessage: "A → B",
          narrativePurpose: "architecture",
          layout: "single",
          blocks: [{ id: "b1", type: "architecture", diagramRef: "d-a" }],
          checks: {},
        },
      ],
      diagrams: [diagram],
    };
    const { bytes, receipt } = await buildDeckPptx(
      { deck },
      {
        diagramArtifacts: new Map([["d-a", artifact]]),
      },
    );
    expect(receipt.diagramArtifacts.length).toBe(1);
    expect(receipt.diagramArtifacts[0]?.engineUsed).toBe("visual");
    const entries = unzipSync(new Uint8Array(bytes));
    const slide1 = strFromU8(entries["ppt/slides/slide1.xml"] as Uint8Array);
    // an embedded <p:pic> means the sanitized SVG was embedded as an image
    expect(slide1).toContain("<p:pic>");
    // media binary present
    const media = Object.keys(entries).filter((k) => k.startsWith("ppt/media/"));
    expect(media.length).toBeGreaterThan(0);
  });
});
