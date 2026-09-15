/**
 * ARCLUME Visual Engine types.
 *
 * The visual engine has its own JSON IR (schema_version 1 architecture, schema_version 2
 * workflow). That IR lives exclusively here — the `ArclumeDeck` semantic spec
 * (`format: "arclume.native.v1"`) remains the only semantic representation in
 * the deck, for both engines.
 */

import type { ResolvedDiagramProvenance } from "../types.js";

export const NATIVE_SPEC_FORMAT = "arclume.native.v1" as const;

/** Visual engine id rule (`schemas/common.schema.json` `#/$defs/id`). */
export const VISUAL_ENGINE_ID_RE = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

/**
 * The visual engine schema requires a `component.type`. ARCLUME does not know whether a
 * node is a frontend/backend/… — and must never infer it from labels, group
 * names or technologies. This sentinel is schema plumbing only; the sanitizer
 * removes every semantic trace of it (classes, sigils, data attributes) from
 * the final SVG.
 */
export const VISUAL_ENGINE_COMPONENT_TYPE_SENTINEL = "external" as const;

/** Hard capacity for a single visual engine workflow (`col` 0..5). */
export const VISUAL_ENGINE_WORKFLOW_CAPACITY = 6 as const;

/* ------------------------------------------------------------------ */
/* Normalized native specs (validated `DiagramIR.spec`)                */
/* ------------------------------------------------------------------ */

export interface NativeArchitectureNode {
  /** Visual node id (grid placement / visual engine component id). */
  id: string;
  label: string;
  /** Real ProjectKnowledge entity id — REQUIRED for visual engine (P1-1). */
  entityId: string;
}

export interface NativeEdge {
  /** Visual edge id (visual engine connection id). */
  id: string;
  from: string;
  to: string;
  label?: string;
  /** Real ProjectKnowledge relation id — REQUIRED for visual engine (P1-1). */
  relationId: string;
}

export interface NativeArchitectureSpec {
  format: typeof NATIVE_SPEC_FORMAT;
  kind: "architecture";
  condensed?: boolean;
  nodes: NativeArchitectureNode[];
  edges: NativeEdge[];
}

export interface NativeWorkflowStep {
  id: string;
  label: string;
  index: number;
  /** Real ProjectKnowledge process/entity reference — REQUIRED (P1-1). */
  ref: string;
}

export interface NativeWorkflowSpec {
  format: typeof NATIVE_SPEC_FORMAT;
  kind: "workflow";
  condensed?: boolean;
  steps: NativeWorkflowStep[];
  edges: NativeEdge[];
}

export interface NativeDataflowSpec {
  format: typeof NATIVE_SPEC_FORMAT;
  kind: "dataflow";
  condensed?: boolean;
  stages: { label: string }[];
  nodes: Array<{
    id: string;
    type: string;
    label: string;
    sublabel?: string;
    tag?: string;
    stage: number;
    /** Row within the stage. Optional: when every node omits it the adapter's
     * deterministic geometry planner assigns it; a partial set is rejected. */
    row?: number;
    width?: number;
    height?: number;
    yOffset?: number;
  }>;
  flows: Array<{
    id: string;
    from: string;
    to: string;
    label: string;
    classification?: string;
    variant?: string;
    route?: "auto" | "straight" | "vertical-channel" | "bottom-channel" | "top-channel";
  }>;
}

export interface NativeLifecycleSpec {
  format: typeof NATIVE_SPEC_FORMAT;
  kind: "lifecycle";
  condensed?: boolean;
  lanes: { id: string; label: string }[];
  states: Array<{
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
    /** Column within the band. Optional: when every state omits it the adapter's
     * deterministic geometry planner assigns it; a partial set is rejected. */
    col?: number;
    width?: number;
    height?: number;
    yOffset?: number;
  }>;
  transitions: Array<{
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
  }>;
}

export interface NativeSequenceSpec {
  format: typeof NATIVE_SPEC_FORMAT;
  kind: "sequence";
  condensed?: boolean;
  participants: Array<{
    id: string;
    type: string;
    label: string;
    sublabel?: string;
    brand?: string;
  }>;
  messages: Array<{
    id: string;
    from: string;
    to: string;
    y: number;
    label: string;
    variant?: "default" | "emphasis" | "security" | "dashed" | "return";
    note?: string;
  }>;
  activations?: Array<{
    participant: string;
    from: number;
    to: number;
    type?: string;
  }>;
  segments?: Array<{
    from: number;
    to: number;
    label: string;
  }>;
}

export type NativeDiagramSpec =
  | NativeArchitectureSpec
  | NativeWorkflowSpec
  | NativeDataflowSpec
  | NativeLifecycleSpec
  | NativeSequenceSpec;

/* ------------------------------------------------------------------ */
/* Visual Engine request IR                                           */
/* ------------------------------------------------------------------ */

export interface VisualEngineMeta {
  title: string;
  animation: "none";
  visual_preset: "classic";
  legend: { mode: "hidden" };
  /** Explicit canvas size. Emitted by the dataflow / lifecycle geometry
   * planner so the vendored renderer's viewBox fits the placed graph. */
  viewBox?: readonly [number, number];
}

export interface VisualEngineComponent {
  id: string;
  type: typeof VISUAL_ENGINE_COMPONENT_TYPE_SENTINEL;
  label: string;
  row: number;
  col: number;
  /** Presentational dimensions; sized deterministically from the label. */
  size?: readonly [number, number];
}

export interface VisualEngineConnection {
  id: string;
  from: string;
  to: string;
  label?: string;
  /** Deterministic vertical offset for same-row edge labels. */
  labelDy?: number;
}

export interface VisualEngineArchitectureRequest {
  schema_version: 1;
  diagram_type: "architecture";
  meta: VisualEngineMeta;
  layout: { mode: "grid"; cols: number };
  components: VisualEngineComponent[];
  connections: VisualEngineConnection[];
}

export interface VisualEngineWorkflowNode {
  id: string;
  lane: "main";
  col: number;
  type: typeof VISUAL_ENGINE_COMPONENT_TYPE_SENTINEL;
  label: string;
  width: number;
}

export interface VisualEngineWorkflowEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
}

export interface VisualEngineWorkflowRequest {
  schema_version: 2;
  diagram_type: "workflow";
  meta: VisualEngineMeta;
  lanes: [{ id: "main"; label: string }];
  nodes: VisualEngineWorkflowNode[];
  edges: VisualEngineWorkflowEdge[];
  mainPath?: string[];
}

/* ------------------------------------------------------------------ */
/* Dataflow request IR                                                 */
/* ------------------------------------------------------------------ */

export interface VisualEngineDataflowNode {
  id: string;
  type: string;
  label: string;
  sublabel?: string;
  tag?: string;
  stage: number;
  row: number;
  width?: number;
  height?: number;
  yOffset?: number;
}

export interface VisualEngineDataflowFlow {
  id: string;
  from: string;
  to: string;
  label: string;
  classification?: string;
  variant?: string;
  route?: "auto" | "straight" | "vertical-channel" | "bottom-channel" | "top-channel";
}

export interface VisualEngineDataflowRequest {
  schema_version: 1;
  diagram_type: "dataflow";
  meta: VisualEngineMeta;
  stages: { label: string }[];
  nodes: VisualEngineDataflowNode[];
  flows: VisualEngineDataflowFlow[];
}

/* ------------------------------------------------------------------ */
/* Lifecycle request IR                                                */
/* ------------------------------------------------------------------ */

export interface VisualEngineLifecycleState {
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
  col: number;
  width?: number;
  height?: number;
  yOffset?: number;
}

export interface VisualEngineLifecycleTransition {
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
}

export interface VisualEngineLifecycleRequest {
  schema_version: 1;
  diagram_type: "lifecycle";
  meta: VisualEngineMeta;
  lanes: { id: string; label: string }[];
  states: VisualEngineLifecycleState[];
  transitions: VisualEngineLifecycleTransition[];
}

/* ------------------------------------------------------------------ */
/* Sequence request IR                                                 */
/* ------------------------------------------------------------------ */

export interface VisualEngineSequenceParticipant {
  id: string;
  type: string;
  label: string;
  sublabel?: string;
  brand?: string;
}

export interface VisualEngineSequenceMessage {
  id: string;
  from: string;
  to: string;
  y: number;
  label: string;
  variant?: "default" | "emphasis" | "security" | "dashed" | "return";
  note?: string;
}

export interface VisualEngineSequenceActivation {
  participant: string;
  from: number;
  to: number;
  type?: string;
}

export interface VisualEngineSequenceRequest {
  schema_version: 1;
  diagram_type: "sequence";
  meta: VisualEngineMeta;
  participants: VisualEngineSequenceParticipant[];
  segments?: { from: number; to: number; label: string }[];
  messages: VisualEngineSequenceMessage[];
  activations?: VisualEngineSequenceActivation[];
}

export type VisualEngineRequest =
  | VisualEngineArchitectureRequest
  | VisualEngineWorkflowRequest
  | VisualEngineDataflowRequest
  | VisualEngineLifecycleRequest
  | VisualEngineSequenceRequest;

/* ------------------------------------------------------------------ */
/* Adapter outcome                                                     */
/* ------------------------------------------------------------------ */

/**
 * Ordering metadata: the exact deterministic identity orderings the request
 * was built from. Used by validation / tests, never required by visual engine.
 */
export interface VisualEngineOrdering {
  /** Component ids sorted ascending (architecture). */
  componentOrder: string[];
  /** Connection ids in authored spec order. */
  connectionOrder: string[];
  /** Step ids in explicit `step.index` order (workflow). */
  stepOrder: string[];
}

/**
 * The semantic ↔ visual identity maps for one diagram (P1-1). The sanitizer
 * uses them to inject real `ProjectKnowledge` provenance; the final-form
 * validator derives the same maps from the deck spec for independent checks.
 */
export interface VisualEngineProvenanceMaps {
  /** visual node id → real entityId (architecture). */
  nodeToEntity: Map<string, string>;
  /** visual edge id → real relationId. */
  edgeToRelation: Map<string, string>;
  /** step id → real ref (workflow). */
  stepToRef: Map<string, string>;
  /** visual edge id → authored direction (visual node ids). */
  edgeDirection: Map<string, { from: string; to: string }>;
}

export interface VisualEngineAdaptation {
  kind: "ok";
  diagramId: string;
  visualKind: "architecture" | "workflow" | "dataflow" | "lifecycle" | "sequence";
  request: VisualEngineRequest;
  /** Deterministic hash of the source semantic diagram spec. */
  specHash: string;
  provenance: ResolvedDiagramProvenance;
  ordering: VisualEngineOrdering;
  /** Semantic ↔ visual identity maps. */
  maps: VisualEngineProvenanceMaps;
  /** The validated, normalized native spec the request was built from. */
  spec: NativeDiagramSpec;
}

export interface VisualEngineAdaptationFailure {
  kind: "error";
  diagramId: string;
  code: string;
  message: string;
}

export type VisualEngineAdaptationResult = VisualEngineAdaptation | VisualEngineAdaptationFailure;
