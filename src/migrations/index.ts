/**
 * Migration registry skeleton.
 *
 * Phase 1 ships the machinery and an identity step for the current version.
 * No fictional migrations. Real steps are added when a version actually
 * introduces a breaking change (see `docs/STABILITY.md`).
 */

import { IR_VERSION, KNOWLEDGE_VERSION, parseSemVer } from "../version.js";

export type ArtifactKind = "deck" | "knowledge";

export interface MigrationContext {
  kind: ArtifactKind;
  from: string;
  to: string;
}

export interface MigrationStep {
  kind: ArtifactKind;
  /** Exact source version this step upgrades *from*. */
  from: string;
  /** Version this step produces. */
  to: string;
  description: string;
  /** Pure transform. Must not mutate `doc`; returns a new object. */
  apply: (doc: unknown, ctx: MigrationContext) => unknown;
}

/**
 * Ordered list of known steps.
 *
 * `deck 0.1.0 -> 0.2.0` (Phase 4) is a pure restamp: 0.2.0 only *widens*
 * `keyMessage` and *adds* optional `provenance.*Ref` fields, so every 0.1.0
 * deck is already a valid 0.2.0 deck.
 */
export const MIGRATION_STEPS: readonly MigrationStep[] = [
  {
    kind: "deck",
    from: "0.1.0",
    to: "0.2.0",
    description:
      "widen slides[].keyMessage to 240 and add optional provenance.narrativeRef / provenance.slidePlanRef (no payload change)",
    apply: (doc) => {
      const src = (doc ?? {}) as Record<string, unknown>;
      return { ...src, irVersion: "0.2.0" };
    },
  },
];

export interface MigrationResult {
  migrated: boolean;
  fromVersion: string;
  toVersion: string;
  appliedSteps: string[];
  doc: unknown;
}

function currentVersionFor(kind: ArtifactKind): string {
  return kind === "deck" ? IR_VERSION : KNOWLEDGE_VERSION;
}

function readVersion(kind: ArtifactKind, doc: unknown): string | undefined {
  const field = kind === "deck" ? "irVersion" : "knowledgeVersion";
  const value = (doc as Record<string, unknown> | null)?.[field];
  return typeof value === "string" ? value : undefined;
}

/**
 * Upgrade `doc` to `targetVersion` (default: the version this build supports)
 * by applying registered steps in order.
 *
 * Throws if the document has no version, if versions are malformed, or if no
 * path of steps connects the source and target versions.
 */
export function migrate(
  kind: ArtifactKind,
  doc: unknown,
  targetVersion: string = currentVersionFor(kind),
): MigrationResult {
  const fromVersion = readVersion(kind, doc);
  if (fromVersion === undefined) {
    throw new Error(`migrate: ${kind} document has no version field`);
  }
  if (!parseSemVer(fromVersion) || !parseSemVer(targetVersion)) {
    throw new Error(`migrate: malformed version (from="${fromVersion}", to="${targetVersion}")`);
  }

  if (fromVersion === targetVersion) {
    return {
      migrated: false,
      fromVersion,
      toVersion: targetVersion,
      appliedSteps: [],
      doc,
    };
  }

  const appliedSteps: string[] = [];
  let current = doc;
  let cursor = fromVersion;
  const guard = MIGRATION_STEPS.length + 1;
  for (let i = 0; i <= guard; i += 1) {
    if (cursor === targetVersion) {
      return {
        migrated: appliedSteps.length > 0,
        fromVersion,
        toVersion: targetVersion,
        appliedSteps,
        doc: current,
      };
    }
    const step = MIGRATION_STEPS.find((s) => s.kind === kind && s.from === cursor);
    if (!step) {
      throw new Error(
        `migrate: no migration step for ${kind} from "${cursor}" toward "${targetVersion}"`,
      );
    }
    current = step.apply(current, { kind, from: step.from, to: step.to });
    appliedSteps.push(`${step.from}->${step.to}`);
    cursor = step.to;
  }
  throw new Error(`migrate: step graph did not converge for ${kind}`);
}
