/**
 * Slide rendering. Exhaustive over `SlideLayout`; an unknown layout is a fatal
 * render error (no silent fallback). Provenance survives into the DOM as
 * `data-*` attributes.
 */

import type { ResolvedDiagramArtifact } from "../../engines/types.js";
import { RenderError } from "../../errors.js";
import type { DiagramIR, Slide, SlideLayout } from "../../types/deck.js";
import { renderBlock } from "./blocks.js";
import { escapeHtml, isSafeId, safeIdList } from "./escape.js";
import type { HtmlRenderWarning } from "./types.js";

export interface SlideRenderContext {
  diagramsById: Map<string, DiagramIR>;
  total: number;
  diagramArtifacts?: ReadonlyMap<string, ResolvedDiagramArtifact> | undefined;
}
export interface SlideRenderOutcome {
  html: string;
  warnings: HtmlRenderWarning[];
  blockCount: number;
}

const LAYOUTS: readonly SlideLayout[] = [
  "single",
  "split-2",
  "grid",
  "full-bleed-visual",
  "centered",
  "quote",
];

/** Deterministic, length-only bucket for the key message. */
export function keyMessageClass(message: string): "is-normal" | "is-long" | "is-very-long" {
  const n = message.length;
  if (n <= 90) return "is-normal";
  if (n <= 160) return "is-long";
  return "is-very-long";
}

function layoutClass(layout: SlideLayout): string {
  if (!LAYOUTS.includes(layout)) {
    throw new RenderError(`unsupported slide layout "${String(layout)}"`, {
      code: "render/unsupported-layout",
      hint: `known layouts: ${LAYOUTS.join(", ")}`,
    });
  }
  return `arclume-layout-${layout}`;
}

export function renderSlide(
  slide: Slide,
  index: number,
  ctx: SlideRenderContext,
): SlideRenderOutcome {
  const warnings: HtmlRenderWarning[] = [];
  const cls = layoutClass(slide.layout);

  const parts: string[] = [];
  parts.push(`<h2 class="arclume-slide-title">${escapeHtml(slide.title)}</h2>`);
  if (slide.subtitle) {
    parts.push(`<p class="arclume-slide-subtitle">${escapeHtml(slide.subtitle)}</p>`);
  }
  if (slide.keyMessage) {
    parts.push(
      `<p class="arclume-keymessage ${keyMessageClass(slide.keyMessage)}">${escapeHtml(
        slide.keyMessage,
      )}</p>`,
    );
  }

  let blockCount = 0;
  const blockHtml: string[] = [];
  for (const block of slide.blocks ?? []) {
    const r = renderBlock(block, ctx);
    blockHtml.push(r.html);
    warnings.push(...r.warnings);
    blockCount += 1;
  }
  if (blockHtml.length > 0) {
    parts.push(`<div class="arclume-blocks">${blockHtml.join("")}</div>`);
  }

  if ((slide.evidence ?? []).length > 0) {
    const sources = new Set<string>();
    for (const ev of slide.evidence ?? []) {
      for (const id of safeIdList(ev.sourceRefs?.map((r) => r.sourceId)).split(" ")) {
        if (id) sources.add(id);
      }
    }
    const list = [...sources].sort().join(", ");
    parts.push(
      `<aside class="arclume-evidence" data-evidence-count="${(slide.evidence ?? []).length}">` +
        `Evidence${list ? `: ${escapeHtml(list)}` : ""}</aside>`,
    );
  }

  const id = isSafeId(slide.id) ? slide.id : `slide-${index}`;
  const attrs = [
    `class="arclume-slide ${cls}${index === 0 ? " is-active" : ""}"`,
    `id="slide-${escapeHtml(id)}"`,
    `data-slide-id="${escapeHtml(id)}"`,
    `data-slide-index="${index}"`,
    `data-slide-kind="${escapeHtml(slide.kind)}"`,
    `data-narrative-purpose="${escapeHtml(slide.narrativePurpose)}"`,
    isSafeId(slide.sectionId) ? `data-section-id="${slide.sectionId}"` : "",
    isSafeId(slide.diagramRef) ? `data-diagram-ref="${slide.diagramRef}"` : "",
    `tabindex="-1"`,
    `aria-roledescription="slide"`,
    `aria-label="${escapeHtml(`Slide ${index + 1} of ${ctx.total}: ${slide.title}`)}"`,
    index === 0 ? "" : `aria-hidden="true"`,
  ].filter(Boolean);

  return {
    html: `<section ${attrs.join(" ")}>${parts.join("")}</section>`,
    warnings,
    blockCount,
  };
}
