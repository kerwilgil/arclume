/**
 * Phase 10 web workspaces — in-memory, process-scoped, ARCLUME-temp-rooted.
 *
 * A workspace owns: its source declaration, the prepared analysis, the
 * knowledge, the built deck + rendered bytes, and the export bundles (each in
 * an ARCLUME-owned temp dir). Workspace ids are random runtime ids — they
 * NEVER flow into ProjectKnowledge / deck / receipts (the Core stays
 * deterministic).
 */

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { AnalysisResult } from "../analysis/analysis-result.js";
import type { EvidenceSummary } from "../evidence/inspect.js";
import type { IngestionInput } from "../ingestion/types.js";
import type { PreparedAnalysis } from "../pipeline/run.js";
import type { ArclumeDeck } from "../types/deck.js";
import type { ProjectKnowledge } from "../types/knowledge.js";

export const WEB_WS_ROOT = join(tmpdir(), "arclume-web");

export type WebSourceKind = "path" | "url";

export interface WebWorkspaceFile {
  /** Workspace-scoped id used by the download endpoint (never a path). */
  id: string;
  name: string;
  /** Absolute path inside this workspace's temp dir. */
  absPath: string;
  contentType: string;
}

export interface WebExportRecord {
  format: "pdf" | "pptx";
  bundlePath: string;
  exportId: string;
  warnings: string[];
  receiptFileId: string;
  artifactFileId: string;
}

export interface WebWorkspace {
  id: string;
  rootDir: string;
  source: { kind: WebSourceKind; value: string };
  prepared?: PreparedAnalysis | undefined;
  prepareIssues: Array<{ code: string; severity: string; message: string }>;
  knowledge?: ProjectKnowledge | undefined;
  deck?: ArclumeDeck | undefined;
  html?: string | undefined;
  exports: WebExportRecord[];
  /**
   * Verified mode's in-flight state: the primary reasoner's already-validated
   * candidate, held here between `POST .../analyze` (quality: "verified")
   * and `POST .../review`. Never promoted to `knowledge` until the reviewer
   * step actually succeeds, or the user explicitly accepts it via a Fast
   * retry — see the reviewer failure policy in `analysis/reasoners/verified.ts`.
   */
  pendingCandidate?:
    | { analysis: AnalysisResult; sourceDigest: string; primaryReasonerId: string }
    | undefined;
  /**
   * The CURRENT build generation dir: `rootDir/builds/<genId>`. Only a build
   * that fully succeeded is current; file ids it owns are in
   * `buildFileIds` and are removed together with the generation.
   */
  currentBuildDir?: string | undefined;
  buildFileIds: Set<string>;
  files: Map<string, WebWorkspaceFile>;
  /** Coop lock — one mutation at a time per workspace. */
  /**
   * The Evidence Inspector cache. Computed lazily on first read after a
   * knowledge update; keyed by the knowledge's `meta.contentHash` (falls back
   * to a fixed sentinel when the knowledge has no hash). This is the boundary
   * that keeps the verifier from running per render.
   */
  evidenceCache?: { key: string; value: EvidenceSummary } | undefined;
  busy: boolean;
}

export class WorkspaceError extends Error {
  readonly status: number;
  constructor(
    status: number,
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "WorkspaceError";
    this.status = status;
  }
}

export class WorkspaceRegistry {
  readonly #map = new Map<string, WebWorkspace>();

  create(source: { kind: WebSourceKind; value: string }): WebWorkspace {
    if (source.kind === "path" && !existsSync(source.value)) {
      throw new WorkspaceError(
        400,
        `source path does not exist: ${source.value}`,
        "web/source-missing",
      );
    }
    if (source.kind === "url" && !/^https:\/\//i.test(source.value)) {
      throw new WorkspaceError(400, "only https:// URLs are accepted", "web/source-url-insecure");
    }
    const id = randomBytes(12).toString("hex");
    const rootDir = join(WEB_WS_ROOT, id);
    mkdirSync(rootDir, { recursive: true });
    const ws: WebWorkspace = {
      id,
      rootDir,
      source: { kind: source.kind, value: source.value },
      prepared: undefined,
      prepareIssues: [],
      knowledge: undefined,
      deck: undefined,
      html: undefined,
      exports: [],
      pendingCandidate: undefined,
      currentBuildDir: undefined,
      buildFileIds: new Set(),
      files: new Map(),
      busy: false,
    };
    this.#map.set(id, ws);
    return ws;
  }

  get(id: string): WebWorkspace {
    const ws = this.#map.get(id);
    if (ws === undefined) {
      throw new WorkspaceError(404, `unknown workspace "${id}"`, "web/workspace-missing");
    }
    return ws;
  }

  /** Delete a workspace and ONLY its ARCLUME-owned temp dir. */
  delete(id: string): void {
    const ws = this.get(id);
    rmSync(ws.rootDir, { recursive: true, force: true });
    this.#map.delete(id);
  }

  /** Server shutdown: remove every workspace temp dir we own. */
  deleteAll(): void {
    for (const id of [...this.#map.keys()]) this.delete(id);
  }

  /**
   * Register a downloadable file that lives INSIDE the workspace temp dir.
   * Confinement is structural (resolve + relative), never a textual prefix —
   * `…/abc-evil` must not be confusable with `…/abc`.
   */
  registerFile(
    ws: WebWorkspace,
    absPath: string,
    name: string,
    contentType: string,
  ): WebWorkspaceFile {
    const root = resolve(ws.rootDir);
    const full = resolve(absPath);
    const rel = relative(root, full);
    if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
      throw new WorkspaceError(
        500,
        `file "${name}" is outside the workspace temp dir`,
        "web/workspace-escape",
      );
    }
    const id = randomBytes(10).toString("hex");
    const file: WebWorkspaceFile = { id, name, absPath: full, contentType };
    ws.files.set(id, file);
    return file;
  }

  file(id: string, wsId: string): WebWorkspaceFile {
    const ws = this.get(wsId);
    const f = ws.files.get(id);
    if (f === undefined) {
      throw new WorkspaceError(404, `unknown file id "${id}"`, "web/file-missing");
    }
    return f;
  }

  /**
   * Removes file ids owned by the CURRENT build generation and deletes the
   * generation directory. Build artifacts from a PREVIOUS analysis turn must
   * not remain downloadable as if they were current.
   */
  invalidateCurrentBuild(ws: WebWorkspace): void {
    for (const fid of ws.buildFileIds) ws.files.delete(fid);
    ws.buildFileIds = new Set();
    if (ws.currentBuildDir !== undefined) {
      rmSync(ws.currentBuildDir, { recursive: true, force: true });
    }
    ws.currentBuildDir = undefined;
    ws.deck = undefined;
    ws.html = undefined;
    ws.exports = [];
  }
}

/** Random runtime-only id for a build generation (never canonical data). */
export function newBuildGenerationId(): string {
  return `gen-${randomBytes(8).toString("hex")}`;
}

/** What the API sends back when a workspace is created. */
export function workspaceSummary(ws: WebWorkspace): Record<string, unknown> {
  return {
    id: ws.id,
    source: ws.source,
    stage:
      ws.exports.length > 0
        ? "export"
        : ws.knowledge !== undefined
          ? "build"
          : ws.prepared !== undefined
            ? "analysis"
            : "source",
  };
}

/** Convert a web source into the explicit Core input shape. */
export function workspaceInput(ws: WebWorkspace): IngestionInput {
  return ws.source.kind === "url" ? { kind: "url", url: ws.source.value } : ws.source.value;
}
