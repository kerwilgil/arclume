/**
 * `StubReasoner` — a fully deterministic, offline, rule-based analyzer.
 *
 * It performs no network I/O and calls no model. Given the same
 * {@link ReasonerRequest} it always produces the same {@link AnalysisResult}.
 * Used for tests, fixtures, CI and offline development, and as the reference for
 * what the pipeline expects from any Reasoner.
 *
 * Heuristics (evidence-first — every candidate carries at least one
 * EvidenceCandidate unless noted):
 *  - project name/summary/purpose/status/nextSteps from `package.json` + README
 *  - dependencies + technologies from `package.json` (+ Node/TypeScript inference)
 *  - components from `docs/architecture.md` headings (undocumented `src/` dirs -> gap)
 *  - README sections classified into requirement/risk/constraint/decision/
 *    milestone/metric/capability/actor candidates, one per bullet
 *  - claims from a "Status" section (FACT) and an "Assumptions" section (INFERENCE)
 *  - gaps from an "Open Questions" section and from TODO/FIXME lines
 *  - relations: project -> dependency (DEPENDS_ON), project -> technology
 *    (USES_TECHNOLOGY), component -> project (PART_OF)
 */

import {
  ANALYSIS_VERSION,
  type AnalysisResult,
  type ClaimCandidate,
  type EntityCandidate,
  type EvidenceCandidate,
  type GapCandidate,
  type RelationCandidate,
} from "../analysis-result.js";
import type {
  Reasoner,
  ReasonerCapabilities,
  ReasonerDocument,
  ReasonerRequest,
  ReasonerResult,
} from "../reasoner.js";

const CAPABILITIES: ReasonerCapabilities = {
  id: "stub",
  version: "0.1.0",
  deterministic: true,
  network: false,
};

const MAX_BULLETS_PER_SECTION = 40;
const MAX_TODOS = 25;

const KNOWN_TECH: Record<string, string> = {
  express: "framework",
  fastify: "framework",
  koa: "framework",
  react: "framework",
  vue: "framework",
  next: "framework",
  zod: "library",
  ajv: "library",
  yaml: "library",
  vitest: "tool",
  jest: "tool",
  typescript: "language",
  eslint: "tool",
  prettier: "tool",
  biome: "tool",
};

interface Line {
  no: number; // 1-based
  text: string;
}

function lines(content: string): Line[] {
  return content.split("\n").map((text, i) => ({ no: i + 1, text }));
}

function lineOf(content: string, needle: string): number | undefined {
  const idx = content.split("\n").findIndex((l) => l.includes(needle));
  return idx === -1 ? undefined : idx + 1;
}

function ev(documentId: string, lineStart?: number, lineEnd?: number): EvidenceCandidate {
  const e: EvidenceCandidate = { documentId };
  if (lineStart !== undefined) {
    e.lineStart = lineStart;
    e.lineEnd = lineEnd !== undefined && lineEnd >= lineStart ? lineEnd : lineStart;
  }
  return e;
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function findDoc(
  docs: ReasonerDocument[],
  predicate: (d: ReasonerDocument) => boolean,
): ReasonerDocument | undefined {
  return docs.find(predicate);
}

function bulletsIn(doc: ReasonerDocument, startLine: number, endLine: number): Line[] {
  const all = lines(doc.content);
  const out: Line[] = [];
  for (const line of all) {
    if (line.no < startLine || line.no > endLine) continue;
    const m = /^\s*(?:[-*+]|\d+\.)\s+(.*\S)\s*$/.exec(line.text);
    if (m) out.push({ no: line.no, text: (m[1] as string).trim() });
    if (out.length >= MAX_BULLETS_PER_SECTION) break;
  }
  return out;
}

interface MdSection {
  heading: string;
  depth: number;
  line: number;
  endLine: number;
}

function markdownSections(doc: ReasonerDocument): MdSection[] {
  const outline = doc.outline as { sections?: MdSection[] } | undefined;
  return Array.isArray(outline?.sections) ? (outline.sections as MdSection[]) : [];
}

function firstParagraphAfter(doc: ReasonerDocument, afterLine: number): Line | undefined {
  for (const line of lines(doc.content)) {
    if (line.no <= afterLine) continue;
    const t = line.text.trim();
    if (t === "" || t.startsWith("#")) continue;
    return { no: line.no, text: t };
  }
  return undefined;
}

type SectionKind =
  | "requirement"
  | "risk"
  | "constraint"
  | "decision"
  | "milestone"
  | "metric"
  | "capability"
  | "actor"
  | "status"
  | "assumption"
  | "open-question"
  | "architecture"
  | "next-steps"
  | null;

function classifyHeading(heading: string): SectionKind {
  const h = heading.toLowerCase();
  if (/requirement/.test(h)) return "requirement";
  if (/risk/.test(h)) return "risk";
  if (/constraint/.test(h)) return "constraint";
  if (/decision/.test(h)) return "decision";
  if (/milestone|roadmap/.test(h)) return "milestone";
  if (/metric|kpi|result/.test(h)) return "metric";
  if (/capabilit|feature/.test(h)) return "capability";
  if (/actor|persona|user role/.test(h)) return "actor";
  if (/status/.test(h)) return "status";
  if (/assumption/.test(h)) return "assumption";
  if (/open question|unknown|todo/.test(h)) return "open-question";
  if (/architecture|components?/.test(h)) return "architecture";
  if (/next steps/.test(h)) return "next-steps";
  return null;
}

function buildAnalysis(request: ReasonerRequest): AnalysisResult {
  const docs = request.documents;
  const entities: EntityCandidate[] = [];
  const relations: RelationCandidate[] = [];
  const claims: ClaimCandidate[] = [];
  const gaps: GapCandidate[] = [];

  const pkgDoc = findDoc(docs, (d) => d.kind === "json" && /(^|\/)package\.json$/.test(d.path));
  const readmeDoc =
    findDoc(docs, (d) => d.kind === "markdown" && /(^|\/)readme(\.[a-z]+)?$/i.test(d.path)) ??
    findDoc(docs, (d) => d.kind === "markdown");
  const archDoc = findDoc(
    docs,
    (d) => d.kind === "markdown" && /architecture/i.test(d.path) && d !== readmeDoc,
  );

  // ---- package.json ----------------------------------------------------------
  let pkg: Record<string, unknown> = {};
  if (pkgDoc) {
    try {
      pkg = JSON.parse(pkgDoc.content) as Record<string, unknown>;
    } catch {
      pkg = {};
    }
  }

  // ---- project -------------------------------------------------------------
  const readmeTitle = readmeDoc
    ? (readmeDoc.outline as { title?: string } | undefined)?.title
    : undefined;
  const projectName =
    (typeof pkg["name"] === "string" && (pkg["name"] as string).trim()) || readmeTitle || "project";

  const projectEvidence: EvidenceCandidate[] = [];
  if (pkgDoc) projectEvidence.push(ev(pkgDoc.id, lineOf(pkgDoc.content, '"name"')));
  if (readmeDoc) {
    const firstSection = markdownSections(readmeDoc)[0];
    if (firstSection)
      projectEvidence.push(ev(readmeDoc.id, firstSection.line, firstSection.endLine));
  }

  const project: AnalysisResult["project"] = { name: projectName, evidence: projectEvidence };
  if (typeof pkg["description"] === "string" && (pkg["description"] as string).trim()) {
    project.summary = (pkg["description"] as string).trim();
  } else if (readmeDoc) {
    const titleLine = markdownSections(readmeDoc)[0]?.line ?? 0;
    const para = firstParagraphAfter(readmeDoc, titleLine);
    if (para) project.summary = para.text;
  }

  // ---- dependencies + technologies from package.json ------------------------
  const techByKey = new Map<string, EntityCandidate>();
  const addTech = (name: string, category: string, evidence: EvidenceCandidate[]): void => {
    const key = `technology:${slug(name)}`;
    if (techByKey.has(key)) return;
    techByKey.set(key, { kind: "technology", name, key, attrs: { category }, evidence });
  };

  for (const scope of ["dependencies", "devDependencies"] as const) {
    const block = pkg[scope];
    if (!block || typeof block !== "object") continue;
    for (const [name, version] of Object.entries(block as Record<string, unknown>)) {
      const evidence = pkgDoc ? [ev(pkgDoc.id, lineOf(pkgDoc.content, `"${name}"`))] : [];
      entities.push({
        kind: "dependency",
        name,
        key: `dependency:${slug(name)}`,
        attrs: {
          version: typeof version === "string" ? version : String(version),
          scope: scope === "dependencies" ? "runtime" : "dev",
        },
        evidence,
      });
      if (pkgDoc) {
        relations.push({
          fromKey: "project",
          toKey: `dependency:${slug(name)}`,
          type: "DEPENDS_ON",
          evidence: [ev(pkgDoc.id, lineOf(pkgDoc.content, `"${name}"`))],
        });
      }
      const category = KNOWN_TECH[name.toLowerCase()];
      if (category) addTech(name, category, evidence);
    }
  }

  if (pkgDoc) addTech("Node.js", "runtime", [ev(pkgDoc.id, lineOf(pkgDoc.content, '"name"'))]);
  if (request.files.some((f) => /\.tsx?$/.test(f.path))) {
    const tsconfig = docs.find((d) => /tsconfig\.json$/.test(d.path));
    addTech("TypeScript", "language", tsconfig ? [ev(tsconfig.id)] : pkgDoc ? [ev(pkgDoc.id)] : []);
  }

  for (const tech of techByKey.values()) {
    entities.push(tech);
    if (pkgDoc && tech.key) {
      relations.push({
        fromKey: "project",
        toKey: tech.key,
        type: "USES_TECHNOLOGY",
        evidence: [ev(pkgDoc.id, lineOf(pkgDoc.content, '"name"'))],
      });
    }
  }

  // ---- components from docs/architecture.md --------------------------------
  const componentKeys = new Set<string>();
  if (archDoc) {
    for (const section of markdownSections(archDoc)) {
      if (section.depth <= 1) continue;
      const key = `component:${slug(section.heading)}`;
      if (componentKeys.has(key)) continue;
      componentKeys.add(key);
      entities.push({
        kind: "component",
        name: section.heading,
        key,
        evidence: [ev(archDoc.id, section.line, section.endLine)],
      });
      relations.push({
        fromKey: key,
        toKey: "project",
        type: "PART_OF",
        evidence: [ev(archDoc.id, section.line, section.endLine)],
      });
    }
  }

  // undocumented src/ subdirectories -> gap
  const srcDirs = new Set<string>();
  for (const f of request.files) {
    const m = /^src\/([^/]+)\//.exec(f.path);
    if (m) srcDirs.add(m[1] as string);
  }
  for (const dir of [...srcDirs].sort()) {
    if (!componentKeys.has(`component:${slug(dir)}`)) {
      gaps.push({
        question: `What is the role of the "${dir}" component?`,
        why: `src/${dir}/ exists but no ingested document describes it.`,
        severity: "low",
      });
    }
  }

  // ---- README sections ----------------------------------------------------
  if (readmeDoc) {
    for (const section of markdownSections(readmeDoc)) {
      const kind = classifyHeading(section.heading);
      if (kind === null) continue;
      const bullets = bulletsIn(readmeDoc, section.line, section.endLine);
      for (const b of bullets) {
        const evidence = [ev(readmeDoc.id, b.no, b.no)];
        if (
          kind === "requirement" ||
          kind === "constraint" ||
          kind === "decision" ||
          kind === "milestone" ||
          kind === "metric" ||
          kind === "capability" ||
          kind === "actor"
        ) {
          const entity: EntityCandidate = {
            kind,
            name: b.text,
            key: `${kind}:${slug(b.text)}`,
            evidence,
          };
          entities.push(entity);
        } else if (kind === "risk") {
          entities.push({
            kind: "risk",
            name: b.text,
            key: `risk:${slug(b.text)}`,
            factType: b.text.startsWith("FACT:") ? "FACT" : "INFERENCE",
            evidence,
          });
        } else if (kind === "status") {
          claims.push({ statement: b.text, factType: "FACT", evidence });
        } else if (kind === "assumption") {
          claims.push({ statement: b.text, factType: "INFERENCE", evidence });
        } else if (kind === "open-question") {
          gaps.push({
            question: b.text,
            why: `Listed under "${section.heading}".`,
            severity: "medium",
          });
        } else if (kind === "next-steps") {
          project.nextSteps = [...(project.nextSteps ?? []), b.text].slice(0, 12);
        }
      }
    }
  }

  // ---- TODO / FIXME scan -------------------------------------------------
  let todoCount = 0;
  for (const doc of docs) {
    for (const line of lines(doc.content)) {
      if (todoCount >= MAX_TODOS) break;
      const m = /\b(TODO|FIXME)\b[:\s-]*(.+)/i.exec(line.text);
      if (m) {
        todoCount += 1;
        gaps.push({
          question: `Resolve ${(m[1] as string).toUpperCase()}: ${(m[2] as string).trim()}`,
          why: `${doc.path}:${line.no}`,
          severity: "low",
        });
      }
    }
  }

  return {
    analysisVersion: ANALYSIS_VERSION,
    project,
    entities,
    relations,
    claims,
    gaps,
  };
}

export class StubReasoner implements Reasoner {
  readonly capabilities = CAPABILITIES;

  analyze(request: ReasonerRequest): Promise<ReasonerResult> {
    const analysis = buildAnalysis(request);
    return Promise.resolve({
      analysis,
      reasoner: { id: this.capabilities.id, version: this.capabilities.version },
    });
  }
}
