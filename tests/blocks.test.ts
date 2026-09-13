import { describe, expect, it } from "vitest";
import { validateArclumeDeck } from "../src/index.js";

function deckWithBlocks(blocks: unknown[], diagrams: unknown[] = []): unknown {
  return {
    irVersion: "0.1.0",
    meta: { title: "block harness" },
    project: { name: "X" },
    audience: { preset: "general" },
    narrative: {
      preset: "general",
      throughline: "t",
      sections: [{ id: "s1", title: "S", purpose: "p" }],
    },
    theme: { name: "minimal" },
    provenance: { sources: [{ id: "src", kind: "text", title: "note" }] },
    slides: [
      {
        id: "sld-1",
        index: 0,
        kind: "content",
        title: "Blocks",
        keyMessage: "one idea",
        narrativePurpose: "summary",
        layout: "single",
        blocks,
        checks: {},
      },
    ],
    diagrams,
  };
}

const VALID_BLOCKS: Record<string, unknown> = {
  text: { id: "b-text", type: "text", text: "hello", format: "markdown" },
  metric: { id: "b-metric", type: "metric", label: "Users", value: "1,024", direction: "up-good" },
  "metric-grid": {
    id: "b-grid",
    type: "metric-grid",
    metrics: [
      { label: "A", value: "1" },
      { label: "B", value: "2" },
    ],
  },
  comparison: {
    id: "b-cmp",
    type: "comparison",
    left: { title: "Before" },
    right: { title: "After" },
    rows: [{ label: "Cost", left: "high", right: "low" }],
  },
  timeline: {
    id: "b-tl",
    type: "timeline",
    items: [{ label: "Kickoff", date: "2026-01", state: "done" }],
  },
  roadmap: {
    id: "b-rm",
    type: "roadmap",
    phases: [{ name: "Phase 1", status: "active", items: ["x"] }],
  },
  risk: {
    id: "b-risk",
    type: "risk",
    statement: "Vendor lock-in",
    likelihood: "low",
    impact: "medium",
    factType: "INFERENCE",
  },
  status: { id: "b-status", type: "status", state: "amber", label: "At risk" },
  callout: { id: "b-callout", type: "callout", tone: "info", text: "Note this." },
  quote: { id: "b-quote", type: "quote", text: "It just works.", attribution: "Pilot user" },
  table: {
    id: "b-table",
    type: "table",
    columns: ["Name", "Value"],
    rows: [["Latency", "12ms"]],
  },
  image: { id: "b-image", type: "image", src: "assets/x.png", alt: "diagram", fit: "contain" },
  code: { id: "b-code", type: "code", language: "ts", code: "export const x = 1;" },
  diagram: { id: "b-diagram", type: "diagram", diagramRef: "dgm" },
  architecture: { id: "b-arch", type: "architecture", diagramRef: "dgm-arch" },
  workflow: { id: "b-wf", type: "workflow", diagramRef: "dgm-wf" },
};

const DIAGRAMS = [
  { id: "dgm", engine: "native", diagramType: "timeline" },
  { id: "dgm-arch", engine: "visual", diagramType: "architecture" },
  { id: "dgm-wf", engine: "visual", diagramType: "workflow" },
];

describe("every block type has a valid shape", () => {
  for (const [name, block] of Object.entries(VALID_BLOCKS)) {
    it(`accepts a well-formed "${name}" block`, () => {
      const needsDiagrams = ["diagram", "architecture", "workflow"].includes(name);
      const result = validateArclumeDeck(deckWithBlocks([block], needsDiagrams ? DIAGRAMS : []));
      expect(result.errors, JSON.stringify(result.errors)).toEqual([]);
    });
  }

  it("accepts all block types together on one slide", () => {
    const result = validateArclumeDeck(deckWithBlocks(Object.values(VALID_BLOCKS), DIAGRAMS));
    expect(result.errors).toEqual([]);
  });
});

describe("block negative cases", () => {
  it("rejects an unknown block type", () => {
    const result = validateArclumeDeck(
      deckWithBlocks([{ id: "b-x", type: "carousel", slides: [] }]),
    );
    expect(result.valid).toBe(false);
  });

  it("rejects a block missing its discriminated-required field", () => {
    const result = validateArclumeDeck(deckWithBlocks([{ id: "b-x", type: "callout" }]));
    expect(result.valid).toBe(false);
  });

  it("rejects a metric-grid with only one metric", () => {
    const result = validateArclumeDeck(
      deckWithBlocks([{ id: "b-x", type: "metric-grid", metrics: [{ label: "A", value: "1" }] }]),
    );
    expect(result.valid).toBe(false);
  });

  it("rejects a block id that violates the id pattern", () => {
    const result = validateArclumeDeck(deckWithBlocks([{ id: "1-bad", type: "text", text: "hi" }]));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "schema/pattern")).toBe(true);
  });

  it("warns when an architecture block references a workflow diagram", () => {
    const result = validateArclumeDeck(
      deckWithBlocks([{ id: "b-arch", type: "architecture", diagramRef: "dgm-wf" }], DIAGRAMS),
    );
    expect(result.warnings.some((w) => w.code === "block/diagram-type-mismatch")).toBe(true);
  });
});
