/**
 * Diagram engine layer — shared types.
 *
 * The ARCLUME Visual Engine is a *downstream render engine*: it consumes the semantic
 * `ArclumeDeck` (`DiagramIR.spec` with `format: "arclume.native.v1"`) and
 * produces resolved, sanitized SVG artifacts. It is never a knowledge,
 * narrative or planning model, and never a source of truth.
 *
 * Nothing in `src/engines/**` may import from `src/renderers/html/**`: the HTML
 * renderer consumes these types, not the other way around.
 */

/** A warning raised by a diagram engine. Mapped to `HtmlRenderWarning` later. */
export interface DiagramEngineWarning {
  code: string;
  message: string;
  diagramId: string;
}

/** Identity sets carried by every resolved artifact (never by visible label). */
export interface ResolvedDiagramProvenance {
  entityIds: string[];
  relationIds: string[];
  stepIds: string[];
  itemIds: string[];
}

/**
 * The resolution outcome for one diagram that *requested* the visual engine.
 *
 * Either a cryptographically bound, sanitized SVG produced by the visual engine, or an
 * explicit native-fallback record. There is no third state: a diagram that
 * requests the visual engine always ends with exactly one of these.
 */
export type ResolvedDiagramArtifact =
  | {
      kind: "svg";
      diagramId: string;
      engineRequested: "visual";
      engineUsed: "visual";
      engineVersion: string;
      engineCommit: string;
      /** Deterministic hash of the source semantic diagram spec. */
      specHash: string;
      /**
       * Hash over every render-driving diagram input (id, diagramType,
       * engineRequested, title, spec) — the cryptographic identity the
       * canonical binding re-checks. A title-only change must NOT reuse the
       * artifact.
       */
      diagramRenderInputHash: string;
      svg: string;
      /** Lowercase hex SHA-256 of the exact `svg` string (UTF-8). */
      svgSha256: string;
      provenance: ResolvedDiagramProvenance;
      warnings: DiagramEngineWarning[];
    }
  | {
      kind: "native-fallback";
      diagramId: string;
      engineRequested: "visual";
      engineUsed: "native";
      specHash: string;
      diagramRenderInputHash: string;
      code: string;
      message: string;
      warnings: DiagramEngineWarning[];
    };

export type DiagramEngineOutcome = "resolved" | "fallback" | "native";

export interface DiagramEngineReportEntry {
  diagramId: string;
  engineRequested: string;
  engineUsed: string;
  outcome: DiagramEngineOutcome;
  code?: string;
  reason?: string;
  warnings: DiagramEngineWarning[];
}

/**
 * Deterministic diagram-engine report. No timestamps, no temp paths, no
 * host or user identity. Entries are sorted by `diagramId`.
 */
export interface DiagramEngineReport {
  engines: {
    visual: { version: string; commit: string };
  };
  diagrams: DiagramEngineReportEntry[];
}
