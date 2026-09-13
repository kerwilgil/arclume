/**
 * Pipeline orchestration.
 *
 * The internal API keeps `analyze` and `build` separate (per the Phase 9 CLI
 * design): `runAnalyze` produces inspectable intermediate artifacts; `buildKnowledge`
 * turns an analysis into validated `ProjectKnowledge`. `runPipeline` chains them.
 *
 * No network, no clock, no execution here. The only component that may reason is
 * the injected `Reasoner`; its output is always schema-validated before use.
 */

import type { AnalysisResult } from "../analysis/analysis-result.js";
import type {
  Reasoner,
  ReasonerDocument,
  ReasonerFile,
  ReasonerRequest,
} from "../analysis/reasoner.js";
import {
  type DeliveryManifest,
  type DeliveryOptions,
  type DeliveryResult,
  deliverAtomic,
} from "../delivery/index.js";
import { contentHash } from "../determinism/hash.js";
import type { ResolvedDiagramArtifact } from "../engines/types.js";
import { ArclumeError, IngestionError, PlanningError, ReasonerError } from "../errors.js";
import { analysisDigest, canonicalAnalysisConfig, sourceDigest } from "../ingestion/digest.js";
import { ingestInputs } from "../ingestion/ingest.js";
import type { IngestionInput, IngestionOptions, IngestionResult } from "../ingestion/types.js";
import { type KnowledgeBuilderReport, buildProjectKnowledge } from "../knowledge/builder.js";
import { type PlanNarrativeOptions, buildNarrativePlan } from "../narrative/planner.js";
import type { AudienceName, NarrativePlan, PlanningNote } from "../narrative/types.js";
import { type PlanSlidesOptions, buildSlidePlan } from "../planning/slide-planner.js";
import type { SlidePlan } from "../planning/types.js";
import { renderDeckHtml } from "../renderers/html/index.js";
import type { HtmlRenderReport } from "../renderers/html/index.js";
import type { ArclumeDeck } from "../types/deck.js";
import type { ProjectKnowledge } from "../types/knowledge.js";
import type { ValidationResult } from "../validation/result.js";
import {
  formatValidationReport,
  validateAnalysisResult,
  validateNarrativePlan,
  validateSlidePlan,
} from "../validation/validator.js";
import {
  type ValidateRenderedDeckOptions,
  buildVisualQaReceipt,
  validateRenderedDeck,
  visualQaConfigHash,
} from "../validation/visual-qa/index.js";
import {
  DEFAULT_VIEWPORTS,
  type VisualQaOptions,
  type VisualQaReceipt,
  type VisualQaRun,
} from "../validation/visual-qa/types.js";
import { buildVisualDeck } from "../visual/director.js";
import type { ThemeId } from "../visual/theme.js";
import type { VisualDecision, VisualLimits } from "../visual/types.js";
import { visualEngineIdentity } from "./canonical-render.js";

export interface PipelineOptions {
  ingestion?: IngestionOptions;
  hints?: ReasonerRequest["hints"];
}

/** Phase 8 input: path strings or explicit {kind:"url"} values. */
export type PipelineInputs = IngestionInput | readonly IngestionInput[];

export interface AnalyzeOutput {
  sourceDigest: string;
  analysisDigest: string;
  ingestion: IngestionResult;
  request: ReasonerRequest;
  analysis: AnalysisResult;
  reasoner: { id: string; version: string };
}

export interface BuildOutput {
  knowledge: ProjectKnowledge;
  report: KnowledgeBuilderReport;
  validation: ValidationResult;
}

export type PipelineOutput = AnalyzeOutput & BuildOutput;

function buildRequest(
  ingestion: IngestionResult,
  digest: string,
  hints: ReasonerRequest["hints"] | undefined,
): ReasonerRequest {
  const documents: ReasonerDocument[] = ingestion.documents.map((d) => ({
    id: d.id,
    sourceId: d.sourceId,
    path: d.path,
    kind: d.kind,
    content: d.content,
    outline: d.outline,
  }));

  // Key files by (sourceId, path), never by path alone: two inputs can each
  // carry a `README.md` and both must survive into the request.
  const filesByIdentity = new Map<string, ReasonerFile>();
  for (const disc of ingestion.discovery) {
    const sourceId = disc.source.id;
    for (const f of disc.files) {
      const key = `${sourceId} ${f.path}`;
      if (!filesByIdentity.has(key)) {
        filesByIdentity.set(key, {
          sourceId,
          path: f.path,
          kind: f.kind,
          included: f.included,
          byteLength: f.byteLength,
        });
      }
    }
  }
  // URL inputs have no filesystem discovery: each snapshot contributes one
  // synthetic file identity ("snapshot"), so the Reasoner can see it and the
  // digest covers it.
  for (const snap of ingestion.urlSnapshots) {
    const key = `${snap.sourceId} snapshot`;
    if (!filesByIdentity.has(key)) {
      filesByIdentity.set(key, {
        sourceId: snap.sourceId,
        path: "snapshot",
        kind: snap.mediaType === "text/html" ? "url" : snap.mediaType,
        included: true,
        byteLength: snap.bodyBytes,
      });
    }
  }

  const files = [...filesByIdentity.values()].sort((a, b) =>
    a.sourceId !== b.sourceId
      ? a.sourceId < b.sourceId
        ? -1
        : 1
      : a.path < b.path
        ? -1
        : a.path > b.path
          ? 1
          : 0,
  );

  const request: ReasonerRequest = { sourceDigest: digest, documents, files };
  if (hints !== undefined) request.hints = hints;
  return request;
}

/** The deterministic identity handed to any Reasoner (Phase 9 public seam). */
export interface PreparedAnalysis {
  sourceDigest: string;
  ingestion: IngestionResult;
  request: ReasonerRequest;
}

/**
 * DISCOVER + INGEST + PREPARE. Everything an external Reasoner needs, computed
 * deterministically and identically for every consumer: Phase 8 ingestion,
 * SourceDigest V2, the document/file inventory and URL snapshot identity.
 * `runAnalyze` consumes this same preparation — there is no duplicated logic.
 */
export async function prepareAnalysis(
  inputs: PipelineInputs,
  options: PipelineOptions = {},
): Promise<PreparedAnalysis> {
  // Phase 8: URL inputs make ingestion asynchronous.
  const ingestion = await ingestInputs(inputs, options.ingestion ?? {});
  const request = buildRequest(ingestion, "", options.hints);
  // V2 digest covers the exact Reasoner-visible identity: documents (content +
  // outline) PLUS the deterministic file inventory, including URL snapshots.
  const digest = sourceDigest(ingestion.documents, request.files);

  // A run where every binary/format input failed must not proceed to an empty
  // Reasoner invocation.
  if (ingestion.documents.length === 0 && ingestion.issues.some((i) => i.severity === "fatal")) {
    throw new IngestionError("no usable inputs: all fatal ingestion failures", {
      code: "ingestion/no-usable-inputs",
      severity: "fatal",
    });
  }
  request.sourceDigest = digest;
  return { sourceDigest: digest, ingestion, request };
}

/** DISCOVER + INGEST + ANALYZE. Validates the Reasoner output; never trusts it blindly. */
export async function runAnalyze(
  inputs: PipelineInputs,
  reasoner: Reasoner,
  options: PipelineOptions = {},
): Promise<AnalyzeOutput> {
  return analyzePrepared(await prepareAnalysis(inputs, options), reasoner, options);
}

/**
 * Run a Reasoner against an ALREADY prepared analysis context. Used by the
 * Phase 9 two-pass CLI (prepare → external agent → consume) so the exact same
 * ingestion/digest/request is bound to the result. Never trusts the output.
 */
export async function analyzePrepared(
  prepared: PreparedAnalysis,
  reasoner: Reasoner,
  options: PipelineOptions = {},
): Promise<AnalyzeOutput> {
  const { sourceDigest: digest, ingestion, request } = prepared;

  let analysis: AnalysisResult;
  let reasonerMeta: { id: string; version: string };
  try {
    const result = await reasoner.analyze(request);
    analysis = result.analysis;
    reasonerMeta = result.reasoner;
  } catch (cause) {
    if (cause instanceof ArclumeError) throw cause;
    throw new ReasonerError("the reasoner failed to produce an analysis", {
      code: "reasoner/analyze-failed",
      severity: "fatal",
      cause,
    });
  }

  // The result must own up to the same identity the reasoner advertises;
  // provenance and the analysis cache key both depend on it.
  if (
    reasonerMeta?.id !== reasoner.capabilities.id ||
    reasonerMeta?.version !== reasoner.capabilities.version
  ) {
    throw new ReasonerError(
      "the reasoner result identity does not match its declared capabilities",
      {
        code: "reasoner/identity-mismatch",
        severity: "fatal",
        hint: `declared ${reasoner.capabilities.id}@${reasoner.capabilities.version}; result reported ${String(
          reasonerMeta?.id,
        )}@${String(reasonerMeta?.version)}`,
      },
    );
  }

  const shape = validateAnalysisResult(analysis);
  if (!shape.valid) {
    throw new ReasonerError("the reasoner returned an AnalysisResult that is not schema-valid", {
      code: "reasoner/malformed-output",
      severity: "fatal",
      hint: formatValidationReport(shape).split("\n").slice(0, 8).join("\n"),
    });
  }

  return {
    sourceDigest: digest,
    analysisDigest: analysisDigest({
      sourceDigest: digest,
      reasoner: { id: reasoner.capabilities.id, version: reasoner.capabilities.version },
      config: canonicalAnalysisConfig(options.hints ?? {}),
    }),
    ingestion,
    request,
    analysis,
    reasoner: reasonerMeta,
  };
}

export interface BuildKnowledgeInput {
  analysis: AnalysisResult;
  ingestion: Pick<IngestionResult, "sources" | "documents">;
  sourceDigest: string;
}

/** BUILD KNOWLEDGE + VALIDATE. Throws `KnowledgeBuildError` if the result is invalid. */
export function buildKnowledge(input: BuildKnowledgeInput | AnalyzeOutput): BuildOutput {
  const analysis = input.analysis;
  const ingestion = input.ingestion;
  const digest = input.sourceDigest;

  // The builder runs `validateProjectKnowledge` itself (throwing on any error)
  // and hands the real result back — this is the *actual* validation of the
  // knowledge that was built, never a fabricated clean result.
  const { knowledge, report, validation } = buildProjectKnowledge({
    analysis,
    sources: ingestion.sources,
    documents: ingestion.documents,
    sourceDigest: digest,
  });

  return { knowledge, report, validation };
}

/** DISCOVER -> INGEST -> ANALYZE -> BUILD KNOWLEDGE -> VALIDATE. */
export async function runPipeline(
  inputs: PipelineInputs,
  reasoner: Reasoner,
  options: PipelineOptions = {},
): Promise<PipelineOutput> {
  const analyzed = await runAnalyze(inputs, reasoner, options);
  const built = buildKnowledge(analyzed);
  return { ...analyzed, ...built };
}

/* ------------------------------------------------------------------ */
/* Phase 3 — planning stages (independently inspectable)               */
/* ------------------------------------------------------------------ */

export interface NarrativeOutput {
  narrative: NarrativePlan;
  /** The real validation result for `narrative` (`valid` is always true here). */
  validation: ValidationResult;
}

export interface SlidePlanOutput {
  slidePlan: SlidePlan;
  /** The real validation result for `slidePlan`. */
  validation: ValidationResult;
}

export interface PlanningOptions extends PlanNarrativeOptions, PlanSlidesOptions {}

export type PlanningOutput = {
  narrative: NarrativePlan;
  slidePlan: SlidePlan;
  narrativeValidation: ValidationResult;
  slideValidation: ValidationResult;
};

/** BUILD KNOWLEDGE -> PLAN NARRATIVE + VALIDATE. Throws `PlanningError` if invalid. */
export function planNarrative(
  knowledge: ProjectKnowledge,
  options: PlanNarrativeOptions = {},
): NarrativeOutput {
  const narrative = buildNarrativePlan(knowledge, options);
  const validation = validateNarrativePlan(narrative, knowledge);
  if (!validation.valid) {
    throw new PlanningError("the built NarrativePlan failed validation", {
      code: "planning/invalid-narrative",
      severity: "fatal",
      hint: firstLines(formatValidationReport(validation), 12),
    });
  }
  return { narrative, validation };
}

/** PLAN NARRATIVE -> PLAN SLIDES + VALIDATE. Throws `PlanningError` if invalid. */
export function planSlides(
  knowledge: ProjectKnowledge,
  narrative: NarrativePlan,
  options: PlanSlidesOptions = {},
): SlidePlanOutput {
  const slidePlan = buildSlidePlan(knowledge, narrative, options);
  const validation = validateSlidePlan(slidePlan, { narrative, knowledge });
  if (!validation.valid) {
    throw new PlanningError("the built SlidePlan failed validation", {
      code: "planning/invalid-slide-plan",
      severity: "fatal",
      hint: firstLines(formatValidationReport(validation), 12),
    });
  }
  return { slidePlan, validation };
}

/** BUILD KNOWLEDGE -> PLAN NARRATIVE -> PLAN SLIDES. Stages stay separable. */
export function runPlanning(
  knowledge: ProjectKnowledge,
  options: PlanningOptions = {},
): PlanningOutput {
  const { narrative, validation: narrativeValidation } = planNarrative(knowledge, options);
  const { slidePlan, validation: slideValidation } = planSlides(knowledge, narrative, options);
  return { narrative, slidePlan, narrativeValidation, slideValidation };
}

/* ------------------------------------------------------------------ */
/* Phase 4 — visual direction                                          */
/* ------------------------------------------------------------------ */

export interface DeckBuildOptions {
  theme?: ThemeId;
  limits?: Partial<VisualLimits>;
}

export interface DeckOutput {
  deck: ArclumeDeck;
  decisions: VisualDecision[];
  notes: PlanningNote[];
  /** The real validation result for `deck` (`valid` is always true here). */
  validation: ValidationResult;
}

/** PLAN SLIDES -> VISUAL DIRECTOR -> ArclumeDeck + VALIDATE. Throws `PlanningError` if invalid. */
export function buildDeck(
  knowledge: ProjectKnowledge,
  narrative: NarrativePlan,
  slidePlan: SlidePlan,
  options: DeckBuildOptions = {},
): DeckOutput {
  const { deck, decisions, notes, validation } = buildVisualDeck({
    knowledge,
    narrative,
    slidePlan,
    ...(options.theme !== undefined ? { theme: options.theme } : {}),
    ...(options.limits !== undefined ? { limits: options.limits } : {}),
  });
  if (!validation.valid) {
    throw new PlanningError("the built ArclumeDeck failed validation", {
      code: "visual/invalid-deck",
      severity: "fatal",
      hint: firstLines(formatValidationReport(validation), 16),
    });
  }
  return { deck, decisions, notes, validation };
}

export interface DeckPipelineOutput extends PlanningOutput {
  deck: ArclumeDeck;
  decisions: VisualDecision[];
  deckNotes: PlanningNote[];
  deckValidation: ValidationResult;
}

/** BUILD KNOWLEDGE -> NARRATIVE -> SLIDES -> DECK. Every stage stays inspectable. */
export function runDeck(
  knowledge: ProjectKnowledge,
  options: PlanningOptions & DeckBuildOptions = {},
): DeckPipelineOutput {
  const planning = runPlanning(knowledge, options);
  const { deck, decisions, notes, validation } = buildDeck(
    knowledge,
    planning.narrative,
    planning.slidePlan,
    options,
  );
  return { ...planning, deck, decisions, deckNotes: notes, deckValidation: validation };
}

/* ------------------------------------------------------------------ */
/* Rebuild from ProjectKnowledge                                      */
/* ------------------------------------------------------------------ */

/**
 * Rebuild the deck WITHOUT any Reasoner call.
 *
 * A caller-supplied knowledge (already validated) produces a fresh deck via
 * the deterministic planning/visual stages only. Nothing in this path consults
 * a Reasoner, a provider, a network, or any external system: the deck is a
 * pure function of (knowledge, audience, deckType, theme).
 *
 * Signature: (ProjectKnowledge, PlanningOptions & DeckBuildOptions) →
 * DeckPipelineOutput. That is the rebuild contract.
 */
export function rebuildFromKnowledge(
  knowledge: ProjectKnowledge,
  options: PlanningOptions & DeckBuildOptions = {},
): DeckPipelineOutput {
  return runDeck(knowledge, options);
}

export interface RenderHtmlContext {
  knowledge?: ProjectKnowledge;
  narrative?: NarrativePlan;
  slidePlan?: SlidePlan;
}

export interface HtmlOutput {
  html: string;
  report: HtmlRenderReport;
}

/**
 * DECK -> HTML. A thin, inspectable stage: it validates the deck (and, when
 * `ctx` is supplied, re-checks it against its inputs) and returns the
 * self-contained document plus its render report. Pure — no filesystem.
 */
export function renderHtml(deck: ArclumeDeck, ctx: RenderHtmlContext = {}): HtmlOutput {
  const context: RenderHtmlContext = {};
  if (ctx.knowledge !== undefined) context.knowledge = ctx.knowledge;
  if (ctx.narrative !== undefined) context.narrative = ctx.narrative;
  if (ctx.slidePlan !== undefined) context.slidePlan = ctx.slidePlan;
  return renderDeckHtml(deck, { context });
}

export interface HtmlPipelineOutput extends DeckPipelineOutput {
  html: string;
  renderReport: HtmlRenderReport;
}

/** BUILD KNOWLEDGE -> NARRATIVE -> SLIDES -> DECK -> HTML. Stages stay inspectable. */
export function runHtml(
  knowledge: ProjectKnowledge,
  options: PlanningOptions & DeckBuildOptions = {},
): HtmlPipelineOutput {
  const deckOut = runDeck(knowledge, options);
  const { html, report } = renderHtml(deckOut.deck, {
    knowledge,
    narrative: deckOut.narrative,
    slidePlan: deckOut.slidePlan,
  });
  return { ...deckOut, html, renderReport: report };
}

function firstLines(text: string, n: number): string {
  return text.split("\n").slice(0, n).join("\n");
}

/* ------------------------------------------------------------------ */
/* Phase 6 — Chromium Visual QA + atomic delivery                      */
/* ------------------------------------------------------------------ */

/**
 * DECK + HTML -> Visual QA. Browser-bound and asynchronous: it opens the
 * self-contained document in headless Chromium and returns a structured,
 * hashable `VisualQaRun` (result + screenshot buffers). It never mutates the
 * deck or the HTML.
 */
export async function runDeckVisualQa(
  deck: ArclumeDeck,
  html: string,
  options: ValidateRenderedDeckOptions = {},
): Promise<VisualQaRun> {
  return validateRenderedDeck(deck, html, options);
}

export interface ValidatedDeliveryOptions extends VisualQaOptions {
  /** Passed through to `deliverAtomic` (staging cleanup, failure-injection hooks). */
  delivery?: DeliveryOptions;
  /**
   * Resolved diagram artifacts — mandatory when the deck requests
   * the visual engine; bound to the deck in the canonical render, the Visual
   * QA input identity and the delivered receipt.
   */
  diagramArtifacts?: ReadonlyMap<string, ResolvedDiagramArtifact> | undefined;
}

export interface ValidatedDeliveryOutput {
  visualQa: VisualQaRun;
  receipt: VisualQaReceipt;
  manifest: DeliveryManifest;
  delivery: DeliveryResult;
}

/**
 * DECK + HTML -> Visual QA -> receipt -> manifest -> atomic delivery.
 *
 * A convenience over the four inspectable stages (`runDeckVisualQa`,
 * `buildVisualQaReceipt`, `buildManifest`, `deliverAtomic`) — not a replacement
 * for them. Throws (and publishes nothing) when Visual QA reports an error or
 * `destination` already exists.
 */
export async function runValidatedDelivery(
  deck: ArclumeDeck,
  html: string,
  destination: string,
  options: ValidatedDeliveryOptions = {},
): Promise<ValidatedDeliveryOutput> {
  const { delivery: deliveryOptions, diagramArtifacts, ...qaOptions } = options;
  const run = await validateRenderedDeck(deck, html, { ...qaOptions, diagramArtifacts });

  const viewports = qaOptions.viewports ?? DEFAULT_VIEWPORTS;
  const configHash = visualQaConfigHash(viewports, qaOptions);
  const engines = visualEngineIdentity(diagramArtifacts);
  const receipt = buildVisualQaReceipt({
    result: run,
    html,
    deckIrVersion: deck.irVersion,
    deckContentHash: contentHash(deck).slice("sha256:".length),
    configHash,
    ...(engines !== undefined ? { engines: { visual: engines } } : {}),
  });

  const delivery = await deliverAtomic(
    destination,
    { deck, html, visualQa: run, receipt, screenshots: run.artifacts, diagramArtifacts },
    deliveryOptions ?? {},
  );

  return { visualQa: run, receipt, manifest: delivery.manifest, delivery };
}

export type { AudienceName };
