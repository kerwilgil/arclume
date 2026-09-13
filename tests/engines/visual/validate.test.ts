/** Visual Engine post-engine validation. */

import { describe, expect, it } from "vitest";
import {
  type SanitizedSvg,
  type VisualEngineAdaptation,
  adaptDiagramToVisualEngine,
  sanitizeVisualEngineSvgRegion,
  validateSanitizedDiagram,
} from "../../../src/engines/visual/index.js";
import {
  architectureDiagram,
  expectationFor,
  renderFixtureFor,
  workflowDiagram,
} from "./helpers.js";

interface Fixture {
  adaptation: Extract<VisualEngineAdaptation, { kind: "ok" }>;
  sanitized: SanitizedSvg;
}

async function visualFixture(): Promise<Fixture> {
  const diagram = architectureDiagram();
  const adaptation = adaptDiagramToVisualEngine(diagram);
  if (adaptation.kind !== "ok") throw new Error("fixture must adapt");
  const html = await renderFixtureFor(diagram);
  const sanitized = sanitizeVisualEngineSvgRegion(html, expectationFor(diagram));
  return { adaptation, sanitized };
}

const code = (fn: () => void): string => {
  try {
    fn();
  } catch (err) {
    return (err as { code?: string }).code ?? "thrown-without-code";
  }
  return "did-not-throw";
};

describe("Visual Engine post-engine validation", () => {
  it("accepts a faithful engine round-trip", async () => {
    const { adaptation, sanitized } = await visualFixture();
    expect(() => validateSanitizedDiagram(sanitized, adaptation)).not.toThrow();
  });

  it("detects a dropped node (provenance-loss)", async () => {
    const { adaptation, sanitized } = await visualFixture();
    const tampered: SanitizedSvg = {
      svg: sanitized.svg.replace('data-entity-id="cmp-api"', ""),
      summary: { ...sanitized.summary, nodes: ["cmp-db", "cmp-ui"] },
    };
    expect(code(() => validateSanitizedDiagram(tampered, adaptation))).toBe(
      "visual-engine/provenance-loss",
    );
  });

  it("detects an extra semantic node (topology-mismatch)", async () => {
    const { adaptation, sanitized } = await visualFixture();
    const tampered: SanitizedSvg = {
      svg: sanitized.svg,
      summary: { ...sanitized.summary, nodes: [...sanitized.summary.nodes, "cmp-rogue"] },
    };
    expect(code(() => validateSanitizedDiagram(tampered, adaptation))).toBe(
      "visual-engine/topology-mismatch",
    );
  });

  it("detects a dropped relation (provenance-loss)", async () => {
    const { adaptation, sanitized } = await visualFixture();
    const tampered: SanitizedSvg = {
      svg: sanitized.svg.replace('data-relation-id="rel-ui-api"', ""),
      summary: {
        ...sanitized.summary,
        relations: sanitized.summary.relations.filter((r) => r.relationId !== "rel-ui-api"),
      },
    };
    expect(code(() => validateSanitizedDiagram(tampered, adaptation))).toBe(
      "visual-engine/provenance-loss",
    );
  });

  it("detects a reversed relation direction (topology-mismatch)", async () => {
    const { adaptation, sanitized } = await visualFixture();
    const tampered: SanitizedSvg = {
      svg: sanitized.svg,
      summary: {
        ...sanitized.summary,
        relations: sanitized.summary.relations.map((r) =>
          r.relationId === "rel-ui-api" ? { ...r, from: r.to, to: r.from } : r,
        ),
      },
    };
    expect(code(() => validateSanitizedDiagram(tampered, adaptation))).toBe(
      "visual-engine/topology-mismatch",
    );
  });

  it("detects residual active markup (unsafe-output)", async () => {
    const { adaptation, sanitized } = await visualFixture();
    const tampered: SanitizedSvg = {
      svg: sanitized.svg.replace("</svg>", "<script>x</script></svg>"),
      summary: sanitized.summary,
    };
    expect(code(() => validateSanitizedDiagram(tampered, adaptation))).toBe(
      "visual-engine/unsafe-output",
    );
  });

  it("rejects residual sentinel classes at the sanitizer (structural, not string)", async () => {
    const hostile = `<svg viewBox="0 0 10 10"><rect class="c-external" width="2" height="2"/></svg>`;
    const out = sanitizeVisualEngineSvgRegion(hostile, {
      nodeSemantics: new Map(),
      edgeSemantics: new Map(),
      visualKind: "architecture",
      diagramId: "d-x",
    });
    expect(out.svg).not.toContain("class=");
    expect(out.svg).toContain('fill="var(--arclume-diagram-node-fill)"');
  });

  it("detects an empty SVG (output-invalid)", async () => {
    const { adaptation } = await visualFixture();
    expect(
      code(() =>
        validateSanitizedDiagram(
          {
            svg: "",
            summary: {
              nodes: [],
              visualNodes: [],
              relations: [],
              viewBox: { width: 0, height: 0 },
            },
          },
          adaptation,
        ),
      ),
    ).toBe("visual-engine/output-invalid");
  });

  it("detects a reordered workflow (order-mismatch)", async () => {
    const diagram = workflowDiagram(3);
    const adaptation = adaptDiagramToVisualEngine(diagram);
    if (adaptation.kind !== "ok") throw new Error("fixture must adapt");
    const html = await renderFixtureFor(diagram);
    const sanitized = sanitizeVisualEngineSvgRegion(html, expectationFor(diagram));
    expect(() => validateSanitizedDiagram(sanitized, adaptation)).not.toThrow();
    const reordered: SanitizedSvg = {
      svg: sanitized.svg,
      summary: { ...sanitized.summary, nodes: ["s-2", "s-1", "s-3"] },
    };
    expect(code(() => validateSanitizedDiagram(reordered, adaptation))).toBe(
      "visual-engine/order-mismatch",
    );
  });
});
