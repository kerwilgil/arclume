/**
 * Atomic delivery (Phase 6) — public shapes.
 *
 * A delivery bundle is written to a *staging* sibling directory, hashed,
 * manifested, verified and gated on `VisualQaResult.valid`; only then is it
 * renamed into place. The rename is the commit boundary — a partial bundle is
 * never published.
 */

import type { ResolvedDiagramArtifact } from "../engines/types.js";
import type { ArclumeDeck } from "../types/deck.js";
import type {
  ScreenshotArtifact,
  VisualQaReceipt,
  VisualQaResult,
} from "../validation/visual-qa/types.js";
import { DELIVERY_MANIFEST_VERSION } from "../version.js";

export { DELIVERY_MANIFEST_VERSION as MANIFEST_VERSION };

export const MANIFEST_FILENAME = "manifest.json";

export interface ManifestEntry {
  /** Bundle-relative POSIX path. */
  path: string;
  bytes: number;
  /** Lowercase hex SHA-256 of the file bytes. */
  sha256: string;
}

export interface DeliveryManifest {
  manifestVersion: string;
  /** Hash-derived id (deck + HTML + QA config). Not a timestamp. */
  deliveryId: string;
  visualQa: { valid: boolean; version: string };
  /** Every bundle artifact except `manifest.json` itself, sorted by path. */
  entries: ManifestEntry[];
}

export interface DeliveryArtifactInput {
  deck: ArclumeDeck;
  html: string;
  visualQa: VisualQaResult;
  receipt: VisualQaReceipt;
  screenshots: ScreenshotArtifact[];
  /**
   * Resolved diagram artifacts (Phase 7). Together with `deck` they form the
   * `CanonicalDeckRenderInput`; the delivered HTML must equal
   * `renderCanonicalDeckHtml({ deck, diagramArtifacts }).html` byte-for-byte.
   */
  diagramArtifacts?: ReadonlyMap<string, ResolvedDiagramArtifact> | undefined;
}

/** Test / advanced hooks that can throw at a specific point in the staging flow. */
export interface DeliveryHooks {
  afterHtml?: () => void | Promise<void>;
  afterScreenshots?: () => void | Promise<void>;
  beforeManifest?: () => void | Promise<void>;
  beforeRename?: () => void | Promise<void>;
}

export interface DeliveryOptions {
  /** Keep the staging directory when a delivery fails (default: remove it). */
  keepFailedStaging?: boolean;
  hooks?: DeliveryHooks;
}

export interface DeliveryResult {
  delivered: boolean;
  destination: string;
  deliveryId: string;
  manifest: DeliveryManifest;
  entries: ManifestEntry[];
  visualQaValid: boolean;
}

export interface ManifestIssue {
  code: string;
  path?: string;
  message: string;
}

export interface ManifestVerification {
  valid: boolean;
  deliveryId: string;
  issues: ManifestIssue[];
}
