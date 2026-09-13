# Arclume — Architecture

Status legend: **IMPLEMENTED** (in this repository now) · **PLANNED** (later phase).

---

## 1. Shape of the system

Arclume is a headless Core. Every future surface (a CLI, an agent skill, a web
UI) is a *client* of the Core; no logic lives only in a client.

The full pipeline the Core will eventually run:

```
INPUT → INGEST → ANALYZE → BUILD KNOWLEDGE → SELECT NARRATIVE → PLAN SLIDES
      → SELECT VISUALS → GENERATE DIAGRAM IR → GENERATE ARCLUME IR
      → VALIDATE → RENDER → VISUAL QA → EXPORT
```

Everything from **BUILD KNOWLEDGE** onward is a pure, deterministic function of
its inputs. The only stage that needs a language model is **ANALYZE**, and it is
reached through an injected interface so the rest stays testable and
reproducible.

Phase 1 implemented the two representations at the centre of that pipeline
(`ProjectKnowledge` and `ArclumeDeck`), their schemas, and their validation.
Phase 2 implemented the left of the pipeline: `INGEST`, the `ANALYZE` boundary
(`Reasoner` + `AnalysisResult`), and `BUILD KNOWLEDGE`. Phase 3 implemented
`SELECT NARRATIVE` and `PLAN SLIDES` as two new intermediate contracts
(`NarrativePlan`, `SlidePlan`) — deterministic, render-independent, evidence-first.
Phase 4 implemented `SELECT VISUALS` + `GENERATE DIAGRAM IR` + `GENERATE ARCLUME
IR` (the `ArclumeDeck`), Phase 5 implemented `RENDER` (the self-contained HTML),
and Phase 6 implemented `VISUAL QA` — real headless Chromium plus screenshots,
receipts and atomic delivery. `EXPORT` (PPTX/PDF/PNG) is still Phase 8.

---

## 2. What Phase 1 contains

```
schemas/
  common.schema.json            IMPLEMENTED  shared $defs (ids, locators, sourceRef, claim, …)
  project-knowledge.schema.json  IMPLEMENTED  the ProjectKnowledge model
  arclume-deck.schema.json       IMPLEMENTED  the ArclumeDeck IR (incl. block union)

src/
  version.ts                    IMPLEMENTED  IR_VERSION, KNOWLEDGE_VERSION, SemVer policy helpers
  types/
    common.ts                   IMPLEMENTED  shared TS types (mirror of common.schema.json)
    knowledge.ts                IMPLEMENTED  ProjectKnowledge TS types
    deck.ts                     IMPLEMENTED  ArclumeDeck TS types
    blocks.ts                   IMPLEMENTED  Block discriminated union + guards
  determinism/
    hash.ts                     IMPLEMENTED  stableStringify, sha256*, contentHash
  knowledge/
    ids.ts                      IMPLEMENTED  deterministic id derivation (slugify, deriveId, …)
  schema/
    paths.ts                    IMPLEMENTED  locate bundled schemas portably
    loader.ts                   IMPLEMENTED  compile schemas with AJV (draft 2020-12), cached
  validation/
    result.ts                   IMPLEMENTED  ValidationIssue / ValidationResult, sorting
    format-error.ts             IMPLEMENTED  AJV errors → enriched issues (code, context, hint)
    cross-ref.ts                IMPLEMENTED  semantic checks JSON Schema cannot express
    validator.ts                IMPLEMENTED  public entry points + report formatter
  migrations/
    index.ts                    IMPLEMENTED  migration registry + engine skeleton (no steps yet)
  index.ts                      IMPLEMENTED  public API surface

tests/                          IMPLEMENTED  Phase 1 + Phase 2 tests + fixtures
docs/                           IMPLEMENTED  this file + IR / PROJECT_KNOWLEDGE / STABILITY / INGESTION / REASONER / SECURITY
```

---

## 2b. What Phase 2 adds

```
schemas/
  analysis-result.schema.json   IMPLEMENTED  the Reasoner output contract (strict)

src/
  errors.ts                     IMPLEMENTED  ArclumeError + staged subclasses + PipelineNote (fail-soft)
  ingestion/
    types.ts                    IMPLEMENTED  SourceDocument, DiscoveryResult, limits, skip reasons
    ignore-rules.ts             IMPLEMENTED  security denylist + sensitive-name patterns + extension map
    binary.ts                   IMPLEMENTED  binary sniffing, BOM/CRLF normalization, line count
    discover.ts                 IMPLEMENTED  the safe deterministic walk (+ public discover())
    markdown-outline.ts         IMPLEMENTED  dependency-free Markdown structure extractor
    parsers.ts                  IMPLEMENTED  markdown / text / json / yaml (safe core schema)
    ingest.ts                   IMPLEMENTED  walk -> normalize -> parse -> SourceDocument[]
    digest.ts                   IMPLEMENTED  order-independent sourceDigest / analysisDigest
  analysis/
    analysis-result.ts          IMPLEMENTED  AnalysisResult candidate types (mirror of the schema)
    reasoner.ts                 IMPLEMENTED  the Reasoner interface + request/result/capabilities
    reasoners/stub.ts           IMPLEMENTED  StubReasoner — deterministic, offline, rule-based
    reasoners/agent.ts          IMPLEMENTED  AgentReasoner — object / file / callback, schema-validated
  knowledge/
    dedupe.ts                   IMPLEMENTED  conservative entity dedup + near-duplicate detection
    builder.ts                  IMPLEMENTED  AnalysisResult -> validated ProjectKnowledge
  pipeline/
    run.ts                      IMPLEMENTED  runAnalyze / buildKnowledge / runPipeline
    artifacts.ts                IMPLEMENTED  writeArtifacts + readers (per-stage JSON)
  validation/validator.ts       IMPLEMENTED  + validateAnalysisResult

.github/workflows/ci.yml        IMPLEMENTED  npm ci -> typecheck -> lint -> test -> build (Node 20)
examples/fixtures/sample-repo/  IMPLEMENTED  a small realistic API project for the e2e test
```

## 2c. What Phase 3 adds

```
schemas/
  narrative-plan.schema.json    IMPLEMENTED  the NarrativePlan contract (strict, versioned independently)
  slide-plan.schema.json        IMPLEMENTED  the SlidePlan contract (strict, versioned independently)

src/
  narrative/
    types.ts                    IMPLEMENTED  NarrativePlan / section / selection / decision / note types
    knowledge-view.ts           IMPLEMENTED  normalized, indexed, order-independent read view over ProjectKnowledge
    selector.ts                 IMPLEMENTED  KnowledgeSelector — score → selected / deprioritized / omitted (+ reason)
    planner.ts                  IMPLEMENTED  buildNarrativePlan + narrativeContentHash (deterministic)
    presets/
      types.ts                  IMPLEMENTED  AudienceProfile / SectionTemplate (declarative)
      executive.ts / technical.ts / general.ts / index.ts  IMPLEMENTED
  planning/
    types.ts                    IMPLEMENTED  SlidePlan / PlannedSlide / VisualIntent / SlideBudget types
    messaging.ts                IMPLEMENTED  deterministic key-message derivation per narrative purpose
    density.ts                  IMPLEMENTED  semantic density estimate (counts, not pixels)
    budget.ts                   IMPLEMENTED  normalizeBudget + applyBudget (merge → drop → under-budget note)
    slide-planner.ts            IMPLEMENTED  buildSlidePlan (cover + sections + closing, split, budget)
  validation/
    plan-cross-ref.ts           IMPLEMENTED  semantic checks for NarrativePlan / SlidePlan
    validator.ts                IMPLEMENTED  + validateNarrativePlan / validateSlidePlan
  pipeline/
    run.ts                      IMPLEMENTED  + planNarrative / planSlides / runPlanning (stages stay separable)
    artifacts.ts                IMPLEMENTED  + narrative-plan.json / slide-plan.json (write + read)
  errors.ts                     IMPLEMENTED  + PLANNING stage + PlanningError

tests/fixtures/planning/        IMPLEMENTED  sparse-knowledge.json, wide-knowledge.json
```

## 2d. What Phase 4 adds

```
schemas/
  arclume-deck.schema.json      IMPLEMENTED  IR 0.1.0 → 0.2.0: keyMessage 200→240,
                                             provenance.narrativeRef / .slidePlanRef added (optional)

src/
  visual/
    types.ts                    IMPLEMENTED  VisualKind / LayoutKind / VisualDecision / VisualLimits
    theme.ts                    IMPLEMENTED  Theme token contract + minimal / executive + themeTokensRef
    intent.ts                   IMPLEMENTED  resolveVisual — ACCEPT / REFINE / DOWNGRADE
models.ts                   IMPLEMENTED  native architecture / process / sequence / timeline / roadmap
                                              models + DiagramAdapter (native adapter; Visual Engine is Phase 7)
    blocks.ts                   IMPLEMENTED  block builders (all 16 types), bounded, provenance-carrying
    layouts.ts                  IMPLEMENTED  layout taxonomy + deterministic selection
    emphasis.ts                 IMPLEMENTED  one primary block per slide
    director.ts                 IMPLEMENTED  buildVisualDeck / directVisuals (deterministic)
    index.ts                    IMPLEMENTED  visual public surface
  validation/
    deck-cross-ref.ts           IMPLEMENTED  Phase 4 structural checks WITH context (binding, 1:1 slide
                                             binding, keyMessage integrity, ref resolution)
    validator.ts                IMPLEMENTED  validateArclumeDeck(input, { knowledge?, narrative?, slidePlan? })
  migrations/index.ts           IMPLEMENTED  + deck 0.1.0 → 0.2.0 step (pure restamp)
  pipeline/
    run.ts                      IMPLEMENTED  + buildDeck / runDeck (stages stay separable)
    artifacts.ts                IMPLEMENTED  + arclume-deck.json (write + read)

docs/                           IMPLEMENTED  + VISUAL_DIRECTOR.md, THEMES.md, VISUAL_MODELS.md
tests/                          IMPLEMENTED  + visual.director / visual.themes / visual.models
                                             / deck.build.e2e / deck.schema.compat
```

## 2e. What Phase 5 adds

```
src/
  renderers/
    html/
      escape.ts                 IMPLEMENTED  the escaping spine (HTML text/attr, id allowlist,
                                             language allowlist, data:image allowlist)
      theme.ts                  IMPLEMENTED  ThemeTokens → concrete CSS custom properties
      styles.ts                 IMPLEMENTED  the single shared, namespaced stylesheet
      viewer-runtime.ts         IMPLEMENTED  the inline viewer JS (no framework, no network, no deck JSON)
      blocks.ts                 IMPLEMENTED  exhaustive block renderer (16 types) + assertNever
      diagrams.ts               IMPLEMENTED  deterministic native SVG (architecture/process/sequence/timeline/roadmap)
      slides.ts                 IMPLEMENTED  exhaustive layout switch, provenance data-* attributes
      document.ts               IMPLEMENTED  HTML5 shell + strict CSP + deterministic metadata
      validation.ts             IMPLEMENTED  structural post-checks (slide/block/diagram present, no NUL, no remote)
      renderer.ts               IMPLEMENTED  renderDeckHtml — validate-then-render, pure, deterministic
      index.ts                  IMPLEMENTED  html renderer public surface + HTML_RENDERER_VERSION
  pipeline/
    run.ts                      IMPLEMENTED  + renderHtml / runHtml (DECK → HTML stage stays separable)
    artifacts.ts                IMPLEMENTED  + arclume-deck.html (writeHtmlArtifact + bundle.html)
  errors.ts                     IMPLEMENTED  + RENDER stage + RenderError

src/planning/budget.ts          IMPLEMENTED  hygiene: NUL separator → `\u0000` escape (runtime identical)

docs/                           IMPLEMENTED  + HTML_RENDERER.md, VIEWER.md
tests/                          IMPLEMENTED  + html.renderer / html.diagrams / html.security
                                             / html.viewer / html.e2e / repo.hygiene
```

The renderer runs strictly after a validated `ArclumeDeck`: it re-runs
`validateArclumeDeck` (fatal on invalid), never consults the Reasoner /
NarrativePlanner / SlidePlanner / an LLM, and never alters deck semantics — it
lays out, styles, wraps and draws. `HTML_RENDERER_VERSION` is independent of
`IR_VERSION` (still `0.2.0`).

## 2f. What Phase 6 adds

```
schemas/
  visual-qa.schema.json           IMPLEMENTED  the VisualQaResult body (strict, versioned)
  visual-qa-receipt.schema.json   IMPLEMENTED  the Visual QA receipt (hashable evidence)
  delivery-manifest.schema.json   IMPLEMENTED  the atomic delivery manifest

src/
  validation/visual-qa/
    types.ts                      IMPLEMENTED  VISUAL_QA_VERSION, VisualFinding / -Result / -Run,
                                               viewports, the finding-code registry
    browser.ts                    IMPLEMENTED  Playwright/Chromium boundary (lazy import), normalized
                                               context, runtime observers, setContent + fonts.ready
    viewer-checks.ts              IMPLEMENTED  physically drive the viewer (clicks + keys + hash)
    geometry.ts                   IMPLEMENTED  in-page measurement + pure finding derivation
    screenshots.ts                IMPLEMENTED  one stage PNG per slide + a viewer overview (buffers)
    contrast.ts                   IMPLEMENTED  token-level WCAG contrast QA
    findings.ts                   IMPLEMENTED  runtime findings, stable sort, severity tally
    regression.ts                 IMPLEMENTED  compareScreenshots (pixelmatch + pngjs)
    schema.ts                     IMPLEMENTED  a dedicated AJV for the Phase 6 schemas
    receipt.ts                    IMPLEMENTED  visualQaJson + buildVisualQaReceipt + visualQaConfigHash
    runner.ts                     IMPLEMENTED  runVisualQa — launch, per-viewport passes, assemble
    index.ts                      IMPLEMENTED  runVisualQa / validateRenderedDeck + public surface
  delivery/
    types.ts / manifest.ts / verify.ts / atomic.ts / index.ts
                                  IMPLEMENTED  staging -> evidence preflight -> hash -> manifest ->
                                               verify -> QA gate -> rename; verifyManifest (tamper
                                               detection); hash-derived deliveryId
    bindings.ts                   IMPLEMENTED  validateDeliveryBindings — deck / html / QA identity /
                                               result tally / screenshot buffers all one coherent run
    paths.ts                      IMPLEMENTED  validateBundleRelativePath + resolveConfined — the one
                                               canonical path validator; no manifest read escapes the bundle
  pipeline/run.ts                 IMPLEMENTED  + runDeckVisualQa / runValidatedDelivery (stages separable)
  errors.ts                       IMPLEMENTED  + VISUAL_QA / DELIVERY stages + VisualQaError / DeliveryError
  version.ts                      IMPLEMENTED  + VISUAL_QA_VERSION "0.1.0", DELIVERY_MANIFEST_VERSION "0.1.0"

tsconfig.json                     IMPLEMENTED  + "DOM" lib (Playwright page.evaluate needs DOM types)
vitest.visual.config.ts           IMPLEMENTED  the Chromium suite (single-fork) — `npm run test:visual`
.github/workflows/ci.yml          IMPLEMENTED  + a separate `visual-qa` job (installs Chromium)
docs/                             IMPLEMENTED  + VISUAL_QA.md, ATOMIC_DELIVERY.md
tests/visual/                     IMPLEMENTED  deck regressions, runtime, viewer, geometry detectors,
                                               themes, XSS, regression, receipt, atomic delivery
```

Visual QA is engine-agnostic about the HTML, browser-bound and asynchronous. It
opens the document in real headless Chromium and only observes, measures and
captures — it never mutates the deck or the HTML, and it never executes deck
content (a `CodeBlock` stays text). `VISUAL_QA_VERSION` is independent of both
`IR_VERSION` (`0.2.0`) and `HTML_RENDERER_VERSION` (`0.1.0`). `playwright` is a
dev dependency, imported lazily — `import "arclume"` never requires it.

### Phase 7 — diagram engine layer (implemented)

```
src/engines/types.ts            shared engine types (ResolvedDiagramArtifact union, report)
src/engines/visual/             vendored visual engine: adapter (pure), runner (subprocess),
                                 sanitize (saxes, allowlist, rebuild), validate, report, style-map,
                                 vendored identity constants
vendor/archify/                 Visual engine v2.16.0, fixed file copy + VENDOR.md + LICENSE
src/pipeline/diagram-engine-preference.ts   pure deck → deck engine-preference transform
src/pipeline/resolve-diagrams.ts            observational resolver + loud fallback + report
src/pipeline/canonical-render.ts            CanonicalDeckRenderInput + renderCanonicalDeckHtml
                                            (the only definition of canonical HTML)
```

The engine layer never imports `src/renderers/html/**`; the HTML renderer
consumes already-resolved, trusted artifacts.

### PLANNED directories (not present yet)

`src/renderers/{svg,pptx,pdf}/`, `src/cli/`, and a
provider `Reasoner` adapter (outside the Core). They will be added in their
phases (8+).

---

## 3. Validation model (IMPLEMENTED)

`validateProjectKnowledge(input)` and `validateArclumeDeck(input)` each run three
layers and never throw:

1. **Version** — `checkCompatibility(found, supported)`. A different major →
   `error` (`version/incompatible`); a newer minor → `warning`
   (`version/newer-minor`); otherwise silent.
2. **JSON Schema** — a cached AJV 2020 instance (`strict: true`,
   `allErrors: true`) validates against the bundled schema. Raw AJV errors are
   converted by `format-error.ts` into `ValidationIssue`s that add: a stable
   `code` (`schema/additional-properties`, `schema/required`, `schema/enum`,
   `schema/one-of`, `schema/pattern`, `schema/range`, …), a readable `message`
   naming the offending property/value, the nearest labeled ancestor
   (`entityId` / `entityKind` / `label`), and a `hint` where useful. Block
   `oneOf` noise is trimmed to the branch matching the block's `type`.
3. **Semantic / cross-reference** (`cross-ref.ts`) — runs only if the schema
   layer produced no errors, so it can trust the shape. See §4.

Results are sorted deterministically by `instancePath`, then severity, then
`code`. `formatValidationReport(result)` renders a stable text report.

### Why the schema is the source of truth

The `src/types/*.ts` definitions are a hand-maintained mirror for editor
ergonomics. Tests exercise the **schemas**, not the types. A later phase may
generate one from the other; until then, the schema wins any disagreement.

### Standalone validators (PLANNED)

`schema/loader.ts` compiles at runtime today. It is deliberately the only module
that knows how validators are produced, so a later phase can swap in
AJV `standalone`-generated, committed validator modules (no runtime compile, no
dependency) without touching callers.

---

## 4. Semantic checks (IMPLEMENTED)

**ProjectKnowledge**

- `cross-ref/duplicate-id` — ids must be unique across `project`, `sources`, all
  entity collections, `relations`, `claims`, `gaps`.
- `cross-ref/unknown-source` — every `SourceRef.sourceId` must resolve to a
  `sources[].id`.
- `cross-ref/unknown-relation-endpoint` — `relation.from` / `relation.to` must
  be domain-entity ids (the 14 entity collections + `project`).
- `cross-ref/unknown-target` — `milestone.phaseId`, `result.metricId`,
  `component.technologies[]`, `gap.blocks[]`, and `claim.supports[]`. A
  `claim.supports[]` target must be `project`, a domain entity, or **another
  claim** — a `source`, `relation` or `gap` id is rejected. The check uses
  explicit `entityIds` / `claimIds` sets, not the duplicate-id map.
- `claim/fact-without-evidence` (**error**) — a `Claim` or `Risk` with
  `factType: "FACT"` and no resolvable `sourceRef`. Content without evidence is
  never silently a FACT.
- `claim/inference-without-basis` (**warning**) — `factType: "INFERENCE"` with
  zero `sourceRefs`.
- `cross-ref/unsafe-locator-path` (**error**) — a `file` locator whose `path` is
  not a POSIX-style source-root-relative path. Rejected via
  `isSafeRelativeLocatorPath()`: absolute (`/x`), protocol-relative (`//host`),
  Windows drive (`C:/x`), any backslash (`C:\x`, `\\unc`, `foo\..\x`), control
  characters, leading/trailing whitespace, and any empty or `..` segment
  (`../x`, `foo/../x`, `a//b`). Pure string check — the filesystem is never
  touched and the value is never rewritten.
- `cross-ref/locator-range` (**error**) — `file`: `lineEnd < lineStart`;
  `page`: `pageEnd < page`; `text-range`: `charEnd < charStart`. Equal bounds
  are valid.

**ArclumeDeck**

- `cross-ref/duplicate-id` — across slides, every nested block, diagrams,
  narrative sections.
- `deck/slide-index-mismatch` (**error**) — `slides[i].index` must equal `i`.
- `cross-ref/unknown-section` — `slide.sectionId` → `narrative.sections[].id`.
- `cross-ref/unknown-diagram` — `slide.diagramRef` and diagram-family block
  `diagramRef` → `diagrams[].id`.
- `cross-ref/unknown-source` — every `SourceRef.sourceId` in the deck →
  `provenance.sources[].id`.
- `block/diagram-type-mismatch` (**warning**) — an `architecture` / `workflow`
  block pointing at a diagram whose `diagramType` differs.
- `block/table-row-arity` (**error**) — a table row whose length ≠ column count.
- `evidence/fact-without-evidence` (**error**) — deck `Evidence` marked `FACT`
  with no resolvable source.
- `slide/key-message-long`, `deck/empty-slide`, `block/text-wall`,
  `evidence/empty` (**warnings**) — density / traceability nudges.

---

## 5. Determinism (IMPLEMENTED)

- No `Math.random`, `Date.now`, `new Date()`, `crypto.randomUUID`,
  `performance.now`, or `process.hrtime` anywhere in `src/`. A test
  (`determinism.test.ts`) scans the source tree and fails if any appear.
- `stableStringify` sorts object keys at every level, preserves array order,
  drops `undefined` members, and throws on non-finite numbers / circular refs.
- `contentHash(value)` = `sha256:` + hex SHA-256 of `stableStringify(value)`.
- `deriveId` / `deriveReadableId` derive ids from their inputs only.
- Timestamps appear in an artifact only if a caller injects them
  (`meta.generatedAt`, `source.retrievedAt`).

---

## 6. Security posture (IMPLEMENTED at the type/policy level)

- The Core never executes analysed content — Phase 1 has no execution paths at
  all; the constraint is documented here so later phases inherit it.
- No file reads except the bundled `schemas/` (via `schema/paths.ts`, which
  resolves them portably — no hard-coded absolute or platform-specific paths).
- No network access.
- `Source` / `SourceRef` / `Locator` are designed so provenance can be recorded
  without ever embedding secret material; `file` locator paths are constrained
  to be POSIX-style source-root-relative paths by `isSafeRelativeLocatorPath()`
  (see §4), which rejects absolute / UNC / drive-letter / backslash / `..`
  forms without resolving anything against the real filesystem.
- `.gitignore` excludes `.env*`, `*.pem`, `*.key`, `id_rsa*`, `credentials.json`,
  `secrets.json`, `dist/`, `coverage/`, `node_modules/`.

---

## 7. Phase plan

| Phase | Scope | State |
| --- | --- | --- |
| **1** | Core IR + schemas + validation | **DONE** |
| **2** | Ingestion (repo/md/txt/json/yaml) + Reasoner boundary + KnowledgeBuilder + CI | **DONE** |
| **3** | Narrative Planner + Slide Planner (`NarrativePlan` + `SlidePlan`, no deck yet) | **DONE** |
| **4** | VisualDirector + block system + themes + native simple diagrams → `ArclumeDeck` | **DONE** |
| **5** | HTML renderer + self-contained viewer runtime | **DONE** |
| **6** | Chromium Visual QA + screenshots + receipts + atomic delivery | **DONE (this phase)** |
| 7 | Visual engine (vendored, architecture + workflow) | **DONE** |
| 8 | PDF/DOCX/URL ingestion + PPTX/PDF/PNG export | PLANNED |
| 9 | SKILL.md + CLI polish + more presets/themes + `watch` | PLANNED |
| 10 | Optional web UI | PLANNED |

---

## 8. Key decisions in Phase 1

1. **Schema-first, types-mirror.** JSON Schema is authoritative; TS types are for
   DX. Tests target schemas.
2. **`unevaluatedProperties: false` for the block union.** Lets the shared block
   base and the matched variant both contribute properties while still rejecting
   unknown keys, without repeating the base fields in every branch.
3. **Semantic layer gated on a clean schema pass.** Keeps cross-ref code free of
   defensive shape-checking noise and keeps error output focused.
4. **`diagram` / `architecture` / `workflow` kept as three block types.** The
   latter two are semantic subtypes of `diagram` (same `diagramRef` mechanism);
   keeping them named lets the future planner reason about intent and lets
   validation check `diagramType` agreement.
5. **`Locator` is a discriminated union, not a bag.** `file` / `page` / `url` /
   `fragment` / `text-range`, each with its own required fields, plus shared
   `commit` and `note`. New source shapes get new variants; existing ones stay
   strict.
6. **Migration engine now, migration steps never-until-needed.** `migrate()` can
   walk an ordered step graph; the registry is empty and identity-only for
   `0.1.0`.
7. **`ajv-formats` loaded via `createRequire`.** Its CJS/ESM type surface breaks
   default-import interop under NodeNext; `require` gets the callable plugin
   unambiguously and stays deterministic.

---

## 9. Key decisions in Phase 2

1. **A Reasoner returns candidates, not `ProjectKnowledge`.** `AnalysisResult` is
   its own strict schema; the KnowledgeBuilder is the only thing that mints ids,
   resolves references and validates. The pipeline schema-validates every
   Reasoner output before the builder sees it — `runAnalyze` throws
   `reasoner/malformed-output` otherwise.
2. **Two Reasoner implementations, zero SDKs.** `StubReasoner` (rule-based,
   offline) and `AgentReasoner` (an agent's `AnalysisResult` loaded from an
   object / file / callback) exercise the boundary completely. A provider adapter
   is deferred and must live outside the Core.
3. **Hand-rolled Markdown outliner.** Only *structure* is needed (headings, code
   fences, links, line numbers), which is regex-tractable and fully
   deterministic. `remark` would add ~30 transitive packages for no gain here.
   New runtime deps are just `ignore` (exact `.gitignore` semantics) and `yaml`
   (safe parsing must not be hand-rolled).
4. **Discovery is one shared walk.** `walkRoot` reads candidate bytes once (needed
   for binary detection) and hands them to ingest; `discover()` is the same walk
   with contents stripped. No double IO, no duplicated safety logic.
5. **Symlinks are the traversal boundary.** Symlink dirents are never followed or
   read; the walk only ever descends real directories rooted at the input, so
   nothing escapes. Per-file `realpath` was dropped as redundant and
   Windows-flaky.
6. **Fail-soft, classified.** One unparseable or binary file is `recoverable`
   (skipped, run continues). A missing root or an invalid final
   `ProjectKnowledge` is `fatal`. FACT-without-evidence is a `warning`: the
   builder downgrades to INFERENCE rather than dropping data or emitting invalid
   IR.
7. **Conservative dedupe.** Merge only on identical key or identical
   case/whitespace-normalized name. "React" vs "React.js" stays two entities plus
   a `builder/near-duplicate` note — Arclume never invents an equivalence.
8. **Determinism by construction.** Name-sorted traversal, `sourceDigest` over a
   sorted document set, every builder collection sorted by id, `deriveId` from
   inputs only, no clock in artifacts. The order discovery finds files in cannot
   change the digest or the knowledge.

---

## 10. Key decisions in Phase 3

1. **Two intermediate contracts, no early `ArclumeDeck`.** `NarrativePlan` and
   `SlidePlan` are versioned independently and carry only what Phase 3 can
   truthfully decide (what to say, in what order, with what evidence). Visual
   fields are not stubbed to satisfy the deck schema — Phase 4 owns them.
2. **Audience presets are data.** An `AudienceProfile` is relevance weights + an
   ordered list of section templates + a closing emphasis. Adding an audience is
   adding a file, not a branch. The three MVP presets produce structurally
   different decks from the same knowledge (asserted).
3. **Selection is explicit and explainable.** `KnowledgeSelector` splits every
   id into `selected` / `deprioritized` / `omitted`, and every omission carries
   one of six reasons — the raw material for a future `arclume explain`.
4. **No invention, ever.** Every `knowledgeRefs` id exists in the source
   `ProjectKnowledge`. Sections that the knowledge cannot support drop themselves
   with a `section-omitted` decision; the slide planner never fabricates a slide
   to hit `targetSlides`, and records `planning/under-budget` when short.
5. **`visualIntent` is a suggestion, not an order.** A small semantic taxonomy
   (`architecture`, `process`, `metrics`, `roadmap`, …) plus `visualCandidates`
   ids. `architecture` is only chosen when a relation backs it; `roadmap` only
   with phases / milestones / `PRECEDES`. Phase 4 may accept or reject any of it.
6. **One key message per slide, derived then de-duplicated.** Messages come from
   the referenced knowledge (`src/planning/messaging.ts`); a collision is
   rebuilt from the section title + item summary so no two slides say the same
   thing.
7. **`knowledge-view.ts` re-sorts everything.** The planners read a normalized
   view (every collection sorted by id) so a semantically equivalent
   `ProjectKnowledge` in a different array order yields a byte-identical plan.
