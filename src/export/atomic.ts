/**
 * Atomic export publication (Phase 8) — bundle directory = commit unit.
 *
 * Write order: artifact → receipt → READ BACK both from staging → the READ-BACK
 * bytes are validated as a REAL artifact of the expected format (PDF structure
 * via pdf.js / PPTX OPC package) → receipt is schema-validated and rebound
 * against the render input → only THEN the rename commits. No clock;
 * symlink/junction targets are refused. `receipt.validation.valid` is
 * caller-controlled evidence and NEVER a substitute for staged validation.
 */

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { contentHash } from "../determinism/hash.js";
import { DeliveryError } from "../errors.js";
import { stableJson } from "../pipeline/artifacts.js";
import type { CanonicalDeckRenderInput } from "../pipeline/canonical-render.js";
import { validateExportBindings } from "./bindings.js";
import { validatePdfExport } from "./pdf.js";
import { validatePptxPackage } from "./pptx.js";
import { sha256Bytes } from "./receipt.js";
import { checkExportReceiptSchema } from "./receipt.js";
import type { AspectRatio, ExportReceipt } from "./types.js";

export const RECEIPT_FILE = "export-receipt.json";

/** Bundle-relative names allowed. */
const SAFE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function assertSafeFileName(name: string): void {
  if (
    !SAFE_NAME_RE.test(name) ||
    name.includes("..") ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(name)
  ) {
    throw new DeliveryError(`unsafe export filename "${name}"`, {
      code: "export/unsafe-filename",
    });
  }
}

export interface AtomicExportInput {
  destination: string;
  fileName: string;
  artifact: Buffer;
  receipt: ExportReceipt;
  /**
   * The expected format, known independently of the receipt. The receipt's own
   * `format` claim is never the source of truth: it must MATCH this argument.
   */
  format: "pdf" | "pptx";
  /** Required now: `receipt` is always rebound against the render identity. */
  renderInput: CanonicalDeckRenderInput;
}

export interface AtomicExportResult {
  bundlePath: string;
  artifactPath: string;
  receiptPath: string;
  /** Deterministic identity: never a clock, never a random id. */
  exportId: string;
}

/** Deterministic identity of the published bundle. */
export function deriveExportId(receipt: ExportReceipt): string {
  return contentHash({
    format: receipt.format,
    deckContentHash: receipt.deck.contentHash,
    outputSha256: receipt.output.sha256,
    receiptVersion: receipt.receiptVersion,
    exporterVersion: receipt.exporter.version,
  }).slice("sha256:".length);
}

/** Reject symlinks/junctions in any ancestor or the staging path of the bundle. */
function assertNoSymlink(path: string): void {
  const parts: string[] = [];
  let cur = path;
  while (true) {
    parts.push(cur);
    const parent = dirname(cur);
    if (parent === cur || parent === "" || parent === ".") break;
    cur = parent;
  }
  for (const p of parts) {
    if (!existsSync(p)) continue;
    const st = lstatSync(p);
    if (st.isSymbolicLink()) {
      throw new DeliveryError(`refusing to publish through a symlinked path: ${p}`, {
        code: "export/unsafe-path",
      });
    }
  }
}

function aspectOfDeck(deck: CanonicalDeckRenderInput["deck"]): AspectRatio {
  const a = deck.theme?.aspectRatio;
  return a === "16:9" || a === "16:10" || a === "4:3" ? a : "16:9";
}

/**
 * Format validation over the STAGED bytes (the read-back copy), independent of
 * any receipt claim. Fatal before rename.
 */
async function validateStagedArtifact(
  format: "pdf" | "pptx",
  readBack: Buffer,
  renderInput: CanonicalDeckRenderInput,
): Promise<void> {
  const deck = renderInput.deck;
  if (format === "pptx") {
    const errors = validatePptxPackage(readBack, deck);
    if (errors.length > 0) {
      throw new DeliveryError(`staged PPTX failed structural validation: ${errors.join("; ")}`, {
        code: "export/pptx-invalid-package",
      });
    }
    return;
  }
  let result: { errors: string[] };
  try {
    result = await validatePdfExport(readBack, deck.slides.length, aspectOfDeck(deck));
  } catch (err) {
    throw new DeliveryError(`staged PDF failed structural validation: ${(err as Error).message}`, {
      code: "export/output-validation-failed",
      cause: err as Error,
    });
  }
  if (result.errors.length > 0) {
    throw new DeliveryError(
      `staged PDF failed structural validation: ${result.errors.join("; ")}`,
      { code: "export/output-validation-failed" },
    );
  }
}

/**
 * Publish a `(artifact, receipt)` pair as one atomic directory commit.
 * Order: stage → read back → FORMAT validation of staged bytes → receipt
 * schema → receipt ↔ render-input binding → rename.
 */
export async function publishExportBundle(input: AtomicExportInput): Promise<AtomicExportResult> {
  const { destination, fileName, artifact, receipt, renderInput } = input;
  assertSafeFileName(fileName);

  if (existsSync(destination)) {
    throw new DeliveryError(`export destination "${destination}" already exists`, {
      code: "export/destination-exists",
    });
  }

  // the staging path must never live beneath a symlink
  assertNoSymlink(dirname(destination));

  const dir = dirname(destination);
  const staging = join(
    dir,
    `.${basename(destination)}.staging-${receipt.output.sha256.slice(0, 16)}`,
  );
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });

  try {
    // the bundle owns the final name; reconcile the receipt to it
    receipt.output.fileName = fileName;

    // staging write
    const artifactPath = join(staging, fileName);
    const receiptPath = join(staging, RECEIPT_FILE);
    writeFileSync(artifactPath, artifact);
    writeFileSync(receiptPath, stableJson(receipt));

    // staged verification: the bytes + receipt as read back from disk
    if (lstatSync(artifactPath).isSymbolicLink() || lstatSync(receiptPath).isSymbolicLink()) {
      throw new DeliveryError("staging entries must not be symlinks", {
        code: "export/unsafe-path",
      });
    }
    const readBack = readFileSync(artifactPath);
    if (sha256Bytes(readBack) !== receipt.output.sha256) {
      throw new DeliveryError("export staging verification failed (bytes differ when read back)", {
        code: "export/verification-failed",
      });
    }
    // The format of the staged bytes is proven, never inherited from the receipt.
    await validateStagedArtifact(input.format, readBack, renderInput);
    const receiptBack = JSON.parse(readFileSync(receiptPath, "utf8")) as ExportReceipt;
    const schemaOk = checkExportReceiptSchema(receiptBack);
    if (!schemaOk.valid) {
      throw new DeliveryError(
        `export receipt failed schema validation: ${schemaOk.errors.join("; ")}`,
        { code: "export/receipt-schema" },
      );
    }
    validateExportBindings({
      format: input.format,
      renderInput,
      artifact: readBack,
      receipt: receiptBack,
    });

    if (!receipt.validation.valid) {
      throw new DeliveryError(`export validation failed: ${receipt.validation.errors.join("; ")}`, {
        code: "export/validation-failed",
      });
    }

    renameSync(staging, destination);
    return {
      bundlePath: destination,
      artifactPath: join(destination, fileName),
      receiptPath: join(destination, RECEIPT_FILE),
      exportId: deriveExportId(receipt),
    };
  } catch (err) {
    const cleanErr = cleanup(staging);
    if (err instanceof DeliveryError) {
      if (cleanErr !== undefined) {
        throw new DeliveryError(`${err.message} (staging cleanup: ${cleanErr})`, {
          code: err.code,
          cause: err,
        });
      }
      throw err;
    }
    throw new DeliveryError(`export publication failed: ${(err as Error).message}`, {
      code: "export/staging-failed",
      cause: err,
    });
  }
}

function cleanup(dir: string): string | undefined {
  try {
    rmSync(dir, { recursive: true, force: true });
    return undefined;
  } catch (cause) {
    return (cause as Error).message;
  }
}
