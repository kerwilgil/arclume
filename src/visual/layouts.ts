/**
 * Layout selection (Phase 4).
 *
 * A small, renderer-independent layout taxonomy. Selection is a pure function of
 * the slide kind, the resolved visual kind, and the block shape — never the
 * theme (themes must not change layout) and never pixels.
 */

import type { PlannedSlide } from "../planning/types.js";
import type { Block } from "../types/blocks.js";
import type { LayoutKind, SlideVisualPlan, VisualKind } from "./types.js";

type DeckLayout = SlideVisualPlan["deckLayout"];

const LAYOUT_TO_DECK: Record<LayoutKind, DeckLayout> = {
  hero: "centered",
  "single-focus": "single",
  stack: "single",
  split: "split-2",
  grid: "grid",
  "metric-grid": "grid",
  timeline: "single",
  roadmap: "single",
  "diagram-focus": "full-bleed-visual",
  comparison: "split-2",
  "quote-focus": "quote",
};

export function deckLayoutFor(layout: LayoutKind): DeckLayout {
  return LAYOUT_TO_DECK[layout];
}

export function selectLayout(
  slide: PlannedSlide,
  visualKind: VisualKind,
  blocks: readonly Block[],
): LayoutKind {
  if (slide.kind === "cover") return "hero";
  if (slide.kind === "closing") return "single-focus";

  switch (visualKind) {
    case "architecture":
    case "process":
    case "sequence":
    case "dataflow":
    case "lifecycle":
      return "diagram-focus";
    case "metrics":
      return blocks.some((b) => b.type === "metric-grid") ? "metric-grid" : "single-focus";
    case "comparison":
      return blocks.some((b) => b.type === "comparison") ? "comparison" : "single-focus";
    case "timeline":
      return blocks.some((b) => b.type === "timeline") ? "timeline" : "single-focus";
    case "roadmap":
      return blocks.some((b) => b.type === "roadmap") ? "roadmap" : "single-focus";
    case "quote":
      return blocks.some((b) => b.type === "quote") ? "quote-focus" : "single-focus";
    case "risk":
      return blocks.length > 1 ? "stack" : "single-focus";
    case "relationship":
    case "hierarchy":
      return blocks.some((b) => b.type === "table") ? "stack" : "single-focus";
    default:
      return blocks.length > 1 ? "stack" : "single-focus";
  }
}
