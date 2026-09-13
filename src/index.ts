/**
 * Arclume Core — public API surface.
 *
 * Phase 1 scope: the Intermediate Representation types, the JSON Schemas,
 * deterministic hashing / id helpers, versioning, a migration skeleton, and
 * schema + semantic validation. Nothing else (no ingestion, no reasoning,
 * no rendering).
 */

// ---- Types: shared
export type {
  Claim,
  CommitSha,
  Confidence,
  ContentHash,
  DateHint,
  Evidence,
  FactType,
  FileLocator,
  FragmentLocator,
  Id,
  IsoDateTime,
  Locator,
  PageLocator,
  Relation,
  RelationType,
  SemVer,
  Source,
  SourceKind,
  SourceRef,
  TextRangeLocator,
  UrlLocator,
} from "./types/common.js";

// ---- Types: ProjectKnowledge
export type {
  Actor,
  ActorType,
  Capability,
  Component,
  ComponentKind,
  Constraint,
  ConstraintKind,
  Decision,
  DecisionStatus,
  Dependency,
  DependencyScope,
  Gap,
  KnowledgeCollectionName,
  KnowledgeMeta,
  Metric,
  MetricDirection,
  Milestone,
  Phase,
  PhaseStatus,
  Process,
  ProcessStep,
  ProjectEntity,
  ProjectKnowledge,
  Requirement,
  RequirementKind,
  RequirementPriority,
  Result,
  Risk,
  RiskLevel,
  Technology,
  TechnologyCategory,
} from "./types/knowledge.js";
export { KNOWLEDGE_COLLECTIONS } from "./types/knowledge.js";

// ---- Types: ArclumeDeck IR
export type {
  ArclumeDeck,
  AudiencePreset,
  DeckAudience,
  DeckMeta,
  DeckNarrative,
  DeckProject,
  DeckProvenance,
  DeckTheme,
  DiagramEngine,
  DiagramIR,
  DiagramType,
  NarrativePurpose,
  NarrativeSection,
  Slide,
  SlideChecks,
  SlideKind,
  SlideLayout,
  SlideVisual,
  ThemeName,
  VisualQaOutcome,
} from "./types/deck.js";

// ---- Types: Blocks
export type {
  ArchitectureBlock,
  Block,
  BlockBase,
  BlockType,
  CalloutBlock,
  CodeBlock,
  ComparisonBlock,
  ComparisonColumn,
  ComparisonRow,
  DiagramBlock,
  DiagramBlockType,
  ImageBlock,
  MetricBlock,
  MetricGridBlock,
  MetricGridItem,
  QuoteBlock,
  RiskBlock,
  RoadmapBlock,
  RoadmapPhase,
  StatusBlock,
  TableBlock,
  TextBlock,
  TimelineBlock,
  TimelineItem,
  WorkflowBlock,
} from "./types/blocks.js";
export { DIAGRAM_BLOCK_TYPES, isDiagramBlock } from "./types/blocks.js";

// ---- Versioning
export {
  IR_VERSION,
  KNOWLEDGE_VERSION,
  SCHEMA_IDS,
  checkCompatibility,
  parseSemVer,
  type CompatibilityLevel,
  type CompatibilityResult,
  type ParsedSemVer,
} from "./version.js";

// ---- Migrations (skeleton)
export {
  MIGRATION_STEPS,
  migrate,
  type ArtifactKind,
  type MigrationContext,
  type MigrationResult,
  type MigrationStep,
} from "./migrations/index.js";

// ---- Determinism helpers
export {
  contentHash,
  sha256Hex,
  sha256Prefixed,
  stableStringify,
  type JsonValue,
} from "./determinism/hash.js";

// ---- Id helpers
export {
  deriveId,
  deriveReadableId,
  isValidId,
  shortHash,
  slugify,
} from "./knowledge/ids.js";

// ---- Schema access
export {
  createCompiledSchemas,
  getCompiledSchemas,
  resetCompiledSchemasCache,
  type CompiledSchemas,
  type SchemaName,
} from "./schema/loader.js";
export { schemasDir, findPackageRoot } from "./schema/paths.js";

// ---- Validation
export {
  formatValidationReport,
  validateAnalysisResult,
  validateArclumeDeck,
  validateProjectKnowledge,
} from "./validation/validator.js";
export { isSafeRelativeLocatorPath } from "./validation/cross-ref.js";

// ---- Source Evidence (Slice 2B): hermetic Git reference verification
export {
  verifyGitEvidence,
  verifySourceRefEvidence,
  attachEvidence,
  isSafeRevision,
  countBlobLines,
  type SourceRefEvidenceOptions,
  type EvidenceVerdict,
  type EvidenceReasonCode,
  type GitEvidenceQuery,
  type EvidenceChecked,
  type EvidenceVerification,
  type EvidenceRef,
} from "./evidence/index.js";
export {
  inspectProjectKnowledge,
  type ClaimEvidenceItem,
  type EvidenceInspectorOptions,
  type EvidenceProof,
  type EvidenceSummary,
  type EvidenceVerificationStatus,
} from "./evidence/index.js";
export {
  addIssues,
  emptyResult,
  sortIssues,
  type IssueSeverity,
  type ValidationIssue,
  type ValidationResult,
} from "./validation/result.js";

// ---- Errors (pipeline)
export {
  ArclumeError,
  DiscoveryError,
  IngestionError,
  KnowledgeBuildError,
  ParserError,
  PlanningError,
  ReasonerError,
  SafetyError,
  ValidationFailedError,
  note,
  type ArclumeErrorFields,
  type ArclumeErrorJSON,
  type ErrorSeverity,
  type PipelineNote,
  type PipelineStage,
} from "./errors.js";

// ---- Ingestion (Phase 2)
export { discover, walkRoot } from "./ingestion/discover.js";
export { ingest } from "./ingestion/ingest.js";
export {
  analysisDigest,
  canonicalAnalysisConfig,
  sourceDigest,
  type AnalysisDigestInput,
} from "./ingestion/digest.js";
export { isProbablyBinary, normalizeText, countLines } from "./ingestion/binary.js";
export {
  isSensitiveFileName,
  isDenylistedDir,
  supportedKindForExtension,
  DENYLIST_DIRS,
} from "./ingestion/ignore-rules.js";
export { extractMarkdownOutline } from "./ingestion/markdown-outline.js";
export { parseDocument } from "./ingestion/parsers.js";
export {
  DEFAULT_SAFETY_LIMITS,
  type DiscoveredFile,
  type DiscoveryResult,
  type DocumentOutline,
  type IngestionOptions,
  type IngestionResult,
  type MarkdownOutline,
  type SafetyLimits,
  type SkipReason,
  type SkippedInput,
  type SourceDocument,
  type SourceDocumentKind,
  type SourceDocumentMetadata,
  type SourceDocumentProvenance,
  type StructuredOutline,
} from "./ingestion/types.js";

// ---- Analysis / Reasoner (Phase 2)
export {
  ANALYSIS_VERSION,
  emptyAnalysisResult,
  type AnalysisResult,
  type CandidateEntityKind,
  type ClaimCandidate,
  type EntityCandidate,
  type EvidenceCandidate,
  type GapCandidate,
  type ProjectCandidate,
  type RelationCandidate,
} from "./analysis/analysis-result.js";
export type {
  Reasoner,
  ReasonerCapabilities,
  ReasonerDocument,
  ReasonerFile,
  ReasonerRequest,
  ReasonerResult,
} from "./analysis/reasoner.js";
export { StubReasoner } from "./analysis/reasoners/stub.js";
export { AgentReasoner, type AgentReasonerSource } from "./analysis/reasoners/agent.js";

// ---- Knowledge builder (Phase 2)
export {
  buildProjectKnowledge,
  type KnowledgeBuilderInput,
  type KnowledgeBuilderOutput,
  type KnowledgeBuilderReport,
} from "./knowledge/builder.js";
export {
  dedupeEntities,
  firstToken,
  normalizeName,
  type DedupeResult,
  type EntityGroup,
  type NearDuplicate,
} from "./knowledge/dedupe.js";

// ---- Pipeline (Phase 2)
export {
  analyzePrepared,
  buildKnowledge,
  prepareAnalysis,
  rebuildFromKnowledge,
  runAnalyze,
  runPipeline,
  type AnalyzeOutput,
  type BuildKnowledgeInput,
  type BuildOutput,
  type PipelineOptions,
  type PipelineOutput,
  type PreparedAnalysis,
} from "./pipeline/run.js";
export {
  readAnalysisArtifact,
  readDeckArtifact,
  readKnowledgeArtifact,
  readNarrativeArtifact,
  readSlidePlanArtifact,
  stableJson,
  writeArtifacts,
  type ArtifactBundle,
} from "./pipeline/artifacts.js";

// ---- Narrative & Slide planning (Phase 3)
export { NARRATIVE_VERSION, SLIDE_PLAN_VERSION } from "./version.js";
export type {
  AudienceName,
  KnowledgeSelection,
  NarrativePlan,
  NarrativePlanSection,
  OmissionReason,
  OmittedKnowledge,
  PlanMeta,
  PlanningDecision,
  PlanningNote,
} from "./narrative/types.js";
export { AUDIENCE_NAME_VALUES } from "./narrative/types.js";
export type { DeckTypeName } from "./narrative/deck-types.js";
export { DECK_TYPE_NAMES } from "./narrative/deck-types.js";
export { getDeckTypeProfile, type DeckTypeProfile } from "./narrative/deck-types.js";
export type {
  PlannedSlide,
  SlideBudget,
  SlideDensity,
  SlidePlan,
  VisualIntent,
} from "./planning/types.js";
export {
  buildNarrativePlan,
  narrativeContentHash,
  type PlanNarrativeOptions,
} from "./narrative/planner.js";
export { selectKnowledge, type SelectorResult } from "./narrative/selector.js";
export {
  buildKnowledgeView,
  firstSentence,
  phraseList,
  type KnowledgeItem,
  type KnowledgeView,
} from "./narrative/knowledge-view.js";
export {
  AUDIENCE_NAMES,
  getAudienceProfile,
  executivePreset,
  technicalPreset,
  generalPreset,
  type AudienceProfile,
  type SectionTemplate,
  type SectionSourceSpec,
} from "./narrative/presets/index.js";
export {
  buildSlidePlan,
  createSemanticMerge,
  slidePlanContentHash,
  type PlanSlidesOptions,
} from "./planning/slide-planner.js";
export {
  normalizeBudget,
  applyBudget,
  unionSourceRefs,
  stripSplitMarker,
  type BudgetOptions,
  type SemanticMerge,
  type MergeRecompute,
} from "./planning/budget.js";
export { densityFor } from "./planning/density.js";
export {
  keyMessageFor,
  coverKeyMessage,
  closingKeyMessage,
  normalizeMessage,
} from "./planning/messaging.js";
export {
  validateNarrativePlan,
  validateSlidePlan,
} from "./validation/validator.js";
export {
  crossRefNarrativePlan,
  crossRefSlidePlan,
  type SlidePlanContext,
} from "./validation/plan-cross-ref.js";
export {
  planNarrative,
  planSlides,
  runPlanning,
  buildDeck,
  runDeck,
  type NarrativeOutput,
  type SlidePlanOutput,
  type PlanningOptions,
  type PlanningOutput,
  type DeckBuildOptions,
  type DeckOutput,
  type DeckPipelineOutput,
} from "./pipeline/run.js";

// ---- Visual direction (Phase 4)
export { IR_VERSION as DECK_IR_VERSION } from "./version.js";
export {
  buildVisualDeck,
  directVisuals,
  DEFAULT_VISUAL_LIMITS,
  THEME_IDS,
  getTheme,
  minimalTheme,
  executiveTheme,
  themeTokensRef,
  resolveVisual,
  selectDiagramKind,
  selectVisualIntent,
  type AutoVisual,
  selectLayout,
  deckLayoutFor,
  applyEmphasis,
  buildSlideBlocks,
  NATIVE_SPEC_FORMAT,
  buildArchitectureModel,
  buildDataflowModel,
  buildFlowModel,
  buildLifecycleModel,
  buildTimelineModel,
  modelKnowledgeRefs,
  nativeDiagramAdapter,
  type BuildVisualDeckInput,
  type VisualDeckResult,
  type VisualDecision,
  type VisualKind,
  type VisualReasonCode,
  type VisualLimits,
  type VisualResolutionOutcome,
  type LayoutKind,
  type Theme,
  type ThemeId,
  type ThemeTokens,
  type ColorRoles,
  type TypographyRoles,
  type ResolvedVisual,
  type DiagramAdapter,
  type DiagramModel,
  type BlockBuildInput,
  type BlockBuildResult,
} from "./visual/index.js";
export {
  crossRefArclumeDeckContext,
  type DeckContext,
} from "./validation/deck-cross-ref.js";

// ---- HTML renderer + viewer (Phase 5)
export {
  renderDeckHtml,
  DECK_CSP,
  VIEWER_RUNTIME,
  HTML_RENDERER_VERSION,
  RENDERABLE_THEME_NAMES,
  isRenderableTheme,
  keyMessageClass,
  assertRenderOutput,
  extractInlineScript,
  extractInlineStyle,
  ACTIVE_MARKUP_PATTERNS,
  SCRIPT_NETWORK_PATTERNS,
  STYLE_REMOTE_PATTERNS,
  type HtmlRenderContext,
  type HtmlRenderOptions,
  type HtmlRenderReport,
  type HtmlRenderResult,
  type HtmlRenderWarning,
} from "./renderers/html/index.js";
export {
  renderHtml,
  runHtml,
  type RenderHtmlContext,
  type HtmlOutput,
  type HtmlPipelineOutput,
} from "./pipeline/run.js";
export { writeHtmlArtifact, readHtmlArtifact } from "./pipeline/artifacts.js";
export { RenderError } from "./errors.js";

// ---- Chromium Visual QA (Phase 6)
export {
  runVisualQa,
  validateRenderedDeck,
  compareScreenshots,
  buildVisualQaReceipt,
  visualQaJson,
  visualQaConfigHash,
  checkPhase6Schema,
  resetPhase6SchemaCache,
  contrastRatio,
  geometryFindings,
  CANONICAL_VIEWPORT,
  DEFAULT_VIEWPORTS,
  VISUAL_QA_VERSION,
  VISUAL_FINDING_CODES,
  type BrowserIdentity,
  type DiffOptions,
  type DiffResult,
  type GeometryPolicy,
  type Phase6SchemaName,
  type ScreenshotDescriptor,
  type SlideMeasurement,
  type VisualFinding,
  type VisualFindingCode,
  type VisualQaOptions,
  type VisualQaReceipt,
  type VisualQaResult,
  type VisualQaRun,
  type VisualSeverity,
  type Viewport,
  type ViewportResult,
} from "./validation/visual-qa/index.js";
export { VisualQaError } from "./errors.js";

// ---- Atomic delivery (Phase 6)
export {
  deliverAtomic,
  validateDeliveryBindings,
  validateBundleRelativePath,
  resolveConfined,
  buildManifest,
  deriveDeliveryId,
  verifyManifest,
  hashFile,
  type PathCheck,
  MANIFEST_VERSION,
  MANIFEST_FILENAME,
  type DeliveryArtifactInput,
  type DeliveryHooks,
  type DeliveryManifest,
  type DeliveryOptions,
  type DeliveryResult,
  type ManifestEntry,
  type ManifestIssue,
  type ManifestVerification,
} from "./delivery/index.js";
export { DeliveryError } from "./errors.js";
export {
  runDeckVisualQa,
  runValidatedDelivery,
  type ValidatedDeliveryOptions,
  type ValidatedDeliveryOutput,
} from "./pipeline/run.js";
export { DELIVERY_MANIFEST_VERSION } from "./version.js";

// ---- Advanced ingestion (Phase 8)
export { ingestInputs, parseBinaryDocument } from "./ingestion/ingest.js";
export { MEDIA_TYPES } from "./ingestion/ingest.js";
export { parsePdf, PDF_PARSER_VERSION } from "./ingestion/pdf.js";
export { parseDocx, DOCX_PARSER_VERSION } from "./ingestion/docx.js";
export { openDocxPackage } from "./ingestion/docx-zip.js";
export {
  URL_INGESTION_VERSION,
  DEFAULT_URL_LIMITS,
  ingestUrl,
  readBoundedBody,
  type UrlTransport,
  type UrlLimits,
  type UrlIngestOutcome,
} from "./ingestion/url.js";
export {
  normalizeRequestedUrl,
  isBlockedIp,
  assertAllAddressesAllowed,
  URL_NORMALIZER_VERSION,
} from "./ingestion/url-security.js";
export type {
  IngestionInput,
  IngestionIssue,
  IngestionIssueSeverity,
  UrlIngestionOptions,
  UrlSnapshot,
} from "./ingestion/types.js";

// ---- Diagram engines
export type {
  DiagramEngineReport,
  DiagramEngineReportEntry,
  DiagramEngineWarning,
  ResolvedDiagramArtifact,
  ResolvedDiagramProvenance,
} from "./engines/types.js";
export {
  VISUAL_ENGINE_COMMIT,
  VISUAL_ENGINE_FILE_COUNT,
  VISUAL_ENGINE_SUBTREE_SHA256,
  VISUAL_ENGINE_VENDORED,
  VISUAL_ENGINE_COMPONENT_TYPE_SENTINEL,
  VISUAL_ENGINE_WORKFLOW_CAPACITY,
  VISUAL_ENGINE_ERROR_CODES,
  VisualEngineError,
  adaptDiagramToVisualEngine,
  buildDiagramEngineReport,
  isFallbackableVisualEngineCode,
  resolveVisualEngineDiagram,
  runVisualEngine,
  sanitizeVisualEngineSvgRegion,
  validateSanitizedDiagram,
  type VisualEngineAdaptation,
  type VisualEngineAdaptationFailure,
  type VisualEngineAdaptationResult,
  type VisualEngineErrorCode,
  type VisualEngineRequest,
  type VisualEngineRunOptions,
  type SanitizeExpectation,
  type SanitizedSvg,
} from "./engines/visual/index.js";
export {
  applyDiagramEnginePreference,
  type DiagramEnginePreference,
} from "./pipeline/diagram-engine-preference.js";
export {
  resolveDiagramEngines,
  type ResolveDiagramEnginesOptions,
  type ResolveDiagramEnginesResult,
} from "./pipeline/resolve-diagrams.js";
export {
  renderCanonicalDeckHtml,
  validateDiagramArtifactBindings,
  diagramSpecHash,
  visualEngineIdentity,
  type CanonicalDeckRenderInput,
  type CanonicalDeckRenderOutput,
} from "./pipeline/canonical-render.js";
export {
  diagramRenderInputHash,
  validateResolvedArtifactFinalForm,
} from "./engines/visual/index.js";

// ---- CLI (Phase 9) — headless surface; the binary lives in dist/cli/index.js
export {
  runCli,
  packageVersion,
  type CliDeps,
} from "./cli/main.js";
export {
  ARCLUME_PRESETS,
  CLI_PRESET_VERSION,
  PRESET_IDS,
  getPreset,
  type ArclumePreset,
} from "./cli/presets.js";
export {
  EXIT_OK,
  EXIT_USAGE,
  EXIT_BUILD,
  EXIT_SECURITY,
  type CliIo,
} from "./cli/output.js";

// ---- Optional local Web UI (Phase 10) — loopback-only, session-token gated
export {
  startArclumeWeb,
  type WebServerHandle,
  type WebServerOptions,
} from "./web/server.js";
