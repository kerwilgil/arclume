/**
 * Block builders (Phase 4).
 *
 * Each builder turns *already-resolved* knowledge into one or more `Block`s for
 * the `ArclumeDeck`. Rules (per the Phase 4 brief):
 *  - serializable, deterministic, bounded, evidence-backed, renderer-independent;
 *  - no DOM / HTML / CSS / pixels;
 *  - never invent a metric, relation, phase or value; when the specific
 *    knowledge is missing, fall back to a factual `text` / `callout` block.
 *
 * Provenance: a block that presents knowledge carries the ids that make it
 * traceable — `metricId` / `riskId` / timeline item `id` / roadmap phase `id` —
 * plus a deduplicated, capped `sourceRefs` union of the items it shows.
 */

import {
  type KnowledgeItem,
  type KnowledgeView,
  firstSentence,
  phraseList,
} from "../narrative/knowledge-view.js";
import type { PlannedSlide, PlanningNote } from "../planning/types.js";
import type {
  Block,
  ComparisonBlock,
  MetricGridItem,
  RiskBlock,
  RoadmapPhase,
  TimelineItem,
} from "../types/blocks.js";
import type { Id, SourceRef } from "../types/common.js";
import { buildTimelineModel } from "./models.js";
import type { VisualKind, VisualLimits } from "./types.js";

const SOURCE_REF_CAP = 8;

export interface BlockBuildInput {
  slide: PlannedSlide;
  view: KnowledgeView;
  visualKind: VisualKind;
  limits: VisualLimits;
  mintId: (base: string) => string;
}

export interface BlockBuildResult {
  blocks: Block[];
  notes: PlanningNote[];
  /** Set when the visual is a structural diagram
   * (architecture / process / sequence / dataflow / lifecycle). */
  wantsDiagram: boolean;
}

function dedupeRefs(refs: readonly SourceRef[]): SourceRef[] {
  const seen = new Set<string>();
  const out: SourceRef[] = [];
  for (const r of refs) {
    if (!r || typeof r.sourceId !== "string") continue;
    const key = JSON.stringify([r.sourceId, r.locator ?? null, r.quote ?? null]);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
    if (out.length >= SOURCE_REF_CAP) break;
  }
  return out;
}

function clamp(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

function resolve(view: KnowledgeView, ids: readonly Id[]): KnowledgeItem[] {
  const out: KnowledgeItem[] = [];
  const seen = new Set<Id>();
  for (const id of ids) {
    if (seen.has(id)) continue;
    const item = view.byId.get(id);
    if (item) {
      out.push(item);
      seen.add(id);
    }
  }
  return out;
}

function refsOf(slide: PlannedSlide): Id[] {
  return [...new Set([...slide.knowledgeRefs, ...(slide.visualCandidates ?? [])])];
}

function withRefs(block: Block, refs: SourceRef[]): Block {
  const deduped = dedupeRefs(refs);
  if (deduped.length > 0) (block as { sourceRefs?: SourceRef[] }).sourceRefs = deduped;
  return block;
}

/* ------------------------------------------------------------------ */

function textBlock(input: BlockBuildInput, items: KnowledgeItem[]): Block[] {
  const { view, slide, limits, mintId } = input;
  const p = view.knowledge.project;
  const lead =
    firstSentence(p.purpose ?? p.summary ?? p.solution) ??
    (items.length > 0
      ? phraseList(
          items.map((i) => i.text),
          3,
        )
      : slide.keyMessage);
  const body =
    items.length > 0
      ? phraseList(
          items.map((i) => i.text),
          Math.min(items.length, limits.maxItemsPerBlock),
        )
      : "";
  const text = clamp(
    [lead, body].filter((s) => s && s.length > 0).join(" — "),
    limits.maxTextBlockChars,
  );
  return [
    withRefs(
      {
        id: mintId("txt"),
        type: "text",
        text: text.length > 0 ? text : slide.keyMessage,
        format: "plain",
      },
      items.flatMap((i) => i.sourceRefs),
    ),
  ];
}

function metricsBlocks(input: BlockBuildInput, items: KnowledgeItem[]): Block[] {
  const { slide, view, limits, mintId } = input;
  const metrics = items
    .filter((i) => i.collection === "metrics" && typeof i.raw["value"] === "string")
    .slice(0, limits.maxMetricsPerGrid);

  if (metrics.length >= 2) {
    const gridItems: MetricGridItem[] = metrics.map((m) => {
      const item: MetricGridItem = {
        label: clamp(m.text, 240),
        value: clamp(String(m.raw["value"]), 240),
        metricId: m.id,
      };
      if (typeof m.raw["unit"] === "string") item.unit = clamp(m.raw["unit"] as string, 240);
      if (
        m.raw["direction"] === "up-good" ||
        m.raw["direction"] === "down-good" ||
        m.raw["direction"] === "neutral"
      ) {
        item.direction = m.raw["direction"];
      }
      return item;
    });
    return [
      withRefs(
        { id: mintId("mtr"), type: "metric-grid", metrics: gridItems },
        metrics.flatMap((m) => m.sourceRefs),
      ),
    ];
  }
  if (metrics.length === 1) {
    const m = metrics[0] as KnowledgeItem;
    const block: Block = {
      id: mintId("mtr"),
      type: "metric",
      label: clamp(m.text, 240),
      value: clamp(String(m.raw["value"]), 240),
    };
    if (typeof m.raw["unit"] === "string") block.unit = clamp(m.raw["unit"] as string, 240);
    if (
      m.raw["direction"] === "up-good" ||
      m.raw["direction"] === "down-good" ||
      m.raw["direction"] === "neutral"
    ) {
      block.direction = m.raw["direction"];
    }
    block.metricId = m.id;
    return [withRefs(block, m.sourceRefs)];
  }
  // metrics intent accepted on a FACT claim only — show it, do not fake a metric
  const fact =
    resolve(view, slide.claimRefs).find((c) => c.factType === "FACT") ??
    resolve(view, slide.claimRefs)[0];
  if (fact) {
    return [
      withRefs(
        { id: mintId("cal"), type: "callout", tone: "success", text: clamp(fact.text, 1200) },
        fact.sourceRefs,
      ),
    ];
  }
  return textBlock(input, items);
}

function comparisonBlock(input: BlockBuildInput, items: KnowledgeItem[]): Block[] {
  const { mintId } = input;
  const m = items.find(
    (i) =>
      i.collection === "metrics" &&
      typeof i.raw["value"] === "string" &&
      typeof i.raw["baseline"] === "string",
  );
  if (!m) return textBlock(input, items);
  const unit = typeof m.raw["unit"] === "string" ? ` ${m.raw["unit"]}` : "";
  const block: ComparisonBlock = {
    id: mintId("cmp"),
    type: "comparison",
    left: { title: "Baseline" },
    right: { title: "Now" },
    rows: [
      {
        label: clamp(m.text, 240),
        left: clamp(String(m.raw["baseline"]), 240),
        right: clamp(`${m.raw["value"]}${unit}`, 240),
      },
    ],
  };
  return [withRefs(block, m.sourceRefs)];
}

function relationshipBlocks(input: BlockBuildInput, items: KnowledgeItem[]): Block[] {
  const { limits, mintId } = input;
  const rels = items.filter((i) => i.collection === "relations").slice(0, limits.maxTableRows);
  if (rels.length === 0) return textBlock(input, items);
  const columns = ["From", "Link", "To"];
  const rows = rels.map((r) => [
    clamp(String(r.raw["from"] ?? ""), 400),
    clamp(String(r.raw["type"] ?? "RELATES_TO"), 400),
    clamp(String(r.raw["to"] ?? ""), 400),
  ]);
  return [
    withRefs(
      { id: mintId("tbl"), type: "table", columns, rows },
      rels.flatMap((r) => r.sourceRefs),
    ),
  ];
}

function timelineBlocks(input: BlockBuildInput): Block[] {
  const { slide, view, limits, mintId } = input;
  const model = buildTimelineModel(view, refsOf(slide), "timeline", limits);
  if (!model || model.kind !== "timeline") return textBlock(input, resolve(view, refsOf(slide)));
  const items: TimelineItem[] = model.items.map((t) => {
    const item: TimelineItem = { id: t.ref, label: clamp(t.label, 240) };
    if (t.date) item.date = clamp(t.date, 64);
    if (t.state) item.state = t.state;
    return item;
  });
  return [withRefs({ id: mintId("tml"), type: "timeline", items }, model.sourceRefs)];
}

function roadmapBlocks(input: BlockBuildInput): Block[] {
  const { slide, view, limits, mintId } = input;
  const model = buildTimelineModel(view, refsOf(slide), "roadmap", limits);
  if (!model || model.kind !== "roadmap") return textBlock(input, resolve(view, refsOf(slide)));
  const phases: RoadmapPhase[] = model.items.map((t) => {
    const phase: RoadmapPhase = { id: t.ref, name: clamp(t.label, 240) };
    if (t.status) phase.status = t.status;
    if (t.date) phase.start = clamp(t.date, 64);
    return phase;
  });
  return [withRefs({ id: mintId("rmp"), type: "roadmap", phases }, model.sourceRefs)];
}

function riskBlocks(input: BlockBuildInput, items: KnowledgeItem[]): Block[] {
  const { mintId } = input;
  const risks = items.filter((i) => i.collection === "risks");
  const source = risks.length > 0 ? risks : items.filter((i) => i.collection === "gaps");
  if (source.length === 0) return textBlock(input, items);
  const top = [...source]
    .sort((a, b) => {
      const rank = (x: unknown): number =>
        x === "high" ? 3 : x === "medium" ? 2 : x === "low" ? 1 : 0;
      return (
        rank(b.raw["impact"]) * 2 +
        rank(b.raw["likelihood"]) -
        (rank(a.raw["impact"]) * 2 + rank(a.raw["likelihood"]))
      );
    })
    .slice(0, Math.min(3, input.limits.maxBlocksPerSlide - 1 || 1));
  return top.map((r) => {
    const isRisk = r.collection === "risks";
    const block: RiskBlock = {
      id: mintId("rsk"),
      type: "risk",
      statement: clamp(isRisk ? r.text : `Open question: ${r.text}`, 2000),
      factType: isRisk && typeof r.factType === "string" ? r.factType : "UNKNOWN",
    };
    if (
      r.raw["likelihood"] === "low" ||
      r.raw["likelihood"] === "medium" ||
      r.raw["likelihood"] === "high"
    ) {
      block.likelihood = r.raw["likelihood"];
    }
    if (r.raw["impact"] === "low" || r.raw["impact"] === "medium" || r.raw["impact"] === "high") {
      block.impact = r.raw["impact"];
    }
    if (typeof r.raw["mitigation"] === "string")
      block.mitigation = clamp(r.raw["mitigation"] as string, 2000);
    block.riskId = r.id;
    return withRefs(block, r.sourceRefs);
  });
}

/**
 * `StatusBlock` reports the **real** workflow facts (phase status counts, active
 * phase, open questions, `project.status`). It never infers a traffic-light
 * health rating: `ProjectKnowledge` carries no health / RAG signal, so
 * `state` stays `"unknown"`. (A derived RAG rating would need an explicit
 * `derived: true` + `basisRefs[]` contract — deferred, not added here.)
 */
function statusBlocks(input: BlockBuildInput, items: KnowledgeItem[]): Block[] {
  const { view, mintId } = input;
  const p = view.knowledge.project;
  const phases = items.filter((i) => i.collection === "phases");
  const gaps = items.filter((i) => i.collection === "gaps");

  const state = "unknown" as const;

  const facts: string[] = [];
  const done = phases.filter((ph) => ph.raw["status"] === "done").length;
  const active = phases.find((ph) => ph.raw["status"] === "active");
  const blocked = phases.filter(
    (ph) => ph.raw["status"] === "blocked" || ph.raw["status"] === "cancelled",
  ).length;
  if (phases.length > 0) facts.push(`${done}/${phases.length} phase(s) done`);
  if (active) facts.push(`current: ${active.text}`);
  if (blocked > 0) facts.push(`${blocked} phase(s) blocked or cancelled`);
  if (gaps.length > 0) facts.push(`${gaps.length} open question(s)`);

  const statusSentence = firstSentence(p.status);
  const label = clamp(statusSentence ?? facts[0] ?? "Status", 240);
  const block: Block = { id: mintId("sts"), type: "status", state, label };
  const detailParts = [
    statusSentence && statusSentence !== label ? statusSentence : "",
    facts.join(" · "),
  ].filter((s) => s.length > 0);
  if (detailParts.length > 0) block.detail = clamp(detailParts.join(" — "), 600);

  const refs = [...phases, ...gaps].flatMap((i) => i.sourceRefs);
  return [withRefs(block, refs.length > 0 ? refs : (p.sourceRefs ?? []))];
}

/**
 * A `QuoteBlock` is a verbatim quotation. Its `text` is exactly a verified
 * `SourceRef.quote` (Phase 2 already checked it against the source), with runs of
 * whitespace collapsed to single spaces — never `claim.statement` /
 * `result.statement` / `candidate.text`. A quote that does not fit the 1200-char
 * block, or when no verbatim quote exists at all, is not shown as a quotation:
 * the slide falls back to a plain `text` block.
 */
function quoteBlocks(input: BlockBuildInput, items: KnowledgeItem[]): Block[] {
  const { slide, view, mintId } = input;
  const pool = [...resolve(view, slide.claimRefs), ...items];
  for (const item of pool) {
    for (const ref of item.sourceRefs) {
      if (typeof ref.quote !== "string") continue;
      const verbatim = ref.quote.replace(/\s+/g, " ").trim();
      if (verbatim.length === 0 || verbatim.length > 1200) continue;
      const block: Block = { id: mintId("qte"), type: "quote", text: verbatim };
      const source = view.knowledge.sources.find((s) => s.id === ref.sourceId);
      if (source) block.attribution = clamp(source.title, 240);
      return [withRefs(block, [ref, ...item.sourceRefs])];
    }
  }
  // no verbatim SourceRef.quote — do not fabricate a quotation
  return textBlock(input, items);
}

/**
 * Build the blocks for one slide. `architecture` / `process` / `sequence` return
 * `wantsDiagram: true` and no diagram block yet — the director builds the
 * `DiagramIR` and appends the matching block.
 */
export function buildSlideBlocks(input: BlockBuildInput): BlockBuildResult {
  const { slide, view, visualKind, limits } = input;
  const notes: PlanningNote[] = [];
  const items = resolve(view, refsOf(slide));

  if (slide.kind === "cover") return { blocks: [], notes, wantsDiagram: false };

  let blocks: Block[];
  let wantsDiagram = false;

  switch (visualKind) {
    case "none":
      blocks = slide.kind === "closing" && items.length > 0 ? textBlock(input, items) : [];
      break;
    case "metrics":
      blocks = metricsBlocks(input, items);
      break;
    case "comparison":
      blocks = comparisonBlock(input, items);
      break;
    case "timeline":
      blocks = timelineBlocks(input);
      break;
    case "roadmap":
      blocks = roadmapBlocks(input);
      break;
    case "risk":
      blocks = riskBlocks(input, items);
      break;
    case "status":
      blocks = statusBlocks(input, items);
      break;
    case "relationship":
    case "hierarchy":
      blocks = relationshipBlocks(input, items);
      break;
    case "quote":
      blocks = quoteBlocks(input, items);
      break;
    case "architecture":
    case "process":
    case "sequence":
    case "dataflow":
    case "lifecycle":
      blocks = [];
      wantsDiagram = true;
      break;
    default:
      blocks = textBlock(input, items);
  }

  // density / limit enforcement — never drop the slide's knowledgeRefs, only
  // the number of *visible blocks*.
  if (blocks.length > limits.maxBlocksPerSlide) {
    const kept = blocks.slice(0, limits.maxBlocksPerSlide);
    notes.push({
      code: "visual/content-condensed",
      message: `slide "${slide.title}" produced ${blocks.length} blocks; kept ${kept.length} to fit the density budget (provenance retained on the slide)`,
      severity: "warning",
    });
    blocks = kept;
  }

  return { blocks, notes, wantsDiagram };
}
