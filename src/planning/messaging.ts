/**
 * Deterministic key-message derivation.
 *
 * Every function here turns *already-selected* knowledge into one short, backed
 * sentence. It never invents a fact: when the specific knowledge is missing it
 * falls back to a factual statement about what *is* present (counts, ids).
 */

import type { KnowledgeItem, KnowledgeView } from "../narrative/knowledge-view.js";
import { firstSentence, phraseList } from "../narrative/knowledge-view.js";
import type { AudienceProfile } from "../narrative/presets/types.js";
import type { NarrativePurpose } from "../narrative/types.js";
import type { ProjectEntity } from "../types/knowledge.js";

const MAX_MESSAGE = 220;

const COLLECTION_LABEL: Record<string, string> = {
  capabilities: "capability",
  components: "component",
  actors: "actor",
  dependencies: "dependency",
  processes: "process",
  phases: "phase",
  milestones: "milestone",
  metrics: "metric",
  risks: "risk",
  decisions: "decision",
  requirements: "requirement",
  technologies: "technology",
  results: "result",
  constraints: "constraint",
  relations: "relation",
  claims: "claim",
  gaps: "open question",
};

export function normalizeMessage(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/** A short factual summary of `items`, keyed on their dominant collection. `""` when empty. */
export function summarizeItems(items: readonly KnowledgeItem[]): string {
  if (items.length === 0) return "";
  const byColl = group(items);
  let best: [string, KnowledgeItem[]] | undefined;
  for (const entry of [...byColl.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (!best || entry[1].length > best[1].length) best = entry;
  }
  const [coll, list] = best as [string, KnowledgeItem[]];
  const label = COLLECTION_LABEL[coll] ?? coll;
  return `${list.length} ${label}${list.length === 1 ? "" : "s"} — ${phraseList(
    list.map((i) => i.text),
    3,
  )}`;
}

function cap(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const withPeriod = /[.!?]$/.test(flat) ? flat : `${flat}.`;
  const first = withPeriod.charAt(0).toUpperCase() + withPeriod.slice(1);
  return first.length <= MAX_MESSAGE ? first : `${first.slice(0, MAX_MESSAGE - 1).trimEnd()}…`;
}

function rank(level: unknown): number {
  if (level === "high") return 3;
  if (level === "medium") return 2;
  if (level === "low") return 1;
  return 0;
}

function group(items: readonly KnowledgeItem[]): Map<string, KnowledgeItem[]> {
  const m = new Map<string, KnowledgeItem[]>();
  for (const it of items) {
    const arr = m.get(it.collection) ?? [];
    arr.push(it);
    m.set(it.collection, arr);
  }
  return m;
}

function metricSentence(m: KnowledgeItem): string {
  const value = String(m.raw["value"] ?? "");
  const unit = typeof m.raw["unit"] === "string" ? ` ${m.raw["unit"]}` : "";
  const baseline = typeof m.raw["baseline"] === "string" ? ` (was ${m.raw["baseline"]})` : "";
  return cap(`${m.text} is now ${value}${unit}${baseline}`);
}

function processSentence(p: KnowledgeItem): string {
  const steps = Array.isArray(p.raw["steps"]) ? (p.raw["steps"] as Array<{ label?: unknown }>) : [];
  const labels = steps.map((s) => String(s.label ?? "")).filter((s) => s.length > 0);
  const outcome =
    typeof p.raw["outcome"] === "string" ? firstSentence(p.raw["outcome"]) : undefined;
  if (labels.length === 0) return cap(p.text);
  const chain = labels.slice(0, 6).join(" → ");
  return cap(`${p.text}: ${chain}${outcome ? ` → ${outcome}` : ""}`);
}

/** Build the one key message for a content slide of the given narrative purpose. */
export function keyMessageFor(
  purpose: NarrativePurpose,
  view: KnowledgeView,
  refItems: readonly KnowledgeItem[],
): string {
  const p = view.knowledge.project;
  const name = p.name.trim();
  const g = group(refItems);
  const get = (c: string): KnowledgeItem[] => g.get(c) ?? [];

  switch (purpose) {
    case "context": {
      return firstSentence(p.purpose ?? p.summary)
        ? cap(firstSentence(p.purpose ?? p.summary) as string)
        : cap(`${name} is described across ${refItems.length} knowledge item(s)`);
    }
    case "problem":
      return firstSentence(p.problem)
        ? cap(firstSentence(p.problem) as string)
        : cap(`The problem ${name} addresses is documented in ${refItems.length} item(s)`);
    case "solution": {
      const s = firstSentence(p.solution);
      if (s) return cap(s);
      const proc = get("processes")[0];
      return proc
        ? processSentence(proc)
        : cap(`${name}'s approach spans ${refItems.length} documented element(s)`);
    }
    case "impact":
    case "evidence": {
      const metric = get("metrics").find((m) => typeof m.raw["value"] === "string");
      if (metric) return metricSentence(metric);
      const results = get("results");
      if (results.length > 0)
        return cap(
          phraseList(
            results.map((r) => r.text),
            3,
          ),
        );
      const fact = get("claims").find((c) => c.factType === "FACT");
      if (fact) return cap(fact.text);
      return cap(`${refItems.length} result(s) recorded for ${name}`);
    }
    case "capability": {
      const caps = get("capabilities");
      if (caps.length > 0) {
        return cap(
          `${name} provides ${caps.length} capabilit${caps.length === 1 ? "y" : "ies"}: ${phraseList(
            caps.map((c) => c.text),
            3,
          )}`,
        );
      }
      return cap(`${name} capabilities are documented in ${refItems.length} item(s)`);
    }
    case "architecture": {
      const comps = get("components");
      const rels = get("relations");
      const deps = get("dependencies");
      if (comps.length > 0 && rels.length > 0) {
        return cap(
          `${comps.length} component${comps.length === 1 ? "" : "s"} (${phraseList(
            comps.map((c) => c.text),
            3,
          )}) linked by ${rels.length} relation${rels.length === 1 ? "" : "s"}`,
        );
      }
      if (comps.length > 0) {
        return cap(
          `${comps.length} component${comps.length === 1 ? "" : "s"}: ${phraseList(
            comps.map((c) => c.text),
            4,
          )}`,
        );
      }
      if (deps.length > 0)
        return cap(
          `${name} depends on ${phraseList(
            deps.map((d) => d.text),
            3,
          )}`,
        );
      return cap(`${name} structure is documented in ${refItems.length} item(s)`);
    }
    case "process": {
      const procs = get("processes");
      const withSteps = procs.find(
        (pr) => Array.isArray(pr.raw["steps"]) && (pr.raw["steps"] as unknown[]).length > 0,
      );
      if (withSteps) return processSentence(withSteps);
      if (procs.length > 0) {
        return cap(
          `${procs.length} process(es) documented: ${phraseList(
            procs.map((pr) => pr.text),
            3,
          )}`,
        );
      }
      return firstSentence(p.solution)
        ? cap(firstSentence(p.solution) as string)
        : cap(`How ${name} works is documented in ${refItems.length} item(s)`);
    }
    case "risk": {
      const risks = get("risks");
      if (risks.length > 0) {
        const top = [...risks].sort(
          (a, b) =>
            rank(b.raw["impact"]) * 2 +
            rank(b.raw["likelihood"]) -
            (rank(a.raw["impact"]) * 2 + rank(a.raw["likelihood"])),
        )[0] as KnowledgeItem;
        return cap(
          `${risks.length} risk${risks.length === 1 ? "" : "s"} tracked; top: ${top.text} (likelihood ${String(
            top.raw["likelihood"] ?? "unknown",
          )}, impact ${String(top.raw["impact"] ?? "unknown")})`,
        );
      }
      const gaps = get("gaps");
      if (gaps.length > 0) {
        return cap(
          `${gaps.length} open question(s): ${phraseList(
            gaps.map((x) => x.text),
            2,
          )}`,
        );
      }
      const other = [...get("requirements"), ...get("constraints"), ...get("claims")];
      if (other.length > 0) {
        return cap(
          `Security-related knowledge: ${phraseList(
            other.map((o) => o.text),
            2,
          )}`,
        );
      }
      return cap(`${refItems.length} risk-related item(s) documented`);
    }
    case "roadmap": {
      const phases = get("phases");
      if (phases.length > 0) {
        const done = phases.filter((ph) => ph.raw["status"] === "done").length;
        const next =
          phases.find((ph) => ph.raw["status"] === "active") ??
          phases.find((ph) => ph.raw["status"] === "planned");
        return cap(
          `${done} of ${phases.length} phase${phases.length === 1 ? "" : "s"} complete${
            next ? `; current focus: ${next.text}` : ""
          }`,
        );
      }
      const ms = get("milestones");
      if (ms.length > 0) {
        const hit = ms.filter((m) => m.raw["achieved"] === true).length;
        return cap(`${hit}/${ms.length} milestone(s) reached`);
      }
      if (Array.isArray(p.nextSteps) && p.nextSteps.length > 0) {
        return cap(`Next: ${phraseList(p.nextSteps, 3)}`);
      }
      return cap(`Roadmap is documented in ${refItems.length} item(s)`);
    }
    case "status": {
      const s = firstSentence(p.status);
      if (s) return cap(s);
      const phases = get("phases");
      if (phases.length > 0) {
        const active = phases.find((ph) => ph.raw["status"] === "active");
        const done = phases.filter((ph) => ph.raw["status"] === "done").length;
        return active
          ? cap(`Currently in the ${active.text} phase`)
          : cap(`${done}/${phases.length} phase(s) complete`);
      }
      const gaps = get("gaps");
      if (gaps.length > 0) return cap(`${gaps.length} open question(s) still limit confidence`);
      return cap(`Status of ${name} is documented in ${refItems.length} item(s)`);
    }
    case "next-steps": {
      if (Array.isArray(p.nextSteps) && p.nextSteps.length > 0) {
        return cap(`Next: ${phraseList(p.nextSteps, 3)}`);
      }
      const open = get("decisions").filter((d) => d.raw["status"] === "proposed");
      if (open.length > 0) {
        return cap(
          `Open decision(s): ${phraseList(
            open.map((d) => d.text),
            2,
          )}`,
        );
      }
      const gaps = get("gaps");
      if (gaps.length > 0) {
        return cap(
          `Open question(s): ${phraseList(
            gaps.map((x) => x.text),
            2,
          )}`,
        );
      }
      return cap(`Next steps for ${name} are still being defined`);
    }
    case "summary": {
      const s = firstSentence(p.purpose ?? p.solution ?? p.summary);
      return s
        ? cap(`${name}: ${s}`)
        : cap(`${name}: ${refItems.length} points established across the deck`);
    }
    case "call-to-action":
      return firstSentence(p.status)
        ? cap(firstSentence(p.status) as string)
        : cap(`Consider the next move for ${name}`);
    default:
      return cap(`${refItems.length} item(s) documented for ${name}`);
  }
}

/** Key message for the cover slide — the throughline, unless it is just the name. */
export function coverKeyMessage(view: KnowledgeView, throughline: string): string {
  const name = view.knowledge.project.name.trim();
  if (normalizeMessage(throughline) !== normalizeMessage(name)) return cap(throughline);
  const documented =
    (view.byCollection.get("capabilities")?.length ?? 0) +
    (view.byCollection.get("components")?.length ?? 0) +
    (view.byCollection.get("processes")?.length ?? 0);
  return cap(`${name}: ${documented} documented element(s)`);
}

/** Key message for the closing slide, following the audience's emphasis order. */
export function closingKeyMessage(view: KnowledgeView, profile: AudienceProfile): string {
  const p: ProjectEntity = view.knowledge.project;
  const name = p.name.trim();
  for (const emphasis of profile.closingEmphasis) {
    if (emphasis === "next-steps" && Array.isArray(p.nextSteps) && p.nextSteps.length > 0) {
      return cap(`Next: ${phraseList(p.nextSteps, 3)}`);
    }
    if (emphasis === "roadmap") {
      const phases = view.byCollection.get("phases") ?? [];
      if (phases.length > 0) {
        const done = phases.filter((ph) => ph.raw["status"] === "done").length;
        return cap(`${done}/${phases.length} phase(s) complete; the roadmap sets what is next`);
      }
    }
    if (emphasis === "recommendations") {
      const recs = (view.byCollection.get("claims") ?? []).filter(
        (c) => c.factType === "RECOMMENDATION",
      );
      if (recs.length > 0)
        return cap(
          `Recommended: ${phraseList(
            recs.map((r) => r.text),
            2,
          )}`,
        );
    }
    if (emphasis === "open-decisions") {
      const open = (view.byCollection.get("decisions") ?? []).filter(
        (d) => d.raw["status"] === "proposed",
      );
      if (open.length > 0)
        return cap(
          `Open decision(s): ${phraseList(
            open.map((d) => d.text),
            2,
          )}`,
        );
    }
    if (emphasis === "gaps") {
      const gaps = view.byCollection.get("gaps") ?? [];
      if (gaps.length > 0) {
        return cap(
          `Open question(s): ${phraseList(
            gaps.map((x) => x.text),
            2,
          )}`,
        );
      }
    }
  }
  return firstSentence(p.status)
    ? cap(firstSentence(p.status) as string)
    : cap(`${name}: priorities for the next step are still being defined`);
}
