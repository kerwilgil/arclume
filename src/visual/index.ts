/**
 * VisualDirector public surface (Phase 4).
 *
 * `buildVisualDeck` turns a validated `SlidePlan` (+ its `NarrativePlan` and
 * `ProjectKnowledge`) into an `ArclumeDeck`. No content is invented; the deck is
 * deterministic and validated against its inputs.
 */

export {
  buildVisualDeck,
  directVisuals,
  type BuildVisualDeckInput,
  type VisualDeckResult,
} from "./director.js";
export {
  DEFAULT_VISUAL_LIMITS,
  type LayoutKind,
  type SlideVisualPlan,
  type VisualDecision,
  type VisualKind,
  type VisualLimits,
  type VisualReasonCode,
  type VisualResolutionOutcome,
} from "./types.js";
export {
  THEME_IDS,
  executiveTheme,
  getTheme,
  minimalTheme,
  themeTokensRef,
  type ColorRoles,
  type Theme,
  type ThemeId,
  type ThemeTokens,
  type TypographyRoles,
} from "./theme.js";
export {
  resolveVisual,
  evidenceRefsOf,
  intentToKind,
  type ResolvedVisual,
} from "./intent.js";
export { selectDiagramKind, selectVisualIntent, type AutoVisual } from "./select.js";
export { deckLayoutFor, selectLayout } from "./layouts.js";
export { applyEmphasis } from "./emphasis.js";
export {
  NATIVE_SPEC_FORMAT,
  buildArchitectureModel,
  buildDataflowModel,
  buildFlowModel,
  buildLifecycleModel,
  buildTimelineModel,
  modelKnowledgeRefs,
  nativeDiagramAdapter,
  type ArchEdge,
  type ArchNode,
  type DataFlowFlow,
  type DataFlowNode,
  type DiagramAdapter,
  type DiagramModel,
  type FlowStep,
  type LifecycleState,
  type LifecycleTransition,
  type TimeItem,
} from "./models.js";
export { buildSlideBlocks, type BlockBuildInput, type BlockBuildResult } from "./blocks.js";
