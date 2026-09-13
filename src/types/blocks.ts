/**
 * Block contracts for the ArclumeDeck IR.
 *
 * Phase 1 defines only the *types and the discriminated union*. No renderers.
 * Hand-maintained mirror of the `block*` definitions in
 * `schemas/arclume-deck.schema.json`.
 *
 * Taxonomy note: `diagram`, `architecture` and `workflow` are kept as three
 * distinct block types (per the Phase 1 brief). `architecture` and `workflow`
 * are semantic subtypes of `diagram`: all three carry a `diagramRef` into
 * `deck.diagrams`, but the two named variants let the narrative and (future)
 * VisualDirector reason about intent without opening the DiagramIR. Semantic
 * validation additionally checks that the referenced diagram's `diagramType`
 * matches the block type.
 */

import type { FactType, Id, SourceRef } from "./common.js";

export type BlockType =
  | "text"
  | "metric"
  | "metric-grid"
  | "comparison"
  | "timeline"
  | "roadmap"
  | "risk"
  | "status"
  | "callout"
  | "quote"
  | "table"
  | "image"
  | "code"
  | "diagram"
  | "architecture"
  | "workflow";

/** Fields shared by every block, regardless of `type`. */
export interface BlockBase {
  id: Id;
  emphasis?: boolean;
  caption?: string;
  sourceRefs?: SourceRef[];
}

export type MetricDirection = "up-good" | "down-good" | "neutral";

export interface TextBlock extends BlockBase {
  type: "text";
  text: string;
  format?: "plain" | "markdown";
}

export interface MetricBlock extends BlockBase {
  type: "metric";
  label: string;
  value: string;
  unit?: string;
  delta?: string;
  direction?: MetricDirection;
  metricId?: Id;
}

export interface MetricGridItem {
  label: string;
  value: string;
  unit?: string;
  delta?: string;
  direction?: MetricDirection;
  metricId?: Id;
}

export interface MetricGridBlock extends BlockBase {
  type: "metric-grid";
  /** 2–8 items. */
  metrics: MetricGridItem[];
}

export interface ComparisonColumn {
  title: string;
  note?: string;
}

export interface ComparisonRow {
  label: string;
  left: string;
  right: string;
}

export interface ComparisonBlock extends BlockBase {
  type: "comparison";
  left: ComparisonColumn;
  right: ComparisonColumn;
  rows: ComparisonRow[];
}

export interface TimelineItem {
  id?: Id;
  label: string;
  date?: string;
  detail?: string;
  state?: "done" | "active" | "planned";
}

export interface TimelineBlock extends BlockBase {
  type: "timeline";
  items: TimelineItem[];
}

export interface RoadmapPhase {
  id?: Id;
  name: string;
  status?: "planned" | "active" | "done" | "blocked" | "cancelled";
  start?: string;
  end?: string;
  items?: string[];
}

export interface RoadmapBlock extends BlockBase {
  type: "roadmap";
  phases: RoadmapPhase[];
}

export interface RiskBlock extends BlockBase {
  type: "risk";
  statement: string;
  likelihood?: "low" | "medium" | "high" | "unknown";
  impact?: "low" | "medium" | "high" | "unknown";
  mitigation?: string;
  factType: FactType;
  riskId?: Id;
}

export interface StatusBlock extends BlockBase {
  type: "status";
  state: "green" | "amber" | "red" | "unknown";
  label: string;
  detail?: string;
}

export interface CalloutBlock extends BlockBase {
  type: "callout";
  tone: "info" | "success" | "warning" | "danger" | "neutral";
  text: string;
}

export interface QuoteBlock extends BlockBase {
  type: "quote";
  text: string;
  attribution?: string;
}

export interface TableBlock extends BlockBase {
  type: "table";
  columns: string[];
  /** Each row's length must equal `columns.length` (semantic rule). */
  rows: string[][];
}

export interface ImageBlock extends BlockBase {
  type: "image";
  src: string;
  alt: string;
  fit?: "contain" | "cover";
}

export interface CodeBlock extends BlockBase {
  type: "code";
  language?: string;
  code: string;
}

export interface DiagramBlock extends BlockBase {
  type: "diagram";
  diagramRef: Id;
}

export interface ArchitectureBlock extends BlockBase {
  type: "architecture";
  diagramRef: Id;
}

export interface WorkflowBlock extends BlockBase {
  type: "workflow";
  diagramRef: Id;
}

export type Block =
  | TextBlock
  | MetricBlock
  | MetricGridBlock
  | ComparisonBlock
  | TimelineBlock
  | RoadmapBlock
  | RiskBlock
  | StatusBlock
  | CalloutBlock
  | QuoteBlock
  | TableBlock
  | ImageBlock
  | CodeBlock
  | DiagramBlock
  | ArchitectureBlock
  | WorkflowBlock;

/** Block types that reference an entry in `deck.diagrams`. */
export const DIAGRAM_BLOCK_TYPES = [
  "diagram",
  "architecture",
  "workflow",
] as const satisfies readonly BlockType[];

export type DiagramBlockType = (typeof DIAGRAM_BLOCK_TYPES)[number];

export function isDiagramBlock(
  block: Block,
): block is DiagramBlock | ArchitectureBlock | WorkflowBlock {
  return (DIAGRAM_BLOCK_TYPES as readonly string[]).includes(block.type);
}
