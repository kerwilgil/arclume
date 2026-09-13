/**
 * `SlidePlan` — semantic slide plan derived from a `NarrativePlan`.
 *
 * Hand-maintained mirror of `schemas/slide-plan.schema.json` (authoritative).
 *
 * One slide carries exactly one `keyMessage`. Every slide is traceable:
 * `knowledgeRefs` / `claimRefs` point at real `ProjectKnowledge` ids and
 * `sourceRefs` are resolved from those entities. There is **no** visual form
 * here — no layout, theme, colour, font, block or diagram. `visualIntent` is a
 * semantic *suggestion* the VisualDirector (Phase 4) may accept or reject.
 */

import type {
  AudienceName,
  NarrativePurpose,
  PlanMeta,
  PlanningDecision,
  PlanningNote,
} from "../narrative/types.js";
import type { Id, SemVer, SourceRef } from "../types/common.js";
import type { SlideKind } from "../types/deck.js";

export type { SlideKind } from "../types/deck.js";
export type {
  AudienceName,
  NarrativePurpose,
  PlanMeta,
  PlanningDecision,
  PlanningNote,
} from "../narrative/types.js";

/** Semantic hint about the nature of a slide's content. Not a render order. */
export type VisualIntent =
  | "none"
  | "summary"
  | "metrics"
  | "relationship"
  | "architecture"
  | "process"
  | "sequence"
  | "timeline"
  | "roadmap"
  | "comparison"
  | "hierarchy"
  | "risk"
  | "status"
  | "quote";

/** Estimated semantic density — from counting knowledge, not pixels. */
export type SlideDensity = "low" | "medium" | "high";

export interface SlideBudget {
  minSlides: number;
  targetSlides: number;
  maxSlides: number;
}

export interface PlannedSlide {
  id: Id;
  /** 0-based, contiguous across the deck. */
  index: number;
  sectionId: Id;
  kind: SlideKind;
  title: string;
  /** The single idea this slide makes. Specific, backed, and different from `title`. */
  keyMessage: string;
  narrativePurpose: NarrativePurpose;
  /** Ids of `ProjectKnowledge` entities/gaps this slide is built from. */
  knowledgeRefs: Id[];
  /** Ids of `ProjectKnowledge` claims supporting the `keyMessage`. */
  claimRefs: Id[];
  /** `SourceRef`s resolved from the referenced knowledge (deduped, capped). */
  sourceRefs: SourceRef[];
  /** Short description of what content the slide should hold. */
  contentIntent: string;
  visualIntent: VisualIntent;
  /** Ids the VisualDirector might visualize (components, relations, …). */
  visualCandidates?: Id[];
  density: SlideDensity;
  /** Inherited from the section; 1 = most important. */
  priority: number;
}

export interface SlidePlan {
  planVersion: SemVer;
  meta?: PlanMeta;
  audience: AudienceName;
  /** Deck-type arc carried through from the narrative (when one was applied). */
  deckType?: string;
  /** `contentHash` of the `NarrativePlan` this plan was derived from. */
  narrativeRef: string;
  /** `ProjectKnowledge.meta.contentHash`, copied through for provenance. */
  knowledgeHash?: string;
  budget: SlideBudget;
  /** The budget target that was aimed for (`budget.targetSlides`). */
  targetSlideCount: number;
  slides: PlannedSlide[];
  decisions: PlanningDecision[];
  notes: PlanningNote[];
}
