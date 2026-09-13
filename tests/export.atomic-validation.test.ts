/**
 * Phase 8 absolute closure: atomic publication must RE-VALIDATE the staged
 * artifact bytes in the target format — `receipt.validation.valid === true` is
 * caller-controlled evidence and can never authorize publication on its own.
 *
 * Both tests build a receipt where EVERY claim is individually honest
 * (correct sha/bytes/deck hash/exporter/version/layout/diagram identities),
 * attached to BYTES THAT ARE STRUCTURALLY INVALID for the declared format.
 */

import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sha256Hex } from "../src/determinism/hash.js";
import {
  buildDeckPptx,
  buildExportReceipt,
  publishExportBundle,
  sha256Bytes,
} from "../src/export/index.js";
import { buildPdfPrintProfile } from "../src/export/pdf.js";
import { PPTX_LAYOUT_PROFILE_VERSION } from "../src/export/pptx.js";
import { renderCanonicalDeckHtml } from "../src/pipeline/canonical-render.js";
import { richDeck } from "./helpers/decks.js";
import { buildTextPdf } from "./helpers/fixture-builders.js";

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "arclume-atomic-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("atomic publication — bypass attempts (receipt lies, bytes tell the truth)", () => {
  it("PPTX: invalid package + receipt with valid:true fails BEFORE rename", async () => {
    const deck = richDeck();
    const { bytes: validBytes } = await buildDeckPptx({ deck });

    // Corrupt the package: _rels/.rels gains an external relationship → the
    // validator must reject these bytes no matter what the receipt claims.
    const parts = unzipSync(new Uint8Array(validBytes)) as Record<string, Uint8Array>;
    const rels = strFromU8(parts["_rels/.rels"] as Uint8Array);
    parts["_rels/.rels"] = strToU8(rels.replace("/>", ' TargetMode="External"/>'));
    const forgedBytes = Buffer.from(zipSync(parts));

    // A fully honest-looking receipt for the FORGED bytes: correct sha, correct
    // bytes count, correct deck hash, correct exporter/version/layout —
    // and validation.valid: true.
    const receipt = buildExportReceipt({
      format: "pptx",
      deck,
      diagramArtifacts: new Map(),
      output: {
        fileName: "deck.pptx",
        bytes: forgedBytes.length,
        sha256: sha256Bytes(forgedBytes),
      },
      slideCount: deck.slides.length,
      validation: { valid: true, errors: [], warnings: [] },
      layoutProfile: { version: PPTX_LAYOUT_PROFILE_VERSION, aspectRatio: "16:9" },
    });

    const destination = join(dir, "bypass-pptx");
    await expect(
      publishExportBundle({
        destination,
        fileName: "deck.pptx",
        artifact: forgedBytes,
        receipt,
        format: "pptx",
        renderInput: { deck },
      }),
    ).rejects.toMatchObject({ code: "export/pptx-invalid-package" });
    expect(existsSync(destination)).toBe(false);
    expect(readdirSync(dir).filter((n) => n.includes("staging"))).toEqual([]);
  });

  it("PDF: page-count mismatch + receipt with valid:true fails BEFORE rename", async () => {
    const deck = richDeck();
    // Structurally valid PDF, but with a wrong number of pages for this deck.
    const forgedBytes = buildTextPdf([["Only one page"]]);

    const canonical = renderCanonicalDeckHtml({ deck });
    const profile = buildPdfPrintProfile("16:9");
    const receipt = buildExportReceipt({
      format: "pdf",
      deck,
      diagramArtifacts: new Map(),
      output: {
        fileName: "deck.pdf",
        bytes: forgedBytes.length,
        sha256: sha256Bytes(forgedBytes),
      },
      slideCount: deck.slides.length,
      validation: { valid: true, errors: [], warnings: [] },
      canonicalHtmlSha256: sha256Hex(canonical.html),
      printProfile: { version: profile.version, cssSha256: profile.cssSha256 },
      chromiumVersion: "140.0.0.0",
    });

    const destination = join(dir, "bypass-pdf");
    await expect(
      publishExportBundle({
        destination,
        fileName: "deck.pdf",
        artifact: forgedBytes,
        receipt,
        format: "pdf",
        renderInput: { deck },
      }),
    ).rejects.toMatchObject({ code: "export/output-validation-failed" });
    expect(existsSync(destination)).toBe(false);
    expect(readdirSync(dir).filter((n) => n.includes("staging"))).toEqual([]);
  });
});
