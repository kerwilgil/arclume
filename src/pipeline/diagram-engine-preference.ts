/**
 * Diagram engine preference — a pure `ArclumeDeck → ArclumeDeck` transform.
 *
 * It changes exactly one field: `diagrams[].engine`. Nothing else — no
 * semantic edits, no block changes, no re-planning. The input deck is never
 * mutated; the result is a new deck object (identity-checked by tests).
 *
 * Supported matrix (no aesthetic AI decision):
 *  - `native`  → every diagram requests the native engine;
 *  - `visual`  → `architecture` / `workflow` / `dataflow` / `lifecycle`, plus a
 *                `sequence` whose spec is participant-aware, request the visual engine;
 *                everything else stays native;
 *  - `auto`    → same supported matrix as `visual`.
 */

import type { ArclumeDeck, DiagramIR } from "../types/deck.js";

export type DiagramEnginePreference = "native" | "visual" | "auto";

/** Diagram kinds the visual engine renders first-class from any valid spec. */
const VISUAL_ENGINE_FIRST_CLASS: ReadonlySet<string> = new Set([
  "architecture",
  "workflow",
  "dataflow",
  "lifecycle",
]);

/**
 * A `sequence` diagram is visual-engine-eligible only when its spec carries the
 * participant-aware projection (built by `deriveSequenceParticipants` when the
 * flow's steps map to ≥2 distinct actor/component entities). A step-list
 * sequence has no participant structure and stays native.
 */
function sequenceIsParticipantAware(diagram: DiagramIR): boolean {
  const spec = diagram.spec as { kind?: unknown; participants?: unknown } | undefined;
  return (
    spec?.kind === "sequence" &&
    Array.isArray(spec.participants) &&
    (spec.participants as unknown[]).length >= 2
  );
}

function engineFor(diagram: DiagramIR, preference: DiagramEnginePreference): "native" | "visual" {
  if (preference === "native") return "native";
  if (VISUAL_ENGINE_FIRST_CLASS.has(diagram.diagramType)) return "visual";
  if (diagram.diagramType === "sequence" && sequenceIsParticipantAware(diagram)) return "visual";
  return "native";
}

export function applyDiagramEnginePreference(
  deck: ArclumeDeck,
  options: { preference: DiagramEnginePreference },
): ArclumeDeck {
  const diagrams = (deck.diagrams ?? []).map((d) => {
    const next = engineFor(d, options.preference);
    return next === d.engine ? d : { ...d, engine: next };
  });
  return { ...deck, diagrams };
}
