# ARCLUME 1.0.1

ARCLUME 1.0.1 is the current stable release. It is a **Visual Quality Patch**
on top of 1.0.0 — it hardens the visual output of generated decks and keeps the
existing feature set.

> Local-first. Deterministic. Every claim traces back to a real source.

![ARCLUME architecture diagram](https://raw.githubusercontent.com/kerwilgil/arclume/main/docs/media/release-1.0.1/04-architecture.png)

## What changed in 1.0.1

- **Shared architecture layout** — a single source of truth now places
  architecture nodes for both the Visual Engine adapter and the native HTML
  renderer.
- **Centering and canvas utilization** — diagram content is centered in the
  canvas with consistent padding instead of hugging the edges.
- **PPTX diagram sizing** — diagram height is computed from the SVG viewBox
  aspect ratio instead of a hardcoded value, so exported slides keep their
  proportions.
- **Layout clearance gates** — minimum clearance between title, key message,
  and diagram is enforced.
- **Unified edge labels** — same-row edge labels render identically across the
  Visual Engine and the native renderer.
- **Twelve new Visual QA gates** — text overlap, title/key-message collision,
  diagram bounding-box utilization, excessive whitespace, canvas centering,
  node collision, title/key-message-to-diagram clearance, and more.

No new user-facing commands or configuration were introduced. The CLI, the Web
UI, and the agent workflow behave exactly as in 1.0.0.

## What it does

- **Analyze projects into structured ProjectKnowledge** — a validated model of
  components, actors, processes, phases, metrics, risks, decisions, constraints,
  relations, claims, and gaps.
- **Evidence-backed claims** classified as `FACT` / `INFERENCE` / `UNKNOWN` /
  `RECOMMENDATION`, each carrying source references, locators, and quotes.
- **Evidence Inspector** — see *why* every claim is true, with verification
  badges, relative source paths, line ranges, and revisions.

  ![Evidence Inspector](https://raw.githubusercontent.com/kerwilgil/arclume/main/docs/media/release-1.0.1/02-evidence-inspector.png)

- **Automatic visual selection across seven diagram families** — Architecture,
  Workflow, Sequence, Data Flow, Lifecycle, Timeline, and Roadmap.

  ![Workspace](https://raw.githubusercontent.com/kerwilgil/arclume/main/docs/media/release-1.0.1/01-workspace.png)
  ![Architecture](https://raw.githubusercontent.com/kerwilgil/arclume/main/docs/media/release-1.0.1/04-architecture.png)

- **Six audience presets** — Executive, Technical, Product, Client, Investor,
  and Internal Review — and **nine deck types** — Project Overview, Architecture
  Review, Technical Deep Dive, Executive Brief, Proposal, Status Report,
  Migration Plan, Product Overview, and Incident / Postmortem.

  ![Audience and deck types](https://raw.githubusercontent.com/kerwilgil/arclume/main/docs/media/release-1.0.1/03-audience-deck-type.png)

- **Rebuild multiple decks from the same ProjectKnowledge without rerunning AI
  analysis** — analyze once, then produce any number of narratives.
- **Three export formats** — self-contained HTML, PDF, and editable PowerPoint
  (PPTX), each sealed with a receipt.

  ![Final deck preview](https://raw.githubusercontent.com/kerwilgil/arclume/main/docs/media/release-1.0.1/05-final-deck-preview.png)
  ![Export](https://raw.githubusercontent.com/kerwilgil/arclume/main/docs/media/release-1.0.1/06-export.png)

- **English and Spanish** UI, **Light / Dark / System** appearance.
- **Windows Installer and Portable** builds — per-user install, no admin
  rights, bundled Node runtime and Chromium.

## How it works

```
Source → Analysis → ProjectKnowledge → Narrative → Visual Direction → Deck → HTML / PDF / PPTX
```

## Installation

### Windows Installer

`ARCLUME-Setup-1.0.1.exe` — per-user install to
`%LOCALAPPDATA%\Programs\ARCLUME`. No administrator rights required.

### Portable

`ARCLUME-1.0.1-portable.zip` — extract anywhere (paths with spaces are fine)
and run `ARCLUME.exe`. Bundles its own Node runtime and Chromium; no system
Node, npm, or external installation required.

## Artifacts

| File | Description |
| --- | --- |
| `ARCLUME-Setup-1.0.1.exe` | Windows installer |
| `ARCLUME-1.0.1-portable.zip` | Self-contained portable |
| `SHA256SUMS.txt` | SHA-256 checksums for both |

## SHA256 verification

```bash
sha256sum -c SHA256SUMS.txt
```

On Windows PowerShell:

```powershell
Get-FileHash ARCLUME-Setup-1.0.1.exe -Algorithm SHA256
Get-FileHash ARCLUME-1.0.1-portable.zip -Algorithm SHA256
```

## Documentation

- [README](https://github.com/kerwilgil/arclume)
- [CLI](https://github.com/kerwilgil/arclume/blob/main/docs/CLI.md)
- [Windows](https://github.com/kerwilgil/arclume/blob/main/docs/WINDOWS.md)
- [Themes](https://github.com/kerwilgil/arclume/blob/main/docs/THEMES.md)
- [Viewer](https://github.com/kerwilgil/arclume/blob/main/docs/VIEWER.md)
- [Changelog](https://github.com/kerwilgil/arclume/blob/main/CHANGELOG.md)
- [Security](https://github.com/kerwilgil/arclume/blob/main/SECURITY.md)