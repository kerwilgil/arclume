/** Local DTOs for the Web UI — rendered views over the Core's ProjectKnowledge. */

export type Stage = "source" | "analysis" | "knowledge" | "build" | "export";

export type AudienceType =
  | "executive"
  | "technical"
  | "general"
  | "product"
  | "client"
  | "investor"
  | "internal-review";

export type DeckTypeType =
  | "project-overview"
  | "architecture-review"
  | "technical-deep-dive"
  | "executive-brief"
  | "proposal"
  | "status-report"
  | "migration-plan"
  | "product-overview"
  | "incident-postmortem";

export interface KnowledgeAudienceOption {
  id: AudienceType;
}

export interface KnowledgeDeckTypeOption {
  id: DeckTypeType;
}

export interface IssueDto {
  code: string;
  severity: string;
  message: string;
}

export interface PrepareResult {
  sourceDigest: string;
  documents: number;
  files: number;
  issues: IssueDto[];
  requestFileId: string;
}

export interface ExportRecordDto {
  format: "pdf" | "pptx";
  exportId: string;
  warnings: string[];
  artifactFileId: string;
  receiptFileId: string;
}

/** Extended build request: audience + deck-type, or a legacy preset id. */
export interface BuildRequestDto {
  /** Legacy preset (`executive`/`technical`/`general`). Overrides audience+deckType. */
  preset?: string;
  audience?: AudienceType;
  deckType?: DeckTypeType;
  formats: string[];
}

export interface BuildResult {
  slides: number;
  html?: { fileId: string };
  exports: ExportRecordDto[];
}

export interface ValidateResult {
  format: string;
  valid: boolean;
  issues: Array<{ code: string; message: string }>;
}

// Minimal structural views over ProjectKnowledge for the inspector.
export interface SourceRefDto {
  sourceId: string;
  locator?: unknown;
  quote?: string;
}

export interface KnowledgeEntity {
  id: string;
  name: string;
  kind?: string;
  description?: string;
  tags?: string[];
}

export interface KnowledgeClaim {
  id: string;
  statement: string;
  factType: "FACT" | "INFERENCE" | "UNKNOWN" | "RECOMMENDATION";
  confidence?: string;
  sourceRefs?: SourceRefDto[];
}

export interface KnowledgeRelation {
  id: string;
  from: string;
  to: string;
  type: string;
  label?: string;
  sourceRefs?: SourceRefDto[];
}

export interface KnowledgeGap {
  id: string;
  question: string;
  why?: string;
  severity?: "low" | "medium" | "high";
}

export interface KnowledgeSource {
  id: string;
  kind: string;
  title?: string;
  uri?: string;
  hash?: string;
}

export interface KnowledgeView {
  knowledgeVersion?: string;
  project?: { id: string; name?: string; summary?: string; status?: string };
  sources?: KnowledgeSource[];
  capabilities?: KnowledgeEntity[];
  components?: KnowledgeEntity[];
  actors?: KnowledgeEntity[];
  dependencies?: KnowledgeEntity[];
  processes?: KnowledgeEntity[];
  phases?: KnowledgeEntity[];
  milestones?: KnowledgeEntity[];
  metrics?: KnowledgeEntity[];
  risks?: KnowledgeEntity[];
  constraints?: KnowledgeEntity[];
  relations?: KnowledgeRelation[];
  claims?: KnowledgeClaim[];
  gaps?: KnowledgeGap[];
}

// --- Evidence Inspector DTO (served by GET /knowledge-evidence) -------------

export interface EvidenceProofDto {
  sourceId: string;
  path?: string;
  lineStart?: number;
  lineEnd?: number;
  commit?: string;
  quote?: string;
  locatorKind?: string;
  verification: "verified" | "unverified" | "unavailable";
  reasonCode?: string;
  detail?: string;
}

export interface ClaimEvidenceItemDto {
  id: string;
  statement: string;
  factType: "FACT" | "INFERENCE" | "UNKNOWN" | "RECOMMENDATION";
  verification: "verified" | "unverified" | "unavailable";
  proofs: EvidenceProofDto[];
}

export interface EvidenceSummaryDto {
  claims: ClaimEvidenceItemDto[];
  risks: ClaimEvidenceItemDto[];
  counts: {
    claims: number;
    risks: number;
    verifiedRefs: number;
    unverifiedRefs: number;
    unavailableRefs: number;
  };
}
