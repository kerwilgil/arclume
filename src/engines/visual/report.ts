/**
 * Deterministic diagram-engine report.
 *
 * No timestamps, no temp paths, no hostnames, no PIDs, no user paths. Entries
 * are sorted by `diagramId`; the vendored engine identity is constant.
 */

import type { DiagramEngineReport, DiagramEngineReportEntry } from "../types.js";
import { VISUAL_ENGINE_COMMIT, VISUAL_ENGINE_VENDORED } from "./vendored.js";

export function buildDiagramEngineReport(
  entries: ReadonlyArray<DiagramEngineReportEntry>,
): DiagramEngineReport {
  const sorted = [...entries].sort((a, b) =>
    a.diagramId < b.diagramId ? -1 : a.diagramId > b.diagramId ? 1 : 0,
  );
  return {
    engines: { visual: { version: VISUAL_ENGINE_VENDORED, commit: VISUAL_ENGINE_COMMIT } },
    diagrams: sorted.map((entry) => {
      const out: DiagramEngineReportEntry = {
        diagramId: entry.diagramId,
        engineRequested: entry.engineRequested,
        engineUsed: entry.engineUsed,
        outcome: entry.outcome,
        warnings: [...entry.warnings].sort((a, b) =>
          a.code < b.code ? -1 : a.code > b.code ? 1 : 0,
        ),
      };
      if (entry.code !== undefined) out.code = entry.code;
      if (entry.reason !== undefined) out.reason = entry.reason;
      return out;
    }),
  };
}
