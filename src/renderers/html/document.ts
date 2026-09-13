/**
 * The HTML5 document shell: `<head>` (charset, viewport, CSP, deterministic
 * metadata, the single `<style>`), and `<body>` (the `<main>` stage, the viewer
 * controls, the progress bar, the single `<script>`).
 *
 * No timestamp is ever emitted. No remote resource is ever referenced.
 */

import type { ArclumeDeck } from "../../types/deck.js";
import type { Theme } from "../../visual/theme.js";
import { escapeHtml } from "./escape.js";
import { buildStylesheet } from "./styles.js";
import { HTML_RENDERER_VERSION } from "./types.js";
import { VIEWER_RUNTIME } from "./viewer-runtime.js";

/**
 * A strict CSP for a self-contained deck: no network of any kind, `data:` only
 * for images / fonts / media, inline `<style>` and `<script>` allowed (there is
 * exactly one of each and both are renderer-authored).
 */
export const DECK_CSP = [
  "default-src 'none'",
  "img-src data:",
  "style-src 'unsafe-inline'",
  "script-src 'unsafe-inline'",
  "font-src data:",
  "media-src data:",
  "connect-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

const LOCALE_RE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

function localeOf(deck: ArclumeDeck): string {
  const l = deck.meta?.locale;
  return typeof l === "string" && LOCALE_RE.test(l) ? l : "es";
}

export interface DocumentParts {
  deck: ArclumeDeck;
  theme: Theme;
  aspectRatio: string;
  slidesHtml: string;
  slideCount: number;
  diagramCount: number;
}

export function renderDocument(p: DocumentParts): string {
  const { deck } = p;
  const lang = localeOf(deck);
  const title = escapeHtml(deck.meta?.title ?? deck.project?.name ?? "Arclume deck");
  const css = buildStylesheet(p.theme, p.aspectRatio);
  const stageLabel = escapeHtml(
    `${deck.project?.name ?? deck.meta?.title ?? "Presentation"} — presentation`,
  );

  const deckAttrs = [
    `class="arclume-deck"`,
    `data-arclume-ir-version="${escapeHtml(deck.irVersion)}"`,
    `data-arclume-renderer-version="${HTML_RENDERER_VERSION}"`,
    `data-arclume-theme="${escapeHtml(p.theme.deckThemeName)}"`,
    `data-arclume-theme-tokens-ref="${escapeHtml(deck.theme?.tokensRef ?? "")}"`,
    `data-arclume-aspect-ratio="${escapeHtml(p.aspectRatio)}"`,
    `data-arclume-slide-count="${p.slideCount}"`,
    `data-arclume-diagram-count="${p.diagramCount}"`,
  ].join(" ");

  return `<!doctype html>
<html lang="${escapeHtml(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${escapeHtml(DECK_CSP)}">
<meta name="referrer" content="no-referrer">
<meta name="generator" content="Arclume HTML Renderer ${HTML_RENDERER_VERSION}">
<meta name="color-scheme" content="light">
<title>${title}</title>
<style>${css}
</style>
</head>
<body class="arclume-body">
<div ${deckAttrs}>
<div class="arclume-progress" aria-hidden="true"><div class="arclume-progress-bar"></div></div>
<main class="arclume-stage-wrap" aria-label="${stageLabel}">
<div class="arclume-stage">
${p.slidesHtml}
</div>
</main>
<nav class="arclume-controls" aria-label="Presentation navigation">
<button type="button" class="arclume-prev" aria-label="Previous slide">&#8249;</button>
<p class="arclume-counter" aria-live="polite" aria-atomic="true"><span class="arclume-counter-current">1</span> / <span class="arclume-counter-total">${p.slideCount}</span></p>
<button type="button" class="arclume-next" aria-label="Next slide">&#8250;</button>
</nav>
</div>
<script>${VIEWER_RUNTIME}
</script>
</body>
</html>
`;
}
