# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-09-13

### Highlights

- **Evidence-backed ProjectKnowledge** — every claim is a structured entity
  with an explicit epistemic status and traceable source references, never a
  free-floating paragraph.
- **Multi-provider AI reasoning** — local (Ollama, Claude Code, Codex) and
  remote (OpenAI, OpenAI-compatible, Anthropic, NVIDIA) providers behind one
  deterministic contract.
- **Fast / Verified analysis** — one-pass analysis, or a second reviewer pass
  that checks for unsupported claims before anything is promoted to knowledge.
- **Automatic Visual Intelligence** — the deck decides the right visual for
  each slide from the knowledge, with an auditable reason for every decision.
- **Seven diagram families** — Architecture, Workflow, Sequence, Data Flow,
  Lifecycle, Timeline, and Roadmap, rendered through a mix of native diagrams
  and the bundled ARCLUME Visual Engine.
- **Source Evidence verification** — hermetic, offline Git verification of
  source references: a fact is only "Verified" when the referenced file, line
  range, and revision actually check out.
- **Evidence Inspector** — a user-facing view of *why* each claim is true,
  with verification badges and relative source paths, never raw JSON by default.
- **Six audience presets** — Executive, Technical, Product, Client, Investor,
  and Internal Review, each shaping narrative depth and evidence visibility.
- **Nine deck types** — Project Overview, Architecture Review, Technical Deep
  Dive, Executive Brief, Proposal, Status Report, Migration Plan, Product
  Overview, and Incident / Postmortem.
- **Rebuild without rerunning AI** — analyze once, then reconstruct any number
  of decks from the same ProjectKnowledge with zero Reasoner calls.
- **HTML / PDF / editable PPTX** — three export formats, each with a
  machine-checkable receipt.
- **Windows Installer + Portable** — a per-user installer (no admin rights) and
  a self-contained portable ZIP, both bundling their own Node runtime.
- **English / Spanish** — full UI localization.
- **Light / Dark / System** — theme follows semantic design tokens.

### Added

- Source ingestion for directories, repositories, individual files (Markdown,
  text, JSON, YAML, PDF, DOCX), and HTTPS URLs with SSRF-hardened transport.
- Deterministic `ProjectKnowledge` model with content hashing and provenance.
- Narrative planner and slide planner with auditable planning decisions.
- Visual director that never alters the truth of the SlidePlan.
- Evidence Inspector web UI and API endpoint (cached, no per-render Git).
- Audience presets (`product`, `client`, `investor`, `internal-review` added
  alongside `executive`, `technical`, and the legacy `general`).
- Deck type presets with stable ids and independent arc composition.
- `rebuildFromKnowledge` pipeline entry (a pure `ProjectKnowledge → Deck` path).
- Native Windows launcher (GUI subsystem, no console, owns its child server).
- Web UI (loopback-only, session-token gated) with a five-step workflow.
- Native source browsing for folder/file selection.
- Fixed sidebar clipping while scrolling long Help content.

### Changed

- `package.json` version bumped to `1.0.0`.
- ArclumeDeck IR moved from `0.1.0` to `0.2.0` (widening only — every `0.1.0`
  deck stays valid).
- Narrative/Slide planning now carry optional `deckType` and the expanded
  audience vocabulary through their schemas.

### Security / Privacy

- Local-first: the Web UI binds to loopback only and sends no analytics.
- Secrets stored in a dedicated `secrets/.env` file; API keys are masked and
  never echoed back to the UI.
- Evidence verification is hermetic (no network, no Git hooks, no repo scripts).
- Secret scan on release artifacts returned zero real secrets.

### Distribution

- `ARCLUME-Setup-1.0.0.exe` (per-user Inno Setup installer).
- `ARCLUME-1.0.0-portable.zip` (self-contained portable with bundled runtime).
- `SHA256SUMS.txt` for both artifacts.

### Known Issues

- Local development tests under Node 26 expose a `window.localStorage`
  incompatibility in `tests/web/**` in jsdom; the supported CI matrices
  (Node 20.16 / 22) run green.
- The bounded Data Flow solver does not yet handle arbitrarily complex
  topologies beyond its current capacity.
- Lifecycle transition labels can render tightly in edge cases.
- NVIDIA inference availability depends on account/API entitlement.