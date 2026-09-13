/**
 * Declarative audience presets.
 *
 * A preset is data, not a pile of conditionals: relevance weights per knowledge
 * collection, an ordered list of section templates, and a closing emphasis. The
 * planner interprets these; adding an audience is adding a data file.
 */

import type { FactType } from "../../types/common.js";
import type { KnowledgeCollectionName } from "../../types/knowledge.js";
import type { AudienceName, NarrativePurpose } from "../types.js";

/** Project-entity text fields a section can be justified by. */
export type ProjectField = "purpose" | "problem" | "solution" | "status" | "summary" | "nextSteps";

/** Which knowledge a section template draws candidate references from. */
export interface SectionSourceSpec {
  /** Entity collections the section pulls ids from. */
  collections?: KnowledgeCollectionName[];
  /** Project-entity fields whose presence justifies the section. */
  projectFields?: ProjectField[];
  /** When set, only `claims` with one of these `factType`s count. */
  claimFactTypes?: FactType[];
  /**
   * When set, only items whose primary text (name / statement / question)
   * matches this case-insensitive pattern count. Used e.g. for "security".
   */
  keyword?: string;
  /** Minimum resolved refs to keep the section. Default 1. Ignored when `required`. */
  minRefs?: number;
}

export interface SectionTemplate {
  /** Stable id base; the final section id is `sec-<id>`. */
  id: string;
  title: string;
  /** One sentence describing what the section must do; `{project}` is substituted. */
  purpose: string;
  narrativePurpose: NarrativePurpose;
  sources: SectionSourceSpec;
  /** Kept even with zero resolved refs (only cover / closing use this). */
  required?: boolean;
  transitionIntent?: string;
}

export type CollectionWeightKey = KnowledgeCollectionName | "project";

export interface AudienceProfile {
  name: AudienceName;
  /** `{project}` is substituted with the project name to form `NarrativePlan.objective`. */
  objectiveTemplate: string;
  detailTolerance: "low" | "medium" | "high";
  narrativeDensity: "lean" | "balanced" | "dense";
  /**
   * How much of the underlying evidence is surfaced in the deck. Changes how
   * the deck *presents* evidence — never the evidence itself (which lives in
   * ProjectKnowledge and is immutable). `low` (executive/client) shows a
   * summary; `high` (technical/internal-review) surfaces the maximum.
   */
  evidenceVisibility: "low" | "medium" | "high";
  /**
   * Relevance weight per collection (and `project`). Missing key ⇒ weight 1.
   * Weight 0 ⇒ irrelevant to this audience (always omitted).
   */
  weights: Partial<Record<CollectionWeightKey, number>>;
  /** Ordered section templates. The planner prepends a cover and appends a closing. */
  sections: SectionTemplate[];
  /** Closing-slide emphasis, first satisfiable wins. */
  closingEmphasis: Array<"next-steps" | "roadmap" | "recommendations" | "open-decisions" | "gaps">;
}
