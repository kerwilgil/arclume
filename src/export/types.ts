/**
 * Phase 8 export types: aspect-ratio profiles, export receipts, atomic bundle
 * publication. Both exporters (PDF, PPTX) are pure exports — they consume the
 * same `CanonicalDeckRenderInput` as HTML delivery.
 */

export type AspectRatio = "16:9" | "16:10" | "4:3";

/** Browser reference size (96 px/in) per aspect ratio, in CSS pixels. */
export const ASPECT_BROWSER_PX: Record<AspectRatio, { width: number; height: number }> = {
  "16:9": { width: 1280, height: 720 },
  "16:10": { width: 1280, height: 800 },
  "4:3": { width: 1280, height: 960 },
};

/** Physical PPTX slide: fixed height, aspect-dependent width in inches. */
export const ASPECT_PPTX_INCH: Record<AspectRatio, { width: number; height: number }> = {
  "16:9": { width: 13.333333, height: 7.5 },
  "16:10": { width: 12, height: 7.5 },
  "4:3": { width: 10, height: 7.5 },
};

export interface PdfPrintProfile {
  version: "0.1.0";
  aspectRatio: AspectRatio;
  widthPx: number;
  heightPx: number;
  css: string;
  cssSha256: string;
}

/** Diagram identity, as proven in Phase 7. */
export interface ExportDiagramIdentity {
  diagramId: string;
  engineRequested: string;
  engineUsed: string;
  specHash: string;
  diagramRenderInputHash: string;
  svgSha256?: string | undefined;
  fallbackCode?: string | undefined;
}

export interface ExportReceipt {
  receiptVersion: "0.1.0";
  format: "pdf" | "pptx";
  exporter: { name: "arclume-export"; version: string };
  runtime?: { chromiumVersion?: string };
  deck: { irVersion: string; contentHash: string };
  canonicalHtmlSha256?: string;
  printProfile?: { version: string; cssSha256: string };
  layoutProfile?: { version: string; aspectRatio: AspectRatio };
  diagramArtifacts: ExportDiagramIdentity[];
  output: { fileName: string; bytes: number; sha256: string };
  slideCount: number;
  validation: { valid: boolean; errors: string[]; warnings: string[] };
  notes?: string[];
}

/**
 * The public shape of a published export bundle. The identity field is
 * `exportId` — deterministic and export-scoped. (`deliveryId` is Phase 6
 * delivery vocabulary and intentionally NOT used here.)
 */
export interface ExportBundleResult {
  bundlePath: string;
  artifactPath: string;
  receiptPath: string;
  exportId: string;
}
