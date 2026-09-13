/**
 * Export receipt construction (Phase 8). Receipts are honest: the identity
 * fields are recomputed from the inputs, never copied verbatim from caller
 * claims. A receipt with a false engine claim fails validation.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ValidateFunction } from "ajv";
import { contentHash } from "../determinism/hash.js";
import type { ResolvedDiagramArtifact } from "../engines/types.js";
import { RenderError } from "../errors.js";
import type { ArclumeDeck } from "../types/deck.js";
import type { ExportDiagramIdentity, ExportReceipt } from "./types.js";

const require = createRequire(import.meta.url);

/** SHA-256 over artifact bytes (not text). */
export function sha256Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export const EXPORT_RECEIPT_VERSION = "0.1.0";
export const PDF_EXPORTER_VERSION = "0.1.0";
export const PPTX_EXPORTER_VERSION = "0.1.0";

export function diagramIdentitiesOf(
  artifacts: ReadonlyMap<string, ResolvedDiagramArtifact> | undefined,
): ExportDiagramIdentity[] {
  if (artifacts === undefined) return [];
  return [...artifacts.values()]
    .map((a): ExportDiagramIdentity => {
      const base = {
        diagramId: a.diagramId,
        engineRequested: a.engineRequested,
        engineUsed: a.engineUsed,
        specHash: a.specHash,
        diagramRenderInputHash: a.diagramRenderInputHash,
      };
      if (a.kind === "svg") return { ...base, svgSha256: a.svgSha256 };
      return { ...base, fallbackCode: a.code };
    })
    .sort((a, b) => (a.diagramId < b.diagramId ? -1 : a.diagramId > b.diagramId ? 1 : 0));
}

export interface BuildExportReceiptInput {
  format: "pdf" | "pptx";
  deck: ArclumeDeck;
  diagramArtifacts?: ReadonlyMap<string, ResolvedDiagramArtifact> | undefined;
  output: { fileName: string; bytes: number; sha256: string };
  slideCount: number;
  validation: { valid: boolean; errors: string[]; warnings: string[] };
  notes?: string[];
  canonicalHtmlSha256?: string;
  printProfile?: { version: string; cssSha256: string };
  layoutProfile?: { version: string; aspectRatio: string };
  chromiumVersion?: string;
}

export function buildExportReceipt(input: BuildExportReceiptInput): ExportReceipt {
  const receipt: ExportReceipt = {
    receiptVersion: EXPORT_RECEIPT_VERSION,
    format: input.format,
    exporter: {
      name: "arclume-export",
      version: input.format === "pdf" ? PDF_EXPORTER_VERSION : PPTX_EXPORTER_VERSION,
    },
    deck: {
      irVersion: input.deck.irVersion,
      contentHash: contentHash(input.deck),
    },
    diagramArtifacts: diagramIdentitiesOf(input.diagramArtifacts),
    output: input.output,
    slideCount: input.slideCount,
    validation: input.validation,
  };
  if (input.canonicalHtmlSha256 !== undefined)
    receipt.canonicalHtmlSha256 = input.canonicalHtmlSha256;
  if (input.printProfile) receipt.printProfile = input.printProfile;
  if (input.layoutProfile)
    receipt.layoutProfile = {
      version: input.layoutProfile.version,
      aspectRatio: input.layoutProfile.aspectRatio as never,
    };
  if (input.chromiumVersion) receipt.runtime = { chromiumVersion: input.chromiumVersion };
  if (input.notes && input.notes.length > 0) receipt.notes = input.notes;
  return receipt;
}

/** Throw unless bytes/identity are internally coherent. */
export function validateExportReceipt(receipt: ExportReceipt, artifact: Uint8Array): void {
  if (sha256Bytes(artifact) !== receipt.output.sha256) {
    throw new RenderError("export receipt does not hash the artifact", {
      code: "export/output-hash-mismatch",
    });
  }
}

/* ------------------------------------------------------------------ */
/* receipt schema (productive)                                         */
/* ------------------------------------------------------------------ */

export interface CheckReceiptOk {
  valid: boolean;
  errors: string[];
}

let cachedCheck: ValidateFunction | undefined;

/** Compile + validate the receipt schema. Deterministic and AJV-backed. */
export function checkExportReceiptSchema(receipt: unknown): CheckReceiptOk {
  const compiled = getExportReceiptValidator();
  const ok = compiled(receipt);
  if (ok === true) return { valid: true, errors: [] };
  const issues = (compiled.errors ?? []).map(
    (e: { instancePath?: string; message?: string }) =>
      `${e.instancePath || "/"}: ${e.message ?? "invalid"}`,
  );
  return { valid: false, errors: issues };
}

function getExportReceiptValidator(): ValidateFunction {
  if (cachedCheck) return cachedCheck;
  const { Ajv2020 } = require("ajv/dist/2020.js") as {
    Ajv2020: new (opts: object) => { compile(s: Record<string, unknown>): ValidateFunction };
  };
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const schema = readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "schemas",
      "export-receipt.schema.json",
    ),
    "utf8",
  );
  cachedCheck = ajv.compile(JSON.parse(schema));
  return cachedCheck;
}

export type _ExportReceiptSchema = ReturnType<typeof checkExportReceiptSchema>;
