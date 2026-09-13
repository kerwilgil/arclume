/**
 * `NarrativePlan` — audience-shaped narrative derived from a `ProjectKnowledge`.
 *
 * Hand-maintained mirror of `schemas/narrative-plan.schema.json` (authoritative
 * for validation). Render-, theme- and UI-independent. Deterministic: the same
 * knowledge + audience + options always produce a byte-identical plan.
 *
 * A `NarrativePlan` decides *what to tell, in what order, and what to leave out*.
 * It never invents knowledge — every `knowledgeRefs` entry is an id that exists
 * in the source `ProjectKnowledge`.
 */

import type { ContentHash, Id, SemVer } from "../types/common.js";
import type { NarrativePurpose } from "../types/deck.js";

export type { NarrativePurpose } from "../types/deck.js";

/**
 * Supported audience presets.
 *
 * `general` is the backward-compatible default; `product`, `client`, `investor`
 * and `internal-review` round out the six product-intelligence presets
 * (executive, technical, product, client, investor, internal-review).
 */
export type AudienceName =
  | "executive"
  | "technical"
  | "general"
  | "product"
  | "client"
  | "investor"
  | "internal-review";

/** All implemented audience presets (including the legacy `general` default). */
export const AUDIENCE_NAME_VALUES: readonly AudienceName[] = [
  "executive",
  "technical",
  "general",
  "product",
  "client",
  "investor",
  "internal-review",
] as const;

export function isAudienceName(value: string): value is AudienceName {
  return (AUDIENCE_NAME_VALUES as readonly string[]).includes(value);
}

/** Why a piece of knowledge did not make it into the narrative. */
export type OmissionReason =
  | "irrelevant-to-audience"
  | "redundant"
  | "insufficient-evidence"
  | "low-priority"
  | "slide-budget"
  | "superseded";

export interface PlanMeta {
  generator?: string;
  /** `contentHash` of the plan payload without `meta`. Injected, never re-derived on read. */
  contentHash?: ContentHash;
}

export interface NarrativePlanSection {
  id: Id;
  title: string;
  /** One sentence: what this section must accomplish for the audience. */
  purpose: string;
  narrativePurpose: NarrativePurpose;
  /** 1 = most important. Sections are ordered by `(priority, id)`. */
  priority: number;
  /** Ids of `ProjectKnowledge` entities/claims/gaps this section draws on. */
  knowledgeRefs: Id[];
  /** Optional hint about how this section connects to the next one. */
  transitionIntent?: string;
}

export interface OmittedKnowledge {
  id: Id;
  reason: OmissionReason;
  note?: string;
}

export interface KnowledgeSelection {
  /** Ids that made it into at least one section. */
  selected: Id[];
  /** Ids kept in reserve — relevant but not surfaced at this budget. */
  deprioritized: Id[];
  /** Ids deliberately dropped, each with a reason. */
  omitted: OmittedKnowledge[];
}

/** An explainable planning decision — the trace behind a future `arclume explain`. */
export interface PlanningDecision {
  /** Kebab-case slug, e.g. `section-omitted`, `visual-intent-selected`. */
  code: string;
  sectionId?: Id;
  slideId?: Id;
  /** What was decided, in a few words. */
  decision: string;
  /** Why. */
  reason: string;
  knowledgeRefs?: Id[];
}

/** A lint-style flag raised while planning (budget, quality nudges). */
export interface PlanningNote {
  /** `planning/…`, `narrative/…` or `plan/…`. */
  code: string;
  message: string;
  severity: "info" | "warning";
}

export interface NarrativePlan {
  narrativeVersion: SemVer;
  meta?: PlanMeta;
  audience: AudienceName;
  /** The deck-type arc applied (when one was used); independent of the audience. */
  deckType?: string;
  /** `ProjectKnowledge.meta.contentHash`, copied through for provenance. */
  knowledgeHash?: ContentHash;
  /** What the presentation must achieve for this audience. */
  objective: string;
  /** The single central idea, derived only from the knowledge. */
  throughline: string;
  sections: NarrativePlanSection[];
  selection: KnowledgeSelection;
  decisions: PlanningDecision[];
  notes: PlanningNote[];
}
