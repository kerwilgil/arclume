/**
 * Version identifiers and SemVer policy helpers for Arclume artifacts.
 *
 * See `docs/STABILITY.md` for the full policy. Summary:
 *  - MAJOR 0: pre-stable. Breaking changes may land between MINOR versions and
 *    are documented in `docs/STABILITY.md`.
 *  - >= 1.0.0: MAJOR = breaking IR change; MINOR = additive/optional; PATCH =
 *    non-normative (docs, messages).
 *  - A validator accepts a document whose MAJOR matches the supported version.
 *    A higher MINOR than supported is accepted with a warning. A different
 *    MAJOR is rejected unless a migration exists.
 */

/**
 * Current version of the `ArclumeDeck` IR.
 *
 * 0.2.0 (Phase 4): widened `slides[].keyMessage` maxLength 200 → 240 to match
 * the upstream `SlidePlan.keyMessage` cap, and added optional
 * `provenance.narrativeRef` / `provenance.slidePlanRef` hash bindings. Both are
 * loosening / additive changes — every `0.1.0` deck stays valid under `0.2.0`
 * (a `0.1.0 -> 0.2.0` migration step just restamps `irVersion`).
 */
export const IR_VERSION = "0.2.0" as const;

/** Current version of the `ProjectKnowledge` model. */
export const KNOWLEDGE_VERSION = "0.1.0" as const;

/** Current version of the `AnalysisResult` (Reasoner output) contract. */
export const ANALYSIS_VERSION = "0.1.0" as const;

/** Current version of the `NarrativePlan` contract (Phase 3). */
export const NARRATIVE_VERSION = "0.1.0" as const;

/** Current version of the `SlidePlan` contract (Phase 3). */
export const SLIDE_PLAN_VERSION = "0.1.0" as const;

/**
 * Current version of the Chromium Visual QA contract (Phase 6): the
 * `VisualQaResult` shape, its finding codes, `visual-qa.json` and the Visual QA
 * receipt. Independent of `IR_VERSION` and `HTML_RENDERER_VERSION` — it changes
 * when the QA contract changes, not when the deck IR or the HTML output does.
 */
export const VISUAL_QA_VERSION = "0.1.0" as const;

/** Current version of the atomic delivery manifest / receipt bundle (Phase 6). */
export const DELIVERY_MANIFEST_VERSION = "0.1.0" as const;

/** Stable identifiers of the bundled JSON Schemas (not network locations). */
export const SCHEMA_IDS = {
  common: "https://arclume.dev/schema/common.json",
  projectKnowledge: "https://arclume.dev/schema/project-knowledge.json",
  arclumeDeck: "https://arclume.dev/schema/arclume-deck.json",
  analysisResult: "https://arclume.dev/schema/analysis-result.json",
  narrativePlan: "https://arclume.dev/schema/narrative-plan.json",
  slidePlan: "https://arclume.dev/schema/slide-plan.json",
} as const;

export interface ParsedSemVer {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string;
}

const SEMVER_RE = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z.-]+))?$/;

/** Parse a SemVer core string, or return `undefined` if malformed. */
export function parseSemVer(value: string): ParsedSemVer | undefined {
  const m = SEMVER_RE.exec(value);
  if (!m) return undefined;
  const [, major, minor, patch, prerelease] = m;
  const parsed: ParsedSemVer = {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
  };
  if (prerelease !== undefined) parsed.prerelease = prerelease;
  return parsed;
}

export type CompatibilityLevel = "compatible" | "newer-minor" | "incompatible";

export interface CompatibilityResult {
  level: CompatibilityLevel;
  supported: string;
  found: string;
  message: string;
}

/**
 * Compare a document's declared version against the version this build supports.
 * Pure and deterministic; does not throw on malformed input.
 */
export function checkCompatibility(found: string, supported: string): CompatibilityResult {
  const f = parseSemVer(found);
  const s = parseSemVer(supported);
  if (!f || !s) {
    return {
      level: "incompatible",
      supported,
      found,
      message: `version string is not valid SemVer: "${found}"`,
    };
  }
  if (f.major !== s.major) {
    return {
      level: "incompatible",
      supported,
      found,
      message: `major version ${f.major} differs from supported major ${s.major}; a migration is required`,
    };
  }
  if (f.minor > s.minor) {
    return {
      level: "newer-minor",
      supported,
      found,
      message: `minor version ${f.minor} is newer than supported ${s.minor}; unknown additive fields may be ignored`,
    };
  }
  return {
    level: "compatible",
    supported,
    found,
    message: "version is compatible",
  };
}
