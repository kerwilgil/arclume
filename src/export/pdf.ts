/**
 * PDF export (Phase 8) — canonical HTML → Chromium printToPDF.
 *
 * Exporter-owned print profile (never mutates the canonical renderer).
 * 1 slide = 1 page; physical dimensions fixed per aspect ratio (pt).
 */

import { createHash } from "node:crypto";
import { sha256Hex } from "../determinism/hash.js";
import type { ResolvedDiagramArtifact } from "../engines/types.js";
import { RenderError } from "../errors.js";
import type { CanonicalDeckRenderInput } from "../pipeline/canonical-render.js";
import { HTML_RENDERER_VERSION } from "../renderers/html/index.js";
import type { ArclumeDeck } from "../types/deck.js";
import { PDF_EXPORTER_VERSION, buildExportReceipt, sha256Bytes } from "./receipt.js";
import {
  ASPECT_BROWSER_PX,
  type AspectRatio,
  type ExportReceipt,
  type PdfPrintProfile,
} from "./types.js";

const PROFILE_VERSION = "0.1.0" as const;

function aspectOf(deck: ArclumeDeck): AspectRatio {
  const ar = deck.theme?.aspectRatio;
  return ar === "16:9" || ar === "16:10" || ar === "4:3" ? ar : "16:9";
}

/** Print profile css — forces one slide per page, hides controls, no external refs. */
function printCss(aspect: AspectRatio): string {
  const px = ASPECT_BROWSER_PX[aspect];
  return [
    `@page { size: ${px.width}px ${px.height}px; margin: 0; }`,
    "html, body { margin: 0; padding: 0; background: white; }",
    ".arclume-controls, .arclume-progress { display: none !important; }",
    ".arclume-stage-wrap { padding: 0 !important; margin: 0 !important; }",
    ".arclume-stage { padding: 0 !important; gap: 0 !important; width: 100%; height: auto; display: block; }",
    `.arclume-slide { width: ${px.width}px !important; height: ${px.height}px !important; page-break-after: always; break-after: page; overflow: hidden; position: relative; flex: none; transform: none !important; }`,
    ".arclume-slide[aria-hidden='true'] { visibility: visible !important; }",
  ].join("\n");
}

export function buildPdfPrintProfile(aspect: AspectRatio): PdfPrintProfile {
  const px = ASPECT_BROWSER_PX[aspect];
  const css = printCss(aspect);
  return {
    version: PROFILE_VERSION,
    aspectRatio: aspect,
    widthPx: px.width,
    heightPx: px.height,
    css,
    cssSha256: sha256Hex(css),
  };
}

export interface PdfExportInput extends CanonicalDeckRenderInput {}

export interface PdfExportOutput {
  bytes: Buffer;
  receipt: ExportReceipt;
  pageCount: number;
  aspectRatio: AspectRatio;
}

/**
 * Render the canonical deck into a PDF buffer.
 *
 * The input is the Phase 7 canonical render context: the exporter never accepts
 * caller-supplied HTML — it recomputes `renderCanonicalDeckHtml(input)` itself,
 * so `canonicalHtmlSha256` in the receipt is derived from the trusted input.
 * All network use inside the PDF error is fatal: any external request attempt
 * under Chromium raises `export/pdf-network-attempt`.
 */
export async function renderDeckPdf(input: PdfExportInput): Promise<PdfExportOutput> {
  const { renderCanonicalDeckHtml } = await import("../pipeline/canonical-render.js");
  const canonical = renderCanonicalDeckHtml(input); // Phase 7 binding re-validation
  const html = canonical.html;

  const deck = input.deck;
  const aspect = aspectOf(deck);
  const profile = buildPdfPrintProfile(aspect);

  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: { width: profile.widthPx, height: profile.heightPx },
      bypassCSP: false,
      offline: true,
    });
    let networkAttempts = 0;
    let firstAttempt = "";
    await context.route("**/*", (route) => {
      const url = route.request().url();
      if (!url.startsWith("data:") && !url.startsWith("blob:")) {
        networkAttempts += 1;
        if (firstAttempt === "") firstAttempt = url;
      }
      route.abort().catch(() => undefined);
    });
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: "load" });
    await page.addStyleTag({ content: profile.css });
    const buf = await page.pdf({
      width: `${profile.widthPx}px`,
      height: `${profile.heightPx}px`,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
      printBackground: true,
      preferCSSPageSize: false,
    });

    if (networkAttempts > 0) {
      throw new RenderError(
        `PDF export produced a network request (${firstAttempt || "internal"}) — export aborted`,
        { code: "export/pdf-network-attempt" },
      );
    }

    // Structural validation BEFORE the receipt can exist.
    const validation = await validatePdfExport(buf, deck.slides.length, aspect);
    if (validation.errors.length > 0) {
      throw new RenderError(`PDF validation failed: ${validation.errors.join(";")}`, {
        code: "export/output-validation-failed",
      });
    }

    const receipt = buildExportReceipt({
      format: "pdf",
      deck,
      diagramArtifacts: input.diagramArtifacts,
      output: { fileName: "deck.pdf", bytes: buf.length, sha256: sha256Bytes(buf) },
      slideCount: deck.slides.length,
      validation: {
        valid: validation.errors.length === 0,
        errors: validation.errors,
        warnings: validation.warnings,
      },
      canonicalHtmlSha256: sha256Hex(html),
      printProfile: { version: profile.version, cssSha256: profile.cssSha256 },
      chromiumVersion: browser.version(),
    });
    return { bytes: buf, receipt, pageCount: deck.slides.length, aspectRatio: aspect };
  } finally {
    await browser.close();
  }
}

/** Validate a PDF bytes: header + page count + per-page box + non-empty content ops. */
export async function validatePdfExport(
  bytes: Uint8Array,
  expectedSlides: number,
  aspect: AspectRatio,
): Promise<{ errors: string[]; warnings: string[] }> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const head = new TextDecoder().decode(bytes.subarray(0, 8));
  if (!head.startsWith("%PDF-")) errors.push("export/pdf-invalid-header");

  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    verbosity: 0,
  }).promise;
  try {
    if (doc.numPages !== expectedSlides) {
      errors.push(`export/page-count-mismatch:${doc.numPages}!=${expectedSlides}`);
    }
    const px = ASPECT_BROWSER_PX[aspect];
    // PDF points are 96/72 of CSS px
    const expW = (px.width * 72) / 96;
    const expH = (px.height * 72) / 96;
    for (let p = 1; p <= doc.numPages; p += 1) {
      const page = await doc.getPage(p);
      try {
        const vb = page.getViewport({ scale: 1 }).viewBox;
        const w = vb[2] as number;
        const h = vb[3] as number;

        if (Math.abs(w - expW) > 1.5 || Math.abs(h - expH) > 1.5) {
          errors.push(`export/page-dimensions:${p}`);
        }
        const ops = await page.getOperatorList();
        // A page is non-blank ONLY when it performs a genuinely visible
        // painting action: text paint, path stroke/fill, image/XObject paint
        // (incl. forms that paint). Save/restore, transforms and marked-content
        // boundaries (BMC/BDC/EMC) are bookkeeping — they NEVER count.
        const { OPS } = await import("pdfjs-dist/legacy/build/pdf.mjs");
        void OPS;
        const meaningful = new Set<number>(
          [
            OPS.fill,
            OPS.eoFill,
            OPS.stroke,
            OPS.eoFillStroke,
            OPS.fillStroke,
            OPS.showText,
            OPS.showSpacedText,
            OPS.paintImageXObject,
            OPS.paintImageXObjectRepeat,
            OPS.paintXObject,
            OPS.paintImageMaskXObject,
            OPS.paintImageMaskXObjectGroup,
            OPS.paintInlineImageXObject,
            OPS.paintInlineImageXObjectGroup,
            OPS.shadingFill,
          ].filter((x): x is number => typeof x === "number"),
        );
        const meaningfulCount = ops.fnArray.filter((fn) => meaningful.has(fn)).length;
        if (meaningfulCount === 0) {
          errors.push(`export/blank-page:${p}`);
        }
      } finally {
        page.cleanup();
      }
    }
  } finally {
    await doc.destroy().catch(() => undefined);
  }
  return { errors, warnings };
}

export { PDF_EXPORTER_VERSION, HTML_RENDERER_VERSION, RenderError };
