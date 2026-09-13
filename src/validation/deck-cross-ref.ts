/**
 * Phase 4 structural checks for an `ArclumeDeck` *with context* — the
 * `ProjectKnowledge`, `NarrativePlan` and `SlidePlan` it was built from.
 *
 * Runs after schema + the context-free `crossRefArclumeDeck`. It never does
 * screenshot / visual QA (that is Phase 6). It verifies that the deck did not
 * drift from its inputs, that every visual reference resolves to a real
 * knowledge id, and that a native diagram's **topology matches the
 * ProjectKnowledge exactly** (endpoints, direction, relation type).
 */

import { narrativeContentHash } from "../narrative/planner.js";
import type { NarrativePlan } from "../narrative/types.js";
import { slidePlanContentHash } from "../planning/slide-planner.js";
import type { SlidePlan } from "../planning/types.js";
import type { ArclumeDeck, DiagramIR } from "../types/deck.js";
import { KNOWLEDGE_COLLECTIONS } from "../types/knowledge.js";
import type { ProjectKnowledge } from "../types/knowledge.js";
import { getTheme, themeTokensRef } from "../visual/theme.js";
import type { ValidationIssue } from "./result.js";

export interface DeckContext {
  knowledge?: ProjectKnowledge;
  narrative?: NarrativePlan;
  slidePlan?: SlidePlan;
}

function err(
  code: string,
  message: string,
  instancePath: string,
  extra: Partial<ValidationIssue> = {},
): ValidationIssue {
  return { severity: "error", code, message, instancePath, ...extra };
}
function warn(
  code: string,
  message: string,
  instancePath: string,
  extra: Partial<ValidationIssue> = {},
): ValidationIssue {
  return { severity: "warning", code, message, instancePath, ...extra };
}
function norm(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

interface RelationShape {
  from: string;
  to: string;
  type: string;
}
interface KnowledgeIds {
  all: Set<string>;
  metrics: Set<string>;
  risks: Set<string>;
  gaps: Set<string>;
  temporal: Set<string>;
  relations: Set<string>;
  relationsById: Map<string, RelationShape>;
}
function knowledgeIds(k: ProjectKnowledge): KnowledgeIds {
  const all = new Set<string>([k.project.id]);
  const metrics = new Set<string>();
  const risks = new Set<string>();
  const gaps = new Set<string>();
  const temporal = new Set<string>();
  const relations = new Set<string>();
  const relationsById = new Map<string, RelationShape>();
  for (const c of KNOWLEDGE_COLLECTIONS) {
    for (const raw of (k[c] ?? []) as Array<{
      id?: unknown;
      type?: unknown;
      from?: unknown;
      to?: unknown;
    }>) {
      if (typeof raw.id !== "string") continue;
      all.add(raw.id);
      if (c === "metrics") metrics.add(raw.id);
      if (c === "risks") risks.add(raw.id);
      if (c === "gaps") gaps.add(raw.id);
      if (c === "phases" || c === "milestones") temporal.add(raw.id);
      if (c === "relations") {
        relations.add(raw.id);
        relationsById.set(raw.id, {
          from: typeof raw.from === "string" ? raw.from : "",
          to: typeof raw.to === "string" ? raw.to : "",
          type: typeof raw.type === "string" ? raw.type : "",
        });
      }
    }
  }
  return { all, metrics, risks, gaps, temporal, relations, relationsById };
}

/* ------------------------------------------------------------------ */
/* native diagram topology                                             */
/* ------------------------------------------------------------------ */

interface NativeSpec {
  format?: unknown;
  kind?: unknown;
  nodes?: unknown;
  edges?: unknown;
  steps?: unknown;
  items?: unknown;
  /** Participant-aware `sequence` projection (routes to the visual engine). */
  participants?: unknown;
  messages?: unknown;
}

function asArray(v: unknown): Array<Record<string, unknown>> {
  return Array.isArray(v) ? (v as Array<Record<string, unknown>>) : [];
}

/**
 * Verify a native (`arclume.native.v1`) diagram spec against the knowledge:
 * every id/ref resolves, and every edge's visual endpoints + direction +
 * relation type match the real relation it names.
 */
function validateNativeSpec(
  dir: DiagramIR,
  path: string,
  ids: KnowledgeIds | undefined,
  issues: ValidationIssue[],
): void {
  const spec = dir.spec as NativeSpec | undefined;
  if (!spec || spec.format !== "arclume.native.v1") return;
  const kind = String(spec.kind ?? "");
  const at = (msg: string, code: string): ValidationIssue =>
    err(code, msg, path, { entityId: dir.id });

  if (kind === "architecture") {
    const nodes = asArray(spec.nodes);
    const edges = asArray(spec.edges);
    const nodeById = new Map<string, { entityId?: string }>();

    if (nodes.length === 0 && edges.length === 0) {
      issues.push(at(`native architecture diagram "${dir.id}" is empty`, "deck/empty-diagram"));
    }

    nodes.forEach((n, i) => {
      const nodeId = typeof n["id"] === "string" ? (n["id"] as string) : undefined;
      const entityId = typeof n["entityId"] === "string" ? (n["entityId"] as string) : undefined;
      if (!nodeId || !entityId) {
        issues.push(
          at(
            `native architecture node ${i} is missing ${!nodeId ? "id" : "entityId"}`,
            "deck/diagram-node-ref-missing",
          ),
        );
        return;
      }
      nodeById.set(nodeId, { entityId });
      if (ids && !ids.all.has(entityId)) {
        issues.push(
          at(
            `native architecture node "${nodeId}" entityId "${entityId}" is not a ProjectKnowledge id`,
            "deck/unknown-diagram-ref",
          ),
        );
      }
    });

    edges.forEach((e, i) => {
      const relationId =
        typeof e["relationId"] === "string" ? (e["relationId"] as string) : undefined;
      const from = typeof e["from"] === "string" ? (e["from"] as string) : undefined;
      const to = typeof e["to"] === "string" ? (e["to"] as string) : undefined;
      if (!relationId || !from || !to) {
        issues.push(
          at(
            `native architecture edge ${i} is missing ${[
              !relationId && "relationId",
              !from && "from",
              !to && "to",
            ]
              .filter(Boolean)
              .join(", ")}`,
            "deck/diagram-edge-incomplete",
          ),
        );
        return;
      }
      const fromNode = nodeById.get(from);
      const toNode = nodeById.get(to);
      if (!fromNode || !toNode) {
        issues.push(
          at(
            `native architecture edge ${i} points to ${!fromNode ? `unknown node "${from}"` : `unknown node "${to}"`}`,
            "deck/diagram-endpoint-missing",
          ),
        );
        return;
      }
      if (!ids) return;
      const rel = ids.relationsById.get(relationId);
      if (!rel) {
        issues.push(
          at(
            `native architecture edge ${i} relationId "${relationId}" is not a ProjectKnowledge relation`,
            "deck/unknown-diagram-ref",
          ),
        );
        return;
      }
      if (fromNode.entityId !== rel.from || toNode.entityId !== rel.to) {
        issues.push(
          at(
            `native architecture edge ${i} draws ${fromNode.entityId} → ${toNode.entityId} but relation "${relationId}" is ${rel.from} → ${rel.to}`,
            "deck/diagram-topology-mismatch",
          ),
        );
      }
      const relType =
        typeof e["relationType"] === "string" ? (e["relationType"] as string) : undefined;
      if (relType !== undefined && relType !== rel.type) {
        issues.push(
          at(
            `native architecture edge ${i} relationType "${relType}" != relation "${relationId}" type "${rel.type}"`,
            "deck/diagram-relation-type-mismatch",
          ),
        );
      }
    });
    return;
  }

  // A participant-aware `sequence` carries {participants, messages} instead of
  // {steps, edges} (it is built to route to the visual engine sequence renderer).
  if (kind === "sequence" && Array.isArray(spec.participants) && spec.participants.length > 0) {
    const participants = asArray(spec.participants);
    const messages = asArray(spec.messages);
    const participantIds = new Set<string>();
    participants.forEach((p, i) => {
      const id = typeof p["id"] === "string" ? (p["id"] as string) : undefined;
      if (!id) {
        issues.push(
          at(`native sequence participant ${i} is missing id`, "deck/diagram-edge-incomplete"),
        );
        return;
      }
      participantIds.add(id);
    });
    if (messages.length === 0) {
      issues.push(at(`native sequence diagram "${dir.id}" has no messages`, "deck/empty-diagram"));
    }
    messages.forEach((m, i) => {
      const from = typeof m["from"] === "string" ? (m["from"] as string) : undefined;
      const to = typeof m["to"] === "string" ? (m["to"] as string) : undefined;
      if (!from || !to) {
        issues.push(
          at(
            `native sequence message ${i} is missing ${!from ? "from" : "to"}`,
            "deck/diagram-edge-incomplete",
          ),
        );
        return;
      }
      if (!participantIds.has(from) || !participantIds.has(to)) {
        issues.push(
          at(
            `native sequence message ${i} points to ${
              !participantIds.has(from)
                ? `unknown participant "${from}"`
                : `unknown participant "${to}"`
            }`,
            "deck/diagram-endpoint-missing",
          ),
        );
      }
    });
    return;
  }

  if (kind === "process" || kind === "sequence") {
    const steps = asArray(spec.steps);
    const edges = asArray(spec.edges);
    const stepById = new Map<string, { ref?: string }>();

    if (steps.length === 0) {
      issues.push(at(`native ${kind} diagram "${dir.id}" has no steps`, "deck/empty-diagram"));
    }

    steps.forEach((s, i) => {
      const stepId = typeof s["id"] === "string" ? (s["id"] as string) : undefined;
      const ref = typeof s["ref"] === "string" ? (s["ref"] as string) : undefined;
      if (!stepId || !ref) {
        issues.push(
          at(
            `native ${kind} step ${i} is missing ${!stepId ? "id" : "ref"}`,
            "deck/diagram-edge-incomplete",
          ),
        );
        return;
      }
      stepById.set(stepId, { ref });
      if (ids && !ids.all.has(ref)) {
        issues.push(
          at(
            `native ${kind} step "${stepId}" ref "${ref}" is not a ProjectKnowledge id`,
            "deck/unknown-diagram-ref",
          ),
        );
      }
    });

    edges.forEach((e, i) => {
      const relationId =
        typeof e["relationId"] === "string" ? (e["relationId"] as string) : undefined;
      const from = typeof e["from"] === "string" ? (e["from"] as string) : undefined;
      const to = typeof e["to"] === "string" ? (e["to"] as string) : undefined;
      // A native flow edge is a structural claim: it must name the Relation
      // that backs it, exactly like an architecture edge. No relationId ⇒ the
      // edge has no provenance and cannot be checked topologically.
      if (!relationId || !from || !to) {
        issues.push(
          at(
            `native ${kind} edge ${i} is missing ${[
              !relationId && "relationId",
              !from && "from",
              !to && "to",
            ]
              .filter(Boolean)
              .join(", ")}`,
            "deck/diagram-edge-incomplete",
          ),
        );
        return;
      }
      const fromStep = stepById.get(from);
      const toStep = stepById.get(to);
      if (!fromStep || !toStep) {
        issues.push(
          at(
            `native ${kind} edge ${i} points to ${!fromStep ? `unknown step "${from}"` : `unknown step "${to}"`}`,
            "deck/diagram-endpoint-missing",
          ),
        );
        return;
      }
      if (!ids) return;
      const rel = ids.relationsById.get(relationId);
      if (!rel) {
        issues.push(
          at(
            `native ${kind} edge ${i} relationId "${relationId}" is not a ProjectKnowledge relation`,
            "deck/unknown-diagram-ref",
          ),
        );
        return;
      }
      if (rel.type !== "PRECEDES") {
        issues.push(
          at(
            `native ${kind} edge ${i} is backed by relation "${relationId}" of type "${rel.type}", not PRECEDES`,
            "deck/diagram-relation-type-mismatch",
          ),
        );
      }
      if (fromStep.ref !== rel.from || toStep.ref !== rel.to) {
        issues.push(
          at(
            `native ${kind} edge ${i} orders ${fromStep.ref} → ${toStep.ref} but relation "${relationId}" is ${rel.from} → ${rel.to}`,
            "deck/diagram-topology-mismatch",
          ),
        );
      }
    });
    return;
  }

  if (kind === "timeline" || kind === "roadmap") {
    const items = asArray(spec.items);
    if (items.length === 0) {
      issues.push(at(`native ${kind} diagram "${dir.id}" has no items`, "deck/empty-diagram"));
    }
    items.forEach((it, i) => {
      const ref = typeof it["ref"] === "string" ? (it["ref"] as string) : undefined;
      if (!ref) {
        issues.push(at(`native ${kind} item ${i} is missing ref`, "deck/diagram-edge-incomplete"));
        return;
      }
      if (ids && !ids.temporal.has(ref)) {
        issues.push(
          at(
            `native ${kind} item ${i} ref "${ref}" is not a ProjectKnowledge phase or milestone id`,
            "deck/unknown-diagram-ref",
          ),
        );
      }
    });
  }
}

/* ------------------------------------------------------------------ */

export function crossRefArclumeDeckContext(deck: ArclumeDeck, ctx: DeckContext): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { knowledge, narrative, slidePlan } = ctx;
  const ids = knowledge ? knowledgeIds(knowledge) : undefined;

  // ---- artifact binding: no stale / mixed baseline ------------------------
  const prov = deck.provenance ?? { sources: [] };
  if (knowledge?.meta?.contentHash !== undefined) {
    if (prov.knowledgeHash === undefined) {
      issues.push(
        err(
          "deck/knowledge-hash-missing",
          "the source ProjectKnowledge is hashed but the deck has no provenance.knowledgeHash",
          "/provenance/knowledgeHash",
        ),
      );
    } else if (prov.knowledgeHash !== knowledge.meta.contentHash) {
      issues.push(
        err(
          "deck/knowledge-hash-mismatch",
          "provenance.knowledgeHash does not match the supplied ProjectKnowledge — the deck was built from a different knowledge baseline",
          "/provenance/knowledgeHash",
        ),
      );
    }
  }
  if (narrative) {
    const want = narrativeContentHash(narrative);
    if (prov.narrativeRef === undefined) {
      issues.push(
        err(
          "deck/narrative-ref-missing",
          "a NarrativePlan was supplied but the deck has no provenance.narrativeRef",
          "/provenance/narrativeRef",
        ),
      );
    } else if (prov.narrativeRef !== want) {
      issues.push(
        err(
          "deck/narrative-ref-mismatch",
          "provenance.narrativeRef does not match the supplied NarrativePlan",
          "/provenance/narrativeRef",
        ),
      );
    }
    if (deck.narrative?.throughline && narrative.throughline) {
      // the deck throughline is the narrative's, only possibly clamped to 400.
      const dt = norm(deck.narrative.throughline);
      const nt = norm(narrative.throughline);
      const ok = dt === nt || (dt.endsWith("…") && nt.startsWith(dt.slice(0, -1).trimEnd()));
      if (!ok) {
        issues.push(
          err(
            "deck/throughline-altered",
            "deck narrative.throughline is not the NarrativePlan throughline (verbatim or deterministically clamped) — Phase 5 must not render an altered throughline while provenance still claims the original narrative",
            "/narrative/throughline",
          ),
        );
      }
    }
  }
  if (slidePlan) {
    const want = slidePlanContentHash(slidePlan);
    if (prov.slidePlanRef === undefined) {
      issues.push(
        err(
          "deck/slide-plan-ref-missing",
          "a SlidePlan was supplied but the deck has no provenance.slidePlanRef",
          "/provenance/slidePlanRef",
        ),
      );
    } else if (prov.slidePlanRef !== want) {
      issues.push(
        err(
          "deck/slide-plan-ref-mismatch",
          "provenance.slidePlanRef does not match the supplied SlidePlan",
          "/provenance/slidePlanRef",
        ),
      );
    }

    // ---- 1:1 slide binding + keyMessage integrity ------------------------
    const planned = slidePlan.slides;
    if (deck.slides.length !== planned.length) {
      issues.push(
        err(
          "deck/slide-count-mismatch",
          `deck has ${deck.slides.length} slides but the SlidePlan has ${planned.length}`,
          "/slides",
        ),
      );
    }
    deck.slides.forEach((slide, i) => {
      const p = planned[i];
      if (!p) return;
      if (slide.id !== p.id) {
        issues.push(
          err(
            "deck/slide-id-mismatch",
            `deck slide ${i} id "${slide.id}" != SlidePlan slide id "${p.id}"`,
            `/slides/${i}/id`,
            { entityId: slide.id },
          ),
        );
      }
      if (norm(slide.keyMessage) !== norm(p.keyMessage)) {
        issues.push(
          err(
            "deck/key-message-altered",
            "deck slide keyMessage differs from the SlidePlan keyMessage (only whitespace may be normalised)",
            `/slides/${i}/keyMessage`,
            { entityId: slide.id },
          ),
        );
      }
      if (slide.narrativePurpose !== p.narrativePurpose) {
        issues.push(
          err(
            "deck/narrative-purpose-altered",
            `deck slide narrativePurpose "${slide.narrativePurpose}" != SlidePlan "${p.narrativePurpose}"`,
            `/slides/${i}/narrativePurpose`,
            { entityId: slide.id },
          ),
        );
      }
    });
  }

  // ---- native diagram topology integrity -------------------------------
  (deck.diagrams ?? []).forEach((dir, d) => {
    validateNativeSpec(dir, `/diagrams/${d}`, ids, issues);
  });

  // ---- per-block provenance / reference resolution --------------------
  const diagramById = new Map((deck.diagrams ?? []).map((x) => [x.id, x]));

  deck.slides.forEach((slide, i) => {
    (slide.blocks ?? []).forEach((block, j) => {
      const bp = `/slides/${i}/blocks/${j}`;

      if (block.type === "metric" || block.type === "metric-grid") {
        const metricIds =
          block.type === "metric"
            ? [block.metricId].filter((x): x is string => typeof x === "string")
            : (block.metrics ?? [])
                .map((m) => m.metricId)
                .filter((x): x is string => typeof x === "string");
        for (const mid of metricIds) {
          if (ids && !ids.metrics.has(mid)) {
            issues.push(
              err(
                "deck/unknown-metric-ref",
                `metric block references "${mid}" which is not a ProjectKnowledge metric id`,
                bp,
                { entityId: block.id },
              ),
            );
          }
        }
        const hasProv = metricIds.length > 0 || (block.sourceRefs?.length ?? 0) > 0;
        if (!hasProv) {
          issues.push(
            warn(
              "deck/block-without-provenance",
              "a metric block carries neither a metricId nor sourceRefs",
              bp,
              { entityId: block.id },
            ),
          );
        }
      }

      if (block.type === "risk") {
        const rid = block.riskId;
        if (ids && typeof rid === "string" && !ids.risks.has(rid) && !ids.gaps.has(rid)) {
          issues.push(
            err(
              "deck/unknown-risk-ref",
              `risk block riskId "${rid}" is not a ProjectKnowledge risk or gap id`,
              bp,
              { entityId: block.id },
            ),
          );
        }
        if (typeof rid !== "string" && (block.sourceRefs?.length ?? 0) === 0) {
          issues.push(
            warn(
              "deck/block-without-provenance",
              "a risk block carries neither a riskId nor sourceRefs",
              bp,
              { entityId: block.id },
            ),
          );
        }
      }

      if (block.type === "timeline") {
        for (const it of block.items ?? []) {
          if (ids && typeof it.id === "string" && !ids.temporal.has(it.id)) {
            issues.push(
              err(
                "deck/unknown-temporal-ref",
                `timeline item id "${it.id}" is not a ProjectKnowledge phase or milestone id`,
                bp,
                { entityId: block.id },
              ),
            );
          }
        }
      }
      if (block.type === "roadmap") {
        for (const ph of block.phases ?? []) {
          if (ids && typeof ph.id === "string" && !ids.temporal.has(ph.id)) {
            issues.push(
              err(
                "deck/unknown-temporal-ref",
                `roadmap phase id "${ph.id}" is not a ProjectKnowledge phase or milestone id`,
                bp,
                { entityId: block.id },
              ),
            );
          }
        }
      }

      if (
        (block.type === "architecture" || block.type === "workflow" || block.type === "diagram") &&
        typeof block.diagramRef === "string"
      ) {
        const dir = diagramById.get(block.diagramRef);
        const spec = dir?.spec as NativeSpec | undefined;
        if (dir && spec && spec.format === "arclume.native.v1" && spec.kind === "architecture") {
          const relCount = asArray(spec.edges).length;
          if (relCount === 0) {
            issues.push(
              err(
                "deck/architecture-without-relations",
                `architecture diagram "${block.diagramRef}" has no edges — an architecture visual needs at least one real relation`,
                bp,
                { entityId: block.id },
              ),
            );
          }
        }
      }
    });

    // ---- slide kind ⇄ block shape ------------------------------------
    if (
      slide.kind === "metrics" &&
      !(slide.blocks ?? []).some(
        (b) => b.type === "metric" || b.type === "metric-grid" || b.type === "callout",
      )
    ) {
      issues.push(
        warn(
          "deck/metrics-slide-without-metric-block",
          `slide of kind "metrics" has no metric / metric-grid block`,
          `/slides/${i}/blocks`,
          { entityId: slide.id },
        ),
      );
    }
    if (
      (slide.kind === "roadmap" || slide.kind === "timeline") &&
      !(slide.blocks ?? []).some((b) => b.type === "roadmap" || b.type === "timeline")
    ) {
      issues.push(
        warn(
          "deck/temporal-slide-without-temporal-block",
          `slide of kind "${slide.kind}" has no roadmap / timeline block`,
          `/slides/${i}/blocks`,
          { entityId: slide.id },
        ),
      );
    }
  });

  // ---- theme integrity: name implemented + token identity bound -------
  const themeName = deck.theme?.name;
  if (themeName === "minimal" || themeName === "executive") {
    const wantRef = themeTokensRef(getTheme(themeName));
    const gotRef = deck.theme?.tokensRef;
    if (gotRef === undefined) {
      issues.push(
        err(
          "deck/theme-tokens-ref-missing",
          `theme "${themeName}" has a canonical token set but the deck carries no theme.tokensRef — Phase 5 could not resolve which tokens to apply`,
          "/theme/tokensRef",
        ),
      );
    } else if (gotRef !== wantRef) {
      issues.push(
        err(
          "deck/theme-tokens-ref-mismatch",
          `theme.name is "${themeName}" but theme.tokensRef "${gotRef}" is not this theme's token identity ("${wantRef}")`,
          "/theme/tokensRef",
        ),
      );
    }
  } else if (themeName) {
    issues.push(
      err(
        "deck/theme-unimplemented",
        `theme "${themeName}" is declared but Phase 4 can only resolve "minimal" and "executive" — Phase 5 has no tokens for it`,
        "/theme/name",
      ),
    );
  }

  return issues;
}
