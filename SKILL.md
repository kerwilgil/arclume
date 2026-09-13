---
name: arclume
description: Turn a project, document or URL into a deterministic, validated presentation deck (HTML / PDF / PPTX) with receipts. Use when asked to "make a deck/slides/presentation from this project/repo/PDF/DOCX/page", to brief executives or technicians from existing material, or to package knowledge as slides without inventing content.
---

# Arclume

Arclume converts a project directory, documents or a web page into a
**deterministic, schema-validated slide deck** with a cryptographic receipt
per export. It never invents content and never executes what it analyzes.

## When to use it

- "Make me a deck from this repo / report / README / brief."
- "Summarize this project for executives / for engineers / for a general audience."
- "Export this as PowerPoint/PDF with proof of what was produced."

## Supported inputs

- Directory or repository (walked with safety denylist, no git internals).
- Files: Markdown, TXT, JSON, YAML, **PDF**, **DOCX**.
- `https://` URL (fetched through the secure, bounded, SSRF-hardened
  ingestion of Arclume — DNS pin, byte budgets, no downgrade).

## The agent workflow (how you are supposed to use it)

`analyze` NEVER pretends heuristic output is real analysis. There are exactly
three modes:

### A. Agent mode — the productive path (use this)

```bash
# 1. prepare the deterministic request (digest-bound)
arclume analyze <input> --prepare-analysis request.json

# 2. READ request.json — documents carry id/sourceId/path/kind/content/outline.
#    Write result.json from ONLY that evidence:
{ "artifact": "arclume/agent-analysis",
  "version": "0.1.0",
  "sourceDigest": "<request.sourceDigest — copy verbatim>",
  "analysis": { "…valid AnalysisResult…" } }

# 3. consume it (digest binding enforced — a stale request is fatal)
arclume analyze <input> --analysis-result result.json --out project-knowledge.json
```

Rules for the AnalysisResult you produce:

- Write `request.json` / `result.json` **outside** the analyzed tree (or add
  them to its `.gitignore`): the digest binds to the exact input content, so
  creating files inside the input between prepare and consume changes the
  digest and the consume step refuses with `reasoner/source-digest-mismatch`.
- Follow `schemas/analysis-result.schema.json` exactly (contract:
  `docs/REASONER.md`).
- Every `EvidenceCandidate` must reference a real `documentId` from the
  request (plus line/page locator and quote when possible).
- **FACT requires evidence. Never invent evidence.** Unverifiable →
  `INFERENCE`; truly unknown → `UNKNOWN`/gap.
- You are producing an *AnalysisResult*, never a `ProjectKnowledge`:
  the KnowledgeBuilder stays authoritative and validates everything again.

### B. Prepare-stop mode

`--prepare-analysis` writes the request and exits — nothing is analyzed.

### C. Offline stub mode (not agent-grade)

```bash
arclume analyze <input> --reasoner stub --out project-knowledge.json
```

Deterministic, offline, heuristic. Use it for CI/smoke/offline only; it
prints a loud `analysis/stub-reasoner` warning and the JSON result carries
`mode: "stub"`. Never present stub output to a user as analysis.

### Then build & validate

```bash
arclume build project-knowledge.json --preset executive --format html,pdf,pptx
arclume validate arclume-output/deck.pdf-export
```

Presets: `executive`, `technical`, `general`. Inspect knowledge gaps first —
they are surfaced as issues; do not hide them.

## Output layout

```
arclume-output/
  deck.html               # self-contained, offline, keyboard-viewer HTML
  deck.pdf-export/        # deck.pdf + export-receipt.json
  deck.pptx-export/       # deck.pptx + export-receipt.json
```

Every export bundle carries `export-receipt.json` (artifact sha256, deck
identity, exporter version, diagram provenance) and an `exportId`. Report
receipts and warnings to the user; do not bury them.

`--json` → machine-readable stdout (single JSON document, no ANSI/prose).
Exit codes: `0` ok · `1` usage/input · `2` build/validation · `3` security refusal.

## What NEVER to do

- **Analyzing is not executing**: never run the analyzed project's code, PDF
  JavaScript, DOCX macros, downloaded scripts or any remote resource.
- Never bypass security (no `--allow-private-url`-style flags exist; do not
  emulate them through internals).
- Never overwrite: analyze refuses existing outputs; export bundles are
  atomic and refuse existing destinations.
- Never claim bundle validation proves the historical deck: `arclume
  validate <bundle>` proves bundle integrity + receipt self-consistency +
  artifact structure (without the original deck it cannot re-prove content).
- Do not fetch anything yourself to "help": pass the URL to Arclume.

### Interactive UI (for humans, not agents)

`arclume web` starts the optional local Web UI (loopback-only). As an agent,
prefer the CLI flow above — it is the fully scriptable path; the Web UI's
interactive manual agent flow mirrors it.

## Live rebuild

```bash
arclume watch ./project --reasoner stub --preset executive
```

Watch is intentionally heuristic/offline. It does NOT run the productive agent
AnalysisResult workflow — the only reasoner it accepts is the explicit
`--reasoner stub` and it says so with a warning at startup. Use it only for
rapid local preview/smoke iteration. For authoritative decks, rerun the agent
prepare → result workflow above.

Debounced rebuilds of the HTML deck; `node_modules`/`.git`/output dir ignored;
no self-trigger loop; last good output kept on rebuild failure; URLs not
watchable; Ctrl+C stops cleanly.
