/**
 * KnowledgeBuilder: `AnalysisResult` -> validated `ProjectKnowledge`.
 *
 * Deterministic given the same `AnalysisResult` + ingested sources/documents.
 * Responsibilities: resolve evidence to `SourceRef`s, derive stable ids,
 * deduplicate entities conservatively, resolve relation / support / gap
 * references (dropping danglers instead of emitting invalid IR), enforce the
 * "no silent FACT" rule by downgrading unsupported FACTs, turn UNKNOWN claims
 * into gaps, order every collection, attach provenance, and finally validate.
 */

import type {
  AnalysisResult,
  ClaimCandidate,
  EntityCandidate,
  EvidenceCandidate,
  GapCandidate,
  RelationCandidate,
} from "../analysis/analysis-result.js";
import { contentHash } from "../determinism/hash.js";
import { KnowledgeBuildError, type PipelineNote, note } from "../errors.js";
import { countLines } from "../ingestion/binary.js";
import type { SourceDocument } from "../ingestion/types.js";
import type { FactType, Id, Source, SourceRef } from "../types/common.js";
import type {
  Actor,
  Capability,
  Component,
  Constraint,
  Decision,
  Dependency,
  Gap,
  Metric,
  Milestone,
  Phase,
  Process,
  ProjectKnowledge,
  Relation,
  Requirement,
  Result,
  Risk,
  Technology,
} from "../types/knowledge.js";
import type { ValidationResult } from "../validation/result.js";
import { formatValidationReport, validateProjectKnowledge } from "../validation/validator.js";
import { KNOWLEDGE_VERSION } from "../version.js";
import { dedupeEntities } from "./dedupe.js";
import { deriveId, slugify } from "./ids.js";

export interface KnowledgeBuilderInput {
  analysis: AnalysisResult;
  sources: readonly Source[];
  documents: readonly SourceDocument[];
  sourceDigest: string;
}

export interface KnowledgeBuilderReport {
  notes: PipelineNote[];
  stats: {
    entities: number;
    relations: number;
    claims: number;
    gaps: number;
    evidenceResolved: number;
    evidenceUnresolved: number;
    factsDowngraded: number;
    relationsDropped: number;
  };
}

export interface KnowledgeBuilderOutput {
  knowledge: ProjectKnowledge;
  report: KnowledgeBuilderReport;
  /** The real result of validating `knowledge` (see step 7). `valid` is always
   *  `true` here — an invalid build throws `KnowledgeBuildError` instead of
   *  returning — but `warnings` carries exactly the warnings that were found. */
  validation: ValidationResult;
}

function oneOf<T extends string>(value: string | undefined, allowed: readonly T[]): T | undefined {
  return value !== undefined && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

class IdMinter {
  #used = new Set<string>();

  mint(prefix: string, ...parts: string[]): string {
    let id = deriveId(prefix, ...parts);
    let n = 2;
    while (this.#used.has(id)) {
      id = deriveId(prefix, ...parts, String(n));
      n += 1;
    }
    this.#used.add(id);
    return id;
  }
}

export function buildProjectKnowledge(input: KnowledgeBuilderInput): KnowledgeBuilderOutput {
  const { analysis, sources } = input;
  const notes: PipelineNote[] = [];
  const minter = new IdMinter();

  const docIndex = new Map<
    string,
    {
      sourceId: string;
      path: string;
      lineCount: number;
      content: string;
      kind: string;
      outline: unknown;
      finalUrl?: string | undefined;
    }
  >();
  for (const doc of input.documents)
    docIndex.set(doc.id, {
      sourceId: doc.sourceId,
      path: doc.path,
      lineCount: countLines(doc.content),
      content: doc.content,
      kind: doc.kind,
      outline: doc.outline,
      finalUrl: doc.metadata.finalUrl,
    });

  let evidenceResolved = 0;
  let evidenceUnresolved = 0;

  const dropEvidence = (code: string, message: string, path: string): void => {
    evidenceUnresolved += 1;
    notes.push(note("KNOWLEDGE_BUILD", code, message, { path }));
  };

  const resolveLocator = (
    doc: {
      sourceId: string;
      path: string;
      kind: string;
      outline: unknown;
      finalUrl?: string | undefined;
    },
    range: { start: number; end: number } | undefined,
  ): { ok: true; locator: NonNullable<SourceRef["locator"]> } | { ok: false } => {
    const fileLocator = {
      kind: "file" as const,
      path: doc.path,
      ...(range ? { lineStart: range.start, lineEnd: range.end } : {}),
    };
    if (range === undefined) {
      // whole document: keep the source anchor for URL documents too
      if (doc.kind === "url" && doc.finalUrl !== undefined) {
        return { ok: true, locator: { kind: "url", url: doc.finalUrl } };
      }
      return { ok: true, locator: fileLocator };
    }
    const outline = doc.outline as { kind?: string; [k: string]: unknown } | undefined;
    if (doc.kind === "pdf" && outline?.kind === "pdf") {
      const pageRanges = outline["pageRanges"] as
        | { page: number; lineStart?: number; lineEnd?: number }[]
        | undefined;
      if (!Array.isArray(pageRanges)) return { ok: false };
      const hit = pageRanges.filter(
        (p) =>
          p.lineStart !== undefined &&
          range.start >= (p.lineStart as number) &&
          range.end <= (p.lineEnd ?? Number.MAX_SAFE_INTEGER),
      );
      if (hit.length === 1) {
        return { ok: true, locator: { kind: "page", page: (hit[0] as { page: number }).page } };
      }
      const pages = pageRanges
        .filter((p) => p.lineStart !== undefined && p.lineEnd !== undefined)
        .filter(
          (p) => !(range.end < (p.lineStart as number) || range.start > (p.lineEnd as number)),
        )
        .map((p) => p.page);
      if (pages.length > 0) {
        const first = Math.min(...pages);
        const last = Math.max(...pages);
        return first === last
          ? { ok: true, locator: { kind: "page", page: first } }
          : { ok: true, locator: { kind: "page", page: first, pageEnd: last } };
      }
      // NEVER invent page 1: an unresolvable mapping is evidence-unreliable.
      return { ok: false };
    }
    if (doc.kind === "docx" && outline?.kind === "docx") {
      const fragments = outline["fragments"] as
        | { anchor: string; lineStart: number; lineEnd: number }[]
        | undefined;
      if (Array.isArray(fragments)) {
        const contained = fragments.filter(
          (f) => range.start >= f.lineStart && range.end <= f.lineEnd,
        );
        if (contained.length === 1) {
          const anchor = contained[0]?.anchor;
          if (anchor !== undefined && anchor !== "") {
            return { ok: true, locator: { kind: "fragment", anchor } };
          }
        }
      }
      return { ok: true, locator: fileLocator }; // multi-fragment keeps file+lines
    }
    if (doc.kind === "url" && outline?.kind === "url") {
      const fragments = outline["fragments"] as
        | { anchor: string; lineStart: number; lineEnd: number }[]
        | undefined;
      if (Array.isArray(fragments) && fragments.length > 0) {
        const contained = fragments.filter(
          (f) => range.start >= f.lineStart && range.end <= f.lineEnd,
        );
        if (contained.length === 1) {
          const anchor = contained[0]?.anchor;
          if (anchor !== undefined && anchor !== "") {
            return { ok: true, locator: { kind: "fragment", anchor } };
          }
        }
      }
      if (doc.finalUrl !== undefined)
        return { ok: true, locator: { kind: "url", url: doc.finalUrl } };
      return { ok: false };
    }
    return { ok: true, locator: fileLocator };
  };

  const resolveEvidence = (candidates: readonly EvidenceCandidate[]): SourceRef[] => {
    const refs: SourceRef[] = [];
    for (const c of candidates) {
      const doc = docIndex.get(c.documentId);
      if (!doc) {
        evidenceUnresolved += 1;
        notes.push(
          note(
            "KNOWLEDGE_BUILD",
            "builder/evidence-unresolved",
            `evidence points at unknown document "${c.documentId}"`,
            {
              hint: "the reasoner cited a documentId that ingestion did not produce",
            },
          ),
        );
        continue;
      }

      // ---- line range: verified against the real document, never "fixed" -----
      const hasStart = typeof c.lineStart === "number";
      const hasEnd = typeof c.lineEnd === "number";
      let range: { start: number; end: number } | undefined;
      if (hasStart || hasEnd) {
        const start = hasStart ? (c.lineStart as number) : (c.lineEnd as number);
        const end = hasEnd ? (c.lineEnd as number) : (c.lineStart as number);
        if (end < start) {
          dropEvidence(
            "builder/evidence-range-invalid",
            `evidence on ${doc.path} has an inverted line range (${start}..${end})`,
            doc.path,
          );
          continue;
        }
        if (start < 1 || end > doc.lineCount) {
          dropEvidence(
            "builder/evidence-out-of-bounds",
            `evidence line range ${start}..${end} falls outside ${doc.path} (${doc.lineCount} line(s))`,
            doc.path,
          );
          continue;
        }
        range = { start, end };
      }

      // ---- quote: must appear verbatim in the cited scope --------------------
      if (c.quote !== undefined && c.quote.length > 0) {
        const scope = range
          ? doc.content
              .split("\n")
              .slice(range.start - 1, range.end)
              .join("\n")
          : doc.content;
        if (!scope.includes(c.quote)) {
          dropEvidence(
            "builder/evidence-quote-mismatch",
            range
              ? `quoted text was not found in ${doc.path} lines ${range.start}..${range.end}`
              : `quoted text was not found in ${doc.path}`,
            doc.path,
          );
          continue;
        }
      }

      const ref: SourceRef = { sourceId: doc.sourceId };
      const resolution = resolveLocator(doc, range);
      if (!resolution.ok) {
        dropEvidence(
          "builder/evidence-pdf-page-unresolved",
          `evidence on ${doc.path} cannot be mapped to a stable locator`,
          doc.path,
        );
        continue;
      }
      ref.locator = resolution.locator;
      if (c.quote !== undefined && c.quote.length > 0) ref.quote = c.quote.slice(0, 2000);
      refs.push(ref);
      evidenceResolved += 1;
    }
    return refs;
  };

  const hasResolvable = (refs: readonly SourceRef[]): boolean => refs.length > 0;

  // ---- entities ----------------------------------------------------------
  const { groups, nearDuplicates } = dedupeEntities(analysis.entities);
  for (const nd of nearDuplicates) {
    notes.push(
      note(
        "KNOWLEDGE_BUILD",
        "builder/near-duplicate",
        `possible duplicate ${nd.kind}: ${nd.names.join(" / ")}`,
        {
          hint: "kept separate; confirm whether these are the same thing",
        },
      ),
    );
  }

  const capabilities: Capability[] = [];
  const components: Component[] = [];
  const actors: Actor[] = [];
  const dependencies: Dependency[] = [];
  const processes: Process[] = [];
  const phases: Phase[] = [];
  const milestones: Milestone[] = [];
  const metrics: Metric[] = [];
  const risks: Risk[] = [];
  const decisions: Decision[] = [];
  const requirements: Requirement[] = [];
  const technologies: Technology[] = [];
  const results: Result[] = [];
  const constraints: Constraint[] = [];
  const gaps: Gap[] = [];

  const keyToId = new Map<string, Id>();
  let factsDowngraded = 0;

  const mergedAttrs = (members: EntityCandidate[]): Record<string, string> => {
    const attrs: Record<string, string> = {};
    for (const m of members) {
      for (const [k, v] of Object.entries(m.attrs ?? {})) {
        if (!(k in attrs)) attrs[k] = v;
      }
    }
    return attrs;
  };

  for (const group of groups) {
    const first = group.members[0] as EntityCandidate;
    const kind = group.kind;
    const name = first.name.trim();
    const attrs = mergedAttrs(group.members);
    const evidence = resolveEvidence(group.members.flatMap((m) => m.evidence));
    const bodyKey = group.key.startsWith("k:") ? group.key.slice(2) : slugify(name);
    const id = minter.mint(kind, bodyKey);
    // the candidate key(s) all map to this id
    for (const m of group.members) {
      keyToId.set(m.key ?? `${m.kind}:${slugify(m.name)}`, id);
    }
    keyToId.set(group.key.startsWith("k:") ? group.key.slice(2) : group.key, id);

    switch (kind) {
      case "capability":
        capabilities.push({ id, name, sourceRefs: evidence });
        break;
      case "component": {
        const c: Component = { id, name, sourceRefs: evidence };
        const ck = oneOf(attrs["kind"], [
          "service",
          "ui",
          "store",
          "job",
          "library",
          "gateway",
          "external",
          "other",
        ] as const);
        if (ck) c.kind = ck;
        components.push(c);
        break;
      }
      case "actor": {
        const a: Actor = { id, name, sourceRefs: evidence };
        const t = oneOf(attrs["type"], ["human", "system", "organization", "other"] as const);
        if (t) a.type = t;
        actors.push(a);
        break;
      }
      case "dependency": {
        const d: Dependency = { id, name, sourceRefs: evidence };
        if (attrs["version"]) d.version = attrs["version"];
        const scope = oneOf(attrs["scope"], [
          "runtime",
          "dev",
          "peer",
          "optional",
          "service",
          "other",
        ] as const);
        if (scope) d.scope = scope;
        if (attrs["ecosystem"]) d.ecosystem = attrs["ecosystem"];
        dependencies.push(d);
        break;
      }
      case "process":
        processes.push({ id, name, sourceRefs: evidence });
        break;
      case "phase": {
        const p: Phase = { id, name, sourceRefs: evidence };
        const s = oneOf(attrs["status"], [
          "planned",
          "active",
          "done",
          "blocked",
          "cancelled",
        ] as const);
        if (s) p.status = s;
        if (attrs["start"]) p.start = attrs["start"];
        if (attrs["end"]) p.end = attrs["end"];
        phases.push(p);
        break;
      }
      case "milestone": {
        const m: Milestone = { id, name, sourceRefs: evidence };
        if (attrs["date"]) m.date = attrs["date"];
        if (attrs["achieved"] === "true") m.achieved = true;
        if (attrs["achieved"] === "false") m.achieved = false;
        milestones.push(m);
        break;
      }
      case "metric": {
        let metricName = name;
        let value: string | undefined = attrs["value"];
        const colon = name.indexOf(": ");
        if (value === undefined && colon > 0) {
          metricName = name.slice(0, colon).trim();
          value = name
            .slice(colon + 2)
            .trim()
            .replace(/\.$/, "");
        }
        const met: Metric = { id, name: metricName, sourceRefs: evidence };
        if (value) met.value = value;
        if (attrs["unit"]) met.unit = attrs["unit"];
        if (attrs["baseline"]) met.baseline = attrs["baseline"];
        metrics.push(met);
        break;
      }
      case "risk": {
        let factType: FactType = first.factType ?? "INFERENCE";
        if (factType === "FACT" && !hasResolvable(evidence)) {
          factType = "INFERENCE";
          factsDowngraded += 1;
          notes.push(
            note(
              "KNOWLEDGE_BUILD",
              "builder/fact-downgraded",
              `risk "${name}" was FACT without evidence; downgraded to INFERENCE`,
            ),
          );
        }
        const r: Risk = { id, statement: name, factType, sourceRefs: evidence };
        const lk = oneOf(attrs["likelihood"], ["low", "medium", "high", "unknown"] as const);
        if (lk) r.likelihood = lk;
        const im = oneOf(attrs["impact"], ["low", "medium", "high", "unknown"] as const);
        if (im) r.impact = im;
        if (attrs["mitigation"]) r.mitigation = attrs["mitigation"];
        risks.push(r);
        break;
      }
      case "decision": {
        const d: Decision = { id, statement: name, sourceRefs: evidence };
        if (attrs["rationale"]) d.rationale = attrs["rationale"];
        if (attrs["date"]) d.date = attrs["date"];
        const st = oneOf(attrs["status"], [
          "proposed",
          "accepted",
          "superseded",
          "rejected",
        ] as const);
        if (st) d.status = st;
        decisions.push(d);
        break;
      }
      case "requirement": {
        const rq: Requirement = { id, statement: name, sourceRefs: evidence };
        const rk = oneOf(attrs["kind"], [
          "functional",
          "non-functional",
          "constraint",
          "assumption",
        ] as const);
        if (rk) rq.kind = rk;
        const pr = oneOf(attrs["priority"], ["must", "should", "could", "wont"] as const);
        if (pr) rq.priority = pr;
        requirements.push(rq);
        break;
      }
      case "technology": {
        const t: Technology = { id, name, sourceRefs: evidence };
        const cat = oneOf(attrs["category"], [
          "language",
          "framework",
          "runtime",
          "database",
          "infra",
          "saas",
          "library",
          "tool",
          "protocol",
          "other",
        ] as const);
        if (cat) t.category = cat;
        technologies.push(t);
        break;
      }
      case "result":
        results.push({ id, statement: name, sourceRefs: evidence });
        break;
      case "constraint": {
        const c: Constraint = { id, statement: name, sourceRefs: evidence };
        const ck = oneOf(attrs["kind"], [
          "technical",
          "business",
          "legal",
          "time",
          "budget",
          "other",
        ] as const);
        if (ck) c.kind = ck;
        constraints.push(c);
        break;
      }
    }
  }

  // ---- project ----------------------------------------------------------
  const projectName = analysis.project.name.trim() || "project";
  const projectId = minter.mint("project", slugify(projectName));
  keyToId.set("project", projectId);
  const project: ProjectKnowledge["project"] = {
    id: projectId,
    name: projectName,
    sourceRefs: resolveEvidence(analysis.project.evidence),
  };
  if (analysis.project.summary) project.summary = analysis.project.summary;
  if (analysis.project.purpose) project.purpose = analysis.project.purpose;
  if (analysis.project.problem) project.problem = analysis.project.problem;
  if (analysis.project.solution) project.solution = analysis.project.solution;
  if (analysis.project.status) project.status = analysis.project.status;
  if (analysis.project.nextSteps && analysis.project.nextSteps.length > 0) {
    project.nextSteps = analysis.project.nextSteps.slice(0, 24);
  }

  // ---- relations ------------------------------------------------------
  const relations: Relation[] = [];
  const seenRelation = new Set<string>();
  let relationsDropped = 0;
  for (const rc of analysis.relations as RelationCandidate[]) {
    const from = keyToId.get(rc.fromKey);
    const to = keyToId.get(rc.toKey);
    if (!from || !to) {
      relationsDropped += 1;
      notes.push(
        note(
          "KNOWLEDGE_BUILD",
          "builder/relation-dropped",
          `relation ${rc.fromKey} -${rc.type}-> ${rc.toKey} has an unresolved endpoint`,
        ),
      );
      continue;
    }
    const dedupe = `${from}|${to}|${rc.type}`;
    if (seenRelation.has(dedupe)) continue;
    seenRelation.add(dedupe);
    const rel: Relation = {
      id: minter.mint("relation", from, to, rc.type),
      from,
      to,
      type: rc.type,
      sourceRefs: resolveEvidence(rc.evidence),
    };
    if (rc.label) rel.label = rc.label;
    relations.push(rel);
  }

  // ---- claims (UNKNOWN -> gap) --------------------------------------
  const claims: ProjectKnowledge["claims"] = [];
  const seenClaim = new Set<string>();
  for (const cc of analysis.claims as ClaimCandidate[]) {
    if (cc.factType === "UNKNOWN") {
      gaps.push(makeGap(minter, cc.statement, "Reasoner marked this UNKNOWN.", undefined, []));
      notes.push(
        note("KNOWLEDGE_BUILD", "builder/unknown-to-gap", "an UNKNOWN claim became a gap"),
      );
      continue;
    }
    const refs = resolveEvidence(cc.evidence);
    let factType = cc.factType;
    if (factType === "FACT" && !hasResolvable(refs)) {
      factType = "INFERENCE";
      factsDowngraded += 1;
      notes.push(
        note(
          "KNOWLEDGE_BUILD",
          "builder/fact-downgraded",
          `claim "${truncate(cc.statement)}" was FACT without evidence; downgraded to INFERENCE`,
        ),
      );
    }
    const key = `${factType}|${cc.statement}`;
    if (seenClaim.has(key)) continue;
    seenClaim.add(key);
    const supports = resolveKeys(cc.supportsKeys ?? [], keyToId);
    const claim: ProjectKnowledge["claims"][number] = {
      id: minter.mint("claim", slugify(cc.statement)),
      statement: cc.statement,
      factType,
      sourceRefs: refs,
    };
    if (typeof cc.confidence === "number") claim.confidence = cc.confidence;
    if (supports.length > 0) claim.supports = supports;
    claims.push(claim);
  }

  // ---- gaps -------------------------------------------------------
  for (const gc of analysis.gaps as GapCandidate[]) {
    gaps.push(
      makeGap(minter, gc.question, gc.why, gc.severity, resolveKeys(gc.blocksKeys ?? [], keyToId)),
    );
  }
  const dedupedGaps = dedupeById(gaps);

  // ---- assemble ------------------------------------------------------
  const sorted = <T extends { id: string }>(arr: T[]): T[] =>
    [...arr].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const knowledgeNoMeta: Omit<ProjectKnowledge, "meta"> = {
    knowledgeVersion: KNOWLEDGE_VERSION,
    project,
    sources: [...sources].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    capabilities: sorted(capabilities),
    components: sorted(components),
    actors: sorted(actors),
    dependencies: sorted(dependencies),
    processes: sorted(processes),
    phases: sorted(phases),
    milestones: sorted(milestones),
    metrics: sorted(metrics),
    risks: sorted(risks),
    decisions: sorted(decisions),
    requirements: sorted(requirements),
    technologies: sorted(technologies),
    results: sorted(results),
    constraints: sorted(constraints),
    relations: [...relations].sort((a, b) => {
      if (a.from !== b.from) return a.from < b.from ? -1 : 1;
      if (a.to !== b.to) return a.to < b.to ? -1 : 1;
      return a.id < b.id ? -1 : 1;
    }),
    claims: sorted(claims),
    gaps: sorted(dedupedGaps),
  };

  const knowledge: ProjectKnowledge = {
    ...knowledgeNoMeta,
    meta: {
      generator: "arclume-knowledge-builder@0.1.0",
      contentHash: contentHash(knowledgeNoMeta),
    },
  };

  const validation = validateProjectKnowledge(knowledge);
  if (!validation.valid) {
    throw new KnowledgeBuildError("the built ProjectKnowledge failed validation", {
      code: "knowledge-build/invalid-output",
      severity: "fatal",
      hint: firstLines(formatValidationReport(validation), 12),
    });
  }
  for (const w of validation.warnings) {
    notes.push(note("VALIDATION", `validation/${w.code}`, w.message, { path: w.instancePath }));
  }

  const report: KnowledgeBuilderReport = {
    notes,
    stats: {
      entities:
        capabilities.length +
        components.length +
        actors.length +
        dependencies.length +
        processes.length +
        phases.length +
        milestones.length +
        metrics.length +
        risks.length +
        decisions.length +
        requirements.length +
        technologies.length +
        results.length +
        constraints.length,
      relations: relations.length,
      claims: claims.length,
      gaps: dedupedGaps.length,
      evidenceResolved,
      evidenceUnresolved,
      factsDowngraded,
      relationsDropped,
    },
  };

  return { knowledge, report, validation };
}

function makeGap(
  minter: IdMinter,
  question: string,
  why: string | undefined,
  severity: "low" | "medium" | "high" | undefined,
  blocks: string[],
): Gap {
  const g: Gap = { id: minter.mint("gap", slugify(question)), question };
  if (why) g.why = why;
  if (severity) g.severity = severity;
  if (blocks.length > 0) g.blocks = blocks;
  return g;
}

function resolveKeys(keys: readonly string[], keyToId: ReadonlyMap<string, string>): string[] {
  const out: string[] = [];
  for (const k of keys) {
    const id = keyToId.get(k);
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

function dedupeById<T extends { id: string }>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

function truncate(text: string, max = 60): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function firstLines(text: string, n: number): string {
  return text.split("\n").slice(0, n).join("\n");
}
