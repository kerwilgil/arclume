/**
 * Inspectable intermediate artifacts.
 *
 * Each stage is written as its own deterministic JSON file so it can be examined
 * (and diffed) on its own — the pipeline is never a single opaque function.
 *
 *   <dir>/manifest.json            run summary + digests + skipped inputs
 *   <dir>/sources.json             Source[]
 *   <dir>/documents/index.json     [{ id, sourceId, path, kind }]
 *   <dir>/documents/<id>.json      one SourceDocument (content included)
 *   <dir>/analysis.json            AnalysisResult (+ reasoner id/version)
 *   <dir>/project-knowledge.json   the validated ProjectKnowledge
 *   <dir>/narrative-plan.json      the validated NarrativePlan   (Phase 3, optional)
 *   <dir>/slide-plan.json          the validated SlidePlan       (Phase 3, optional)
 *   <dir>/arclume-deck.json        the validated ArclumeDeck     (Phase 4, optional)
 *   <dir>/arclume-deck.html        the self-contained HTML deck  (Phase 5, optional)
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AnalysisResult } from "../analysis/analysis-result.js";
import type { IngestionResult } from "../ingestion/types.js";
import type { NarrativePlan } from "../narrative/types.js";
import type { SlidePlan } from "../planning/types.js";
import type { ArclumeDeck } from "../types/deck.js";
import type { ProjectKnowledge } from "../types/knowledge.js";

/** Deterministic pretty JSON: keys sorted at every level, 2-space indent. */
export function stableJson(value: unknown): string {
  return `${JSON.stringify(sortDeep(value), null, 2)}\n`;
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortDeep((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

export interface ArtifactBundle {
  ingestion: IngestionResult;
  sourceDigest: string;
  analysisDigest: string;
  analysis: AnalysisResult;
  reasoner: { id: string; version: string };
  knowledge?: ProjectKnowledge;
  narrative?: NarrativePlan;
  slidePlan?: SlidePlan;
  deck?: ArclumeDeck;
  /** Rendered self-contained HTML (Phase 5). Written verbatim, no re-encoding. */
  html?: string;
  /** Injected explicitly by the caller; never generated here. */
  generatedAt?: string;
}

function planningStage(bundle: ArtifactBundle): string {
  if (bundle.deck) return "deck";
  if (bundle.slidePlan) return "slide-plan";
  if (bundle.narrative) return "narrative";
  if (bundle.knowledge) return "knowledge";
  return "analysis";
}

export function writeArtifacts(dir: string, bundle: ArtifactBundle): void {
  mkdirSync(join(dir, "documents"), { recursive: true });

  const manifest = {
    arclume: { stage: planningStage(bundle) },
    sourceDigest: bundle.sourceDigest,
    analysisDigest: bundle.analysisDigest,
    reasoner: bundle.reasoner,
    counts: {
      sources: bundle.ingestion.sources.length,
      documents: bundle.ingestion.documents.length,
      skipped: bundle.ingestion.skipped.length,
    },
    skipped: [...bundle.ingestion.skipped],
    ...(bundle.generatedAt !== undefined ? { generatedAt: bundle.generatedAt } : {}),
  };
  writeFileSync(join(dir, "manifest.json"), stableJson(manifest));
  writeFileSync(join(dir, "sources.json"), stableJson(bundle.ingestion.sources));

  const index = bundle.ingestion.documents.map((d) => ({
    id: d.id,
    sourceId: d.sourceId,
    path: d.path,
    kind: d.kind,
  }));
  writeFileSync(join(dir, "documents", "index.json"), stableJson(index));
  for (const doc of bundle.ingestion.documents) {
    writeFileSync(join(dir, "documents", `${doc.id}.json`), stableJson(doc));
  }

  writeFileSync(
    join(dir, "analysis.json"),
    stableJson({ reasoner: bundle.reasoner, analysis: bundle.analysis }),
  );

  if (bundle.knowledge) {
    writeFileSync(join(dir, "project-knowledge.json"), stableJson(bundle.knowledge));
  }
  if (bundle.narrative) {
    writeFileSync(join(dir, "narrative-plan.json"), stableJson(bundle.narrative));
  }
  if (bundle.slidePlan) {
    writeFileSync(join(dir, "slide-plan.json"), stableJson(bundle.slidePlan));
  }
  if (bundle.deck) {
    writeFileSync(join(dir, "arclume-deck.json"), stableJson(bundle.deck));
  }
  if (bundle.html !== undefined) {
    writeFileSync(join(dir, "arclume-deck.html"), bundle.html);
  }
}

/**
 * Write a rendered HTML deck to a file. Filesystem boundary only — the string
 * comes from `renderDeckHtml` (a pure function); this never renders.
 */
export function writeHtmlArtifact(filePath: string, html: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, html);
}

export function readHtmlArtifact(dir: string): string {
  return readFileSync(join(dir, "arclume-deck.html"), "utf8");
}

export function readAnalysisArtifact(dir: string): {
  reasoner: { id: string; version: string };
  analysis: AnalysisResult;
} {
  const raw = JSON.parse(readFileSync(join(dir, "analysis.json"), "utf8"));
  return raw as { reasoner: { id: string; version: string }; analysis: AnalysisResult };
}

export function readKnowledgeArtifact(dir: string): ProjectKnowledge {
  return JSON.parse(readFileSync(join(dir, "project-knowledge.json"), "utf8")) as ProjectKnowledge;
}

export function readNarrativeArtifact(dir: string): NarrativePlan {
  return JSON.parse(readFileSync(join(dir, "narrative-plan.json"), "utf8")) as NarrativePlan;
}

export function readSlidePlanArtifact(dir: string): SlidePlan {
  return JSON.parse(readFileSync(join(dir, "slide-plan.json"), "utf8")) as SlidePlan;
}

export function readDeckArtifact(dir: string): ArclumeDeck {
  return JSON.parse(readFileSync(join(dir, "arclume-deck.json"), "utf8")) as ArclumeDeck;
}
