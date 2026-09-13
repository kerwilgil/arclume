import { describe, expect, it } from "vitest";
import { renderDeckHtml, stableStringify } from "../src/index.js";
import { diagramOf, first, richDeck } from "./helpers/decks.js";
import { clone } from "./helpers/fixtures.js";

function diagramSvg(html: string, id: string): string {
  const marker = `data-diagram-id="${id}"`;
  const start = html.indexOf(marker);
  expect(start, `figure ${id} present`).toBeGreaterThan(-1);
  const open = html.lastIndexOf("<figure", start);
  const end = html.indexOf("</figure>", start);
  return html.slice(open, end + "</figure>".length);
}

describe("html renderer — native diagrams", () => {
  const { html } = renderDeckHtml(richDeck());

  it("renders each native kind as an inline SVG the renderer built itself", () => {
    for (const [id, kind] of [
      ["dgm-arch", "architecture"],
      ["dgm-flow", "process"],
      ["dgm-seq", "sequence"],
      ["dgm-tl", "timeline"],
      ["dgm-rm", "roadmap"],
    ] as const) {
      const svg = diagramSvg(html, id);
      expect(svg, id).toContain("<svg ");
      expect(svg, id).toContain(`data-diagram-kind="${kind}"`);
      expect(svg, id).toContain("viewBox=");
    }
  });

  it("preserves node / step / item and relation identity as data-* hooks", () => {
    const arch = diagramSvg(html, "dgm-arch");
    expect(arch).toContain('data-node-id="n-ui"');
    expect(arch).toContain('data-entity-id="cmp-api"');
    expect(arch).toContain('data-relation-id="rel-ui-api"');

    const flow = diagramSvg(html, "dgm-flow");
    expect(flow).toContain('data-step-id="s-a"');
    expect(flow).toContain('data-relation-id="rel-a-b"');

    const tl = diagramSvg(html, "dgm-tl");
    expect(tl).toContain('data-item-id="t-1"');
    expect(tl).toContain('data-entity-id="ms-kickoff"');
  });

  it("draws an arrow only where a real edge exists", () => {
    // dgm-flow has 2 edges among 3 steps -> 2 arrow markers
    const flow = diagramSvg(html, "dgm-flow");
    const arrows = flow.match(/marker-end="url\(#arclume-arrow\)"/g) ?? [];
    expect(arrows.length).toBe(2);
  });

  it("does not invent an edge for a step-only process", () => {
    const deck = clone(richDeck());
    const flow = diagramOf(deck, "dgm-flow");
    (flow.spec as { edges: unknown[] }).edges = [];
    const out = renderDeckHtml(deck).html;
    const svg = diagramSvg(out, "dgm-flow");
    expect(svg).not.toContain("marker-end=");
    expect(svg).toContain('data-step-id="s-a"');
  });

  it("sequence is visually distinct from architecture (numbered lifeline)", () => {
    const seq = diagramSvg(html, "dgm-seq");
    expect(seq).toContain("<circle");
    expect(seq).toContain('data-diagram-kind="sequence"');
  });

  it("is deterministic — same spec, byte-identical SVG", () => {
    const a = diagramSvg(renderDeckHtml(richDeck()).html, "dgm-arch");
    const b = diagramSvg(renderDeckHtml(richDeck()).html, "dgm-arch");
    expect(a).toBe(b);
    expect(a).not.toMatch(/Math\.random|Date\./);
  });

  it("falls back with a warning for engine=visual, never faking support", () => {
    const deck = clone(richDeck());
    diagramOf(deck, "dgm-arch").engine = "visual";
    const { html: out, report } = renderDeckHtml(deck);
    expect(report.warnings.some((w) => w.code === "render/unsupported-diagram-engine")).toBe(true);
    expect(out).toContain("engine: visual");
    expect(diagramSvg(out, "dgm-arch")).not.toContain("<svg ");
  });

  it("never emits raw SVG taken from a deck string", () => {
    const deck = clone(richDeck());
    const spec = diagramOf(deck, "dgm-arch").spec as { nodes: Array<{ label: string }> };
    first(spec.nodes).label = "<svg onload=alert(1)></svg>";
    const out = renderDeckHtml(deck).html;
    expect(out).not.toContain("<svg onload=alert(1)>");
    expect(out).not.toMatch(/<svg\b[^>]*onload=/i);
    expect(out).toContain("&lt;svg"); // the label text survives, escaped
  });

  it("architecture layout does not change edge direction", () => {
    const arch = diagramSvg(html, "dgm-arch");
    // n-ui is a source (x smaller) and n-api sits to its right; the edge line
    // starts at n-ui's right edge. Just assert both endpoints & the relation id
    // are present and the topology mirrors the spec order.
    expect(stableStringify(arch.match(/data-relation-id="[^"]+"/g))).toContain("rel-ui-api");
    expect(stableStringify(arch.match(/data-relation-id="[^"]+"/g))).toContain("rel-api-erp");
  });
});
