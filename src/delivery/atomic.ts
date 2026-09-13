/**
 * `deliverAtomic` — stage → hash → manifest → verify → gate on QA → rename.
 *
 * The final `rename(staging → destination)` is the commit boundary. If anything
 * fails before it, the destination never appears and any previous delivery at
 * that path is left untouched. A staging directory left by a failed run is
 * cleaned best-effort (and the failure is reported if cleanup itself fails).
 */

import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { contentHash } from "../determinism/hash.js";
import { DeliveryError } from "../errors.js";
import { stableJson } from "../pipeline/artifacts.js";
import { visualQaJson } from "../validation/visual-qa/receipt.js";
import { checkPhase6Schema } from "../validation/visual-qa/schema.js";
import { sha256Utf8 } from "../validation/visual-qa/util.js";
import { validateDeliveryBindings } from "./bindings.js";
import { buildManifest, deriveDeliveryId } from "./manifest.js";
import { validateBundleRelativePath } from "./paths.js";
import type {
  DeliveryArtifactInput,
  DeliveryManifest,
  DeliveryOptions,
  DeliveryResult,
  ManifestEntry,
} from "./types.js";
import { MANIFEST_FILENAME } from "./types.js";
import { hashFile, verifyManifest } from "./verify.js";

const DECK_JSON = "arclume-deck.json";
const DECK_HTML = "arclume-deck.html";
const VISUAL_QA_JSON = "visual-qa.json";
const RECEIPT_JSON = "visual-qa-receipt.json";

function cleanup(dir: string): string | undefined {
  try {
    rmSync(dir, { recursive: true, force: true });
    return undefined;
  } catch (cause) {
    return `failed to remove staging directory "${dir}": ${(cause as Error).message}`;
  }
}

/**
 * Deliver a validated bundle atomically to `destination` (a directory path that
 * must not already exist).
 */
export async function deliverAtomic(
  destination: string,
  input: DeliveryArtifactInput,
  options: DeliveryOptions = {},
): Promise<DeliveryResult> {
  if (existsSync(destination)) {
    throw new DeliveryError(`delivery destination "${destination}" already exists`, {
      code: "delivery/destination-exists",
      hint: "atomic delivery never overwrites; choose a fresh path or remove the old bundle deliberately",
    });
  }

  // Preflight: prove deck + html + VisualQaResult + receipt + screenshot buffers
  // are one coherent run. Fatal before any staging directory is created.
  validateDeliveryBindings(input);

  const deckContentHash = contentHash(input.deck).slice("sha256:".length);
  const htmlSha256 = sha256Utf8(input.html);
  const configHash = input.receipt.visualQa.configHash;
  const deliveryId = deriveDeliveryId({ deckContentHash, htmlSha256, configHash });

  const stagingDir = join(dirname(destination), `.${basename(destination)}.staging-${deliveryId}`);
  // A previous failed run may have left this exact staging path behind.
  const preClean = cleanup(stagingDir);
  if (preClean) {
    throw new DeliveryError(preClean, { code: "delivery/staging-uncleanable" });
  }

  const hooks = options.hooks ?? {};
  const fail = (message: string, code: string, cause?: unknown): never => {
    const note = options.keepFailedStaging ? undefined : cleanup(stagingDir);
    throw new DeliveryError(message, {
      code,
      ...(cause !== undefined ? { cause } : {}),
      ...(note ? { hint: note } : {}),
    });
  };

  try {
    mkdirSync(join(stagingDir, "screenshots"), { recursive: true });

    // 1) write artifacts
    writeFileSync(join(stagingDir, DECK_JSON), stableJson(input.deck));

    writeFileSync(join(stagingDir, DECK_HTML), input.html);
    await hooks.afterHtml?.();

    const qaJson = visualQaJson(input.visualQa);
    const qaSchema = checkPhase6Schema("visualQa", qaJson);
    if (!qaSchema.valid) {
      return fail(
        `visual-qa.json does not match its schema: ${qaSchema.errors.slice(0, 3).join("; ")}`,
        "delivery/visual-qa-schema",
      );
    }
    writeFileSync(join(stagingDir, VISUAL_QA_JSON), stableJson(qaJson));

    const receiptSchema = checkPhase6Schema("visualQaReceipt", input.receipt);
    if (!receiptSchema.valid) {
      return fail(
        `visual-qa-receipt.json does not match its schema: ${receiptSchema.errors.slice(0, 3).join("; ")}`,
        "delivery/receipt-schema",
      );
    }
    writeFileSync(join(stagingDir, RECEIPT_JSON), stableJson(input.receipt));

    const seenPaths = new Set<string>();
    for (const shot of input.screenshots) {
      const p = validateBundleRelativePath(shot.path);
      if (!p.ok || !shot.path.startsWith("screenshots/")) {
        return fail(
          `unsafe screenshot path "${shot.path}"${p.reason ? `: ${p.reason}` : ""}`,
          "delivery/unsafe-path",
        );
      }
      if (seenPaths.has(shot.path)) {
        return fail(`duplicate screenshot path "${shot.path}"`, "delivery/duplicate-path");
      }
      seenPaths.add(shot.path);
      writeFileSync(join(stagingDir, ...shot.path.split("/")), shot.buffer);
    }
    await hooks.afterScreenshots?.();

    // 2) hash every written artifact
    const entries: ManifestEntry[] = [];
    const addEntry = (relPath: string): void => {
      const { bytes, sha256 } = hashFile(join(stagingDir, ...relPath.split("/")));
      entries.push({ path: relPath, bytes, sha256 });
    };
    addEntry(DECK_JSON);
    addEntry(DECK_HTML);
    addEntry(VISUAL_QA_JSON);
    addEntry(RECEIPT_JSON);
    for (const shot of input.screenshots) addEntry(shot.path);

    // 3) manifest
    await hooks.beforeManifest?.();
    const manifest: DeliveryManifest = buildManifest({
      deliveryId,
      entries,
      visualQa: { valid: input.visualQa.valid, version: input.visualQa.version },
    });
    const manifestSchema = checkPhase6Schema("deliveryManifest", manifest);
    if (!manifestSchema.valid) {
      return fail(
        `manifest.json does not match its schema: ${manifestSchema.errors.slice(0, 3).join("; ")}`,
        "delivery/manifest-schema",
      );
    }
    writeFileSync(join(stagingDir, MANIFEST_FILENAME), stableJson(manifest));

    // 4) verify the staged bundle against its own manifest
    const verification = verifyManifest(stagingDir);
    if (!verification.valid) {
      return fail(
        `staged bundle failed manifest verification: ${verification.issues
          .slice(0, 3)
          .map((i) => `${i.code} ${i.path ?? ""}`.trim())
          .join("; ")}`,
        "delivery/verification-failed",
      );
    }

    // 5) QA gate — a failing Visual QA never becomes a final delivery
    if (!input.visualQa.valid) {
      return fail(
        `Visual QA reported ${input.visualQa.summary.errors} error(s); refusing to publish a final bundle`,
        "delivery/qa-failed",
      );
    }

    // 6) commit — the rename is the boundary
    await hooks.beforeRename?.();
    renameSync(stagingDir, destination);

    return {
      delivered: true,
      destination,
      deliveryId,
      manifest,
      entries: manifest.entries,
      visualQaValid: true,
    };
  } catch (err) {
    if (err instanceof DeliveryError) throw err;
    const note = options.keepFailedStaging ? undefined : cleanup(stagingDir);
    throw new DeliveryError(`atomic delivery failed: ${(err as Error).message}`, {
      code: "delivery/staging-failed",
      cause: err,
      ...(note ? { hint: note } : {}),
    });
  }
}
