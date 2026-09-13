/**
 * NarrativePlanner: `ProjectKnowledge` + audience → `NarrativePlan`.
 *
 * Deterministic. No LLM, no Reasoner, no clock, no RNG, no network. It selects,
 * orders, groups and references knowledge — it never invents any. Sections that
 * the knowledge cannot support drop themselves (with an explaining decision);
 * no empty obligatory slides are produced.
 */

import { contentHash } from "../determinism/hash.js";
import type { Id } from "../types/common.js";
import type { ProjectEntity, ProjectKnowledge } from "../types/knowledge.js";
import { NARRATIVE_VERSION } from "../version.js";
import { type DeckTypeName, getDeckTypeProfile } from "./deck-types.js";
import {
  type KnowledgeView,
  buildKnowledgeView,
  firstSentence,
  phraseList,
} from "./knowledge-view.js";
import { type AudienceProfile, getAudienceProfile } from "./presets/index.js";
import type { ProjectField, SectionTemplate } from "./presets/types.js";
import { type SelectorResult, selectKnowledge } from "./selector.js";
import type {
  AudienceName,
  NarrativePlan,
  NarrativePlanSection,
  OmittedKnowledge,
  PlanningDecision,
  PlanningNote,
} from "./types.js";

export interface PlanNarrativeOptions {
  /** Defaults to `"general"`. */
  audience?: AudienceName;
  /**
   * Optional deck-type arc (e.g. `architecture-review`, `executive-brief`).
   * Independent of the audience: the audience still governs selection density,
   * terminology and evidence visibility; the deck type governs the section arc.
   */
  deckType?: DeckTypeName;
}

const GENERATOR = "arclume-narrative-planner@0.1.0";
const MAX_REFS_PER_SECTION = 16;

function projectHasField(project: ProjectEntity, field: ProjectField): boolean {
  if (field === "nextSteps") {
    return Array.isArray(project.nextSteps) && project.nextSteps.length > 0;
  }
  const v = (project as unknown as Record<string, unknown>)[field];
  return typeof v === "string" && v.trim().length > 0;
}

function resolveTemplateRefs(
  view: KnowledgeView,
  sel: SelectorResult,
  template: SectionTemplate,
): Id[] {
  const out: Id[] = [];
  const seen = new Set<Id>();
  const spec = template.sources;

  if (spec.projectFields?.some((f) => projectHasField(view.knowledge.project, f))) {
    out.push(view.projectId);
    seen.add(view.projectId);
  }

  const keyword = spec.keyword ? new RegExp(spec.keyword, "i") : undefined;
  for (const collection of spec.collections ?? []) {
    for (const item of view.byCollection.get(collection) ?? []) {
      if (seen.has(item.id)) continue;
      if (!(sel.selected.has(item.id) || sel.deprioritized.has(item.id))) continue;
      if (
        collection === "claims" &&
        spec.claimFactTypes &&
        !(item.factType && spec.claimFactTypes.includes(item.factType))
      ) {
        continue;
      }
      if (keyword && !keyword.test(item.text)) continue;
      seen.add(item.id);
      out.push(item.id);
      if (out.length >= MAX_REFS_PER_SECTION) return out;
    }
  }
  return out;
}

function deriveThroughline(view: KnowledgeView): string {
  const p = view.knowledge.project;
  const name = p.name.trim();
  const lead = firstSentence(p.purpose) ?? firstSentence(p.solution) ?? firstSentence(p.summary);
  if (lead) return cap(`${name} — ${lead}`);

  const caps = view.byCollection.get("capabilities") ?? [];
  if (caps.length > 0)
    return cap(
      `${name} delivers ${phraseList(
        caps.map((c) => c.text),
        2,
      )}.`,
    );

  const problem = firstSentence(p.problem);
  if (problem) return cap(`${name} exists to address: ${problem}`);

  const gaps = view.byCollection.get("gaps") ?? [];
  if (gaps.length > 0) {
    return `${name} — scope is still being defined; ${gaps.length} open question(s) remain.`;
  }
  const status = firstSentence(p.status);
  if (status) return cap(`${name} — ${status}`);
  return name;
}

function cap(text: string, max = 400): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

function closingNarrativePurpose(
  closingEmphasis: AudienceProfile["closingEmphasis"],
): NarrativePlanSection["narrativePurpose"] {
  const first = closingEmphasis[0];
  if (first === "roadmap") return "roadmap";
  if (first === "recommendations") return "call-to-action";
  return "next-steps";
}

function closingRefs(
  view: KnowledgeView,
  closingEmphasis: AudienceProfile["closingEmphasis"],
): Id[] {
  for (const emphasis of closingEmphasis) {
    if (emphasis === "next-steps" && projectHasField(view.knowledge.project, "nextSteps")) {
      return [view.projectId];
    }
    if (emphasis === "roadmap") {
      const phases = (view.byCollection.get("phases") ?? []).map((i) => i.id);
      if (phases.length > 0) return phases.slice(0, 8);
    }
    if (emphasis === "open-decisions") {
      const open = (view.byCollection.get("decisions") ?? [])
        .filter((d) => d.raw["status"] === "proposed")
        .map((d) => d.id);
      if (open.length > 0) return open.slice(0, 8);
    }
    if (emphasis === "gaps") {
      const gaps = (view.byCollection.get("gaps") ?? []).map((g) => g.id);
      if (gaps.length > 0) return gaps.slice(0, 8);
    }
  }
  return [];
}

/** The narrative arc — section order, objective template and closing emphasis. */
interface NarrativeArc {
  objectiveTemplate: string;
  sections: readonly SectionTemplate[];
  closingEmphasis: AudienceProfile["closingEmphasis"];
}

/**
 * Compute the effective narrative arc. When a `deckType` is set its arc is the
 * primary structure; otherwise the audience's own arc applies. The audience's
 * `weights` (selection) and `evidenceVisibility` apply either way — the deck
 * type is composition, not replacement.
 */
function resolveArc(audience: AudienceProfile, deckType: DeckTypeName | undefined): NarrativeArc {
  if (deckType === undefined) {
    return {
      objectiveTemplate: audience.objectiveTemplate,
      sections: audience.sections,
      closingEmphasis: audience.closingEmphasis,
    };
  }
  const deck = getDeckTypeProfile(deckType);
  return {
    objectiveTemplate: deck.objectiveTemplate,
    sections: deck.sections,
    closingEmphasis: deck.closingEmphasis,
  };
}

function sortById(ids: Iterable<Id>): Id[] {
  return [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export function buildNarrativePlan(
  knowledge: ProjectKnowledge,
  options: PlanNarrativeOptions = {},
): NarrativePlan {
  const audience: AudienceName = options.audience ?? "general";
  const profile = getAudienceProfile(audience);
  const arc = resolveArc(profile, options.deckType);
  const view = buildKnowledgeView(knowledge);
  const sel = selectKnowledge(view, profile);

  const decisions: PlanningDecision[] = [];
  const notes: PlanningNote[] = [];
  const name = view.knowledge.project.name.trim();

  const throughline = deriveThroughline(view);
  decisions.push({
    code: "throughline-derived",
    decision: "set the narrative throughline",
    reason: "derived from the project's purpose / solution / capabilities in the knowledge",
  });
  if (options.deckType !== undefined) {
    decisions.push({
      code: "arc-composed",
      decision: `apply deck-type arc "${options.deckType}"`,
      reason: `audience "${audience}" selects knowledge and density; the deck type fixes the section arc`,
    });
  }

  const objective = cap(arc.objectiveTemplate.replace(/\{project\}/g, name), 600);

  const sections: NarrativePlanSection[] = [];

  sections.push({
    id: "sec-opening",
    title: name,
    purpose: cap(`Open on ${name} and the value it delivers.`, 600),
    narrativePurpose: "context",
    priority: 1,
    knowledgeRefs: [view.projectId],
  });

  let priority = 2;
  for (const template of arc.sections) {
    const refs = resolveTemplateRefs(view, sel, template);
    const min = template.sources.minRefs ?? 1;
    if (refs.length >= min || template.required) {
      const section: NarrativePlanSection = {
        id: `sec-${template.id}`,
        title: template.title,
        purpose: cap(template.purpose.replace(/\{project\}/g, name), 600),
        narrativePurpose: template.narrativePurpose,
        priority,
        knowledgeRefs: refs,
      };
      if (template.transitionIntent) section.transitionIntent = template.transitionIntent;
      sections.push(section);
      decisions.push({
        code: "section-added",
        sectionId: section.id,
        decision: `include "${template.title}"`,
        reason: `${refs.length} supporting knowledge item(s)`,
        knowledgeRefs: refs.slice(0, 8),
      });
      priority += 1;
    } else {
      decisions.push({
        code: "section-omitted",
        sectionId: `sec-${template.id}`,
        decision: `drop "${template.title}"`,
        reason:
          refs.length === 0
            ? "no supporting knowledge for this audience"
            : `only ${refs.length} supporting item(s); minimum is ${min}`,
      });
      if (template.narrativePurpose === "architecture") {
        notes.push({
          code: "narrative/architecture-unsupported",
          message: `"${template.title}" dropped: not enough components + relations to justify an architecture section`,
          severity: "info",
        });
      }
    }
  }

  const closing: NarrativePlanSection = {
    id: "sec-closing",
    title: "Close",
    purpose: cap(`Leave the audience with the next move for ${name}.`, 600),
    narrativePurpose: closingNarrativePurpose(arc.closingEmphasis),
    priority,
    knowledgeRefs: closingRefs(view, arc.closingEmphasis),
  };
  sections.push(closing);
  decisions.push({
    code: "closing-derived",
    sectionId: closing.id,
    decision: "build the closing from real next-step knowledge",
    reason: `closing emphasis order: ${arc.closingEmphasis.join(", ")}`,
    knowledgeRefs: closing.knowledgeRefs.slice(0, 8),
  });

  sections.sort((a, b) => a.priority - b.priority || (a.id < b.id ? -1 : 1));

  // ---- final selection: "selected" == landed in a section ------------------
  const used = new Set<Id>();
  for (const s of sections) for (const id of s.knowledgeRefs) used.add(id);
  used.delete(view.projectId); // the project entity is always present, not a "selection"

  const finalSelected = sortById(used);
  const reserve = new Set<Id>();
  for (const id of sel.selected) if (!used.has(id)) reserve.add(id);
  for (const id of sel.deprioritized) if (!used.has(id)) reserve.add(id);
  const finalDeprioritized = sortById(reserve);

  for (const id of sel.selected) {
    if (!used.has(id)) {
      decisions.push({
        code: "knowledge-unplaced",
        decision: "hold relevant knowledge in reserve",
        reason: "no section in this narrative had room for it at the current audience shape",
        knowledgeRefs: [id],
      });
    }
  }

  const omitted: OmittedKnowledge[] = [...sel.omitted.entries()]
    .filter(([id]) => !used.has(id))
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([id, reason]) => ({ id, reason }));

  const planNoMeta: Omit<NarrativePlan, "meta"> = {
    narrativeVersion: NARRATIVE_VERSION,
    audience,
    ...(options.deckType !== undefined ? { deckType: options.deckType } : {}),
    objective,
    throughline,
    sections,
    selection: { selected: finalSelected, deprioritized: finalDeprioritized, omitted },
    decisions,
    notes,
  };

  const plan: NarrativePlan = {
    ...planNoMeta,
    meta: { generator: GENERATOR, contentHash: contentHash(planNoMeta) },
  };
  const knowledgeHash = knowledge.meta?.contentHash;
  if (knowledgeHash) plan.knowledgeHash = knowledgeHash;
  return plan;
}

/** `contentHash` of a narrative plan with `meta` stripped — the value used as `SlidePlan.narrativeRef`. */
export function narrativeContentHash(plan: NarrativePlan): string {
  const { meta: _meta, knowledgeHash: _kh, ...rest } = plan;
  return contentHash(rest);
}
