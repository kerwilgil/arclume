/**
 * Visual Engine SVG sanitizer (security-critical).
 *
 * Positive cases use real visual engine v2.16.0 output. Negative cases are
 * hand-crafted hostile inputs; every one must fail, never sanitize-down.
 */

import { describe, expect, it } from "vitest";
import {
  type SanitizeExpectation,
  adaptDiagramToVisualEngine,
  sanitizeVisualEngineSvgRegion,
} from "../../../src/engines/visual/index.js";
import {
  architectureDiagram,
  expectationFor,
  renderFixtureFor,
  workflowDiagram,
} from "./helpers.js";

describe("Visual Engine sanitizer — real v2.16.0 output", () => {
  it("sanitizes a real architecture render with true semantic provenance", async () => {
    const diagram = architectureDiagram();
    const html = await renderFixtureFor(diagram);
    const { svg, summary } = sanitizeVisualEngineSvgRegion(html, expectationFor(diagram));
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('data-diagram-id="d-arch"');
    // real ProjectKnowledge provenance — never the visual ids
    expect(svg).toContain('data-entity-id="cmp-ui"');
    expect(svg).toContain('data-entity-id="cmp-api"');
    expect(svg).toContain('data-relation-id="rel-ui-api"');
    expect(svg).toContain('data-relation-id="rel-api-db"');
    expect(svg).not.toContain('data-entity-id="n-ui"');
    expect(svg).not.toContain('data-relation-id="e-ui-api"');
    // visual direction evidence retained (ARCLUME-owned attributes)
    expect(svg).toContain('data-relation-from-node-id="n-ui"');
    expect(svg).toContain('data-relation-to-node-id="n-api"');
    expect(summary.nodes.sort()).toEqual(["cmp-api", "cmp-db", "cmp-ui"]);
    expect(summary.relations.map((r) => r.relationId).sort()).toEqual(["rel-api-db", "rel-ui-api"]);
    expect(summary.viewBox.width).toBeGreaterThan(0);
  });

  it("sanitizes a real workflow render (step structural id + semantic ref)", async () => {
    const diagram = workflowDiagram(4);
    const html = await renderFixtureFor(diagram);
    const { svg, summary } = sanitizeVisualEngineSvgRegion(html, expectationFor(diagram));
    expect(svg).toContain('data-step-id="s-1"');
    expect(svg).toContain('data-step-id="s-4"');
    expect(svg).toContain('data-step-ref="proc-step-1"');
    expect(svg).toContain('data-relation-id="rel-0-1"');
    expect(summary.nodes).toEqual(["s-1", "s-2", "s-3", "s-4"]);
  });

  it(" translates classes to presentation attributes and drops class/style hooks", async () => {
    const diagram = architectureDiagram();
    const html = await renderFixtureFor(diagram);
    const { svg } = sanitizeVisualEngineSvgRegion(html, expectationFor(diagram));
    expect(svg).not.toMatch(/\sclass\s*=/);
    expect(svg).not.toMatch(/\sstyle\s*=/);
    expect(svg).not.toContain("semantic-sigil");
    expect(svg).not.toContain("c-external");
    expect(svg).toContain('fill="var(--arclume-diagram-node-fill)"');
    expect(svg).toContain('stroke="var(--arclume-diagram-stroke)"');
    expect(svg).toContain('fill="var(--arclume-color-text-primary)"');
  });

  it("namespaces ids and rewrites local marker/pattern references", async () => {
    const diagram = architectureDiagram();
    const html = await renderFixtureFor(diagram);
    const { svg } = sanitizeVisualEngineSvgRegion(html, expectationFor(diagram));
    expect(svg).toContain('id="arcf-d-arch-arrowhead"');
    expect(svg).toContain('marker-end="url(#arcf-d-arch-arrowhead)"');
    expect(svg).toContain('fill="url(#arcf-d-arch-grid)"');
    expect(svg).not.toContain('id="arrowhead"');
  });

  it("is deterministic: same input → same output", async () => {
    const diagram = architectureDiagram();
    const html = await renderFixtureFor(diagram);
    const a = sanitizeVisualEngineSvgRegion(html, expectationFor(diagram));
    const b = sanitizeVisualEngineSvgRegion(html, expectationFor(diagram));
    expect(a.svg).toBe(b.svg);
  });
});

describe("Visual Engine sanitizer — hostile input", () => {
  const base: SanitizeExpectation = {
    nodeSemantics: new Map([["n1", { entityId: "cmp-x" }]]),
    edgeSemantics: new Map([["e1", { relationId: "rel-x", from: "n1", to: "n1" }]]),
    visualKind: "architecture",
    diagramId: "d-x",
  };

  const wrap = (body: string, rootAttrs = 'viewBox="0 0 100 100"'): string =>
    `<html><body><svg ${rootAttrs}>${body}</svg></body></html>`;

  const cases: Array<[string, string, string]> = [
    ["script element", wrap("<script>alert(1)</script>"), "visual-engine/unsafe-output"],
    ["style element", wrap("<style>svg{fill:red}</style>"), "visual-engine/unsafe-output"],
    [
      "foreignObject",
      wrap("<foreignObject><div></div></foreignObject>"),
      "visual-engine/unsafe-output",
    ],
    ["image", wrap('<image href="#x"/>'), "visual-engine/unsafe-output"],
    ["iframe", wrap('<iframe src="https://evil.example"/>'), "visual-engine/unsafe-output"],
    [
      "external href",
      wrap('<use href="https://evil.example/x.svg#a"/>'),
      "visual-engine/unsafe-output",
    ],
    [
      "onload handler",
      wrap('<rect width="1" height="1" onload="alert(1)"/>'),
      "visual-engine/unsafe-output",
    ],
    [
      "onclick handler",
      wrap('<g data-node-id="n1" onclick="alert(1)"/>'),
      "visual-engine/unsafe-output",
    ],
    [
      "style attribute",
      wrap('<rect width="1" height="1" style="fill:url(https://evil.example)"/>'),
      "visual-engine/unsafe-output",
    ],
    ["javascript href", wrap('<use href="javascript:alert(1)"/>'), "visual-engine/unsafe-output"],
    [
      "unknown presentation class",
      wrap('<rect width="1" height="1" class="evil-class"/>'),
      "visual-engine/unsafe-output",
    ],
    [
      "external marker reference",
      wrap('<path d="M0 0L1 1" marker-end="url(https://evil.example/m.svg#m)"/>'),
      "visual-engine/unsafe-output",
    ],
    [
      "dangling local reference",
      wrap('<path d="M0 0L1 1" marker-end="url(#missing)"/>'),
      "visual-engine/unsafe-output",
    ],
    [
      "protocol-relative reference",
      wrap('<use href="//evil.example/x"/>'),
      "visual-engine/unsafe-output",
    ],
    [
      "data URI reference",
      wrap('<use href="data:image/svg+xml,<svg/>"/>'),
      "visual-engine/unsafe-output",
    ],
    [
      "DOCTYPE",
      `<html><svg viewBox="0 0 10 10"><!DOCTYPE svg><rect width="1" height="1"/></svg></html>`,
      "visual-engine/unsafe-output",
    ],
    [
      "ENTITY declaration",
      `<html><svg viewBox="0 0 10 10"><!ENTITY x "y"/><rect width="1" height="1"/></svg></html>`,
      "visual-engine/unsafe-output",
    ],
    ["malformed XML", `<html><svg viewBox="0 0 10 10"><g></html>`, "visual-engine/output-invalid"],
    ["unknown node id", wrap('<g data-node-id="ghost"/>'), "visual-engine/topology-mismatch"],
  ];

  it.each(cases)("rejects %s", (_name, html, code) => {
    const err = catchCode(() => sanitizeVisualEngineSvgRegion(html, base));
    expect(err.code).toBe(code);
  });

  it("rejects an edge whose direction does not match the authored spec", () => {
    const expectation: SanitizeExpectation = {
      ...base,
      edgeSemantics: new Map([["e1", { relationId: "rel-x", from: "n1", to: "n2" }]]),
    };
    const html = wrap(
      '<path data-edge-id="e1" data-edge-from="n2" data-edge-to="n1" d="M0 0L1 1"/>',
    );
    const err = catchCode(() => sanitizeVisualEngineSvgRegion(html, expectation));
    expect(err.code).toBe("visual-engine/topology-mismatch");
  });

  it("rejects an unknown edge id", () => {
    const html = wrap(
      '<path data-edge-id="ghost" data-edge-from="n1" data-edge-to="n1" d="M0 0L1 1"/>',
    );
    const err = catchCode(() => sanitizeVisualEngineSvgRegion(html, base));
    expect(err.code).toBe("visual-engine/topology-mismatch");
  });
});

describe("Visual Engine sanitizer — malicious labels stay inert text", () => {
  it("escapes markup-looking labels instead of executing them", async () => {
    const diagram = architectureDiagram();
    const spec = diagram.spec as { nodes: Array<Record<string, unknown>>; edges: unknown[] };
    spec.nodes = [{ id: "n1", label: "<script>alert(1)</script>", entityId: "cmp-xss" }];
    spec.edges = [];
    const adapted = adaptDiagramToVisualEngine(diagram);
    if (adapted.kind !== "ok") throw new Error("fixture must adapt");
    const { svg } = sanitizeVisualEngineSvgRegion(
      await renderFixtureFor(diagram),
      expectationFor(diagram),
    );
    expect(svg).not.toContain("<script>");
    expect(svg).not.toContain("<script");
    expect(svg).toContain("<script>alert(1)</script>");
    expect(svg).toContain('data-entity-id="cmp-xss"');
  });
});

function catchCode(fn: () => unknown): { code: string; message: string } {
  try {
    fn();
  } catch (err) {
    const e = err as { code?: string; message?: string };
    return { code: e.code ?? "thrown-without-code", message: e.message ?? "" };
  }
  return { code: "did-not-throw", message: "" };
}
