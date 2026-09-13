/**
 * Manifest construction + delivery-id derivation. Pure — no filesystem here.
 */

import { DeliveryError } from "../errors.js";
import { sha256Utf8 } from "../validation/visual-qa/util.js";
import { DELIVERY_MANIFEST_VERSION } from "../version.js";
import { validateBundleRelativePath } from "./paths.js";
import type { DeliveryManifest, ManifestEntry } from "./types.js";

/**
 * Hash-derived delivery id (spec §74). Deterministic: same deck + same HTML +
 * same QA config ⇒ same id. Never a timestamp / PID / username.
 */
export function deriveDeliveryId(parts: {
  deckContentHash: string;
  htmlSha256: string;
  configHash: string;
}): string {
  const seed = `${parts.deckContentHash}|${parts.htmlSha256}|${parts.configHash}`;
  return sha256Utf8(seed).slice(0, 32);
}

/**
 * Build the manifest from already-hashed entries. Entries are sorted by path.
 * Every entry path must be a safe bundle-relative path and unique — an unsafe
 * or duplicate path is a `DeliveryError`, never silently written.
 */
export function buildManifest(input: {
  deliveryId: string;
  entries: readonly ManifestEntry[];
  visualQa: { valid: boolean; version: string };
}): DeliveryManifest {
  const seen = new Set<string>();
  for (const e of input.entries) {
    const check = validateBundleRelativePath(e.path);
    if (!check.ok) {
      throw new DeliveryError(
        `manifest entry "${e.path}" is not a safe bundle path: ${check.reason}`,
        {
          code: "delivery/unsafe-path",
        },
      );
    }
    if (seen.has(e.path)) {
      throw new DeliveryError(`manifest entry "${e.path}" is listed more than once`, {
        code: "delivery/duplicate-path",
      });
    }
    seen.add(e.path);
  }
  const entries = [...input.entries].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
  return {
    manifestVersion: DELIVERY_MANIFEST_VERSION,
    deliveryId: input.deliveryId,
    visualQa: { valid: input.visualQa.valid, version: input.visualQa.version },
    entries,
  };
}
