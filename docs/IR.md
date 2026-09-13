# ArclumeDeck IR — Reference

Schema: `schemas/arclume-deck.schema.json` (authoritative).
TS types: `src/types/deck.ts` + `src/types/blocks.ts` (mirror).
Current `irVersion`: **0.1.0**.

Everything here is **IMPLEMENTED** in Phase 1 as *a validated representation*.
Producing decks (planners, renderers) is **PLANNED**.

---

## Top level

| Field | Required | Notes |
| --- | --- | --- |
| `irVersion` | yes | SemVer. Must share the major of the supported version (0.1.0). |
| `meta` | yes | `{ title, subtitle?, generator?, generatedAt?, sourceDigest?, locale? }`. `title` required. |
| `project` | yes | `{ name, oneLiner?, tagline?, domain?, sourceRefs? }`. |
| `audience` | yes | `{ preset, locale?, priorKnowledge?, formality?, notes? }`. |
| `narrative` | yes | `{ preset, arcTitle?, throughline, sections[] }`. |
| `theme` | yes | `{ name, aspectRatio?, mode?, tokensRef? }`. |
| `provenance` | yes | `{ sources[], knowledgeHash? }`. |
| `slides` | yes | array of Slide. |
| `diagrams` | yes | array of DiagramIR (may be empty). |

`additionalProperties: false` at every object level.

### `audience.preset`

`executive` · `technical` · `commercial` · `project-status` · `product` ·
`investor` · `proposal` · `audit` · `general`.

### `theme.name`

`minimal` · `executive` · `corporate` · `technical` · `futuristic`.
`aspectRatio`: `16:9` (default intent) · `16:10` · `4:3`. `mode`: `auto` ·
`light` · `dark`.

### `narrative.sections[]`

`{ id, title, purpose }` — all required. Slides link to a section via
`slide.sectionId`.

---

## Slide

| Field | Required | Notes |
| --- | --- | --- |
| `id` | yes | id pattern `^[A-Za-z][A-Za-z0-9_-]*$`. |
| `index` | yes | integer ≥ 0. **Must equal the slide's position in `slides`.** |
| `sectionId` | no | must resolve to a `narrative.sections[].id`. |
| `kind` | yes | `cover` · `section` · `content` · `diagram` · `metrics` · `comparison` · `timeline` · `roadmap` · `quote` · `closing`. |
| `title` | yes | |
| `subtitle` | no | |
| `keyMessage` | yes | the single main idea. ≤ 200 chars (warning above 140). |
| `narrativePurpose` | yes | `context` · `problem` · `solution` · `impact` · `capability` · `architecture` · `process` · `evidence` · `risk` · `roadmap` · `status` · `next-steps` · `summary` · `call-to-action`. |
| `layout` | yes | `single` · `split-2` · `grid` · `full-bleed-visual` · `centered` · `quote`. |
| `blocks` | yes | array of Block (≤ 24). May be empty for `cover` / `section` / `closing`. |
| `visual` | no | `{ chosenForm, rationale?, rejected? }` — the VisualDirector's decision record (Phase 4 will populate it). |
| `diagramRef` | no | must resolve to a `diagrams[].id`. |
| `evidence` | no | array of Evidence (see Source Traceability). |
| `speakerNotes` | no | markdown string. |
| `checks` | yes | structured; may be `{}`. `{ visualQa?, unsourcedFacts?, densityWarnings?, notes? }`. `visualQa`: `pass`·`warn`·`fail`·`skipped`·`pending`. |

---

## Block

Discriminated union on `type`. Shared fields on every block:
`id` (required), `emphasis?`, `caption?`, `sourceRefs?`.
Unknown properties are rejected via `unevaluatedProperties: false`.

| `type` | Required payload |
| --- | --- |
| `text` | `text` (≤ 4000). `format?`: `plain`·`markdown`. |
| `metric` | `label`, `value`. `unit?`, `delta?`, `direction?` (`up-good`·`down-good`·`neutral`), `metricId?`. |
| `metric-grid` | `metrics[]` — 2–8 of `{ label, value, unit?, delta?, direction?, metricId? }`. |
| `comparison` | `left{title,note?}`, `right{title,note?}`, `rows[]` of `{ label, left, right }`. |
| `timeline` | `items[]` (1–24) of `{ id?, label, date?, detail?, state? }` (`done`·`active`·`planned`). |
| `roadmap` | `phases[]` (1–16) of `{ id?, name, status?, start?, end?, items? }`. |
| `risk` | `statement`, `factType`. `likelihood?`, `impact?` (`low`·`medium`·`high`·`unknown`), `mitigation?`, `riskId?`. |
| `status` | `state` (`green`·`amber`·`red`·`unknown`), `label`. `detail?`. |
| `callout` | `tone` (`info`·`success`·`warning`·`danger`·`neutral`), `text`. |
| `quote` | `text`. `attribution?`. |
| `table` | `columns[]` (1–10), `rows[]` (1–40) of string arrays. Row length must equal `columns.length` (semantic check). |
| `image` | `src`, `alt`. `fit?` (`contain`·`cover`). |
| `code` | `code`. `language?`. |
| `diagram` | `diagramRef` → `diagrams[].id`. |
| `architecture` | `diagramRef`; the target diagram's `diagramType` should be `architecture`. |
| `workflow` | `diagramRef`; the target diagram's `diagramType` should be `workflow`. |

**Taxonomy note.** `architecture` and `workflow` are semantic subtypes of
`diagram`. They exist so the (planned) narrative and VisualDirector can reason
about intent without opening the DiagramIR, and so validation can check the
referenced diagram's type.

---

## DiagramIR

Forward-compatible container. `spec.format: "arclume.native.v1"` is the
canonical semantic representation for both engines; engine-specific mapping
lives in the diagram-engine layer (Phase 7 — see `docs/DIAGRAM_ENGINES.md`).

| Field | Required | Notes |
| --- | --- | --- |
| `id` | yes | |
| `engine` | yes | `visual` · `native` · `unspecified`. |
| `diagramType` | yes | `architecture` · `workflow` · `sequence` · `dataflow` · `lifecycle` · `timeline` · `roadmap` · `matrix` · `hierarchy` · `before-after` · `comparison` · `unspecified`. |
| `title` | no | |
| `spec` | no | opaque engine payload; not validated in Phase 1. |
| `sourceRefs` | no | |

---

## Source Traceability contract

Shared shapes (`schemas/common.schema.json`):

- **`Source`** — `{ id, kind, title, uri?, hash?, mediaType?, retrievedAt?, note? }`.
  `kind`: `repo`·`directory`·`markdown`·`text`·`json`·`yaml`·`pdf`·`docx`·`url`·`other`.
  `hash` is `sha256:<64 hex>`.
- **`SourceRef`** — `{ sourceId, locator?, quote? }`. `sourceId` must resolve to a
  `Source`.
- **`Locator`** — discriminated on `kind`, all variants also allow `commit`
  (7–40 hex) and `note`:
  - `file` — `path` (POSIX-style, source-root-relative; no absolute / UNC /
    drive-letter / backslash / `..` — semantic check), `lineStart?`, `lineEnd?`
    (`lineEnd ≥ lineStart`)
  - `page` — `page`, `pageEnd?`
  - `url` — `url`
  - `fragment` — `anchor` (heading path / selector / named section)
  - `text-range` — `charStart`, `charEnd`
- **`Evidence`** (deck-side) — `{ claimId?, factType?, statement?, confidence?, sourceRefs[] }`.
  A `FACT` evidence with no resolvable source is an error.
- **`Claim`** (knowledge-side) — `{ id, statement, factType, confidence?, sourceRefs[], supports?, note? }`.

A future slide/block assertion is traceable because its `sourceRefs` (or its
`evidence[].sourceRefs`, or the `Claim` referenced by `evidence.claimId`) point
to a `Source` and, through the `Locator`, to the exact place inside it.

---

## Versioning

`irVersion` follows the policy in `STABILITY.md`. A validator accepts any
`irVersion` sharing the supported major; a newer minor yields a warning; a
different major is an error unless a migration exists.
