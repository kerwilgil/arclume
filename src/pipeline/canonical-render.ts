/**
 * Canonical deck render context.
 *
 * `CanonicalDeckRenderInput` is the sole canonical identity needed to
 * reproduce final HTML: the deck plus the resolved diagram artifacts.
 * `renderCanonicalDeckHtml(input)` is the ONLY authoritative definition of
 * "the canonical HTML" for a deck.
 *
 * Artifact ↔ deck binding is validated before rendering. Failures are
 * `RenderError`s with `delivery/diagram-artifact-*` codes — never a silent
 * placeholder.
 */

import { sha256Hex } from "../determinism/hash.js";
import { contentHash } from "../determinism/hash.js";
import type { DiagramEngineReport, ResolvedDiagramArtifact } from "../engines/types.js";
import {
  VISUAL_ENGINE_COMMIT,
  VISUAL_ENGINE_FALLBACKABLE_CODES,
  VISUAL_ENGINE_VENDORED,
  VisualEngineError,
  adaptDiagramToVisualEngine,
  diagramRenderInputHash,
  validateResolvedArtifactFinalForm,
} from "../engines/visual/index.js";
import { RenderError } from "../errors.js";
import { renderDeckHtml } from "../renderers/html/index.js";
import type { HtmlRenderOptions, HtmlRenderResult } from "../renderers/html/index.js";
import type { ArclumeDeck } from "../types/deck.js";

export interface CanonicalDeckRenderInput {
  deck: ArclumeDeck;
  diagramArtifacts?: ReadonlyMap<string, ResolvedDiagramArtifact> | undefined;
}

export interface CanonicalDeckRenderOutput extends HtmlRenderResult {
  /** The input that counts as canonical identity. */
  input: CanonicalDeckRenderInput;
}

function fail(code: string, message: string): never {
  throw new RenderError(message, { code });
}

/** Deterministic hash of a diagram's semantic spec (adapter-compatible). */
export function diagramSpecHash(spec: unknown): string {
  return contentHash(spec ?? null);
}

/**
 * Structural + cryptographic binding check between a deck and its resolved
 * diagram artifacts. Fatal on any violation.
 */
export function validateDiagramArtifactBindings(
  deck: ArclumeDeck,
  artifacts: ReadonlyMap<string, ResolvedDiagramArtifact> | undefined,
): void {
  const diagramsById = new Map((deck.diagrams ?? []).map((d) => [d.id, d]));
  const artifactsList = artifacts === undefined ? [] : [...artifacts.entries()];

  const seen = new Set<string>();
  for (const [key, artifact] of artifactsList) {
    if (key !== artifact.diagramId) {
      fail(
        "delivery/diagram-artifact-mismatch",
        `artifact key "${key}" does not match artifact.diagramId "${artifact.diagramId}"`,
      );
    }
    if (seen.has(key)) {
      fail("delivery/diagram-artifact-mismatch", `duplicate artifact for diagram "${key}"`);
    }
    seen.add(key);

    const diagram = diagramsById.get(key);
    if (diagram === undefined) {
      fail(
        "delivery/diagram-artifact-extra",
        `an artifact exists for diagram "${key}" but the deck has no such diagram`,
      );
    }

    if (artifact.engineRequested !== "visual" || diagram.engine !== "visual") {
      fail(
        "delivery/diagram-artifact-mismatch",
        `artifact for diagram "${key}" does not correspond to a diagram that requested the visual engine`,
      );
    }

    const expectedSpecHash = diagramSpecHash(diagram.spec);
    if (artifact.specHash !== expectedSpecHash) {
      fail(
        "delivery/diagram-artifact-stale",
        `artifact for diagram "${key}" was produced for a different spec (stale or cross-deck)`,
      );
    }
    const expectedInputHash = diagramRenderInputHash(diagram);
    if (artifact.diagramRenderInputHash !== expectedInputHash) {
      fail(
        "delivery/diagram-artifact-stale",
        `artifact for diagram "${key}" was produced for different render-driving input (id / type / engine / title / spec) — stale or cross-deck`,
      );
    }

    if (artifact.kind === "svg") {
      if (artifact.engineUsed !== "visual") {
        fail(
          "delivery/diagram-artifact-mismatch",
          `svg artifact for diagram "${key}" does not carry engineUsed "visual"`,
        );
      }
      if (
        artifact.engineVersion !== VISUAL_ENGINE_VENDORED ||
        artifact.engineCommit !== VISUAL_ENGINE_COMMIT
      ) {
        fail(
          "delivery/diagram-artifact-mismatch",
          `svg artifact for diagram "${key}" carries an unexpected visual engine identity`,
        );
      }
      if (sha256Hex(artifact.svg) !== artifact.svgSha256) {
        fail(
          "delivery/diagram-artifact-mismatch",
          `svg artifact for diagram "${key}" does not hash to its declared svgSha256`,
        );
      }
      // P1-2: a caller-supplied artifact is NEVER trusted from its metadata
      // alone — the final SVG is re-parsed and its provenance is re-derived
      // from the current deck spec.
      try {
        validateResolvedArtifactFinalForm(artifact, diagram);
      } catch (cause) {
        const inner =
          cause instanceof VisualEngineError
            ? `${cause.code}: ${cause.message}`
            : (cause as Error).message;
        fail(
          "delivery/diagram-artifact-mismatch",
          `svg artifact for diagram "${key}" failed final-form revalidation: ${inner}`,
        );
      }
    } else {
      // native-fallback is caller-controlled too: its declared failure must
      // be a genuinely fallbackable engine outcome, never an integrity or
      // security failure in disguise (P1).
      if (artifact.engineUsed !== "native") {
        fail(
          "delivery/diagram-artifact-mismatch",
          `native-fallback artifact for diagram "${key}" does not carry engineUsed "native"`,
        );
      }
      if (!VISUAL_ENGINE_FALLBACKABLE_CODES.has(artifact.code)) {
        fail(
          "delivery/diagram-artifact-mismatch",
          `native-fallback artifact for diagram "${key}" claims fatal code "${artifact.code}" — integrity failures are not fallbackable`,
        );
      }
      const fallbackWarning = artifact.warnings.find(
        (w) => w.code === "visual-engine/fallback-native" && w.diagramId === key,
      );
      if (fallbackWarning === undefined) {
        fail(
          "delivery/diagram-artifact-mismatch",
          `native-fallback artifact for diagram "${key}" lacks the visual-engine/fallback-native warning`,
        );
      }
      // A fatal integrity/security code hidden inside a fallback's warnings
      // is a masked failure — reject it (small trust-boundary hardening).
      for (const w of artifact.warnings) {
        if (
          w.code.startsWith("visual-engine/") &&
          w.code !== "visual-engine/fallback-native" &&
          !VISUAL_ENGINE_FALLBACKABLE_CODES.has(w.code)
        ) {
          fail(
            "delivery/diagram-artifact-mismatch",
            `native-fallback artifact for diagram "${key}" carries fatal code "${w.code}" inside warnings`,
          );
        }
      }
      // Deterministic adapter-level failures must be reproducible from the
      // CURRENT deck spec without running the engine.
      if (
        artifact.code === "visual-engine/unsupported-diagram" ||
        artifact.code === "visual-engine/layout-capacity"
      ) {
        const reAdapation = adaptDiagramToVisualEngine(diagram);
        if (reAdapation.kind !== "error" || reAdapation.code !== artifact.code) {
          fail(
            "delivery/diagram-artifact-mismatch",
            `native-fallback artifact for diagram "${key}" claims "${artifact.code}" but re-adapting the current deck does not reproduce it`,
          );
        }
      }
    }
  }

  // A diagram that requests the visual engine must have an explicit resolution outcome.
  for (const diagram of deck.diagrams ?? []) {
    if (diagram.engine === "visual" && !seen.has(diagram.id)) {
      fail(
        "delivery/diagram-artifact-missing",
        `diagram "${diagram.id}" requests engine "visual" but no resolved artifact was supplied`,
      );
    }
  }
}

/**
 * The canonical render. Pure and synchronous (all subprocess work already
 * happened during resolution); byte-identical to `renderDeckHtml(deck)` when
 * the artifacts map is absent or empty on a native-only deck.
 */
export function renderCanonicalDeckHtml(
  input: CanonicalDeckRenderInput,
  options: HtmlRenderOptions = {},
): CanonicalDeckRenderOutput {
  validateDiagramArtifactBindings(input.deck, input.diagramArtifacts);
  const result = renderDeckHtml(input.deck, {
    ...options,
    diagramArtifacts: input.diagramArtifacts,
  });
  return { ...result, input };
}

/** True when at least one artifact was produced by the visual engine itself. */
export function anyVisualEngineProduced(
  artifacts: ReadonlyMap<string, ResolvedDiagramArtifact> | undefined,
): boolean {
  if (artifacts === undefined) return false;
  for (const a of artifacts.values()) {
    if (a.kind === "svg" && a.engineUsed === "visual") return true;
  }
  return false;
}

/** Engine identity for receipts — present only when the visual engine produced output. */
export function visualEngineIdentity(
  artifacts: ReadonlyMap<string, ResolvedDiagramArtifact> | undefined,
): { version: string; commit: string } | undefined {
  if (!anyVisualEngineProduced(artifacts)) return undefined;
  return { version: VISUAL_ENGINE_VENDORED, commit: VISUAL_ENGINE_COMMIT };
}

export type { DiagramEngineReport };
