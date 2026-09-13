# Vendored: Archify

| Field        | Value                                                            |
| ------------ | ---------------------------------------------------------------- |
| Source       | https://github.com/tt-a1i/archify                                 |
| Tag          | `v2.16.0`                                                        |
| Commit       | `c826e6c3a7abad19c0f3cd1ca57207d54b1ad8de`                        |
| License      | MIT (see `LICENSE` in this directory)                            |
| File count   | 46 (this subtree; recomputed and asserted by `tests/engines/archify/vendor.test.ts`) |
| Runtime deps | none (Archify's only dependencies are devDependencies)           |

## What this is

Archify is a standalone JSON → HTML/SVG diagram renderer. ARCLUME uses it as a
**downstream render engine** for `architecture` and `workflow` diagrams only.
Archify output is treated as untrusted: every HTML page it emits is parsed,
sanitized against a strict allowlist and rebuilt by
`src/engines/archify/sanitize.ts` before it can reach an ARCLUME document.

## Pinned, not floating

This is a fixed file copy, not an npm dependency and not a git submodule. The
canonical subtree SHA-256 (computed over `relative POSIX path + file bytes`,
files sorted lexicographically by path) and the file count live in
`src/engines/archify/vendored.ts` and are asserted by
`tests/engines/archify/vendor.test.ts`. Any mutation of any byte under this
directory fails the test suite.

Upgrading Archify is a deliberate act: change the tag, the commit, the subtree
digest constants, and re-run the style-map coverage test
(`tests/engines/archify/style-map.test.ts`).

## Vendored subset

Only what `bin/archify.mjs render` needs at runtime is vendored:

- `bin/` — the CLI entry points (`archify.mjs` is the one ARCLUME invokes).
- `renderers/` — architecture / workflow renderers and shared helpers
  (sequence / dataflow / lifecycle are also present but never invoked).
- `schemas/` — Archify's own JSON Schemas.
- `assets/` — the HTML template the renderer fills.
- `brand-marks/` — the offline brand-mark catalog (never used by ARCLUME
  requests; vendored because the renderer imports it).
- `migrations/` — the workflow v1→v2 migrator (ARCLUME always emits v2).
- `package.json`, `LICENSE`, `VENDOR.md`.

Upstream `test/`, `examples/`, `docs/`, `benchmarks/`, `experiments/` and CI
files are deliberately not vendored.

## Network audit boundary

- `bin/preview.mjs`, `bin/open-artifact.mjs` are interactive dev tools
  (they start local servers) — never invoked by ARCLUME.
- The render path is `bin/archify.mjs` + `renderers/**` + `migrations/**`.
  Within it, only `renderers/shared/brand-marks.mjs` imports socket modules;
  its network use is gated on a `brand` field no ARCLUME request can carry
  (asserted by `tests/engines/archify/vendor.test.ts`).
- At runtime the runner injects a preload tripwire that throws on any
  `http(s)`/`net`/`dns`/`fetch`/`WebSocket`/`EventSource`/`XMLHttpRequest` use
  inside the child → `archify/render-failed`. See `src/engines/archify/runner.ts`.
