/**
 * Atomic delivery (Phase 6) — public surface.
 *
 * `deliverAtomic` writes a bundle to a staging sibling, hashes it, manifests it,
 * verifies it, gates on `VisualQaResult.valid`, and only then renames it into
 * place. `verifyManifest` re-checks a delivered bundle (tamper detection).
 */

export { deliverAtomic } from "./atomic.js";
export { validateDeliveryBindings } from "./bindings.js";
export { buildManifest, deriveDeliveryId } from "./manifest.js";
export {
  validateBundleRelativePath,
  resolveConfined,
  type PathCheck,
} from "./paths.js";
export { verifyManifest, hashFile } from "./verify.js";
export {
  MANIFEST_VERSION,
  MANIFEST_FILENAME,
  type DeliveryArtifactInput,
  type DeliveryHooks,
  type DeliveryManifest,
  type DeliveryOptions,
  type DeliveryResult,
  type ManifestEntry,
  type ManifestIssue,
  type ManifestVerification,
} from "./types.js";
