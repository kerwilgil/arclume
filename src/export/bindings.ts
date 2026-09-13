/**
 * Export binding validation (Phase 8): receipts never suffice on their own.
 * This module re-derives the semantic identity from the canonical render
 * input and the artifact bytes, and compares to the *supplied* receipt —
 * format, deck, exporter, profiles and the full diagram provenance chain.
 */

import { contentHash, sha256Hex } from "../determinism/hash.js";
import { DeliveryError } from "../errors.js";
import { renderCanonicalDeckHtml } from "../pipeline/canonical-render.js";
import type { CanonicalDeckRenderInput } from "../pipeline/canonical-render.js";
import { buildPdfPrintProfile } from "./pdf.js";
import { PPTX_LAYOUT_PROFILE_VERSION } from "./pptx.js";
import {
  EXPORT_RECEIPT_VERSION,
  PDF_EXPORTER_VERSION,
  PPTX_EXPORTER_VERSION,
  diagramIdentitiesOf,
  sha256Bytes,
} from "./receipt.js";
import type { ExportDiagramIdentity, ExportReceipt } from "./types.js";

function fail(code: string, message: string): never {
  throw new DeliveryError(message, { code });
}

function mismatch(message: string): never {
  fail("delivery/export-binding-mismatch", message);
}

export interface ValidateExportBindingsInput {
  format: "pdf" | "pptx";
  renderInput: CanonicalDeckRenderInput;
  artifact: Uint8Array;
  receipt: ExportReceipt;
}

/** Field-by-field equality of two diagram identities (canonical order). */
function diagramIdentityEqual(a: ExportDiagramIdentity, b: ExportDiagramIdentity): boolean {
  return (
    a.diagramId === b.diagramId &&
    a.engineRequested === b.engineRequested &&
    a.engineUsed === b.engineUsed &&
    a.specHash === b.specHash &&
    a.diagramRenderInputHash === b.diagramRenderInputHash &&
    (a.svgSha256 ?? undefined) === (b.svgSha256 ?? undefined) &&
    (a.fallbackCode ?? undefined) === (b.fallbackCode ?? undefined)
  );
}

/**
 * Receipt ↔ canonical input ↔ artifact, all three recomputed here.
 * Fatal on any drift. The expected format is passed independently — it is
 * NEVER derived from the receipt itself.
 */
export function validateExportBindings(input: ValidateExportBindingsInput): void {
  const deck = input.renderInput.deck;
  const receipt = input.receipt;

  // --- receipt envelope identity -------------------------------------------
  if (receipt.format !== input.format) {
    mismatch(`receipt.format "${receipt.format}" does not match the expected format`);
  }
  if (receipt.receiptVersion !== EXPORT_RECEIPT_VERSION) {
    mismatch(`receipt.receiptVersion "${receipt.receiptVersion}" != "${EXPORT_RECEIPT_VERSION}"`);
  }
  if (receipt.exporter.name !== "arclume-export") {
    mismatch(`receipt.exporter.name "${receipt.exporter.name}" is not "arclume-export"`);
  }
  const expectedExporterVersion =
    input.format === "pdf" ? PDF_EXPORTER_VERSION : PPTX_EXPORTER_VERSION;
  if (receipt.exporter.version !== expectedExporterVersion) {
    mismatch(
      `receipt.exporter.version "${receipt.exporter.version}" != "${expectedExporterVersion}"`,
    );
  }
  if (receipt.validation.valid !== true) {
    mismatch("receipt.validation.valid is not true — non-publishable output");
  }

  // --- deck identity --------------------------------------------------------
  if (receipt.deck.irVersion !== deck.irVersion) {
    mismatch("receipt.deck.irVersion does not match the deck");
  }
  if (receipt.deck.contentHash !== contentHash(deck)) {
    mismatch("receipt.deck.contentHash does not match the deck");
  }
  if (sha256Bytes(input.artifact) !== receipt.output.sha256) {
    mismatch("receipt.output.sha256 does not match the artifact");
  }
  if (receipt.output.bytes !== input.artifact.length) {
    mismatch("receipt.output.bytes does not match the artifact");
  }
  if (receipt.slideCount !== deck.slides.length) {
    mismatch("receipt.slideCount != deck.slides.length");
  }

  // --- diagram provenance: re-derived, exact, canonical order ---------------
  const expected = diagramIdentitiesOf(input.renderInput.diagramArtifacts);
  const claimed = receipt.diagramArtifacts;
  const seenIds = new Set<string>();
  for (const d of claimed) {
    if (seenIds.has(d.diagramId)) {
      mismatch(`receipt carries a duplicate diagramId "${d.diagramId}"`);
    }
    seenIds.add(d.diagramId);
  }
  if (claimed.length !== expected.length) {
    mismatch(
      `receipt lists ${claimed.length} diagram artifact(s); the render input proves ${expected.length}`,
    );
  }
  for (let i = 0; i < expected.length; i += 1) {
    const got = claimed[i] as ExportDiagramIdentity;
    const want = expected[i] as ExportDiagramIdentity;
    if (!diagramIdentityEqual(got, want)) {
      mismatch(
        `receipt diagramArtifacts[${i}] ("${got.diagramId}") does not match the render input provenance`,
      );
    }
  }

  // --- format-conditional identity ------------------------------------------
  const aspect = deck.theme?.aspectRatio;
  const expectedAspect = aspect === "16:10" || aspect === "4:3" ? aspect : "16:9";
  if (input.format === "pdf") {
    if (receipt.canonicalHtmlSha256 === undefined) {
      mismatch("a pdf receipt without canonicalHtmlSha256 is not publishable");
    }
    const canonical = renderCanonicalDeckHtml(input.renderInput);
    const expectedHtmlSha = sha256Hex(canonical.html);
    if (receipt.canonicalHtmlSha256 !== expectedHtmlSha) {
      mismatch("receipt canonicalHtmlSha256 does not match");
    }
    if (receipt.printProfile === undefined) {
      mismatch("a pdf receipt without printProfile is not publishable");
    }
    const profile = buildPdfPrintProfile(expectedAspect);
    if (receipt.printProfile.version !== profile.version) {
      mismatch("receipt printProfile.version does not match the print profile version");
    }
    if (receipt.printProfile.cssSha256 !== profile.cssSha256) {
      mismatch("receipt print profile does not match the aspect ratio's bytes");
    }
    const chromiumVersion = receipt.runtime?.chromiumVersion;
    if (typeof chromiumVersion !== "string" || chromiumVersion.length === 0) {
      mismatch("a pdf receipt without runtime.chromiumVersion is not publishable");
    }
    if (receipt.layoutProfile !== undefined) {
      mismatch("a pdf receipt must not carry a PPTX layoutProfile");
    }
  }
  if (input.format === "pptx") {
    if (receipt.layoutProfile === undefined) {
      mismatch("a pptx receipt without layoutProfile is not publishable");
    }
    if (receipt.layoutProfile.version !== PPTX_LAYOUT_PROFILE_VERSION) {
      mismatch(
        `receipt layoutProfile.version "${receipt.layoutProfile.version}" != "${PPTX_LAYOUT_PROFILE_VERSION}"`,
      );
    }
    if (receipt.layoutProfile.aspectRatio !== expectedAspect) {
      mismatch("receipt layoutProfile does not match the deck aspect ratio");
    }
    if (receipt.canonicalHtmlSha256 !== undefined) {
      mismatch("a pptx receipt must not carry canonicalHtmlSha256");
    }
    if (receipt.printProfile !== undefined) {
      mismatch("a pptx receipt must not carry a PDF printProfile");
    }
  }
}
