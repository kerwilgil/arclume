/**
 * Slide budget: clamp the requested budget, then bring the built slide list
 * inside it — deterministically, without ever fabricating a slide.
 *
 *  - over budget: try merging adjacent same-purpose content slides first, then
 *    drop the lowest-priority non-cover/closing slides.
 *  - under budget: leave it short and record `planning/under-budget`.
 *
 * An automatic merge only fires when the two slides share **narrative
 * identity**: same `sectionId`, same `narrativePurpose`, same `kind`, adjacent,
 * and small enough combined. Two conceptually different sections that merely
 * happen to share a `narrativePurpose` (e.g. a keyword-scoped "Security" section
 * and a "Risks" section, both `risk`) are never silently fused — the later
 * drop/condensation strategy handles them instead, explicitly.
 *
 * A merged slide preserves provenance from **both** inputs (a deterministic,
 * deduplicated union of `sourceRefs`, capped) and re-derives its title,
 * `keyMessage`, `contentIntent`, `visualIntent`, `visualCandidates` and
 * `density` from the *combined* knowledge — never keeping text authored for only
 * the first half. `knowledgeRefs` / `claimRefs` remain the canonical trace.
 */

import { stableStringify } from "../determinism/hash.js";
import type { SourceRef } from "../types/common.js";
import { densityFor } from "./density.js";
import type { PlannedSlide, PlanningDecision, PlanningNote, SlideBudget } from "./types.js";

export interface BudgetOptions {
  minSlides?: number;
  targetSlides?: number;
  maxSlides?: number;
}

/** Recomputed fields for a merged slide, derived from the *combined* knowledge. */
export interface MergeRecompute {
  title: string;
  keyMessage: string;
  contentIntent: string;
  visualIntent: PlannedSlide["visualIntent"];
  visualCandidates?: string[];
  claimRefs: string[];
  sourceRefs: SourceRef[];
  density: PlannedSlide["density"];
}

/**
 * Callback the SlidePlanner hands the budgeter so a merge can be recomputed
 * semantically from the combined knowledge. Returns `null` to refuse the merge
 * (identity not safe) — the budgeter then falls back to drop/condensation.
 */
export type SemanticMerge = (
  a: PlannedSlide,
  b: PlannedSlide,
  knowledgeRefs: string[],
) => MergeRecompute | null;

const DEFAULTS: SlideBudget = { minSlides: 8, targetSlides: 12, maxSlides: 16 };

/** Cap for a merged slide's `sourceRefs` union — matches the SlidePlanner's own cap. */
const MERGED_SOURCE_REF_CAP = 8;

export function normalizeBudget(
  options: BudgetOptions | undefined,
  notes: PlanningNote[],
): SlideBudget {
  const raw = {
    minSlides: Math.floor(options?.minSlides ?? DEFAULTS.minSlides),
    targetSlides: Math.floor(options?.targetSlides ?? DEFAULTS.targetSlides),
    maxSlides: Math.floor(options?.maxSlides ?? DEFAULTS.maxSlides),
  };
  const minSlides = Math.max(1, raw.minSlides);
  const maxSlides = Math.max(minSlides, raw.maxSlides);
  let targetSlides = raw.targetSlides;
  if (targetSlides < minSlides) targetSlides = minSlides;
  if (targetSlides > maxSlides) targetSlides = maxSlides;

  const budget = { minSlides, targetSlides, maxSlides };
  if (
    raw.minSlides !== budget.minSlides ||
    raw.maxSlides !== budget.maxSlides ||
    raw.targetSlides !== budget.targetSlides
  ) {
    notes.push({
      code: "planning/budget-clamped",
      message: `requested budget adjusted to a consistent range: min ${budget.minSlides}, target ${budget.targetSlides}, max ${budget.maxSlides}`,
      severity: "info",
    });
  }
  return budget;
}

function isProtected(kind: string): boolean {
  return kind === "cover" || kind === "closing";
}

function uniqSorted(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Keep a decision string inside the schema's `shortText` cap (240). */
function clampShort(text: string): string {
  return text.length <= 240 ? text : `${text.slice(0, 239).trimEnd()}…`;
}

/** Strip a trailing `(1/2)`-style split counter from a title. */
export function stripSplitMarker(title: string): string {
  const stripped = title.replace(/\s*\(\d+\/\d+\)\s*$/, "").trim();
  return stripped.length > 0 ? stripped : title;
}

/**
 * Deterministic, deduplicated union of two `sourceRef` lists. Ordered by the
 * stable serialization of each ref (not by input slide), so truncation to the
 * cap never biases entirely toward the first slide.
 */
export function unionSourceRefs(
  a: readonly SourceRef[],
  b: readonly SourceRef[],
  cap = MERGED_SOURCE_REF_CAP,
): SourceRef[] {
  const seen = new Set<string>();
  const keyed: Array<{ key: string; ref: SourceRef }> = [];
  for (const ref of [...a, ...b]) {
    const key = stableStringify(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    keyed.push({ key, ref });
  }
  keyed.sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
  return keyed.slice(0, cap).map((k) => k.ref);
}

/** Fallback recompute used only when no `SemanticMerge` callback is supplied. */
function fallbackMerge(a: PlannedSlide, b: PlannedSlide, knowledgeRefs: string[]): MergeRecompute {
  const claimRefs = uniqSorted([...a.claimRefs, ...b.claimRefs]);
  const visualCandidates = uniqSorted([
    ...(a.visualCandidates ?? []),
    ...(b.visualCandidates ?? []),
  ]);
  const contentIntent = /\(merged\)\s*$/.test(a.contentIntent)
    ? a.contentIntent
    : `${stripSplitMarker(a.contentIntent)} (merged)`;
  const result: MergeRecompute = {
    title: stripSplitMarker(a.title),
    keyMessage: a.keyMessage,
    contentIntent,
    visualIntent: a.visualIntent,
    claimRefs,
    sourceRefs: unionSourceRefs(a.sourceRefs, b.sourceRefs),
    density: densityFor(knowledgeRefs.length + claimRefs.length),
  };
  if (visualCandidates.length > 0) result.visualCandidates = visualCandidates;
  return result;
}

function mergeAdjacent(
  slides: PlannedSlide[],
  budget: SlideBudget,
  decisions: PlanningDecision[],
  notes: PlanningNote[],
  merge: SemanticMerge | undefined,
): PlannedSlide[] {
  let working = [...slides];
  let merged = 0;
  let i = 0;
  while (working.length > budget.maxSlides && i < working.length - 1) {
    const a = working[i] as PlannedSlide;
    const b = working[i + 1] as PlannedSlide;
    const compatible =
      !isProtected(a.kind) &&
      !isProtected(b.kind) &&
      a.sectionId === b.sectionId &&
      a.narrativePurpose === b.narrativePurpose &&
      a.kind === b.kind &&
      a.knowledgeRefs.length + b.knowledgeRefs.length <= 12;
    if (!compatible) {
      i += 1;
      continue;
    }
    const knowledgeRefs = uniqSorted([...a.knowledgeRefs, ...b.knowledgeRefs]);
    const recompute =
      (merge ? merge(a, b, knowledgeRefs) : undefined) ?? fallbackMerge(a, b, knowledgeRefs);
    if (recompute === null) {
      i += 1;
      continue;
    }
    const combined: PlannedSlide = {
      ...a,
      title: recompute.title,
      keyMessage: recompute.keyMessage,
      knowledgeRefs,
      claimRefs: recompute.claimRefs,
      sourceRefs: recompute.sourceRefs,
      density: recompute.density,
      priority: Math.min(a.priority, b.priority),
      contentIntent: recompute.contentIntent,
      visualIntent: recompute.visualIntent,
    };
    if (recompute.visualCandidates && recompute.visualCandidates.length > 0) {
      combined.visualCandidates = recompute.visualCandidates;
    } else {
      delete combined.visualCandidates;
    }
    working = [...working.slice(0, i), combined, ...working.slice(i + 2)];
    merged += 1;
    decisions.push({
      code: "topics-merged",
      slideId: a.id,
      sectionId: a.sectionId,
      decision: clampShort(`merge "${b.title}" into "${combined.title}"`),
      reason: `slide budget maxSlides=${budget.maxSlides}; adjacent slides share section "${a.sectionId}" and purpose "${a.narrativePurpose}"`,
      knowledgeRefs: knowledgeRefs.slice(0, 8),
    });
  }
  if (merged > 0) {
    notes.push({
      code: "planning/topics-merged",
      message: `merged ${merged} adjacent same-section same-purpose slide(s) to fit maxSlides=${budget.maxSlides}`,
      severity: "warning",
    });
  }
  return working;
}

/**
 * After budget reduction, a slide may still carry a `(1/2)`-style split marker
 * whose sibling was merged or dropped. Rewrite the title back to its base and
 * record a `split-marker-repaired` decision.
 */
function repairSplitMarkers(slides: PlannedSlide[], decisions: PlanningDecision[]): void {
  const re = /^(.*?)\s*\((\d+)\/(\d+)\)\s*$/;
  const groups = new Map<
    string,
    { base: string; total: number; parts: Set<number>; slides: PlannedSlide[] }
  >();
  for (const s of slides) {
    const m = re.exec(s.title);
    if (!m) continue;
    const base = (m[1] as string).trim();
    const part = Number(m[2]);
    const total = Number(m[3]);
    const key = `${s.sectionId}\u0000${base}\u0000${total}`;
    const g = groups.get(key) ?? { base, total, parts: new Set<number>(), slides: [] };
    g.parts.add(part);
    g.slides.push(s);
    groups.set(key, g);
  }
  for (const g of groups.values()) {
    const complete = g.parts.size === g.total && [...g.parts].every((p) => p >= 1 && p <= g.total);
    if (complete) continue;
    for (const s of g.slides) {
      const before = s.title;
      s.title = g.base.length > 0 ? g.base : s.title;
      decisions.push({
        code: "split-marker-repaired",
        slideId: s.id,
        sectionId: s.sectionId,
        decision: clampShort(`drop stale split marker: "${before}" → "${s.title}"`),
        reason: `only ${g.parts.size} of ${g.total} split part(s) survived budget reduction`,
      });
    }
  }
}

export function applyBudget(
  built: readonly PlannedSlide[],
  budget: SlideBudget,
  decisions: PlanningDecision[],
  notes: PlanningNote[],
  merge?: SemanticMerge,
): PlannedSlide[] {
  // `index` currently carries build order; use it as the drop tiebreaker.
  let working: PlannedSlide[] = built.map((s, i) => ({ ...s, index: i }));

  if (working.length > budget.maxSlides) {
    working = mergeAdjacent(working, budget, decisions, notes, merge);
  }

  if (working.length > budget.maxSlides) {
    const over = working.length - budget.maxSlides;
    const droppable = working
      .filter((s) => !isProtected(s.kind))
      .sort((a, b) => b.priority - a.priority || b.index - a.index);
    const drop = new Set(droppable.slice(0, over).map((s) => s.id));
    for (const s of working) {
      if (drop.has(s.id)) {
        decisions.push({
          code: "over-budget-resolved",
          slideId: s.id,
          sectionId: s.sectionId,
          decision: `drop "${s.title}"`,
          reason: `slide budget maxSlides=${budget.maxSlides} exceeded; this slide has the lowest priority`,
          knowledgeRefs: s.knowledgeRefs.slice(0, 8),
        });
      }
    }
    working = working.filter((s) => !drop.has(s.id));
    notes.push({
      code: "planning/over-budget-resolved",
      message: `dropped ${drop.size} lower-priority slide(s) to fit maxSlides=${budget.maxSlides}`,
      severity: "warning",
    });
  }

  if (working.length < budget.minSlides) {
    notes.push({
      code: "planning/under-budget",
      message: `only ${working.length} justified slide(s); minSlides=${budget.minSlides}. No content was fabricated to reach the minimum.`,
      severity: "warning",
    });
    decisions.push({
      code: "under-budget",
      decision: `keep ${working.length} slide(s)`,
      reason: "the knowledge does not justify additional slides",
    });
  }

  repairSplitMarkers(working, decisions);

  working.forEach((s, i) => {
    s.index = i;
  });
  return working;
}
