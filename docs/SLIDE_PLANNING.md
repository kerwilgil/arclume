# Slide Planner (Phase 3)

Status legend: **IMPLEMENTED** now · **PLANNED** later.

`NarrativePlan → SlidePlanner → SlidePlan`.

The Slide Planner turns a narrative into a **semantic** slide plan: one key
message per slide, every slide traceable to knowledge and sources. It decides
**nothing visual** — no layout, theme, colour, font, block, diagram or
coordinate. `visualIntent` is a *suggestion* the VisualDirector (Phase 4) may
accept or reject.

Deterministic: no LLM, no clock, no RNG, no network. Same knowledge + narrative
+ options ⇒ byte-identical `SlidePlan`.

---

## `SlidePlan` (**IMPLEMENTED**)

Schema: `schemas/slide-plan.schema.json` (strict). Versioned independently as
`SLIDE_PLAN_VERSION` (`0.1.0`). Validated by
`validateSlidePlan(plan, { narrative?, knowledge? })`.

```
SlidePlan = {
  planVersion,
  meta?:           { generator, contentHash }   // hash of the plan without meta AND without knowledgeHash
  audience,
  narrativeRef:    ContentHash            // == narrativeContentHash(narrative)
  knowledgeHash?:  ContentHash            // external provenance; bound, not part of the plan's identity
  budget:          { minSlides, targetSlides, maxSlides }
  targetSlideCount:number                 // == budget.targetSlides
  slides:          PlannedSlide[]
  decisions:       PlanningDecision[]
  notes:           PlanningNote[]
}
PlannedSlide = {
  id, index,                              // index is 0-based and contiguous
  sectionId,                              // a NarrativePlan section id
  kind,                                   // cover | section | content | diagram | metrics | comparison | timeline | roadmap | quote | closing
  title,
  keyMessage,                             // the ONE idea; specific, backed, != title
  narrativePurpose,
  knowledgeRefs[], claimRefs[], sourceRefs[],   // provenance
  contentIntent,                          // short description of the content
  visualIntent,                           // none | summary | metrics | relationship | architecture | process | sequence | timeline | roadmap | comparison | hierarchy | risk | status | quote
  visualCandidates?[],                    // ids Phase 4 might visualize
  density,                               // low | medium | high (from counting knowledge, not pixels)
  priority                                // inherited from the section
}
```

---

## One idea per slide (**IMPLEMENTED**)

`keyMessage` is derived per `narrativePurpose` from the *actual referenced
knowledge* (`src/planning/messaging.ts`): a metric's value vs baseline, a
process's step chain, a component/relation count, the top risk with its
likelihood/impact, phase completion, `project.nextSteps`, … When the specific
knowledge is missing it falls back to a factual statement about what *is*
present (counts, ids) — never an invented fact.

Each message is then made distinct from its title and from every message already
placed. If a collision remains, the message is rebuilt from the section title +
a summary of its items, then (last resort) the section id is appended. Result:
no two slides carry the same key message.

---

## Visual intent (**IMPLEMENTED**, semantic only)

| narrativePurpose | signal | `kind` | `visualIntent` | `visualCandidates` |
| --- | --- | --- | --- | --- |
| architecture | ≥1 relation in refs | `diagram` | `architecture` | component + relation + dependency ids |
| architecture | no relation | `content` | `summary` | — |
| process | a PRECEDES relation | `diagram` | `sequence` | process + PRECEDES ids |
| process | otherwise | `diagram` | `process` | process ids |
| impact / evidence | a metric in refs | `metrics` | `metrics` | metric ids |
| impact / evidence | no metric | `content` | `summary` | — |
| risk | — | `content` | `risk` | — |
| roadmap | a phase / milestone | `roadmap` | `roadmap` | phase + milestone ids |
| status | — | `content` | `status` | — |
| everything else | — | `content` | `summary` | — |

Phase 4 is free to override any of this. §27 rule: an `architecture` intent is
only chosen when a relation actually backs it; otherwise it degrades to a
component overview (`summary`).

---

## Budget (**IMPLEMENTED**)

Defaults: `minSlides = 8`, `targetSlides = 12`, `maxSlides = 16`. Overridable via
`{ minSlides?, targetSlides?, maxSlides? }`; an inconsistent request is clamped
to a valid range (`min ≥ 1`, `max ≥ min`, `target` into `[min, max]`) with a
`planning/budget-clamped` note.

- **Over budget** — first merge adjacent content slides that share **narrative
  identity** (`topics-merged`), then drop the lowest-priority non-cover/closing
  slides (`over-budget-resolved`). Notes: `planning/topics-merged`,
  `planning/over-budget-resolved`.
- **Under budget** — the deck is left short. `planning/under-budget` note + an
  `under-budget` decision. **No content is fabricated** to reach the minimum.

Cover and closing are never dropped or merged. After budgeting, `index` is
re-assigned `0..n-1`.

### Merge safety (**IMPLEMENTED**)

An automatic merge only fires when the two slides are **the same
`sectionId`**, plus the same `narrativePurpose`, the same `kind`, adjacent, and
small enough combined. Two different sections that merely share a
`narrativePurpose` (e.g. the keyword-scoped *Security-related knowledge* section
and the *Risks* section — both `risk` in the technical preset) are **never**
silently fused into one slide labelled after only the first; the later drop /
condensation strategy handles them, with an `over-budget-resolved` decision.

A merged slide is fully re-derived from the **combined** knowledge, never
inherited from the first half:

- `knowledgeRefs` / `claimRefs` — deduplicated union (the canonical trace).
- `sourceRefs` — a deterministic, deduplicated union of **both** sides'
  evidence, ordered by stable serialization and capped at 8, so truncation never
  biases entirely toward the first slide.
- `title` — the section title (a `(1/2)` split counter is dropped).
- `keyMessage` — recomputed for the whole set and re-deduplicated against every
  other slide's message.
- `contentIntent`, `visualIntent`, `visualCandidates`, `density` — recomputed
  from the combined items.

The SlidePlanner passes this recomputation to the budgeter as a `SemanticMerge`
callback (`createSemanticMerge`); `budget.ts` never duplicates messaging logic.

After all budget operations, `repairSplitMarkers` rewrites the title of any
slide that still carries a `(i/n)` marker whose sibling was merged or dropped
(`split-marker-repaired` decision), so no surviving slide keeps a stale counter.

---

## Splitting (**IMPLEMENTED**)

A content section with more than 6 `knowledgeRefs` is split into two contiguous
parts (`topic-split`), refs partitioned by id-sorted halves, titled `X (1/2)` /
`X (2/2)`. The `executive` preset never splits — it stays lean.

---

## Semantic validation (**IMPLEMENTED**)

`validateSlidePlan(plan, { narrative?, knowledge? })` runs version → schema →
semantic. Errors / warnings include:

- `plan/duplicate-slide-id`, `plan/slide-index-mismatch`, `plan/duplicate-cover`,
  `plan/multiple-closing` (**errors**)
- `plan/duplicate-key-message`, `plan/duplicate-title`,
  `plan/key-message-equals-title`, `plan/key-message-long`,
  `plan/slide-without-knowledge-refs`, `plan/missing-cover`,
  `plan/missing-closing`, `plan/too-many-same-purpose` (**warnings**)
- `plan/roadmap-without-temporal` (**error**) — a roadmap/timeline slide with no
  phase / milestone / PRECEDES behind it
- `plan/metrics-without-metric-refs` (**error**) — a metrics slide with no metric
  id and no supporting claim
- `plan/architecture-without-relationship` (**warning**) — an architecture intent
  with no relation
- `plan/budget-exceeded` / `plan/budget-under-unreported` (**errors**) — a budget
  violation with no matching `planning/…` note
- `plan/content-hash-mismatch` (**error**) — `meta.contentHash` is not the plan's
  canonical hash (`slidePlanContentHash(plan)`); the payload was edited without
  re-hashing. `meta.contentHash` covers the plan **without `meta` and without
  `knowledgeHash`** — `knowledgeHash` is external provenance, bound separately.
- with `knowledge`: `plan/unknown-knowledge-ref`, `plan/unknown-claim-ref`,
  `plan/unknown-source`, `plan/unknown-visual-candidate` (**error**),
  `plan/visual-candidate-unreferenced` (**warning**, not among the slide's
  `knowledgeRefs`)
- **Artifact binding** — Phase 4 consumes these plans, so a mixed-baseline set is
  never `valid`:
  - with `narrative`: `plan/unknown-section`, `plan/audience-mismatch`,
    `plan/narrative-ref-mismatch` (**error**), `plan/narrative-ref-missing`
    (**error**), `plan/narrative-knowledge-hash-mismatch` (**error**) —
    `SlidePlan.knowledgeHash` ≠ `NarrativePlan.knowledgeHash`
  - with `knowledge` (when `ProjectKnowledge.meta.contentHash` exists):
    `plan/knowledge-hash-mismatch` (**error**),
    `plan/knowledge-hash-missing` (**error**)

---

## Pipeline API (**IMPLEMENTED**)

- `buildSlidePlan(knowledge, narrative, { minSlides?, targetSlides?, maxSlides? })` → `SlidePlan`.
- `slidePlanContentHash(plan)` — the plan's canonical semantic identity (`meta`
  and `knowledgeHash` stripped); the exact boundary used to fill `meta.contentHash`.
- `createSemanticMerge(knowledge, narrative, usedMessages?)` → the `SemanticMerge`
  callback the budgeter uses to recompute a merge from the combined knowledge.
- `planSlides(knowledge, narrative, options?)` → `{ slidePlan, validation }`;
  throws `PlanningError` (`planning/invalid-slide-plan`) if it does not validate.
- `runPlanning(knowledge, { audience?, minSlides?, targetSlides?, maxSlides? })` →
  `{ narrative, slidePlan, narrativeValidation, slideValidation }` — chains
  `planNarrative` + `planSlides` while keeping both stages inspectable.
- `writeArtifacts(dir, { …, narrative, slidePlan })` adds `narrative-plan.json`
  and `slide-plan.json`; `readNarrativeArtifact` / `readSlidePlanArtifact` read
  them back.

**Not in Phase 3:** the VisualDirector, block system, `diagramRef` resolution,
theme application, `ArclumeDeck` generation, any renderer. `SlidePlan → VisualDirector
→ ArclumeDeck` is **PLANNED** for Phase 4. Phase 3 deliberately does **not**
produce an `ArclumeDeck` or fill visual fields with placeholders.
