# VisualDirector (Phase 4)

Status legend: **IMPLEMENTED** now · **PLANNED** later.

```
ProjectKnowledge + NarrativePlan + SlidePlan + Theme  →  VisualDirector  →  ArclumeDeck
```

The VisualDirector decides **how** to show each slide — visual kind, layout,
blocks, emphasis, theme tokens — and produces a complete, schema- and
context-valid `ArclumeDeck` (the Phase 1 IR, now at `irVersion 0.2.0`).

It **never alters the truth of the SlidePlan**. It does not invent content,
metrics, relations, phases or results; it does not turn a RECOMMENDATION into a
FACT; and it never re-words a `keyMessage` (only whitespace is collapsed).

Deterministic: no LLM, no Reasoner, no clock, no RNG, no network, no filesystem,
no browser. The same four inputs ⇒ a byte-identical `ArclumeDeck`.

Phase 4 does **not** produce: HTML, screenshots, Chromium visual QA, PPTX, PDF,
PNG, SVG, Visual Engine output, or any UI. Those are Phase 5+.

---

## Input binding (**IMPLEMENTED**)

`buildVisualDeck` validates all three inputs before building and refuses a stale
or mixed set (fatal `PlanningError`, no silent hash repair):

- `validateNarrativePlan(narrative, knowledge)` — must be valid
- `validateSlidePlan(slidePlan, { narrative, knowledge })` — must be valid

These already enforce the Phase 3 bindings (`NarrativePlan ↔ ProjectKnowledge`,
`SlidePlan ↔ NarrativePlan`, `SlidePlan ↔ ProjectKnowledge`, content-hash
self-checks).

---

## Visual intent resolution (**IMPLEMENTED**)

`resolveVisual(slide, view, limits)` re-checks the SlidePlan's `visualIntent`
against the real knowledge and returns one of:

| outcome | meaning |
| --- | --- |
| `accepted` | the intent is supported as-is |
| `refined` | same family, a better-fitting form (e.g. `roadmap` → `timeline`) |
| `downgraded` | the intent is not supported; fall back to a safe form |

Downgrade rules (never invent topology / metrics / dates to keep a richer form):

| requested | condition | resolved |
| --- | --- | --- |
| `architecture` | ≥1 real relation connects two node entities | `architecture` |
| `architecture` | ≥2 components but no connecting relation | `relationship` |
| `architecture` | otherwise | `summary` |
| `process` / `sequence` | a process with steps, or `PRECEDES` relations | `process` / `sequence` |
| `metrics` | a metric with a value, or a FACT claim | `metrics` |
| `metrics` | otherwise | `summary` |
| `roadmap` | phases / milestones | `roadmap` (else `timeline`, else `status`) |
| `timeline` | dated milestones / phases | `timeline` (else `roadmap`, else `summary`) |
| `risk` | risks (or gaps) | `risk` (else `summary`) |
| `comparison` | a metric with a baseline | `comparison` (else `summary`) |
| `hierarchy` | `PART_OF` relations | `hierarchy` (else `relationship` / `summary`) |
| `quote` | a relevant item carries a **verbatim `SourceRef.quote`** | `quote` (else `summary` — a sourced claim/result without a verbatim quote is **not** quotable) |
| `status` | — | `status` |
| `none` / cover / closing | — | `none` |

Every resolution is recorded as a `VisualDecision`.

### `VisualDecision`

```
VisualDecision = {
  slideId, code, requestedIntent, resolvedVisual, outcome, layout, reason, knowledgeRefs[]
}
```

Codes: `visual-accepted` · `visual-refined` · `visual-downgraded` ·
`layout-selected` · `blocks-selected` · `density-adjusted` · `diagram-built` ·
`content-condensed` · `content-deferred`. Feeds a future `arclume explain`.

---

## Blocks (**IMPLEMENTED**)

All 16 Phase 1 block types are produced (`src/visual/blocks.ts`). Rules: every
block is serializable, deterministic, bounded, renderer-independent, and — when
it presents knowledge — evidence-backed. No DOM / HTML / CSS / pixels.

| visual kind | block(s) |
| --- | --- |
| `metrics` | `metric-grid` (≥2 metrics) / `metric` (1) / `callout` (FACT claim only) |
| `comparison` | `comparison` from a metric's baseline vs value |
| `timeline` | `timeline`, items keyed by real phase / milestone id |
| `roadmap` | `roadmap`, phases keyed by real phase id |
| `risk` | `risk` (top 1–3 by impact), each with `riskId`; gaps → `factType: UNKNOWN` |
| `status` | `status` — **`state` is always `unknown`** (ProjectKnowledge asserts no health/RAG signal); `label` / `detail` report the real workflow facts (phase counts, active phase, blocked count, open questions, `project.status`) |
| `relationship` / `hierarchy` | `table` (From · Link · To) from real relations |
| `quote` | `quote` whose `text` is **exactly a verified `SourceRef.quote`** (whitespace collapsed), attributed to its source; never `claim.statement` / `result.statement`. No verbatim quote (or one over 1200 chars) → a plain `text` block, not a quotation |
| `architecture` / `process` / `sequence` | one `architecture` / `workflow` block → a native `DiagramIR` |
| `summary` / `text` / `none` | one `text` block (cover/closing may have zero) |

### Provenance (**IMPLEMENTED**)

A block that presents knowledge carries the ids that make it traceable —
`metricId`, `riskId`, timeline item `id`, roadmap phase `id`, and (in a native
diagram `spec`) node `entityId` / edge `relationId` / step & item `ref` — plus a
deduplicated `sourceRefs` union (cap 8) of the items it shows. Slide-level
provenance (`evidence[]` from claim refs, only when the claim carries sources) is
kept in addition, never instead.

### Limits (**IMPLEMENTED**, configurable)

`buildVisualDeck({ limits })` overrides `DEFAULT_VISUAL_LIMITS`:

```
maxBlocksPerSlide 6 · maxItemsPerBlock 8 · maxTextBlockChars 600
maxTableColumns 6 · maxTableRows 12 · maxMetricsPerGrid 8
maxDiagramNodes 12 · maxDiagramSteps 12 · maxTimelineItems 12
```

The SlidePlan's semantic `density` tightens the per-slide block/item budget
(`low` → ≤3 blocks / ≤4 items, `medium` → ≤5 / ≤6, `high` → the base). **Themes
never change this budget.** When content exceeds a limit, the visible block count
is reduced and a `visual/content-condensed` note is recorded — the slide keeps
**all** its `knowledgeRefs`; provenance is never dropped.

---

## Layouts (**IMPLEMENTED**)

A small renderer-independent taxonomy (`src/visual/layouts.ts`), selected from
the slide kind + visual kind + block shape (never the theme, never pixels):

```
hero · single-focus · stack · split · grid · metric-grid · timeline
roadmap · diagram-focus · comparison · quote-focus
```

Each maps to a Phase 1 `SlideLayout` enum value (`centered`, `single`,
`split-2`, `grid`, `full-bleed-visual`, `quote`). Recorded as `layout-selected`.

---

## Deck assembly & validation (**IMPLEMENTED**)

`deck.provenance` carries three hash bindings: `knowledgeHash`, `narrativeRef`
(`narrativeContentHash`), `slidePlanRef` (`slidePlanContentHash`).

`validateArclumeDeck(deck, { knowledge?, narrative?, slidePlan? })` runs the
existing schema + context-free checks, then the Phase 4 structural pass
(`crossRefArclumeDeckContext`):

- **binding** — `deck/knowledge-hash-mismatch|missing`, `deck/narrative-ref-mismatch|missing`, `deck/slide-plan-ref-mismatch|missing`, `deck/throughline-altered` (**error** — the deck throughline must be the NarrativePlan's, verbatim or deterministically clamped to 400)
- **1:1 slide binding** — `deck/slide-count-mismatch`, `deck/slide-id-mismatch`, `deck/key-message-altered`, `deck/narrative-purpose-altered`
- **reference resolution** — `deck/unknown-metric-ref`, `deck/unknown-risk-ref`, `deck/unknown-temporal-ref`, `deck/unknown-diagram-ref`
- **native diagram topology** (per `arclume.native.v1` spec) — `deck/diagram-node-ref-missing` (node without `id` / `entityId`), `deck/diagram-edge-incomplete` (edge/step/item missing a required ref), `deck/diagram-endpoint-missing` (`edge.from` / `edge.to` is not an internal node/step id), `deck/diagram-topology-mismatch` (edge endpoints or **direction** do not match the real relation), `deck/diagram-relation-type-mismatch` (`edge.relationType` ≠ relation type; a flow edge whose relation is not `PRECEDES`)
- **structural integrity** — `deck/empty-diagram`, `deck/architecture-without-relations`, `deck/metrics-slide-without-metric-block` (warn), `deck/temporal-slide-without-temporal-block` (warn), `deck/block-without-provenance` (warn)
- **theme integrity** — `deck/theme-unimplemented` (**error** — only `minimal` / `executive` can be resolved), `deck/theme-tokens-ref-missing` / `deck/theme-tokens-ref-mismatch` (**error** — `deck.theme.tokensRef` must be `themeTokensRef(getTheme(deck.theme.name))`, so Phase 5 never renders a deck whose declared theme and token identity disagree)

Duplicate slide / block / diagram ids, `slide.index` contiguity, unknown
section / diagram / source refs and table-row arity are covered by the existing
context-free `crossRefArclumeDeck`.

---

## Pipeline API (**IMPLEMENTED**)

- `buildVisualDeck({ knowledge, narrative, slidePlan, theme?, limits? })` → `{ deck, decisions, notes, validation }`.
- `buildDeck(knowledge, narrative, slidePlan, { theme?, limits? })` → `{ deck, decisions, notes, validation }`; throws `PlanningError` (`visual/invalid-deck`) if the deck does not validate.
- `directVisuals(...)` → `{ decisions, notes }` only.
- `runDeck(knowledge, { audience?, theme?, limits?, minSlides?, … })` → `{ narrative, slidePlan, deck, decisions, deckNotes, deckValidation, narrativeValidation, slideValidation }` — chains every stage, each still inspectable.
- `writeArtifacts(dir, { …, deck })` adds `arclume-deck.json`; `readDeckArtifact(dir)` reads it back.

Default theme: `executive` for an executive narrative, otherwise `minimal`.

**PLANNED (Phase 5+):** the HTML renderer + viewer, visual QA + atomic delivery,
the Visual Engine diagram adapter, PPTX / PDF / PNG / SVG export, the CLI, the web UI.
