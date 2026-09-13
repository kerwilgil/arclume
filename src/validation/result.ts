/**
 * Validation result types shared by schema validation and semantic checks.
 */

export type IssueSeverity = "error" | "warning";

/**
 * A single validation finding with enough context to locate it in the document.
 * `code` is a stable, machine-readable slug; `message` is human-facing.
 */
export interface ValidationIssue {
  severity: IssueSeverity;
  /** Stable slug, e.g. `schema/additional-properties`, `claim/fact-without-evidence`. */
  code: string;
  message: string;
  /** RFC 6901 JSON Pointer into the instance, e.g. `/slides/2/blocks/0`. */
  instancePath: string;
  /** JSON Pointer into the schema that raised the issue, when applicable. */
  schemaPath?: string;
  /** `id` of the nearest enclosing entity/slide/block/section, when resolvable. */
  entityId?: string;
  /** Kind of that nearest enclosing object, e.g. `slide`, `block`, `component`. */
  entityKind?: string;
  /** A human label of that object (`name`/`title`/`label`/`statement`), when present. */
  label?: string;
  /** Actionable hint for fixing the issue. */
  hint?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

export function emptyResult(): ValidationResult {
  return { valid: true, errors: [], warnings: [] };
}

/** Merge `issues` into `result`, updating `valid`. Returns the same object. */
export function addIssues(
  result: ValidationResult,
  issues: readonly ValidationIssue[],
): ValidationResult {
  for (const issue of issues) {
    if (issue.severity === "error") result.errors.push(issue);
    else result.warnings.push(issue);
  }
  result.valid = result.errors.length === 0;
  return result;
}

/** Stable ordering: by instancePath, then severity (errors first), then code. */
export function sortIssues(issues: ValidationIssue[]): ValidationIssue[] {
  return [...issues].sort((a, b) => {
    if (a.instancePath !== b.instancePath) {
      return a.instancePath < b.instancePath ? -1 : 1;
    }
    if (a.severity !== b.severity) return a.severity === "error" ? -1 : 1;
    return a.code < b.code ? -1 : a.code > b.code ? 1 : 0;
  });
}
