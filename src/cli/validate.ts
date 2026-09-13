/**
 * `arclume validate <path>` — verify what ARCLUME can actually prove:
 *
 *  - an EXPORT BUNDLE dir (receipt + artifact): receipt schema, artifact
 *    sha256/bytes match, and real structural validation of the artifact bytes
 *    (pdf.js for PDF, the OPC package audit for PPTX);
 *  - a DELIVERY bundle dir (manifest.json): Phase 6 `verifyManifest`;
 *  - a ProjectKnowledge JSON file (or artifact dir with one).
 *
 * A bare `.pptx` without its receipt cannot be slide-bound (there is no deck
 * identity to validate against) — validate the BUNDLE instead.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { verifyManifest } from "../delivery/verify.js";
import { RenderError } from "../errors.js";
import { buildPdfPrintProfile, validatePdfExport } from "../export/pdf.js";
import { validatePptxPackageExpectations } from "../export/pptx.js";
import {
  EXPORT_RECEIPT_VERSION,
  PDF_EXPORTER_VERSION,
  PPTX_EXPORTER_VERSION,
  checkExportReceiptSchema,
  sha256Bytes,
} from "../export/receipt.js";
import type { ExportReceipt } from "../export/types.js";
import { readKnowledgeArtifact } from "../pipeline/artifacts.js";
import { validateProjectKnowledge } from "../validation/validator.js";
import { CliUsageError, parseArgs } from "./args.js";
import type { CliIo } from "./output.js";

export const VALIDATE_FLAGS = {
  valueFlags: [],
  booleanFlags: ["json", "quiet", "verbose"],
} as const;

export const EXPORT_RECEIPT_FILE = "export-receipt.json";

export interface ValidateIssue {
  code: string;
  message: string;
}

export interface ValidateCommandResult {
  kind: "validate";
  path: string;
  target: "export-bundle" | "delivery-bundle" | "knowledge";
  valid: boolean;
  issues: ValidateIssue[];
}

const ASPECTS = ["16:9", "16:10", "4:3"] as const;

export async function validateExportBundle(dir: string): Promise<ValidateIssue[]> {
  const issues: ValidateIssue[] = [];
  const receiptPath = join(dir, EXPORT_RECEIPT_FILE);
  let receipt: ExportReceipt;
  try {
    receipt = JSON.parse(readFileSync(receiptPath, "utf8")) as ExportReceipt;
  } catch (err) {
    return [{ code: "export/receipt-unreadable", message: (err as Error).message }];
  }

  const schema = checkExportReceiptSchema(receipt);
  if (!schema.valid) {
    for (const e of schema.errors) issues.push({ code: "export/receipt-schema", message: e });
  }

  // Receipt self-state: supported Phase 8 identity only.
  if (receipt.receiptVersion !== EXPORT_RECEIPT_VERSION) {
    issues.push({
      code: "export/receipt-version-mismatch",
      message: `receiptVersion "${String(receipt.receiptVersion)}" != "${EXPORT_RECEIPT_VERSION}"`,
    });
  }
  if (receipt.exporter?.name !== "arclume-export") {
    issues.push({
      code: "export/receipt-exporter-mismatch",
      message: `exporter "${String(receipt.exporter?.name)}" is not "arclume-export"`,
    });
  }
  const expectedExporterVersion =
    receipt.format === "pdf"
      ? PDF_EXPORTER_VERSION
      : receipt.format === "pptx"
        ? PPTX_EXPORTER_VERSION
        : undefined;
  if (
    expectedExporterVersion !== undefined &&
    receipt.exporter?.version !== expectedExporterVersion
  ) {
    issues.push({
      code: "export/receipt-exporter-version-mismatch",
      message: `exporter.version "${String(receipt.exporter?.version)}" != "${expectedExporterVersion}"`,
    });
  }
  if (receipt.validation?.valid !== true) {
    issues.push({
      code: "export/receipt-not-valid",
      message: "the receipt itself declares validation.valid !== true",
    });
  }

  const artifactPath = join(dir, receipt.output?.fileName ?? "");
  if (!existsSync(artifactPath)) {
    issues.push({ code: "export/artifact-missing", message: receipt.output?.fileName ?? "?" });
    return issues;
  }
  const bytes = readFileSync(artifactPath);
  if (sha256Bytes(bytes) !== receipt.output?.sha256) {
    issues.push({
      code: "export/hash-mismatch",
      message: "artifact bytes do not match receipt.output.sha256",
    });
    return issues;
  }
  if (bytes.length !== receipt.output?.bytes) {
    issues.push({ code: "export/bytes-mismatch", message: "artifact length mismatch" });
  }

  if (receipt.format === "pptx") {
    const slideCount = receipt.slideCount;
    const aspect = receipt.layoutProfile?.aspectRatio ?? "16:9";
    const structural = validatePptxPackageExpectations(bytes, { slideCount, aspectRatio: aspect });
    for (const e of structural) issues.push({ code: e, message: e });
  } else {
    // PDF: the aspect is bound by the receipt's print profile css.
    let aspect: (typeof ASPECTS)[number] = "16:9";
    for (const a of ASPECTS) {
      if (buildPdfPrintProfile(a).cssSha256 === receipt.printProfile?.cssSha256) aspect = a;
    }
    const v = await validatePdfExport(bytes, receipt.slideCount, aspect);
    for (const e of v.errors) issues.push({ code: e, message: e });
    for (const w of v.warnings) issues.push({ code: `warning:${w}`, message: w });
  }
  return issues;
}

export async function runValidateCommand(argv: readonly string[], io: CliIo): Promise<number> {
  const parsed = parseArgs(argv, VALIDATE_FLAGS);
  const jsonMode = parsed.booleans.has("json");

  const input = parsed.positionals[0];
  if (input === undefined) {
    throw new CliUsageError(
      "validate requires a path (export bundle, delivery bundle, knowledge JSON, or .pptx)",
      "Example: arclume validate arclume-output/deck.pdf-export",
    );
  }
  const path = resolve(io.cwd(), input);
  if (!existsSync(path)) throw new CliUsageError(`path "${input}" does not exist`);
  const isDir = statSync(path).isDirectory();

  let target: ValidateCommandResult["target"];
  let issues: ValidateIssue[] = [];
  if (isDir && existsSync(join(path, EXPORT_RECEIPT_FILE))) {
    target = "export-bundle";
    issues = await validateExportBundle(path);
  } else if (isDir && existsSync(join(path, "manifest.json"))) {
    target = "delivery-bundle";
    const verification = verifyManifest(path);
    issues = verification.issues.map((i) => ({ code: i.code, message: i.message }));
  } else if (!isDir && input.toLowerCase().endsWith(".pptx")) {
    throw new CliUsageError(
      "a bare .pptx cannot be validated without its receipt",
      "Validate the export BUNDLE (the directory containing export-receipt.json) instead.",
    );
  } else {
    target = "knowledge";
    const knowledge = isDir
      ? readKnowledgeArtifact(path)
      : (JSON.parse(readFileSync(path, "utf8")) as unknown);
    const v = validateProjectKnowledge(knowledge);
    issues = v.errors.map((e) => ({ code: e.code, message: e.message }));
  }

  const valid = issues.filter((i) => !i.code.startsWith("warning:")).length === 0;
  if (jsonMode) {
    // ONE invocation → exactly ONE JSON document on stdout, valid or invalid.
    const body = valid
      ? { ok: true, command: "validate", path, target, valid, issues }
      : {
          ok: false,
          command: "validate",
          code: "cli/validate-failed",
          path,
          target,
          valid,
          issues,
        };
    io.stdout(JSON.stringify(body));
    return valid ? 0 : 2;
  }
  if (!parsed.booleans.has("quiet")) {
    io.stdout(`${target}: ${valid ? "VALID" : "INVALID"} — ${path}`);
  }
  for (const i of issues) io.stderr(`${i.code}: ${i.message}`);
  if (!valid) {
    throw new RenderError(`"${input}" is not valid (${issues[0]?.code ?? "?"})`, {
      code: "cli/validate-failed",
    });
  }
  return 0;
}
