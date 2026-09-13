/**
 * Public shapes for Chromium Visual QA (Phase 6).
 *
 * Visual QA runs strictly AFTER the self-contained HTML exists. It never alters
 * the deck or the HTML — it opens the document in a real headless Chromium,
 * observes runtime behaviour (network / console / pageerror / dialogs),
 * physically drives the viewer, measures geometry, captures screenshots and
 * emits structured, hashable evidence.
 *
 * `VisualQaResult` is the serializable contract (mirrors
 * `schemas/visual-qa.schema.json`). A run also produces screenshot buffers;
 * those live on `VisualQaRun.artifacts` and are never serialized.
 */

import { VISUAL_QA_VERSION } from "../../version.js";

export { VISUAL_QA_VERSION };

export type VisualSeverity = "error" | "warning" | "info";

export interface Viewport {
  /** Stable label, e.g. `desktop-1440x900`. Used in finding ordering + filenames. */
  name: string;
  width: number;
  height: number;
  deviceScaleFactor: number;
}

/** The one viewport that carries the strict (ERROR-level) geometry policy and the screenshots. */
export const CANONICAL_VIEWPORT: Viewport = {
  name: "desktop-1440x900",
  width: 1440,
  height: 900,
  deviceScaleFactor: 1,
};

/** The default viewport matrix — deliberately small. */
export const DEFAULT_VIEWPORTS: readonly Viewport[] = [
  CANONICAL_VIEWPORT,
  { name: "laptop-1366x768", width: 1366, height: 768, deviceScaleFactor: 1 },
  { name: "mobile-landscape-844x390", width: 844, height: 390, deviceScaleFactor: 1 },
];

/** Every finding code Visual QA can emit. Stable identifiers. */
export const VISUAL_FINDING_CODES = [
  // runtime
  "visual/browser-launch",
  "visual/network-request",
  "visual/console-error",
  "visual/page-error",
  "visual/unexpected-dialog",
  // viewer physical behaviour
  "visual/viewer-active-count",
  "visual/viewer-nav",
  "visual/viewer-counter",
  "visual/viewer-progress",
  "visual/viewer-hash",
  "visual/viewer-focus",
  "visual/viewer-aria",
  // stage / frame
  "visual/stage-zero-size",
  "visual/aspect-ratio-mismatch",
  // slide geometry
  "visual/slide-overflow-x",
  "visual/slide-overflow-y",
  "visual/off-slide",
  "visual/text-clipped",
  "visual/zero-size-element",
  "visual/local-scroll",
  // diagrams
  "visual/diagram-zero-size",
  "visual/diagram-clipped",
  // chrome
  "visual/controls-overlap",
  // contrast
  "visual/contrast-low",
  // regression / capture
  "visual/screenshot-failed",
  "visual/regression-diff",
] as const;

export type VisualFindingCode = (typeof VISUAL_FINDING_CODES)[number];

export interface VisualFinding {
  code: string;
  severity: VisualSeverity;
  /** The viewport label this finding was observed in. */
  viewport: string;
  slideId?: string;
  slideIndex?: number;
  blockId?: string;
  diagramId?: string;
  message: string;
  /** Objective measurements that back the finding. Never free prose. */
  metrics?: Record<string, string | number | boolean>;
}

export interface BrowserIdentity {
  name: "chromium";
  version: string;
  platform: string;
  deviceScaleFactor: number;
}

/** Serializable screenshot metadata (mirrors the schema). No pixels here. */
export interface ScreenshotDescriptor {
  viewport: string;
  slideId: string;
  /** 1-based slide number for a slide screenshot; 0 for the viewer overview. */
  index: number;
  kind: "slide" | "viewer";
  width: number;
  height: number;
  bytes: number;
  /** Lowercase hex SHA-256 of the PNG bytes. */
  sha256: string;
  /** Canonical bundle-relative path, e.g. `screenshots/slide-001-cover.png`. */
  path: string;
}

/** A screenshot descriptor plus its in-memory PNG buffer. Never serialized. */
export interface ScreenshotArtifact extends ScreenshotDescriptor {
  buffer: Buffer;
}

export interface ViewportResult {
  viewport: string;
  width: number;
  height: number;
  deviceScaleFactor: number;
  slideCount: number;
  findings: number;
  errors: number;
  warnings: number;
  info: number;
}

export interface VisualQaResult {
  version: string;
  /** `false` iff `summary.errors > 0`. Warnings never block. */
  valid: boolean;
  browser: BrowserIdentity;
  /**
   * Cryptographic identity of the exact HTML this run opened in Chromium.
   * `runVisualQa` computes `sha256Utf8(html)` from its own input — a caller can
   * never supply this hash. It is what binds the screenshots / findings to a
   * specific document, and what the delivery preflight checks against the
   * actually-delivered HTML (`delivery/qa-input-mismatch`).
   */
  input: { htmlSha256: string };
  viewports: ViewportResult[];
  findings: VisualFinding[];
  screenshots: ScreenshotDescriptor[];
  summary: { errors: number; warnings: number; info: number };
}

/** `VisualQaResult` plus the screenshot buffers a delivery layer will write. */
export interface VisualQaRun extends VisualQaResult {
  artifacts: ScreenshotArtifact[];
}

export interface VisualQaOptions {
  /** Viewport matrix. Defaults to {@link DEFAULT_VIEWPORTS}. */
  viewports?: readonly Viewport[];
  /** Emit screenshots (from the capture viewport only). Default `true`. */
  screenshots?: boolean;
  /** Which viewport the screenshots come from. Default = the canonical desktop viewport. */
  captureViewport?: string;
  /**
   * Declared deck aspect ratio (`16:9` / `16:10` / `4:3`). When omitted it is
   * read from the deck DOM (`data-arclume-aspect-ratio`).
   */
  aspectRatio?: string;
  /** Run token-level contrast QA. Default `true`. */
  contrast?: boolean;
  /** Playwright Chromium channel (e.g. `chromium`). Default: the bundled build. */
  channel?: string;
  /** Per-page operation timeout, ms. Default 15000. */
  timeoutMs?: number;
}

/* ------------------------------------------------------------------ */
/* Visual QA receipt (mirrors schemas/visual-qa-receipt.schema.json)   */
/* ------------------------------------------------------------------ */

export interface VisualQaReceipt {
  receiptVersion: string;
  deck: { irVersion: string; contentHash?: string };
  renderer: { version: string };
  visualQa: { version: string; configHash: string };
  browser: { name: "chromium"; version: string; platform: string };
  inputs: { htmlSha256: string };
  /**
   * Diagram-engine identity. Present ONLY when at least one delivered
   * diagram was actually produced by that engine (`engineUsed === "visual"`).
   * No engine field is ever written for a full-native or fallback-only deck.
   */
  engines?: { visual?: { version: string; commit: string } };
  result: { valid: boolean; errors: number; warnings: number };
  screenshots: Array<{ slideId: string; sha256: string; bytes: number }>;
}
