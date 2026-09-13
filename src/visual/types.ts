/**
 * VisualDirector contracts (Phase 4).
 *
 * The VisualDirector turns a validated `SlidePlan` (plus its `NarrativePlan`
 * and `ProjectKnowledge`) into an `ArclumeDeck`: it decides *how* to show each
 * slide — visual kind, layout, blocks, emphasis, theme tokens — without ever
 * altering the truth of the `SlidePlan`. No content is invented; every metric,
 * node, edge and timeline item traces back to a real knowledge id.
 *
 * Deterministic: no LLM, no clock, no RNG, no network, no filesystem, no
 * browser. Same knowledge + narrative + slide plan + theme ⇒ byte-identical
 * `ArclumeDeck`.
 */

import type { PlanningNote, VisualIntent } from "../planning/types.js";
import type { Block } from "../types/blocks.js";

/**
 * The visual form the director resolved for a slide. Renderer-independent.
 *
 * `process` is ARCLUME's internal name for a **workflow** (the deck block type
 * and `DiagramType` are both literally `"workflow"`); `dataflow` and
 * `lifecycle` are the Slice 2B structural diagrams derived from
 * PRODUCES/CONSUMES and from phase/PRECEDES state structure respectively.
 */
export type VisualKind =
  | "none"
  | "text"
  | "summary"
  | "metrics"
  | "comparison"
  | "timeline"
  | "roadmap"
  | "risk"
  | "status"
  | "hierarchy"
  | "relationship"
  | "architecture"
  | "process"
  | "sequence"
  | "dataflow"
  | "lifecycle"
  | "quote";

/**
 * Closed, auditable set of reasons a visual-direction decision was reached.
 * Stable slugs — safe to switch on, log and assert in tests. `reason` on a
 * `VisualDecision` stays the free-form human sentence; `reasonCode` is the
 * contract. No chain-of-thought is ever stored.
 */
export type VisualReasonCode =
  // no structural visual for this slide
  | "cover-or-closing"
  | "intent-none"
  // a SlidePlan `visualIntent` reconciled against the real knowledge
  | "intent-accepted"
  | "intent-refined"
  | "intent-downgraded"
  // automatic selection from structural knowledge signals
  | "auto-architecture"
  | "auto-workflow"
  | "auto-sequence"
  | "auto-dataflow"
  | "auto-lifecycle"
  | "auto-timeline"
  | "auto-roadmap"
  | "auto-summary"
  // deterministic ambiguity tie-breaks (the structural signal that won)
  | "ambiguity-dataflow-vs-workflow"
  | "ambiguity-workflow-vs-dataflow"
  | "ambiguity-workflow-vs-lifecycle"
  | "ambiguity-architecture-vs-dataflow"
  | "ambiguity-sequence-vs-workflow"
  | "ambiguity-timeline-vs-roadmap"
  | "ambiguity-roadmap-vs-timeline"
  // lifecycle admission policy: ProjectKnowledge has no strong state/transition
  // primitive, so lifecycle needs phases-with-status + PRECEDES among them
  | "lifecycle-insufficient-structure"
  | "lifecycle-structure-sufficient"
  // safe, explicit fallbacks (never silent)
  | "fallback-summary-no-evidence"
  | "fallback-relationship-no-edge"
  | "fallback-workflow-from-lifecycle"
  | "diagram-condensed-to-limits"
  | "diagram-model-unbuildable"
  // non-diagram visuals carried over from Phase 4
  | "metrics-backed"
  | "comparison-baseline"
  | "risk-tracked"
  | "status-derived"
  | "quote-verbatim"
  // bookkeeping log entries (layout-selected, blocks-selected, density-adjusted …)
  | "recorded";

/** A small, renderer-independent layout taxonomy. No pixels, no CSS. */
export type LayoutKind =
  | "hero"
  | "single-focus"
  | "stack"
  | "split"
  | "grid"
  | "metric-grid"
  | "timeline"
  | "roadmap"
  | "diagram-focus"
  | "comparison"
  | "quote-focus";

/** Outcome of resolving `SlidePlan.visualIntent` against the real knowledge. */
export type VisualResolutionOutcome = "accepted" | "refined" | "downgraded";

/** One explainable visual-direction decision — feeds a future `arclume explain`. */
export interface VisualDecision {
  slideId: string;
  /** Decision slug: `visual-accepted` | `visual-refined` | `visual-downgraded`
   * | `layout-selected` | `blocks-selected` | `density-adjusted`
   * | `diagram-built` | `content-condensed` | `content-deferred`. */
  code: string;
  requestedIntent: VisualIntent;
  resolvedVisual: VisualKind;
  /** Final visual/diagram kind for the slide. Mirror of `resolvedVisual`,
   * named per the Slice 2B decision contract (`kind`). */
  kind: VisualKind;
  outcome: VisualResolutionOutcome;
  /** Auditable, closed-set reason. `reason` is the human sentence for the same fact. */
  reasonCode: VisualReasonCode;
  layout: LayoutKind;
  reason: string;
  knowledgeRefs: string[];
  /** Knowledge ids weighed when choosing: `knowledgeRefs ∪ visualCandidates`. */
  consideredRefs: string[];
  /** Subset of `consideredRefs` whose entities carry ≥1 `SourceRef` backing the visual. */
  evidenceRefs: string[];
  /** When `kind` is a fallback, the richer kind that the evidence did not support. */
  fallbackKind?: VisualKind;
}

/**
 * Semantic limits that keep a slide from becoming a wall of text or an
 * unreadable diagram. Configurable via `buildVisualDeck({ limits })`.
 */
export interface VisualLimits {
  maxBlocksPerSlide: number;
  maxItemsPerBlock: number;
  maxTextBlockChars: number;
  maxTableColumns: number;
  maxTableRows: number;
  /** Hard schema cap is 8; keep at or below. */
  maxMetricsPerGrid: number;
  maxDiagramNodes: number;
  maxDiagramSteps: number;
  maxTimelineItems: number;
}

export const DEFAULT_VISUAL_LIMITS: VisualLimits = {
  maxBlocksPerSlide: 6,
  maxItemsPerBlock: 8,
  maxTextBlockChars: 600,
  maxTableColumns: 6,
  maxTableRows: 12,
  maxMetricsPerGrid: 8,
  maxDiagramNodes: 12,
  maxDiagramSteps: 12,
  maxTimelineItems: 12,
};

/** What one slide's visual direction produced, before it is placed in the deck. */
export interface SlideVisualPlan {
  blocks: Block[];
  layout: LayoutKind;
  /** Deck `SlideLayout` enum value the layout maps to. */
  deckLayout: "single" | "split-2" | "grid" | "full-bleed-visual" | "centered" | "quote";
  visualKind: VisualKind;
  /** id of a `deck.diagrams[]` entry this slide owns, if any. */
  diagramRef?: string;
  chosenForm: string;
  rationale: string;
  rejected: string[];
}

export interface VisualDeckOutput {
  decisions: VisualDecision[];
  notes: PlanningNote[];
}
