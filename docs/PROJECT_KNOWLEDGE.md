# ProjectKnowledge — Reference

Schema: `schemas/project-knowledge.schema.json` (authoritative).
TS types: `src/types/knowledge.ts` (mirror).
Current `knowledgeVersion`: **0.1.0**.

`ProjectKnowledge` is the presentation-independent model of a project. It is
built once and any number of decks can be derived from it. Phase 1 defined and
validated the model. **Phase 2 builds it**: `ingest()` produces
`SourceDocument[]`, a `Reasoner` produces an `AnalysisResult`, and
`buildProjectKnowledge()` turns that into a validated `ProjectKnowledge` — see
`docs/INGESTION.md` and `docs/REASONER.md`. Deck generation from it is still
**PLANNED**.

---

## Top level

All fields below are **required**. Every entity collection is an array that may
be empty, so a consumer never has to null-check a collection.
`additionalProperties: false` everywhere.

| Field | Notes |
| --- | --- |
| `knowledgeVersion` | SemVer; see `STABILITY.md`. |
| `meta` | optional. `{ generatedAt?, generator?, contentHash? }` — provenance of the *analysis*, injected, never auto-filled on read. |
| `project` | single object (below). |
| `sources` | array of `Source` (see `IR.md` → Source Traceability). |
| `capabilities` `components` `actors` `dependencies` `processes` `phases` `milestones` `metrics` `risks` `decisions` `requirements` `technologies` `results` `constraints` | entity collections (below). |
| `relations` | typed directed edges. |
| `claims` | classified statements. |
| `gaps` | known unknowns. |

---

## `project`

`{ id, name, summary?, purpose?, problem?, solution?, status?, nextSteps?, tags?, sourceRefs }`
— `id`, `name`, `sourceRefs` required.

---

## Entity collections

Every entity has `id` (unique across the whole document) and `sourceRefs`
(array, may be empty). Highlights:

| Collection | Item shape (beyond `id` / `sourceRefs`) |
| --- | --- |
| `capabilities` | `name`, `description?`, `tags?` |
| `components` | `name`, `kind?` (`service`·`ui`·`store`·`job`·`library`·`gateway`·`external`·`other`), `responsibilities?`, `technologies?` (ids of `technologies`), `tags?` |
| `actors` | `name`, `type?` (`human`·`system`·`organization`·`other`), `description?` |
| `dependencies` | `name`, `version?`, `scope?` (`runtime`·`dev`·`peer`·`optional`·`service`·`other`), `ecosystem?` |
| `processes` | `name`, `trigger?`, `steps?` (`{ label, detail? }`), `outcome?` |
| `phases` | `name`, `status?` (`planned`·`active`·`done`·`blocked`·`cancelled`), `start?`, `end?`, `summary?` |
| `milestones` | `name`, `date?`, `achieved?`, `phaseId?` (→ `phases`) |
| `metrics` | `name`, `value?`, `unit?`, `baseline?`, `target?`, `asOf?`, `direction?` (`up-good`·`down-good`·`neutral`) |
| `risks` | `statement`, `likelihood?`, `impact?`, `mitigation?`, **`factType`** |
| `decisions` | `statement`, `rationale?`, `date?`, `status?` (`proposed`·`accepted`·`superseded`·`rejected`) |
| `requirements` | `statement`, `kind?` (`functional`·`non-functional`·`constraint`·`assumption`), `priority?` (`must`·`should`·`could`·`wont`) |
| `technologies` | `name`, `category?` (`language`·`framework`·`runtime`·`database`·`infra`·`saas`·`library`·`tool`·`protocol`·`other`) |
| `results` | `statement`, `metricId?` (→ `metrics`) |
| `constraints` | `statement`, `kind?` (`technical`·`business`·`legal`·`time`·`budget`·`other`) |

Dates (`start`, `end`, `date`, `asOf`) are free-form strings ("2026-06",
"Q3 2026") — not parsed in Phase 1.

---

## `relations[]`

`{ id, from, to, type, label?, sourceRefs }`.

`from` and `to` must be **domain-entity ids** (any of the 14 entity collections,
or `project`). `type` is one of:

`DEPENDS_ON` · `PART_OF` · `PRODUCES` · `CONSUMES` · `MITIGATES` · `OWNS` ·
`PRECEDES` · `MEASURES` · `IMPLEMENTS` · `THREATENS` · `DECIDES` ·
`USES_TECHNOLOGY` · `RESPONSIBLE_FOR` · `DERIVED_FROM` · `RELATES_TO`.

Relations are preserved as first-class data so a later phase can render
dependency graphs, component maps, ownership views, etc. from the same model.

---

## `claims[]` — the FACT rule

`{ id, statement, factType, confidence?, sourceRefs, supports?, note? }`.

`factType` is **required** and one of:

| Value | Meaning | Evidence requirement |
| --- | --- | --- |
| `FACT` | Stated in a source. | **≥ 1 resolvable `sourceRef`** — enforced (`claim/fact-without-evidence`, error). |
| `INFERENCE` | Reasoned from sources, not stated outright. | `sourceRefs` recommended; empty → warning `claim/inference-without-basis`. |
| `UNKNOWN` | An open question the material does not answer. | none. |
| `RECOMMENDATION` | A suggested action, not a finding. | none. |

The same FACT rule applies to `risks[].factType`.

Information without sufficient evidence is **never** silently promoted to `FACT`;
the validator rejects it, and unanswered questions belong in `gaps`.

`supports[]` lists ids this claim provides evidence for. Each target must be
`project`, a domain entity, or **another claim** — pointing at a `source`,
`relation` or `gap` id is rejected (`cross-ref/unknown-target`).

---

## `gaps[]`

`{ id, question, why?, blocks?, severity? }`. `blocks[]` lists ids of entities
whose confidence is limited by the gap; each must resolve. `severity`:
`low`·`medium`·`high`.

---

## Cross-reference checks (IMPLEMENTED)

See `ARCHITECTURE.md` §4 for the full list. In short: ids unique document-wide;
every `sourceRef` resolves; every relation endpoint and typed reference
(`phaseId`, `metricId`, `technologies`, `gap.blocks`) resolves; `claim.supports`
targets are restricted to `project` / domain entities / other claims; FACT
claims/risks carry evidence; `file` locator paths are POSIX-style
source-root-relative (no absolute / UNC / drive-letter / backslash / `..`); and
`file`, `page` and `text-range` locators must have non-inverted ranges
(`lineEnd ≥ lineStart`, `pageEnd ≥ page`, `charEnd ≥ charStart`).
