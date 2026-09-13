# Reasoner & KnowledgeBuilder (Phase 2)

Status legend: **IMPLEMENTED** now · **PLANNED** later.

`ANALYZE → AnalysisResult → BUILD KNOWLEDGE → ProjectKnowledge`.

The Core never imports a model SDK. All reasoning enters through the `Reasoner`
interface, and its output is always schema-validated before the builder uses it.

---

## The `Reasoner` interface (**IMPLEMENTED**)

```ts
interface Reasoner {
  readonly capabilities: ReasonerCapabilities; // { id, version, deterministic, network, maxInputBytes? }
  analyze(request: ReasonerRequest): Promise<ReasonerResult>;
}
```

- `ReasonerRequest` — `{ sourceDigest, documents[], files[], hints? }`.
  `documents` is a trimmed view of each `SourceDocument` (`id, sourceId, path,
  kind, content, outline`); `files` is the full discovery inventory
  (`sourceId, path, kind, included, byteLength`) so a reasoner can reason about
  structure even for unsupported files. Both `documents` and `files` are keyed by
  `(sourceId, path)`, never `path` alone — two input roots can each carry a
  `README.md` and both survive into the request.
- `hints` (`{ audience?, focus? }`) is advisory, but it feeds the analysis cache
  key: `focus` is canonicalized as an **unordered set** (de-duplicated + sorted)
  before it is folded into `analysisDigest`.
- `ReasonerResult` — `{ analysis: AnalysisResult, reasoner: { id, version }, usage? }`.
  `reasoner.id` / `reasoner.version` **must** equal the reasoner's own
  `capabilities.id` / `capabilities.version`; a mismatch is fatal
  (`reasoner/identity-mismatch`) because provenance and the cache key depend on it.
- Errors — a `Reasoner` throws / rejects; the pipeline wraps anything that is not
  already an `ArclumeError` as `ReasonerError` (`reasoner/analyze-failed`,
  stage `REASONER`, severity `fatal`).

### Implementations

| Impl | `id` | Deterministic | Network | Purpose |
| --- | --- | --- | --- | --- |
| `StubReasoner` | `stub` | yes | no | Rule-based, offline. Tests, fixtures, CI, offline dev, and the reference for what the pipeline expects. |
| `AgentReasoner` | `agent` | yes* | no | An external agent (Claude Code, Codex, …) produces an `AnalysisResult` out of band; this loads it from an object, a JSON file, or a callback, and validates it. No SDK. |

\* deterministic given the same supplied result.

**PLANNED:** a provider adapter (e.g. Anthropic). It must live outside the Core
(no Anthropic-specific types in `ingestion/`, `knowledge/`, `pipeline/`), be
lazy/optional, and never load an SDK or credentials when unused. One provider is
enough to demonstrate the boundary — OpenAI is not planned unless a second is
needed.

---

## `AnalysisResult` (**IMPLEMENTED**)

Schema: `schemas/analysis-result.schema.json` (strict, `additionalProperties:
false`). Validated by `validateAnalysisResult(input)` — a **shape gate only**;
the builder still normalizes and re-validates the resulting `ProjectKnowledge`.

A reasoner returns *candidates*, never a `ProjectKnowledge`:

```
AnalysisResult = {
  analysisVersion,
  project:   ProjectCandidate                { name, summary?, purpose?, …, evidence[] }
  entities:  EntityCandidate[]               { kind, name, key?, attrs?, factType?, evidence[] }
  relations: RelationCandidate[]             { fromKey, toKey, type, label?, evidence[] }
  claims:    ClaimCandidate[]                { statement, factType, confidence?, supportsKeys?, evidence[] }
  gaps:      GapCandidate[]                  { question, why?, severity?, blocksKeys? }
}
EvidenceCandidate = { documentId, lineStart?, lineEnd?, quote? }
```

- `kind` ∈ capability · component · actor · dependency · process · phase ·
  milestone · metric · risk · decision · requirement · technology · result ·
  constraint.
- `key` is a stable hint for id derivation and cross-references; when absent a
  key is synthesized from `kind` + `name`. `relations`/`claims`/`gaps` reference
  entities by key (plus the literal `"project"`).
- `attrs` is a bounded string map carrying kind-specific extras (`version`,
  `scope`, `kind`, `unit`, `value`, `likelihood`, `impact`, `mitigation`,
  `category`, `priority`, `status`, `date`, …).

### Evidence-first rules

- **FACT** must have resolvable evidence. The builder downgrades an unsupported
  FACT to INFERENCE (it never leaves invalid IR, and never silently keeps it).
- **INFERENCE** should carry its documentary basis when one exists.
- **UNKNOWN** claims become **gaps** (`builder/unknown-to-gap`).
- **RECOMMENDATION** stays a claim; it is never folded into project status or
  results.

---

## KnowledgeBuilder — `buildProjectKnowledge(input)` (**IMPLEMENTED**)

`src/knowledge/builder.ts`. Deterministic given the same `AnalysisResult` +
ingested sources/documents. Returns `{ knowledge, report }`.

1. **Evidence resolution** — each `EvidenceCandidate.documentId` → a `SourceRef`
   with `{ sourceId, locator: { kind: "file", path, lineStart?, lineEnd? }, quote? }`.
   Evidence is **verified against the real document**, never silently corrected —
   a candidate that fails any check is dropped, `evidenceUnresolved` is
   incremented, and a structured note is emitted:
   - unknown `documentId` → `builder/evidence-unresolved`
   - `lineEnd < lineStart` → `builder/evidence-range-invalid`
   - a line outside `1..lineCount` → `builder/evidence-out-of-bounds`
     (line 9000 is *not* clamped to the last line)
   - `quote` present but not found verbatim in the cited range (or in the whole
     document when no range is given) → `builder/evidence-quote-mismatch`
     (exact match on normalized content; no fuzzy matching in this phase)
2. **Deduplication** (conservative — `src/knowledge/dedupe.ts`) — candidates
   merge only on an identical explicit `key` or identical case/whitespace-
   normalized name. Anything more ambiguous ("React" vs "React.js") is kept
   separate and reported as `builder/near-duplicate`. Arclume never invents
   equivalences.
3. **Deterministic ids** — `deriveId(kind, keyBody)` (Phase 1 helper). No
   randomness, no clock, no filesystem order. Collisions get a numeric suffix.
4. **Reference resolution** — relations with an unresolved endpoint are dropped
   (`builder/relation-dropped`); `claim.supports` / `gap.blocks` keys that do not
   resolve are dropped. The output never violates Phase 1 cross-reference rules.
5. **Ordering** — every collection sorted by `id`; relations by
   `(from, to, id)`; sources by `id`.
6. **Provenance** — `meta.generator` + `meta.contentHash` (= `contentHash` of the
   knowledge payload without `meta`). No timestamp.
7. **Validation** — `validateProjectKnowledge` runs last. Invalid → throws
   `KnowledgeBuildError` (fatal) with the report as a hint. Warnings are folded
   into `report.notes`. The real `ValidationResult` is returned as
   `output.validation` (and propagated by `buildKnowledge` as `BuildOutput.validation`)
   — never a fabricated clean result.

`report.stats` exposes counts plus `evidenceResolved` / `evidenceUnresolved` /
`factsDowngraded` / `relationsDropped`.

---

## Pipeline API (**IMPLEMENTED**)

`analyze` and `build` are kept separate (the Phase 9 CLI design):

- `runAnalyze(inputs, reasoner, options?)` → `{ sourceDigest, analysisDigest,
  ingestion, request, analysis, reasoner }`. Validates the reasoner output;
  a malformed `AnalysisResult` throws `ReasonerError` (`reasoner/malformed-output`),
  a lying identity throws `reasoner/identity-mismatch`. `analysisDigest` folds in
  the source digest, the reasoner id/version **and** the canonicalized `hints`
  (`canonicalAnalysisConfig`), so the same source + reasoner with a different
  `audience` / `focus` set gets a distinct key.
- `buildKnowledge({ analysis, ingestion, sourceDigest })` → `{ knowledge, report,
  validation }` — `validation` is the actual `validateProjectKnowledge` result
  for the knowledge that was built.
- `runPipeline(inputs, reasoner, options?)` chains both.
- `writeArtifacts(dir, bundle)` writes `manifest.json`, `sources.json`,
  `documents/index.json`, `documents/<id>.json`, `analysis.json`,
  `project-knowledge.json` — each a deterministic, independently inspectable file.

**Not in Phase 2:** Narrative Planner, Slide Planner, VisualDirector, any
renderer. The internal API separation is in place for them.
