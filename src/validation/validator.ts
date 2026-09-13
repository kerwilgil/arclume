/**
 * Public validation entry points.
 *
 * Each validator runs three layers, in order:
 *   1. version compatibility (`irVersion` / `knowledgeVersion`)
 *   2. JSON Schema (AJV, draft 2020-12) with enriched error formatting
 *   3. semantic / cross-reference checks (only if the schema layer passed)
 *
 * Everything here is pure and deterministic: no network, no clock, no random.
 */

import type { NarrativePlan } from "../narrative/types.js";
import type { SlidePlan } from "../planning/types.js";
import { getCompiledSchemas } from "../schema/loader.js";
import type { ArclumeDeck } from "../types/deck.js";
import type { ProjectKnowledge } from "../types/knowledge.js";
import {
  ANALYSIS_VERSION,
  IR_VERSION,
  KNOWLEDGE_VERSION,
  NARRATIVE_VERSION,
  SLIDE_PLAN_VERSION,
  checkCompatibility,
} from "../version.js";
import { crossRefArclumeDeck, crossRefProjectKnowledge } from "./cross-ref.js";
import { type DeckContext, crossRefArclumeDeckContext } from "./deck-cross-ref.js";
import { formatAjvErrors } from "./format-error.js";
import {
  type SlidePlanContext,
  crossRefNarrativePlan,
  crossRefSlidePlan,
} from "./plan-cross-ref.js";
import {
  type ValidationIssue,
  type ValidationResult,
  addIssues,
  emptyResult,
  sortIssues,
} from "./result.js";

function versionIssues(found: unknown, supported: string, field: string): ValidationIssue[] {
  if (typeof found !== "string") {
    // schema layer will also report this; keep a clear semantic note too
    return [
      {
        severity: "error",
        code: "version/missing",
        message: `"${field}" is required and must be a SemVer string`,
        instancePath: `/${field}`,
      },
    ];
  }
  const compat = checkCompatibility(found, supported);
  if (compat.level === "compatible") return [];
  if (compat.level === "newer-minor") {
    return [
      {
        severity: "warning",
        code: "version/newer-minor",
        message: compat.message,
        instancePath: `/${field}`,
        hint: `this build targets ${supported}`,
      },
    ];
  }
  return [
    {
      severity: "error",
      code: "version/incompatible",
      message: compat.message,
      instancePath: `/${field}`,
      hint: `this build targets ${supported}; run a migration to ${supported}`,
    },
  ];
}

function finalize(result: ValidationResult): ValidationResult {
  result.errors = sortIssues(result.errors);
  result.warnings = sortIssues(result.warnings);
  result.valid = result.errors.length === 0;
  return result;
}

/** Validate a `ProjectKnowledge` document. Never throws on invalid input. */
export function validateProjectKnowledge(input: unknown): ValidationResult {
  const result = emptyResult();
  const doc = input as { knowledgeVersion?: unknown };

  addIssues(result, versionIssues(doc?.knowledgeVersion, KNOWLEDGE_VERSION, "knowledgeVersion"));

  const { projectKnowledge } = getCompiledSchemas();
  const schemaOk = projectKnowledge(input) as boolean;
  if (!schemaOk) {
    addIssues(result, formatAjvErrors(projectKnowledge.errors, input));
  }

  if (result.errors.length === 0) {
    addIssues(result, crossRefProjectKnowledge(input as ProjectKnowledge));
  }

  return finalize(result);
}

/**
 * Validate an `ArclumeDeck` document. Never throws on invalid input.
 *
 * Pass `{ knowledge, narrative, slidePlan }` (any subset) to also run the
 * Phase 4 structural checks: artifact binding (no stale / mixed baseline),
 * 1:1 slide binding, `keyMessage` integrity, and resolution of every metric /
 * risk / temporal / diagram reference against the real knowledge.
 */
export function validateArclumeDeck(input: unknown, ctx: DeckContext = {}): ValidationResult {
  const result = emptyResult();
  const doc = input as { irVersion?: unknown };

  addIssues(result, versionIssues(doc?.irVersion, IR_VERSION, "irVersion"));

  const { arclumeDeck } = getCompiledSchemas();
  const schemaOk = arclumeDeck(input) as boolean;
  if (!schemaOk) {
    addIssues(result, formatAjvErrors(arclumeDeck.errors, input));
  }

  if (result.errors.length === 0) {
    addIssues(result, crossRefArclumeDeck(input as ArclumeDeck));
    if (ctx.knowledge || ctx.narrative || ctx.slidePlan) {
      addIssues(result, crossRefArclumeDeckContext(input as ArclumeDeck, ctx));
    }
  }

  return finalize(result);
}

/**
 * Validate an `AnalysisResult` (a Reasoner's structured output) against its
 * schema. This is a shape gate only — the KnowledgeBuilder still normalizes,
 * resolves references and re-validates the resulting `ProjectKnowledge`.
 * Never throws on invalid input.
 */
export function validateAnalysisResult(input: unknown): ValidationResult {
  const result = emptyResult();
  const doc = input as { analysisVersion?: unknown };

  addIssues(result, versionIssues(doc?.analysisVersion, ANALYSIS_VERSION, "analysisVersion"));

  const { analysisResult } = getCompiledSchemas();
  const schemaOk = analysisResult(input) as boolean;
  if (!schemaOk) {
    addIssues(result, formatAjvErrors(analysisResult.errors, input));
  }

  return finalize(result);
}

/**
 * Validate a `NarrativePlan` (Phase 3). Pass the source `ProjectKnowledge` to
 * also resolve every `knowledgeRefs` id. Never throws on invalid input.
 */
export function validateNarrativePlan(
  input: unknown,
  knowledge?: ProjectKnowledge,
): ValidationResult {
  const result = emptyResult();
  const doc = input as { narrativeVersion?: unknown };

  addIssues(result, versionIssues(doc?.narrativeVersion, NARRATIVE_VERSION, "narrativeVersion"));

  const { narrativePlan } = getCompiledSchemas();
  const schemaOk = narrativePlan(input) as boolean;
  if (!schemaOk) {
    addIssues(result, formatAjvErrors(narrativePlan.errors, input));
  }

  if (result.errors.length === 0) {
    addIssues(result, crossRefNarrativePlan(input as NarrativePlan, knowledge));
  }

  return finalize(result);
}

/**
 * Validate a `SlidePlan` (Phase 3). Pass `{ narrative, knowledge }` to also
 * check section references, id resolution and the narrative link. Never throws.
 */
export function validateSlidePlan(input: unknown, ctx: SlidePlanContext = {}): ValidationResult {
  const result = emptyResult();
  const doc = input as { planVersion?: unknown };

  addIssues(result, versionIssues(doc?.planVersion, SLIDE_PLAN_VERSION, "planVersion"));

  const { slidePlan } = getCompiledSchemas();
  const schemaOk = slidePlan(input) as boolean;
  if (!schemaOk) {
    addIssues(result, formatAjvErrors(slidePlan.errors, input));
  }

  if (result.errors.length === 0) {
    addIssues(result, crossRefSlidePlan(input as SlidePlan, ctx));
  }

  return finalize(result);
}

/** Format a result as a stable, human-readable report. */
export function formatValidationReport(result: ValidationResult): string {
  const lines: string[] = [];
  const render = (issue: ValidationIssue): string => {
    const loc = issue.instancePath || "/";
    const ctx =
      issue.entityKind || issue.entityId || issue.label
        ? ` (${[issue.entityKind, issue.entityId, issue.label ? `“${issue.label}”` : undefined]
            .filter(Boolean)
            .join(" ")})`
        : "";
    const hint = issue.hint ? `\n    hint: ${issue.hint}` : "";
    return `  [${issue.severity}] ${issue.code} at ${loc}${ctx}\n    ${issue.message}${hint}`;
  };
  lines.push(result.valid ? "VALID" : "INVALID");
  if (result.errors.length > 0) {
    lines.push(`${result.errors.length} error(s):`);
    for (const e of result.errors) lines.push(render(e));
  }
  if (result.warnings.length > 0) {
    lines.push(`${result.warnings.length} warning(s):`);
    for (const w of result.warnings) lines.push(render(w));
  }
  return lines.join("\n");
}
