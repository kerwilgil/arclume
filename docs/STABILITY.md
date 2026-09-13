# Arclume — Stability & Versioning Policy

Several artifacts are independently versioned:

| Artifact | Field | Constant | Schema |
| --- | --- | --- | --- |
| `ArclumeDeck` IR | `irVersion` | `IR_VERSION` (`src/version.ts`) | `schemas/arclume-deck.schema.json` |
| `ProjectKnowledge` | `knowledgeVersion` | `KNOWLEDGE_VERSION` | `schemas/project-knowledge.schema.json` |
| Self-contained HTML | `data-arclume-renderer-version` | `HTML_RENDERER_VERSION` | — (Phase 5) |
| `VisualQaResult` / `visual-qa.json` | `version` | `VISUAL_QA_VERSION` | `schemas/visual-qa.schema.json` |
| Visual QA receipt / delivery manifest | `receiptVersion` / `manifestVersion` | `DELIVERY_MANIFEST_VERSION` | `schemas/visual-qa-receipt.schema.json`, `schemas/delivery-manifest.schema.json` |

`ArclumeDeck` IR is at **0.2.0** (Phase 4); `ProjectKnowledge` is at **0.1.0**.
`NarrativePlan` and `SlidePlan` (Phase 3) are versioned independently at
**0.1.0** each (`NARRATIVE_VERSION` / `SLIDE_PLAN_VERSION`). The
`HTML_RENDERER_VERSION` (Phase 5) and `VISUAL_QA_VERSION` /
`DELIVERY_MANIFEST_VERSION` (Phase 6) are **0.1.0** each and are independent of
the IR — they change when the HTML output / QA contract / delivery bundle
changes, not when the deck IR does.

---

## SemVer meaning

### Major `0` (now) — pre-stable

The representations may still change shape between **minor** versions. Every such
change is listed in the "Changelog" section below with a migration note. Within a
single minor version, a document that validates keeps validating.

### Major `>= 1` — stable

- **MAJOR** — a breaking change to the representation: a required field removed
  or renamed, an enum value removed, a field's type changed, a constraint
  tightened so that previously valid documents fail.
- **MINOR** — additive and backward compatible: a new optional field, a new enum
  value in an open position, a new block type, a new locator variant.
- **PATCH** — non-normative: documentation, validation *message* wording,
  performance. No change to what validates.

A file that validates against `X.Y.Z` continues to validate against every
`X.*.*` the library later supports. Additive improvements to downstream
consumers (renderers, viewer) must not reinterpret an existing IR or introduce
new validation failures for it.

---

## What a validator does with a version

`checkCompatibility(found, supported)` (in `src/version.ts`), applied by
`validateArclumeDeck` / `validateProjectKnowledge`:

| Situation | Result | Issue code |
| --- | --- | --- |
| same, or `found` minor ≤ `supported` minor, same major | accepted | — |
| `found` minor > `supported` minor, same major | **warning** — unknown additive fields may be ignored | `version/newer-minor` |
| different major | **error** — a migration to the supported version is required | `version/incompatible` |
| missing or non-SemVer | **error** | `version/missing` / `version/incompatible` |

---

## Migrations

`src/migrations/index.ts` provides:

- `MigrationStep` — `{ kind, from, to, description, apply }`. `apply` is a pure
  transform that returns a new document and must not mutate its input.
- `MIGRATION_STEPS` — an ordered registry. **Empty in Phase 1.**
- `migrate(kind, doc, targetVersion?)` — walks steps from the document's declared
  version to the target, applying each `apply` in turn. It is a no-op when the
  document is already at the target. It throws when the document has no version,
  when a version string is malformed, or when no chain of steps reaches the
  target.

No migration steps exist yet, and none will be written until a version actually
introduces a breaking change. There are deliberately **no placeholder or
identity "migrations"** in the registry — an unchanged version is handled by the
no-op path.

### Adding a migration (when the time comes)

1. Bump the constant in `src/version.ts` and the schema's version constraint.
2. Append a `MigrationStep` with `from` = the previous exact version, `to` = the
   new version, and a real `apply`.
3. Add fixtures: a document at the old version, and the expected result of
   `migrate()`.
4. Record the change under "Changelog" below.

---

## Changelog

### Phase 6 — Chromium Visual QA + atomic delivery

No IR change. New independently-versioned contracts, all **0.1.0**:

- `VISUAL_QA_VERSION` — the `VisualQaResult` shape, its finding codes and
  `schemas/visual-qa.schema.json`.
- `DELIVERY_MANIFEST_VERSION` — the Visual QA receipt
  (`schemas/visual-qa-receipt.schema.json`) and the delivery manifest
  (`schemas/delivery-manifest.schema.json`).

`tsconfig.json` gained the `"DOM"` lib so Playwright `page.evaluate` callbacks
type-check; the runtime determinism guarantee is still enforced by the
`determinism.test.ts` source scan (no clock / RNG in `src/`).

### `ArclumeDeck` IR 0.2.0 — Phase 4

Loosening / additive only — **every 0.1.0 deck stays valid**:

- `slides[].keyMessage` `maxLength` 200 → 240, to match the upstream
  `SlidePlan.keyMessage` cap (which the VisualDirector carries through verbatim,
  whitespace collapsed). A key message the SlidePlan considers one idea must not
  be rejected by the deck schema.
- `provenance.narrativeRef` and `provenance.slidePlanRef` added (optional,
  `contentHash`) — hash bindings the VisualDirector fills and
  `validateArclumeDeck(deck, { narrative, slidePlan })` checks.

**Migration:** `migrate("deck", doc)` applies the registered `0.1.0 -> 0.2.0`
step, which only restamps `irVersion` (no payload change). A build targeting
0.2.0 also accepts a 0.1.0 document unchanged (older-minor ⇒ compatible).

### 0.1.0 — initial

First versioned Core: `ProjectKnowledge` model, `ArclumeDeck` IR, block
contracts, source-traceability shapes, schema + semantic validation. No prior
version; no migration path in or out.
