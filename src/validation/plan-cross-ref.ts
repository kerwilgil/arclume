/**
 * Semantic checks for `NarrativePlan` and `SlidePlan` that JSON Schema cannot
 * express. Run only after a clean schema pass, so the shape can be trusted.
 *
 * When the source `ProjectKnowledge` (and, for a slide plan, the `NarrativePlan`)
 * are supplied, reference-resolution checks run too; without them, only the
 * plan-internal rules apply.
 */

import { narrativeContentHash } from "../narrative/planner.js";
import type { NarrativePlan } from "../narrative/types.js";
import { slidePlanContentHash } from "../planning/slide-planner.js";
import type { SlidePlan } from "../planning/types.js";
import type { ProjectKnowledge } from "../types/knowledge.js";
import { KNOWLEDGE_COLLECTIONS } from "../types/knowledge.js";
import type { ValidationIssue } from "./result.js";

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

const GENERIC_THROUGHLINE =
  /^\s*(this\s+)?(presentation|deck|slide deck|document)\b|overview of the (project|deck|product)/i;

/** Every id in a `ProjectKnowledge` a plan may legitimately reference. */
function knowledgeIdSets(knowledge: ProjectKnowledge): {
  all: Set<string>;
  claims: Set<string>;
  metrics: Set<string>;
  relations: Set<string>;
  temporal: Set<string>;
  sources: Set<string>;
} {
  const all = new Set<string>([knowledge.project.id]);
  const claims = new Set<string>();
  const metrics = new Set<string>();
  const relations = new Set<string>();
  const temporal = new Set<string>();
  for (const collection of KNOWLEDGE_COLLECTIONS) {
    for (const raw of (knowledge[collection] ?? []) as Array<{ id?: unknown; type?: unknown }>) {
      if (typeof raw.id !== "string") continue;
      all.add(raw.id);
      if (collection === "claims") claims.add(raw.id);
      if (collection === "metrics") metrics.add(raw.id);
      if (collection === "relations") relations.add(raw.id);
      if (collection === "phases" || collection === "milestones") temporal.add(raw.id);
      if (collection === "relations" && raw.type === "PRECEDES") temporal.add(raw.id);
    }
  }
  const sources = new Set<string>((knowledge.sources ?? []).map((s) => s.id));
  return { all, claims, metrics, relations, temporal, sources };
}

/* ------------------------------------------------------------------ */
/* NarrativePlan                                                       */
/* ------------------------------------------------------------------ */

export function crossRefNarrativePlan(
  plan: NarrativePlan,
  knowledge?: ProjectKnowledge,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const seenId = new Map<string, number>();
  const seenTitle = new Map<string, number>();
  plan.sections.forEach((section, i) => {
    const prev = seenId.get(section.id);
    if (prev !== undefined) {
      issues.push(
        err(
          "narrative/duplicate-section-id",
          `section id "${section.id}" already used at /sections/${prev}`,
          `/sections/${i}/id`,
          { entityId: section.id },
        ),
      );
    } else {
      seenId.set(section.id, i);
    }
    const titleKey = section.title.trim().toLowerCase();
    const prevTitle = seenTitle.get(titleKey);
    if (prevTitle !== undefined) {
      issues.push(
        warn(
          "narrative/duplicate-section-title",
          `two sections share the title "${section.title}"`,
          `/sections/${i}/title`,
          { entityId: section.id },
        ),
      );
    } else {
      seenTitle.set(titleKey, i);
    }
    if (
      section.knowledgeRefs.length === 0 &&
      section.id !== "sec-opening" &&
      section.id !== "sec-closing"
    ) {
      issues.push(
        warn(
          "narrative/empty-section",
          `section "${section.title}" has no knowledgeRefs`,
          `/sections/${i}/knowledgeRefs`,
          { entityId: section.id },
        ),
      );
    }
  });

  if (GENERIC_THROUGHLINE.test(plan.throughline)) {
    issues.push(
      err(
        "narrative/throughline-generic",
        "the throughline must be a specific idea derived from the knowledge, not a generic opener",
        "/throughline",
      ),
    );
  }

  // ---- self content-hash: meta.contentHash must be the plan's real identity ----
  if (
    plan.meta?.contentHash !== undefined &&
    plan.meta.contentHash !== narrativeContentHash(plan)
  ) {
    issues.push(
      err(
        "narrative/content-hash-mismatch",
        "meta.contentHash does not match the canonical hash of this NarrativePlan (payload was modified without re-hashing)",
        "/meta/contentHash",
      ),
    );
  }

  // ---- selection must be a true partition -----------------------------------
  const selectedSet = new Set<string>();
  const deprioritizedSet = new Set<string>();
  const omittedSet = new Set<string>();
  const collectUnique = (list: readonly string[], name: string, into: Set<string>): void => {
    list.forEach((id, j) => {
      if (into.has(id)) {
        issues.push(
          err(
            "narrative/selection-duplicate",
            `"${id}" appears more than once in selection.${name}`,
            `/selection/${name}/${j}`,
            { entityId: id },
          ),
        );
      } else {
        into.add(id);
      }
    });
  };
  collectUnique(plan.selection.selected, "selected", selectedSet);
  collectUnique(plan.selection.deprioritized, "deprioritized", deprioritizedSet);
  plan.selection.omitted.forEach((o, j) => {
    if (omittedSet.has(o.id)) {
      issues.push(
        err(
          "narrative/selection-duplicate",
          `"${o.id}" appears more than once in selection.omitted`,
          `/selection/omitted/${j}/id`,
          { entityId: o.id },
        ),
      );
    } else {
      omittedSet.add(o.id);
    }
  });

  const overlap = (a: Set<string>, b: Set<string>, aName: string, bName: string): void => {
    for (const id of a) {
      if (b.has(id)) {
        issues.push(
          err(
            "narrative/selection-conflict",
            `"${id}" appears in both selection.${aName} and selection.${bName}`,
            "/selection",
            { entityId: id },
          ),
        );
      }
    }
  };
  overlap(selectedSet, omittedSet, "selected", "omitted");
  overlap(selectedSet, deprioritizedSet, "selected", "deprioritized");
  overlap(deprioritizedSet, omittedSet, "deprioritized", "omitted");

  if (knowledge) {
    const ids = knowledgeIdSets(knowledge);
    const check = (list: readonly string[], path: string): void => {
      list.forEach((id, j) => {
        if (!ids.all.has(id)) {
          issues.push(
            err(
              "narrative/unknown-knowledge-ref",
              `"${id}" is not an id in the source ProjectKnowledge`,
              `${path}/${j}`,
              { entityId: id },
            ),
          );
        }
      });
    };
    plan.sections.forEach((s, i) => check(s.knowledgeRefs, `/sections/${i}/knowledgeRefs`));
    check(plan.selection.selected, "/selection/selected");
    check(plan.selection.deprioritized, "/selection/deprioritized");
    plan.selection.omitted.forEach((o, j) => {
      if (!ids.all.has(o.id)) {
        issues.push(
          err(
            "narrative/unknown-knowledge-ref",
            `omitted id "${o.id}" is not in the source ProjectKnowledge`,
            `/selection/omitted/${j}/id`,
            { entityId: o.id },
          ),
        );
      }
    });
    if (
      plan.knowledgeHash !== undefined &&
      knowledge.meta?.contentHash !== undefined &&
      plan.knowledgeHash !== knowledge.meta.contentHash
    ) {
      issues.push(
        err(
          "narrative/knowledge-hash-mismatch",
          "knowledgeHash does not match the supplied ProjectKnowledge.meta.contentHash — this narrative was planned from a different knowledge baseline",
          "/knowledgeHash",
        ),
      );
    }
    if (plan.knowledgeHash === undefined && knowledge.meta?.contentHash !== undefined) {
      issues.push(
        err(
          "narrative/knowledge-hash-missing",
          "the source ProjectKnowledge carries meta.contentHash but this NarrativePlan has no knowledgeHash binding",
          "/knowledgeHash",
        ),
      );
    }

    // ---- every classifiable knowledge id must be accounted for --------------
    const classifiable = new Set<string>();
    for (const collection of KNOWLEDGE_COLLECTIONS) {
      for (const raw of (knowledge[collection] ?? []) as Array<{ id?: unknown }>) {
        if (typeof raw.id === "string") classifiable.add(raw.id);
      }
    }
    const classified = new Set<string>([
      ...plan.selection.selected,
      ...plan.selection.deprioritized,
      ...plan.selection.omitted.map((o) => o.id),
    ]);
    for (const id of classifiable) {
      if (!classified.has(id)) {
        issues.push(
          err(
            "narrative/selection-unclassified",
            `knowledge id "${id}" is in neither selection.selected, .deprioritized nor .omitted — the plan cannot explain what happened to it`,
            "/selection",
            { entityId: id },
          ),
        );
      }
    }
  }

  return issues;
}

/* ------------------------------------------------------------------ */
/* SlidePlan                                                           */
/* ------------------------------------------------------------------ */

export interface SlidePlanContext {
  narrative?: NarrativePlan;
  knowledge?: ProjectKnowledge;
}

export function crossRefSlidePlan(plan: SlidePlan, ctx: SlidePlanContext = {}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { narrative, knowledge } = ctx;
  const ids = knowledge ? knowledgeIdSets(knowledge) : undefined;
  const knownSections = narrative ? new Set(narrative.sections.map((s) => s.id)) : undefined;

  // ---- self content-hash: meta.contentHash must be the plan's real identity ----
  if (
    plan.meta?.contentHash !== undefined &&
    plan.meta.contentHash !== slidePlanContentHash(plan)
  ) {
    issues.push(
      err(
        "plan/content-hash-mismatch",
        "meta.contentHash does not match the canonical hash of this SlidePlan (payload was modified without re-hashing)",
        "/meta/contentHash",
      ),
    );
  }

  const seenId = new Map<string, number>();
  const seenMessage = new Map<string, number>();
  const seenTitle = new Map<string, number>();
  const purposeCounts = new Map<string, number>();
  let covers = 0;
  let closings = 0;

  plan.slides.forEach((slide, i) => {
    const base = `/slides/${i}`;

    const prev = seenId.get(slide.id);
    if (prev !== undefined) {
      issues.push(
        err(
          "plan/duplicate-slide-id",
          `slide id "${slide.id}" already used at /slides/${prev}`,
          `${base}/id`,
          {
            entityId: slide.id,
          },
        ),
      );
    } else {
      seenId.set(slide.id, i);
    }

    if (slide.index !== i) {
      issues.push(
        err(
          "plan/slide-index-mismatch",
          `slide.index is ${slide.index} but the slide is at position ${i}`,
          `${base}/index`,
          { entityId: slide.id, hint: "slides[].index must be the 0-based array position" },
        ),
      );
    }

    const msgKey = slide.keyMessage.replace(/\s+/g, " ").trim().toLowerCase();
    const prevMsg = seenMessage.get(msgKey);
    if (prevMsg !== undefined) {
      issues.push(
        warn(
          "plan/duplicate-key-message",
          `slide shares its keyMessage with /slides/${prevMsg}`,
          `${base}/keyMessage`,
          { entityId: slide.id },
        ),
      );
    } else {
      seenMessage.set(msgKey, i);
    }

    const titleKey = slide.title.replace(/\s+/g, " ").trim().toLowerCase();
    const prevTitle = seenTitle.get(titleKey);
    if (prevTitle !== undefined) {
      issues.push(
        warn(
          "plan/duplicate-title",
          `slide shares its title with /slides/${prevTitle}`,
          `${base}/title`,
          {
            entityId: slide.id,
          },
        ),
      );
    } else {
      seenTitle.set(titleKey, i);
    }

    if (msgKey === titleKey) {
      issues.push(
        warn(
          "plan/key-message-equals-title",
          "keyMessage must say something the title does not",
          `${base}/keyMessage`,
          { entityId: slide.id },
        ),
      );
    }
    if (slide.keyMessage.length > 200) {
      issues.push(
        warn(
          "plan/key-message-long",
          `keyMessage is ${slide.keyMessage.length} chars; aim for <= 200`,
          `${base}/keyMessage`,
          { entityId: slide.id },
        ),
      );
    }

    if (
      slide.knowledgeRefs.length === 0 &&
      slide.kind !== "cover" &&
      slide.kind !== "closing" &&
      slide.kind !== "section"
    ) {
      issues.push(
        warn(
          "plan/slide-without-knowledge-refs",
          `slide "${slide.title}" has no knowledgeRefs`,
          `${base}/knowledgeRefs`,
          { entityId: slide.id },
        ),
      );
    }

    if (slide.kind === "cover") covers += 1;
    if (slide.kind === "closing") closings += 1;
    purposeCounts.set(slide.narrativePurpose, (purposeCounts.get(slide.narrativePurpose) ?? 0) + 1);

    // ---- roadmap / metrics / architecture integrity ---------------------
    const wantsTemporal =
      slide.kind === "roadmap" ||
      slide.kind === "timeline" ||
      slide.visualIntent === "roadmap" ||
      slide.visualIntent === "timeline";
    if (wantsTemporal) {
      const refs = [...slide.knowledgeRefs, ...(slide.visualCandidates ?? [])];
      const ok = ids ? refs.some((id) => ids.temporal.has(id)) : refs.length > 0;
      if (!ok) {
        issues.push(
          err(
            "plan/roadmap-without-temporal",
            "a roadmap/timeline slide needs phases, milestones or PRECEDES relations behind it",
            base,
            { entityId: slide.id },
          ),
        );
      }
    }

    const wantsMetrics = slide.kind === "metrics" || slide.visualIntent === "metrics";
    if (wantsMetrics) {
      const ok = ids
        ? slide.knowledgeRefs.some((id) => ids.metrics.has(id)) ||
          slide.claimRefs.some((id) => ids.claims.has(id))
        : slide.knowledgeRefs.length > 0 || slide.claimRefs.length > 0;
      if (!ok) {
        issues.push(
          err(
            "plan/metrics-without-metric-refs",
            "a metrics slide must reference a metric id or a supporting claim",
            base,
            { entityId: slide.id },
          ),
        );
      }
    }

    if (slide.visualIntent === "architecture") {
      const refs = [...slide.knowledgeRefs, ...(slide.visualCandidates ?? [])];
      const ok = ids
        ? refs.some((id) => ids.relations.has(id))
        : (slide.visualCandidates?.length ?? 0) > 0;
      if (!ok) {
        issues.push(
          warn(
            "plan/architecture-without-relationship",
            "an architecture visual intent should be backed by at least one relation",
            `${base}/visualIntent`,
            { entityId: slide.id },
          ),
        );
      }
    }

    // ---- reference resolution -----------------------------------------
    if (ids) {
      slide.knowledgeRefs.forEach((id, j) => {
        if (!ids.all.has(id)) {
          issues.push(
            err(
              "plan/unknown-knowledge-ref",
              `"${id}" is not a ProjectKnowledge id`,
              `${base}/knowledgeRefs/${j}`,
              {
                entityId: slide.id,
              },
            ),
          );
        }
      });
      slide.claimRefs.forEach((id, j) => {
        if (!ids.claims.has(id)) {
          issues.push(
            err("plan/unknown-claim-ref", `"${id}" is not a claim id`, `${base}/claimRefs/${j}`, {
              entityId: slide.id,
            }),
          );
        }
      });
      slide.sourceRefs.forEach((ref, j) => {
        if (typeof ref?.sourceId === "string" && !ids.sources.has(ref.sourceId)) {
          issues.push(
            err(
              "plan/unknown-source",
              `sourceRef points to unknown source "${ref.sourceId}"`,
              `${base}/sourceRefs/${j}`,
              { entityId: slide.id },
            ),
          );
        }
      });
      (slide.visualCandidates ?? []).forEach((id, j) => {
        if (!ids.all.has(id)) {
          issues.push(
            err(
              "plan/unknown-visual-candidate",
              `visualCandidate "${id}" is not a ProjectKnowledge id`,
              `${base}/visualCandidates/${j}`,
              { entityId: slide.id },
            ),
          );
        }
      });
    }

    // visualCandidates must be a subset of what the slide declares it represents
    const knowledgeRefSet = new Set(slide.knowledgeRefs);
    (slide.visualCandidates ?? []).forEach((id, j) => {
      if (!knowledgeRefSet.has(id)) {
        issues.push(
          warn(
            "plan/visual-candidate-unreferenced",
            `visualCandidate "${id}" is not among this slide's knowledgeRefs`,
            `${base}/visualCandidates/${j}`,
            { entityId: slide.id },
          ),
        );
      }
    });

    if (knownSections && !knownSections.has(slide.sectionId)) {
      issues.push(
        err(
          "plan/unknown-section",
          `slide.sectionId "${slide.sectionId}" is not a section in the narrative`,
          `${base}/sectionId`,
          { entityId: slide.id },
        ),
      );
    }
  });

  if (covers > 1)
    issues.push(err("plan/duplicate-cover", `${covers} cover slides; expected 1`, "/slides"));
  if (covers === 0)
    issues.push(warn("plan/missing-cover", "the deck has no cover slide", "/slides"));
  if (closings > 1) {
    issues.push(err("plan/multiple-closing", `${closings} closing slides; expected 1`, "/slides"));
  }
  if (closings === 0)
    issues.push(warn("plan/missing-closing", "the deck has no closing slide", "/slides"));

  for (const [purpose, count] of purposeCounts) {
    if (count > 5) {
      issues.push(
        warn(
          "plan/too-many-same-purpose",
          `${count} slides share the narrative purpose "${purpose}"`,
          "/slides",
        ),
      );
    }
  }

  // ---- budget must be honoured or explained --------------------------
  const noteCodes = new Set(plan.notes.map((n) => n.code));
  if (
    plan.slides.length > plan.budget.maxSlides &&
    !noteCodes.has("planning/over-budget-resolved")
  ) {
    issues.push(
      err(
        "plan/budget-exceeded",
        `${plan.slides.length} slides exceed maxSlides=${plan.budget.maxSlides} with no planning/over-budget-resolved note`,
        "/slides",
      ),
    );
  }
  if (plan.slides.length < plan.budget.minSlides && !noteCodes.has("planning/under-budget")) {
    issues.push(
      err(
        "plan/budget-under-unreported",
        `${plan.slides.length} slides are below minSlides=${plan.budget.minSlides} with no planning/under-budget note`,
        "/slides",
      ),
    );
  }

  if (narrative) {
    if (plan.audience !== narrative.audience) {
      issues.push(
        err(
          "plan/audience-mismatch",
          `slide plan audience "${plan.audience}" != narrative audience "${narrative.audience}"`,
          "/audience",
        ),
      );
    }
    if (!plan.narrativeRef) {
      issues.push(
        err(
          "plan/narrative-ref-missing",
          "a NarrativePlan was supplied but this SlidePlan has no narrativeRef binding",
          "/narrativeRef",
        ),
      );
    } else if (plan.narrativeRef !== narrativeContentHash(narrative)) {
      issues.push(
        err(
          "plan/narrative-ref-mismatch",
          "narrativeRef does not match the supplied NarrativePlan — this SlidePlan was derived from a different narrative",
          "/narrativeRef",
        ),
      );
    }
    // Narrative and slide plan must have been planned from the same knowledge.
    if (
      plan.knowledgeHash !== undefined &&
      narrative.knowledgeHash !== undefined &&
      plan.knowledgeHash !== narrative.knowledgeHash
    ) {
      issues.push(
        err(
          "plan/narrative-knowledge-hash-mismatch",
          "SlidePlan.knowledgeHash does not match NarrativePlan.knowledgeHash — narrative and slide plan come from different knowledge baselines",
          "/knowledgeHash",
        ),
      );
    }
    if (!knowledge && plan.knowledgeHash === undefined && narrative.knowledgeHash !== undefined) {
      issues.push(
        err(
          "plan/knowledge-hash-missing",
          "the supplied NarrativePlan carries knowledgeHash but this SlidePlan has no knowledgeHash binding",
          "/knowledgeHash",
        ),
      );
    }
  }

  if (knowledge) {
    if (
      plan.knowledgeHash !== undefined &&
      knowledge.meta?.contentHash !== undefined &&
      plan.knowledgeHash !== knowledge.meta.contentHash
    ) {
      issues.push(
        err(
          "plan/knowledge-hash-mismatch",
          "knowledgeHash does not match the supplied ProjectKnowledge.meta.contentHash — this SlidePlan was planned from a different knowledge baseline",
          "/knowledgeHash",
        ),
      );
    }
    if (plan.knowledgeHash === undefined && knowledge.meta?.contentHash !== undefined) {
      issues.push(
        err(
          "plan/knowledge-hash-missing",
          "the source ProjectKnowledge carries meta.contentHash but this SlidePlan has no knowledgeHash binding",
          "/knowledgeHash",
        ),
      );
    }
  }

  return issues;
}
