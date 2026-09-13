# Arclume — Phase 10: Local Web UI

An optional, **local-only** interface over the closed Core. It never
re-implements pipeline stages: the browser drives the same prepare →
consume/validate → build → export code that the CLI uses.

```bash
arclume web            # http://127.0.0.1:3210 (ephemeral port if busy)
arclume web --port N   # explicit local port
```

Stop with Ctrl+C — the server closes, workspace temp dirs (in the OS temp
dir, `arclume-web/<id>`) are removed, nothing outside them is touched.

## Architecture

```
React UI (web/, built by Vite → web/dist, bundled in npm package)
   │
   │ same-origin fetch, X-Arclume-Session header
   ▼
src/web/server.ts  — Node http, binds 127.0.0.1 ONLY
src/web/security.ts — Host/Origin checks, session token, body caps, CSP
src/web/workspaces.ts — in-memory workspace registry; temp dirs owned by ARCLUME
src/web/api.ts      — JSON API mapped 1:1 to the Core pipeline
   │
   ▼
Core (identical to CLI paths: prepareAnalysis, analyzePrepared,
buildKnowledge, runDeck, renderHtml, renderDeckPdf, buildDeckPptx,
publishExportBundle, validateExportBundle)
```

React receives DTOs; all validation lives server-side (types are not
validation).

## Security model

- **Loopback only.** No public host flag exists in Phase 10. `Host` must be
  `127.0.0.1:port` / `localhost:port` / `[::1]:port`.
- **Session token** (random, per process): required as the
  `X-Arclume-Session` header on every mutation; preview/download asset URLs
  use `?session=…`. The token is injected into the served `index.html` as a
  meta tag (no inline script, CSP-safe).
- **Origin**: any `Origin` header that isn't same-origin → 403. No CORS
  headers are ever sent; no preflight is accepted.
- **Body caps**: 8 MiB hard cap per JSON body; oversized requests are refused
  before parsing.
- **CSP** for the UI: `default-src 'self'`, `object-src 'none'`,
  `frame-ancestors 'none'`, `frame-src 'self'`, system fonts only, no
  analytics/tracking, no remote fonts.
- **Preview** is the canonical deck HTML served byte-for-byte and shown inside
  `<iframe sandbox="allow-scripts">` — never a React re-render.
- **Downloads** (`/files/:wsId/:fileId`) resolve through a workspace-scoped
  allowlist id map. No path parameter, no traversal: ids are random.
- **No shell/RPC endpoints** exist. No analytics. The ONLY network egress is
  the Phase 8 hardened URL fetch when the user explicitly adds an `https://`
  source.
- **Workspace bodies**: one mutation at a time per workspace (serialized);
  read endpoints are free. Agent result consumption recomputes the current
  source digest — a stale envelope is always rejected with
  `reasoner/source-digest-mismatch`.

## API surface

```
POST   /api/workspaces                     {source:{kind:"path"|"url",value}}
POST   /api/workspaces/:id/prepare         → sourceDigest, request.json download id
POST   /api/workspaces/:id/stub-preview    → heuristic knowledge (explicit)
POST   /api/workspaces/:id/agent-result    {envelope} — digest-bound
GET    /api/workspaces/:id                 summary
GET    /api/workspaces/:id/knowledge       full ProjectKnowledge
POST   /api/workspaces/:id/build           {preset, formats[]} → exports + warnings
POST   /api/workspaces/:id/validate        {format} → real structural validation
DELETE /api/workspaces/:id                 → remove workspace + owned temp files
GET    /preview/:id?session=…              canonical deck HTML bytes
GET    /files/:wsId/:fileId?session=…      artifact/receipt download
```

All failures: `{ok:false, code, message, hint}` with HTTP status
(400 input / 401 token / 403 host-origin / 404 missing / 409 busy + not-ready /
413 body too large).

## Workflow

Source (folder/file/URL with explicit network notice) → Analysis: **Prepare**
(agent mode: request digest shown, puzzle the JSON out to your agent, paste
the envelope back) or **Heuristic preview** (explicit expanded section with
warning — never agent-grade) → Knowledge inspector (Project / entities /
claims by FACT-INFERENCE-UNKNOWN-RECOMMENDATION / relations / gaps / sources /
evidence quotes, plus raw JSON) → Build (preset cards + format checkboxes) →
canonical preview iframe → Export (artifact + receipt + exportId + Validate).

Two more destinations sit outside the numbered workflow, always reachable
from the sidebar regardless of stage or whether a workspace exists yet:
**Help** (an offline, integrated manual — product overview, a stage-by-stage
explanation of Source/Analysis/Knowledge/Build/Export, the Agent vs Offline
Preview distinction, the Agent workflow, a plain-language privacy note, and a
short glossary) and **Settings** (Language and Appearance — see below).

## Settings — Language and Appearance

**Language: English / Español.** Controls the Web UI's own chrome — sidebar,
headings, labels, buttons, help text, settings, and frontend-owned validation
messages. It never touches JSON keys, schema identifiers, error codes,
filenames, API paths, CLI commands, the `FACT`/`INFERENCE`/`UNKNOWN`/
`RECOMMENDATION` fact-type tokens, or any user-supplied content (a path, a
pasted payload, source text) — those render exactly as given, in either
locale. It also never translates the generated deck; UI locale and deck
content/narrative are unrelated concepts.

Applies immediately (no reload, no workspace reset, no extra API calls).
With no persisted preference, the default follows `navigator.language`
(`es*` → Español, everything else → English — no geolocation, no network).
The choice persists to `localStorage` under a versioned key
(`arclume.ui.locale`); a corrupted or unrecognized stored value falls back to
detection rather than crashing.

Implementation: `web/src/i18n/` — `en.ts` is the canonical shape
(`export type Translation = typeof en`), and `es.ts` is typed against that
exact shape, so a missing, extra, or misspelled key in Spanish is a compile
error, not a silent gap. No runtime translation service, nothing loaded from
the network — fully offline, like everything else in the Web UI.

**Appearance: System / Light / Dark.** `System` follows the OS's
light/dark setting live (`prefers-color-scheme`, re-checked continuously
while ARCLUME is open, not just once at startup) — an explicit Light or Dark
choice always overrides it. Applied via `data-theme` on `<html>` and CSS
custom properties (semantic tokens, never a component hardcoding a color per
theme); Dark reuses the ARCLUME brand palette (Graphite background, Soft
White text, Lumen/Light Blue accents) rather than inverting Light or going
neon. `color-scheme` is set to match, so native inputs/scrollbars follow
suit. A small classic script (`web/public/assets/theme-bootstrap.js`, loaded
before any stylesheet, CSP `script-src 'self'` — never inline) sets the
initial `data-theme` before first paint, so an explicit preference that
differs from the OS never flashes the other theme first; React re-applies
the same computation on mount and keeps listening for live OS changes.
Persists to `localStorage` under `arclume.ui.appearance`, with the same
corrupted-value-falls-back-safely behavior as locale.

Both preferences are frontend-only UI state, deliberately kept out of
`AppState` (workspace/knowledge/build) — they survive discarding a workspace
and switching between stages, and never require a new API endpoint or a
backend settings store.

## Limitations (Phase 10 non-goals)

No accounts/auth/cloud/sync/collaboration/sharing/remote storage. No hosted
AI: the agent analysis flow is intentionally manual (prepare → external agent
→ paste). No live file watcher in the UI (use `arclume watch`). No PowerPoint
live editing. No npm publish yet.
