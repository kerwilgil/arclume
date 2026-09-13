/**
 * SlidePlanner: `ProjectKnowledge` + `NarrativePlan` → `SlidePlan`.
 *
 * Deterministic. One slide carries one `keyMessage`. Every slide is traceable
 * back to knowledge ids and, through them, to sources. No visual form is
 * decided here — `visualIntent` / `visualCandidates` are semantic suggestions
 * the VisualDirector (Phase 4) may take or leave.
 */

import { contentHash, stableStringify } from "../determinism/hash.js";
import {
  type KnowledgeItem,
  type KnowledgeView,
  buildKnowledgeView,
} from "../narrative/knowledge-view.js";
import { narrativeContentHash } from "../narrative/planner.js";
import { getAudienceProfile } from "../narrative/presets/index.js";
import type {
  NarrativePlan,
  NarrativePlanSection,
  NarrativePurpose,
  PlanningDecision,
  PlanningNote,
} from "../narrative/types.js";
import type { Id, SourceRef } from "../types/common.js";
import type { ProjectKnowledge } from "../types/knowledge.js";
import { SLIDE_PLAN_VERSION } from "../version.js";
import {
  type BudgetOptions,
  type MergeRecompute,
  type SemanticMerge,
  applyBudget,
  normalizeBudget,
  stripSplitMarker,
} from "./budget.js";
import { densityFor } from "./density.js";
import {
  closingKeyMessage,
  coverKeyMessage,
  keyMessageFor,
  normalizeMessage,
  summarizeItems,
} from "./messaging.js";
import type { PlannedSlide, SlideKind, SlidePlan, VisualIntent } from "./types.js";

export type PlanSlidesOptions = BudgetOptions;

const GENERATOR = "arclume-slide-planner@0.1.0";

/**
 * Canonical semantic identity of a `SlidePlan`: its `contentHash` with `meta`
 * **and `knowledgeHash`** stripped. `knowledgeHash` is external provenance
 * copied verbatim from the source `ProjectKnowledge`, not part of what the plan
 * *says*; it is bound separately by the validator. This is the exact boundary
 * used when `meta.contentHash` is generated in {@link buildSlidePlan}.
 */
export function slidePlanContentHash(plan: SlidePlan): string {
  const { meta: _meta, knowledgeHash: _knowledgeHash, ...rest } = plan;
  return contentHash(rest);
}
const SPLIT_THRESHOLD = 6;
const MAX_SOURCE_REFS = 8;

interface PartSignals {
  hasMetric: boolean;
  hasRelation: boolean;
  hasPrecedes: boolean;
  hasPhaseOrMilestone: boolean;
}

function sortIds(ids: Iterable<Id>): Id[] {
  return [...new Set(ids)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function resolveItems(view: KnowledgeView, ids: readonly Id[]): KnowledgeItem[] {
  const out: KnowledgeItem[] = [];
  for (const id of ids) {
    const item = view.byId.get(id);
    if (item) out.push(item);
  }
  return out;
}

function signalsOf(items: readonly KnowledgeItem[]): PartSignals {
  return {
    hasMetric: items.some((i) => i.collection === "metrics"),
    hasRelation: items.some((i) => i.collection === "relations"),
    hasPrecedes: items.some((i) => i.collection === "relations" && i.raw["type"] === "PRECEDES"),
    hasPhaseOrMilestone: items.some(
      (i) => i.collection === "phases" || i.collection === "milestones",
    ),
  };
}

function kindFor(purpose: NarrativePurpose, s: PartSignals): SlideKind {
  switch (purpose) {
    case "impact":
    case "evidence":
      return s.hasMetric ? "metrics" : "content";
    case "architecture":
      return s.hasRelation ? "diagram" : "content";
    case "process":
      return "diagram";
    case "roadmap":
      return "roadmap";
    default:
      return "content";
  }
}

function visualFor(purpose: NarrativePurpose, s: PartSignals): VisualIntent {
  switch (purpose) {
    case "architecture":
      return s.hasRelation ? "architecture" : "summary";
    case "process":
      return s.hasPrecedes ? "sequence" : "process";
    case "impact":
    case "evidence":
      return s.hasMetric ? "metrics" : "summary";
    case "risk":
      return "risk";
    case "roadmap":
      return s.hasPhaseOrMilestone ? "roadmap" : "summary";
    case "status":
      return "status";
    case "call-to-action":
      return "none";
    default:
      return "summary";
  }
}

function visualCandidatesFor(purpose: NarrativePurpose, items: readonly KnowledgeItem[]): Id[] {
  switch (purpose) {
    case "architecture":
      return sortIds(
        items
          .filter(
            (i) =>
              i.collection === "components" ||
              i.collection === "relations" ||
              i.collection === "dependencies",
          )
          .map((i) => i.id),
      );
    case "process":
      return sortIds(
        items
          .filter(
            (i) =>
              i.collection === "processes" ||
              (i.collection === "relations" && i.raw["type"] === "PRECEDES"),
          )
          .map((i) => i.id),
      );
    case "impact":
    case "evidence":
      return sortIds(items.filter((i) => i.collection === "metrics").map((i) => i.id));
    case "roadmap":
      return sortIds(
        items
          .filter((i) => i.collection === "phases" || i.collection === "milestones")
          .map((i) => i.id),
      );
    default:
      return [];
  }
}

function collectClaimRefs(view: KnowledgeView, refItems: readonly KnowledgeItem[]): Id[] {
  const refIds = new Set(refItems.map((i) => i.id));
  const out = new Set<Id>();
  for (const i of refItems) if (i.collection === "claims") out.add(i.id);
  for (const claim of view.byCollection.get("claims") ?? []) {
    const supports = Array.isArray(claim.raw["supports"]) ? (claim.raw["supports"] as Id[]) : [];
    if (supports.some((t) => refIds.has(t))) out.add(claim.id);
  }
  return sortIds(out);
}

function dedupeSourceRefs(refs: readonly SourceRef[]): SourceRef[] {
  const seen = new Set<string>();
  const out: SourceRef[] = [];
  for (const ref of refs) {
    const key = stableStringify(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
    if (out.length >= MAX_SOURCE_REFS) break;
  }
  return out;
}

function ensureDistinct(keyMessage: string, title: string, supportCount: number): string {
  if (normalizeMessage(keyMessage) !== normalizeMessage(title)) return keyMessage;
  const base = keyMessage.replace(/[.!?]+$/, "");
  const extended = `${base} — ${supportCount} supporting item(s).`;
  return extended.length <= 240 ? extended : keyMessage;
}

function clamp240(text: string): string {
  return text.length <= 240 ? text : `${text.slice(0, 239).trimEnd()}…`;
}

/**
 * Make `keyMessage` different from the slide title and from every message
 * already placed. Deterministic: the disambiguation is built from the section
 * title plus the actual referenced items, then (last resort) the section id.
 */
function finalizeMessage(
  raw: string,
  title: string,
  sectionTitle: string,
  sectionId: string,
  items: readonly KnowledgeItem[],
  used: Set<string>,
): string {
  let msg = ensureDistinct(raw, title, items.length);
  if (used.has(normalizeMessage(msg))) {
    const specifics = summarizeItems(items).replace(/[.!?]+$/, "");
    const alt = clamp240(specifics ? `${sectionTitle}: ${specifics}.` : `${sectionTitle}: ${msg}`);
    msg = used.has(normalizeMessage(alt))
      ? clamp240(`${msg.replace(/[.!?]+$/, "")} (${sectionId}).`)
      : alt;
  }
  used.add(normalizeMessage(msg));
  return msg;
}

class IdMint {
  #used = new Set<string>();
  mint(base: string): string {
    let id = base;
    let n = 2;
    while (this.#used.has(id)) {
      id = `${base}-${n}`;
      n += 1;
    }
    this.#used.add(id);
    return id;
  }
}

/**
 * Build the {@link SemanticMerge} the budgeter uses when it has to fuse two
 * adjacent slides. A merge is only allowed inside a single narrative section;
 * the result's title, `keyMessage`, `contentIntent`, `visualIntent`,
 * `visualCandidates`, `claimRefs`, `sourceRefs` and `density` are all
 * re-derived from the *combined* knowledge — never inherited from the first
 * half. `sourceRefs` is a deterministic, deduplicated union of both sides'
 * evidence. `usedMessages` is shared with the caller so the recomputed
 * `keyMessage` stays globally distinct.
 */
export function createSemanticMerge(
  knowledge: ProjectKnowledge,
  narrative: NarrativePlan,
  usedMessages: Set<string> = new Set(),
): SemanticMerge {
  const view = buildKnowledgeView(knowledge);
  const sectionsById = new Map(narrative.sections.map((s) => [s.id, s]));

  return (a, b, knowledgeRefs) => {
    if (a.sectionId !== b.sectionId) return null;
    const section = sectionsById.get(a.sectionId);
    const sectionTitle = section?.title ?? stripSplitMarker(a.title);
    const items = resolveItems(view, knowledgeRefs);
    const signals = signalsOf(items);
    const purpose = a.narrativePurpose;
    const claimRefs = collectClaimRefs(view, items);
    const claimItems = resolveItems(view, claimRefs);

    // Free up the two source messages before re-deriving the combined one.
    usedMessages.delete(normalizeMessage(a.keyMessage));
    usedMessages.delete(normalizeMessage(b.keyMessage));
    const keyMessage = finalizeMessage(
      keyMessageFor(purpose, view, items),
      sectionTitle,
      sectionTitle,
      a.sectionId,
      items,
      usedMessages,
    );

    const candidates = visualCandidatesFor(purpose, items);
    const result: MergeRecompute = {
      title: sectionTitle,
      keyMessage,
      contentIntent: `${a.kind}: ${purpose} — ${items.length} knowledge item(s) (merged)`,
      visualIntent: visualFor(purpose, signals),
      claimRefs,
      sourceRefs: dedupeSourceRefs([
        ...items.flatMap((i) => i.sourceRefs),
        ...claimItems.flatMap((i) => i.sourceRefs),
      ]),
      density: densityFor(knowledgeRefs.length + claimRefs.length),
    };
    if (candidates.length > 0) result.visualCandidates = candidates;
    return result;
  };
}

export function buildSlidePlan(
  knowledge: ProjectKnowledge,
  narrative: NarrativePlan,
  options: PlanSlidesOptions = {},
): SlidePlan {
  const view = buildKnowledgeView(knowledge);
  const profile = getAudienceProfile(narrative.audience);
  const decisions: PlanningDecision[] = [];
  const notes: PlanningNote[] = [];
  const budget = normalizeBudget(options, notes);
  const mint = new IdMint();

  const built: PlannedSlide[] = [];
  const usedMessages = new Set<string>();
  let order = 0;

  const openingSection = narrative.sections.find((s) => s.id === "sec-opening");
  const closingSection = narrative.sections.find((s) => s.id === "sec-closing");

  // ---- cover -------------------------------------------------------------
  {
    const id = mint.mint("slide-cover");
    const title = view.knowledge.project.name.trim();
    const keyMessage = coverKeyMessage(view, narrative.throughline);
    const slide: PlannedSlide = {
      id,
      index: order,
      sectionId: openingSection?.id ?? "sec-opening",
      kind: "cover",
      title,
      keyMessage: finalizeMessage(keyMessage, title, title, "sec-opening", [], usedMessages),
      narrativePurpose: "context",
      knowledgeRefs: openingSection?.knowledgeRefs ?? [view.projectId],
      claimRefs: [],
      sourceRefs: dedupeSourceRefs(view.knowledge.project.sourceRefs ?? []),
      contentIntent: `open the deck on ${title}`,
      visualIntent: "none",
      density: "low",
      priority: openingSection?.priority ?? 1,
    };
    built.push(slide);
    order += 1;
    decisions.push({
      code: "slide-added",
      slideId: id,
      sectionId: slide.sectionId,
      decision: `add cover "${title}"`,
      reason: "every deck opens on the project and its throughline",
    });
  }

  // ---- content sections ------------------------------------------------
  for (const section of narrative.sections) {
    if (section.id === "sec-opening" || section.id === "sec-closing") continue;
    order = buildSectionSlides(
      section,
      view,
      narrative,
      mint,
      built,
      decisions,
      usedMessages,
      order,
      profile,
    );
  }

  // ---- closing --------------------------------------------------------
  {
    const id = mint.mint("slide-closing");
    const refIds = closingSection?.knowledgeRefs ?? [];
    const refItems = resolveItems(view, refIds);
    const claimRefs = collectClaimRefs(view, refItems);
    const slide: PlannedSlide = {
      id,
      index: order,
      sectionId: closingSection?.id ?? "sec-closing",
      kind: "closing",
      title: "Next",
      keyMessage: finalizeMessage(
        closingKeyMessage(view, profile),
        "Next",
        "Close",
        "sec-closing",
        refItems,
        usedMessages,
      ),
      narrativePurpose: closingSection?.narrativePurpose ?? "next-steps",
      knowledgeRefs: refIds,
      claimRefs,
      sourceRefs: dedupeSourceRefs([
        ...refItems.flatMap((i) => i.sourceRefs),
        ...resolveItems(view, claimRefs).flatMap((i) => i.sourceRefs),
      ]),
      contentIntent: "close on the next concrete move",
      visualIntent: "none",
      density: densityFor(refIds.length + claimRefs.length),
      priority: closingSection?.priority ?? 999,
    };
    built.push(slide);
    order += 1;
    decisions.push({
      code: "slide-added",
      slideId: id,
      sectionId: slide.sectionId,
      decision: "add closing",
      reason: `closing emphasis: ${profile.closingEmphasis.join(", ")}`,
    });
  }

  const merge = createSemanticMerge(knowledge, narrative, usedMessages);
  const slides = applyBudget(built, budget, decisions, notes, merge);

  const planNoMeta: Omit<SlidePlan, "meta" | "knowledgeHash"> = {
    planVersion: SLIDE_PLAN_VERSION,
    audience: narrative.audience,
    ...(narrative.deckType !== undefined ? { deckType: narrative.deckType } : {}),
    narrativeRef: narrativeContentHash(narrative),
    budget,
    targetSlideCount: budget.targetSlides,
    slides,
    decisions,
    notes,
  };

  const plan: SlidePlan = {
    ...planNoMeta,
    meta: { generator: GENERATOR, contentHash: contentHash(planNoMeta) },
  };
  const knowledgeHash = narrative.knowledgeHash ?? knowledge.meta?.contentHash;
  if (knowledgeHash) plan.knowledgeHash = knowledgeHash;
  return plan;
}

function buildSectionSlides(
  section: NarrativePlanSection,
  view: KnowledgeView,
  narrative: NarrativePlan,
  mint: IdMint,
  out: PlannedSlide[],
  decisions: PlanningDecision[],
  usedMessages: Set<string>,
  startOrder: number,
  profile: ReturnType<typeof getAudienceProfile>,
): number {
  let order = startOrder;
  const refIds = section.knowledgeRefs;
  // Lean audiences (executive, client, …) keep one slide per section; denser
  // ones may split a wide section into two parts.
  const canSplit = profile.narrativeDensity !== "lean" && refIds.length > SPLIT_THRESHOLD;
  const parts: Id[][] = canSplit ? splitInHalf(refIds) : [refIds];
  const base = `slide-${section.id.replace(/^sec-/, "")}`;

  parts.forEach((part, partIndex) => {
    const items = resolveItems(view, part);
    const signals = signalsOf(items);
    const kind = kindFor(section.narrativePurpose, signals);
    const visualIntent = visualFor(section.narrativePurpose, signals);
    const title =
      parts.length > 1 ? `${section.title} (${partIndex + 1}/${parts.length})` : section.title;
    const rawMessage = keyMessageFor(section.narrativePurpose, view, items);
    const keyMessage = finalizeMessage(
      rawMessage,
      title,
      section.title,
      section.id,
      items,
      usedMessages,
    );
    const claimRefs = collectClaimRefs(view, items);
    const claimItems = resolveItems(view, claimRefs);
    const candidates = visualCandidatesFor(section.narrativePurpose, items);

    const slide: PlannedSlide = {
      id: mint.mint(parts.length > 1 ? `${base}-${partIndex + 1}` : base),
      index: order,
      sectionId: section.id,
      kind,
      title,
      keyMessage,
      narrativePurpose: section.narrativePurpose,
      knowledgeRefs: part,
      claimRefs,
      sourceRefs: dedupeSourceRefs([
        ...items.flatMap((i) => i.sourceRefs),
        ...claimItems.flatMap((i) => i.sourceRefs),
      ]),
      contentIntent: `${kind}: ${section.narrativePurpose} — ${items.length} knowledge item(s)`,
      visualIntent,
      density: densityFor(part.length + claimRefs.length),
      priority: section.priority,
    };
    if (candidates.length > 0) slide.visualCandidates = candidates;
    out.push(slide);
    order += 1;

    decisions.push({
      code: "slide-added",
      slideId: slide.id,
      sectionId: section.id,
      decision: `add "${title}"`,
      reason: `section "${section.title}" carries ${part.length} knowledge ref(s)`,
      knowledgeRefs: part.slice(0, 8),
    });
    decisions.push({
      code: "visual-intent-selected",
      slideId: slide.id,
      decision: `visualIntent = ${visualIntent}`,
      reason: `purpose "${section.narrativePurpose}"; metric=${signals.hasMetric}, relation=${signals.hasRelation}, phase/milestone=${signals.hasPhaseOrMilestone}`,
    });
    if (parts.length > 1) {
      decisions.push({
        code: "topic-split",
        slideId: slide.id,
        sectionId: section.id,
        decision: `split "${section.title}" into part ${partIndex + 1}/${parts.length}`,
        reason: `${refIds.length} refs exceed the split threshold of ${SPLIT_THRESHOLD}`,
        knowledgeRefs: part.slice(0, 8),
      });
    }
  });

  return order;
}

function splitInHalf(ids: readonly Id[]): Id[][] {
  const sorted = [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const mid = Math.ceil(sorted.length / 2);
  return [sorted.slice(0, mid), sorted.slice(mid)];
}
