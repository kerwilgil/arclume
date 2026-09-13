import type { ValidationIssue } from "../validation/result.js";

/** Compact, human-readable rendering of validation issues for CLI hints. */
export function formatIssues(issues: readonly ValidationIssue[], max = 3): string {
  return issues
    .slice(0, max)
    .map((i) => `${i.code}: ${i.message}`)
    .join("\n");
}
