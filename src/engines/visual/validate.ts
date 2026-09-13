/**
 * Visual Engine post-sanitize validation.
 *
 * The sanitizer proves structural safety; this module proves semantic
 * fidelity: identity sets round-trip exactly, direction is preserved, workflow
 * order is unchanged, and the rebuilt SVG carries no active markup. Every
 * check is fatal (`VisualEngineError`); nothing is a silent loss.
 */

import type { ResolvedDiagramProvenance } from "../types.js";
import { VisualEngineError } from "./errors.js";
import type { SanitizedSvg } from "./sanitize.js";
import type { VisualEngineAdaptation } from "./types.js";

/**
 * Leftovers that must never appear in a trusted, rebuilt SVG.
 *
 * Element-level sweep only: rebuilt text is escaped (`<` / `>` never survive
 * inside text), so a `<script`-shaped match in the string can only be real
 * markup. Attribute-level invariants (no `class=`, no `style=`, no `on*=` in
 * attributes, no remote `href=`, no sentinel classes) are enforced
 * structurally by the sanitizer at rebuild time — re-scanning them on the raw
 * string would false-positive on legitimately escaped label text (the XSS
 * corpus includes `onclick=` and `javascript:` as *labels*).
 */
const FORBIDDEN_MARKUP: ReadonlyArray<{ re: RegExp; what: string }> = [
  { re: /<script/i, what: "script element" },
  { re: /<style/i, what: "style element" },
  { re: /<\s*foreignObject/i, what: "foreignObject element" },
  { re: /<\s*iframe/i, what: "iframe element" },
  { re: /<\?xml/i, what: "XML declaration" },
];

function sameSet(a: readonly string[], b: readonly string[]): string | undefined {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size !== a.length || setB.size !== b.length || setA.size !== setB.size) {
    return "size/dup";
  }
  for (const x of setA) if (!setB.has(x)) return "missing";
  return undefined;
}

export function validateSanitizedDiagram(
  sanitized: SanitizedSvg,
  adaptation: Extract<VisualEngineAdaptation, { kind: "ok" }>,
): void {
  const { diagramId, provenance, visualKind } = adaptation;
  const { svg, summary } = sanitized;

  for (const { re, what } of FORBIDDEN_MARKUP) {
    if (re.test(svg)) {
      throw new VisualEngineError(
        "visual-engine/unsafe-output",
        `diagram "${diagramId}": sanitized SVG still contains ${what}`,
        diagramId,
      );
    }
  }

  if (
    svg.length === 0 ||
    !svg.startsWith("<svg") ||
    (!svg.endsWith("</svg>") && !svg.endsWith("/>"))
  ) {
    throw new VisualEngineError(
      "visual-engine/output-invalid",
      `diagram "${diagramId}": sanitized SVG is not a complete <svg> document`,
      diagramId,
    );
  }

  const expectedNodes =
    visualKind === "architecture" ? provenance.entityIds : adaptation.ordering.stepOrder;
  const nodesMismatch = sameSet(summary.nodes, expectedNodes);
  if (nodesMismatch !== undefined) {
    const extra = summary.nodes.filter((n) => !expectedNodes.includes(n));
    throw new VisualEngineError(
      extra.length > 0 ? "visual-engine/topology-mismatch" : "visual-engine/provenance-loss",
      `diagram "${diagramId}": node identity set changed across the engine (expected [${expectedNodes.join(", ")}], got [${summary.nodes.join(", ")}])`,
      diagramId,
    );
  }

  const gotRelations = summary.relations.map((r) => r.relationId);
  const relationsMismatch = sameSet(gotRelations, provenance.relationIds);
  if (relationsMismatch !== undefined) {
    const extra = gotRelations.filter((r) => !provenance.relationIds.includes(r));
    throw new VisualEngineError(
      extra.length > 0 ? "visual-engine/topology-mismatch" : "visual-engine/provenance-loss",
      `diagram "${diagramId}": relation identity set changed across the engine (expected [${provenance.relationIds.join(", ")}], got [${gotRelations.join(", ")}])`,
      diagramId,
    );
  }

  // Direction: every relation's visual endpoints must match the authored spec.
  for (const [visualId, dir] of adaptation.maps.edgeDirection) {
    const relationId = adaptation.maps.edgeToRelation.get(visualId);
    if (relationId === undefined) continue;
    const observed = summary.relations.find((r) => r.relationId === relationId);
    if (observed === undefined) continue; // reported by the set check above
    if (observed.from !== dir.from || observed.to !== dir.to) {
      throw new VisualEngineError(
        "visual-engine/topology-mismatch",
        `diagram "${diagramId}": relation "${relationId}" direction changed across the engine (${dir.from}→${dir.to} became ${observed.from}→${observed.to})`,
        diagramId,
      );
    }
  }

  if (visualKind === "workflow") {
    const got = summary.nodes;
    const want = adaptation.ordering.stepOrder;
    if (got.length !== want.length || want.some((id, i) => got[i] !== id)) {
      throw new VisualEngineError(
        "visual-engine/order-mismatch",
        `diagram "${diagramId}": workflow step order changed across the engine`,
        diagramId,
      );
    }
  }

  // Every provenance identity is physically present as an attribute.
  for (const id of expectedNodes) {
    const attr = visualKind === "architecture" ? "data-entity-id" : "data-step-id";
    if (!svg.includes(`${attr}="${id}"`)) {
      throw new VisualEngineError(
        "visual-engine/provenance-loss",
        `diagram "${diagramId}": ${attr}="${id}" is missing from the final SVG`,
        diagramId,
      );
    }
  }
  for (const id of provenance.relationIds) {
    if (!svg.includes(`data-relation-id="${id}"`)) {
      throw new VisualEngineError(
        "visual-engine/provenance-loss",
        `diagram "${diagramId}": data-relation-id="${id}" is missing from the final SVG`,
        diagramId,
      );
    }
  }
  if (!svg.includes(`data-diagram-id="${diagramId}"`)) {
    throw new VisualEngineError(
      "visual-engine/provenance-loss",
      `diagram "${diagramId}": data-diagram-id is missing from the final SVG`,
      diagramId,
    );
  }
}
