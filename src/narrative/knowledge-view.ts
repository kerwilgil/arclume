/**
 * A normalized, indexed, read-only view over a `ProjectKnowledge`.
 *
 * Every collection is re-sorted here (by id; relations by `from,to,id`) so the
 * planners never depend on the insertion order of the input — two semantically
 * equivalent `ProjectKnowledge` objects yield the same view and therefore the
 * same plan.
 */

import type { FactType, Id, SourceRef } from "../types/common.js";
import type { KnowledgeCollectionName, ProjectKnowledge } from "../types/knowledge.js";
import { KNOWLEDGE_COLLECTIONS } from "../types/knowledge.js";

/** Collections that carry planning-relevant items (everything except pure edges is still included). */
export const PLANNABLE_COLLECTIONS: readonly KnowledgeCollectionName[] = KNOWLEDGE_COLLECTIONS;

export interface KnowledgeItem {
  id: Id;
  collection: KnowledgeCollectionName;
  /** Primary display text: `name` | `statement` | `question` | a relation phrase. */
  text: string;
  /** Epistemic status, when the entity has one (risks, claims). */
  factType?: FactType;
  sourceRefs: SourceRef[];
  /** The raw entity, for callers that need collection-specific fields. */
  raw: Record<string, unknown>;
}

export interface KnowledgeView {
  knowledge: ProjectKnowledge;
  /** Every item, keyed by id. */
  byId: Map<Id, KnowledgeItem>;
  /** Items per collection, each list sorted by id. */
  byCollection: Map<KnowledgeCollectionName, KnowledgeItem[]>;
  /** Known `sources[].id` values. */
  sourceIds: Set<Id>;
  /** The project entity's id. */
  projectId: Id;
}

function textOf(collection: KnowledgeCollectionName, raw: Record<string, unknown>): string {
  if (collection === "relations") {
    const label = typeof raw["label"] === "string" ? raw["label"] : "";
    const phrase = `${String(raw["from"])} ${String(raw["type"])} ${String(raw["to"])}`;
    return label ? `${label} (${phrase})` : phrase;
  }
  for (const key of ["name", "statement", "question"] as const) {
    const v = raw[key];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return String(raw["id"] ?? "");
}

function sortIds<T extends { id: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function sortRelations<T extends { id: string; from: string; to: string }>(
  items: readonly T[],
): T[] {
  return [...items].sort((a, b) => {
    if (a.from !== b.from) return a.from < b.from ? -1 : 1;
    if (a.to !== b.to) return a.to < b.to ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

export function buildKnowledgeView(knowledge: ProjectKnowledge): KnowledgeView {
  const byId = new Map<Id, KnowledgeItem>();
  const byCollection = new Map<KnowledgeCollectionName, KnowledgeItem[]>();

  for (const collection of KNOWLEDGE_COLLECTIONS) {
    const rawList = (knowledge[collection] ?? []) as unknown as Array<Record<string, unknown>>;
    const sorted =
      collection === "relations"
        ? (sortRelations(
            rawList as unknown as Array<{ id: string; from: string; to: string }>,
          ) as unknown as Array<Record<string, unknown>>)
        : (sortIds(rawList as unknown as Array<{ id: string }>) as unknown as Array<
            Record<string, unknown>
          >);
    const items: KnowledgeItem[] = [];
    for (const raw of sorted) {
      const id = String(raw["id"] ?? "");
      if (id === "") continue;
      const item: KnowledgeItem = {
        id,
        collection,
        text: textOf(collection, raw),
        sourceRefs: Array.isArray(raw["sourceRefs"]) ? (raw["sourceRefs"] as SourceRef[]) : [],
        raw,
      };
      if (typeof raw["factType"] === "string") item.factType = raw["factType"] as FactType;
      items.push(item);
      byId.set(id, item);
    }
    byCollection.set(collection, items);
  }

  const sourceIds = new Set<Id>((knowledge.sources ?? []).map((s) => s.id));

  return { knowledge, byId, byCollection, sourceIds, projectId: knowledge.project.id };
}

/** First sentence of `text`, whitespace-collapsed and length-capped. `undefined` for empty input. */
export function firstSentence(text: string | undefined, max = 220): string | undefined {
  if (typeof text !== "string") return undefined;
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length === 0) return undefined;
  const m = /^(.+?[.!?])(\s|$)/.exec(flat);
  const sentence = m ? (m[1] as string) : flat;
  if (sentence.length <= max) return sentence;
  return `${sentence.slice(0, max - 1).trimEnd()}…`;
}

/** Join up to `max` phrases as "a, b and c", noting the remainder. */
export function phraseList(phrases: readonly string[], max = 3): string {
  const clean = phrases.map((p) => p.replace(/\s+/g, " ").trim()).filter((p) => p.length > 0);
  if (clean.length === 0) return "";
  const shown = clean.slice(0, max);
  const rest = clean.length - shown.length;
  let joined: string;
  if (shown.length === 1) joined = shown[0] as string;
  else joined = `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
  return rest > 0 ? `${joined} (+${rest} more)` : joined;
}
