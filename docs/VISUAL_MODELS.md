# Native visual models (Phase 4)

Status legend: **IMPLEMENTED** now · **PLANNED** later.

Small, structured, renderer-independent descriptions of the structural visuals
ARCLUME can draw itself. **Every node / edge / step / item carries the id of a
real `ProjectKnowledge` entity or relation.** Nothing is synthesised to improve a
picture.

`src/visual/models.ts`. Not the Visual Engine — see the adapter boundary below.

---

## `DiagramModel` (**IMPLEMENTED**)

```
DiagramModel =
  | { kind: "architecture";          nodes[], edges[], sourceRefs[], condensed }
  | { kind: "process" | "sequence";  steps[], edges[], sourceRefs[], condensed }
  | { kind: "timeline" | "roadmap";  items[],          sourceRefs[], condensed }
```

### architecture (**IMPLEMENTED**)

- **nodes** — knowledge items among the slide's refs whose collection is
  `components` / `dependencies` / `technologies` / `actors`. `node.entityId` is
  the real entity id.
- **edges** — `relations` among the refs whose *both* endpoints are nodes.
  `edge.relationId` is the real relation id; `edge.relationType` its type.
- Returns **null** when no such relation exists → the director downgrades to
  `relationship` / `summary`. An architecture model always has ≥1 edge.
- Node cap `maxDiagramNodes` (default 12): nodes touched by an edge are kept
  first; over the cap, `condensed: true` and edges to dropped nodes are removed.

### process / sequence (**IMPLEMENTED**)

- Prefers a `processes` entity with explicit `steps` — `step.ref` is the process
  id, `step.index` the order.
- Otherwise uses `PRECEDES` relations among the referenced entities to order
  them — `step.ref` is the entity id, `edge.relationId` the relation id.
- Returns **null** with neither → downgrade to `summary`. Step cap
  `maxDiagramSteps` (default 12) → `condensed: true`.

### timeline / roadmap (**IMPLEMENTED**)

- `roadmap` — `phases` ordered by status (`done` < `active` < `planned` <
  `blocked` < `cancelled`), then id; falls back to `milestones`. `item.ref` is
  the real phase / milestone id; `date` / `status` appear **only** when the
  knowledge carries them.
- `timeline` — dated `milestones` and dated `phases` (needs real temporal
  evidence, else null).
- Rendered as native `TimelineBlock` / `RoadmapBlock` (items keyed by real id),
  **not** as a `DiagramIR`. Item cap `maxTimelineItems` (default 12).

> `timeline` = temporal evidence (things that happened, with dates).
> `roadmap` = an ordered current/future progression.

### comparison

Not a `DiagramModel`. A `ComparisonBlock` is built only from a metric that has a
real `baseline` (a genuine before/after). ARCLUME never fabricates
"Option A vs Option B".

---

## The `DiagramAdapter` boundary (**IMPLEMENTED**)

```ts
interface DiagramAdapter {
  readonly engine: "native" | "visual";
  supports(model: DiagramModel): boolean;
  toDiagramIR(model: DiagramModel, id: Id, title?: string): DiagramIR;
}
```

`nativeDiagramAdapter` is the only adapter Phase 4 ships. It emits a Phase 1
`DiagramIR` with `engine: "native"` and a structured `spec`:

```
spec = {
  format: "arclume.native.v1",
  kind:   "architecture" | "process" | "sequence" | "timeline" | "roadmap",
  condensed: boolean,
  // architecture:            nodes[], edges[]
  // process | sequence:      steps[], edges[]
  // timeline | roadmap:      items[]
}
```

architecture / process / sequence models become a `DiagramIR` referenced by an
`architecture` / `workflow` block (and `slide.diagramRef`). timeline / roadmap
stay in native blocks.

**Phase 7 (implemented):** the Visual Engine consumes the `arclume.native.v1`
spec of `architecture` / `workflow` diagrams — no change to the
NarrativePlanner, SlidePlanner or the models here. Visual Engine internals are never
copied into the IR; ARCLUME keeps its own `DiagramModel`. See
`docs/DIAGRAM_ENGINES.md`.

---

## Structural validation (**IMPLEMENTED**)

With `{ knowledge }` context, `validateArclumeDeck` verifies not just that ids
resolve but that the **topology matches the ProjectKnowledge exactly** — before
any renderer sees the deck:

- `deck/diagram-node-ref-missing` — a node without an `id` or an `entityId`
- `deck/diagram-edge-incomplete` — an edge missing `relationId` / `from` / `to`,
  a step missing `id` / `ref`, or a timeline / roadmap item missing `ref`
- `deck/unknown-diagram-ref` — a `node.entityId` / `edge.relationId` / `step.ref`
  / `item.ref` that is not a real knowledge id (item `ref` must be a phase /
  milestone)
- `deck/diagram-endpoint-missing` — an `edge.from` / `edge.to` that is not an
  `id` of a node / step **inside the same spec** (even if `relationId` is real)
- `deck/diagram-topology-mismatch` — an edge whose visual endpoints (mapped
  through `entityId` / `ref`) or **direction** do not match the real relation it
  names — e.g. `rel-ui-api` (cmp-ui → cmp-api) drawn cmp-db → cmp-api, or reversed
- `deck/diagram-relation-type-mismatch` — `edge.relationType` ≠ the relation's
  `type`; a **flow** edge backed by a relation that is not `PRECEDES`
- `deck/empty-diagram` — a native diagram with no nodes / steps / items
- `deck/architecture-without-relations` — an architecture diagram with no edges
- `deck/unknown-metric-ref` / `deck/unknown-risk-ref` / `deck/unknown-temporal-ref`
  — block-level id references that do not resolve

No screenshot / visual QA here — that is Phase 6.
