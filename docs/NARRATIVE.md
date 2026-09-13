# Narrative Planner (Phase 3)

Status legend: **IMPLEMENTED** now · **PLANNED** later.

`ProjectKnowledge → KnowledgeSelector → NarrativePlanner → NarrativePlan`.

The Narrative Planner decides **what to tell, in what order, and what to leave
out** for a given audience. It is a pure, deterministic function: no LLM, no
Reasoner, no network, no clock, no RNG. Given the same `ProjectKnowledge` +
audience + options it produces a byte-identical `NarrativePlan`.

It **never invents knowledge**. Every `knowledgeRefs` entry is an id that exists
in the source `ProjectKnowledge` (`project.id` or an entity / claim / gap /
relation id). What is missing goes to `gaps`, not into a fabricated slide.

---

## `NarrativePlan` (**IMPLEMENTED**)

Schema: `schemas/narrative-plan.schema.json` (strict, `additionalProperties:
false`). Versioned independently as `NARRATIVE_VERSION` (`0.1.0`). Validated by
`validateNarrativePlan(plan, knowledge?)`.

```
NarrativePlan = {
  narrativeVersion,
  meta?:          { generator, contentHash }          // hash of the plan without meta AND without knowledgeHash
  audience:       "executive" | "technical" | "general"
  knowledgeHash?: ContentHash                          // ProjectKnowledge.meta.contentHash, copied through
  objective:      string                               // what the deck must achieve for this audience
  throughline:    string                               // the single central idea, derived from the knowledge
  sections:       NarrativePlanSection[]
  selection:      { selected[], deprioritized[], omitted[{ id, reason, note? }] }
  decisions:      PlanningDecision[]                    // the explainable trace
  notes:          PlanningNote[]                        // lint-style flags
}
NarrativePlanSection = { id, title, purpose, narrativePurpose, priority, knowledgeRefs[], transitionIntent? }
PlanningDecision     = { code, sectionId?, slideId?, decision, reason, knowledgeRefs? }
PlanningNote         = { code: "planning/…" | "narrative/…" | "plan/…", message, severity: "info" | "warning" }
```

`narrativePurpose` uses the same vocabulary as the deck IR: `context`,
`problem`, `solution`, `impact`, `capability`, `architecture`, `process`,
`evidence`, `risk`, `roadmap`, `status`, `next-steps`, `summary`,
`call-to-action`.

`sections` always begins with `sec-opening` (cover) and ends with `sec-closing`;
they are the only sections allowed to have zero `knowledgeRefs`. Sections are
ordered by `(priority, id)`.

---

## Audience presets (**IMPLEMENTED**)

Presets are **declarative data** (`src/narrative/presets/*.ts`), not conditionals.
Each `AudienceProfile` defines:

- `objectiveTemplate` — `{project}` is substituted to form `objective`.
- `weights` — a relevance weight per knowledge collection (and `project`).
  Missing key ⇒ 1. `0` ⇒ *irrelevant to this audience* (always omitted).
- `sections` — an ordered list of `SectionTemplate`s. Each names the collections
  / project fields it draws from, an optional `claimFactTypes` filter, an
  optional `keyword` filter, and a `minRefs` threshold (default 1). A template
  whose resolved refs fall below `minRefs` **drops itself** with a
  `section-omitted` decision — no empty obligatory slide is produced.
- `closingEmphasis` — the ordered preference for what the closing leads with.
- `detailTolerance` / `narrativeDensity` — pacing hints (the slide planner uses
  `narrativeDensity` to decide whether a large section may be split).

| Audience | Leads with | De-emphasises | Splits large sections? |
| --- | --- | --- | --- |
| `executive` | context · problem · solution · impact · capabilities · evidence · risks · status · next-steps | components, dependencies, processes, technologies, requirements | no (stays lean) |
| `technical` | purpose · constraints · architecture · components · processes · technologies · security · requirements · risks · status · gaps · roadmap | impact, results, capabilities, marketing framing | yes |
| `general` | what-is-it · why · how-it-works · what-it-can-do · status · evidence · what-comes-next | technologies, dependencies, constraints, requirements, relations | yes |

The three presets produce **structurally different decks** from the same
knowledge, not the same deck with a different title (asserted by the tests).

`security` (technical) is a *selection* over existing knowledge — requirements /
constraints / risks / claims / gaps whose text matches a security regex. It is
never invented; if nothing matches, the section drops.

---

## KnowledgeSelector (**IMPLEMENTED**)

`selectKnowledge(view, profile)` scores every item:

```
score = weight(collection)
      + (has resolvable sourceRefs ? 1 : 0)
      + (FACT ? +2 : UNKNOWN ? -1 : 0)
      + collection bonus (metric-with-value, result, high-impact risk, high-severity gap: +1)

score >= 3  → selected
score 1..2  → deprioritized
score <= 0  → omitted  (insufficient-evidence if no sourceRefs, else low-priority)
weight 0    → omitted  (irrelevant-to-audience)
decision.status == "superseded" → omitted (superseded)
```

After the sections are built, `selection.selected` is narrowed to *exactly the
ids that landed in a section*; anything scored-selected but unplaced moves to
`deprioritized` with a `knowledge-unplaced` decision. Every omission carries one
of: `irrelevant-to-audience`, `redundant`, `insufficient-evidence`,
`low-priority`, `slide-budget`, `superseded`.

---

## Throughline (**IMPLEMENTED**)

Derived only from the knowledge, in order: `project.purpose` → `project.solution`
→ `project.summary` (first sentence, prefixed with the project name) → a
capability list → the problem statement → a gap count → the project name alone.
Generic openers ("This presentation…", "overview of the project") are rejected
by `validateNarrativePlan` as `narrative/throughline-generic`.

---

## Semantic validation (**IMPLEMENTED**)

`validateNarrativePlan(plan, knowledge?)` runs version → schema → semantic:

- `narrative/duplicate-section-id` (**error**), `narrative/duplicate-section-title` (**warning**)
- `narrative/empty-section` (**warning**) — a non-opening/closing section with no `knowledgeRefs`
- `narrative/throughline-generic` (**error**)
- `narrative/content-hash-mismatch` (**error**) — `meta.contentHash` is not the
  plan's canonical hash (`narrativeContentHash(plan)`); the payload was edited
  without re-hashing. `meta.contentHash` covers the plan **without `meta` and
  without `knowledgeHash`** — the same value used as `SlidePlan.narrativeRef`.
- **Selection is a true partition** — the three lists must be pairwise disjoint
  and, when `knowledge` is supplied, cover every classifiable id exactly once:
  - `narrative/selection-conflict` (**error**) — an id in two of
    `selected` / `deprioritized` / `omitted`
  - `narrative/selection-duplicate` (**error**) — the same id twice inside one list
  - `narrative/selection-unclassified` (**error**, needs `knowledge`) — a
    knowledge-collection id that appears in none of the three lists (the plan
    could not explain what happened to it)
- `narrative/unknown-knowledge-ref` (**error**, needs `knowledge`) — a ref that is not a `ProjectKnowledge` id
- **Knowledge binding** (needs `knowledge`, when `ProjectKnowledge.meta.contentHash` exists):
  - `narrative/knowledge-hash-mismatch` (**error**) — `knowledgeHash` ≠ `ProjectKnowledge.meta.contentHash`
  - `narrative/knowledge-hash-missing` (**error**) — hashed knowledge but no `knowledgeHash` binding on the plan

---

## Pipeline API (**IMPLEMENTED**)

- `buildNarrativePlan(knowledge, { audience? })` → `NarrativePlan` (default audience `general`).
- `planNarrative(knowledge, { audience? })` → `{ narrative, validation }`; throws
  `PlanningError` (`planning/invalid-narrative`) if the plan does not validate.
- `narrativeContentHash(plan)` — the value used as `SlidePlan.narrativeRef`.

**Not in Phase 3:** the remaining audience presets (`commercial`,
`project-status`, `product`, `investor`, `proposal`, `audit`) are **PLANNED**;
the profile shape is ready for them.
