# Contributing to ARCLUME

Thank you for considering contributing to ARCLUME! This document outlines the expectations and process for contributions.

## Requirements

- Node.js **>= 20.16.0**
- npm (bundled with Node.js)

## Development Setup

```bash
git clone https://github.com/kerwilgil/arclume.git
cd arclume
npm ci
npm run build
```

## Quality Gates

All contributions must pass the full quality gate suite:

```bash
npm run typecheck   # TypeScript compilation check
npm run lint        # Biome linting
npm test            # Unit tests (834+ tests)
npm run build       # Production build
npm run test:visual # Visual QA tests (requires Chromium via Playwright)
```

Run `npm run check` for typecheck + lint + test in one command.

For visual tests, ensure Chromium is installed:

```bash
npx playwright install chromium
```

## Code Standards

- **TypeScript** — strict mode, no `any` without justification.
- **Biome** — formatting and linting (run `npm run lint:fix` to auto-fix).
- **Determinism** — no `Date.now()`, `Math.random()`, `crypto.randomUUID()` in Core (`src/`). Timestamps only appear when explicitly injected by callers.
- **Security boundaries** — never bypass ingestion limits, SSRF guards, or export validation.
- **No silent fallbacks** — errors must be explicit; heuristic stubs are labeled and never presented as agent-grade analysis.

## Testing

- Unit tests: `npm test` (Vitest, 834+ tests).
- Visual QA: `npm run test:visual` (Chromium, 133 tests).
- Package smoke: `npm pack --dry-run` + tarball install test.

Visual tests are mandatory for changes to:
- Web UI (`web/src/**`)
- HTML renderer (`src/renderers/html/**`)
- Export (`src/export/**`)
- Visual QA (`src/validation/visual-qa/**`)

## Pull Request Expectations

- **Scope** — one logical change per PR.
- **Tests** — new behavior requires tests; bug fixes require regression tests.
- **Documentation** — update relevant docs (README, docs/, CHANGELOG.md) if user-facing behavior changes.
- **No silent model/provider dependencies** — ARCLUME bundles no model SDK; external agents produce analysis via the file contract.
- **Preserve deterministic/security boundaries** — no new code paths that bypass ingestion limits, SSRF guards, export validation, or receipt binding.

## Security

- Do not commit secrets, tokens, or credentials.
- Report vulnerabilities privately (see [SECURITY.md](docs/SECURITY.md)).
- No external network calls in Core; only the URL ingestion transport may perform bounded, pinned DNS requests.

## Architecture Principles

- **Headless core** — all logic lives in `src/`; CLI, Web UI, and agent skill are thin clients.
- **Deterministic pipeline** — from ProjectKnowledge onward, same input = same output byte-for-byte.
- **Explicit boundaries** — Reasoner is a pluggable interface; the rest of the pipeline validates its output.
- **Provenance everywhere** — claims, artifacts, and exports carry hash-bound provenance and receipts.

## Visual QA

If you modify visual output:
1. Run `npm run test:visual`
2. Review any screenshot diffs
3. Update golden files only if the change is intentional and documented

## Questions?

Open a GitHub Issue for design questions before implementing large changes.