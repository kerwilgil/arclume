/**
 * Finding aggregation: runtime findings from browser observations, a stable
 * sort, and the severity tally that decides `valid`.
 */

import type { RuntimeObservations } from "./browser.js";
import type { Viewport, ViewportResult, VisualFinding, VisualSeverity } from "./types.js";

const SEVERITY_RANK: Record<VisualSeverity, number> = { error: 0, warning: 1, info: 2 };

/** Findings from the runtime observers for one viewport. */
export function runtimeFindings(obs: RuntimeObservations, viewportName: string): VisualFinding[] {
  const out: VisualFinding[] = [];
  for (const req of dedupe(obs.networkRequests)) {
    out.push({
      code: "visual/network-request",
      severity: "error",
      viewport: viewportName,
      message: `the document attempted a network request: ${req}`,
      metrics: { request: req },
    });
  }
  for (const msg of dedupe(obs.consoleErrors)) {
    out.push({
      code: "visual/console-error",
      severity: "error",
      viewport: viewportName,
      message: `console.error during load / interaction: ${truncate(msg)}`,
      metrics: { text: truncate(msg) },
    });
  }
  for (const msg of dedupe(obs.pageErrors)) {
    out.push({
      code: "visual/page-error",
      severity: "error",
      viewport: viewportName,
      message: `uncaught page error: ${truncate(msg)}`,
      metrics: { text: truncate(msg) },
    });
  }
  for (const msg of dedupe(obs.dialogs)) {
    out.push({
      code: "visual/unexpected-dialog",
      severity: "error",
      viewport: viewportName,
      message: `an unexpected dialog was raised and dismissed: ${truncate(msg)}`,
      metrics: { text: truncate(msg) },
    });
  }
  return out;
}

function dedupe(xs: string[]): string[] {
  return [...new Set(xs)];
}
function truncate(s: string): string {
  return s.length > 200 ? `${s.slice(0, 197)}…` : s;
}

/**
 * Deterministic order (spec §52): viewport (matrix order), slideIndex, severity,
 * code, blockId, diagramId, message. Never relies on async event arrival order.
 */
export function sortFindings(
  findings: readonly VisualFinding[],
  viewports: readonly Viewport[],
): VisualFinding[] {
  const vpIndex = new Map(viewports.map((v, i) => [v.name, i]));
  return [...findings].sort((a, b) => {
    const va = vpIndex.get(a.viewport) ?? 999;
    const vb = vpIndex.get(b.viewport) ?? 999;
    if (va !== vb) return va - vb;
    const sa = a.slideIndex ?? -1;
    const sb = b.slideIndex ?? -1;
    if (sa !== sb) return sa - sb;
    const ra = SEVERITY_RANK[a.severity];
    const rb = SEVERITY_RANK[b.severity];
    if (ra !== rb) return ra - rb;
    if (a.code !== b.code) return a.code < b.code ? -1 : 1;
    const ba = a.blockId ?? "";
    const bb = b.blockId ?? "";
    if (ba !== bb) return ba < bb ? -1 : 1;
    const da = a.diagramId ?? "";
    const db = b.diagramId ?? "";
    if (da !== db) return da < db ? -1 : 1;
    return a.message < b.message ? -1 : a.message > b.message ? 1 : 0;
  });
}

export function tally(findings: readonly VisualFinding[]): {
  errors: number;
  warnings: number;
  info: number;
} {
  let errors = 0;
  let warnings = 0;
  let info = 0;
  for (const f of findings) {
    if (f.severity === "error") errors += 1;
    else if (f.severity === "warning") warnings += 1;
    else info += 1;
  }
  return { errors, warnings, info };
}

export function summarizeViewport(
  viewport: Viewport,
  findings: readonly VisualFinding[],
  slideCount: number,
): ViewportResult {
  const own = findings.filter((f) => f.viewport === viewport.name);
  const t = tally(own);
  return {
    viewport: viewport.name,
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: viewport.deviceScaleFactor,
    slideCount,
    findings: own.length,
    errors: t.errors,
    warnings: t.warnings,
    info: t.info,
  };
}
