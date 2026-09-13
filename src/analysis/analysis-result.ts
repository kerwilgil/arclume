/**
 * `AnalysisResult` — the structured, evidence-first output of a Reasoner.
 *
 * It is a set of *candidates*, not a `ProjectKnowledge`. The KnowledgeBuilder
 * normalizes, deduplicates, resolves references, derives ids, downgrades
 * unsupported FACTs and validates. A Reasoner never produces `ProjectKnowledge`
 * directly.
 *
 * Hand-maintained mirror of `schemas/analysis-result.schema.json` (authoritative).
 */

import type { FactType, RelationType } from "../types/common.js";
import { ANALYSIS_VERSION } from "../version.js";

export { ANALYSIS_VERSION };

/** Points into an ingested `SourceDocument` by id, optionally to a line range. */
export interface EvidenceCandidate {
  documentId: string;
  lineStart?: number;
  lineEnd?: number;
  quote?: string;
}

export interface ProjectCandidate {
  name: string;
  summary?: string;
  purpose?: string;
  problem?: string;
  solution?: string;
  status?: string;
  nextSteps?: string[];
  evidence: EvidenceCandidate[];
}

export type CandidateEntityKind =
  | "capability"
  | "component"
  | "actor"
  | "dependency"
  | "process"
  | "phase"
  | "milestone"
  | "metric"
  | "risk"
  | "decision"
  | "requirement"
  | "technology"
  | "result"
  | "constraint";

/**
 * A candidate entity. `name` is the display name / statement. `key` is an
 * optional stable hint used for id derivation and cross-references; when absent
 * a key is synthesized from `kind` + `name`. `attrs` carries kind-specific
 * extras as strings (e.g. `version`, `scope`, `kind`, `unit`, `value`,
 * `likelihood`, `impact`, `mitigation`, `category`, `priority`, `status`,
 * `date`).
 */
export interface EntityCandidate {
  kind: CandidateEntityKind;
  name: string;
  key?: string;
  attrs?: Record<string, string>;
  /** Only meaningful for `kind: "risk"`. */
  factType?: FactType;
  evidence: EvidenceCandidate[];
}

export interface RelationCandidate {
  fromKey: string;
  toKey: string;
  type: RelationType;
  label?: string;
  evidence: EvidenceCandidate[];
}

export interface ClaimCandidate {
  statement: string;
  factType: FactType;
  confidence?: number;
  supportsKeys?: string[];
  evidence: EvidenceCandidate[];
}

export interface GapCandidate {
  question: string;
  why?: string;
  severity?: "low" | "medium" | "high";
  blocksKeys?: string[];
}

export interface AnalysisResult {
  analysisVersion: string;
  project: ProjectCandidate;
  entities: EntityCandidate[];
  relations: RelationCandidate[];
  claims: ClaimCandidate[];
  gaps: GapCandidate[];
}

export function emptyAnalysisResult(projectName: string): AnalysisResult {
  return {
    analysisVersion: ANALYSIS_VERSION,
    project: { name: projectName, evidence: [] },
    entities: [],
    relations: [],
    claims: [],
    gaps: [],
  };
}
