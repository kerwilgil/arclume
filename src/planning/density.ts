/**
 * Semantic density estimate — from counting knowledge, never pixels.
 *
 * The signal is the number of distinct things a slide has to carry: knowledge
 * refs + claim refs + visual candidates. Phase 4 turns this into layout / block
 * choices; Phase 3 only flags when a slide is carrying too much.
 */

import type { SlideDensity } from "./types.js";

export function densityFor(signalCount: number): SlideDensity {
  if (signalCount <= 2) return "low";
  if (signalCount <= 6) return "medium";
  return "high";
}
