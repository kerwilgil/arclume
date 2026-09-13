# Diagram engines

ARCLUME decks (`ArclumeDeck` 0.2.0) describe diagrams **semantically**:
`DiagramIR.spec` with `format: "arclume.native.v1"` is the only semantic
representation, independent of which engine renders it. `DiagramIR.engine`
selects the renderer: `"native"`, `"visual"` or `"unspecified"`.

The ARCLUME Visual Engine is a **downstream render engine**. It is not a knowledge model, not a
narrative model, not a planner, and never a source of truth.

## Pipeline

```
ArclumeDeck (semantic IR)
  → applyDiagramEnginePreference(deck, { preference })   (pure transform)
  → resolveDiagramEngines(deck, options)                 (observational)
  → { diagramArtifacts, report }
  → renderCanonicalDeckHtml({ deck, diagramArtifacts })  (canonical HTML)
  → Chromium Visual QA → receipt → manifest → atomic delivery
```

## Engine preference (`native` | `visual` | `auto`)

Changes **only** `diagrams[].engine`; the input deck is never mutated and the
output is a new deck. Supported matrix:

| Diagram kind  | native | visual | auto |
| ------------- | ------ | ------ | ---- |
| architecture  | native | visual | visual |
| workflow      | native | visual | visual |
| dataflow      | native | visual | visual |
| lifecycle     | native | visual | visual |
| sequence      | native | visual¹ | visual¹ |
| timeline      | native | native  | native |
| roadmap       | native | native  | native |

¹ A `sequence` diagram routes to the visual engine **only** when its spec is
participant-aware — `spec.participants` has ≥ 2 entries. A step-list sequence
(`{steps, edges}`) has no participant structure and stays native.

## Supported visual engine kinds

`architecture`, `workflow`/`process`, `dataflow` and `lifecycle` are visual engine
first-class: the adapter maps a native spec to the vendored visual engine request IR
(`schema_version: 1`) and the sanitizer round-trips every `data-node-id` /
`data-edge-id` through structural provenance (`data-step-id` /
`data-relation-id`). For `sequence` the message id lands on a `<g>` (not a
`<path>`); the sanitizer binds relations off that `<g>` too, deduped across the
message group and its context `<g>`.

`timeline` and `roadmap` stay native by design.

### Geometry

`architecture` gets deterministic placement from `placeArchitecture` (Kahn
layering / id-sorted grid).

`dataflow` and `lifecycle` accept a **geometry-free** native spec (nodes with
`stage` but no `row`; states with `lane` but no `col`; no `route` hints) and
run a deterministic planner (`placeDataflow` / `placeLifecycle`,
`src/engines/visual/`). Both are pure, `O(V+E)`, id-sorted at every tie, and
emit a `meta.viewBox` sized to the placed graph.

- `placeDataflow` handles forward-only DAGs (linear pipelines, single-level
  fan-out / fan-in, small branches) whose widest stage has ≤ 5 nodes. Routes:
  adjacent same-row → `straight`; adjacent row-change → `auto`; same-stage →
  `vertical-channel`; a stage skip → `bottom-channel`.
- `placeLifecycle` handles a primary rail on `main` (≤ 5 columns) with `event`
  lanes for interruptions/recovery and a `terminal` band for outcomes (≤ 3
  columns each). Rail hops → `straight`; retries / drops off the rail →
  `bottom-channel`; recovery back onto the rail → `top-channel`.

An **explicit** `row`/`col`/`route` in the spec is always respected (a partial
set is rejected). A graph the planner cannot place (overfull stage, backward
flow, missing `main` lane, overfull band) is a fatal
`visual-engine/adapter-invalid-input` with a reason — never invalid geometry handed
to the visual engine to "fix". A layout the planner places but the vendored renderer
still rejects (e.g. a too-wide transition label) is a fallbackable
`visual-engine/render-failed` → loud native fallback.

### Sequence projection

`buildFlowModel(view, ids, "sequence")` projects a `PRECEDES`-based flow onto
visual engine participants + messages via `deriveSequenceParticipants`: participants
come **only** from real `actors` / `components` the steps anchor to
(`component.kind` / `actor.type` → vendored `componentType`), labels clamped to
the participant box; messages keep sender / receiver / order and carry the
relation's `id` and phrase. Fewer than 2 distinct participants ⇒ no projection
⇒ the flow stays native.

### Dataflow / lifecycle mapping

- Enum boundaries are enforced at the adapter (`visual-engine/adapter-invalid-input`,
  not a downstream `render-failed`): dataflow node / sequence participant
  `type` ∈ `{frontend, backend, database, cloud, security, messagebus,
  external}`; lifecycle state `type` ∈ `{start, active, waiting, decision,
  success, failure, neutral, external}`; flow / transition `route` and message
  `variant` against their vendored enums.
- Structural provenance: every node/state id maps to itself in `stepToRef`,
  every flow/transition id to itself in `edgeToRelation`, and `edgeDirection`
  carries `{from, to}` for the direction round-trip. No knowledge refs yet —
  those arrive with the knowledge-aware model.

### Architecture mapping

- Deterministic placement: Kahn layering (ascending-id tie-break) when the
  graph is a DAG with ≤ 12 layers (`col` = layer, `row` = position within the
  layer); otherwise an id-sorted grid with `cols = min(12, ceil(sqrt(n)))`.
- One visual engine connection per authored edge; no synthetic nodes or edges.
- `component.type` is the constant sentinel `"external"` — ARCLUME does not
  know component semantics and never infers them from labels. The sanitizer
  strips every trace of it (classes, sigils, `data-*`).
- `meta.legend.mode` is always `"hidden"`, `animation: "none"`,
  `visual_preset: "classic"`.

### Identity separation (semantic provenance)

ARCLUME distinguishes strictly:

- visual node id ≠ `entityId` (real `ProjectKnowledge` entity id)
- visual edge id ≠ `relationId` (real `ProjectKnowledge` relation id)
- step id ↔ `ref` (structural identity + semantic reference)

A diagram that lacks `entityId`, `relationId` or step `ref` is
`visual-engine/adapter-invalid-input` — never a synthesized `edge-<index>`
shim, never a silent fallback. The adapter builds explicit maps
(`nodeToEntity`, `edgeToRelation`, `stepToRef`, `edgeDirection`); the
sanitizer injects them as `data-entity-id`, `data-relation-id` (+
`data-relation-from-node-id` / `data-relation-to-node-id`), `data-step-id` +
`data-step-ref`.

### Workflow mapping

- Single lane `main`, steps sorted by explicit `step.index` → `col` 0..5.
- Hard capacity: 6 steps. More → `visual-engine/layout-capacity` and a loud native
  fallback (never truncation, never re-ordering).
- `mainPath` is emitted only when every consecutive pair is an authored edge
  in that exact direction — it never invents causal semantics.

## Resolution (`resolveDiagramEngines`)

Returns `diagramArtifacts: ReadonlyMap<string, ResolvedDiagramArtifact>` and a
deterministic `DiagramEngineReport` (no timestamps, no temp paths, no host
identity). The deck is not mutated (`contentHash` before === after).

Artifacts are a discriminated union:

- `kind: "svg"` — a visual-engine-produced, sanitized, rebuilt SVG bound to the
  source spec via `specHash` and carrying `data-entity-id` /
  `data-relation-id` / `data-step-id` / `data-diagram-id` provenance. Also
  carries the vendored engine identity (`engineVersion`, `engineCommit`).
- `kind: "native-fallback"` — the visual engine was requested, a fallbackable failure
  occurred (`visual-engine/unsupported-diagram`, `visual-engine/layout-capacity`,
  `visual-engine/engine-unavailable`, `visual-engine/render-failed`) and the diagram is
  rendered by the native engine, with a `visual-engine/fallback-native` warning.

Every artifact carries two cryptographic identities:

- `specHash` — over the semantic spec;
- `diagramRenderInputHash` — over **every render-driving input**
  (`id`, `diagramType`, `engine`, `title`, `spec`). A title-only change makes
  an artifact stale.

## Artifact final-form revalidation (trust boundary)

Artifacts are caller-controlled data. Before `renderCanonicalDeckHtml`,
`validateRenderedDeck` or `deliverAtomic` accept an `kind: "svg"` artifact, the
final SVG is re-parsed from its bytes (`final-form.ts`, saxes again — never
the visual engine again):

- element/attribute allowlists (no `class`/`style`/`on*`/`script`/
  `foreignObject`/remote refs in the final form);
- every `url(#id)` / `href="#id"` resolves locally;
- `data-diagram-id` equals the deck's diagram;
- the entity/relation/step id sets equal the sets independently re-derived
  from the CURRENT deck spec (via the adapter), and every relation's visual
  direction (`data-relation-from/to-node-id`) matches the authored direction;
- `svgSha256` recomputes.

The artifact's own `provenance` field is treated as claims-only and is never
trusted.

Integrity failures never fall back: `visual-engine/adapter-invalid-input`,
`visual-engine/output-invalid`, `visual-engine/unsafe-output`,
`visual-engine/topology-mismatch`, `visual-engine/provenance-loss`, `visual-engine/order-mismatch`
are always fatal. `fallbackOnError: false` makes environment failures fatal too
(release/strict mode).

## Vendoring and integrity

The visual engine is vendored under `vendor/archify/` at tag `v2.16.0` (a fixed file
copy — not npm, not a submodule). The pinned identity lives in
`src/engines/visual/vendored.ts`:

- `VISUAL_ENGINE_VENDORED = "2.16.0"`
- `VISUAL_ENGINE_COMMIT` — full upstream commit
- `VISUAL_ENGINE_SUBTREE_SHA256`, `VISUAL_ENGINE_FILE_COUNT` — canonical digest over
  `relative POSIX path + file bytes`, sorted lexicographically

`tests/engines/visual/vendor.test.ts` recomputes the digest; any mutation of
any byte fails the suite. Upgrading the visual engine means deliberately changing tag +
commit + digest + fixtures.

## Security boundary

Visual engine output is untrusted until rebuilt by
`src/engines/visual/sanitize.ts`:

```
Visual Engine HTML → extract SVG region → saxes (strict XML) → allowlist
  → class → ARCLUME presentation attributes → sentinel/sigil removal
  → provenance injection → deterministic rebuild → validation
```

- Elements/attributes outside the allowlist are fatal; `on*`, `style`, remote
  `href` and non-local `url(...)` are fatal; unknown presentation classes are
  fatal (`VISUAL_ENGINE_CLASS_MAP` is the coverage contract for visual engine v2.16.0,
  classic preset, animation none).
- The final SVG carries no `<style>`, no `style=`, no `class=`, no visual engine CSS
  and no semantic sigils. Presentation comes from ARCLUME theme tokens.
- All element ids are re-namespaced per diagram (`arcf-<diagramId>-…`) so two
  visual engine diagrams in one document can never collide.

The renderer (`renderDeckHtml` / `renderCanonicalDeckHtml`) stays pure and
synchronous: it consumes trusted artifacts; it never spawns a process, touches
the filesystem or parses XML.

## Canonical rendering and delivery binding

`CanonicalDeckRenderInput = { deck, diagramArtifacts? }` is the sole identity
that reproduces final HTML. `renderCanonicalDeckHtml(input)` is the single
authoritative definition of canonical HTML:

- native-only deck (no/empty artifacts): byte-identical to Phase 6
  `renderDeckHtml(deck)`;
- an `engine: "visual"` diagram without an artifact is fatal
  (`delivery/diagram-artifact-missing`) on every canonical surface — the
  low-level `renderDeckHtml` placeholder is kept only for deliberate
  non-canonical use;
- extra / tampered / stale / cross-deck / wrongly-identified artifacts are
  fatal before staging (`delivery/diagram-artifact-*`).

`validateDeliveryBindings` recomputes the canonical HTML itself — a caller
cannot assert coherence, it must be proven.

The Visual QA receipt gains an optional `engines.visual = { version, commit }`
present only when at least one delivered diagram was actually produced by
the visual engine (`engineUsed === "visual"`). An all-fallback deck never claims it.
The delivery preflight re-checks the binding independently
(`delivery/engine-receipt-mismatch`: a deck with visual-engine-produced output must
claim it with the exact vendored identity; any other deck must not).
(JSON Schema: `schemas/visual-qa-receipt.schema.json`, optional additive field.)

## Workflow schema note (P2-1, remediation decision)

The Phase 7 contract asked for visual engine workflow `schema_version: 1`. Physical
verification showed v1 cannot satisfy the contract's own requirements: the
vendored v1 layout uses hardcoded legacy column centers
(`[88, 220, 300, 430, 500, 625]`), so columns 1→2 and 3→4 overlap real nodes
by 12–16px for any labelled 4+-step chain (`workflow/column-capacity`, fatal),
and the vendor's own compiler recommends migration (`supportedFixes:
migrate this workflow to schema_version 2`). The contracted 6-step capacity is
impossible under fixed-v1. ARCLUME therefore emits `schema_version: 2` (the
vendored "readable-v2" compiler), satisfying the physical Visual QA contract;
the vendored workflow schema declares both versions and v2 is what proceeds.
If a future contract amendment requires v1 ergonomics, revisit with explicit
column coordinates instead of the legacy centers.

## Offline engine proof

The vendored engine runs fully offline for ARCLUME requests. Audits:

1. **Static scan** (`tests/engines/visual/vendor.test.ts`): within the render
   path (`bin/archify.mjs`, `renderers/**`, `migrations/**`) only
   `renderers/shared/brand-marks.mjs` imports socket modules — and its network
   use is gated on a `brand` field no ARCLUME request can carry (asserted).
2. **Runtime tripwire**: the runner spawns the engine with a preload that
   replaces `http(s).request/get`, `net.connect/createConnection`,
   `net.Socket`, `dns.lookup(+promises)`, `fetch`, `WebSocket`, `EventSource`
   and `XMLHttpRequest` with throwers — any network attempt crashes the child
   (`visual-engine/render-failed`, loud). No OS-specific sandbox needed.
3. **Chromium zero-network** proof at the document level (Visual QA), kept.