/**
 * Emphasis (Phase 4).
 *
 * One slide = one primary idea. Exactly one block is marked `emphasis: true` —
 * the one that carries the slide's `keyMessage`. Secondary blocks support it.
 * The builders already put the structural / primary block first, so emphasis is
 * simply "the first block", chosen deterministically.
 */

import type { Block } from "../types/blocks.js";

export function applyEmphasis(blocks: readonly Block[]): Block[] {
  if (blocks.length === 0) return [];
  return blocks.map((b, i) => (i === 0 ? { ...b, emphasis: true } : b));
}
