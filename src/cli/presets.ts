/**
 * Phase 9 CLI presets — named, versioned, deterministic mappings to EXISTING
 * narrative audiences + visual themes. A preset is configuration, not IR and
 * not a new planner: it only selects `(audience, theme)`.
 */

import { type DeckTypeName, isDeckTypeName } from "../narrative/deck-types.js";
import { type AudienceName, isAudienceName } from "../narrative/types.js";
import type { ThemeId } from "../visual/theme.js";

export const CLI_PRESET_VERSION = "0.1.0";

export interface ArclumePreset {
  id: string;
  description: string;
  audience: AudienceName;
  theme: ThemeId;
}

export const ARCLUME_PRESETS: readonly ArclumePreset[] = [
  {
    id: "executive",
    description: "Decision-oriented deck: executive audience, executive theme.",
    audience: "executive",
    theme: "executive",
  },
  {
    id: "technical",
    description: "Evidence-dense deck: technical audience, minimal theme.",
    audience: "technical",
    theme: "minimal",
  },
  {
    id: "general",
    description: "Neutral default: general audience, minimal theme.",
    audience: "general",
    theme: "minimal",
  },
] as const;

export const PRESET_IDS: readonly string[] = ARCLUME_PRESETS.map((p) => p.id);

/** Throws' a CliUsageError-flavoured message on an unknown preset id. */
export function getPreset(id: string): ArclumePreset | undefined {
  return ARCLUME_PRESETS.find((p) => p.id === id);
}

/**
 * Resolve the `audience` flag against the product-intelligence audience presets.
 * Accepted values are the seven AudienceName ids — this command accepts the
 * same closed vocabulary the narrative presets use.
 */
export function resolveAudienceFlag(value: string): AudienceName | undefined {
  return isAudienceName(value) ? value : undefined;
}

/** Resolve the `deck-type` flag against the product-intelligence deck types. */
export function resolveDeckTypeFlag(value: string): DeckTypeName | undefined {
  return isDeckTypeName(value) ? value : undefined;
}
