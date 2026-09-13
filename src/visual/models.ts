/**
 * Native visual models (Phase 4) — small, structured, renderer-independent
 * descriptions of the structural visuals ARCLUME can draw itself: architecture,
 * process, sequence, timeline, roadmap.
 *
 * Every node / edge / step / item carries the id of a **real** `ProjectKnowledge`
 * entity or relation. Nothing is synthesised to improve a picture: an edge only
 * exists when a real relation backs it; a step order only exists when real
 * steps or `PRECEDES` relations back it; a date only appears when the knowledge
 * carries one.
 *
 * A `DiagramAdapter` turns a `DiagramModel` into the Phase 1 `DiagramIR`
 * container (`engine: "native"`, structured `spec`). Phase 7 can register an
 * Visual Engine adapter for the same `DiagramModel` without touching Narrative or
 * SlidePlan.
 */

import type { KnowledgeItem, KnowledgeView } from "../narrative/knowledge-view.js";
import type { Id, SourceRef } from "../types/common.js";
import type { DiagramIR, DiagramType } from "../types/deck.js";
import type { VisualLimits } from "./types.js";

export const NATIVE_SPEC_FORMAT = "arclume.native.v1" as const;

export interface ArchNode {
  id: string;
  label: string;
  entityId: Id;
  group: string;
}
export interface ArchEdge {
  id: string;
  from: string;
  to: string;
  label: string;
  relationId: Id;
  relationType: string;
}
export interface FlowStep {
  id: string;
  label: string;
  /** Real knowledge id this step is anchored to (a process or an entity). */
  ref: Id;
  index: number;
}
export interface FlowEdge {
  id: string;
  from: string;
  to: string;
  relationId: Id;
  /** The relation's own phrase, when it has one (used as the message label). */
  label?: string;
}
/** A participant-aware projection of a `sequence` flow (for the visual engine). */
export interface SeqParticipant {
  id: string;
  /** Vendored visual engine componentType. */
  type: "frontend" | "backend" | "database" | "cloud" | "security" | "messagebus" | "external";
  label: string;
  /** The real ProjectKnowledge entity id this participant is. */
  entityId: Id;
}
export interface SeqMessage {
  id: string;
  from: string;
  to: string;
  label: string;
  y: number;
  /** The real relation id (explicit edge) or step id (ordered fallback). */
  ref: Id;
  variant?: "return";
}
export interface DataFlowNode {
  id: string;
  type: string;
  label: string;
  sublabel?: string;
  tag?: string;
  stage: number;
  /** Omitted by a knowledge-derived model — the Slice 2a geometry planner assigns it. */
  row?: number;
  width?: number;
  height?: number;
  yOffset?: number;
  entityId?: string;
}
export interface DataFlowFlow {
  id: string;
  from: string;
  to: string;
  label: string;
  classification?: string;
  variant?: string;
  route?: "auto" | "straight" | "vertical-channel" | "bottom-channel" | "top-channel";
  relationId?: string;
}
export interface LifecycleLane {
  id: string;
  label: string;
}
export interface LifecycleState {
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
  /** Omitted by a knowledge-derived model — the Slice 2a geometry planner assigns it. */
  col?: number;
  width?: number;
  height?: number;
  yOffset?: number;
  ref?: string;
}
export interface LifecycleTransition {
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
  relationId?: string;
}
export interface TimeItem {
  id: string;
  label: string;
  ref: Id;
  date?: string;
  state?: "done" | "active" | "planned";
  status?: "planned" | "active" | "done" | "blocked" | "cancelled";
}

export type DiagramModel =
  | {
      kind: "architecture";
      nodes: ArchNode[];
      edges: ArchEdge[];
      sourceRefs: SourceRef[];
      condensed: boolean;
    }
  | {
      kind: "process" | "sequence";
      steps: FlowStep[];
      edges: FlowEdge[];
      /** Only a `sequence` whose steps map to ≥2 distinct actor/component
       * entities carries this participant-aware projection; it routes to the
       * Archify sequence renderer, otherwise the flow stays native. */
      participants?: SeqParticipant[];
      messages?: SeqMessage[];
      sourceRefs: SourceRef[];
      condensed: boolean;
    }
  | {
      kind: "dataflow";
      stages: { label: string }[];
      nodes: DataFlowNode[];
      flows: DataFlowFlow[];
      sourceRefs: SourceRef[];
      condensed: boolean;
    }
  | {
      kind: "lifecycle";
      lanes: LifecycleLane[];
      states: LifecycleState[];
      transitions: LifecycleTransition[];
      sourceRefs: SourceRef[];
      condensed: boolean;
    }
  | {
      kind: "timeline" | "roadmap";
      items: TimeItem[];
      sourceRefs: SourceRef[];
      condensed: boolean;
    };

const STATUS_ORDER: Record<string, number> = {
  done: 0,
  active: 1,
  planned: 2,
  blocked: 3,
  cancelled: 4,
};

function byId<T extends { id: string }>(a: T, b: T): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Ascending string comparator — every tie in a model builder breaks by id. */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function dedupeRefs(refs: readonly SourceRef[]): SourceRef[] {
  const seen = new Set<string>();
  const out: SourceRef[] = [];
  for (const r of refs) {
    const key = JSON.stringify([r.sourceId, r.locator ?? null, r.quote ?? null]);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
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

/* ------------------------------------------------------------------ */
/* architecture                                                        */
/* ------------------------------------------------------------------ */

const ARCH_NODE_COLLECTIONS = new Set(["components", "dependencies", "technologies", "actors"]);

/**
 * Build an architecture model from the given knowledge ids. Returns `null` when
 * there is no real relation connecting two node entities — the caller must then
 * downgrade to `relationship` / `summary`.
 */
export function buildArchitectureModel(
  view: KnowledgeView,
  ids: readonly Id[],
  limits: VisualLimits,
): DiagramModel | null {
  const items = resolve(view, ids);
  const nodeItems = items.filter((i) => ARCH_NODE_COLLECTIONS.has(i.collection)).sort(byId);
  const nodeById = new Map(nodeItems.map((i) => [i.id, i] as const));

  const relationItems = items
    .filter(
      (i) =>
        i.collection === "relations" &&
        typeof i.raw["from"] === "string" &&
        typeof i.raw["to"] === "string" &&
        nodeById.has(i.raw["from"] as string) &&
        nodeById.has(i.raw["to"] as string),
    )
    .sort(byId);

  if (relationItems.length === 0) return null;

  // Keep only nodes that a surviving edge touches, then cap.
  const touched = new Set<Id>();
  for (const r of relationItems) {
    touched.add(r.raw["from"] as string);
    touched.add(r.raw["to"] as string);
  }
  let keptNodes = nodeItems.filter((n) => touched.has(n.id));
  let condensed = false;
  if (keptNodes.length > limits.maxDiagramNodes) {
    keptNodes = keptNodes.slice(0, limits.maxDiagramNodes);
    condensed = true;
  }
  const keptIds = new Set(keptNodes.map((n) => n.id));
  const keptEdges = relationItems.filter(
    (r) => keptIds.has(r.raw["from"] as string) && keptIds.has(r.raw["to"] as string),
  );
  if (keptEdges.length === 0) return null;

  const nodes: ArchNode[] = keptNodes.map((n) => ({
    id: `n-${n.id}`,
    label: n.text,
    entityId: n.id,
    group: n.collection,
  }));
  const edges: ArchEdge[] = keptEdges.map((r) => ({
    id: `e-${r.id}`,
    from: `n-${r.raw["from"] as string}`,
    to: `n-${r.raw["to"] as string}`,
    label: String(r.raw["type"] ?? "RELATES_TO"),
    relationId: r.id,
    relationType: String(r.raw["type"] ?? "RELATES_TO"),
  }));

  return {
    kind: "architecture",
    nodes,
    edges,
    sourceRefs: dedupeRefs([...keptNodes, ...keptEdges].flatMap((i) => i.sourceRefs)),
    condensed,
  };
}

/* ------------------------------------------------------------------ */
/* process / sequence                                                  */
/* ------------------------------------------------------------------ */

/** The vendored sequence renderer caps a participant label at an ~86px box. */
function clampParticipantLabel(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 13 ? `${flat.slice(0, 12).trimEnd()}…` : flat;
}

/** ProjectKnowledge entity kind → vendored visual engine componentType. */
function participantType(item: KnowledgeItem): SeqParticipant["type"] {
  if (item.collection === "actors") {
    const t = String(item.raw["type"] ?? "");
    return t === "system" ? "backend" : "external";
  }
  // components
  switch (String(item.raw["kind"] ?? "")) {
    case "ui":
      return "frontend";
    case "store":
      return "database";
    case "gateway":
      return "cloud";
    case "external":
      return "external";
    default:
      return "backend";
  }
}

/**
 * Project a `sequence` flow onto visual engine participants + messages, deriving
 * participants ONLY from real actor/component entities the steps are anchored
 * to. Returns `null` (→ the flow stays native) unless there are ≥2 distinct
 * participants and ≥1 message between two of them.
 */
function deriveSequenceParticipants(
  view: KnowledgeView,
  steps: readonly FlowStep[],
  edges: readonly FlowEdge[],
): { participants: SeqParticipant[]; messages: SeqMessage[] } | null {
  const stepById = new Map(steps.map((s) => [s.id, s]));
  const participantOf = new Map<string, string>(); // step id → participant id (= entity id)
  const participants: SeqParticipant[] = [];
  const seen = new Set<string>();
  for (const s of steps) {
    const item = view.byId.get(s.ref);
    if (!item || (item.collection !== "actors" && item.collection !== "components")) continue;
    participantOf.set(s.id, item.id);
    if (!seen.has(item.id)) {
      seen.add(item.id);
      participants.push({
        id: item.id,
        type: participantType(item),
        label: clampParticipantLabel(item.text),
        entityId: item.id,
      });
    }
  }
  if (participants.length < 2) return null;

  const messages: SeqMessage[] = [];
  let y = 200;
  const pushMessage = (id: string, from: string, to: string, label: string, ref: Id): void => {
    if (from === to) return;
    messages.push({ id, from, to, label: label.length > 0 ? label : "message", y, ref });
    y += 56;
  };

  if (edges.length > 0) {
    for (const e of edges) {
      const from = participantOf.get(e.from);
      const to = participantOf.get(e.to);
      if (from === undefined || to === undefined) continue;
      pushMessage(e.id, from, to, e.label ?? stepById.get(e.from)?.label ?? "", e.relationId);
    }
  } else {
    for (let i = 0; i < steps.length - 1; i += 1) {
      const a = steps[i] as FlowStep;
      const b = steps[i + 1] as FlowStep;
      const from = participantOf.get(a.id);
      const to = participantOf.get(b.id);
      if (from === undefined || to === undefined) continue;
      pushMessage(`m-${a.id}`, from, to, a.label, a.ref);
    }
  }
  if (messages.length === 0) return null;
  return { participants, messages };
}

export function buildFlowModel(
  view: KnowledgeView,
  ids: readonly Id[],
  kind: "process" | "sequence",
  limits: VisualLimits,
): DiagramModel | null {
  const items = resolve(view, ids);

  // 1) a process entity that carries explicit steps
  const proc = items
    .filter((i) => i.collection === "processes" && Array.isArray(i.raw["steps"]))
    .sort(byId)
    .find((i) => (i.raw["steps"] as unknown[]).length > 0);
  if (proc) {
    const rawSteps = proc.raw["steps"] as Array<{ label?: unknown }>;
    let labels = rawSteps.map((s) => String(s.label ?? "")).filter((s) => s.length > 0);
    let condensed = false;
    if (labels.length > limits.maxDiagramSteps) {
      labels = labels.slice(0, limits.maxDiagramSteps);
      condensed = true;
    }
    if (labels.length === 0) return null;
    const steps: FlowStep[] = labels.map((label, index) => ({
      id: `s-${proc.id}-${index + 1}`,
      label,
      ref: proc.id,
      index,
    }));
    return { kind, steps, edges: [], sourceRefs: dedupeRefs(proc.sourceRefs), condensed };
  }

  // 2) PRECEDES relations among the referenced entities
  const precedes = items
    .filter(
      (i) =>
        i.collection === "relations" &&
        i.raw["type"] === "PRECEDES" &&
        typeof i.raw["from"] === "string" &&
        typeof i.raw["to"] === "string",
    )
    .sort(byId);
  if (precedes.length === 0) return null;

  const order: Id[] = [];
  const seen = new Set<Id>();
  const push = (id: Id): void => {
    if (!seen.has(id) && view.byId.has(id)) {
      seen.add(id);
      order.push(id);
    }
  };
  for (const r of precedes) {
    push(r.raw["from"] as string);
    push(r.raw["to"] as string);
  }
  let condensed = false;
  let orderedIds = order;
  if (orderedIds.length > limits.maxDiagramSteps) {
    orderedIds = orderedIds.slice(0, limits.maxDiagramSteps);
    condensed = true;
  }
  if (orderedIds.length === 0) return null;
  const idx = new Map(orderedIds.map((id, i) => [id, i] as const));
  const steps: FlowStep[] = orderedIds.map((id, index) => ({
    id: `s-${id}`,
    label: view.byId.get(id)?.text ?? id,
    ref: id,
    index,
  }));
  const edges: FlowEdge[] = precedes
    .filter((r) => idx.has(r.raw["from"] as string) && idx.has(r.raw["to"] as string))
    .map((r) => ({
      id: `f-${r.id}`,
      from: `s-${r.raw["from"] as string}`,
      to: `s-${r.raw["to"] as string}`,
      relationId: r.id,
      ...(typeof r.raw["label"] === "string" && (r.raw["label"] as string).trim() !== ""
        ? { label: (r.raw["label"] as string).trim() }
        : {}),
    }));
  const seq = kind === "sequence" ? deriveSequenceParticipants(view, steps, edges) : null;
  return {
    kind,
    steps,
    edges,
    ...(seq !== null ? { participants: seq.participants, messages: seq.messages } : {}),
    sourceRefs: dedupeRefs(
      [...precedes, ...resolve(view, orderedIds)].flatMap((i) => i.sourceRefs),
    ),
    condensed,
  };
}

/* ------------------------------------------------------------------ */
/* timeline / roadmap                                                  */
/* ------------------------------------------------------------------ */

export function buildTimelineModel(
  view: KnowledgeView,
  ids: readonly Id[],
  kind: "timeline" | "roadmap",
  limits: VisualLimits,
): DiagramModel | null {
  const items = resolve(view, ids);
  const phases = items.filter((i) => i.collection === "phases").sort(byId);
  const milestones = items.filter((i) => i.collection === "milestones").sort(byId);

  let timeItems: TimeItem[] = [];

  if (kind === "roadmap") {
    if (phases.length === 0) {
      // roadmap can also be carried by milestones alone
      if (milestones.length === 0) return null;
    }
    const ordered = [...phases].sort((a, b) => {
      const sa = STATUS_ORDER[String(a.raw["status"] ?? "planned")] ?? 5;
      const sb = STATUS_ORDER[String(b.raw["status"] ?? "planned")] ?? 5;
      return sa !== sb ? sa - sb : byId(a, b);
    });
    timeItems = ordered.map((p) => {
      const item: TimeItem = { id: `t-${p.id}`, label: p.text, ref: p.id };
      const start = typeof p.raw["start"] === "string" ? (p.raw["start"] as string) : undefined;
      if (start) item.date = start;
      const status = p.raw["status"];
      if (
        status === "planned" ||
        status === "active" ||
        status === "done" ||
        status === "blocked" ||
        status === "cancelled"
      ) {
        item.status = status;
      }
      return item;
    });
    if (timeItems.length === 0) {
      timeItems = milestones.map((m) => ({
        id: `t-${m.id}`,
        label: m.text,
        ref: m.id,
        ...(typeof m.raw["date"] === "string" ? { date: m.raw["date"] as string } : {}),
        state: m.raw["achieved"] === true ? ("done" as const) : ("planned" as const),
      }));
    }
  } else {
    // timeline: temporal evidence — milestones first, then dated phases
    const dated = [
      ...milestones,
      ...phases.filter(
        (p) => typeof p.raw["start"] === "string" || typeof p.raw["end"] === "string",
      ),
    ];
    if (dated.length === 0) return null;
    timeItems = dated.map((i) => {
      const item: TimeItem = { id: `t-${i.id}`, label: i.text, ref: i.id };
      const date =
        (typeof i.raw["date"] === "string" && (i.raw["date"] as string)) ||
        (typeof i.raw["start"] === "string" && (i.raw["start"] as string)) ||
        undefined;
      if (date) item.date = date;
      if (i.collection === "milestones") {
        item.state = i.raw["achieved"] === true ? "done" : "planned";
      } else if (i.raw["status"] === "done") {
        item.state = "done";
      } else if (i.raw["status"] === "active") {
        item.state = "active";
      } else {
        item.state = "planned";
      }
      return item;
    });
  }

  let condensed = false;
  if (timeItems.length > limits.maxTimelineItems) {
    timeItems = timeItems.slice(0, limits.maxTimelineItems);
    condensed = true;
  }
  if (timeItems.length === 0) return null;

  const refIds = timeItems.map((t) => t.ref);
  return {
    kind,
    items: timeItems,
    sourceRefs: dedupeRefs(resolve(view, refIds).flatMap((i) => i.sourceRefs)),
    condensed,
  };
}

/* ------------------------------------------------------------------ */
/* dataflow — from real PRODUCES / CONSUMES / DERIVED_FROM relations   */
/* ------------------------------------------------------------------ */

/** Relations that describe data being produced, consumed or transformed. */
const DATAFLOW_RELATION_TYPES = new Set(["PRODUCES", "CONSUMES", "DERIVED_FROM"]);

/** The vendored dataflow / sequence node vocabulary. */
type ComponentType =
  | "frontend"
  | "backend"
  | "database"
  | "cloud"
  | "security"
  | "messagebus"
  | "external";

/** ProjectKnowledge entity → vendored visual engine componentType for a dataflow node. */
function dataflowNodeType(item: KnowledgeItem): ComponentType {
  if (item.collection === "actors") {
    return String(item.raw["type"] ?? "") === "system" ? "backend" : "external";
  }
  if (item.collection === "components") {
    switch (String(item.raw["kind"] ?? "")) {
      case "ui":
        return "frontend";
      case "store":
        return "database";
      case "gateway":
        return "cloud";
      case "external":
        return "external";
      default:
        return "backend";
    }
  }
  if (item.collection === "dependencies" || item.collection === "technologies") return "external";
  if (item.collection === "metrics" || item.collection === "results") return "database";
  return "backend";
}

function dataflowStageLabels(n: number): { label: string }[] {
  if (n <= 2) return [{ label: "Source" }, { label: "Sink" }];
  if (n === 3) return [{ label: "Source" }, { label: "Processing" }, { label: "Sink" }];
  return Array.from({ length: n }, (_v, i) => ({
    label: i === 0 ? "Source" : i === n - 1 ? "Sink" : `Stage ${i + 1}`,
  }));
}

interface DirectedEdge {
  relId: Id;
  relType: string;
  from: Id;
  to: Id;
}

/**
 * Build a dataflow model straight from `ProjectKnowledge` relations — never
 * from prose. A directed data edge is derived per relation:
 *  - `A PRODUCES B`      → data flows A → B
 *  - `A CONSUMES B`      → data flows B → A
 *  - `A DERIVED_FROM B`  → data flows B → A
 *
 * Nodes are the real entities those edges touch; stages are a longest-path
 * layering (deterministic, ties by id). Back edges that would make the graph
 * cyclic are dropped (`condensed: true`) rather than fed to the geometry
 * planner as invalid geometry. Returns `null` when there is no PRODUCES /
 * CONSUMES / DERIVED_FROM evidence, or when nothing placeable survives.
 *
 * The Slice 2a geometry planner (`placeDataflow`) assigns each node's `row`
 * and each flow's `route`; this builder only produces the semantic graph.
 */
export function buildDataflowModel(
  view: KnowledgeView,
  ids: readonly Id[],
  limits: VisualLimits,
): DiagramModel | null {
  const items = resolve(view, ids);
  const relItems = items
    .filter(
      (i) =>
        i.collection === "relations" &&
        DATAFLOW_RELATION_TYPES.has(String(i.raw["type"])) &&
        typeof i.raw["from"] === "string" &&
        typeof i.raw["to"] === "string",
    )
    .sort(byId);

  const edges: DirectedEdge[] = [];
  const edgeSeen = new Set<string>();
  for (const r of relItems) {
    const a = r.raw["from"] as string;
    const b = r.raw["to"] as string;
    const ai = view.byId.get(a);
    const bi = view.byId.get(b);
    if (!ai || !bi || ai.collection === "relations" || bi.collection === "relations") continue;
    const relType = String(r.raw["type"]);
    const from = relType === "PRODUCES" ? a : b;
    const to = relType === "PRODUCES" ? b : a;
    if (from === to) continue;
    const key = `${from} ${to}`;
    if (edgeSeen.has(key)) continue;
    edgeSeen.add(key);
    edges.push({ relId: r.id, relType, from, to });
  }
  if (edges.length === 0) return null;

  let condensed = false;
  const nodeIds = [...new Set(edges.flatMap((e) => [e.from, e.to]))].sort(cmp);

  // ---- cycle break: DFS, drop any edge that points back to a node on the stack
  const color = new Map<Id, 0 | 1 | 2>(nodeIds.map((id) => [id, 0]));
  const outEdges = new Map<Id, DirectedEdge[]>();
  for (const e of edges) {
    const list = outEdges.get(e.from);
    if (list) list.push(e);
    else outEdges.set(e.from, [e]);
  }
  const acyclic: DirectedEdge[] = [];
  const dfs = (u: Id): void => {
    color.set(u, 1);
    for (const e of (outEdges.get(u) ?? []).slice().sort((x, y) => cmp(x.to, y.to))) {
      const c = color.get(e.to);
      if (c === 1) {
        condensed = true; // back edge → cycle; drop it
        continue;
      }
      acyclic.push(e);
      if (c === 0) dfs(e.to);
    }
    color.set(u, 2);
  };
  for (const id of nodeIds) if (color.get(id) === 0) dfs(id);
  if (acyclic.length === 0) return null;

  // ---- longest-path layering over the acyclic edge set
  const stageOf = new Map<Id, number>(nodeIds.map((id) => [id, 0]));
  for (let pass = 0; pass < nodeIds.length; pass += 1) {
    let changed = false;
    for (const e of acyclic) {
      const want = (stageOf.get(e.from) ?? 0) + 1;
      if (want > (stageOf.get(e.to) ?? 0)) {
        stageOf.set(e.to, want);
        changed = true;
      }
    }
    if (!changed) break;
  }

  // ---- caps: total nodes, stage count (2..5), rows per stage (<=5)
  let keptNodeIds = nodeIds;
  if (keptNodeIds.length > limits.maxDiagramNodes) {
    keptNodeIds = keptNodeIds.slice(0, limits.maxDiagramNodes);
    condensed = true;
  }
  let maxStage = 0;
  for (const id of keptNodeIds) maxStage = Math.max(maxStage, stageOf.get(id) ?? 0);
  if (maxStage >= 5) {
    keptNodeIds = keptNodeIds.filter((id) => (stageOf.get(id) ?? 0) < 5);
    condensed = true;
    maxStage = 4;
  }
  // rows-per-stage budget (vendored renderer: <= 5 nodes in the widest stage)
  const perStage = new Map<number, Id[]>();
  for (const id of keptNodeIds.slice().sort(cmp)) {
    const s = stageOf.get(id) ?? 0;
    const list = perStage.get(s) ?? [];
    if (list.length < 5) list.push(id);
    else condensed = true;
    perStage.set(s, list);
  }
  keptNodeIds = [...perStage.values()].flat();
  const keptSet = new Set(keptNodeIds);

  const keptEdges = acyclic.filter(
    (e) =>
      keptSet.has(e.from) &&
      keptSet.has(e.to) &&
      (stageOf.get(e.to) ?? 0) >= (stageOf.get(e.from) ?? 0),
  );
  if (keptEdges.length < acyclic.length) condensed = true;

  const stageCount = maxStage + 1;
  if (keptNodeIds.length < 2 || keptEdges.length === 0 || stageCount < 2 || stageCount > 5) {
    return null;
  }

  const nodes: DataFlowNode[] = keptNodeIds
    .slice()
    .sort((a, b) => {
      const sa = stageOf.get(a) ?? 0;
      const sb = stageOf.get(b) ?? 0;
      return sa !== sb ? sa - sb : cmp(a, b);
    })
    .map((id) => {
      const it = view.byId.get(id) as KnowledgeItem;
      return {
        id: `df-${id}`,
        type: dataflowNodeType(it),
        label: clampParticipantLabel(it.text),
        stage: stageOf.get(id) ?? 0,
        entityId: id,
      };
    });

  const flowLabel = (t: string): string =>
    t === "PRODUCES" ? "produces" : t === "CONSUMES" ? "consumes" : "derived from";
  const flows: DataFlowFlow[] = keptEdges
    .slice()
    .sort((a, b) => cmp(a.relId, b.relId))
    .map((e) => ({
      id: `dff-${e.relId}`,
      from: `df-${e.from}`,
      to: `df-${e.to}`,
      label: flowLabel(e.relType),
      relationId: e.relId,
    }));

  const relById = new Map(relItems.map((r) => [r.id, r] as const));
  const sourceRefs = dedupeRefs([
    ...resolve(
      view,
      keptEdges.map((e) => e.relId),
    ).flatMap((i) => i.sourceRefs),
    ...keptEdges.flatMap((e) => relById.get(e.relId)?.sourceRefs ?? []),
    ...resolve(view, keptNodeIds).flatMap((i) => i.sourceRefs),
  ]);

  return {
    kind: "dataflow",
    stages: dataflowStageLabels(stageCount),
    nodes,
    flows,
    sourceRefs,
    condensed,
  };
}

/* ------------------------------------------------------------------ */
/* lifecycle — only from a real phase + PRECEDES state structure       */
/* ------------------------------------------------------------------ */

/**
 * Minimum evidence for an automatic lifecycle (documented policy, Slice 2B §4):
 * `ProjectKnowledge` has **no** first-class state/transition entity, so a
 * lifecycle is only built when the referenced knowledge carries a real
 * state-transition shape:
 *
 *   - ≥ 2 referenced `phases`, **and**
 *   - ≥ 1 `PRECEDES` relation whose both endpoints are referenced phases
 *     (phase → phase ordering = a state transition).
 *
 * Phase `status` maps to a state type (`done`→success, `active`→active,
 * `blocked`/`cancelled`→failure, `planned`→neutral; the first phase in the
 * PRECEDES order is `start`). When this evidence is absent the builder returns
 * `null` and the caller falls back to `process` (workflow) or `summary` —
 * never a lifecycle invented from prose.
 */
export function buildLifecycleModel(
  view: KnowledgeView,
  ids: readonly Id[],
  limits: VisualLimits,
): DiagramModel | null {
  const items = resolve(view, ids);
  const phaseItems = items.filter((i) => i.collection === "phases").sort(byId);
  if (phaseItems.length < 2) return null;
  const phaseIds = new Set(phaseItems.map((p) => p.id));

  const precedes = items
    .filter(
      (i) =>
        i.collection === "relations" &&
        i.raw["type"] === "PRECEDES" &&
        typeof i.raw["from"] === "string" &&
        typeof i.raw["to"] === "string" &&
        phaseIds.has(i.raw["from"] as string) &&
        phaseIds.has(i.raw["to"] as string),
    )
    .sort(byId);
  if (precedes.length === 0) return null;

  // linear order seeded by the PRECEDES edges, then any leftover phases by id
  const order: Id[] = [];
  const seen = new Set<Id>();
  const push = (id: Id): void => {
    if (!seen.has(id) && phaseIds.has(id)) {
      seen.add(id);
      order.push(id);
    }
  };
  for (const r of precedes) {
    push(r.raw["from"] as string);
    push(r.raw["to"] as string);
  }
  for (const p of phaseItems) push(p.id);

  let condensed = false;
  const budget = Math.min(5, limits.maxDiagramSteps);
  let keptOrder = order;
  if (keptOrder.length > budget) {
    keptOrder = keptOrder.slice(0, budget);
    condensed = true;
  }
  const keptSet = new Set(keptOrder);
  if (keptSet.size < 2) return null;

  const stateType = (raw: Record<string, unknown>, isFirst: boolean): LifecycleState["type"] => {
    if (isFirst) return "start";
    switch (String(raw["status"] ?? "")) {
      case "done":
        return "success";
      case "active":
        return "active";
      case "blocked":
      case "cancelled":
        return "failure";
      default:
        return "neutral";
    }
  };

  const states: LifecycleState[] = keptOrder.map((id, index) => {
    const it = view.byId.get(id) as KnowledgeItem;
    return {
      id: `lcs-${id}`,
      type: stateType(it.raw, index === 0),
      label: clampParticipantLabel(it.text),
      lane: "main",
      ref: id,
    };
  });

  const transitions: LifecycleTransition[] = precedes
    .filter((r) => keptSet.has(r.raw["from"] as string) && keptSet.has(r.raw["to"] as string))
    .map((r) => {
      const t: LifecycleTransition = {
        id: `lct-${r.id}`,
        from: `lcs-${r.raw["from"] as string}`,
        to: `lcs-${r.raw["to"] as string}`,
        relationId: r.id,
      };
      const label = typeof r.raw["label"] === "string" ? (r.raw["label"] as string).trim() : "";
      if (label !== "") t.label = label;
      return t;
    });
  if (transitions.length === 0) return null;
  if (transitions.length < precedes.length) condensed = true;

  const sourceRefs = dedupeRefs([
    ...precedes.flatMap((r) => r.sourceRefs),
    ...resolve(view, keptOrder).flatMap((i) => i.sourceRefs),
  ]);

  return {
    kind: "lifecycle",
    lanes: [{ id: "main", label: "Lifecycle" }],
    states,
    transitions,
    sourceRefs,
    condensed,
  };
}

/* ------------------------------------------------------------------ */
/* adapter: DiagramModel -> DiagramIR                                  */
/* ------------------------------------------------------------------ */

export interface DiagramAdapter {
  readonly engine: "native" | "visual";
  supports(model: DiagramModel): boolean;
  /** Pure. `id` and (optional) `title` are supplied by the caller. */
  toDiagramIR(model: DiagramModel, id: Id, title: string | undefined): DiagramIR;
}

const MODEL_TO_DIAGRAM_TYPE: Record<DiagramModel["kind"], DiagramType> = {
  architecture: "architecture",
  process: "workflow",
  sequence: "sequence",
  dataflow: "dataflow",
  lifecycle: "lifecycle",
  timeline: "timeline",
  roadmap: "roadmap",
};

/** The only adapter Phase 4 ships. Emits a structured `arclume.native.v1` spec. */
export const nativeDiagramAdapter: DiagramAdapter = {
  engine: "native",
  supports: () => true,
  toDiagramIR(model, id, title) {
    const base = {
      id,
      engine: "native" as const,
      diagramType: MODEL_TO_DIAGRAM_TYPE[model.kind],
      ...(title !== undefined ? { title } : {}),
      sourceRefs: model.sourceRefs,
    };
    switch (model.kind) {
      case "architecture":
        return {
          ...base,
          spec: {
            format: NATIVE_SPEC_FORMAT,
            kind: "architecture",
            condensed: model.condensed,
            nodes: model.nodes,
            edges: model.edges,
          },
        };
      case "process":
        return {
          ...base,
          spec: {
            format: NATIVE_SPEC_FORMAT,
            kind: "process",
            condensed: model.condensed,
            steps: model.steps,
            edges: model.edges,
          },
        };
      case "sequence":
        // A participant-aware sequence emits the visual-engine-shaped spec (which the
        // engine preference then routes to the visual engine); otherwise the native
        // {steps, edges} spec, rendered by the native sequence renderer.
        return model.participants !== undefined && model.messages !== undefined
          ? {
              ...base,
              spec: {
                format: NATIVE_SPEC_FORMAT,
                kind: "sequence",
                condensed: model.condensed,
                participants: model.participants.map((p) => ({
                  id: p.id,
                  type: p.type,
                  label: p.label,
                })),
                messages: model.messages.map((m) => ({
                  id: m.id,
                  from: m.from,
                  to: m.to,
                  y: m.y,
                  label: m.label,
                  ...(m.variant !== undefined ? { variant: m.variant } : {}),
                })),
              },
            }
          : {
              ...base,
              spec: {
                format: NATIVE_SPEC_FORMAT,
                kind: "sequence",
                condensed: model.condensed,
                steps: model.steps,
                edges: model.edges,
              },
            };
      case "dataflow":
        return {
          ...base,
          spec: {
            format: NATIVE_SPEC_FORMAT,
            kind: "dataflow",
            condensed: model.condensed,
            stages: model.stages,
            nodes: model.nodes,
            flows: model.flows,
          },
        };
      case "lifecycle":
        return {
          ...base,
          spec: {
            format: NATIVE_SPEC_FORMAT,
            kind: "lifecycle",
            condensed: model.condensed,
            lanes: model.lanes,
            states: model.states,
            transitions: model.transitions,
          },
        };
      case "timeline":
      case "roadmap":
        return {
          ...base,
          spec: {
            format: NATIVE_SPEC_FORMAT,
            kind: model.kind,
            condensed: model.condensed,
            items: model.items,
          },
        };
    }
  },
};

/** Every real knowledge id a model references — for structural validation. */
export function modelKnowledgeRefs(model: DiagramModel): string[] {
  switch (model.kind) {
    case "architecture":
      return [...model.nodes.map((n) => n.entityId), ...model.edges.map((e) => e.relationId)];
    case "process":
    case "sequence":
      return [...model.steps.map((s) => s.ref), ...model.edges.map((e) => e.relationId)];
    case "dataflow":
      return [
        ...model.nodes.map((n) => n.entityId ?? ""),
        ...model.flows.map((f) => f.relationId ?? ""),
      ].filter(Boolean);
    case "lifecycle":
      return [
        ...model.states.map((s) => s.ref ?? ""),
        ...model.transitions.map((t) => t.relationId ?? ""),
      ].filter(Boolean);
    case "timeline":
    case "roadmap":
      return model.items.map((i) => i.ref);
  }
}
