/**
 * Semantic / cross-reference checks that JSON Schema cannot express.
 *
 * These run only after schema validation has passed, so the input shape can be
 * trusted; access is still guarded defensively.
 */

import type { Claim, Relation, SourceRef } from "../types/common.js";
import type { ArclumeDeck, DiagramIR, Slide } from "../types/deck.js";
import type { ProjectKnowledge } from "../types/knowledge.js";
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

function hasResolvableSourceRef(
  refs: readonly SourceRef[] | undefined,
  knownSourceIds: ReadonlySet<string>,
): boolean {
  return (
    Array.isArray(refs) &&
    refs.some((r) => typeof r?.sourceId === "string" && knownSourceIds.has(r.sourceId))
  );
}

const WINDOWS_DRIVE_RE = /^[A-Za-z]:/;

/** True if the string contains any C0 control character or DEL. */
function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * True when `rawPath` is a POSIX-style path relative to a source root.
 *
 * Rejects: empty / whitespace-padded values, any backslash (`C:\x`, `\\unc`,
 * `\abs`, `foo\..\x`), a Windows drive letter (`C:/x`), an absolute or
 * protocol-relative prefix (`/abs`, `//host/share`), control characters, and
 * any empty or `..` path segment (`../x`, `foo/../x`, `a//b`).
 *
 * Pure string inspection: it never touches the filesystem and never rewrites
 * the value. Behaves identically on Windows, Linux and macOS.
 */
export function isSafeRelativeLocatorPath(rawPath: string): boolean {
  if (typeof rawPath !== "string" || rawPath.length === 0) return false;
  if (rawPath.trim() !== rawPath) return false;
  if (rawPath.includes("\\")) return false;
  if (hasControlChar(rawPath)) return false;
  if (WINDOWS_DRIVE_RE.test(rawPath)) return false;
  if (rawPath.startsWith("/")) return false;
  for (const segment of rawPath.split("/")) {
    if (segment === "" || segment === "..") return false;
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* ProjectKnowledge                                                    */
/* ------------------------------------------------------------------ */

const KNOWLEDGE_ENTITY_COLLECTIONS = [
  "capabilities",
  "components",
  "actors",
  "dependencies",
  "processes",
  "phases",
  "milestones",
  "metrics",
  "risks",
  "decisions",
  "requirements",
  "technologies",
  "results",
  "constraints",
] as const;

export function crossRefProjectKnowledge(doc: ProjectKnowledge): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const sourceIds = new Set<string>((doc.sources ?? []).map((s) => s.id));
  // `entityIds` = project + the 14 domain-entity collections. It deliberately
  // excludes sources, relations, claims and gaps.
  const entityIds = new Set<string>();
  const claimIds = new Set<string>((doc.claims ?? []).map((c) => c.id));
  const phaseIds = new Set<string>((doc.phases ?? []).map((p) => p.id));
  const metricIds = new Set<string>((doc.metrics ?? []).map((m) => m.id));
  const technologyIds = new Set<string>((doc.technologies ?? []).map((t) => t.id));

  // ---- unique ids across project + sources + all collections + relations/claims/gaps
  const idOwners = new Map<string, string>();
  const noteId = (id: string, path: string): void => {
    const prev = idOwners.get(id);
    if (prev !== undefined) {
      issues.push(
        err("cross-ref/duplicate-id", `id "${id}" is already used at ${prev}`, path, {
          entityId: id,
        }),
      );
    } else {
      idOwners.set(id, path);
    }
  };

  if (doc.project?.id) {
    noteId(doc.project.id, "/project");
    entityIds.add(doc.project.id);
  }
  (doc.sources ?? []).forEach((s, i) => noteId(s.id, `/sources/${i}`));
  for (const name of KNOWLEDGE_ENTITY_COLLECTIONS) {
    const list = (doc[name] ?? []) as ReadonlyArray<{ id: string }>;
    list.forEach((item, i) => {
      noteId(item.id, `/${name}/${i}`);
      entityIds.add(item.id);
    });
  }
  (doc.relations ?? []).forEach((r, i) => noteId(r.id, `/relations/${i}`));
  (doc.claims ?? []).forEach((c, i) => noteId(c.id, `/claims/${i}`));
  (doc.gaps ?? []).forEach((g, i) => noteId(g.id, `/gaps/${i}`));

  // ---- sourceRefs across every entity that carries them
  const checkRefs = (refs: readonly SourceRef[] | undefined, path: string): void => {
    (refs ?? []).forEach((ref, i) => {
      if (typeof ref?.sourceId === "string" && !sourceIds.has(ref.sourceId)) {
        issues.push(
          err(
            "cross-ref/unknown-source",
            `sourceRef points to unknown source "${ref.sourceId}"`,
            `${path}/sourceRefs/${i}`,
          ),
        );
      }
      checkLocator(ref, `${path}/sourceRefs/${i}`);
    });
  };

  const checkLocator = (ref: SourceRef | undefined, path: string): void => {
    const loc = ref?.locator;
    if (!loc) return;
    const locPath = `${path}/locator`;

    if (loc.kind === "file") {
      if (!isSafeRelativeLocatorPath(loc.path)) {
        issues.push(
          err(
            "cross-ref/unsafe-locator-path",
            `file locator path must be a POSIX-style path relative to the source root (no absolute, drive-letter, UNC, backslash or ".." segments): "${loc.path}"`,
            `${locPath}/path`,
          ),
        );
      }
      if (
        typeof loc.lineStart === "number" &&
        typeof loc.lineEnd === "number" &&
        loc.lineEnd < loc.lineStart
      ) {
        issues.push(
          err(
            "cross-ref/locator-range",
            `lineEnd (${loc.lineEnd}) is before lineStart (${loc.lineStart})`,
            locPath,
          ),
        );
      }
    } else if (loc.kind === "page") {
      if (typeof loc.pageEnd === "number" && loc.pageEnd < loc.page) {
        issues.push(
          err(
            "cross-ref/locator-range",
            `pageEnd (${loc.pageEnd}) is before page (${loc.page})`,
            locPath,
          ),
        );
      }
    } else if (loc.kind === "text-range") {
      if (loc.charEnd < loc.charStart) {
        issues.push(
          err(
            "cross-ref/locator-range",
            `charEnd (${loc.charEnd}) is before charStart (${loc.charStart})`,
            locPath,
          ),
        );
      }
    }
  };

  if (doc.project) checkRefs(doc.project.sourceRefs, "/project");
  for (const name of KNOWLEDGE_ENTITY_COLLECTIONS) {
    const list = (doc[name] ?? []) as ReadonlyArray<{ sourceRefs?: SourceRef[] }>;
    list.forEach((item, i) => checkRefs(item.sourceRefs, `/${name}/${i}`));
  }
  (doc.relations ?? []).forEach((r, i) => checkRefs(r.sourceRefs, `/relations/${i}`));
  (doc.claims ?? []).forEach((c, i) => checkRefs(c.sourceRefs, `/claims/${i}`));

  // ---- claims & risks: no silent FACT
  const checkFact = (
    item: { factType?: string; sourceRefs?: SourceRef[] },
    path: string,
    id: string,
  ): void => {
    if (item.factType === "FACT" && !hasResolvableSourceRef(item.sourceRefs, sourceIds)) {
      issues.push(
        err(
          "claim/fact-without-evidence",
          "a FACT must cite at least one resolvable source; classify as INFERENCE or add a sourceRef",
          path,
          { entityId: id, hint: "set factType to INFERENCE/UNKNOWN, or add sourceRefs" },
        ),
      );
    }
    if (
      item.factType === "INFERENCE" &&
      (!Array.isArray(item.sourceRefs) || item.sourceRefs.length === 0)
    ) {
      issues.push(
        warn(
          "claim/inference-without-basis",
          "an INFERENCE with no sourceRefs cannot be traced; consider adding the basis or marking it UNKNOWN",
          path,
          { entityId: id },
        ),
      );
    }
  };
  (doc.claims ?? []).forEach((c: Claim, i) => checkFact(c, `/claims/${i}`, c.id));
  (doc.risks ?? []).forEach((r, i) => checkFact(r, `/risks/${i}`, r.id));

  // ---- claim.supports -> project, a domain entity, or another claim (only)
  (doc.claims ?? []).forEach((c: Claim, i) => {
    (c.supports ?? []).forEach((target, j) => {
      if (!entityIds.has(target) && !claimIds.has(target)) {
        issues.push(
          err(
            "cross-ref/unknown-target",
            `claim.supports must reference the project, a domain entity, or another claim; "${target}" is not one of those`,
            `/claims/${i}/supports/${j}`,
            { entityId: c.id },
          ),
        );
      }
    });
  });

  // ---- relations endpoints
  (doc.relations ?? []).forEach((r: Relation, i) => {
    if (!entityIds.has(r.from)) {
      issues.push(
        err(
          "cross-ref/unknown-relation-endpoint",
          `relation.from references unknown entity "${r.from}"`,
          `/relations/${i}/from`,
          { entityId: r.id },
        ),
      );
    }
    if (!entityIds.has(r.to)) {
      issues.push(
        err(
          "cross-ref/unknown-relation-endpoint",
          `relation.to references unknown entity "${r.to}"`,
          `/relations/${i}/to`,
          { entityId: r.id },
        ),
      );
    }
  });

  // ---- milestone.phaseId, result.metricId, component.technologies
  (doc.milestones ?? []).forEach((m, i) => {
    if (typeof m.phaseId === "string" && !phaseIds.has(m.phaseId)) {
      issues.push(
        err(
          "cross-ref/unknown-target",
          `milestone.phaseId references unknown phase "${m.phaseId}"`,
          `/milestones/${i}/phaseId`,
          { entityId: m.id },
        ),
      );
    }
  });
  (doc.results ?? []).forEach((r, i) => {
    if (typeof r.metricId === "string" && !metricIds.has(r.metricId)) {
      issues.push(
        err(
          "cross-ref/unknown-target",
          `result.metricId references unknown metric "${r.metricId}"`,
          `/results/${i}/metricId`,
          { entityId: r.id },
        ),
      );
    }
  });
  (doc.components ?? []).forEach((c, i) => {
    (c.technologies ?? []).forEach((t, j) => {
      if (!technologyIds.has(t)) {
        issues.push(
          err(
            "cross-ref/unknown-target",
            `component.technologies references unknown technology "${t}"`,
            `/components/${i}/technologies/${j}`,
            { entityId: c.id },
          ),
        );
      }
    });
  });

  // ---- gap.blocks -> known ids
  (doc.gaps ?? []).forEach((g, i) => {
    (g.blocks ?? []).forEach((target, j) => {
      if (!entityIds.has(target)) {
        issues.push(
          err(
            "cross-ref/unknown-target",
            `gap.blocks references unknown entity "${target}"`,
            `/gaps/${i}/blocks/${j}`,
            { entityId: g.id },
          ),
        );
      }
    });
  });

  return issues;
}

/* ------------------------------------------------------------------ */
/* ArclumeDeck                                                         */
/* ------------------------------------------------------------------ */

const DIAGRAM_BLOCK_TYPES = new Set(["diagram", "architecture", "workflow"]);
const SLIDE_KINDS_ALLOWED_EMPTY = new Set(["cover", "section", "closing"]);

export function crossRefArclumeDeck(doc: ArclumeDeck): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const sourceIds = new Set<string>((doc.provenance?.sources ?? []).map((s) => s.id));
  const sectionIds = new Set<string>((doc.narrative?.sections ?? []).map((s) => s.id));
  const diagrams = doc.diagrams ?? [];
  const diagramById = new Map<string, DiagramIR>(diagrams.map((d) => [d.id, d]));

  // ---- unique ids across slides + blocks + diagrams + sections
  const idOwners = new Map<string, string>();
  const noteId = (id: string, path: string): void => {
    const prev = idOwners.get(id);
    if (prev !== undefined) {
      issues.push(
        err("cross-ref/duplicate-id", `id "${id}" is already used at ${prev}`, path, {
          entityId: id,
        }),
      );
    } else {
      idOwners.set(id, path);
    }
  };
  (doc.narrative?.sections ?? []).forEach((s, i) => noteId(s.id, `/narrative/sections/${i}`));
  diagrams.forEach((d, i) => noteId(d.id, `/diagrams/${i}`));
  (doc.slides ?? []).forEach((slide, i) => {
    noteId(slide.id, `/slides/${i}`);
    (slide.blocks ?? []).forEach((b, j) => noteId(b.id, `/slides/${i}/blocks/${j}`));
  });

  const checkRefs = (refs: readonly SourceRef[] | undefined, path: string): void => {
    (refs ?? []).forEach((ref, i) => {
      if (typeof ref?.sourceId === "string" && !sourceIds.has(ref.sourceId)) {
        issues.push(
          err(
            "cross-ref/unknown-source",
            `sourceRef points to unknown source "${ref.sourceId}"`,
            `${path}/sourceRefs/${i}`,
          ),
        );
      }
    });
  };

  checkRefs(doc.project?.sourceRefs, "/project");
  diagrams.forEach((d, i) => checkRefs(d.sourceRefs, `/diagrams/${i}`));

  // ---- slides
  (doc.slides ?? []).forEach((slide: Slide, i) => {
    const base = `/slides/${i}`;

    if (slide.index !== i) {
      issues.push(
        err(
          "deck/slide-index-mismatch",
          `slide.index is ${slide.index} but the slide is at position ${i}`,
          `${base}/index`,
          { entityId: slide.id, hint: "slides[].index must be the 0-based array position" },
        ),
      );
    }

    if (typeof slide.sectionId === "string" && !sectionIds.has(slide.sectionId)) {
      issues.push(
        err(
          "cross-ref/unknown-section",
          `slide.sectionId references unknown narrative section "${slide.sectionId}"`,
          `${base}/sectionId`,
          { entityId: slide.id },
        ),
      );
    }

    if (typeof slide.diagramRef === "string" && !diagramById.has(slide.diagramRef)) {
      issues.push(
        err(
          "cross-ref/unknown-diagram",
          `slide.diagramRef references unknown diagram "${slide.diagramRef}"`,
          `${base}/diagramRef`,
          { entityId: slide.id },
        ),
      );
    }

    if (typeof slide.keyMessage === "string" && slide.keyMessage.length > 200) {
      issues.push(
        warn(
          "slide/key-message-long",
          `keyMessage is ${slide.keyMessage.length} chars; aim for <= 200 so it reads as one idea`,
          `${base}/keyMessage`,
          { entityId: slide.id },
        ),
      );
    }

    const blocks = slide.blocks ?? [];
    if (blocks.length === 0 && !SLIDE_KINDS_ALLOWED_EMPTY.has(slide.kind)) {
      issues.push(
        warn("deck/empty-slide", `slide of kind "${slide.kind}" has no blocks`, `${base}/blocks`, {
          entityId: slide.id,
        }),
      );
    }

    // ---- evidence: no silent FACT
    (slide.evidence ?? []).forEach((ev, j) => {
      const evPath = `${base}/evidence/${j}`;
      const resolvable = hasResolvableSourceRef(ev.sourceRefs, sourceIds);
      (ev.sourceRefs ?? []).forEach((ref, k) => {
        if (typeof ref?.sourceId === "string" && !sourceIds.has(ref.sourceId)) {
          issues.push(
            err(
              "cross-ref/unknown-source",
              `evidence sourceRef points to unknown source "${ref.sourceId}"`,
              `${evPath}/sourceRefs/${k}`,
              { entityId: slide.id },
            ),
          );
        }
      });
      if (ev.factType === "FACT" && !resolvable) {
        issues.push(
          err(
            "evidence/fact-without-evidence",
            "evidence classified as FACT has no resolvable source",
            evPath,
            { entityId: slide.id },
          ),
        );
      }
      if (
        ev.factType === undefined &&
        ev.claimId === undefined &&
        (!Array.isArray(ev.sourceRefs) || ev.sourceRefs.length === 0)
      ) {
        issues.push(
          warn(
            "evidence/empty",
            "evidence has neither a claimId, a factType, nor sourceRefs",
            evPath,
            {
              entityId: slide.id,
            },
          ),
        );
      }
    });

    // ---- blocks
    blocks.forEach((block, j) => {
      const bPath = `${base}/blocks/${j}`;
      checkRefs(block.sourceRefs, bPath);

      if (DIAGRAM_BLOCK_TYPES.has(block.type)) {
        const ref = (block as { diagramRef?: unknown }).diagramRef;
        if (typeof ref === "string") {
          const target = diagramById.get(ref);
          if (!target) {
            issues.push(
              err(
                "cross-ref/unknown-diagram",
                `${block.type} block references unknown diagram "${ref}"`,
                `${bPath}/diagramRef`,
                { entityId: block.id },
              ),
            );
          } else if (
            (block.type === "architecture" || block.type === "workflow") &&
            target.diagramType !== block.type &&
            target.diagramType !== "unspecified"
          ) {
            issues.push(
              warn(
                "block/diagram-type-mismatch",
                `${block.type} block points to diagram "${ref}" whose diagramType is "${target.diagramType}"`,
                `${bPath}/diagramRef`,
                { entityId: block.id },
              ),
            );
          }
        }
      }

      if (block.type === "table") {
        const cols = Array.isArray(block.columns) ? block.columns.length : 0;
        (block.rows ?? []).forEach((row, r) => {
          if (!Array.isArray(row) || row.length !== cols) {
            issues.push(
              err(
                "block/table-row-arity",
                `table row ${r} has ${Array.isArray(row) ? row.length : 0} cells but there are ${cols} columns`,
                `${bPath}/rows/${r}`,
                { entityId: block.id },
              ),
            );
          }
        });
      }

      if (block.type === "text" && typeof block.text === "string" && block.text.length > 800) {
        issues.push(
          warn(
            "block/text-wall",
            `text block is ${block.text.length} chars; split it or move detail to speakerNotes`,
            bPath,
            { entityId: block.id },
          ),
        );
      }
    });
  });

  return issues;
}
