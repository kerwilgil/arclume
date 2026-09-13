/**
 * Chromium Visual QA (Phase 6) — public surface.
 *
 * Visual QA runs strictly AFTER the self-contained HTML. It opens the document
 * in a real headless Chromium, proves it makes no network request, raises no JS
 * error and no dialog, navigates correctly, keeps its geometry (no critical
 * overflow / clipping / off-slide), renders diagrams, captures real screenshots
 * and emits hashable evidence. It never mutates the deck or the HTML.
 */

import type { ResolvedDiagramArtifact } from "../../engines/types.js";
import { VisualQaError } from "../../errors.js";
import { renderCanonicalDeckHtml } from "../../pipeline/canonical-render.js";
import type { ArclumeDeck } from "../../types/deck.js";
import { formatValidationReport, validateArclumeDeck } from "../../validation/validator.js";
import { runVisualQa } from "./runner.js";
import type { VisualQaOptions, VisualQaRun } from "./types.js";

export interface ValidateRenderedDeckOptions extends VisualQaOptions {
  /**
   * Resolved diagram artifacts. A deck whose diagrams request the
   * visual engine must carry their resolved artifacts here; the canonical
   * render binds them to the deck (missing / stale / mismatched artifacts are
   * fatal — the low-level placeholder is never a canonical surface).
   */
  diagramArtifacts?: ReadonlyMap<string, ResolvedDiagramArtifact> | undefined;
}

export { runVisualQa } from "./runner.js";
export { compareScreenshots, type DiffOptions, type DiffResult } from "./regression.js";
export { buildVisualQaReceipt, visualQaJson, visualQaConfigHash } from "./receipt.js";
export { checkPhase6Schema, resetPhase6SchemaCache, type Phase6SchemaName } from "./schema.js";
export { contrastRatio } from "./contrast.js";
export { geometryFindings } from "./geometry.js";
export type { SlideMeasurement, GeometryPolicy } from "./geometry.js";
export {
  CANONICAL_VIEWPORT,
  DEFAULT_VIEWPORTS,
  VISUAL_QA_VERSION,
  VISUAL_FINDING_CODES,
  type BrowserIdentity,
  type ScreenshotDescriptor,
  type VisualFinding,
  type VisualFindingCode,
  type VisualQaOptions,
  type VisualQaReceipt,
  type VisualQaResult,
  type VisualQaRun,
  type VisualSeverity,
  type Viewport,
  type ViewportResult,
} from "./types.js";

/**
 * Validate a rendered deck end-to-end. This API **asserts a binding** between an
 * `ArclumeDeck` and its HTML, so it is strict:
 *
 *  1. schema-check the `ArclumeDeck` (fatal `visual/invalid-deck` if invalid);
 *  2. render the canonical HTML from the deck and require `html === canonical`
 *     **byte for byte** — Phase 5's renderer is deterministic, so the only HTML
 *     that "is the render of this deck" is the exact canonical output. Any
 *     difference (CSS, a block's text, a stray attribute) → fatal
 *     `visual/html-deck-mismatch`. The HTML is never silently replaced.
 *  3. run Visual QA in Chromium on that HTML.
 *
 * `runVisualQa(html, options?)` stays available for standalone QA of any valid
 * self-contained document — the byte-exact rule only applies where a deck
 * binding is claimed (`validateRenderedDeck`, `runDeckVisualQa`,
 * `runValidatedDelivery`).
 */
export async function validateRenderedDeck(
  deck: ArclumeDeck,
  html: string,
  options: ValidateRenderedDeckOptions = {},
): Promise<VisualQaRun> {
  const validation = validateArclumeDeck(deck);
  if (!validation.valid) {
    throw new VisualQaError("refusing to Visual-QA an invalid ArclumeDeck", {
      code: "visual/invalid-deck",
      hint: formatValidationReport(validation).split("\n").slice(0, 12).join("\n"),
    });
  }

  const canonical = renderCanonicalDeckHtml({
    deck,
    diagramArtifacts: options.diagramArtifacts,
  }).html;
  if (html !== canonical) {
    throw new VisualQaError(
      "the supplied HTML is not the canonical render of the supplied ArclumeDeck " +
        "(renderCanonicalDeckHtml({deck, diagramArtifacts}).html differs byte-for-byte)",
      {
        code: "visual/html-deck-mismatch",
        hint: `supplied ${html.length} bytes, canonical ${canonical.length} bytes; ${firstDiff(html, canonical)}`,
      },
    );
  }

  const { diagramArtifacts: _artifacts, ...qaOptions } = options;
  const merged: VisualQaOptions = { ...qaOptions };
  if (merged.aspectRatio === undefined && typeof deck.theme?.aspectRatio === "string") {
    merged.aspectRatio = deck.theme.aspectRatio;
  }
  return runVisualQa(html, merged);
}

function firstDiff(a: string, b: string): string {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    if (a[i] !== b[i]) {
      const around = (s: string): string => JSON.stringify(s.slice(Math.max(0, i - 20), i + 20));
      return `first difference at byte ${i}: supplied ${around(a)} vs canonical ${around(b)}`;
    }
  }
  return a.length === b.length
    ? "identical prefix (should not happen)"
    : "one is a prefix of the other";
}
