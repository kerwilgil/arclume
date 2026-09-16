/**
 * Shared Architecture Layout (Phase 5+ / 1.0.1 Visual Quality Patch).
 *
 * Single source of truth for architecture diagram placement.
 * Used by:
 *   - src/engines/visual/adapter.ts (Visual Engine adapter)
 *   - src/renderers/html/diagrams.ts (native HTML renderer)
 *
 * Guarantees:
 *   - Same node positions, edge routes, content bbox, viewBox, centering
 *   - Consistent behavior across renderers
 *   - Proper canvas utilization and centering
 */

import { byId } from "../engines/visual/adapter.js";
import type { VISUAL_ENGINE_COMPONENT_TYPE_SENTINEL } from "../engines/visual/types.js";

export interface ArchitectureNode {
  id: string;
  label: string;
  entityId: string;
  group?: string;
}

export interface ArchitectureEdge {
  id: string;
  from: string;
  to: string;
  label: string;
  relationId: string;
}

export interface ArchLayoutResult {
  /** node id -> { x, y } in layout coordinates */
  positions: Map<string, { x: number; y: number }>;
  /** Content bounding box (tight around nodes + edges) */
  contentBBox: { x: number; y: number; width: number; height: number };
  /** ViewBox with padding around content */
  viewBox: { x: number; y: number; width: number; height: number };
  /** ViewBox center */
  viewBoxCenter: { x: number; y: number };
  /** Content bbox center */
  contentCenter: { x: number; y: number };
  /** Layout dimensions */
  layout: { cols: number; rows: number; cellWidth: number; cellHeight: number };
  /** Whether graph was cyclic (grid fallback used) */
  gridFallback: boolean;
  /** Node dimensions */
  nodeWidth: number;
  nodeHeight: number;
}

/** Architecture layout constants - single source of truth */
export const ARCH_LAYOUT_CONSTANTS = {
  NODE_WIDTH: 200,
  NODE_HEIGHT: 64,
  GRID_X_GAP: 96,
  GRID_Y_GAP: 30,
  MARGIN_X: 44,
  MARGIN_Y: 44,
  MAX_COLS: 12,
  /** Padding around content bbox for viewBox */
  VIEWBOX_PADDING: 40,
  /** Minimum viewBox dimensions */
  MIN_VIEWBOX_WIDTH: 320,
  MIN_VIEWBOX_HEIGHT: 160,
} as const;

/**
 * Compute deterministic architecture layout.
 *
 * Algorithm:
 *   1. Kahn topological sort for DAGs (layer = topological depth)
 *      - Ties broken by ascending node id
 *      - col = layer, row = position within layer (id-sorted)
 *   2. Cyclic or too-deep graphs -> id-sorted grid fallback
 *      - cols = min(MAX_COLS, ceil(sqrt(n)))
 *      - row = floor(i / cols), col = i % cols
 *   3. Compute content bbox from actual node positions + dimensions
 *   4. Center content bbox in viewBox with consistent padding
 *   5. Return all metadata for renderer consumption
 */
export function computeArchitectureLayout(
  nodes: ReadonlyArray<ArchitectureNode>,
  edges: ReadonlyArray<ArchitectureEdge>,
): ArchLayoutResult {
  const {
    NODE_WIDTH,
    NODE_HEIGHT,
    GRID_X_GAP,
    GRID_Y_GAP,
    MARGIN_X,
    MARGIN_Y,
    MAX_COLS,
    VIEWBOX_PADDING,
    MIN_VIEWBOX_WIDTH,
    MIN_VIEWBOX_HEIGHT,
  } = ARCH_LAYOUT_CONSTANTS;

  const ids = nodes.map((n) => n.id).sort(byId);
  const known = new Set(ids);
  const dag = edges.filter((e) => known.has(e.from) && known.has(e.to) && e.from !== e.to);

  const indeg = new Map<string, number>(ids.map((id) => [id, 0]));
  const out = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const e of dag) {
    indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
    (out.get(e.from) as string[]).push(e.to);
  }
  for (const list of out.values()) list.sort(byId);

  const layer = new Map<string, number>(ids.map((id) => [id, 0]));
  const ready = ids.filter((id) => (indeg.get(id) ?? 0) === 0);
  const seen = new Set<string>(ready);
  let processed = 0;
  while (ready.length > 0) {
    ready.sort(byId);
    const u = ready.shift() as string;
    processed += 1;
    for (const v of out.get(u) ?? []) {
      const want = (layer.get(u) ?? 0) + 1;
      if (want > (layer.get(v) ?? 0)) layer.set(v, want);
      indeg.set(v, (indeg.get(v) ?? 0) - 1);
      if ((indeg.get(v) ?? 0) === 0 && !seen.has(v)) {
        seen.add(v);
        ready.push(v);
      }
    }
  }
  const cyclic = processed !== ids.length;
  const layerCount = cyclic ? 0 : Math.max(...ids.map((id) => layer.get(id) ?? 0)) + 1;

  const positions = new Map<string, { x: number; y: number }>();
  let cols = 0;
  let rows = 0;

  if (!cyclic && layerCount <= MAX_COLS) {
    const byLayer = new Map<number, string[]>();
    for (const id of ids) {
      const l = layer.get(id) ?? 0;
      const list = byLayer.get(l) ?? [];
      list.push(id);
      byLayer.set(l, list);
    }
    for (const list of byLayer.values()) list.sort(byId);
    for (const [l, list] of byLayer) {
      list.forEach((id, row) => {
        positions.set(id, {
          x: MARGIN_X + l * (NODE_WIDTH + GRID_X_GAP),
          y: MARGIN_Y + row * (NODE_HEIGHT + GRID_Y_GAP),
        });
      });
    }
    cols = Math.max(1, layerCount);
    rows = Math.max(...[...byLayer.values()].map((a) => a.length));
  } else {
    cols = Math.min(MAX_COLS, Math.max(1, Math.ceil(Math.sqrt(ids.length))));
    rows = Math.ceil(ids.length / cols);
    ids.forEach((id, i) => {
      positions.set(id, {
        x: MARGIN_X + (i % cols) * (NODE_WIDTH + GRID_X_GAP),
        y: MARGIN_Y + Math.floor(i / cols) * (NODE_HEIGHT + GRID_Y_GAP),
      });
    });
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const [id, pos] of positions) {
    minX = Math.min(minX, pos.x);
    minY = Math.min(minY, pos.y);
    maxX = Math.max(maxX, pos.x + NODE_WIDTH);
    maxY = Math.max(maxY, pos.y + NODE_HEIGHT);
  }
  if (minX === Number.POSITIVE_INFINITY) {
    minX = MARGIN_X;
    minY = MARGIN_Y;
    maxX = MARGIN_X + NODE_WIDTH;
    maxY = MARGIN_Y + NODE_HEIGHT;
  }

  const contentBBox = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  const contentCenter = {
    x: contentBBox.x + contentBBox.width / 2,
    y: contentBBox.y + contentBBox.height / 2,
  };

  const viewBoxWidth = Math.max(MIN_VIEWBOX_WIDTH, contentBBox.width + 2 * VIEWBOX_PADDING);
  const viewBoxHeight = Math.max(MIN_VIEWBOX_HEIGHT, contentBBox.height + 2 * VIEWBOX_PADDING);

  const viewBoxX = contentCenter.x - viewBoxWidth / 2;
  const viewBoxY = contentCenter.y - viewBoxHeight / 2;

  const viewBox = { x: viewBoxX, y: viewBoxY, width: viewBoxWidth, height: viewBoxHeight };
  const viewBoxCenter = { x: viewBox.x + viewBox.width / 2, y: viewBox.y + viewBox.height / 2 };

  return {
    positions,
    contentBBox,
    viewBox,
    viewBoxCenter,
    contentCenter,
    layout: {
      cols,
      rows,
      cellWidth: NODE_WIDTH + GRID_X_GAP,
      cellHeight: NODE_HEIGHT + GRID_Y_GAP,
    },
    gridFallback: cyclic,
    nodeWidth: NODE_WIDTH,
    nodeHeight: NODE_HEIGHT,
  };
}

/**
 * Convert layout result to Visual Engine architecture request components/connections.
 * Used by adapter.ts to produce VisualEngineArchitectureRequest.
 */
export function layoutToVisualEngineRequest(
  layout: ArchLayoutResult,
  nodes: ReadonlyArray<ArchitectureNode>,
  edges: ReadonlyArray<ArchitectureEdge>,
  diagramTitle: string,
  visualEngineComponentType: typeof VISUAL_ENGINE_COMPONENT_TYPE_SENTINEL,
  workflowNodeWidth: (label: string) => number,
): {
  components: Array<{
    id: string;
    type: typeof VISUAL_ENGINE_COMPONENT_TYPE_SENTINEL;
    label: string;
    row: number;
    col: number;
    size: readonly [number, number];
  }>;
  connections: Array<{ id: string; from: string; to: string; label?: string; labelDy?: number }>;
  meta: { title: string; animation: "none"; visual_preset: "classic"; legend: { mode: "hidden" } };
  layout: { mode: "grid"; cols: number };
} {
  const sortedNodes = [...nodes].sort((a, b) => byId(a.id, b.id));
  const components = sortedNodes.map((n) => {
    const pos = layout.positions.get(n.id);
    if (!pos) throw new Error(`Missing position for node ${n.id}`);
    const row = Math.round((pos.y - ARCH_LAYOUT_CONSTANTS.MARGIN_Y) / layout.layout.cellHeight);
    const col = Math.round((pos.x - ARCH_LAYOUT_CONSTANTS.MARGIN_X) / layout.layout.cellWidth);
    return {
      id: n.id,
      type: visualEngineComponentType,
      label: n.label,
      row: Math.max(0, row),
      col: Math.max(0, col),
      size: [workflowNodeWidth(n.label), ARCH_LAYOUT_CONSTANTS.NODE_HEIGHT] as const,
    };
  });

  const connections = edges.map((e) => {
    const c: { id: string; from: string; to: string; label?: string; labelDy?: number } = {
      id: e.id,
      from: e.from,
      to: e.to,
    };
    if (e.label !== undefined) {
      c.label = e.label;
      const fromPos = layout.positions.get(e.from);
      const toPos = layout.positions.get(e.to);
      if (fromPos !== undefined && toPos !== undefined && Math.abs(fromPos.y - toPos.y) < 1) {
        c.labelDy = 54;
      }
    }
    return c;
  });

  return {
    components,
    connections,
    meta: {
      title: diagramTitle,
      animation: "none",
      visual_preset: "classic",
      legend: { mode: "hidden" },
    },
    layout: { mode: "grid", cols: layout.layout.cols },
  };
}

/**
 * Convert layout result to native renderer SVG coordinates.
 * Used by diagrams.ts renderArchitecture().
 */
export function layoutToNativeRenderer(layout: ArchLayoutResult): {
  nodePositions: Map<string, { x: number; y: number }>;
  viewBox: { width: number; height: number };
} {
  return {
    nodePositions: layout.positions,
    viewBox: { width: layout.viewBox.width, height: layout.viewBox.height },
  };
}
