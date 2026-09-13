/**
 * Phase 8 export surface: PDF + PPTX exporters, receipts and atomic bundling.
 */

export {
  ASPECT_BROWSER_PX,
  ASPECT_PPTX_INCH,
  type AspectRatio,
  type ExportBundleResult,
  type ExportDiagramIdentity,
  type ExportReceipt,
  type PdfPrintProfile,
} from "./types.js";
export {
  buildExportReceipt,
  PDF_EXPORTER_VERSION,
  PPTX_EXPORTER_VERSION,
  EXPORT_RECEIPT_VERSION,
  diagramIdentitiesOf,
  sha256Bytes,
  validateExportReceipt,
} from "./receipt.js";
export {
  renderDeckPdf,
  validatePdfExport,
  buildPdfPrintProfile,
  type PdfExportInput,
  type PdfExportOutput,
} from "./pdf.js";
export {
  buildDeckPptx,
  validatePptxPackage,
  type ExportPptxOptions,
  type ExportPptxOutput,
} from "./pptx.js";
export {
  BUILDING,
  blockHandlerMatrix,
  buildSemanticLayout,
  layoutRegions,
  requireAllBlocksCovered,
} from "./pptx-layout.js";
export {
  assertSafeFileName,
  publishExportBundle,
  type AtomicExportInput,
  type AtomicExportResult,
} from "./atomic.js";
