/**
 * `renderDeckHtml` — the one public entry point of the HTML renderer.
 *
 * Contract:
 *  - the deck is validated first (`validateArclumeDeck`); an invalid deck is a
 *    fatal `RenderError` and nothing is rendered;
 *  - when `options.context` carries knowledge / narrative / slidePlan, the
 *    Phase 4 context checks run too (no stale / mixed baseline);
 *  - the output is a single self-contained HTML string plus an inspectable
 *    report; the function is pure and deterministic (no clock, no random).
 */

import { RenderError } from "../../errors.js";
import type { ArclumeDeck, DiagramIR } from "../../types/deck.js";
import { formatValidationReport, validateArclumeDeck } from "../../validation/validator.js";
import { type Theme, getTheme } from "../../visual/theme.js";
import { renderDocument } from "./document.js";
import { renderSlide } from "./slides.js";
import { isRenderableTheme } from "./theme.js";
import {
  HTML_RENDERER_VERSION,
  type HtmlRenderOptions,
  type HtmlRenderResult,
  type HtmlRenderWarning,
} from "./types.js";
import { assertRenderOutput } from "./validation.js";

const ASPECT_RATIOS = new Set(["16:9", "16:10", "4:3"]);

function byteLength(s: string): number {
  return Buffer.byteLength(s, "utf8");
}

export function renderDeckHtml(
  deck: ArclumeDeck,
  options: HtmlRenderOptions = {},
): HtmlRenderResult {
  // 1) integrity gate — never render a deck that is not valid against its schema
  //    (and, when context is supplied, against its inputs).
  const ctx = options.context ?? {};
  const validation = validateArclumeDeck(deck, ctx);
  if (!validation.valid) {
    throw new RenderError("refusing to render an invalid ArclumeDeck", {
      code: "render/invalid-deck",
      hint: formatValidationReport(validation).split("\n").slice(0, 16).join("\n"),
    });
  }

  const warnings: HtmlRenderWarning[] = [];

  // 2) resolve the declared theme. The deck is the sole authority.
  const themeName = deck.theme?.name ?? "";
  let theme: Theme;
  if (isRenderableTheme(themeName)) {
    theme = getTheme(themeName);
  } else {
    throw new RenderError(
      `theme "${String(themeName)}" is declared but this renderer resolves only "minimal" and "executive"`,
      { code: "render/theme-unresolved" },
    );
  }

  const declaredAspect = deck.theme?.aspectRatio;
  const aspectRatio =
    typeof declaredAspect === "string" && ASPECT_RATIOS.has(declaredAspect)
      ? declaredAspect
      : theme.aspectRatio;

  // 3) index diagrams for block references
  const diagramsById = new Map<string, DiagramIR>();
  for (const d of deck.diagrams ?? []) diagramsById.set(d.id, d);

  // 4) slides
  const slides = deck.slides ?? [];
  let blockCount = 0;
  const slidesHtml: string[] = [];
  slides.forEach((slide, i) => {
    const r = renderSlide(slide, i, {
      diagramsById,
      total: slides.length,
      diagramArtifacts: options.diagramArtifacts,
    });
    slidesHtml.push(r.html);
    warnings.push(...r.warnings);
    blockCount += r.blockCount;
  });

  // 5) assemble the document
  const html = renderDocument({
    deck,
    theme,
    aspectRatio,
    slidesHtml: slidesHtml.join("\n"),
    slideCount: slides.length,
    diagramCount: (deck.diagrams ?? []).length,
  });

  // 6) structural self-check (fatal on integrity breach)
  assertRenderOutput(deck, html);

  return {
    html,
    report: {
      rendererVersion: HTML_RENDERER_VERSION,
      irVersion: deck.irVersion,
      theme: theme.deckThemeName,
      aspectRatio,
      slideCount: slides.length,
      blockCount,
      diagramCount: (deck.diagrams ?? []).length,
      bytes: byteLength(html),
      warnings,
    },
  };
}
