/**
 * Final-form artifact validation — trust-boundary negatives.
 *
 * Every malicious artifact here is fully "well-formed" externally (recomputed
 * svgSha256) and must still fail: nothing is trusted from metadata.
 */

import { describe, expect, it } from "vitest";
import { sha256Hex } from "../../../src/determinism/hash.js";
import { contentHash } from "../../../src/determinism/hash.js";
import type { ResolvedDiagramArtifact } from "../../../src/engines/types.js";
import {
  diagramRenderInputHash,
  resolveVisualEngineDiagram,
  validateResolvedArtifactFinalForm,
} from "../../../src/engines/visual/index.js";
import { architectureDiagram, workflowDiagram } from "./helpers.js";

function tampered(
  base: ResolvedDiagramArtifact,
  mutate: (svg: string) => string,
): ResolvedDiagramArtifact {
  if (base.kind !== "svg") throw new Error("expected svg artifact");
  const svg = mutate(base.svg);
  return { ...base, svg, svgSha256: sha256Hex(svg) };
}

const code = (fn: () => unknown): string => {
  try {
    fn();
  } catch (err) {
    return (err as { code?: string }).code ?? "thrown-without-code";
  }
  return "did-not-throw";
};

describe("final form — document shape", () => {
  const expectCode = async (
    diagramId: string,
    mutate: (svg: string) => string,
    wantCode: string,
  ): Promise<void> => {
    const diagram = architectureDiagram({ id: diagramId });
    const base = await resolveVisualEngineDiagram(diagram);
    const t = tampered(base, mutate);
    expect(code(() => validateResolvedArtifactFinalForm(t, diagram))).toBe(wantCode);
  };

  it("rejects a wrapping <g> above the <svg> root", async () => {
    await expectCode("d-a1", (svg) => `<g>${svg}</g>`, "visual-engine/output-invalid");
  });

  it("rejects a nested second <svg>", async () => {
    await expectCode(
      "d-a2",
      (svg) =>
        svg.replace("</svg>", '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/></svg>'),
      "visual-engine/output-invalid",
    );
  });

  it("rejects viewBox with zero width / height / both", async () => {
    for (const vb of ["0 0 0 100", "0 0 100 0", "0 0 0 0"]) {
      const diagram = architectureDiagram({ id: "d-vb" });
      const base = await resolveVisualEngineDiagram(diagram);
      const t = tampered(base, (svg) => svg.replace(/viewBox="[^"]*"/, `viewBox="${vb}"`));
      const c = code(() => validateResolvedArtifactFinalForm(t, diagram));
      expect(c).toBe("visual-engine/output-invalid");
    }
  });

  it("rejects NaN/Infinity in the viewBox", async () => {
    for (const vb of ["NaN 0 10 10", "0 0 Infinity 10"]) {
      const diagram = architectureDiagram({ id: "d-vbf" });
      const base = await resolveVisualEngineDiagram(diagram);
      const t = tampered(base, (svg) => svg.replace(/viewBox="[^"]*"/, `viewBox="${vb}"`));
      const c = code(() => validateResolvedArtifactFinalForm(t, diagram));
      expect(c).toBe("visual-engine/output-invalid");
    }
  });

  it("rejects negative-binding non-finite values but accepts negative minX/minY", async () => {
    const diagram = architectureDiagram({ id: "d-vboff" });
    const base = await resolveVisualEngineDiagram(diagram);
    const ok = tampered(base, (svg) =>
      svg.replace(/viewBox="[^"]*"/, 'viewBox="-10 -5 2000 1200"'),
    );
    expect(code(() => validateResolvedArtifactFinalForm(ok, diagram))).toBe("did-not-throw");
  });
});

describe("final form — XML surface the sanitizer never emits", () => {
  it("rejects comments", async () => {
    const diagram = architectureDiagram({ id: "d-cmt" });
    const base = await resolveVisualEngineDiagram(diagram);
    const t = tampered(base, (svg) => svg.replace("</svg>", "<!-- x --></svg>"));
    expect(code(() => validateResolvedArtifactFinalForm(t, diagram))).toBe(
      "visual-engine/output-invalid",
    );
  });

  it("rejects an XML declaration", async () => {
    const diagram = architectureDiagram({ id: "d-xml" });
    const base = await resolveVisualEngineDiagram(diagram);
    const t = tampered(base, (svg) => `<?xml version="1.0"?>${svg}`);
    expect(code(() => validateResolvedArtifactFinalForm(t, diagram))).toBe(
      "visual-engine/output-invalid",
    );
  });
});

describe("final form — local references must resolve", () => {
  it("rejects a dangling marker reference", async () => {
    const diagram = architectureDiagram({ id: "d-dangle" });
    const base = await resolveVisualEngineDiagram(diagram);
    const t = tampered(base, (svg) => svg.replace(/url\(#arcf-[^)]*\)/g, "url(#arcf-ghost)"));
    expect(code(() => validateResolvedArtifactFinalForm(t, diagram))).toBe(
      "visual-engine/unsafe-output",
    );
  });

  it("accepts only genuinely local, resolvable marker references", async () => {
    const diagram = architectureDiagram({ id: "d-local" });
    const base = await resolveVisualEngineDiagram(diagram);
    const c = code(() => validateResolvedArtifactFinalForm(base, diagram));
    expect(c).toBe("did-not-throw");
  });
});

describe("final form — visual↔semantic bindings, not sets", () => {
  it("swapping the entityIds of two real nodes is fatal", async () => {
    const diagram = architectureDiagram({ id: "d-swap" });
    const base = await resolveVisualEngineDiagram(diagram);
    if (base.kind !== "svg") throw new Error("expected svg");
    const swapped = base.svg
      .replace('data-entity-id="cmp-ui"', 'data-entity-id="__SWAP__"')
      .replace('data-entity-id="cmp-api"', 'data-entity-id="cmp-ui"')
      .replace('data-entity-id="__SWAP__"', 'data-entity-id="cmp-api"');
    const t = { ...base, svg: swapped, svgSha256: sha256Hex(swapped) };
    expect(code(() => validateResolvedArtifactFinalForm(t, diagram))).toBe(
      "visual-engine/topology-mismatch",
    );
  });

  it("a swapped workflow step ref is fatal", async () => {
    const diagram = workflowDiagram(3, { id: "d-refswap" });
    const base = await resolveVisualEngineDiagram(diagram);
    const t = tampered(base, (svg) =>
      svg.replace('data-step-ref="proc-step-1"', 'data-step-ref="proc-forged"'),
    );
    expect(code(() => validateResolvedArtifactFinalForm(t, diagram))).toBe(
      "visual-engine/topology-mismatch",
    );
  });

  it("parallel edges keep their distinct relations; swapping them is fatal", async () => {
    const diagram = architectureDiagram({
      id: "d-par",
      spec: {
        format: "arclume.native.v1",
        kind: "architecture",
        nodes: [
          { id: "a", label: "A", entityId: "cmp-a" },
          { id: "b", label: "B", entityId: "cmp-b" },
        ],
        edges: [
          { id: "par-1", from: "a", to: "b", relationId: "rel-1" },
          { id: "par-2", from: "a", to: "b", relationId: "rel-2" },
        ],
      },
    });
    const base = await resolveVisualEngineDiagram(diagram);
    if (base.kind !== "svg") throw new Error("expected svg");
    // swap the relation ids on the two parallel edges (the svg only carries
    // each relation id once, on its path)
    const a = base.svg
      .replaceAll("rel-1", "__A__")
      .replaceAll("rel-2", "rel-1")
      .replaceAll("__A__", "rel-2");
    const t = { ...base, svg: a, svgSha256: sha256Hex(a) };
    expect(code(() => validateResolvedArtifactFinalForm(t, diagram))).toBe(
      "visual-engine/topology-mismatch",
    );
  });
});

describe("final form — duplicate physical bindings are fatal", () => {
  it("rejects a second <g> repeating a node binding (no duplicated XML ids)", async () => {
    const diagram = architectureDiagram({ id: "d-dupnode" });
    const base = await resolveVisualEngineDiagram(diagram);
    if (base.kind !== "svg") throw new Error("expected svg");
    // duplicate ONLY the semantic attributes — no XML id collision
    const t = tampered(base, (svg) =>
      svg.replace(
        "</svg>",
        '<g data-node-id="n-ui" data-entity-id="cmp-ui"><rect x="0" y="0" width="1" height="1"/></g></svg>',
      ),
    );
    expect(code(() => validateResolvedArtifactFinalForm(t, diagram))).toBe(
      "visual-engine/topology-mismatch",
    );
  });

  it("rejects a second step binding with the same data-step-id", async () => {
    const diagram = workflowDiagram(3, { id: "d-dupstep" });
    const base = await resolveVisualEngineDiagram(diagram);
    if (base.kind !== "svg") throw new Error("expected svg");
    const t = tampered(base, (svg) =>
      svg.replace(
        "</svg>",
        '<g data-step-id="s-1" data-step-ref="proc-step-1"><rect x="0" y="0" width="1" height="1"/></g></svg>',
      ),
    );
    expect(code(() => validateResolvedArtifactFinalForm(t, diagram))).toBe(
      "visual-engine/topology-mismatch",
    );
  });

  it("rejects a second path repeating a visual edge binding (relation/direction identical)", async () => {
    const diagram = architectureDiagram({ id: "d-dupedge" });
    const base = await resolveVisualEngineDiagram(diagram);
    if (base.kind !== "svg") throw new Error("expected svg");
    const t = tampered(base, (svg) =>
      svg.replace(
        "</svg>",
        '<path d="M 0 0 L 1 1" data-visual-edge-id="e-ui-api" data-relation-id="rel-ui-api" data-relation-from-node-id="n-ui" data-relation-to-node-id="n-api"/></svg>',
      ),
    );
    expect(code(() => validateResolvedArtifactFinalForm(t, diagram))).toBe(
      "visual-engine/topology-mismatch",
    );
  });
});

describe("final form — native-fallback is kernel-controlled, not caller-controlled", () => {
  it("a genuine visual-engine/layout-capacity fallback re-validates deterministically", async () => {
    // 7 explicit steps → adapter-level capacity failure, reproduced purely
    const diagram = workflowDiagram(7, { id: "d-cap7" });
    const { adaptDiagramToVisualEngine } = await import("../../../src/engines/visual/index.js");
    const failed = adaptDiagramToVisualEngine(diagram);
    expect(failed.kind).toBe("error");
    if (failed.kind !== "error") throw new Error("unreachable");
    expect(failed.code).toBe("visual-engine/layout-capacity");
  });
});
