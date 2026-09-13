/**
 * Conservative entity deduplication.
 *
 * Two candidates merge only when they share an explicit `key` OR their names are
 * identical after case/whitespace normalization. Anything more ambiguous
 * ("React" vs "React.js") is kept separate and reported as a near-duplicate so
 * a gap can be raised — Arclume never invents equivalences.
 */

import type { EntityCandidate } from "../analysis/analysis-result.js";

export function normalizeName(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, " ");
}

export function firstToken(name: string): string {
  return (
    normalizeName(name)
      .split(/[\s./_-]+/)
      .filter(Boolean)[0] ?? ""
  );
}

export interface EntityGroup {
  /** The deterministic grouping key (explicit key or `kind|normalized-name`). */
  key: string;
  kind: EntityCandidate["kind"];
  /** Display name from the first member. */
  name: string;
  members: EntityCandidate[];
}

export interface NearDuplicate {
  kind: EntityCandidate["kind"];
  names: string[];
  sharedToken: string;
}

export interface DedupeResult {
  groups: EntityGroup[];
  nearDuplicates: NearDuplicate[];
}

function groupKey(candidate: EntityCandidate): string {
  if (candidate.key && candidate.key.length > 0) return `k:${candidate.key}`;
  return `n:${candidate.kind}|${normalizeName(candidate.name)}`;
}

/**
 * Group candidates deterministically. Input order is preserved for members;
 * groups come out sorted by `key`.
 */
export function dedupeEntities(candidates: readonly EntityCandidate[]): DedupeResult {
  const groups = new Map<string, EntityGroup>();
  for (const candidate of candidates) {
    const key = groupKey(candidate);
    const existing = groups.get(key);
    if (existing) {
      existing.members.push(candidate);
    } else {
      groups.set(key, {
        key,
        kind: candidate.kind,
        name: candidate.name,
        members: [candidate],
      });
    }
  }

  // near-duplicate detection: same kind, same first token, different normalized name
  const byKindToken = new Map<string, Set<string>>();
  for (const group of groups.values()) {
    const token = firstToken(group.name);
    if (token.length < 2) continue;
    const bucketKey = `${group.kind}|${token}`;
    const set = byKindToken.get(bucketKey) ?? new Set<string>();
    set.add(group.name);
    byKindToken.set(bucketKey, set);
  }

  const nearDuplicates: NearDuplicate[] = [];
  for (const [bucketKey, names] of byKindToken) {
    if (names.size < 2) continue;
    const [kind, sharedToken] = bucketKey.split("|") as [EntityCandidate["kind"], string];
    nearDuplicates.push({ kind, sharedToken, names: [...names].sort() });
  }
  nearDuplicates.sort((a, b) =>
    a.kind === b.kind ? (a.sharedToken < b.sharedToken ? -1 : 1) : a.kind < b.kind ? -1 : 1,
  );

  return {
    groups: [...groups.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
    nearDuplicates,
  };
}
