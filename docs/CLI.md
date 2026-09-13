# ARCLUME CLI Reference

The ARCLUME command-line interface provides a deterministic, agent-friendly interface over the closed Core pipeline.

## Commands

```
arclume analyze <input...> [--out path] [--json]
arclume build <knowledge.json|dir> [--preset id] [--audience a] [--theme t]
              [--format html,pdf,pptx] [--out dir] [--json]
arclume validate <path> [--json]
arclume presets
arclume watch <path> --reasoner stub [--preset id] [--out dir] [--debounce-ms n]
arclume web [--port N]        # local Web UI (loopback only)
arclume --help
arclume --version
```

## analyze

**Inputs:** directory/file (`.md .txt .json .yaml .pdf .docx`) or `https://` URL.
URL arguments become `{ kind: "url", url }` explicitly and flow through the secure transport.

Three explicit modes (plain `analyze` with no mode is a usage error — heuristic output must never impersonate agent-grade analysis):

- `--prepare-analysis <path>` — runs ingestion + deterministic `prepareAnalysis()` and writes the bound request artifact (`arclume/analysis-request`, includes `sourceDigest` + `ReasonerRequest`). No reasoning happens; STOP after writing.
- `--analysis-result <path>` — consumes an `arclume/agent-analysis` envelope (`{artifact, version, sourceDigest, analysis}`). The envelope's `sourceDigest` must equal the current prepared digest; a mismatch is fatal (`reasoner/source-digest-mismatch`, exit 2). The result flows through the unchanged `AgentReasoner` + full validation + KnowledgeBuilder.
- `--reasoner stub` — offline heuristic StubReasoner, loudly labeled (stderr warning + `reasonerId: "stub"` in JSON). Not agent-grade.

Output for knowledge modes: `project-knowledge.json` (default, `--out`), existing destination fatal. JSON mode reports `mode`, `reasonerId`, `sourceDigest`, `knowledgeHash`, structured `issues`.

## build

Loads + schema-validates the knowledge, runs the canonical planning/deck pipeline, then:

- `html` → `<out>/deck.html` (self-contained, offline);
- `pdf` → atomic export bundle `<out>/deck.pdf-export/{deck.pdf, export-receipt.json}`;
- `pptx` → atomic export bundle `<out>/deck.pptx-export/{…}`.

`--format` accepts a comma list or repeats. Bundles respect the Phase 8 contract: format argument independent of receipt, staged bytes validated in the real format, receipt schema + binding re-derived before rename, existing destination fatal. Receipts include `exportId`.

## presets

`executive` → audience `executive`, theme `executive` · `technical` → audience `technical`, theme `minimal` · `general` → audience `general`, theme `minimal` (default when no flags). Flag precedence: `--preset` provides defaults; explicit `--audience` / `--theme` override it. Deterministic; no clock, no RNG.

## validate

- dir with `export-receipt.json` → receipt schema + artifact sha256/bytes + structural format validation (pdf.js / OPC audit) against the receipt's declared slide identity;
- dir with `manifest.json` → Phase 6 `verifyManifest`;
- ProjectKnowledge JSON (file or artifact dir) → schema validation.

A bare `.pptx` without its receipt is refused (no deck identity to bind).

## I/O contract

stdout = result (human paths, or pure JSON with `--json`, no ANSI/prose).
stderr = warnings/diagnostics. Exit codes: `0` success, `1` usage/input, `2` build/validation, `3` security refusal. `--verbose` adds stack traces; none by default. `--quiet` minimizes stdout. No bypass flags exist and none may be added (`--allow-private-url`, `…unsafe…`, `--ignore-validation` are *never* accepted).

## watch

Watch is FINAL and explicitly offline-heuristic: `--reasoner stub` is mandatory (any other/missing value is a usage error) and a single `analysis/stub-reasoner` warning is emitted at startup. It never calls an external agent, model SDK or provider.

`fs.watch(recursive)` + debounce (default 150 ms, `--debounce-ms`). Ignored: `node_modules`, `.git`, `.hg`, `.svn`, `dist`, the output directory itself and any staging path — no self-trigger loop. URLs refused. Failed rebuilds keep the last good output (HTML is computed fully before any write) and watch continues; SIGINT/SIGTERM close the watcher and exit 0, no stack.

## I/O contract

stdout = result (human paths, or pure JSON with `--json`, no ANSI/prose).
stderr = warnings/diagnostics. Exit codes: `0` success, `1` usage/input, `2` build/validation, `3` security refusal. `--verbose` adds stack traces; none by default. `--quiet` minimizes stdout. No bypass flags exist and none may be added (`--allow-private-url`, `…unsafe…`, `--ignore-validation` are *never* accepted).

## Packaging

`bin: arclume → dist/cli/index.js` (ESM, shebang preserved by tsc). `files`: `dist`, `schemas`, `docs`, `vendor/archify` (46-file digest integrity surface unchanged), `SKILL.md`, `LICENSE`, `README.md`, `THIRD_PARTY_NOTICES.md`. `playwright` is a runtime `dependency` (PDF export needs Chromium at runtime; users run `npx playwright install chromium` once). The package is NOT `private` anymore (publication intent), but **no `npm publish` happens**. `npm pack` + clean-install + real `npm exec arclume` bin smoke + packed PDF smoke (visual tier) are enforced by tests.