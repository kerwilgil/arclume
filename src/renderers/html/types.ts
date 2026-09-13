/**
 * Public shapes for the HTML renderer.
 *
 * The renderer is a pure function: `ArclumeDeck` (+ optional context for
 * stricter validation) in, a self-contained HTML string + an inspectable
 * report out. No filesystem, no clock, no network.
 */

import type { ResolvedDiagramArtifact } from "../../engines/types.js";
import type { NarrativePlan } from "../../narrative/types.js";
import type { SlidePlan } from "../../planning/types.js";
import type { ProjectKnowledge } from "../../types/knowledge.js";

/** Independent of the deck IR version. Bumped when the HTML output changes. */
export const HTML_RENDERER_VERSION = "0.1.0" as const;

/** The bundle a renderer warning can point at. */
export interface HtmlRenderWarning {
  code: string;
  message: string;
  slideId?: string | undefined;
  blockId?: string | undefined;
  diagramId?: string | undefined;
}

export interface HtmlRenderReport {
  rendererVersion: string;
  /** Echoes `deck.irVersion`. */
  irVersion: string;
  /** Echoes `deck.theme.name`. */
  theme: string;
  aspectRatio: string;
  slideCount: number;
  blockCount: number;
  diagramCount: number;
  /** UTF-8 byte length of `html`. Deterministic; not a timestamp. */
  bytes: number;
  warnings: HtmlRenderWarning[];
}

export interface HtmlRenderResult {
  html: string;
  report: HtmlRenderReport;
}

/**
 * When any of these are supplied, `renderDeckHtml` also runs the Phase 4
 * context validation (`validateArclumeDeck(deck, ctx)`) and refuses a stale /
 * mixed-baseline deck.
 */
export interface HtmlRenderContext {
  knowledge?: ProjectKnowledge;
  narrative?: NarrativePlan;
  slidePlan?: SlidePlan;
}

export interface HtmlRenderOptions {
  context?: HtmlRenderContext;
  /**
   * Resolved diagram artifacts (Phase 7). How they got resolved is none of the
   * renderer's business: it consumes only trusted, already-sanitized SVG (or
   * an explicit native fallback). No subprocess, no filesystem, no XML parsing
   * happens here.
   *
   * Note: the *canonicalizing* layer (`renderCanonicalDeckHtml`) validates the
   * artifact ↔ deck binding before calling; supplying artifacts directly to
   * this low-level entry point is an explicit, non-canonical choice.
   */
  diagramArtifacts?: ReadonlyMap<string, ResolvedDiagramArtifact> | undefined;
}
