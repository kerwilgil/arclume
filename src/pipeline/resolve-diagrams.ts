/**
 * Diagram engine resolver — observational by contract.
 *
 * Reads a deck (already engine-annotated by `applyDiagramEnginePreference`),
 * resolves every visual-engine-requested diagram and returns the artifacts + a
 * deterministic report. It NEVER returns a mutated deck and never re-stamps
 * `diagram.engine`: `contentHash(deck)` before === after.
 *
 * Fallback policy: a `VisualEngineError` with a fallbackable code becomes a loud
 * `native-fallback` artifact (plus a `visual-engine/fallback-native` warning) when
 * `fallbackOnError` is on (default). Integrity / adapter failures never fall
 * back. With `fallbackOnError: false` even environment failures are fatal.
 */

import { contentHash } from "../determinism/hash.js";
import type {
  DiagramEngineReport,
  DiagramEngineReportEntry,
  ResolvedDiagramArtifact,
} from "../engines/types.js";
import {
  VisualEngineError,
  buildDiagramEngineReport,
  diagramRenderInputHash as diagramRenderIdentityHash,
  isFallbackableVisualEngineCode,
  resolveVisualEngineDiagram,
} from "../engines/visual/index.js";
import type { VisualEngineRunOptions } from "../engines/visual/index.js";
import type { ArclumeDeck } from "../types/deck.js";

export interface ResolveDiagramEnginesOptions {
  /** Allow environment / capacity failures to fall back to native. Default true. */
  fallbackOnError?: boolean;
  /** Runner tuning (timeouts, injected CLI paths — tests). */
  runner?: VisualEngineRunOptions;
}

export interface ResolveDiagramEnginesResult {
  diagramArtifacts: ReadonlyMap<string, ResolvedDiagramArtifact>;
  report: DiagramEngineReport;
}

export async function resolveDiagramEngines(
  deck: ArclumeDeck,
  options: ResolveDiagramEnginesOptions = {},
): Promise<ResolveDiagramEnginesResult> {
  const fallbackOnError = options.fallbackOnError !== false;
  const artifacts = new Map<string, ResolvedDiagramArtifact>();
  const entries: DiagramEngineReportEntry[] = [];

  for (const diagram of deck.diagrams ?? []) {
    if (diagram.engine !== "visual") {
      entries.push({
        diagramId: diagram.id,
        engineRequested: diagram.engine,
        engineUsed: "native",
        outcome: "native",
        warnings: [],
      });
      continue;
    }

    try {
      const artifact = await resolveVisualEngineDiagram(diagram, { runner: options.runner ?? {} });
      artifacts.set(diagram.id, artifact);
      entries.push({
        diagramId: diagram.id,
        engineRequested: "visual",
        engineUsed: "visual",
        outcome: "resolved",
        warnings: artifact.warnings,
      });
    } catch (err) {
      const code = err instanceof VisualEngineError ? err.code : "visual-engine/render-failed";
      const message = err instanceof Error ? err.message : String(err);
      if (!fallbackOnError || !isFallbackableVisualEngineCode(code)) {
        throw err;
      }
      const warning = {
        code: "visual-engine/fallback-native",
        message: `diagram "${diagram.id}" fell back to the native engine (${code})`,
        diagramId: diagram.id,
      };
      // Same deterministic binding the adapter computes on success.
      const specHash = contentHash(diagram.spec ?? null);
      const diagramRenderInputHash = diagramRenderIdentityHash(diagram);
      const artifact: ResolvedDiagramArtifact = {
        kind: "native-fallback",
        diagramId: diagram.id,
        engineRequested: "visual",
        engineUsed: "native",
        specHash,
        diagramRenderInputHash,
        code,
        message,
        warnings: [warning],
      };
      artifacts.set(diagram.id, artifact);
      entries.push({
        diagramId: diagram.id,
        engineRequested: "visual",
        engineUsed: "native",
        outcome: "fallback",
        code,
        reason: "fallback to native engine",
        warnings: [warning],
      });
    }
  }

  return { diagramArtifacts: artifacts, report: buildDiagramEngineReport(entries) };
}
