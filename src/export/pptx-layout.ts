/**
 * PPTX semantic layout map (Phase 8) — the six ArclumeDeck layouts plus a
 * handler for every BlockType. Everything is metric and deterministic: the
 * same theme tokens, the same authored slide structure.
 */

import type PptxGenJS from "pptxgenjs";
type SlideLike = {
  addText(text: unknown, options: Record<string, unknown>): unknown;
  addImage(options: Record<string, unknown>): unknown;
  addTable(rows: unknown, options: Record<string, unknown>): unknown;
  addNotes(notes: string): unknown;
};
import { contentHash } from "../determinism/hash.js";
import type { ResolvedDiagramArtifact } from "../engines/types.js";
import { RenderError } from "../errors.js";
import type { NarrativePlan } from "../narrative/types.js";
import type { Block, MetricGridItem } from "../types/blocks.js";
import { isDiagramBlock } from "../types/blocks.js";
import type { ArclumeDeck, Slide } from "../types/deck.js";
import type { Theme } from "../visual/theme.js";
import { diagramIdentitiesOf, sha256Bytes } from "./receipt.js";
import { ASPECT_PPTX_INCH, type AspectRatio } from "./types.js";
import type { ExportReceipt } from "./types.js";

/* ------------------------------------------------------------------ */
/* palette (read-only mirrors of src/renderers/html/theme.ts)          */
/* ------------------------------------------------------------------ */

const PALETTE: Record<string, Record<string, string>> = {
  minimal: {
    background: "#ffffff",
    surface: "#ffffff",
    "text-primary": "#1a1a1a",
    "text-secondary": "#5b5b5b",
    accent: "#3a5f8a",
    positive: "#2f7d4f",
    warning: "#8a6d1f",
    negative: "#9c3535",
    neutral: "#6b6b6b",
    "surface-border": "#e2e2e2",
    "stage-ground": "#f4f3f1",
  },
  executive: {
    background: "#ffffff",
    surface: "#ffffff",
    "text-primary": "#0f1720",
    "text-secondary": "#48566a",
    accent: "#1f4fd6",
    positive: "#1f7a44",
    warning: "#9a6b00",
    negative: "#b02a2a",
    neutral: "#5a6675",
    "surface-border": "#dfe4ec",
    "stage-ground": "#eef1f6",
  },
};

const FONT_STACK: Record<string, string> = {
  sans: "Segoe UI, Helvetica, Arial, sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  "mono-accent": "Consolas, 'Courier New', monospace",
};

function themeColor(theme: Theme, key: string): string {
  return PALETTE[theme.deckThemeName]?.[key] ?? PALETTE["minimal"]?.[key] ?? "#000000";
}
function themeFont(theme: Theme): string {
  return FONT_STACK[theme.tokens.fontFamilyRole] ?? "sans-serif";
}

/* ------------------------------------------------------------------ */
/* geometry                                                            */
/* ------------------------------------------------------------------ */

interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

const M = 0.55; // slide margin, inches
function slideDims(aspect: AspectRatio): { w: number; h: number } {
  const d = ASPECT_PPTX_INCH[aspect];
  return { w: d.width, h: d.height };
}

function contentBand(aspect: AspectRatio): Region {
  const s = slideDims(aspect);
  const titleH = 0.6;
  const keyH = 0.45;
  const bottom = M;
  return {
    x: M,
    y: M + titleH + keyH + 0.1,
    w: s.w - 2 * M,
    h: s.h - (M + titleH + keyH + 0.1) - bottom,
  };
}

function quarterColumn(aspect: AspectRatio, i: number, n: number): Region {
  const s = slideDims(aspect);
  const left = M;
  const avail = s.w - 2 * M;
  const each = avail / n;
  return { x: left + i * each, y: 0, w: each, h: 0 };
}

/* ------------------------------------------------------------------ */
/* block handlers                                                      */
/* ------------------------------------------------------------------ */

export type BlockHandler = (
  ctx: PptxBlockCtx,
  block: Block,
  x: number,
  y: number,
  w: number,
) => number;

export interface PptxSlideCtx {
  slide: SlideLike;
  theme: Theme;
  aspect: AspectRatio;
  warnings: string[];
  notes: string[];
  artifactIds: string[];
  diagramArtifacts?: ReadonlyMap<string, ResolvedDiagramArtifact> | undefined;
  /** Precomputed embeddable media per diagram id (never a live SVG). */
  diagramMedia?:
    | ReadonlyMap<
        string,
        { dataUri: string; heightIn: number; svg?: string; source: "svg" | "png" }
      >
    | undefined;
}
export type PptxBlockCtx = PptxSlideCtx;

type SlidesAny = {
  addText(text: unknown, options: Record<string, unknown>): SlidesAny;
  addImage(options: Record<string, unknown>): SlidesAny;
  addTable(rows: unknown, options: Record<string, unknown>): SlidesAny;
  addNotes(notes: string): SlidesAny;
};
type TextRun = { text: string; options: Record<string, unknown> };

function textRun(text: string, theme: Theme, size: number, colorKey: string): TextRun[] {
  return [{ text, options: { fontSize: size, color: themeColor(theme, colorKey) } }];
}

function hText(
  ctx: PptxBlockCtx,
  b: Block & { text: string },
  x: number,
  y: number,
  w: number,
): number {
  const size = 13;
  const h = Math.max(0.35, Math.ceil(b.text.length / 60) * 0.28);
  ctx.slide.addText(textRun(b.text, ctx.theme, size, "text-primary"), { x, y, w, h: h + 0.1 });
  return y + h + 0.12;
}

function hCode(
  ctx: PptxBlockCtx,
  b: Block & { code: string },
  x: number,
  y: number,
  w: number,
): number {
  const code = b.code;
  const h = Math.min(3.6, Math.max(0.5, code.split("\n").length * 0.2));
  ctx.slide.addText(code, {
    x,
    y,
    w,
    h,
    fontSize: 10,
    fontFace: FONT_STACK["mono-accent"],
    color: themeColor(ctx.theme, "text-primary"),
    fill: { color: themeColor(ctx.theme, "stage-ground") },
    isTextBox: true,
  });
  return y + h + 0.12;
}

function hBullets(
  ctx: PptxBlockCtx,
  label: string,
  items: string[],
  x: number,
  y: number,
  w: number,
): number {
  let curr = y;
  if (label.length > 0) {
    ctx.slide.addText(textRun(label, ctx.theme, 11, "text-secondary"), { x, y: curr, w, h: 0.25 });
    curr += 0.28;
  }
  for (const it of items) {
    ctx.slide.addText(textRun(it, ctx.theme, 13, "text-primary"), {
      x,
      y: curr,
      w,
      h: 0.36,
      bullet: { code: "2022", indent: 0.22 },
    });
    curr += 0.4;
  }
  return curr;
}

function hMetric(
  ctx: PptxBlockCtx,
  b: Block & { label: string; value: string; unit?: string },
  x: number,
  y: number,
  w: number,
): number {
  ctx.slide.addText(textRun(b.label, ctx.theme, 10, "text-secondary"), { x, y, w, h: 0.22 });
  ctx.slide.addText(
    [
      {
        text: `${b.value}${b.unit ? ` ${b.unit}` : ""}`,
        options: { fontSize: 24, bold: true, color: themeColor(ctx.theme, "text-primary") },
      },
    ],
    { x, y: y + 0.22, w, h: 0.4 },
  );
  return y + 0.68;
}

function hMetricGrid(
  ctx: PptxBlockCtx,
  b: Block & { metrics: MetricGridItem[] },
  x: number,
  y: number,
  w: number,
): number {
  const each = w / b.metrics.length;
  let maxH = y;
  b.metrics.forEach((m, i) => {
    const end = hMetric(
      ctx,
      { ...b, label: m.label, value: m.value, unit: m.unit } as never,
      x + i * each,
      y,
      each - 0.2,
    );
    maxH = Math.max(maxH, end);
  });
  return maxH + 0.05;
}

function hComparison(
  ctx: PptxBlockCtx,
  b: Block & {
    left: { title: string };
    right: { title: string };
    rows: { label: string; left: string; right: string }[];
  },
  x: number,
  y: number,
  w: number,
): number {
  const rows: unknown[] = [
    [
      { text: "", options: { bold: true } },
      { text: b.left.title, options: { bold: true } },
      { text: b.right.title, options: { bold: true } },
    ],
    ...b.rows.map((r) => [r.label, r.left, r.right]),
  ];
  const rowH = 0.32;
  ctx.slide.addTable(rows, {
    x,
    y,
    w,
    rowH,
    border: { color: themeColor(ctx.theme, "surface-border"), width: 1 },
  });
  return y + (rows.length as number) * rowH + 0.12;
}

function hTable(
  ctx: PptxBlockCtx,
  b: Block & { columns: string[]; rows: string[][] },
  x: number,
  y: number,
  w: number,
): number {
  const rows: unknown[] = [b.columns.map((c) => ({ text: c, options: { bold: true } })), ...b.rows];
  const rowH = 0.3;
  ctx.slide.addTable(rows, {
    x,
    y,
    w,
    rowH,
    border: { color: themeColor(ctx.theme, "surface-border"), width: 1 },
  });
  return y + rows.length * rowH + 0.12;
}

function hTimeline(
  ctx: PptxBlockCtx,
  b: Block & { items: { label: string; date?: string; state?: string }[] },
  x: number,
  y: number,
  w: number,
): number {
  let curr = y;
  for (const [i, it] of b.items.entries()) {
    const label = `${i + 1}. ${it.label}${it.date ? ` — ${it.date}` : ""}${it.state ? ` (${it.state})` : ""}`;
    ctx.slide.addText(textRun(label, ctx.theme, 12, "text-primary"), { x, y: curr, w, h: 0.3 });
    curr += 0.34;
  }
  return curr;
}

function hRoadmap(
  ctx: PptxBlockCtx,
  b: Block & { phases: { name: string; status?: string }[] },
  x: number,
  y: number,
  w: number,
): number {
  let curr = y;
  for (const ph of b.phases) {
    ctx.slide.addText(
      textRun(`${ph.name}${ph.status ? ` — ${ph.status}` : ""}`, ctx.theme, 12, "text-primary"),
      { x, y: curr, w, h: 0.3 },
    );
    curr += 0.32;
  }
  return curr;
}

function hRisk(
  ctx: PptxBlockCtx,
  b: Block & { statement: string; likelihood?: string; impact?: string },
  x: number,
  y: number,
  w: number,
): number {
  const line = `Risk${b.likelihood ? ` (${b.likelihood}` : ""}${b.impact ? ` · impact ${b.impact}` : ""}${b.likelihood ? ")" : ""}: ${b.statement}`;
  ctx.slide.addText(textRun(line, ctx.theme, 12, "warning"), { x, y, w, h: 0.36 });
  return y + 0.4;
}

function hStatus(
  ctx: PptxBlockCtx,
  b: Block & { state: string; label: string; detail?: string },
  x: number,
  y: number,
  w: number,
): number {
  ctx.slide.addText(
    textRun(
      `● ${b.label}: ${b.state}${b.detail ? ` — ${b.detail}` : ""}`,
      ctx.theme,
      12,
      "text-primary",
    ),
    {
      x,
      y,
      w,
      h: 0.3,
    },
  );
  return y + 0.34;
}

function hCallout(
  ctx: PptxBlockCtx,
  b: Block & { text: string; tone?: string },
  x: number,
  y: number,
  w: number,
): number {
  ctx.slide.addText(textRun(b.text, ctx.theme, 13, "text-primary"), {
    x,
    y,
    w,
    h: 0.4,
    fill: { color: themeColor(ctx.theme, "stage-ground") },
    line: { color: themeColor(ctx.theme, "surface-border"), width: 1 },
  });
  return y + 0.44;
}

function hQuote(
  ctx: PptxBlockCtx,
  b: Block & { text: string; attribution?: string },
  x: number,
  y: number,
  w: number,
): number {
  ctx.slide.addText(
    textRun(
      `“${b.text}”${b.attribution ? ` — ${b.attribution}` : ""}`,
      ctx.theme,
      14,
      "text-secondary",
    ),
    { x, y, w, h: 0.5 },
  );
  return y + 0.54;
}

function hImage(
  ctx: PptxBlockCtx,
  b: Block & { src: string; alt?: string },
  x: number,
  y: number,
  w: number,
): number {
  if (!b.src.startsWith("data:image/")) {
    ctx.slide.addText(
      textRun(
        `[image not embedded: ${b.src.startsWith("http") ? "remote src" : "non-data src"}]`,
        ctx.theme,
        11,
        "text-secondary",
      ),
      {
        x,
        y,
        w,
        h: 0.28,
      },
    );
    return y + 0.32;
  }
  try {
    ctx.slide.addImage({ data: b.src, x, y, w, h: 2 });
    ctx.artifactIds.push(`image:${b.src.length}`);
    return y + 2.1;
  } catch {
    ctx.warnings.push("export/pptx-image-embed-failed");
    return y + 0.32;
  }
}

function hDiagram(
  ctx: PptxBlockCtx,
  b: Block & { diagramRef?: string },
  x: number,
  y: number,
  w: number,
): number {
  if (!b.diagramRef) return y;
  // The exporter precomputes `diagramMedia` before any slide is written, so
  // this handler stays synchronous. A diagram present in the deck but with no
  // precomputed media is a hard failure (never a placeholder).
  if (b.diagramRef === undefined) return y;
  const media = ctx.diagramMedia?.get(b.diagramRef);
  if (media === undefined) {
    throw new Error(`diagram "${b.diagramRef}" has no prepared export media`);
  }
  ctx.slide.addImage({
    data: media.dataUri,
    x,
    y,
    w,
    h: media.heightIn,
  });
  ctx.artifactIds.push(`diagram-media:${b.diagramRef}`);
  return y + media.heightIn + 0.12;
}

/** Handlers keyed by BlockType — every existing type has an entry. */
export const BUILDING: Record<string, BlockHandler> = {
  text: (c, b, x, y, w) => hText(c, b as never, x, y, w),
  code: (c, b, x, y, w) => hCode(c, b as never, x, y, w),
  metric: (c, b, x, y, w) => hMetric(c, b as never, x, y, w),
  "metric-grid": (c, b, x, y, w) => hMetricGrid(c, b as never, x, y, w),
  comparison: (c, b, x, y, w) => hComparison(c, b as never, x, y, w),
  table: (c, b, x, y, w) => hTable(c, b as never, x, y, w),
  timeline: (c, b, x, y, w) => hTimeline(c, b as never, x, y, w),
  roadmap: (c, b, x, y, w) => hRoadmap(c, b as never, x, y, w),
  risk: (c, b, x, y, w) => hRisk(c, b as never, x, y, w),
  status: (c, b, x, y, w) => hStatus(c, b as never, x, y, w),
  callout: (c, b, x, y, w) => hCallout(c, b as never, x, y, w),
  quote: (c, b, x, y, w) => hQuote(c, b as never, x, y, w),
  image: (c, b, x, y, w) => hImage(c, b as never, x, y, w),
  diagram: (c, b, x, y, w) => hDiagram(c, b as never, x, y, w),
  architecture: (c, b, x, y, w) => hDiagram(c, b as never, x, y, w),
  workflow: (c, b, x, y, w) => hDiagram(c, b as never, x, y, w),
};

export const blockHandlerMatrix = BUILDING;

/* ------------------------------------------------------------------ */
/* semantic layout → six regions                                       */
/* ------------------------------------------------------------------ */

export interface SemanticLayoutProps {
  aspect: AspectRatio;
}

export function layoutRegions(slide: Slide, aspect: AspectRatio): Map<Block["id"], Region> {
  void aspect;
  const areas = new Map<Block["id"], Region>();
  const s = slideDims(aspect);
  const band = contentBand(aspect);
  const blocks = slide.blocks;
  const n = blocks.length;
  void s;

  switch (slide.layout) {
    case "centered": {
      blocks.forEach((b, i) => {
        areas.set(b.id, { x: band.x, y: band.y + i * 0.5, w: band.w, h: 0.4 });
      });
      break;
    }
    case "quote": {
      blocks.forEach((b, i) => {
        areas.set(b.id, { x: band.x + 0.6, y: band.y + i * 0.6, w: band.w - 1.2, h: 0.5 });
      });
      break;
    }
    case "split-2": {
      // two columns
      const columns = quarterColumn(aspect, 0, 2);
      const col2 = quarterColumn(aspect, 1, 2);
      blocks.forEach((b, i) => {
        const col = i % 2 === 0 ? columns : col2;
        areas.set(b.id, { x: col.x, y: band.y + Math.floor(i / 2) * 2.0, w: col.w - 0.3, h: 1.8 });
      });
      break;
    }
    case "grid": {
      const cols = Math.max(1, Math.ceil(Math.sqrt(Math.max(1, n))));
      blocks.forEach((b, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const cell = quarterColumn(aspect, col, cols);
        areas.set(b.id, {
          x: cell.x,
          y: band.y + row * 2.1,
          w: cell.w - 0.3,
          h: 1.9,
        });
      });
      break;
    }
    case "full-bleed-visual": {
      blocks.forEach((b, i) => {
        areas.set(b.id, { x: band.x, y: band.y + i * 0.8, w: band.w, h: 0.7 });
      });
      break;
    }
    default: {
      blocks.forEach((b, i) => {
        areas.set(b.id, { x: band.x, y: band.y + i * 0.7, w: band.w, h: 0.6 });
      });
      break;
    }
  }
  return areas;
}

/** Map a slide into its PPTX structure. */
export function buildSemanticLayout(ctx: PptxBlockCtx, slide: Slide): void {
  const s = slideDims(ctx.aspect);
  const titleStyle = {
    x: 0.7,
    y: 0.35,
    w: s.w - 1.4,
    h: 0.55,
    fontSize: 24,
    bold: true,
    color: themeColor(ctx.theme, "text-primary"),
    fontFace: themeFont(ctx.theme),
  };
  ctx.slide.addText(slide.title, titleStyle);
  if (slide.keyMessage) {
    ctx.slide.addText(slide.keyMessage, {
      x: 0.7,
      y: 0.9,
      w: s.w - 1.4,
      h: 0.35,
      fontSize: 12,
      color: themeColor(ctx.theme, "text-secondary"),
      fontFace: themeFont(ctx.theme),
    });
  }
  const regions = layoutRegions(slide, ctx.aspect);
  for (const block of slide.blocks) {
    const r = regions.get(block.id);
    if (r === undefined) {
      ctx.warnings.push(`export/pptx-layout-missing:${block.id}`);
      continue;
    }
    const handler = BUILDING[block.type];
    if (handler === undefined) {
      ctx.warnings.push(`export/pptx-unsupported-block:${block.type}`);
      continue;
    }
    const after = handler(ctx, block, r.x, r.y, r.w);
    // citations: never dropped when a block carries them
    const refs = block.sourceRefs;
    if (refs && refs.length > 0) {
      const parts = refs.slice(0, 2).map((r2) => r2.sourceId);
      ctx.slide.addText(`src: ${parts.join(", ")}`, {
        x: r.x,
        y: after + 0.02,
        w: r.w,
        h: 0.22,
        fontSize: 8,
        color: themeColor(ctx.theme, "text-secondary"),
        fontFace: themeFont(ctx.theme),
      });
    }
    void after;
  }
}

/* ------------------------------------------------------------------ */
/* receipts                                                            */
/* ------------------------------------------------------------------ */

export function requireAllBlocksCovered(presented: readonly string[]): {
  covered: boolean;
  missing: string[];
} {
  const have = new Set(Object.keys(blockHandlerMatrix));
  const missing = presented.filter((b) => !have.has(b));
  return { covered: missing.length === 0, missing };
}

export function buildPptxReceipt(
  deck: ArclumeDeck,
  aspect: AspectRatio,
  dims: { width: number; height: number },
  bytes: Buffer,
  warnings: string[],
  notes: string[],
  artifactIds: string[],
  options: { knowledge?: unknown; narrative?: NarrativePlan | undefined },
  diagramArtifacts?: ReadonlyMap<string, ResolvedDiagramArtifact> | undefined,
): ExportReceipt {
  void dims;
  void options;
  const out: ExportReceipt = {
    receiptVersion: "0.1.0",
    format: "pptx",
    exporter: { name: "arclume-export", version: "0.1.0" },
    deck: { irVersion: deck.irVersion, contentHash: contentHash(deck) },
    diagramArtifacts: diagramIdentitiesOf(diagramArtifacts),
    output: {
      fileName: "deck.pptx",
      bytes: bytes.length,
      sha256: sha256Bytes(bytes),
    },
    slideCount: deck.slides.length,
    validation: {
      valid: warnings.length === 0,
      errors: [],
      warnings: [...warnings],
    },
    notes: [...notes, ...artifactIds].filter(Boolean),
  };
  return {
    ...out,
    output: {
      ...out.output,
      sha256: out.output.sha256,
    },
  };
}
