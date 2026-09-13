/**
 * `ProjectKnowledge` — presentation-independent structured model of a project.
 *
 * Hand-maintained mirror of `schemas/project-knowledge.schema.json`
 * (the schema is authoritative for validation).
 *
 * All entity collections are required and may be empty, so consumers never
 * need to null-check a collection. Every entity carries `sourceRefs`.
 */

import type {
  Claim,
  DateHint,
  FactType,
  Id,
  Relation,
  SemVer,
  Source,
  SourceRef,
} from "./common.js";

export type { Claim, Relation, Source } from "./common.js";

export interface KnowledgeMeta {
  /** Present only when explicitly injected. */
  generatedAt?: string;
  generator?: string;
  /** Deterministic hash of the payload; injected, never auto-computed on read. */
  contentHash?: string;
}

export interface ProjectEntity {
  id: Id;
  name: string;
  summary?: string;
  purpose?: string;
  problem?: string;
  solution?: string;
  status?: string;
  nextSteps?: string[];
  tags?: string[];
  sourceRefs: SourceRef[];
}

export interface Capability {
  id: Id;
  name: string;
  description?: string;
  tags?: string[];
  sourceRefs: SourceRef[];
}

export type ComponentKind =
  | "service"
  | "ui"
  | "store"
  | "job"
  | "library"
  | "gateway"
  | "external"
  | "other";

export interface Component {
  id: Id;
  name: string;
  kind?: ComponentKind;
  responsibilities?: string[];
  /** Ids of `Technology` entities. */
  technologies?: Id[];
  tags?: string[];
  sourceRefs: SourceRef[];
}

export type ActorType = "human" | "system" | "organization" | "other";

export interface Actor {
  id: Id;
  name: string;
  type?: ActorType;
  description?: string;
  sourceRefs: SourceRef[];
}

export type DependencyScope = "runtime" | "dev" | "peer" | "optional" | "service" | "other";

export interface Dependency {
  id: Id;
  name: string;
  version?: string;
  scope?: DependencyScope;
  ecosystem?: string;
  sourceRefs: SourceRef[];
}

export interface ProcessStep {
  label: string;
  detail?: string;
}

export interface Process {
  id: Id;
  name: string;
  trigger?: string;
  steps?: ProcessStep[];
  outcome?: string;
  sourceRefs: SourceRef[];
}

export type PhaseStatus = "planned" | "active" | "done" | "blocked" | "cancelled";

export interface Phase {
  id: Id;
  name: string;
  status?: PhaseStatus;
  start?: DateHint;
  end?: DateHint;
  summary?: string;
  sourceRefs: SourceRef[];
}

export interface Milestone {
  id: Id;
  name: string;
  date?: DateHint;
  achieved?: boolean;
  phaseId?: Id;
  sourceRefs: SourceRef[];
}

export type MetricDirection = "up-good" | "down-good" | "neutral";

export interface Metric {
  id: Id;
  name: string;
  value?: string;
  unit?: string;
  baseline?: string;
  target?: string;
  asOf?: DateHint;
  direction?: MetricDirection;
  sourceRefs: SourceRef[];
}

export type RiskLevel = "low" | "medium" | "high" | "unknown";

export interface Risk {
  id: Id;
  statement: string;
  likelihood?: RiskLevel;
  impact?: RiskLevel;
  mitigation?: string;
  /** A `FACT` risk must carry resolvable evidence (semantic rule). */
  factType: FactType;
  sourceRefs: SourceRef[];
}

export type DecisionStatus = "proposed" | "accepted" | "superseded" | "rejected";

export interface Decision {
  id: Id;
  statement: string;
  rationale?: string;
  date?: DateHint;
  status?: DecisionStatus;
  sourceRefs: SourceRef[];
}

export type RequirementKind = "functional" | "non-functional" | "constraint" | "assumption";

export type RequirementPriority = "must" | "should" | "could" | "wont";

export interface Requirement {
  id: Id;
  statement: string;
  kind?: RequirementKind;
  priority?: RequirementPriority;
  sourceRefs: SourceRef[];
}

export type TechnologyCategory =
  | "language"
  | "framework"
  | "runtime"
  | "database"
  | "infra"
  | "saas"
  | "library"
  | "tool"
  | "protocol"
  | "other";

export interface Technology {
  id: Id;
  name: string;
  category?: TechnologyCategory;
  sourceRefs: SourceRef[];
}

export interface Result {
  id: Id;
  statement: string;
  metricId?: Id;
  sourceRefs: SourceRef[];
}

export type ConstraintKind = "technical" | "business" | "legal" | "time" | "budget" | "other";

export interface Constraint {
  id: Id;
  statement: string;
  kind?: ConstraintKind;
  sourceRefs: SourceRef[];
}

export interface Gap {
  id: Id;
  question: string;
  why?: string;
  /** Ids of entities whose confidence is limited by this gap. */
  blocks?: Id[];
  severity?: "low" | "medium" | "high";
}

export interface ProjectKnowledge {
  knowledgeVersion: SemVer;
  meta?: KnowledgeMeta;
  project: ProjectEntity;
  sources: Source[];
  capabilities: Capability[];
  components: Component[];
  actors: Actor[];
  dependencies: Dependency[];
  processes: Process[];
  phases: Phase[];
  milestones: Milestone[];
  metrics: Metric[];
  risks: Risk[];
  decisions: Decision[];
  requirements: Requirement[];
  technologies: Technology[];
  results: Result[];
  constraints: Constraint[];
  relations: Relation[];
  claims: Claim[];
  gaps: Gap[];
}

/** Names of the array-valued entity collections in `ProjectKnowledge`. */
export const KNOWLEDGE_COLLECTIONS = [
  "capabilities",
  "components",
  "actors",
  "dependencies",
  "processes",
  "phases",
  "milestones",
  "metrics",
  "risks",
  "decisions",
  "requirements",
  "technologies",
  "results",
  "constraints",
  "relations",
  "claims",
  "gaps",
] as const;

export type KnowledgeCollectionName = (typeof KNOWLEDGE_COLLECTIONS)[number];
