# ARCLUME 1.0

ARCLUME 1.0 turns complex projects into clear, evidence-backed visual
narratives.

> Local-first. Deterministic. Every claim traces back to a real source.

![ARCLUME deck preview](https://raw.githubusercontent.com/kerwilgil/arclume/main/docs/media/release-1.0/07-final-deck-preview.png)

## What it does

- **Analyze projects into structured ProjectKnowledge** — a validated model of
  components, actors, processes, phases, metrics, risks, decisions, constraints,
  relations, claims, and gaps.
- **Evidence-backed claims** classified as `FACT` / `INFERENCE` / `UNKNOWN` /
  `RECOMMENDATION`, each carrying source references, locators, and quotes.
- **Evidence Inspector** — see *why* every claim is true, with verification
  badges, relative source paths, line ranges, and revisions.

  ![Evidence Inspector](https://raw.githubusercontent.com/kerwilgil/arclume/main/docs/media/release-1.0/03-evidence-inspector.png)

- **Automatic visual selection across seven diagram families** — Architecture,
  Workflow, Sequence, Data Flow, Lifecycle, Timeline, and Roadmap.

  ![Architecture](https://raw.githubusercontent.com/kerwilgil/arclume/main/docs/media/release-1.0/04-architecture.png)
  ![Data flow](https://raw.githubusercontent.com/kerwilgil/arclume/main/docs/media/release-1.0/05-dataflow.png)

- **Six audience presets** — Executive, Technical, Product, Client, Investor,
  Internal Review — and **nine deck types** — Project Overview, Architecture
  Review, Technical Deep Dive, Executive Brief, Proposal, Status Report,
  Migration Plan, Product Overview, Incident / Postmortem.

  ![Audience and deck types](https://raw.githubusercontent.com/kerwilgil/arclume/main/docs/media/release-1.0/06-audience-deck-type.png)

- **Rebuild multiple decks from the same ProjectKnowledge without rerunning AI
  analysis** — analyze once, then produce any number of narratives.
- **Multiple AI providers** — local (Ollama, Claude Code, Codex) and remote
  (OpenAI, OpenAI-compatible, Anthropic, NVIDIA).
- **Fast and Verified analysis modes** — one pass, or a second reviewer pass
  that checks for unsupported claims.
- **Three export formats** — self-contained HTML, PDF, and editable PowerPoint
  (PPTX), each sealed with a receipt.

  ![Export](https://raw.githubusercontent.com/kerwilgil/arclume/main/docs/media/release-1.0/09-export.png)

- **English and Spanish** UI, **Light / Dark / System** appearance.
- **Windows Installer and Portable** builds — per-user install, no admin
  rights, bundled Node runtime.

## How it works

```
Source → Analysis → ProjectKnowledge → Narrative → Visual Intelligence → Deck → HTML / PDF / PPTX
```

## Installation

### Windows Installer

`ARCLUME-Setup-1.0.0.exe` — per-user install to
`%LOCALAPPDATA%\Programs\ARCLUME`. No administrator rights required.

### Portable

`ARCLUME-1.0.0-portable.zip` — extract anywhere (paths with spaces are fine)
and run `ARCLUME.exe`. Bundles its own Node runtime and Chromium; no system
Node, npm, or external installation required.

### From source

```bash
npm install
npm run build
node dist/cli/index.js web
```

## Artifacts

| File | Description |
| --- | --- |
| `ARCLUME-Setup-1.0.0.exe` | Windows installer |
| `ARCLUME-1.0.0-portable.zip` | Self-contained portable |
| `SHA256SUMS.txt` | SHA-256 checksums for both |

## SHA256 verification

```bash
sha256sum -c SHA256SUMS.txt
```

On Windows PowerShell:

```powershell
Get-FileHash ARCLUME-Setup-1.0.0.exe -Algorithm SHA256
Get-FileHash ARCLUME-1.0.0-portable.zip -Algorithm SHA256
```

## Known Issues

- Local development tests under Node 26 expose a `window.localStorage`
  incompatibility in `tests/web/**` in jsdom; supported CI matrices
  (Node 20.16 / 22) run green.
- The bounded Data Flow solver does not yet handle arbitrarily complex
  topologies beyond its current capacity.
- Lifecycle transition labels can render tightly in edge cases.
- NVIDIA inference availability depends on account/API entitlement.

## Documentation

- [README](https://github.com/kerwilgil/arclume)
- [CLI](https://github.com/kerwilgil/arclume/blob/main/docs/CLI.md)
- [Changelog](https://github.com/kerwilgil/arclume/blob/main/CHANGELOG.md)
- [Architecture](https://github.com/kerwilgil/arclume/blob/main/docs/ARCHITECTURE.md)
- [ProjectKnowledge model](https://github.com/kerwilgil/arclume/blob/main/docs/PROJECT_KNOWLEDGE.md)
- [Diagram engines](https://github.com/kerwilgil/arclume/blob/main/docs/DIAGRAM_ENGINES.md)