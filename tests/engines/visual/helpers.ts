/** Shared fixtures + helpers for the Visual Engine tests. */

import { stableStringify } from "../../../src/determinism/hash.js";
import type { ResolvedDiagramProvenance } from "../../../src/engines/types.js";
import { adaptDiagramToVisualEngine } from "../../../src/engines/visual/adapter.js";
import { runVisualEngine } from "../../../src/engines/visual/runner.js";
import type { SanitizeExpectation } from "../../../src/engines/visual/sanitize.js";
import type { VisualEngineAdaptation } from "../../../src/engines/visual/types.js";
import type { VisualEngineRequest } from "../../../src/engines/visual/types.js";
import type { DiagramIR } from "../../../src/types/deck.js";

/**
 * The architecture fixture keeps *visual* ids strictly separate from the real
 * ProjectKnowledge `entityId` / `relationId` provenance (P1-1).
 */
export function architectureDiagram(over: Partial<DiagramIR> = {}): DiagramIR {
  return {
    id: "d-arch",
    engine: "visual",
    diagramType: "architecture",
    title: "Service Map",
    spec: {
      format: "arclume.native.v1",
      kind: "architecture",
      nodes: [
        { id: "n-ui", label: "Web App", entityId: "cmp-ui" },
        { id: "n-api", label: "API", entityId: "cmp-api" },
        { id: "n-db", label: "Database", entityId: "cmp-db" },
      ],
      edges: [
        { id: "e-ui-api", from: "n-ui", to: "n-api", label: "https", relationId: "rel-ui-api" },
        { id: "e-api-db", from: "n-api", to: "n-db", relationId: "rel-api-db" },
      ],
    },
    ...over,
  };
}

/** Workflow steps carry a real `ref`; edges carry `relationId`. */
export function workflowDiagram(stepCount = 3, over: Partial<DiagramIR> = {}): DiagramIR {
  const steps = Array.from({ length: stepCount }, (_, i) => ({
    id: `s-${i + 1}`,
    label: `Step ${i + 1}`,
    index: i,
    ref: `proc-step-${i + 1}`,
  }));
  const edges = steps.slice(0, -1).map((s, i) => ({
    id: `f-${i}`,
    relationId: `rel-${i}-${i + 1}`,
    from: s.id,
    to: (steps[i + 1] as { id: string }).id,
  }));
  return {
    id: "d-flow",
    engine: "visual",
    diagramType: "workflow",
    title: "Delivery Flow",
    spec: { format: "arclume.native.v1", kind: "process", steps, edges },
    ...over,
  };
}

/**
 * A linear data flow: Client → API → Database. No `row` / `route` — the
 * adapter's deterministic geometry planner places it.
 */
export function dataflowDiagram(over: Partial<DiagramIR> = {}): DiagramIR {
  return {
    id: "d-df",
    engine: "visual",
    diagramType: "dataflow",
    title: "Ingest Path",
    spec: {
      format: "arclume.native.v1",
      kind: "dataflow",
      stages: [{ label: "Source" }, { label: "Process" }, { label: "Store" }],
      nodes: [
        { id: "df-client", type: "frontend", label: "Client", stage: 0 },
        { id: "df-api", type: "backend", label: "API", stage: 1 },
        { id: "df-db", type: "database", label: "Database", stage: 2 },
      ],
      flows: [
        { id: "df-f1", from: "df-client", to: "df-api", label: "request" },
        { id: "df-f2", from: "df-api", to: "df-db", label: "persist" },
      ],
    },
    ...over,
  };
}

/** Single-source fan-out: one source feeds three workers that all write a sink. */
export function dataflowFanOutDiagram(over: Partial<DiagramIR> = {}): DiagramIR {
  return {
    id: "d-dfo",
    engine: "visual",
    diagramType: "dataflow",
    title: "Fan-out",
    spec: {
      format: "arclume.native.v1",
      kind: "dataflow",
      stages: [{ label: "Ingress" }, { label: "Workers" }, { label: "Store" }],
      nodes: [
        { id: "fo-src", type: "frontend", label: "Ingress", stage: 0 },
        { id: "fo-w1", type: "backend", label: "Worker 1", stage: 1 },
        { id: "fo-w2", type: "backend", label: "Worker 2", stage: 1 },
        { id: "fo-w3", type: "backend", label: "Worker 3", stage: 1 },
        { id: "fo-db", type: "database", label: "Store", stage: 2 },
      ],
      flows: [
        { id: "fo-a", from: "fo-src", to: "fo-w1", label: "part a" },
        { id: "fo-b", from: "fo-src", to: "fo-w2", label: "part b" },
        { id: "fo-c", from: "fo-src", to: "fo-w3", label: "part c" },
        { id: "fo-d", from: "fo-w1", to: "fo-db", label: "rows" },
        { id: "fo-e", from: "fo-w2", to: "fo-db", label: "rows" },
        { id: "fo-f", from: "fo-w3", to: "fo-db", label: "rows" },
      ],
    },
    ...over,
  };
}

/**
 * Created → Processing → {Completed | Failed}. No `col` / `route` — the
 * adapter's deterministic geometry planner places it (reserved `main` /
 * `terminal` lanes).
 */
export function lifecycleDiagram(over: Partial<DiagramIR> = {}): DiagramIR {
  return {
    id: "d-lc",
    engine: "visual",
    diagramType: "lifecycle",
    title: "Job Lifecycle",
    spec: {
      format: "arclume.native.v1",
      kind: "lifecycle",
      lanes: [
        { id: "main", label: "Phase" },
        { id: "terminal", label: "Outcome" },
      ],
      states: [
        { id: "lc-created", type: "start", label: "Created", lane: "main" },
        { id: "lc-proc", type: "active", label: "Processing", lane: "main" },
        { id: "lc-done", type: "success", label: "Completed", lane: "terminal" },
        { id: "lc-failed", type: "failure", label: "Failed", lane: "terminal" },
      ],
      transitions: [
        { id: "lc-t1", from: "lc-created", to: "lc-proc", label: "start" },
        { id: "lc-t2", from: "lc-proc", to: "lc-done", label: "ok" },
        { id: "lc-t3", from: "lc-proc", to: "lc-failed", label: "error" },
      ],
    },
    ...over,
  };
}

/** Lifecycle with a recovery (event) lane: Running → Retry → Running, or → Failed. */
export function lifecycleRetryDiagram(over: Partial<DiagramIR> = {}): DiagramIR {
  return {
    id: "d-lcr",
    engine: "visual",
    diagramType: "lifecycle",
    title: "Delivery Lifecycle",
    spec: {
      format: "arclume.native.v1",
      kind: "lifecycle",
      lanes: [
        { id: "main", label: "Phase" },
        { id: "recover", label: "Recovery" },
        { id: "terminal", label: "Outcome" },
      ],
      states: [
        { id: "r-queued", type: "start", label: "Queued", lane: "main" },
        { id: "r-running", type: "active", label: "Running", lane: "main" },
        { id: "r-retry", type: "waiting", label: "Retry", lane: "recover" },
        { id: "r-done", type: "success", label: "Delivered", lane: "terminal" },
        { id: "r-failed", type: "failure", label: "Failed", lane: "terminal" },
      ],
      transitions: [
        // A tight main-rail hop carries no label (vendored design rule: keep
        // rail-transition text out of the SVG); the channel-routed ones do.
        { id: "r-t1", from: "r-queued", to: "r-running" },
        { id: "r-t2", from: "r-running", to: "r-done", label: "ack" },
        { id: "r-t3", from: "r-running", to: "r-retry", label: "error" },
        { id: "r-t4", from: "r-retry", to: "r-running", label: "backoff" },
        { id: "r-t5", from: "r-retry", to: "r-failed", label: "give up" },
      ],
    },
    ...over,
  };
}

/**
 * A raw visual-engine-sequence native spec (participants + messages). Slice 1 does not
 * route `sequence` to the visual engine through the pipeline — this only exercises
 * `adaptSequence` + the vendored sequence renderer directly.
 */
export function sequenceArchifyDiagram(over: Partial<DiagramIR> = {}): DiagramIR {
  return {
    id: "d-sq",
    engine: "visual",
    diagramType: "sequence",
    title: "Auth Handshake",
    spec: {
      format: "arclume.native.v1",
      kind: "sequence",
      participants: [
        { id: "sq-ui", type: "frontend", label: "Browser" },
        { id: "sq-api", type: "backend", label: "API" },
        { id: "sq-idp", type: "security", label: "IdP" },
      ],
      messages: [
        { id: "sq-m1", from: "sq-ui", to: "sq-api", y: 200, label: "GET /login" },
        { id: "sq-m2", from: "sq-api", to: "sq-idp", y: 260, label: "authorize" },
        { id: "sq-m3", from: "sq-idp", to: "sq-api", y: 320, label: "token", variant: "return" },
      ],
    },
    ...over,
  };
}

const htmlCache = new Map<string, string>();

/**
 * Render a request through the real vendored CLI (shared cache keeps the test
 * suite fast while still exercising the actual engine).
 */
export async function renderFixtureHtml(
  kind: "architecture" | "workflow" | "sequence" | "dataflow" | "lifecycle",
  request: VisualEngineRequest,
): Promise<string> {
  const json = stableStringify(request);
  const key = `${kind}:${json}`;
  const cached = htmlCache.get(key);
  if (cached !== undefined) return cached;
  const { html } = await runVisualEngine(kind, json, "fixture");
  htmlCache.set(key, html);
  return html;
}

export function expectOk(
  adapted: VisualEngineAdaptation | { kind: "error" },
): VisualEngineAdaptation {
  if (adapted.kind !== "ok") throw new Error("fixture must adapt");
  return adapted;
}

/** Build the sanitizer expectation for a fixture diagram. */
export function expectationFor(diagram: DiagramIR): SanitizeExpectation {
  const adapted = expectOk(adaptDiagramToVisualEngine(diagram));
  const nodeSemantics = new Map<string, { entityId?: string; ref?: string }>();
  for (const [nodeId, entityId] of adapted.maps.nodeToEntity) {
    nodeSemantics.set(nodeId, { entityId });
  }
  for (const [stepId, ref] of adapted.maps.stepToRef) {
    nodeSemantics.set(stepId, { ref });
  }
  const edgeSemantics = new Map(
    [...adapted.maps.edgeToRelation.entries()].map(([edgeId, relationId]) => {
      const dir = adapted.maps.edgeDirection.get(edgeId) as { from: string; to: string };
      return [edgeId, { relationId, from: dir.from, to: dir.to }];
    }),
  );
  return {
    nodeSemantics,
    edgeSemantics,
    visualKind: adapted.visualKind,
    diagramId: diagram.id,
  };
}

/** The expected diagram-level identity sets for a fixture. */
export function expectedProvenance(diagram: DiagramIR): ResolvedDiagramProvenance {
  return expectOk(adaptDiagramToVisualEngine(diagram)).provenance;
}

export async function renderFixtureFor(diagram: DiagramIR): Promise<string> {
  const adapted = expectOk(adaptDiagramToVisualEngine(diagram));
  return renderFixtureHtml(adapted.visualKind, adapted.request);
}
