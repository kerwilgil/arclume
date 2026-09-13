/**
 * `ArclumeDeck` — the versioned Intermediate Representation for a presentation.
 *
 * Hand-maintained mirror of `schemas/arclume-deck.schema.json`
 * (the schema is authoritative for validation).
 */

import type { Block } from "./blocks.js";
import type {
  ContentHash,
  Evidence,
  Id,
  IsoDateTime,
  SemVer,
  Source,
  SourceRef,
} from "./common.js";

export type { Block } from "./blocks.js";

export interface DeckMeta {
  title: string;
  subtitle?: string;
  generator?: string;
  /** Present only when explicitly injected. */
  generatedAt?: IsoDateTime;
  /** Deterministic digest of provenance + source knowledge. */
  sourceDigest?: ContentHash;
  /** BCP-47 language tag. Default `es`. */
  locale?: string;
}

export interface DeckProject {
  name: string;
  oneLiner?: string;
  tagline?: string;
  domain?: string;
  sourceRefs?: SourceRef[];
}

export type AudiencePreset =
  | "executive"
  | "technical"
  | "commercial"
  | "project-status"
  | "product"
  | "client"
  | "investor"
  | "proposal"
  | "audit"
  | "internal-review"
  | "general";

export interface DeckAudience {
  preset: AudiencePreset;
  locale?: string;
  priorKnowledge?: "low" | "medium" | "high";
  formality?: "casual" | "neutral" | "formal";
  notes?: string;
}

export interface NarrativeSection {
  id: Id;
  title: string;
  purpose: string;
}

export interface DeckNarrative {
  /** Narrative preset name (the audience). Kept as a free string in Phase 1; tightened later. */
  preset: string;
  /** Optional deck-type arc id applied on top of the audience preset. */
  deckType?: string;
  arcTitle?: string;
  throughline: string;
  sections: NarrativeSection[];
}

export type ThemeName = "minimal" | "executive" | "corporate" | "technical" | "futuristic";

export interface DeckTheme {
  name: ThemeName;
  aspectRatio?: "16:9" | "16:10" | "4:3";
  mode?: "auto" | "light" | "dark";
  tokensRef?: string;
}

export interface DeckProvenance {
  sources: Source[];
  /** Hash of the `ProjectKnowledge` this deck was derived from. */
  knowledgeHash?: ContentHash;
  /** `narrativeContentHash` of the `NarrativePlan` this deck was derived from. */
  narrativeRef?: ContentHash;
  /** `slidePlanContentHash` of the `SlidePlan` this deck was derived from. */
  slidePlanRef?: ContentHash;
}

export type SlideKind =
  | "cover"
  | "section"
  | "content"
  | "diagram"
  | "metrics"
  | "comparison"
  | "timeline"
  | "roadmap"
  | "quote"
  | "closing";

export type NarrativePurpose =
  | "context"
  | "problem"
  | "solution"
  | "impact"
  | "capability"
  | "architecture"
  | "process"
  | "evidence"
  | "risk"
  | "roadmap"
  | "status"
  | "next-steps"
  | "summary"
  | "call-to-action";

export type SlideLayout =
  | "single"
  | "split-2"
  | "grid"
  | "full-bleed-visual"
  | "centered"
  | "quote";

export interface SlideVisual {
  chosenForm: string;
  rationale?: string;
  rejected?: string[];
}

export type VisualQaOutcome = "pass" | "warn" | "fail" | "skipped" | "pending";

export interface SlideChecks {
  visualQa?: VisualQaOutcome;
  unsourcedFacts?: number;
  densityWarnings?: number;
  notes?: string[];
}

export interface Slide {
  id: Id;
  /** 0-based; must equal the slide's position in `deck.slides` (semantic rule). */
  index: number;
  /** Must resolve to a `narrative.sections[].id` when present (semantic rule). */
  sectionId?: Id;
  kind: SlideKind;
  title: string;
  subtitle?: string;
  /** The single main idea of the slide. Required. */
  keyMessage: string;
  narrativePurpose: NarrativePurpose;
  layout: SlideLayout;
  blocks: Block[];
  visual?: SlideVisual;
  /** Must resolve to a `deck.diagrams[].id` when present (semantic rule). */
  diagramRef?: Id;
  evidence?: Evidence[];
  speakerNotes?: string;
  /** Structured check results. Required; may be empty / all-`pending`. */
  checks: SlideChecks;
}

export type DiagramEngine = "visual" | "native" | "unspecified";

export type DiagramType =
  | "architecture"
  | "workflow"
  | "sequence"
  | "dataflow"
  | "lifecycle"
  | "timeline"
  | "roadmap"
  | "matrix"
  | "hierarchy"
  | "before-after"
  | "comparison"
  | "unspecified";

/**
 * Forward-compatible diagram container. Phase 1 keeps `spec` opaque;
 * engine-specific validation arrives in the diagram-engines phase.
 */
export interface DiagramIR {
  id: Id;
  engine: DiagramEngine;
  diagramType: DiagramType;
  title?: string;
  spec?: unknown;
  sourceRefs?: SourceRef[];
}

export interface ArclumeDeck {
  irVersion: SemVer;
  meta: DeckMeta;
  project: DeckProject;
  audience: DeckAudience;
  narrative: DeckNarrative;
  theme: DeckTheme;
  provenance: DeckProvenance;
  slides: Slide[];
  diagrams: DiagramIR[];
}
