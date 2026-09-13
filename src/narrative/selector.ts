/**
 * KnowledgeSelector: score every `ProjectKnowledge` item for an audience and
 * split it into `selected` / `deprioritized` / `omitted`, with a reason for
 * every omission. Deterministic — a pure function of the view + the preset.
 *
 * It never creates knowledge. It only decides what is worth telling.
 */

import type { Id } from "../types/common.js";
import type { KnowledgeCollectionName } from "../types/knowledge.js";
import { KNOWLEDGE_COLLECTIONS } from "../types/knowledge.js";
import type { KnowledgeItem, KnowledgeView } from "./knowledge-view.js";
import type { AudienceProfile } from "./presets/types.js";
import type { OmissionReason } from "./types.js";

/** score >= this ⇒ selected; 1..(this-1) ⇒ deprioritized; <= 0 ⇒ omitted. */
const SELECT_THRESHOLD = 3;

export interface SelectorResult {
  selected: Set<Id>;
  deprioritized: Set<Id>;
  omitted: Map<Id, OmissionReason>;
  scores: Map<Id, number>;
}

function rank(level: unknown): number {
  if (level === "high") return 3;
  if (level === "medium") return 2;
  if (level === "low") return 1;
  return 0;
}

function collectionBonus(collection: KnowledgeCollectionName, item: KnowledgeItem): number {
  let bonus = 0;
  if (collection === "metrics" && typeof item.raw["value"] === "string") bonus += 1;
  if (collection === "results") bonus += 1;
  if (collection === "risks") {
    bonus += rank(item.raw["impact"]) >= 2 || rank(item.raw["likelihood"]) >= 2 ? 1 : 0;
  }
  if (collection === "gaps" && item.raw["severity"] === "high") bonus += 1;
  return bonus;
}

function epistemicDelta(item: KnowledgeItem): number {
  switch (item.factType) {
    case "FACT":
      return 2;
    case "UNKNOWN":
      return -1;
    default:
      return 0;
  }
}

export function selectKnowledge(view: KnowledgeView, profile: AudienceProfile): SelectorResult {
  const selected = new Set<Id>();
  const deprioritized = new Set<Id>();
  const omitted = new Map<Id, OmissionReason>();
  const scores = new Map<Id, number>();

  for (const collection of KNOWLEDGE_COLLECTIONS) {
    const weight = profile.weights[collection] ?? 1;
    for (const item of view.byCollection.get(collection) ?? []) {
      if (weight === 0) {
        omitted.set(item.id, "irrelevant-to-audience");
        continue;
      }
      if (collection === "decisions" && item.raw["status"] === "superseded") {
        omitted.set(item.id, "superseded");
        continue;
      }
      let score = weight;
      if (item.sourceRefs.length > 0) score += 1;
      score += epistemicDelta(item);
      score += collectionBonus(collection, item);
      scores.set(item.id, score);

      if (score >= SELECT_THRESHOLD) selected.add(item.id);
      else if (score >= 1) deprioritized.add(item.id);
      else
        omitted.set(
          item.id,
          item.sourceRefs.length === 0 ? "insufficient-evidence" : "low-priority",
        );
    }
  }

  return { selected, deprioritized, omitted, scores };
}
