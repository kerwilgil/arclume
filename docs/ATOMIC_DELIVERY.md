# Arclume — Atomic Delivery (Phase 6)

A delivery bundle is written to a **staging** sibling directory, hashed,
manifested, verified and gated on `VisualQaResult.valid` — and only then renamed
into place. The rename is the commit boundary: a partial bundle is never
published, and a previous delivery at a different path is never touched.

```
deck + html + VisualQaResult + receipt + screenshots
        │
        ▼
  .<name>.staging-<deliveryId>/     ← sibling of the destination
     arclume-deck.json
     arclume-deck.html
     visual-qa.json
     visual-qa-receipt.json
     screenshots/slide-001-*.png …
     manifest.json                  ← written last, never lists itself
        │  hash every file → verify manifest → require visualQa.valid
        ▼
  rename(staging → destination)     ← COMMIT BOUNDARY
```

---

## API

```ts
import { deliverAtomic, buildManifest, deriveDeliveryId, verifyManifest } from "arclume";

const result = await deliverAtomic(destination, {
  deck, html, visualQa, receipt, screenshots,   // screenshots = ScreenshotArtifact[] (with buffers)
  diagramArtifacts,                             // optional, required when the deck
                                                // requests the visual engine for any diagram
}, options?);
```

`DeliveryResult`: `{ delivered, destination, deliveryId, manifest, entries,
visualQaValid }`.

`DeliveryOptions`: `keepFailedStaging?` (default: remove a failed staging dir),
`hooks?` (`afterHtml` / `afterScreenshots` / `beforeManifest` / `beforeRename` —
throw points for tests).

`runValidatedDelivery(deck, html, destination, opts?)` chains
`validateRenderedDeck` → `buildVisualQaReceipt` → `deliverAtomic`.

---

## Algorithm

1. **Refuse an existing destination** — `delivery/destination-exists` (fatal).
   Atomic delivery never overwrites.
2. **Evidence preflight** — `validateDeliveryBindings(input)` (see below). Any
   broken binding is fatal here, before a staging directory exists. This
   includes the canonical render binding: the delivered HTML must equal
   `renderCanonicalDeckHtml({ deck, diagramArtifacts }).html` byte-for-byte,
   and every diagram artifact must bind to the deck (missing / extra / stale /
   cross-deck / mislabeled artifacts are `delivery/diagram-artifact-*` fatal
   codes — see `docs/DIAGRAM_ENGINES.md`).
3. Derive `deliveryId` = `sha256(deckContentHash | htmlSha256 | configHash)`,
   first 32 hex. Hash-based identity, **never** a timestamp.
4. Create the staging sibling `.<basename>.staging-<deliveryId>` (a leftover from
   a previous failed run at the same id is removed first;
   `delivery/staging-uncleanable` if that fails).
5. Write `arclume-deck.json`, `arclume-deck.html`, `visual-qa.json`
   (`visualQaJson(result)`, schema-checked), `visual-qa-receipt.json`
   (schema-checked), `screenshots/*.png` (buffers). Every screenshot path is run
   through `validateBundleRelativePath`, must start `screenshots/`, and be unique.
6. Hash every written file → `ManifestEntry[]` (`{ path, bytes, sha256 }`).
7. `buildManifest` — every entry path is a safe bundle path and unique (else
   `delivery/unsafe-path` / `delivery/duplicate-path`); entries sorted by path,
   schema-checked, written as `manifest.json`.
8. `verifyManifest(stagingDir)` — re-read, re-hash, compare. Any mismatch →
   `delivery/verification-failed`.
9. **QA gate** — `visualQa.valid === false` → `delivery/qa-failed`, staging
   removed, nothing published.
10. `rename(staging → destination)`.

On any throw before the rename the staging dir is removed best-effort; if the
cleanup itself fails, that is reported in the error `hint` and the delivery is
**not** declared a success.

---

## Evidence preflight — `validateDeliveryBindings(input)`

`deliverAtomic` must not just check schemas and per-file hashes — it must prove
the deck, the HTML, the `VisualQaResult`, the receipt and the screenshot
**buffers** are one coherent run. Caller-supplied booleans are never trusted;
everything is recomputed. Fatal, before any staging.

| binding | rule | code |
| --- | --- | --- |
| deck ↔ receipt | `receipt.deck.irVersion === deck.irVersion`; `receipt.deck.contentHash` present and `=== contentHash(deck)` | `delivery/deck-hash-mismatch` |
| html ↔ receipt | `receipt.inputs.htmlSha256 === SHA-256(html)` | `delivery/html-hash-mismatch` |
| **deck ↔ html (semantic)** | `renderDeckHtml(deck).html === html` — the delivered HTML must *be* the canonical deterministic render of the delivered deck; a regenerated receipt cannot substitute. `deliverAtomic` does **not** assume the caller ran `validateRenderedDeck` first. | `delivery/html-deck-mismatch` |
| **Visual QA input ↔ html** | `visualQa.input.htmlSha256 === SHA-256(html)` — the QA screenshots / findings must have been produced against this exact document. `runVisualQa` computes `input.htmlSha256` from its own input; a caller cannot supply it. | `delivery/qa-input-mismatch` |
| QA identity | `receipt.visualQa.version === visualQa.version`; `receipt.browser.{name,version,platform} === visualQa.browser.*` | `delivery/evidence-mismatch` |
| result consistency | real tally of `visualQa.findings` equals `visualQa.summary`; `visualQa.valid === (summary.errors === 0)` | `delivery/qa-summary-mismatch` |
| receipt result | `receipt.result.{valid,errors,warnings}` equals the `VisualQaResult` | `delivery/receipt-mismatch` |
| descriptor ↔ buffer | for every screenshot: `buffer.length === descriptor.bytes` and `sha256(buffer) === descriptor.sha256`; paths unique + safe | `delivery/screenshot-hash-mismatch` · `delivery/duplicate-path` · `delivery/unsafe-path` |
| result ↔ artifacts | `visualQa.screenshots` set equals the delivered artifact set on the full tuple (`viewport, slideId, index, kind, width, height, bytes, sha256, path`) — no missing, extra or stale descriptor | `delivery/screenshot-set-mismatch` |
| receipt ↔ slide shots | `receipt.screenshots` set equals the delivered `kind: "slide"` set on `{slideId, sha256, bytes}`, order-independent | `delivery/receipt-mismatch` |

The **viewer-overview** screenshot is deliberately not in `receipt.screenshots`
(the receipt records slide evidence); the **manifest** still covers it.

Together the html rows close the provenance chain: `receipt.inputs.htmlSha256`
`===` `visualQa.input.htmlSha256` `===` `SHA-256(html)` `===` the actually
delivered HTML — and that HTML `===` `renderDeckHtml(deck).html`. There is no
gap where a caller can recombine a deck, an HTML and a Visual QA run from
different executions and still pass, even by rebuilding every hash in the
receipt.

---

## Manifest

```ts
interface DeliveryManifest {
  manifestVersion: string;   // MANIFEST_VERSION = 0.1.0
  deliveryId: string;        // [0-9a-f]{32}
  visualQa: { valid: boolean; version: string };
  entries: ManifestEntry[];  // sorted by path
}
```

**Self-consistency rule:** the manifest lists **every** delivery artifact
**except `manifest.json` itself**. `verifyManifest` enforces exactly this — a
file present in the bundle but missing from `entries` is
`delivery/unlisted-artifact`; an entry with no file is
`delivery/missing-artifact`; a byte-count or SHA-256 mismatch is
`delivery/hash-mismatch`; a duplicate `path` is `delivery/duplicate-path`.

**Path confinement.** A manifest is untrusted input. `validateBundleRelativePath`
is the single canonical validator: a path must be a non-empty POSIX
bundle-relative path — no NUL, no backslash, no leading `/`, no drive-letter
segment, no `.` / `..` segment, no empty segment, each segment
`[A-Za-z0-9._-]+`, and never `manifest.json`. `verifyManifest` runs it **plus**
resolve confinement (`resolve(root, ...segments)` must be `root` or strictly
inside `root + sep`) **before** any `existsSync` / `readFileSync` / `hashFile` —
a tampered `../outside.txt` can never make the verifier touch a file outside the
bundle; it becomes `delivery/unsafe-path`. `buildManifest` applies the same
lexical check to every entry it writes. The JSON Schema pattern
(`schemas/delivery-manifest.schema.json`) forbids `.`/`..` segments and
`manifest.json` as defence-in-depth, but the runtime validator is authoritative.

**Filesystem-real confinement (no symlink / junction escape).** Lexical checks
and `resolve()` are purely textual: `resolve(root, "screenshots/a.png")` can
stay inside the bundle while `screenshots` — or `screenshots/a.png` itself — is
a symbolic link / junction whose target is outside, and `existsSync` /
`readFileSync` / `hashFile` would then follow it. So for every manifest entry
`verifyManifest` walks **each path component from the bundle root to the target
with `lstatSync`** (which does not follow links) *before* reading a byte; any
component that is a symbolic link → `delivery/unsafe-path`, the entry is never
read. The directory walk that finds unlisted files also uses `lstatSync` and
**never follows or descends** a link — a link found anywhere in the tree is
`delivery/unsafe-path`. An entry that exists but is not a regular file is
rejected the same way. A delivery bundle is regular files only; `deliverAtomic`
writes only `writeFileSync` output and then re-runs `verifyManifest` on the
staging dir, so the writer is held to the same rule. On Windows this covers
junctions and other reparse points that Node's link APIs report as
`isSymbolicLink()`; no Win32-native probing is done.

---

## Bundle layout

```
delivery/
├── arclume-deck.json
├── arclume-deck.html
├── visual-qa.json
├── visual-qa-receipt.json
├── manifest.json
└── screenshots/
    ├── slide-001-cover.png
    ├── slide-002-…png
    ├── …
    └── viewer-overview.png
```

No PPTX, no PDF. The screenshots are QA evidence, not a product export (Phase 8).

---

## Guarantees (tested)

- **No partial delivery.** A failure injected after the HTML, after the
  screenshots, before the manifest, or before the rename leaves **no**
  destination and cleans the staging sibling.
- **A prior delivery survives.** A later failed delivery to a *different* path
  leaves the earlier bundle byte-for-byte intact and manifest-valid.
- **Tamper detection.** Editing any delivered artifact makes `verifyManifest`
  fail with `delivery/hash-mismatch`; adding an unlisted file fails with
  `delivery/unlisted-artifact`.
- **Evidence binding.** `deliverAtomic` rejects — before any staging — a receipt
  built for a different HTML/deck, an HTML that is not `renderDeckHtml(deck).html`
  (`delivery/html-deck-mismatch`, even with every receipt hash rebuilt for the
  mix), a Visual QA run whose `input.htmlSha256` is not the delivered HTML
  (`delivery/qa-input-mismatch`), a manipulated browser version, a `valid` flag
  or `summary` that disagrees with the findings, a screenshot descriptor whose
  hash/bytes disagree with its buffer, a stale / missing descriptor, or a receipt
  whose slide-screenshot set does not match what was delivered.
- **Path confinement.** A malicious manifest entry (`../outside.txt`,
  `screenshots/../../x`, an absolute or backslash path, `manifest.json`, a
  duplicate) is rejected by `verifyManifest` without ever reading outside the
  bundle.
- **No symlink escape.** A manifest entry that passes through a symbolic link /
  junction at any path component, or a bundle that contains a link anywhere in
  its tree, fails `verifyManifest` with `delivery/unsafe-path` — the link is
  never followed even when its target's hash matches the manifest. Exercised on
  Linux CI (and via junctions on Windows).
- **QA failure blocks delivery.** `visualQa.valid === false` ⇒ no final bundle.
- **Deterministic id.** The same deck + HTML + QA config always produces the same
  `deliveryId`.
- **Cross-platform paths.** All path logic uses `node:path` / `node:fs`; the flow
  is exercised on Windows and Linux CI.
