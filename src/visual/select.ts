/**
 * Automatic visual intent selection (Visual Intelligence, Slice 2B §2 / §5).
 *
 * The Visual Director does not depend on the planner naming the right diagram.
 * `selectDiagramKind` reads **structured** knowledge signals — relation types,
 * PRODUCES/CONSUMES vs PRECEDES balance, phase/state structure, dated vs future
 * temporal evidence, component topology — and names the diagram the evidence
 * actually supports. Keyword/text matching is never used.
 *
 * The ambiguity policy is deterministic and encoded as a fixed decision order
 * (structural signal wins; every tie breaks the same way). Same
 * `ProjectKnowledge` + same considered ids ⇒ same pick. No clock, no RNG, no
 * network, no filesystem.
 */

import type { KnowledgeItem, KnowledgeView } from "../narrative/knowledge-view.js";
import type { PlannedSlide } from "../planning/types.js";
import type { Id } from "../types/common.js";
import { type ResolvedVisual, evidenceRefsOf, intentToKind, resolveVisual } from "./intent.js";
import {
  buildArchitectureModel,
  buildDataflowModel,
  buildFlowModel,
  buildLifecycleModel,
  buildTimelineModel,
} from "./models.js";
import type { VisualKind, VisualLimits, VisualReasonCode } from "./types.js";

export interface AutoVisual {
  kind: VisualKind;
  reasonCode: VisualReasonCode;
  reason: string;
  /** ids weighed (== the considered ids passed in). */
  consideredRefs: Id[];
}

const DATA_MOVEMENT = new Set(["PRODUCES", "CONSUMES", "DERIVED_FROM"]);
const STRUCTURAL = new Set([
  "DEPENDS_ON",
  "PART_OF",
  "USES_TECHNOLOGY",
  "IMPLEMENTS",
  "OWNS",
  "RESPONSIBLE_FOR",
]);
const ACTOR_COMPONENT = new Set(["actors", "components"]);

function considered(slide: PlannedSlide): Id[] {
  return [...new Set([...slide.knowledgeRefs, ...(slide.visualCandidates ?? [])])];
}

function relationsOf(view: KnowledgeView, ids: readonly Id[]): KnowledgeItem[] {
  const out: KnowledgeItem[] = [];
  for (const id of ids) {
    const item = view.byId.get(id);
    if (item?.collection === "relations") out.push(item);
  }
  return out;
}

/**
 * Name the diagram the structural evidence supports, or `null` when nothing
 * structural does (the caller then keeps the planner's intent-driven result).
 * Deterministic: the decision order below IS the ambiguity policy.
 */
export function selectDiagramKind(
  view: KnowledgeView,
  refs: readonly Id[],
  limits: VisualLimits,
): AutoVisual | null {
  // `consideredRefs` is sorted so the decision never depends on caller order.
  const consideredRefs = [...new Set(refs)].sort();
  const pick = (kind: VisualKind, reasonCode: VisualReasonCode, reason: string): AutoVisual => ({
    kind,
    reasonCode,
    reason,
    consideredRefs,
  });

  // Models double as structural predicates: if a model builds, the evidence
  // for that kind is real (each builder already enforces its own rules).
  const dataflow = buildDataflowModel(view, refs, limits);
  const lifecycle = buildLifecycleModel(view, refs, limits);
  const sequence = buildFlowModel(view, refs, "sequence", limits);
  const workflow = buildFlowModel(view, refs, "process", limits);
  const architecture = buildArchitectureModel(view, refs, limits);
  const timeline = buildTimelineModel(view, refs, "timeline", limits);
  const roadmap = buildTimelineModel(view, refs, "roadmap", limits);

  const rels = relationsOf(view, refs);
  const nData = rels.filter((r) => DATA_MOVEMENT.has(String(r.raw["type"]))).length;
  const nStructural = rels.filter((r) => STRUCTURAL.has(String(r.raw["type"]))).length;

  const phaseIds = new Set(
    refs
      .map((id) => view.byId.get(id))
      .filter((i) => i?.collection === "phases")
      .map((i) => i?.id),
  );
  const precedes = rels.filter((r) => r.raw["type"] === "PRECEDES");
  const nPrecedesPhases = precedes.filter(
    (r) => phaseIds.has(r.raw["from"] as string) && phaseIds.has(r.raw["to"] as string),
  ).length;
  const nPrecedesActors = precedes.filter((r) => {
    const a = view.byId.get(r.raw["from"] as string);
    const b = view.byId.get(r.raw["to"] as string);
    return (
      a !== undefined &&
      b !== undefined &&
      a.id !== b.id &&
      ACTOR_COMPONENT.has(a.collection) &&
      ACTOR_COMPONENT.has(b.collection)
    );
  }).length;
  const nPrecedesSteps = precedes.length - nPrecedesPhases;

  const phasesWithStatus = refs
    .map((id) => view.byId.get(id))
    .filter((i) => i?.collection === "phases" && typeof i.raw["status"] === "string").length;
  const lifecycleDeclined = !lifecycle && phasesWithStatus >= 2 && nPrecedesPhases === 0;

  // The largest explicit step list among referenced process entities (a real
  // workflow signal, distinct from a PRECEDES chain).
  const processStepCount = refs.reduce((max, id) => {
    const it = view.byId.get(id);
    if (it?.collection !== "processes" || !Array.isArray(it.raw["steps"])) return max;
    return Math.max(max, (it.raw["steps"] as unknown[]).length);
  }, 0);
  const hasProcessSteps = processStepCount > 0;

  // `reasonCode` names the ambiguity axis; `kind` names the winner. So
  // `kind:"dataflow"` + `ambiguity-architecture-vs-dataflow` reads as
  // "on the architecture-vs-dataflow question, dataflow won".

  // 1) data movement vs component topology / step ordering
  if (dataflow) {
    const archRival = architecture !== null && nStructural > 0;
    const wfRival = workflow !== null && (hasProcessSteps || nPrecedesSteps > 0);
    if (archRival && nStructural > nData) {
      return pick(
        "architecture",
        "ambiguity-architecture-vs-dataflow",
        `component topology (${nStructural} structural relations) outweighs data movement (${nData})`,
      );
    }
    if (wfRival && nPrecedesSteps > nData) {
      return pick(
        "process",
        "ambiguity-workflow-vs-dataflow",
        `step ordering (${nPrecedesSteps} PRECEDES) outweighs data movement (${nData})`,
      );
    }
    const code = wfRival
      ? "ambiguity-workflow-vs-dataflow"
      : archRival
        ? "ambiguity-architecture-vs-dataflow"
        : "auto-dataflow";
    return pick(
      "dataflow",
      code,
      `PRODUCES / CONSUMES / DERIVED_FROM predominates (${nData} data relations)`,
    );
  }

  // 2) state-transition structure vs step ordering
  if (lifecycle) {
    const workflowSignal = Math.max(processStepCount, nPrecedesSteps);
    if (workflow && workflowSignal > nPrecedesPhases) {
      return pick(
        "process",
        "ambiguity-workflow-vs-lifecycle",
        `step ordering (${workflowSignal}) outweighs phase-state transitions (${nPrecedesPhases})`,
      );
    }
    return pick(
      "lifecycle",
      "lifecycle-structure-sufficient",
      `${nPrecedesPhases} PRECEDES relation(s) among referenced phases form a state machine`,
    );
  }

  // 3) ordered interactions between distinct actors/components vs a plain process
  const seqParticipants =
    sequence !== null && sequence.kind === "sequence" ? (sequence.participants ?? []) : [];
  if (nPrecedesActors >= 1 || seqParticipants.length >= 2) {
    return pick(
      "sequence",
      hasProcessSteps ? "ambiguity-sequence-vs-workflow" : "auto-sequence",
      `PRECEDES between ${nPrecedesActors || seqParticipants.length} distinct actors/components`,
    );
  }
  if (workflow) {
    return lifecycleDeclined
      ? pick(
          "process",
          "lifecycle-insufficient-structure",
          "phases carry status but no PRECEDES links them — shown as a workflow, not a lifecycle",
        )
      : pick("process", "auto-workflow", "real steps or PRECEDES relations support a workflow");
  }

  // 4) component topology
  if (architecture) {
    return pick(
      "architecture",
      "auto-architecture",
      "components and ≥1 real relation connect them",
    );
  }

  // 5) dated past events vs future milestones/phases
  if (timeline) {
    return pick(
      "timeline",
      roadmap ? "ambiguity-timeline-vs-roadmap" : "auto-timeline",
      "dated milestones / phases give a historical progression",
    );
  }
  if (roadmap) {
    return pick("roadmap", "auto-roadmap", "phases / milestones give a forward progression");
  }

  return null;
}

/**
 * Reconcile the planner's `visualIntent` with the automatic structural pick.
 *
 * - agree, or nothing structural to say → the planner-driven `resolveVisual`;
 * - planner intent unsupported (would downgrade), or generic
 *   (`summary` / `relationship`), or a `process` intent that the data / state
 *   structure overrides → adopt the structural pick (outcome `refined`);
 * - otherwise keep the planner-driven result.
 */
export function selectVisualIntent(
  slide: PlannedSlide,
  view: KnowledgeView,
  limits: VisualLimits,
): ResolvedVisual {
  const base = resolveVisual(slide, view, limits);
  if (slide.kind === "cover" || slide.kind === "closing" || slide.visualIntent === "none") {
    return base;
  }

  const refs = considered(slide);
  const auto = selectDiagramKind(view, refs, limits);
  if (!auto || auto.kind === base.visualKind) return base;

  const intentKind = intentToKind(slide.visualIntent);
  const override =
    base.outcome === "downgraded" ||
    slide.visualIntent === "summary" ||
    slide.visualIntent === "relationship" ||
    (intentKind === "process" && (auto.kind === "dataflow" || auto.kind === "lifecycle"));

  if (!override) return base;

  return {
    visualKind: auto.kind,
    outcome: "refined",
    reasonCode: auto.reasonCode,
    reason: `auto-selected ${auto.kind}: ${auto.reason}`,
    consideredRefs: refs,
    evidenceRefs: evidenceRefsOf(view, refs),
    ...(base.visualKind !== auto.kind ? { fallbackKind: base.visualKind } : {}),
  };
}
