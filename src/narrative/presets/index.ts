import type { AudienceName } from "../types.js";
import { clientPreset } from "./client.js";
import { executivePreset } from "./executive.js";
import { generalPreset } from "./general.js";
import { internalReviewPreset } from "./internal-review.js";
import { investorPreset } from "./investor.js";
import { productPreset } from "./product.js";
import { technicalPreset } from "./technical.js";
import type { AudienceProfile } from "./types.js";

export type { AudienceProfile, SectionTemplate, SectionSourceSpec, ProjectField } from "./types.js";
export { executivePreset } from "./executive.js";
export { technicalPreset } from "./technical.js";
export { generalPreset } from "./general.js";
export { productPreset } from "./product.js";
export { clientPreset } from "./client.js";
export { investorPreset } from "./investor.js";
export { internalReviewPreset } from "./internal-review.js";

const PRESETS: Record<AudienceName, AudienceProfile> = {
  executive: executivePreset,
  technical: technicalPreset,
  general: generalPreset,
  product: productPreset,
  client: clientPreset,
  investor: investorPreset,
  "internal-review": internalReviewPreset,
};

/** The list of audience presets the planner implements. */
export const AUDIENCE_NAMES: readonly AudienceName[] = [
  "executive",
  "technical",
  "general",
  "product",
  "client",
  "investor",
  "internal-review",
];

/** Look up a preset. Throws on an unknown audience — callers validate first. */
export function getAudienceProfile(name: AudienceName): AudienceProfile {
  const preset = PRESETS[name];
  if (!preset) throw new Error(`arclume: no narrative preset for audience "${name}"`);
  return preset;
}
