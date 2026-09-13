/**
 * Deterministic geometry planner for Archify data-flow diagrams.
 *
 * Input:  a semantic data flow — nodes grouped by `stage`, directed `flows`.
 * Output: a `row` per node and a `route` per flow that the vendored
 *         `render-dataflow.mjs` layout validator accepts, plus a `viewBox`
 *         sized to the placed graph.
 *
 * Pure and deterministic: no clock, RNG, IO. The same input (after id sort)
 * always yields the same placement. Every tie is broken by ascending id.
 *
 * Scope: forward-only DAGs (linear pipelines, single-level fan-out / fan-in,
 * small branches) whose widest stage has at most 5 nodes — the renderer's row
 * budget. Anything outside that (a backward flow, a cycle, or an overfull
 * stage) is returned as an explicit `unplaceable` reason, never as invalid
 * geometry handed to Archify to "fix".
 */

/** Vendored dataflow layout budget (see renderers/dataflow/README.md). */
const STAGE_LEFT_X = 100;
const STAGE_COL_GAP = 215;
const STAGE_W = 168;
const NODE_W = 112;
const NODE_H = 58;
const ROW_YS = [128, 242, 356, 470, 584] as const;
const STAGE_BOTTOM_PAD = 74;
const MAX_ROWS = ROW_YS.length;
const DEFAULT_VIEWBOX: readonly [number, number] = [940, 720];

export type DataflowRoute =
  | "auto"
  | "straight"
  | "vertical-channel"
  | "bottom-channel"
  | "top-channel";

export interface DataflowPlacementInput {
  stageCount: number;
  nodes: ReadonlyArray<{ id: string; stage: number }>;
  flows: ReadonlyArray<{ id: string; from: string; to: string }>;
}

export interface DataflowPlacement {
  /** node id → row (0-based, ≤ 4). */
  rows: ReadonlyMap<string, number>;
  /** flow id → route preset. */
  routes: ReadonlyMap<string, DataflowRoute>;
  viewBox: readonly [number, number];
}

export type DataflowPlacementResult =
  | { ok: true; placement: DataflowPlacement }
  | { ok: false; reason: string };

const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function placeDataflow(input: DataflowPlacementInput): DataflowPlacementResult {
  const { stageCount, nodes, flows } = input;
  const stageOf = new Map<string, number>(nodes.map((n) => [n.id, n.stage]));

  // Forward-only: every flow must go to a later (or the same) stage. A backward
  // edge or a self-stage cycle-like shape is out of scope — say so plainly.
  for (const f of flows) {
    const a = stageOf.get(f.from);
    const b = stageOf.get(f.to);
    if (a === undefined || b === undefined) {
      return { ok: false, reason: `flow "${f.id}" references a node with no stage` };
    }
    if (b < a) {
      return {
        ok: false,
        reason: `flow "${f.id}" runs backwards (stage ${a} → ${b}); the geometry planner places forward-only data flows`,
      };
    }
  }

  // Group node ids by stage, ascending id within a stage.
  const perStage: string[][] = Array.from({ length: stageCount }, () => []);
  for (const n of [...nodes].sort((x, y) => byId(x.id, y.id))) {
    (perStage[n.stage] as string[]).push(n.id);
  }
  for (const [s, ids] of perStage.entries()) {
    if (ids.length > MAX_ROWS) {
      return {
        ok: false,
        reason: `stage ${s} has ${ids.length} nodes; the dataflow renderer supports at most ${MAX_ROWS} rows`,
      };
    }
  }

  // Predecessors on the immediately preceding stage, per node (ascending id).
  const directPred = new Map<string, string[]>();
  for (const n of nodes) directPred.set(n.id, []);
  for (const f of [...flows].sort((x, y) => byId(x.id, y.id))) {
    if ((stageOf.get(f.to) ?? 0) - (stageOf.get(f.from) ?? 0) === 1) {
      (directPred.get(f.to) as string[]).push(f.from);
    }
  }

  const rows = new Map<string, number>();

  // Stage 0: pack from row 0, ascending id.
  for (const [i, id] of (perStage[0] ?? []).entries()) rows.set(id, i);

  // Later stages: try to sit each node on its (single) predecessor's row so an
  // `auto` flow is a clean straight line; fall back to the first free row.
  for (let s = 1; s < stageCount; s += 1) {
    const ids = perStage[s] ?? [];
    const used = new Set<number>();
    const pending: string[] = [];
    for (const id of ids) {
      const preds = directPred.get(id) ?? [];
      const wanted = preds.length === 1 ? rows.get(preds[0] as string) : undefined;
      if (wanted !== undefined && wanted < MAX_ROWS && !used.has(wanted)) {
        rows.set(id, wanted);
        used.add(wanted);
      } else {
        pending.push(id);
      }
    }
    let free = 0;
    for (const id of pending) {
      while (used.has(free)) free += 1;
      if (free >= MAX_ROWS) {
        return {
          ok: false,
          reason: `stage ${s} cannot be laid out within ${MAX_ROWS} rows without overlap`,
        };
      }
      rows.set(id, free);
      used.add(free);
    }
  }

  // Routes: adjacent same-row → straight; adjacent row-change → auto (the
  // renderer's midpoint elbow, label lands in the inter-stage gap); same-stage
  // → vertical channel; a stage skip forward → bottom channel.
  const routes = new Map<string, DataflowRoute>();
  for (const f of flows) {
    const a = stageOf.get(f.from) as number;
    const b = stageOf.get(f.to) as number;
    if (a === b) {
      routes.set(f.id, "vertical-channel");
    } else if (b - a === 1) {
      routes.set(f.id, rows.get(f.from) === rows.get(f.to) ? "straight" : "auto");
    } else {
      routes.set(f.id, "bottom-channel");
    }
  }

  const maxRow = Math.max(0, ...[...rows.values()]);
  const neededW = STAGE_LEFT_X + (stageCount - 1) * STAGE_COL_GAP + STAGE_W / 2 + 48;
  const neededH = (ROW_YS[maxRow] ?? ROW_YS[0]) + NODE_H + STAGE_BOTTOM_PAD + 24;
  const viewBox: readonly [number, number] = [
    Math.max(DEFAULT_VIEWBOX[0], Math.ceil(neededW)),
    Math.max(DEFAULT_VIEWBOX[1], Math.ceil(neededH)),
  ];

  return { ok: true, placement: { rows, routes, viewBox } };
}
