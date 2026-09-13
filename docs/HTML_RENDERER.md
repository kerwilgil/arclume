# HTML Renderer (Phase 5)

Turns a validated `ArclumeDeck` (`irVersion` `0.2.0`) into **one self-contained
HTML file** that opens in any modern browser — no server, no network, no
framework, no build step. The renderer lays out, styles, wraps and draws; it
**never changes deck semantics**.

- Status: **IMPLEMENTED**
- Renderer version: `HTML_RENDERER_VERSION = "0.1.0"` — independent of `IR_VERSION`.
- Entry point: `renderDeckHtml(deck, options?) → { html, report }` (pure, deterministic).
- Pipeline stages: `renderHtml(deck, ctx?)` and `runHtml(knowledge, options?)`.
- Filesystem: `writeHtmlArtifact(path, html)` and `writeArtifacts(dir, { …, html })`.

---

## 1. Contract

```ts
import { renderDeckHtml } from "arclume";

const { html, report } = renderDeckHtml(deck);           // context-free
const { html } = renderDeckHtml(deck, {                   // + Phase 4 context checks
  context: { knowledge, narrative, slidePlan },
});
```

1. **Validate first.** `renderDeckHtml` runs `validateArclumeDeck(deck, ctx)`.
   An invalid deck (schema or, when context is supplied, stale / mixed baseline)
   is a fatal `RenderError` (`render/invalid-deck`) and **nothing is rendered**.
2. **Resolve the declared theme.** The deck is the sole authority
   (`deck.theme.name` + `deck.theme.tokensRef`). Only `minimal` and `executive`
   resolve; anything else is `render/theme-unresolved`. There is no theme option
   and no override.
3. **Render** slides, blocks and native diagrams into a single HTML5 document.
4. **Self-check.** `assertRenderOutput` proves every slide / block / referenced
   diagram reached the DOM, the document has no NUL byte, and no remote
   construct leaked (`render/remote-resource-leak`, …). Integrity breaches are
   fatal; representational limits with a visible fallback become `warnings`.

### `HtmlRenderReport`

`rendererVersion`, `irVersion`, `theme`, `aspectRatio`, `slideCount`,
`blockCount`, `diagramCount`, `bytes` (UTF-8 length), `warnings[]`. **No
timestamp**, ever.

---

## 2. Determinism

The same `ArclumeDeck` (+ options) produces **byte-identical HTML**. The renderer
uses no `Date`, `Math.random`, `crypto.randomUUID`, hostname, temp path or
environment-dependent ordering — never a physics or randomised layout.

**Architecture layout is genuinely cycle-safe.** A deterministic Kahn
topological sort proves whether the graph is a DAG: if it is, `layer` is
assigned in topological order and is bounded by `nodes.length - 1`. If a cycle
is present, layout falls back to a deterministic stable grid (id-sorted,
`ceil(sqrt(n))` columns). In **both** paths the SVG `viewBox` is derived from
the real `max(node.x + width)` / `max(node.y + height)` plus a margin — never
from a layer count — so no node can fall outside the visible canvas. Edges may
cross; nodes are never clipped. The ARCLUME Visual Engine owns sophisticated cyclic
layout.)

Because Phase 4 already guarantees a byte-identical deck when the source
knowledge collections are reordered, the HTML is identical too (tested).

---

## 3. Security

| Concern | Handling |
| --- | --- |
| XSS | Every deck string is escaped (`escape.ts`): `& < > " '`, plus NUL → U+FFFD. Applies to titles, key messages, block text, quote text, table cells, code, diagram labels, captions, attributions and `aria-label`s. |
| Raw HTML/JS APIs | The renderer never uses `innerHTML`, `eval`, `new Function` or `document.write`. SVG is built element-by-element from the structured spec — never taken as a string from the deck. |
| Remote resources | `assertRenderOutput` distinguishes **active renderer-authored surface** from **escaped visible deck content**: (1) the whole document is scanned only for *live markup* — `<script src>`, `<link>`, `<iframe>`/`<embed>`/`<object>`/`<base>`, a remote or protocol-relative `src=` / `href=` (each needs a literal `<tag` or a literal quote, which escaped deck text cannot form); (2) the single renderer-authored `<script>` body is scanned for `fetch(`, `XMLHttpRequest`, `new WebSocket`, `sendBeacon`, `EventSource`, dynamic `import(`; (3) the single renderer-authored `<style>` body is scanned for `@import` and a remote `url(...)`. A `CodeBlock` that merely *shows* `fetch("/api")` or `@import url("https://…")` as text renders normally and is never rejected. Any real leak throws `render/remote-resource-leak`. |
| Content-Security-Policy | A `<meta http-equiv>` CSP: `default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:; media-src data:; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'`. There is exactly one inline `<style>` and one inline `<script>`, both renderer-authored. |
| Images | Only a base64 **raster** `data:` URI (`png/jpeg/gif/webp/avif/bmp`) is placed in `<img src>`. SVG data URIs and every remote / `file:` / relative path are refused with a labelled placeholder + `render/image-external-not-embedded` (non-fatal). |
| Code / language hint | `class="language-…"` / `data-language` only from an allowlist (`^[A-Za-z0-9][A-Za-z0-9+#._-]{0,29}$`). No syntax highlighter, remote or otherwise. |

---

## 4. Themes

`resolveThemeVars(theme)` maps the abstract Phase 4 `ThemeTokens`
(`scale.2xl/regular`, `spacingScale: roomy`, `border: hairline`, …) to concrete
CSS custom properties on `.arclume-deck[data-arclume-theme="<name>"]`
(`--arclume-color-*`, `--arclume-fs-*` / `--arclume-fw-*`, `--arclume-space-*`,
`--arclume-radius`, `--arclume-shadow`, `--arclume-divider`, …), plus a
renderer-owned concrete palette per theme id.

- **minimal** — flat surfaces, hairline dividers, roomy whitespace, restrained
  accent, larger-but-lighter display scale. Editorial.
- **executive** — raised cards, higher contrast, a stronger / bolder display
  scale, a more assertive accent. Not "minimal with another name".

Both are semantically identical decks; only the token resolution differs.

---

## 5. Slides, layouts and blocks

- **Layouts** — exhaustive switch over `SlideLayout`
  (`single | split-2 | grid | full-bleed-visual | centered | quote`); each maps
  to `.arclume-layout-<name>`. An unknown layout is fatal
  (`render/unsupported-layout`), never a silent fallback.
- **Blocks** — a discriminated-union switch over all 16 types with
  `assertNever` in the default branch. A new block type that the renderer does
  not know breaks the TypeScript build rather than rendering as text.
- **Long key messages** — never truncated or reworded. A deterministic
  length-only class (`is-normal` ≤ 90, `is-long` ≤ 160, `is-very-long`
  otherwise) drives wrapping and the responsive type scale. Phase 6 decides
  visually whether it still overflows.
- **status / callout / risk** — rendered from the IR fields as-is. `status.state`
  (`green|amber|red|unknown`) is a deck field, so mapping it to a colour is
  representation, not reasoning; the renderer never derives a state from
  `active`/`done`/`blocked`. `UNKNOWN` risks are visually distinct without any
  added claim.

---

## 6. Native diagrams

`engine: "native"`, `spec.format: "arclume.native.v1"` → deterministic inline
SVG the renderer builds itself:

| kind | rendering |
| --- | --- |
| `architecture` | layered nodes (longest-path layers, id-ordered within a layer), edges with an arrowhead + relation-type label. Direction and relation identity are never changed. |
| `process` | step boxes in IR order; an arrow **only** where a real edge exists (a step-only process legitimately shows no arrows — no synthetic `PRECEDES`). |
| `sequence` | numbered lifeline + stacked step rows — visually distinct from architecture. |
| `timeline` | horizontal axis, one tick per item in IR order, date + state. |
| `roadmap` | stacked phase bars in IR order, status + dates. |

`engine: "visual"` → labelled placeholder + `render/unsupported-diagram-engine`
(Phase 7); support is never faked. Every node / step / item / relation keeps its
identity as `data-node-id` / `data-step-id` / `data-item-id` / `data-entity-id`
/ `data-relation-id` for Phase 6.

---

## 7. Provenance in the DOM

The renderer does not paper the slides with hashes, but keeps provenance
machine-readable:

- deck root: `data-arclume-ir-version`, `data-arclume-renderer-version`,
  `data-arclume-theme`, `data-arclume-theme-tokens-ref`,
  `data-arclume-aspect-ratio`, `data-arclume-slide-count`,
  `data-arclume-diagram-count`.
- slide `<section>`: `data-slide-id`, `data-slide-index`, `data-slide-kind`,
  `data-narrative-purpose`, and `data-section-id` / `data-diagram-ref` when set.
- block `<div>`: `data-block-id`, `data-block-type`, and `data-source-ids` /
  `data-source-count` / `data-metric-id` / `data-risk-id` when present.
- a discreet `<aside class="arclume-evidence">` lists a slide's evidence source
  ids when it carries any.

---

## 8. Errors

`render/invalid-deck`, `render/theme-unresolved`, `render/unsupported-layout`,
`render/unsupported-diagram`, `render/unsupported-diagram-engine`,
`render/diagram-unrenderable`, `render/diagram-ref-missing`,
`render/image-external-not-embedded`, `render/empty-output`,
`render/malformed-document`, `render/nul-byte`, `render/remote-resource-leak`,
`render/script-count`, `render/style-count`, `render/slide-missing`,
`render/block-missing`, `render/diagram-missing`.

Integrity errors throw `RenderError` (stage `RENDER`). Safe representational
limits (a placeholder image, a condensed diagram) are `report.warnings`.

---

## 9. Not in Phase 5

Chromium screenshots / visual regression / pixel-overflow detection / atomic
receipts (Phase 6); the Visual Engine adapter (Phase 7); PPTX / PDF / PNG / SVG-file
export and PDF/DOCX/URL ingestion (Phase 8); a web UI (Phase 10). Inline SVG
inside the HTML is Phase 5 and is **not** SVG export. A basic `@media print`
block (every slide, page breaks) is browser print behaviour, **not** PDF export.
