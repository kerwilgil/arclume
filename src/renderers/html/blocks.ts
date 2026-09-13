/**
 * Block rendering — an exhaustive switch over the 16 Phase 1 block types.
 *
 * The renderer only lays out and styles. It never rewrites a value, never
 * summarises, never invents text, never computes a metric direction, never
 * drops a block silently. Every string from the block is escaped.
 */

import type { ResolvedDiagramArtifact } from "../../engines/types.js";
import type {
  Block,
  CalloutBlock,
  CodeBlock,
  ComparisonBlock,
  ImageBlock,
  MetricBlock,
  MetricGridBlock,
  MetricGridItem,
  QuoteBlock,
  RiskBlock,
  RoadmapBlock,
  StatusBlock,
  TableBlock,
  TextBlock,
  TimelineBlock,
} from "../../types/blocks.js";
import type { ArchitectureBlock, DiagramBlock, WorkflowBlock } from "../../types/blocks.js";
import type { DiagramIR } from "../../types/deck.js";
import { renderDiagram } from "./diagrams.js";
import { escapeHtml, isSafeId, safeIdList, safeImageDataUri, safeLanguage } from "./escape.js";
import type { HtmlRenderWarning } from "./types.js";

export interface BlockRenderContext {
  diagramsById: Map<string, DiagramIR>;
  diagramArtifacts?: ReadonlyMap<string, ResolvedDiagramArtifact> | undefined;
}
export interface BlockRenderOutcome {
  html: string;
  warnings: HtmlRenderWarning[];
}

function assertNever(x: never): never {
  throw new Error(`arclume html renderer: unhandled block type ${JSON.stringify(x)}`);
}

const DIR_CLASS: Record<string, string> = {
  "up-good": "is-up-good",
  "down-good": "is-down-good",
  neutral: "is-neutral",
};
const DIR_GLYPH: Record<string, string> = {
  "up-good": "▲",
  "down-good": "▼",
  neutral: "→",
};

function metricInner(m: MetricBlock | MetricGridItem): string {
  const unit = m.unit ? `<span class="arclume-metric-unit">${escapeHtml(m.unit)}</span>` : "";
  const delta =
    m.delta !== undefined
      ? `<span class="arclume-metric-delta ${
          m.direction ? (DIR_CLASS[m.direction] ?? "") : ""
        }">${m.direction ? `${escapeHtml(DIR_GLYPH[m.direction] ?? "")} ` : ""}${escapeHtml(
          m.delta,
        )}</span>`
      : "";
  const metricAttr =
    "metricId" in m && isSafeId(m.metricId) ? ` data-metric-id="${m.metricId}"` : "";
  return `<div class="arclume-metric"${metricAttr}><span class="arclume-metric-value">${escapeHtml(m.value)}${unit}</span><span class="arclume-metric-label">${escapeHtml(m.label)}</span>${delta}</div>`;
}

function renderText(b: TextBlock): string {
  const fmt = b.format === "markdown" ? ` data-format="markdown"` : "";
  return `<p class="arclume-text"${fmt}>${escapeHtml(b.text)}</p>`;
}

function renderMetricGrid(b: MetricGridBlock): string {
  return `<div class="arclume-metric-grid">${(b.metrics ?? []).map(metricInner).join("")}</div>`;
}

function renderComparison(b: ComparisonBlock): string {
  const head = `<div class="is-head"></div><div class="is-head">${escapeHtml(b.left?.title ?? "")}${
    b.left?.note ? ` <small>${escapeHtml(b.left.note)}</small>` : ""
  }</div><div class="is-head">${escapeHtml(b.right?.title ?? "")}${
    b.right?.note ? ` <small>${escapeHtml(b.right.note)}</small>` : ""
  }</div>`;
  const rows = (b.rows ?? [])
    .map(
      (r) =>
        `<div>${escapeHtml(r.label)}</div><div>${escapeHtml(r.left)}</div><div>${escapeHtml(
          r.right,
        )}</div>`,
    )
    .join("");
  return `<div class="arclume-comparison">${head}${rows}</div>`;
}

function renderTimeline(b: TimelineBlock): string {
  const items = (b.items ?? [])
    .map((it) => {
      const when = it.date
        ? `<span class="when">${escapeHtml(it.date)}</span>`
        : `<span class="when"></span>`;
      const detail = it.detail ? `<br><span class="detail">${escapeHtml(it.detail)}</span>` : "";
      const state = it.state ? ` <span class="state">${escapeHtml(it.state)}</span>` : "";
      const idAttr = isSafeId(it.id) ? ` data-item-id="${it.id}"` : "";
      return `<li${idAttr}>${when}<span>${escapeHtml(it.label)}${state}${detail}</span></li>`;
    })
    .join("");
  return `<ol class="arclume-timeline">${items}</ol>`;
}

function renderRoadmap(b: RoadmapBlock): string {
  const items = (b.phases ?? [])
    .map((p) => {
      const status = p.status ? ` <span class="status">${escapeHtml(p.status)}</span>` : "";
      const span = [p.start, p.end].filter(Boolean).map(String).join(" → ");
      const spanEl = span ? `<div class="status">${escapeHtml(span)}</div>` : "";
      const sub = (p.items ?? []).length
        ? `<ul>${(p.items ?? []).map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>`
        : "";
      const idAttr = isSafeId(p.id) ? ` data-item-id="${p.id}"` : "";
      return `<li${idAttr}><strong>${escapeHtml(p.name)}</strong>${status}${spanEl}${sub}</li>`;
    })
    .join("");
  return `<ul class="arclume-roadmap">${items}</ul>`;
}

function renderRisk(b: RiskBlock): string {
  const ft = escapeHtml(b.factType);
  const kv: string[] = [];
  if (b.likelihood) kv.push(`likelihood: ${escapeHtml(b.likelihood)}`);
  if (b.impact) kv.push(`impact: ${escapeHtml(b.impact)}`);
  const kvEl = kv.length ? `<div class="arclume-kv">${kv.join(" · ")}</div>` : "";
  const mit = b.mitigation
    ? `<p class="arclume-text"><em>Mitigation:</em> ${escapeHtml(b.mitigation)}</p>`
    : "";
  const riskAttr = isSafeId(b.riskId) ? ` data-risk-id="${b.riskId}"` : "";
  return `<div class="arclume-risk"${riskAttr}><span class="arclume-badge fact-${ft}">${ft}</span><p class="arclume-text">${escapeHtml(b.statement)}</p>${kvEl}${mit}</div>`;
}

function renderStatus(b: StatusBlock): string {
  const detail = b.detail ? ` — <span>${escapeHtml(b.detail)}</span>` : "";
  return `<p class="arclume-status state-${escapeHtml(b.state)}"><span class="arclume-status-dot" aria-hidden="true"></span><span>${escapeHtml(b.label)} <small>(${escapeHtml(b.state)})</small>${detail}</span></p>`;
}

function renderCallout(b: CalloutBlock): string {
  return `<div class="arclume-callout tone-${escapeHtml(b.tone)}"><p class="arclume-text">${escapeHtml(
    b.text,
  )}</p></div>`;
}

function renderQuote(b: QuoteBlock): string {
  const attr = b.attribution ? `<footer>— ${escapeHtml(b.attribution)}</footer>` : "";
  return `<blockquote class="arclume-quote"><p>${escapeHtml(b.text)}</p>${attr}</blockquote>`;
}

function renderTable(b: TableBlock): string {
  const cols = b.columns ?? [];
  const thead = `<thead><tr>${cols.map((c) => `<th scope="col">${escapeHtml(c)}</th>`).join("")}</tr></thead>`;
  const tbody = `<tbody>${(b.rows ?? [])
    .map((row) => `<tr>${(row ?? []).map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`)
    .join("")}</tbody>`;
  return `<div class="arclume-table-wrap"><table class="arclume-table">${thead}${tbody}</table></div>`;
}

function renderImage(b: ImageBlock): BlockRenderOutcome {
  const safe = safeImageDataUri(b.src);
  if (safe) {
    const fit = b.fit === "cover" ? "cover" : "contain";
    return {
      html: `<img class="arclume-image" src="${escapeHtml(safe)}" alt="${escapeHtml(
        b.alt,
      )}" style="object-fit:${fit}" loading="lazy" decoding="async">`,
      warnings: [],
    };
  }
  return {
    html: `<figure class="arclume-image-missing" role="img" aria-label="${escapeHtml(b.alt)}"><p>Image not embedded — kept out to preserve an offline, self-contained document.</p><p><small>${escapeHtml(b.alt)}</small></p></figure>`,
    warnings: [
      {
        code: "render/image-external-not-embedded",
        message:
          "an image block references an external or non-embedded source; showing a labelled placeholder",
      },
    ],
  };
}

function renderCode(b: CodeBlock): string {
  const lang = safeLanguage(b.language);
  const cls = lang ? ` class="language-${lang}"` : "";
  const data = lang ? ` data-language="${lang}"` : "";
  return `<pre class="arclume-code"${data}><code${cls}>${escapeHtml(b.code)}</code></pre>`;
}

function renderDiagramBlock(
  b: DiagramBlock | ArchitectureBlock | WorkflowBlock,
  ctx: BlockRenderContext,
): BlockRenderOutcome {
  const dir = typeof b.diagramRef === "string" ? ctx.diagramsById.get(b.diagramRef) : undefined;
  if (!dir) {
    return {
      html: `<div class="arclume-diagram-fallback">Diagram "${escapeHtml(
        String(b.diagramRef),
      )}" not found in deck.diagrams.</div>`,
      warnings: [
        {
          code: "render/diagram-ref-missing",
          message: `${b.type} block references diagram "${String(b.diagramRef)}" which is not in deck.diagrams`,
          blockId: isSafeId(b.id) ? b.id : undefined,
        },
      ],
    };
  }
  return renderDiagram(dir, ctx.diagramArtifacts);
}

/** Render one block, wrapped with its provenance-carrying container. */
export function renderBlock(block: Block, ctx: BlockRenderContext): BlockRenderOutcome {
  let inner: string;
  let warnings: HtmlRenderWarning[] = [];

  switch (block.type) {
    case "text":
      inner = renderText(block);
      break;
    case "metric":
      inner = metricInner(block);
      break;
    case "metric-grid":
      inner = renderMetricGrid(block);
      break;
    case "comparison":
      inner = renderComparison(block);
      break;
    case "timeline":
      inner = renderTimeline(block);
      break;
    case "roadmap":
      inner = renderRoadmap(block);
      break;
    case "risk":
      inner = renderRisk(block);
      break;
    case "status":
      inner = renderStatus(block);
      break;
    case "callout":
      inner = renderCallout(block);
      break;
    case "quote":
      inner = renderQuote(block);
      break;
    case "table":
      inner = renderTable(block);
      break;
    case "image": {
      const r = renderImage(block);
      inner = r.html;
      warnings = r.warnings;
      break;
    }
    case "code":
      inner = renderCode(block);
      break;
    case "diagram":
    case "architecture":
    case "workflow": {
      const r = renderDiagramBlock(block, ctx);
      inner = r.html;
      warnings = r.warnings;
      break;
    }
    default:
      return assertNever(block);
  }

  const idAttr = isSafeId(block.id) ? ` data-block-id="${block.id}"` : "";
  const emphasis = block.emphasis ? " is-emphasis" : "";
  const srcIds = safeIdList(block.sourceRefs?.map((r) => r.sourceId));
  const srcAttr = srcIds
    ? ` data-source-ids="${srcIds}" data-source-count="${block.sourceRefs?.length ?? 0}"`
    : "";
  const caption = block.caption
    ? `<p class="arclume-block-caption">${escapeHtml(block.caption)}</p>`
    : "";
  const warn = warnings.map((w) => ({
    ...w,
    blockId: w.blockId ?? (isSafeId(block.id) ? block.id : undefined),
  }));
  return {
    html: `<div class="arclume-block arclume-block-${block.type}${emphasis}" data-block-type="${block.type}"${idAttr}${srcAttr}>${inner}${caption}</div>`,
    warnings: warn,
  };
}
