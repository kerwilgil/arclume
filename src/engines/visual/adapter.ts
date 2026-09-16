/**
 * Visual Engine adapter (Phase 7) — the *pure* semantic → engine mapping.
 *
 * Input:  a validated `DiagramIR` whose `spec.format` is `"arclume.native.v1"`.
 * Output: a `VisualEngineRequest` (Visual Engine's own JSON IR) plus provenance and
 *         ordering metadata, or a classified failure.
 *
 * This module is pure: no filesystem, no subprocess, no clock, no RNG, no
 * network. The same `DiagramIR` always produces a byte-identical request under
 * `stableStringify`.
 *
 * Non-negotiable mapping rules:
 *  - never infer component semantics: every component/step carries the
 *    `external` sentinel type (schema plumbing only);
 *  - never invent nodes, edges, lanes, boundaries or steps;
 *  - placement is deterministic (Kahn layering for DAGs, id-sorted grid
 *    otherwise) and never label-based.
 */

import { contentHash } from "../../determinism/hash.js";
import type { DiagramIR } from "../../types/deck.js";
import {
  type ArchitectureEdge,
  type ArchitectureNode,
  computeArchitectureLayout,
  layoutToVisualEngineRequest,
} from "../../visual/architecture-layout.js";
import type { ResolvedDiagramProvenance } from "../types.js";
import { placeDataflow } from "./place-dataflow.js";
import { placeLifecycle } from "./place-lifecycle.js";
import {
  NATIVE_SPEC_FORMAT,
  type NativeArchitectureSpec,
  type NativeDataflowSpec,
  type NativeEdge,
  type NativeLifecycleSpec,
  type NativeSequenceSpec,
  type NativeWorkflowSpec,
  VISUAL_ENGINE_COMPONENT_TYPE_SENTINEL,
  VISUAL_ENGINE_ID_RE,
  VISUAL_ENGINE_WORKFLOW_CAPACITY,
  type VisualEngineAdaptationFailure,
  type VisualEngineAdaptationResult,
  type VisualEngineArchitectureRequest,
  type VisualEngineDataflowRequest,
  type VisualEngineLifecycleRequest,
  type VisualEngineProvenanceMaps,
  type VisualEngineSequenceRequest,
  type VisualEngineWorkflowRequest,
} from "./types.js";

const asArray = (v: unknown): Array<Record<string, unknown>> =>
  Array.isArray(v) ? (v as Array<Record<string, unknown>>) : [];
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

export const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Enum boundaries the vendored Visual Engine schemas enforce. The adapter rejects an
 * out-of-enum value as an integrity failure (`visual-engine/adapter-invalid-input`)
 * so a malformed spec never slips through to an opaque `visual-engine/render-failed`
 * that would then silently fall back to native.
 */
const COMPONENT_TYPES: ReadonlySet<string> = new Set([
  "frontend",
  "backend",
  "database",
  "cloud",
  "security",
  "messagebus",
  "external",
]);
const DATAFLOW_ROUTES: ReadonlySet<string> = new Set([
  "auto",
  "straight",
  "vertical-channel",
  "bottom-channel",
  "top-channel",
]);
const LIFECYCLE_ROUTES: ReadonlySet<string> = new Set([
  "auto",
  "straight",
  "drop",
  "bottom-channel",
  "top-channel",
  "right-channel",
  "left-channel",
]);
const SEQUENCE_VARIANTS: ReadonlySet<string> = new Set([
  "default",
  "emphasis",
  "security",
  "dashed",
  "return",
]);

function fail(diagramId: string, code: string, message: string): VisualEngineAdaptationFailure {
  return { kind: "error", diagramId, code, message };
}

/** A title Visual Engine accepts (meta.title requires minLength 1). */
function visualEngineTitle(diagram: DiagramIR): string {
  const t = typeof diagram.title === "string" ? diagram.title.trim() : "";
  return t.length > 0 ? t : diagram.id;
}

/** A label Visual Engine accepts (minLength 1). Never empty after this. */
function labelOf(raw: string | undefined, id: string): string {
  const trimmed = (raw ?? "").replace(/\s+/g, " ").trim();
  return trimmed.length > 0 ? trimmed : id;
}

/** Ids must satisfy both Arclume's and Visual Engine's id grammar. */
function safeId(v: unknown): v is string {
  return typeof v === "string" && VISUAL_ENGINE_ID_RE.test(v);
}

/**
 * Normalize the spec's edge list (P1-1). Every edge MUST carry both its visual
 * identity (`id`) and its semantic identity (`relationId`). There is no
 * `edge-<index>` synthesis: missing provenance is invalid input, never a
 * silent invention.
 */
function normalizeEdges(
  diagramId: string,
  raw: Array<Record<string, unknown>>,
  knownNodes: ReadonlySet<string>,
): { ok: true; edges: NativeEdge[] } | { ok: false; failure: VisualEngineAdaptationFailure } {
  const edges: NativeEdge[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < raw.length; i += 1) {
    const e = raw[i] as Record<string, unknown>;
    const id = str(e["id"]);
    const relationId = str(e["relationId"]);
    const from = str(e["from"]);
    const to = str(e["to"]);
    const label = str(e["label"]) ?? str(e["relationType"]);
    if (id === undefined || id === "" || !safeId(id)) {
      return {
        ok: false,
        failure: fail(
          diagramId,
          "visual-engine/adapter-invalid-input",
          `diagram "${diagramId}": edge #${i} has no safe visual id`,
        ),
      };
    }
    if (relationId === undefined || relationId.trim() === "") {
      return {
        ok: false,
        failure: fail(
          diagramId,
          "visual-engine/adapter-invalid-input",
          `diagram "${diagramId}": edge "${id}" has no relationId (semantic provenance is required)`,
        ),
      };
    }
    if (from === undefined || to === undefined || from === "" || to === "") {
      return {
        ok: false,
        failure: fail(
          diagramId,
          "visual-engine/adapter-invalid-input",
          `diagram "${diagramId}": edge "${id}" has no usable from/to`,
        ),
      };
    }
    if (!knownNodes.has(from) || !knownNodes.has(to)) {
      return {
        ok: false,
        failure: fail(
          diagramId,
          "visual-engine/adapter-invalid-input",
          `diagram "${diagramId}": edge "${id}" references unknown node(s) ("${from}" → "${to}")`,
        ),
      };
    }
    if (seen.has(id)) {
      return {
        ok: false,
        failure: fail(
          diagramId,
          "visual-engine/adapter-invalid-input",
          `diagram "${diagramId}": duplicate edge id "${id}"`,
        ),
      };
    }
    seen.add(id);
    const edge: NativeEdge = { id, relationId, from, to };
    if (label !== undefined && label !== "") edge.label = label.replace(/\s+/g, " ").trim();
    edges.push(edge);
  }
  return { ok: true, edges };
}

/* ------------------------------------------------------------------ */
/* architecture — deterministic placement                              */
/* ------------------------------------------------------------------ */

const MAX_VISUAL_ENGINE_COLS = 12;

export interface ArchPlacement {
  /** node id → grid cell. */
  cell: Map<string, { row: number; col: number }>;
  cols: number;
  /** True when the graph was cyclic or too deep and the grid fallback ran. */
  gridFallback: boolean;
}

/**
 * Deterministic placement:
 *  - DAG → Kahn layering (ties broken by ascending node id); `col` = layer,
 *    `row` = position within the layer after id sort, `layout.cols` = layer
 *    count (only when `layerCount <= 12`);
 *  - cyclic graph or depth > 12 → nodes sorted by id, `cols = min(12,
 *    ceil(sqrt(n)))`, `row = floor(i / cols)`, `col = i % cols`.
 */
export function placeArchitecture(
  nodeIds: readonly string[],
  edges: ReadonlyArray<Pick<NativeEdge, "from" | "to">>,
): ArchPlacement {
  const ids = [...nodeIds].sort(byId);
  const known = new Set(ids);
  const dag = edges.filter((e) => known.has(e.from) && known.has(e.to) && e.from !== e.to);

  const indeg = new Map<string, number>(ids.map((id) => [id, 0]));
  const out = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const e of dag) {
    indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
    (out.get(e.from) as string[]).push(e.to);
  }

  // Kahn with ascending-id tie-break.
  const layer = new Map<string, number>(ids.map((id) => [id, 0]));
  const ready = ids.filter((id) => (indeg.get(id) ?? 0) === 0);
  const seen = new Set<string>(ready);
  let processed = 0;
  while (ready.length > 0) {
    ready.sort(byId);
    const u = ready.shift() as string;
    processed += 1;
    for (const v of out.get(u) ?? []) {
      if ((layer.get(u) ?? 0) + 1 > (layer.get(v) ?? 0)) layer.set(v, (layer.get(u) ?? 0) + 1);
      indeg.set(v, (indeg.get(v) ?? 0) - 1);
      if ((indeg.get(v) ?? 0) === 0 && !seen.has(v)) {
        seen.add(v);
        ready.push(v);
      }
    }
  }
  const cyclic = processed !== ids.length;
  const layerCount = cyclic ? 0 : Math.max(...ids.map((id) => layer.get(id) ?? 0)) + 1;

  const cell = new Map<string, { row: number; col: number }>();
  if (!cyclic && layerCount <= MAX_VISUAL_ENGINE_COLS) {
    const byLayer = new Map<number, string[]>();
    for (const id of ids) {
      const l = layer.get(id) ?? 0;
      const list = byLayer.get(l) ?? [];
      list.push(id);
      byLayer.set(l, list);
    }
    for (const [l, list] of byLayer) {
      list.sort(byId);
      list.forEach((id, row) => cell.set(id, { row, col: l }));
    }
    return { cell, cols: Math.max(1, layerCount), gridFallback: false };
  }

  const cols = Math.min(MAX_VISUAL_ENGINE_COLS, Math.max(1, Math.ceil(Math.sqrt(ids.length))));
  ids.forEach((id, i) => cell.set(id, { row: Math.floor(i / cols), col: i % cols }));
  return { cell, cols, gridFallback: true };
}

function adaptArchitecture(
  diagram: DiagramIR,
  raw: Record<string, unknown>,
  specHash: string,
): VisualEngineAdaptationResult {
  const nodes: NativeArchitectureSpec["nodes"] = [];
  const seen = new Set<string>();
  for (const [i, n] of asArray(raw["nodes"]).entries()) {
    const id = str(n["id"]);
    const label = str(n["label"]);
    const entityId = str(n["entityId"]);
    if (id === undefined || id === "" || !safeId(id)) {
      return fail(
        diagram.id,
        "visual-engine/adapter-invalid-input",
        `diagram "${diagram.id}": node #${i} has no safe id`,
      );
    }
    if (entityId === undefined || entityId.trim() === "") {
      return fail(
        diagram.id,
        "visual-engine/adapter-invalid-input",
        `diagram "${diagram.id}": node "${id}" has no entityId (semantic provenance is required)`,
      );
    }
    if (seen.has(id)) {
      return fail(
        diagram.id,
        "visual-engine/adapter-invalid-input",
        `diagram "${diagram.id}": duplicate node id "${id}"`,
      );
    }
    seen.add(id);
    nodes.push({ id, label: labelOf(label, id), entityId });
  }
  if (nodes.length === 0) {
    return fail(
      diagram.id,
      "visual-engine/adapter-invalid-input",
      `diagram "${diagram.id}": architecture spec has no nodes`,
    );
  }

  const edgeResult = normalizeEdges(diagram.id, asArray(raw["edges"]), seen);
  if (!edgeResult.ok) return edgeResult.failure;
  const { edges } = edgeResult;

  const archNodes: ArchitectureNode[] = nodes.map((n) => ({
    id: n.id,
    label: n.label,
    entityId: n.entityId,
  }));
  const archEdges: ArchitectureEdge[] = edges.map((e) => ({
    id: e.id,
    from: e.from,
    to: e.to,
    label: e.label ?? "",
    relationId: e.relationId,
  }));
  const layout = computeArchitectureLayout(archNodes, archEdges);
  const veRequest = layoutToVisualEngineRequest(
    layout,
    archNodes,
    archEdges,
    visualEngineTitle(diagram),
    VISUAL_ENGINE_COMPONENT_TYPE_SENTINEL,
    workflowNodeWidth,
  );

  const request: import("./types.js").VisualEngineArchitectureRequest = {
    schema_version: 1,
    diagram_type: "architecture",
    meta: veRequest.meta,
    layout: veRequest.layout,
    components: veRequest.components,
    connections: veRequest.connections,
  };

  const sorted = [...nodes].sort((a, b) => byId(a.id, b.id));

  const spec: NativeArchitectureSpec = {
    format: NATIVE_SPEC_FORMAT,
    kind: "architecture",
    nodes,
    edges,
  };
  if (raw["condensed"] === true) spec.condensed = true;

  const provenance: ResolvedDiagramProvenance = {
    // SEMANTIC identities (ProjectKnowledge), never visual ids.
    entityIds: sorted.map((n) => n.entityId),
    relationIds: edges.map((e) => e.relationId),
    stepIds: [],
    itemIds: [],
  };

  const maps: VisualEngineProvenanceMaps = {
    nodeToEntity: new Map(nodes.map((n) => [n.id, n.entityId])),
    edgeToRelation: new Map(edges.map((e) => [e.id, e.relationId])),
    stepToRef: new Map(),
    edgeDirection: new Map(edges.map((e) => [e.id, { from: e.from, to: e.to }])),
  };

  return {
    kind: "ok",
    diagramId: diagram.id,
    visualKind: "architecture",
    request,
    specHash,
    provenance,
    ordering: {
      componentOrder: sorted.map((n) => n.id),
      connectionOrder: edges.map((e) => e.id),
      stepOrder: [],
    },
    maps,
    spec,
  };
}

/* ------------------------------------------------------------------ */
/* workflow / process                                                  */
/* ------------------------------------------------------------------ */

/**
 * Deterministic workflow node width from the label length (pixels conservative
 * for Visual Engine's `classic` preset at font-size 11). Purely presentational —
 * nothing is inferred from the label's meaning.
 */
export function workflowNodeWidth(label: string): number {
  return Math.min(200, Math.max(96, Math.ceil(label.length * 6.5) + 32));
}

function adaptWorkflow(
  diagram: DiagramIR,
  raw: Record<string, unknown>,
  kind: "workflow" | "process",
  specHash: string,
): VisualEngineAdaptationResult {
  void kind;
  const steps: NativeWorkflowSpec["steps"] = [];
  const seen = new Set<string>();
  const seenIndexes = new Set<number>();
  for (const [i, s] of asArray(raw["steps"]).entries()) {
    const id = str(s["id"]);
    const label = str(s["label"]);
    const ref = str(s["ref"]);
    const indexRaw = s["index"];
    if (id === undefined || id === "" || !safeId(id)) {
      return fail(
        diagram.id,
        "visual-engine/adapter-invalid-input",
        `diagram "${diagram.id}": step #${i} has no safe id`,
      );
    }
    // P2: the index must be an explicit, authored integer — never synthesized
    // from the array position.
    if (indexRaw === undefined || indexRaw === null) {
      return fail(
        diagram.id,
        "visual-engine/adapter-invalid-input",
        `diagram "${diagram.id}": step "${id}" has no explicit index`,
      );
    }
    if (typeof indexRaw !== "number" || !Number.isInteger(indexRaw) || indexRaw < 0) {
      return fail(
        diagram.id,
        "visual-engine/adapter-invalid-input",
        `diagram "${diagram.id}": step "${id}" index must be a non-negative integer`,
      );
    }
    const index = indexRaw;
    if (seenIndexes.has(index)) {
      return fail(
        diagram.id,
        "visual-engine/adapter-invalid-input",
        `diagram "${diagram.id}": duplicate step index ${index} — indexes must be unique`,
      );
    }
    seenIndexes.add(index);
    if (ref === undefined || ref.trim() === "") {
      return fail(
        diagram.id,
        "visual-engine/adapter-invalid-input",
        `diagram "${diagram.id}": step "${id}" has no ref (semantic provenance is required)`,
      );
    }
    if (seen.has(id)) {
      return fail(
        diagram.id,
        "visual-engine/adapter-invalid-input",
        `diagram "${diagram.id}": duplicate step id "${id}"`,
      );
    }
    seen.add(id);
    steps.push({ id, label: labelOf(label, id), index, ref });
  }
  if (steps.length === 0) {
    return fail(
      diagram.id,
      "visual-engine/adapter-invalid-input",
      `diagram "${diagram.id}": workflow spec has no steps`,
    );
  }

  // Explicit `step.index` governs; ids are unique and indexes are unique.
  const ordered = [...steps].sort((a, b) => a.index - b.index);

  if (ordered.length > VISUAL_ENGINE_WORKFLOW_CAPACITY) {
    return fail(
      diagram.id,
      "visual-engine/layout-capacity",
      `diagram "${diagram.id}": ${ordered.length} steps exceed the Visual Engine workflow capacity of ${VISUAL_ENGINE_WORKFLOW_CAPACITY} — no truncation, fallback to the native engine`,
    );
  }

  const stepIds = new Set(ordered.map((s) => s.id));
  const edgeResult = normalizeEdges(diagram.id, asArray(raw["edges"]), stepIds);
  if (!edgeResult.ok) return edgeResult.failure;
  const { edges } = edgeResult;

  // `mainPath` exists only when every consecutive pair is an actual authored
  // edge in that direction — it must never invent causal semantics.
  const pairSet = new Set(edges.map((e) => `${e.from}→${e.to}`));
  let consecutive = ordered.length > 1;
  for (let i = 0; i + 1 < ordered.length; i += 1) {
    const a = ordered[i] as NativeWorkflowSpec["steps"][number];
    const b = ordered[i + 1] as NativeWorkflowSpec["steps"][number];
    if (!pairSet.has(`${a.id}→${b.id}`)) {
      consecutive = false;
      break;
    }
  }

  const title = visualEngineTitle(diagram);
  const request: import("./types.js").VisualEngineWorkflowRequest = {
    schema_version: 2,
    diagram_type: "workflow",
    meta: {
      title,
      animation: "none",
      visual_preset: "classic",
      legend: { mode: "hidden" },
    },
    lanes: [{ id: "main", label: title }],
    nodes: ordered.map((s, i) => ({
      id: s.id,
      lane: "main",
      col: i,
      type: VISUAL_ENGINE_COMPONENT_TYPE_SENTINEL,
      label: s.label,
      // Deterministic width from label length only (never semantics): Visual Engine
      // rejects labels wider than their node.
      width: workflowNodeWidth(s.label),
    })),
    edges: edges.map((e) => {
      const c: { id: string; from: string; to: string; label?: string } = {
        id: e.id,
        from: e.from,
        to: e.to,
      };
      if (e.label !== undefined) c.label = e.label;
      return c;
    }),
    ...(consecutive ? { mainPath: ordered.map((s) => s.id) } : {}),
  };

  const spec: NativeWorkflowSpec = {
    format: NATIVE_SPEC_FORMAT,
    kind: "workflow",
    steps: ordered,
    edges,
  };
  if (raw["condensed"] === true) spec.condensed = true;

  const provenance: ResolvedDiagramProvenance = {
    entityIds: [],
    // SEMANTIC relation ids, never the visual edge ids.
    relationIds: edges.map((e) => e.relationId),
    // Step ids are structural workflow ids (per the remediation contract).
    stepIds: ordered.map((s) => s.id),
    itemIds: [],
  };

  const maps: VisualEngineProvenanceMaps = {
    nodeToEntity: new Map(),
    edgeToRelation: new Map(edges.map((e) => [e.id, e.relationId])),
    stepToRef: new Map(ordered.map((s) => [s.id, s.ref])),
    edgeDirection: new Map(edges.map((e) => [e.id, { from: e.from, to: e.to }])),
  };

  return {
    kind: "ok",
    diagramId: diagram.id,
    visualKind: "workflow",
    request,
    specHash,
    provenance,
    ordering: {
      componentOrder: [],
      connectionOrder: edges.map((e) => e.id),
      stepOrder: ordered.map((s) => s.id),
    },
    maps,
    spec,
  };
}

/* ------------------------------------------------------------------ */
/* dataflow                                                             */
/* ------------------------------------------------------------------ */

function adaptDataflow(
  diagram: DiagramIR,
  raw: Record<string, unknown>,
  specHash: string,
): VisualEngineAdaptationResult {
  const asArray = (v: unknown): Array<Record<string, unknown>> =>
    Array.isArray(v) ? (v as Array<Record<string, unknown>>) : [];
  const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

  const stages: { label: string }[] = [];
  for (const [i, s] of asArray(raw["stages"]).entries()) {
    const label = str(s["label"]);
    if (label === undefined || label.trim() === "") {
      return fail(
        diagram.id,
        "visual-engine/adapter-invalid-input",
        `diagram "${diagram.id}": stage #${i} has no label`,
      );
    }
    stages.push({ label: label.trim() });
  }
  if (stages.length < 2 || stages.length > 5) {
    return fail(
      diagram.id,
      "visual-engine/adapter-invalid-input",
      `diagram "${diagram.id}": dataflow requires 2-5 stages`,
    );
  }

  const nodes: Array<{
    id: string;
    type: string;
    label: string;
    sublabel?: string;
    tag?: string;
    stage: number;
    row?: number;
    width?: number;
    height?: number;
    yOffset?: number;
  }> = [];
  const seenNodes = new Set<string>();
  let nodesWithRow = 0;
  for (const [i, n] of asArray(raw["nodes"]).entries()) {
    const id = str(n["id"]);
    const type = str(n["type"]);
    const label = str(n["label"]);
    const sublabel = str(n["sublabel"]);
    const tag = str(n["tag"]);
    const stage = n["stage"];
    const row = n["row"];
    const width = n["width"];
    const height = n["height"];
    const yOffset = n["yOffset"];
    if (id === undefined || id === "" || !safeId(id)) {
      return fail(
        diagram.id,
        "visual-engine/adapter-invalid-input",
        `diagram "${diagram.id}": dataflow node #${i} has no safe id`,
      );
    }
    if (type === undefined || !COMPONENT_TYPES.has(type.trim())) {
      return fail(
        diagram.id,
        "visual-engine/adapter-invalid-input",
        `diagram "${diagram.id}": dataflow node "${id}" type must be one of ${[...COMPONENT_TYPES].join(", ")}`,
      );
    }
    if (label === undefined || label.trim() === "") {
      return fail(
        diagram.id,
        "visual-engine/adapter-invalid-input",
        `diagram "${diagram.id}": dataflow node "${id}" has no label`,
      );
    }
    if (typeof stage !== "number" || stage < 0 || stage >= stages.length) {
      return fail(
        diagram.id,
        "visual-engine/adapter-invalid-input",
        `diagram "${diagram.id}": dataflow node "${id}" has invalid stage`,
      );
    }
    if (row !== undefined && (typeof row !== "number" || row < 0 || row >= 5)) {
      return fail(
        diagram.id,
        "visual-engine/adapter-invalid-input",
        `diagram "${diagram.id}": dataflow node "${id}" row must be 0-4`,
      );
    }
    if (typeof row === "number") nodesWithRow += 1;
    if (seenNodes.has(id)) {
      return fail(
        diagram.id,
        "visual-engine/adapter-invalid-input",
        `diagram "${diagram.id}": duplicate dataflow node id "${id}"`,
      );
    }
    seenNodes.add(id);
    nodes.push({
      id,
      type: type.trim(),
      label: label.trim(),
      ...(sublabel !== undefined && sublabel.trim() !== "" ? { sublabel: sublabel.trim() } : {}),
      ...(tag !== undefined && tag.trim() !== "" ? { tag: tag.trim() } : {}),
      stage,
      ...(typeof row === "number" ? { row } : {}),
      ...(typeof width === "number" ? { width } : {}),
      ...(typeof height === "number" ? { height } : {}),
      ...(typeof yOffset === "number" ? { yOffset } : {}),
    });
  }
  if (nodes.length < 2) {
    return fail(
      diagram.id,
      "visual-engine/adapter-invalid-input",
      `diagram "${diagram.id}": dataflow requires at least 2 nodes`,
    );
  }
  if (nodesWithRow !== 0 && nodesWithRow !== nodes.length) {
    return fail(
      diagram.id,
      "visual-engine/adapter-invalid-input",
      `diagram "${diagram.id}": dataflow node rows must be all-present or all-absent (partial: ${nodesWithRow}/${nodes.length})`,
    );
  }

  const flows: Array<{
    id: string;
    from: string;
    to: string;
    label: string;
    classification?: string;
    variant?: string;
    route?: "auto" | "straight" | "vertical-channel" | "bottom-channel" | "top-channel";
  }> = [];
  const seenFlows = new Set<string>();
  for (const [i, f] of asArray(raw["flows"]).entries()) {
    const id = str(f["id"]);
    const from = str(f["from"]);
    const to = str(f["to"]);
    const label = str(f["label"]);
    const classification = str(f["classification"]);
    const variant = str(f["variant"]);
    const route = str(f["route"]);
    if (id === undefined || id === "" || !safeId(id)) {
      return fail(
        diagram.id,
        "visual-engine/adapter-invalid-input",
        `diagram "${diagram.id}": flow #${i} has no safe id`,
      );
    }
    if (from === undefined || to === undefined || from === "" || to === "") {
      return fail(
        diagram.id,
        "visual-engine/adapter-invalid-input",
        `diagram "${diagram.id}": flow "${id}" has no usable from/to`,
      );
    }
    if (!seenNodes.has(from) || !seenNodes.has(to)) {
      return fail(
        diagram.id,
        "visual-engine/adapter-invalid-input",
        `diagram "${diagram.id}": flow "${id}" references unknown node(s)`,
      );
    }
    if (label === undefined || label.trim() === "") {
      return fail(
        diagram.id,
        "visual-engine/adapter-invalid-input",
        `diagram "${diagram.id}": flow "${id}" has no label`,
      );
    }
    if (seenFlows.has(id)) {
      return fail(
        diagram.id,
        "visual-engine/adapter-invalid-input",
        `diagram "${diagram.id}": duplicate flow id "${id}"`,
      );
    }
    if (route !== undefined && !DATAFLOW_ROUTES.has(route)) {
      return fail(
        diagram.id,
        "visual-engine/adapter-invalid-input",
        `diagram "${diagram.id}": flow "${id}" route must be one of ${[...DATAFLOW_ROUTES].join(", ")}`,
      );
    }
    seenFlows.add(id);
    flows.push({
      id,
      from,
      to,
      label: label.trim(),
      ...(classification !== undefined && classification.trim() !== ""
        ? { classification: classification.trim() }
        : {}),
      ...(variant !== undefined && variant.trim() !== "" ? { variant: variant.trim() } : {}),
      ...(route !== undefined
        ? {
            route: route as
              | "auto"
              | "straight"
              | "vertical-channel"
              | "bottom-channel"
              | "top-channel",
          }
        : {}),
    });
  }

  // Geometry: when the caller placed nothing, run the deterministic planner.
  // A partial placement was already rejected above.
  let plannedViewBox: readonly [number, number] | undefined;
  if (nodesWithRow === 0) {
    const placed = placeDataflow({
      stageCount: stages.length,
      nodes: nodes.map((n) => ({ id: n.id, stage: n.stage })),
      flows: flows.map((f) => ({ id: f.id, from: f.from, to: f.to })),
    });
    if (!placed.ok) {
      return fail(
        diagram.id,
        "visual-engine/adapter-invalid-input",
        `diagram "${diagram.id}": dataflow geometry could not be planned — ${placed.reason}`,
      );
    }
    for (const n of nodes) n.row = placed.placement.rows.get(n.id) ?? 0;
    for (const f of flows) {
      const r = placed.placement.routes.get(f.id);
      if (f.route === undefined && r !== undefined) f.route = r;
    }
    plannedViewBox = placed.placement.viewBox;
  }

  const title = visualEngineTitle(diagram);
  const request: import("./types.js").VisualEngineDataflowRequest = {
    schema_version: 1,
    diagram_type: "dataflow",
    meta: {
      title,
      animation: "none",
      visual_preset: "classic",
      legend: { mode: "hidden" },
      ...(plannedViewBox !== undefined ? { viewBox: plannedViewBox } : {}),
    },
    stages: stages.map((s) => ({ label: s.label })),
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.type,
      label: n.label,
      ...(n.sublabel !== undefined ? { sublabel: n.sublabel } : {}),
      ...(n.tag !== undefined ? { tag: n.tag } : {}),
      stage: n.stage,
      row: n.row ?? 0,
      ...(n.width !== undefined ? { width: n.width } : {}),
      ...(n.height !== undefined ? { height: n.height } : {}),
      ...(n.yOffset !== undefined ? { yOffset: n.yOffset } : {}),
    })),
    flows: flows.map((f) => ({
      id: f.id,
      from: f.from,
      to: f.to,
      label: f.label,
      ...(f.classification !== undefined ? { classification: f.classification } : {}),
      ...(f.variant !== undefined ? { variant: f.variant } : {}),
      ...(f.route !== undefined ? { route: f.route } : {}),
    })),
  };

  const spec: import("./types.js").NativeDataflowSpec = {
    format: NATIVE_SPEC_FORMAT,
    kind: "dataflow",
    condensed: raw["condensed"] === true,
    stages,
    nodes,
    flows,
  };

  // Structural provenance: dataflow has no knowledge-backed refs yet (a
  // knowledge-aware dataflow model arrives with automatic diagram selection),
  // so every node/flow id is its own structural identity. This still makes the
  // sanitizer's per-node/per-edge round-trip (data-step-id / data-relation-id)
  // pass exactly, with no silent identity loss.
  const nodeIds = nodes.map((n) => n.id);
  const flowIds = flows.map((f) => f.id);
  const provenance: ResolvedDiagramProvenance = {
    entityIds: [],
    relationIds: [...flowIds],
    stepIds: [...nodeIds],
    itemIds: [],
  };

  const maps: VisualEngineProvenanceMaps = {
    nodeToEntity: new Map(),
    edgeToRelation: new Map(flows.map((f) => [f.id, f.id])),
    stepToRef: new Map(nodes.map((n) => [n.id, n.id])),
    edgeDirection: new Map(flows.map((f) => [f.id, { from: f.from, to: f.to }])),
  };

  return {
    kind: "ok",
    diagramId: diagram.id,
    visualKind: "dataflow",
    request,
    specHash,
    provenance,
    ordering: {
      componentOrder: [],
      connectionOrder: [...flowIds],
      stepOrder: [...nodeIds],
    },
    maps,
    spec,
  };
}

/* ------------------------------------------------------------------ */
/* lifecycle                                                            */
/* ------------------------------------------------------------------ */

function adaptLifecycle(
  diagram: DiagramIR,
  raw: Record<string, unknown>,
  specHash: string,
): VisualEngineAdaptationResult {
  const asArray = (v: unknown): Array<Record<string, unknown>> =>
    Array.isArray(v) ? (v as Array<Record<string, unknown>>) : [];
  const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

  const lanes: Array<{ id: string; label: string }> = [];
  const seenLanes = new Set<string>();
  for (const [i, l] of asArray(raw["lanes"]).entries()) {
    const id = str(l["id"]);
    const label = str(l["label"]);
    if (id === undefined || id === "" || !safeId(id)) {
      return fail(
        diagram.id,
        "visual-engine/adapter-invalid-input",
        `diagram "${diagram.id}": lane #${i} has no safe id`,
      );
    }
    if (label === undefined || label.trim() === "") {
      return fail(
        diagram.id,
        "visual-engine/adapter-invalid-input",
        `diagram "${diagram.id}": lane "${id}" has no label`,
      );
    }
    if (seenLanes.has(id)) {
      return fail(
        diagram.id,
        "visual-engine/adapter-invalid-input",
        `diagram "${diagram.id}": duplicate lane id "${id}"`,
      );
    }
    seenLanes.add(id);
    lanes.push({ id, label: label.trim() });
  }
  if (lanes.length === 0 || lanes.length > 4) {
    return fail(
      diagram.id,
      "visual-engine/adapter-invalid-input",
      `diagram "${diagram.id}": lifecycle requires 1-4 lanes`,
    );
  }

  const states: Array<{
    id: string;
    type:
      | "start"
      | "active"
      | "waiting"
      | "decision"
      | "success"
      | "failure"
      | "neutral"
      | "external";
    label: string;
    sublabel?: string;
    tag?: string;
    step?: string;
    lane: string;
    col?: number;
    width?: number;
    height?: number;
    yOffset?: number;
  }> = [];
  const seenStates = new Set<string>();
  let statesWithCol = 0;
  const validTypes = new Set([
    "start",
    "active",
    "waiting",
    "decision",
    "success",
    "failure",
    "neutral",
    "external",
  ]);
  for (const [i, s] of asArray(raw["states"]).entries()) {
    const id = str(s["id"]);
    const type = str(s["type"]);
    const label = str(s["label"]);
    const sublabel = str(s["sublabel"]);
    const tag = str(s["tag"]);
    const step = str(s["step"]);
    const lane = str(s["lane"]);
    const col = s["col"];
    const width = s["width"];
    const height = s["height"];
    const yOffset = s["yOffset"];
    if (id === undefined || id === "" || !safeId(id)) {
      return fail(
        diagram.id,
        "visual-engine/adapter-invalid-input",
        `diagram "${diagram.id}": state #${i} has no safe id`,
      );
    }
    if (type === undefined || !validTypes.has(type)) {
      return fail(
        diagram.id,
        "visual-engine/adapter-invalid-input",
        `diagram "${diagram.id}": state "${id}" has invalid type`,
      );
    }
    if (label === undefined || label.trim() === "") {
      return fail(
        diagram.id,
        "visual-engine/adapter-invalid-input",
        `diagram "${diagram.id}": state "${id}" has no label`,
      );
    }
    if (lane === undefined || !seenLanes.has(lane)) {
      return fail(
        diagram.id,
        "visual-engine/adapter-invalid-input",
        `diagram "${diagram.id}": state "${id}" references unknown lane`,
      );
    }
    if (col !== undefined && (typeof col !== "number" || col < 0 || col > 4)) {
      return fail(
        diagram.id,
        "visual-engine/adapter-invalid-input",
        `diagram "${diagram.id}": state "${id}" col must be 0-4`,
      );
    }
    if (typeof col === "number") statesWithCol += 1;
    if (seenStates.has(id)) {
      return fail(
        diagram.id,
        "visual-engine/adapter-invalid-input",
        `diagram "${diagram.id}": duplicate state id "${id}"`,
      );
    }
    seenStates.add(id);
    states.push({
      id,
      type: type as
        | "start"
        | "active"
        | "waiting"
        | "decision"
        | "success"
        | "failure"
        | "neutral"
        | "external",
      label: label.trim(),
      ...(sublabel !== undefined && sublabel.trim() !== "" ? { sublabel: sublabel.trim() } : {}),
      ...(tag !== undefined && tag.trim() !== "" ? { tag: tag.trim() } : {}),
      ...(step !== undefined && step.trim() !== "" ? { step: step.trim() } : {}),
      lane,
      ...(typeof col === "number" ? { col } : {}),
      ...(typeof width === "number" ? { width } : {}),
      ...(typeof height === "number" ? { height } : {}),
      ...(typeof yOffset === "number" ? { yOffset } : {}),
    });
  }
  if (statesWithCol !== 0 && statesWithCol !== states.length) {
    return fail(
      diagram.id,
      "visual-engine/adapter-invalid-input",
      `diagram "${diagram.id}": lifecycle state cols must be all-present or all-absent (partial: ${statesWithCol}/${states.length})`,
    );
  }
  if (states.length < 2) {
    return fail(
      diagram.id,
      "visual-engine/adapter-invalid-input",
      `diagram "${diagram.id}": lifecycle requires at least 2 states`,
    );
  }

  const transitions: Array<{
    id: string;
    from: string;
    to: string;
    label?: string;
    note?: string;
    variant?: string;
    route?:
      | "auto"
      | "straight"
      | "drop"
      | "bottom-channel"
      | "top-channel"
      | "right-channel"
      | "left-channel";
  }> = [];
  const seenTransitions = new Set<string>();
  for (const [i, t] of asArray(raw["transitions"]).entries()) {
    const id = str(t["id"]);
    const from = str(t["from"]);
    const to = str(t["to"]);
    const label = str(t["label"]);
    const note = str(t["note"]);
    const variant = str(t["variant"]);
    const route = str(t["route"]);
    if (id === undefined || id === "" || !safeId(id)) {
      return fail(
        diagram.id,
        "visual-engine/adapter-invalid-input",
        `diagram "${diagram.id}": transition #${i} has no safe id`,
      );
    }
    if (from === undefined || to === undefined || from === "" || to === "") {
      return fail(
        diagram.id,
        "visual-engine/adapter-invalid-input",
        `diagram "${diagram.id}": transition "${id}" has no usable from/to`,
      );
    }
    if (!seenStates.has(from) || !seenStates.has(to)) {
      return fail(
        diagram.id,
        "visual-engine/adapter-invalid-input",
        `diagram "${diagram.id}": transition "${id}" references unknown state(s)`,
      );
    }
    if (seenTransitions.has(id)) {
      return fail(
        diagram.id,
        "visual-engine/adapter-invalid-input",
        `diagram "${diagram.id}": duplicate transition id "${id}"`,
      );
    }
    if (route !== undefined && !LIFECYCLE_ROUTES.has(route)) {
      return fail(
        diagram.id,
        "visual-engine/adapter-invalid-input",
        `diagram "${diagram.id}": transition "${id}" route must be one of ${[...LIFECYCLE_ROUTES].join(", ")}`,
      );
    }
    seenTransitions.add(id);
    transitions.push({
      id,
      from,
      to,
      ...(label !== undefined && label.trim() !== "" ? { label: label.trim() } : {}),
      ...(note !== undefined && note.trim() !== "" ? { note: note.trim() } : {}),
      ...(variant !== undefined && variant.trim() !== "" ? { variant: variant.trim() } : {}),
      ...(route !== undefined
        ? {
            route: route as
              | "auto"
              | "straight"
              | "drop"
              | "bottom-channel"
              | "top-channel"
              | "right-channel"
              | "left-channel",
          }
        : {}),
    });
  }

  // Geometry: when the caller placed nothing, run the deterministic planner.
  let plannedLifecycleViewBox: readonly [number, number] | undefined;
  if (statesWithCol === 0) {
    const placed = placeLifecycle({
      laneIds: lanes.map((l) => l.id),
      states: states.map((s) => ({ id: s.id, lane: s.lane })),
      transitions: transitions.map((t) => ({ id: t.id, from: t.from, to: t.to })),
    });
    if (!placed.ok) {
      return fail(
        diagram.id,
        "visual-engine/adapter-invalid-input",
        `diagram "${diagram.id}": lifecycle geometry could not be planned — ${placed.reason}`,
      );
    }
    for (const s of states) s.col = placed.placement.cols.get(s.id) ?? 0;
    for (const t of transitions) {
      const r = placed.placement.routes.get(t.id);
      if (t.route === undefined && r !== undefined) t.route = r;
    }
    plannedLifecycleViewBox = placed.placement.viewBox;
  }

  const title = visualEngineTitle(diagram);
  const request: import("./types.js").VisualEngineLifecycleRequest = {
    schema_version: 1,
    diagram_type: "lifecycle",
    meta: {
      title,
      animation: "none",
      visual_preset: "classic",
      legend: { mode: "hidden" },
      ...(plannedLifecycleViewBox !== undefined ? { viewBox: plannedLifecycleViewBox } : {}),
    },
    lanes,
    states: states.map((s) => ({
      id: s.id,
      type: s.type,
      label: s.label,
      ...(s.sublabel !== undefined ? { sublabel: s.sublabel } : {}),
      ...(s.tag !== undefined ? { tag: s.tag } : {}),
      ...(s.step !== undefined ? { step: s.step } : {}),
      lane: s.lane,
      col: s.col ?? 0,
      ...(s.width !== undefined ? { width: s.width } : {}),
      ...(s.height !== undefined ? { height: s.height } : {}),
      ...(s.yOffset !== undefined ? { yOffset: s.yOffset } : {}),
    })),
    transitions: transitions.map((t) => ({
      id: t.id,
      from: t.from,
      to: t.to,
      ...(t.label !== undefined ? { label: t.label } : {}),
      ...(t.note !== undefined ? { note: t.note } : {}),
      ...(t.variant !== undefined ? { variant: t.variant } : {}),
      ...(t.route !== undefined ? { route: t.route } : {}),
    })),
  };

  const spec: import("./types.js").NativeLifecycleSpec = {
    format: NATIVE_SPEC_FORMAT,
    kind: "lifecycle",
    condensed: raw["condensed"] === true,
    lanes,
    states,
    transitions,
  };

  // Structural provenance (see adaptDataflow): every state/transition id is its
  // own identity until a knowledge-aware lifecycle model exists.
  const stateIds = states.map((s) => s.id);
  const transitionIds = transitions.map((t) => t.id);
  const provenance: ResolvedDiagramProvenance = {
    entityIds: [],
    relationIds: [...transitionIds],
    stepIds: [...stateIds],
    itemIds: [],
  };

  const maps: VisualEngineProvenanceMaps = {
    nodeToEntity: new Map(),
    edgeToRelation: new Map(transitions.map((t) => [t.id, t.id])),
    stepToRef: new Map(states.map((s) => [s.id, s.id])),
    edgeDirection: new Map(transitions.map((t) => [t.id, { from: t.from, to: t.to }])),
  };

  return {
    kind: "ok",
    diagramId: diagram.id,
    visualKind: "lifecycle",
    request,
    specHash,
    provenance,
    ordering: {
      componentOrder: [],
      connectionOrder: [...transitionIds],
      stepOrder: [...stateIds],
    },
    maps,
    spec,
  };
}

/* ------------------------------------------------------------------ */
/* sequence                                                             */
/* ------------------------------------------------------------------ */

function adaptSequence(
  diagram: DiagramIR,
  raw: Record<string, unknown>,
  specHash: string,
): VisualEngineAdaptationResult {
  const asArray = (v: unknown): Array<Record<string, unknown>> =>
    Array.isArray(v) ? (v as Array<Record<string, unknown>>) : [];
  const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

  const participants: Array<{
    id: string;
    type: string;
    label: string;
    sublabel?: string;
    brand?: string;
  }> = [];
  const seenParticipants = new Set<string>();
  for (const [i, p] of asArray(raw["participants"]).entries()) {
    const id = str(p["id"]);
    const type = str(p["type"]);
    const label = str(p["label"]);
    const sublabel = str(p["sublabel"]);
    const brand = str(p["brand"]);
    if (id === undefined || id === "" || !safeId(id)) {
      return fail(
        diagram.id,
        "visual-engine/adapter-invalid-input",
        `diagram "${diagram.id}": participant #${i} has no safe id`,
      );
    }
    if (type === undefined || !COMPONENT_TYPES.has(type.trim())) {
      return fail(
        diagram.id,
        "visual-engine/adapter-invalid-input",
        `diagram "${diagram.id}": participant "${id}" type must be one of ${[...COMPONENT_TYPES].join(", ")}`,
      );
    }
    if (label === undefined || label.trim() === "") {
      return fail(
        diagram.id,
        "visual-engine/adapter-invalid-input",
        `diagram "${diagram.id}": participant "${id}" has no label`,
      );
    }
    if (seenParticipants.has(id)) {
      return fail(
        diagram.id,
        "visual-engine/adapter-invalid-input",
        `diagram "${diagram.id}": duplicate participant id "${id}"`,
      );
    }
    seenParticipants.add(id);
    participants.push({
      id,
      type: type.trim(),
      label: label.trim(),
      ...(sublabel !== undefined && sublabel.trim() !== "" ? { sublabel: sublabel.trim() } : {}),
      ...(brand !== undefined && brand.trim() !== "" ? { brand: brand.trim() } : {}),
    });
  }
  if (participants.length < 2) {
    return fail(
      diagram.id,
      "visual-engine/adapter-invalid-input",
      `diagram "${diagram.id}": sequence requires at least 2 participants`,
    );
  }

  const messages: Array<{
    id: string;
    from: string;
    to: string;
    y: number;
    label: string;
    variant?: "default" | "emphasis" | "security" | "dashed" | "return";
    note?: string;
  }> = [];
  const seenMessages = new Set<string>();
  for (const [i, m] of asArray(raw["messages"]).entries()) {
    const id = str(m["id"]);
    const from = str(m["from"]);
    const to = str(m["to"]);
    const y = m["y"];
    const label = str(m["label"]);
    const variant = str(m["variant"]);
    const note = str(m["note"]);
    if (id === undefined || id === "" || !safeId(id)) {
      return fail(
        diagram.id,
        "visual-engine/adapter-invalid-input",
        `diagram "${diagram.id}": message #${i} has no safe id`,
      );
    }
    if (from === undefined || to === undefined || from === "" || to === "") {
      return fail(
        diagram.id,
        "visual-engine/adapter-invalid-input",
        `diagram "${diagram.id}": message "${id}" has no usable from/to`,
      );
    }
    if (!seenParticipants.has(from) || !seenParticipants.has(to)) {
      return fail(
        diagram.id,
        "visual-engine/adapter-invalid-input",
        `diagram "${diagram.id}": message "${id}" references unknown participant(s)`,
      );
    }
    if (typeof y !== "number" || y < 160) {
      return fail(
        diagram.id,
        "visual-engine/adapter-invalid-input",
        `diagram "${diagram.id}": message "${id}" has invalid y`,
      );
    }
    if (label === undefined || label.trim() === "") {
      return fail(
        diagram.id,
        "visual-engine/adapter-invalid-input",
        `diagram "${diagram.id}": message "${id}" has no label`,
      );
    }
    if (seenMessages.has(id)) {
      return fail(
        diagram.id,
        "visual-engine/adapter-invalid-input",
        `diagram "${diagram.id}": duplicate message id "${id}"`,
      );
    }
    if (variant !== undefined && !SEQUENCE_VARIANTS.has(variant)) {
      return fail(
        diagram.id,
        "visual-engine/adapter-invalid-input",
        `diagram "${diagram.id}": message "${id}" variant must be one of ${[...SEQUENCE_VARIANTS].join(", ")}`,
      );
    }
    seenMessages.add(id);
    messages.push({
      id,
      from,
      to,
      y,
      label: label.trim(),
      ...(variant !== undefined
        ? { variant: variant as "default" | "emphasis" | "security" | "dashed" | "return" }
        : {}),
      ...(note !== undefined && note.trim() !== "" ? { note: note.trim() } : {}),
    });
  }
  if (messages.length === 0) {
    return fail(
      diagram.id,
      "visual-engine/adapter-invalid-input",
      `diagram "${diagram.id}": sequence requires at least 1 message`,
    );
  }

  const activations: Array<{
    participant: string;
    from: number;
    to: number;
    type?: string;
  }> = [];
  for (const [i, a] of asArray(raw["activations"]).entries()) {
    const participant = str(a["participant"]);
    const from = a["from"];
    const to = a["to"];
    const type = str(a["type"]);
    if (participant === undefined || !seenParticipants.has(participant)) {
      return fail(
        diagram.id,
        "visual-engine/adapter-invalid-input",
        `diagram "${diagram.id}": activation #${i} references unknown participant`,
      );
    }
    if (typeof from !== "number" || typeof to !== "number") {
      return fail(
        diagram.id,
        "visual-engine/adapter-invalid-input",
        `diagram "${diagram.id}": activation #${i} has invalid from/to`,
      );
    }
    activations.push({ participant, from, to, ...(type !== undefined ? { type } : {}) });
  }

  const segments: Array<{ from: number; to: number; label: string }> = [];
  for (const [i, s] of asArray(raw["segments"]).entries()) {
    const from = s["from"];
    const to = s["to"];
    const label = str(s["label"]);
    if (typeof from !== "number" || typeof to !== "number") {
      return fail(
        diagram.id,
        "visual-engine/adapter-invalid-input",
        `diagram "${diagram.id}": segment #${i} has invalid from/to`,
      );
    }
    if (label === undefined || label.trim() === "") {
      return fail(
        diagram.id,
        "visual-engine/adapter-invalid-input",
        `diagram "${diagram.id}": segment #${i} has no label`,
      );
    }
    segments.push({ from, to, label: label.trim() });
  }

  const title = visualEngineTitle(diagram);
  const request: import("./types.js").VisualEngineSequenceRequest = {
    schema_version: 1,
    diagram_type: "sequence",
    meta: {
      title,
      animation: "none",
      visual_preset: "classic",
      legend: { mode: "hidden" },
    },
    participants: participants.map((p) => ({
      id: p.id,
      type: p.type,
      label: p.label,
      ...(p.sublabel !== undefined ? { sublabel: p.sublabel } : {}),
      ...(p.brand !== undefined ? { brand: p.brand } : {}),
    })),
    ...(segments.length > 0 ? { segments } : {}),
    messages: messages.map((m) => ({
      id: m.id,
      from: m.from,
      to: m.to,
      y: m.y,
      label: m.label,
      ...(m.variant !== undefined ? { variant: m.variant } : {}),
      ...(m.note !== undefined ? { note: m.note } : {}),
    })),
    ...(activations.length > 0 ? { activations } : {}),
  };

  const spec: import("./types.js").NativeSequenceSpec = {
    format: NATIVE_SPEC_FORMAT,
    kind: "sequence",
    condensed: raw["condensed"] === true,
    participants,
    messages,
    activations,
    segments,
  };

  // Structural provenance (see adaptDataflow): participant/message ids are
  // their own identities. adaptSequence is not wired into pipeline routing in
  // Slice 1 (the native sequence model carries {steps, edges}, not
  // {participants, messages}); it is exercised directly by unit tests and is
  // ready for the participant-aware sequence model that arrives with automatic
  // diagram selection.
  const participantIds = participants.map((p) => p.id);
  const messageIds = messages.map((m) => m.id);
  const provenance: ResolvedDiagramProvenance = {
    entityIds: [],
    relationIds: [...messageIds],
    stepIds: [...participantIds],
    itemIds: [],
  };

  const maps: VisualEngineProvenanceMaps = {
    nodeToEntity: new Map(),
    edgeToRelation: new Map(messages.map((m) => [m.id, m.id])),
    stepToRef: new Map(participants.map((p) => [p.id, p.id])),
    edgeDirection: new Map(messages.map((m) => [m.id, { from: m.from, to: m.to }])),
  };

  return {
    kind: "ok",
    diagramId: diagram.id,
    visualKind: "sequence",
    request,
    specHash,
    provenance,
    ordering: {
      componentOrder: [...participantIds],
      connectionOrder: [...messageIds],
      stepOrder: [...participantIds],
    },
    maps,
    spec,
  };
}

/* ------------------------------------------------------------------ */

/**
 * Map a validated `DiagramIR` to a Visual Engine request. Pure and deterministic.
 * Never throws: every failure is a classified `VisualEngineAdaptationFailure`.
 */
export function adaptDiagramToVisualEngine(diagram: DiagramIR): VisualEngineAdaptationResult {
  const spec = (diagram.spec ?? undefined) as Record<string, unknown> | undefined;
  if (spec === undefined || spec === null || typeof spec !== "object") {
    return fail(
      diagram.id,
      "visual-engine/adapter-invalid-input",
      `diagram "${diagram.id}" has no spec object`,
    );
  }
  if (spec["format"] !== NATIVE_SPEC_FORMAT) {
    return fail(
      diagram.id,
      "visual-engine/adapter-invalid-input",
      `diagram "${diagram.id}" spec.format is not "${NATIVE_SPEC_FORMAT}"`,
    );
  }
  const specHash = contentHash(diagram.spec);

  switch (spec["kind"]) {
    case "architecture":
      return adaptArchitecture(diagram, spec, specHash);
    case "workflow":
    case "process":
      return adaptWorkflow(diagram, spec, spec["kind"], specHash);
    case "dataflow":
      return adaptDataflow(diagram, spec, specHash);
    case "lifecycle":
      return adaptLifecycle(diagram, spec, specHash);
    case "sequence":
      return adaptSequence(diagram, spec, specHash);
    default:
      return fail(
        diagram.id,
        "visual-engine/unsupported-diagram",
        `diagram "${diagram.id}" kind "${String(spec["kind"])}" is not supported by the Visual Engine`,
      );
  }
}
