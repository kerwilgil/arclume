# Arclume — Chromium Visual QA (Phase 6)

Visual QA runs **strictly after** the self-contained HTML exists. It never
touches the deck, the `SlidePlan`, the `NarrativePlan`, the Reasoner or an LLM,
and it never rewrites the HTML. It opens the document in a real headless
Chromium and **observes, measures and captures**.

```
ArclumeDeck → HTML → ┌─────────────────────────────┐
                     │ Chromium (Playwright)        │
                     │  runtime observers          │
                     │  physical viewer drive      │
                     │  geometry measurement       │
                     │  screenshots                │
                     └──────────────┬──────────────┘
                                    ↓
                     VisualQaResult + screenshot buffers
                                    ↓
                     visual-qa.json  ·  Visual QA receipt
```

`VISUAL_QA_VERSION` is `0.1.0`, independent of `IR_VERSION` (`0.2.0`) and
`HTML_RENDERER_VERSION` (`0.1.0`).

---

## API

```ts
import { runVisualQa, validateRenderedDeck } from "arclume";

// browser-bound, asynchronous — not a pure function
const run = await runVisualQa(html, options?);          // VisualQaRun
const run = await validateRenderedDeck(deck, html, options?);
```

- `runVisualQa(html, options?)` — opens the HTML, returns a `VisualQaRun`
  (`VisualQaResult` **plus** `artifacts: ScreenshotArtifact[]`, the in-memory PNG
  buffers). Standalone QA of **any** valid self-contained document — no deck
  binding is claimed or checked.
- `validateRenderedDeck(deck, html, options?)` — **asserts a deck ↔ HTML
  binding**, so it is strict: (1) schema-check the `ArclumeDeck` (fatal
  `visual/invalid-deck`); (2) `renderDeckHtml(deck).html` and require
  `html === canonical` **byte for byte** — Phase 5's renderer is deterministic,
  so the only HTML that "is the render of this deck" is that exact output; any
  difference (a CSS rule, a block's text, a stray attribute) is fatal
  `visual/html-deck-mismatch` and the HTML is never silently replaced; (3) seed
  the aspect-ratio check from `deck.theme.aspectRatio` and call `runVisualQa`.
  The same byte-exact rule reaches `runDeckVisualQa` and `runValidatedDelivery`
  (both call `validateRenderedDeck`).

`VisualQaOptions`: `viewports`, `screenshots` (default `true`),
`captureViewport` (default the canonical desktop), `aspectRatio` (else read from
the DOM), `contrast` (default `true`), `channel`, `timeoutMs` (default 15000).

### Config validation (before Chromium launches)

`runVisualQa` rejects with `visual/invalid-input` when: the viewport matrix is
empty; a viewport `name` is empty or duplicated; a `width` / `height` /
`deviceScaleFactor` is not positive; or `screenshots` is enabled but
`captureViewport` is not one of the matrix names (which would otherwise yield a
"valid" result carrying zero screenshots).

### Pipeline stages

`runDeckVisualQa(deck, html, opts?)` → `buildVisualQaReceipt(...)` →
`buildManifest(...)` → `deliverAtomic(...)`. `runValidatedDelivery(deck, html,
destination, opts?)` is a convenience over the four, **not** a replacement — each
stage stays independently callable and inspectable.

---

## Browser environment

Every context is normalized so geometry and screenshots are reproducible on the
same machine:

| Setting | Value |
| --- | --- |
| `deviceScaleFactor` | `1` |
| `colorScheme` | `light` |
| `reducedMotion` | `reduce` |
| `forcedColors` | `none` |
| `locale` | `en-US` |
| `timezoneId` | `UTC` |

Pages load via `page.setContent(html)` (base URL `about:blank`) — no server, no
filesystem, no expected network. `document.fonts.ready` is awaited before any
measurement or capture; there are no arbitrary sleeps.

**Chromium flags:** none of `--disable-web-security`,
`--allow-file-access-from-files`, `--no-sandbox` are used. `--no-sandbox` is
opt-in only via `ARCLUME_VISUAL_QA_NO_SANDBOX=1` and is never silent.

### Browser identity

`VisualQaResult.browser` records `{ name: "chromium", version, platform,
deviceScaleFactor }`. A screenshot raster is **only** comparable within the same
browser build + platform + config — a Windows PNG will differ from a Linux one
by font rasterization. Visual QA never claims cross-platform raster determinism.

---

## Viewports

| name | size | policy |
| --- | --- | --- |
| `desktop-1440x900` | 1440×900 | **canonical** — strict: overflow / off-slide / clipping / aspect-ratio are **errors**; screenshots come from here |
| `laptop-1366x768` | 1366×768 | overflow / off-slide / clipping are **warnings** |
| `mobile-landscape-844x390` | 844×390 | overflow / off-slide / clipping are **warnings** |

`page-error`, `network-request`, `console-error`, `unexpected-dialog`,
`zero-size-element` and `diagram-zero-size` are **errors on every viewport**.

---

## What is checked

### Runtime (real browser)

| finding | trigger |
| --- | --- |
| `visual/network-request` | any `http(s)` / `ws(s)` request the page attempts |
| `visual/console-error` | a `console.error(...)` call |
| `visual/page-error` | an uncaught page error |
| `visual/unexpected-dialog` | `alert` / `confirm` / `prompt` / `beforeunload` (dismissed immediately) |
| `visual/browser-launch` | Chromium could not be launched |

The Phase 5 static CSP / markup post-check is **not** trusted here — the network
proof is physical.

### Viewer (physically driven)

Every button is clicked and every key pressed: `Next`/`Previous`, `ArrowRight`
/`ArrowLeft` /`ArrowDown` /`ArrowUp`, `PageDown`/`PageUp`, `Space`, `Home`/`End`,
`#slide=<id>`, an invalid hash. Invariants: exactly one `.arclume-slide.is-active`;
the active slide has no `aria-hidden`, inactives are `aria-hidden="true"`; the
counter and progress bar track position; `Previous` disabled on the first slide,
`Next` on the last; keyboard navigation moves focus onto the active slide; an
invalid hash falls back to slide 0 without a crash.
Findings: `visual/viewer-active-count`, `-nav`, `-counter`, `-progress`,
`-hash`, `-focus`, `-aria`.

### Geometry (measured, never inferred from CSS)

| finding | trigger (canonical = error, small viewports = warning) |
| --- | --- |
| `visual/stage-zero-size` | `.arclume-stage` missing or zero-box (**always error**) |
| `visual/aspect-ratio-mismatch` | stage ratio vs declared `theme.aspectRatio`, >2% (canonical only) |
| `visual/slide-overflow-x` / `-y` | `scrollWidth/Height > clientWidth/Height + 2px` |
| `visual/off-slide` | a critical element rendered outside the slide's own content box |
| `visual/text-clipped` | content bigger than its box **and** `overflow` is `hidden`/`clip` |
| `visual/zero-size-element` | a critical element with a ≤0 box (**always error**) |
| `visual/local-scroll` | a `.arclume-table-wrap` / `.arclume-code` / `.arclume-diagram` scrolls locally (**info**) |
| `visual/diagram-zero-size` | a native `<svg>` with a zero rendered box or no valid `viewBox` (**always error**) |
| `visual/diagram-clipped` | a native diagram clipped by its container |
| `visual/controls-overlap` | the fixed controls intersect the stage (warning; error on canonical if >2% of the stage area) |
| `visual/contrast-low` | a principal text token below its WCAG target (`<3:1` → error, `<4.5:1` → warning) — token-level, **not** "WCAG certified" |

Critical elements: `.arclume-slide-title`, `.arclume-keymessage`,
`.arclume-block`, `.arclume-diagram`. `overflow:hidden` is treated as a defect
to surface, never as an acceptable fix. A table / code / diagram *may* scroll
locally (`info`), but if that scroll breaks the whole slide it is the slide-level
error.

---

## VisualQaResult

```ts
interface VisualQaResult {
  version: string;                 // VISUAL_QA_VERSION
  valid: boolean;                  // false  ⟺  summary.errors > 0   (warnings never block)
  browser: { name: "chromium"; version; platform; deviceScaleFactor };
  input: { htmlSha256: string };   // SHA-256 of the exact HTML this run opened
  viewports: ViewportResult[];     // per-viewport counts
  findings: VisualFinding[];       // stably ordered
  screenshots: ScreenshotDescriptor[];  // metadata only — no pixels
  summary: { errors; warnings; info };
}
```

`input.htmlSha256` is computed inside `runVisualQa` from its own `html`
argument — there is **no** option to pass it in. It is what ties the findings
and screenshots to one specific document: `buildVisualQaReceipt` refuses to
build a receipt whose `html` does not hash to it, and the delivery preflight
rejects a bundle whose delivered HTML does not match it
(`delivery/qa-input-mismatch`). Still `[0-9a-f]{64}`, required, not optional —
`VISUAL_QA_VERSION` stays `0.1.0` because the contract is pre-`1.0` (see
`docs/STABILITY.md`) and every producer/consumer moves to the new field in the
same change.

`VisualQaRun` adds `artifacts: ScreenshotArtifact[]` (the PNG buffers). Only
`runVisualQa` returns it; `visual-qa.json` never contains a buffer.

### Finding order (deterministic)

`viewport` (matrix order) → `slideIndex` → `severity` (error, warning, info) →
`code` → `blockId` → `diagramId` → `message`. Never dependent on async event
arrival.

### Determinism

Within one HTML + config + Chromium build + platform + viewport: stable finding
order, stable screenshot filenames, stable receipt (bar the declared
browser/platform fields). Visual QA never uses `Date.now()`, `Math.random()`,
`randomUUID()`, a PID, an absolute temp path or a username for identity.

---

## Screenshots

- one PNG **per slide**, of the `.arclume-stage` element, from the capture
  viewport: `screenshots/slide-<NNN>-<safe-slide-id>.png` (1-based, zero-padded);
- one `screenshots/viewer-overview.png` of the full viewport (stage + controls +
  progress bar).

Each `ScreenshotDescriptor` carries `{ viewport, slideId, index, kind, width,
height, bytes, sha256, path }`. `sha256` is the lowercase-hex SHA-256 of the PNG
**bytes** — a filename is never used as evidence of content. An absolute path
never enters a hash.

---

## Visual regression

```ts
import { compareScreenshots } from "arclume";
const diff = compareScreenshots(expected, actual, { threshold?, includeAA?, maxRatio?, emitDiffImage? });
// { width, height, totalPixels, differentPixels, ratio, pass, sizeMismatch, diffImage? }
```

`pixelmatch` + `pngjs`. Same buffer vs itself → `differentPixels: 0`. The same
page rendered twice → `ratio` ≈ 0. A deliberate style change → `differentPixels
> 0`. Different dimensions → `sizeMismatch: true`, `differentPixels: -1` (never
throws).

**No committed cross-platform goldens.** Baseline comparison is only valid when
the browser build / platform / config match; that constraint is the caller's to
honor.

---

## visual-qa.json + receipt

`visualQaJson(result)` returns the schema-valid body
(`schemas/visual-qa.schema.json`, `additionalProperties: false`, versioned) —
every field explicitly picked, so no buffer can leak.

`buildVisualQaReceipt({ result, html, deckIrVersion, deckContentHash?,
configHash })` → a `VisualQaReceipt` (`schemas/visual-qa-receipt.schema.json`):

```ts
{
  receiptVersion,
  deck:    { irVersion, contentHash? },
  renderer:{ version },
  visualQa:{ version, configHash },
  browser: { name: "chromium", version, platform },   // evidence
  inputs:  { htmlSha256 },
  result:  { valid, errors, warnings },
  screenshots: [{ slideId, sha256, bytes }],          // slide shots, id-sorted
}
```

`inputs.htmlSha256` is derived from `result.input.htmlSha256`, and
`buildVisualQaReceipt` throws (`visual/receipt-input-mismatch`) if the `html` it
is handed does not hash to it — the receipt can never certify a document Visual
QA did not open.

The receipt body carries **no** timestamp, temp path, PID or username.
`visualQaConfigHash(viewports, options)` is a deterministic SHA-256 of the
viewport matrix (name-sorted) + the material options.

---

## Running

```bash
npx playwright install chromium          # local (CI: --with-deps chromium)
npm test            # fast unit suite — browser-free, excludes tests/visual/**
npm run test:visual # Chromium Visual QA suite (single-fork), tests/visual/**
```

CI runs the two as **separate jobs**; Phase 6 is not "PASS" unless real Chromium
executed `npm run test:visual`.

---

## Boundaries

Visual QA is engine-agnostic about the HTML. A deck whose diagram declares
`engine: "visual"` with no resolved artifact still renders the legacy Phase 5
placeholder on the low-level render path — that is **not** a Visual QA failure.
Canonical surfaces (`validateRenderedDeck`, `runValidatedDelivery`) never
accept the placeholder: they bind `CanonicalDeckRenderInput` (deck + resolved
artifacts) to the HTML byte-for-byte (see `docs/DIAGRAM_ENGINES.md`).

Phase 6 does **not** do PPTX/PDF/PNG *export* (the screenshots
are QA evidence, not a product) and not the CLI (Phase 9).
