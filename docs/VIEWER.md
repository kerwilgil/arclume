# Viewer runtime (Phase 5)

The generated `arclume-deck.html` embeds a small presentation viewer: one inline
`<script>`, no framework, no network, no bundler. It operates only on the DOM the
renderer produced — it never parses deck JSON, never assigns `innerHTML`, never
calls `eval` / `new Function` / `document.write`.

- Status: **IMPLEMENTED**
- Source string: `VIEWER_RUNTIME` (exported from `arclume`).

---

## 1. What it does

On load it collects `.arclume-slide` sections, adds `arclume-viewing` to
`<body>`, shows one slide at a time (`.is-active`; the others get
`aria-hidden="true"`), and keeps a URL hash, a slide counter and a progress bar
in sync. It does **not** auto-advance — there are no timers
(`setInterval` / `setTimeout` / `requestAnimationFrame`).

## 2. Controls

A fixed `<nav class="arclume-controls">` with a previous button
(`aria-label="Previous slide"`), a live counter
(`<p class="arclume-counter" aria-live="polite" aria-atomic="true">`) and a next
button (`aria-label="Next slide"`). A thin `<div class="arclume-progress-bar">`
tracks position. Both are hidden in `@media print`.

## 3. Keyboard

| Keys | Action |
| --- | --- |
| `ArrowRight`, `ArrowDown`, `PageDown`, `Space` | next |
| `ArrowLeft`, `ArrowUp`, `PageUp` | previous |
| `Home` | first slide |
| `End` | last slide |

Handlers are skipped when the event target is an `input`, `textarea`, `select`,
`button` or `[contenteditable]`, and when a modifier key is held. Moving by
keyboard or button also moves focus to the new slide `<section>`
(`tabindex="-1"`), so screen-reader and keyboard focus follow.

## 4. Deep links

Each slide is addressable as `#slide=<slide-id>` (URL-encoded). Changing slide
updates the hash via `history.replaceState` (no history spam; falls back to
`location.hash`). Opening the file with a hash jumps to that slide; an unknown
hash falls back to the first slide.

## 5. Accessibility

`<html lang>` from `deck.meta.locale` (default `es`); a `<main>` with an
`aria-label`; one `<section aria-roledescription="slide"
aria-label="Slide N of M: <title>">` per slide with an `<h2>` heading; named
controls; a visible `:focus-visible` outline; an `aria-live` counter; and a
`@media (prefers-reduced-motion: reduce)` block that removes the progress-bar
transition. Phase 6 will audit the rendered result visually.

## 6. Print

`@media print` lays every slide out in order with page breaks and hides the
controls / progress bar. This is browser print behaviour only — it is **not**
PDF export (Phase 8).

## 7. Responsive

The stage keeps `aspect-ratio` from `deck.theme.aspectRatio` (default `16 / 9`)
and scales to the viewport with container queries. It works on desktop, tablet
and mobile-landscape; a full mobile experience is not a Phase 5 requirement.

## 8. Browser storage

None. The viewer keeps state in memory and in the URL hash only.
