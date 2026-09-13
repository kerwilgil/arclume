/**
 * ARCLUME Visual Engine — public surface of the vendored engine.
 *
 * `resolveVisualEngineDiagram` runs the full pipeline for one diagram:
 * adapter (pure) → runner (vendored subprocess) → sanitizer (saxes,
 * allowlist, rebuild) → validator (topology / provenance round-trip).
 * The result is a trusted, cryptographically bound `ResolvedDiagramArtifact`.
 *
 * Fallback policy lives in the *resolver* (`src/pipeline/resolve-diagrams.ts`),
 * not here: this module throws on any failure and never downgrades silently.
 */

import { contentHash, sha256Hex, stableStringify } from "../../determinism/hash.js";
import type { DiagramIR } from "../../types/deck.js";
import type { ResolvedDiagramArtifact } from "../types.js";
import { adaptDiagramToVisualEngine } from "./adapter.js";
import { VisualEngineError } from "./errors.js";
import { validateResolvedArtifactFinalForm } from "./final-form.js";
import { type VisualEngineRunOptions, runVisualEngine } from "./runner.js";
import {
  type SanitizeExpectation,
  type SanitizedSvg,
  sanitizeVisualEngineSvgRegion,
} from "./sanitize.js";
import type { VisualEngineAdaptation } from "./types.js";
import { validateSanitizedDiagram } from "./validate.js";
import { VISUAL_ENGINE_COMMIT, VISUAL_ENGINE_VENDORED } from "./vendored.js";

export { adaptDiagramToVisualEngine, placeArchitecture } from "./adapter.js";
export {
  VisualEngineError,
  VISUAL_ENGINE_ERROR_CODES,
  VISUAL_ENGINE_FALLBACKABLE_CODES,
  isFallbackableVisualEngineCode,
  type VisualEngineErrorCode,
} from "./errors.js";
export { VISUAL_ENGINE_CLASS_MAP, isKnownVisualEngineClass } from "./style-map.js";
export {
  runVisualEngine,
  type VisualEngineRunOptions,
  type VisualEngineRunResult,
} from "./runner.js";
export {
  sanitizeVisualEngineSvgRegion,
  type SanitizeExpectation,
  type SanitizedSvg,
  type SanitizedSummary,
} from "./sanitize.js";
export { validateSanitizedDiagram } from "./validate.js";
export {
  validateResolvedArtifactFinalForm,
  type FinalFormIssue,
} from "./final-form.js";
export { buildDiagramEngineReport } from "./report.js";
export {
  VISUAL_ENGINE_COMMIT,
  VISUAL_ENGINE_FILE_COUNT,
  VISUAL_ENGINE_SUBTREE_SHA256,
  VISUAL_ENGINE_VENDORED,
  visualEngineCliPath,
  visualEngineVendorRoot,
  computeVisualEngineSubtreeDigest,
} from "./vendored.js";
export {
  VISUAL_ENGINE_COMPONENT_TYPE_SENTINEL,
  VISUAL_ENGINE_ID_RE,
  VISUAL_ENGINE_WORKFLOW_CAPACITY,
  NATIVE_SPEC_FORMAT,
  type VisualEngineAdaptation,
  type VisualEngineAdaptationFailure,
  type VisualEngineAdaptationResult,
  type VisualEngineProvenanceMaps,
  type VisualEngineArchitectureRequest,
  type VisualEngineRequest,
  type VisualEngineWorkflowRequest,
  type NativeArchitectureSpec,
  type NativeDiagramSpec,
  type NativeWorkflowSpec,
} from "./types.js";

export interface VisualEngineResolveOptions {
  runner?: VisualEngineRunOptions;
}

/**
 * Resolve one visual-engine-requested diagram into a trusted SVG artifact.
 *
 * Throws `VisualEngineError` on any failure — the resolver decides whether the code
 * may become a native fallback. The returned artifact is bound to the source
 * spec via `specHash`; its SVG is rebuilt, never the engine's raw bytes.
 */
export async function resolveVisualEngineDiagram(
  diagram: DiagramIR,
  options: VisualEngineResolveOptions = {},
): Promise<ResolvedDiagramArtifact> {
  const adaptation = adaptDiagramToVisualEngine(diagram);
  if (adaptation.kind === "error") {
    throw new VisualEngineError(adaptation.code as never, adaptation.message, adaptation.diagramId);
  }

  const requestJson = stableStringify(adaptation.request);
  const run = await runVisualEngine(adaptation.visualKind, requestJson, diagram.id, options.runner);

  const edgeSemantics: SanitizeExpectation["edgeSemantics"] = new Map(
    [...adaptation.maps.edgeToRelation.entries()].map(([edgeId, relationId]) => {
      const dir = adaptation.maps.edgeDirection.get(edgeId) as { from: string; to: string };
      return [edgeId, { relationId, from: dir.from, to: dir.to }];
    }),
  );

  const sanitized: SanitizedSvg = sanitizeVisualEngineSvgRegion(run.html, {
    nodeSemantics: buildNodeSemantics(adaptation),
    edgeSemantics,
    visualKind: adaptation.visualKind,
    diagramId: diagram.id,
  });
  validateSanitizedDiagram(sanitized, adaptation);

  return {
    kind: "svg",
    diagramId: diagram.id,
    engineRequested: "visual",
    engineUsed: "visual",
    engineVersion: VISUAL_ENGINE_VENDORED,
    engineCommit: VISUAL_ENGINE_COMMIT,
    specHash: adaptation.specHash,
    diagramRenderInputHash: diagramRenderInputHash(diagram),
    svg: sanitized.svg,
    svgSha256: sha256Hex(sanitized.svg),
    provenance: adaptation.provenance,
    warnings: [],
  };
}

function buildNodeSemantics(
  adaptation: Extract<VisualEngineAdaptation, { kind: "ok" }>,
): SanitizeExpectation["nodeSemantics"] {
  const out = new Map<string, { entityId?: string; ref?: string }>();
  if (adaptation.visualKind === "architecture") {
    for (const [nodeId, entityId] of adaptation.maps.nodeToEntity) {
      out.set(nodeId, { entityId });
    }
  } else {
    for (const [stepId, ref] of adaptation.maps.stepToRef) {
      out.set(stepId, { ref });
    }
    // steps without ref map entries shouldn't exist (adapter requires ref)
    for (const stepId of adaptation.ordering.stepOrder) {
      if (!out.has(stepId)) out.set(stepId, {});
    }
  }
  return out;
}

/**
 * Hash over EVERY render-driving diagram input (P2-3): the spec alone is not
 * enough — the request meta.title comes from `diagram.title`.
 */
export function diagramRenderInputHash(
  diagram: Pick<DiagramIR, "id" | "diagramType" | "engine" | "title" | "spec">,
): string {
  return contentHash({
    id: diagram.id,
    diagramType: diagram.diagramType,
    engineRequested: diagram.engine,
    title: diagram.title ?? null,
    spec: diagram.spec ?? null,
  });
}
