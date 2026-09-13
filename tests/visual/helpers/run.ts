/**
 * Thin wrappers used across the Visual QA suite: render a deck and run Visual QA
 * over it, with a single-viewport fast path.
 */

import { renderDeckHtml } from "../../../src/index.js";
import { runVisualQa } from "../../../src/index.js";
import { CANONICAL_VIEWPORT, type VisualQaOptions, type VisualQaRun } from "../../../src/index.js";
import type { ArclumeDeck } from "../../../src/types/deck.js";

export function renderDeck(deck: ArclumeDeck): string {
  return renderDeckHtml(deck).html;
}

/** Render + Visual QA on the canonical desktop viewport only (fast path). */
export async function qaCanonical(
  deck: ArclumeDeck,
  options: VisualQaOptions = {},
): Promise<{ html: string; run: VisualQaRun }> {
  const html = renderDeck(deck);
  const run = await runVisualQa(html, { viewports: [CANONICAL_VIEWPORT], ...options });
  return { html, run };
}

/** Visual QA on the canonical viewport for HTML you already have. */
export async function qaHtmlCanonical(
  html: string,
  options: VisualQaOptions = {},
): Promise<VisualQaRun> {
  return runVisualQa(html, { viewports: [CANONICAL_VIEWPORT], ...options });
}

/** Render + Visual QA over the full default viewport matrix. */
export async function qaFull(
  deck: ArclumeDeck,
  options: VisualQaOptions = {},
): Promise<{ html: string; run: VisualQaRun }> {
  const html = renderDeck(deck);
  const run = await runVisualQa(html, options);
  return { html, run };
}

export function errorsOf(run: VisualQaRun): string[] {
  return run.findings.filter((f) => f.severity === "error").map((f) => f.code);
}

export function codesOf(run: VisualQaRun): string[] {
  return run.findings.map((f) => f.code);
}
