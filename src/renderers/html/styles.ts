/**
 * The single, shared stylesheet. Inlined once into `<head>`; never duplicated
 * per slide. All selectors are namespaced under `.arclume-*`. No `@import`, no
 * remote font, no url() to anything but `data:`.
 */

import type { Theme } from "../../visual/theme.js";
import { resolveThemeVars } from "./theme.js";

const BASE = String.raw`
*, *::before, *::after { box-sizing: border-box; }
.arclume-body {
  margin: 0;
  background: var(--arclume-color-stage-ground);
  color: var(--arclume-color-text-primary);
  font-family: var(--arclume-font-body);
  font-size: 16px;
  line-height: 1.5;
  -webkit-text-size-adjust: 100%;
}
.arclume-deck { min-height: 100vh; display: flex; flex-direction: column; }
.arclume-stage-wrap {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: clamp(0.5rem, 3vw, 2.5rem);
}
.arclume-stage {
  width: min(100%, 1280px);
  aspect-ratio: var(--arclume-aspect, 16 / 9);
  position: relative;
  background: var(--arclume-color-background);
  border: var(--arclume-border-width) solid var(--arclume-border-color);
  border-radius: var(--arclume-radius);
  box-shadow: var(--arclume-shadow);
  overflow: hidden;
  container-type: inline-size;
}
.arclume-slide {
  position: absolute;
  inset: 0;
  padding: clamp(1rem, 4.5cqi, 3.5rem);
  display: flex;
  flex-direction: column;
  gap: var(--arclume-space-2);
  overflow: auto;
}
.arclume-viewing .arclume-slide:not(.is-active) { display: none; }
.arclume-slide:focus-visible { outline: 3px solid var(--arclume-color-accent); outline-offset: -3px; }
.arclume-slide-title {
  margin: 0;
  font-family: var(--arclume-font-display);
  font-size: var(--arclume-fs-title);
  font-weight: var(--arclume-fw-title);
  letter-spacing: -0.01em;
}
.arclume-slide-subtitle {
  margin: 0;
  color: var(--arclume-color-text-secondary);
  font-size: var(--arclume-fs-heading);
  font-weight: var(--arclume-fw-body);
}
.arclume-keymessage {
  margin: 0;
  font-family: var(--arclume-font-display);
  font-weight: var(--arclume-fw-heading);
  color: var(--arclume-color-text-primary);
  max-width: 46ch;
}
.arclume-keymessage.is-normal { font-size: var(--arclume-fs-heading); }
.arclume-keymessage.is-long { font-size: var(--arclume-fs-body); max-width: 60ch; }
.arclume-keymessage.is-very-long { font-size: var(--arclume-fs-body); max-width: 74ch; line-height: 1.45; }
.arclume-blocks { display: flex; flex-direction: column; gap: var(--arclume-space-2); }
.arclume-layout-split-2 .arclume-blocks,
.arclume-layout-grid .arclume-blocks {
  display: grid;
  gap: var(--arclume-space-2);
}
.arclume-layout-split-2 .arclume-blocks { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.arclume-layout-grid .arclume-blocks { grid-template-columns: repeat(auto-fit, minmax(min(100%, 16rem), 1fr)); }
.arclume-layout-centered { align-items: center; justify-content: center; text-align: center; }
.arclume-layout-centered .arclume-keymessage { margin-inline: auto; }
.arclume-layout-quote { align-items: center; justify-content: center; }
.arclume-layout-full-bleed-visual { padding: 0; }
.arclume-layout-full-bleed-visual .arclume-slide-title { position: absolute; top: clamp(1rem,4cqi,2rem); left: clamp(1rem,4cqi,2rem); z-index: 1; }
.arclume-layout-full-bleed-visual .arclume-blocks { flex: 1; }
@container (max-width: 640px) {
  .arclume-layout-split-2 .arclume-blocks { grid-template-columns: 1fr; }
}

.arclume-block { min-width: 0; }
.arclume-block-caption { margin: var(--arclume-space-1) 0 0; color: var(--arclume-color-text-secondary); font-size: var(--arclume-fs-caption); }
.arclume-text { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.arclume-card {
  background: var(--arclume-surface-fill);
  border: var(--arclume-divider);
  border-radius: var(--arclume-radius);
  padding: var(--arclume-space-2);
}
.arclume-metric { display: flex; flex-direction: column; gap: 0.15em; }
.arclume-metric-value {
  font-family: var(--arclume-font-display);
  font-size: var(--arclume-fs-metric);
  font-weight: var(--arclume-fw-metric);
  line-height: 1.05;
}
.arclume-metric-label { color: var(--arclume-color-text-secondary); font-size: var(--arclume-fs-caption); }
.arclume-metric-unit { font-size: 0.5em; color: var(--arclume-color-text-secondary); margin-left: 0.25em; }
.arclume-metric-delta { font-size: var(--arclume-fs-caption); }
.arclume-metric-delta.is-up-good { color: var(--arclume-color-positive); }
.arclume-metric-delta.is-down-good { color: var(--arclume-color-positive); }
.arclume-metric-delta.is-neutral { color: var(--arclume-color-neutral); }
.arclume-metric-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 12rem), 1fr)); gap: var(--arclume-space-2); }

.arclume-table-wrap { overflow-x: auto; }
.arclume-table { border-collapse: collapse; width: 100%; font-size: var(--arclume-fs-body); }
.arclume-table th, .arclume-table td {
  border: var(--arclume-divider);
  padding: 0.4em 0.6em;
  text-align: left;
  vertical-align: top;
}
.arclume-table thead th { background: var(--arclume-color-stage-ground); font-weight: var(--arclume-fw-heading); }

.arclume-quote { margin: 0; border-left: 3px solid var(--arclume-color-accent); padding-left: var(--arclume-space-2); }
.arclume-quote p { margin: 0; font-size: var(--arclume-fs-heading); }
.arclume-quote footer { margin-top: var(--arclume-space-1); color: var(--arclume-color-text-secondary); font-size: var(--arclume-fs-caption); }

.arclume-callout { border-radius: var(--arclume-radius); padding: var(--arclume-space-2); border: var(--arclume-divider); }
.arclume-callout.tone-info { border-color: var(--arclume-color-accent); }
.arclume-callout.tone-success { border-color: var(--arclume-color-positive); }
.arclume-callout.tone-warning { border-color: var(--arclume-color-warning); }
.arclume-callout.tone-danger { border-color: var(--arclume-color-negative); }

.arclume-status { display: flex; align-items: baseline; gap: 0.5em; }
.arclume-status-dot { width: 0.7em; height: 0.7em; border-radius: 50%; background: var(--arclume-color-neutral); flex: none; }
.arclume-status.state-green .arclume-status-dot { background: var(--arclume-color-positive); }
.arclume-status.state-amber .arclume-status-dot { background: var(--arclume-color-warning); }
.arclume-status.state-red .arclume-status-dot { background: var(--arclume-color-negative); }

.arclume-risk { border: var(--arclume-divider); border-radius: var(--arclume-radius); padding: var(--arclume-space-2); }
.arclume-badge {
  display: inline-block;
  font-size: var(--arclume-fs-caption);
  border: 1px solid currentColor;
  border-radius: 999px;
  padding: 0 0.6em;
  color: var(--arclume-color-text-secondary);
}
.arclume-badge.fact-FACT { color: var(--arclume-color-positive); }
.arclume-badge.fact-INFERENCE { color: var(--arclume-color-accent); }
.arclume-badge.fact-UNKNOWN { color: var(--arclume-color-neutral); font-style: italic; }
.arclume-badge.fact-RECOMMENDATION { color: var(--arclume-color-warning); }
.arclume-kv { margin: var(--arclume-space-1) 0 0; display: flex; flex-wrap: wrap; gap: 0.2em 1em; font-size: var(--arclume-fs-caption); color: var(--arclume-color-text-secondary); }

.arclume-comparison { display: grid; grid-template-columns: minmax(6rem, 1fr) 1fr 1fr; gap: 1px; background: var(--arclume-border-color); border: var(--arclume-divider); }
.arclume-comparison > * { background: var(--arclume-color-background); padding: 0.4em 0.6em; }
.arclume-comparison .is-head { font-weight: var(--arclume-fw-heading); background: var(--arclume-color-stage-ground); }

.arclume-timeline { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--arclume-space-1); }
.arclume-timeline li { display: grid; grid-template-columns: max-content 1fr; gap: 0.75em; }
.arclume-timeline .when { color: var(--arclume-color-text-secondary); font-variant-numeric: tabular-nums; }
.arclume-timeline .state { font-size: var(--arclume-fs-caption); color: var(--arclume-color-text-secondary); }

.arclume-roadmap { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--arclume-space-1); }
.arclume-roadmap li { border-left: 3px solid var(--arclume-color-accent); padding-left: 0.75em; }
.arclume-roadmap .status { font-size: var(--arclume-fs-caption); color: var(--arclume-color-text-secondary); }

.arclume-code { margin: 0; overflow-x: auto; background: var(--arclume-color-stage-ground); border-radius: var(--arclume-radius); padding: var(--arclume-space-2); }
.arclume-code code { font-family: var(--arclume-font-mono); font-size: 0.9em; white-space: pre; }

.arclume-image { max-width: 100%; height: auto; border-radius: var(--arclume-radius); }
.arclume-image-missing {
  margin: 0;
  border: 1px dashed var(--arclume-border-color);
  border-radius: var(--arclume-radius);
  padding: var(--arclume-space-3);
  color: var(--arclume-color-text-secondary);
  text-align: center;
}

.arclume-diagram { overflow-x: auto; }
.arclume-diagram svg {
  max-width: 100%;
  height: auto;
  display: block;
  /* A diagram never outgrows its slide vertically (Visual Engine SVGs are wide). */
  max-height: min(430px, 46vh);
  margin-inline: auto;
}
.arclume-diagram text { font-family: var(--arclume-font-body); fill: var(--arclume-color-text-primary); }
.arclume-diagram .edge-line { stroke: var(--arclume-diagram-stroke); stroke-width: 1.5; fill: none; }
.arclume-diagram .edge-label { fill: var(--arclume-color-text-secondary); }
.arclume-diagram .node-box { fill: var(--arclume-diagram-node-fill); stroke: var(--arclume-diagram-stroke); stroke-width: 1.5; }
.arclume-diagram .node-box.is-outline { fill: none; }
.arclume-diagram .edge-marker path { fill: var(--arclume-diagram-stroke); }
.arclume-diagram-fallback {
  border: 1px dashed var(--arclume-border-color);
  border-radius: var(--arclume-radius);
  padding: var(--arclume-space-3);
  color: var(--arclume-color-text-secondary);
}

.arclume-evidence { margin: var(--arclume-space-2) 0 0; font-size: var(--arclume-fs-caption); color: var(--arclume-color-text-secondary); }

.arclume-controls {
  position: fixed;
  inset-block-end: 0.75rem;
  inset-inline-start: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background: var(--arclume-color-background);
  border: var(--arclume-divider);
  border-radius: 999px;
  padding: 0.25rem 0.5rem;
  box-shadow: var(--arclume-shadow);
}
.arclume-controls button {
  font: inherit;
  cursor: pointer;
  border: 0;
  background: transparent;
  color: inherit;
  padding: 0.15em 0.6em;
  border-radius: 999px;
  line-height: 1;
}
.arclume-controls button:hover { background: var(--arclume-color-stage-ground); }
.arclume-controls button:focus-visible { outline: 2px solid var(--arclume-color-accent); outline-offset: 2px; }
.arclume-counter { margin: 0; font-variant-numeric: tabular-nums; font-size: var(--arclume-fs-caption); }
.arclume-progress { position: fixed; inset-block-start: 0; inset-inline: 0; height: 3px; background: transparent; }
.arclume-progress-bar { height: 100%; width: 0; background: var(--arclume-color-accent); transition: width 180ms linear; }

@media (prefers-reduced-motion: reduce) {
  .arclume-progress-bar { transition: none; }
  * { scroll-behavior: auto !important; }
}

@media print {
  .arclume-controls, .arclume-progress { display: none !important; }
  .arclume-body { background: #fff; }
  .arclume-stage { box-shadow: none; border: 0; aspect-ratio: auto; width: 100%; }
  .arclume-slide { position: static; page-break-after: always; break-after: page; }
  .arclume-viewing .arclume-slide:not(.is-active) { display: flex !important; }
}
`;

export function buildStylesheet(theme: Theme, aspectRatio: string): string {
  const [w, h] = aspectRatio.split(":");
  const ratio = w && h ? `${w} / ${h}` : "16 / 9";
  return [
    `.arclume-deck[data-arclume-theme="${theme.deckThemeName}"] {`,
    resolveThemeVars(theme),
    `  --arclume-aspect: ${ratio};`,
    "}",
    BASE,
  ].join("\n");
}
