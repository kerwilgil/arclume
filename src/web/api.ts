/**
 * Phase 10 web API — the ONLY surface through which the browser talks to the
 * Core. Every handler reuses the pipeline/CLI layers; the UI never executes
 * ingestion/analysis/building itself, and the browser never receives a shell
 * or filesystem primitive.
 */

import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { AgentReasoner } from "../analysis/reasoners/agent.js";
import { buildReasoner } from "../analysis/reasoners/registry.js";
import { StubReasoner } from "../analysis/reasoners/stub.js";
import {
  type VerifiedOutcome,
  reviewCandidate,
  reviewerPromptBuilderFor,
} from "../analysis/reasoners/verified.js";
import { bindAgentAnalysisEnvelope, serializeAnalysisRequest } from "../cli/analysis-artifact.js";
import { CliUsageError } from "../cli/args.js";
import { validateExportBundle } from "../cli/validate.js";
import { loadProvidersConfig } from "../config/providers-config.js";
import { readSecretsFile } from "../config/secrets-store.js";
import { ArclumeError } from "../errors.js";
import type { EvidenceVerificationStatus } from "../evidence/inspect.js";
import { inspectProjectKnowledge } from "../evidence/inspect.js";
import { buildDeckPptx, publishExportBundle } from "../export/index.js";
import { renderDeckPdf } from "../export/pdf.js";
import type { IngestionInput } from "../ingestion/types.js";
import type { UrlTransport } from "../ingestion/url-transport.js";
import type { DeckTypeName } from "../narrative/deck-types.js";
import { DECK_TYPE_NAMES, isDeckTypeName } from "../narrative/deck-types.js";
import { AUDIENCE_NAME_VALUES, isAudienceName } from "../narrative/types.js";
import type { AudienceName } from "../narrative/types.js";
import { renderCanonicalDeckHtml } from "../pipeline/canonical-render.js";
import { analyzePrepared, buildKnowledge, prepareAnalysis } from "../pipeline/run.js";
import { runDeck } from "../pipeline/run.js";
import {
  PickSourceBusyError,
  type PickSourceResult,
  pickLocalSource,
  pickSourceSupported,
} from "./pick-source.js";
import { handleSettingsApi } from "./providers-api.js";
import { type WebWorkspace, WorkspaceError, newBuildGenerationId } from "./workspaces.js";
import type { WebExportRecord, WorkspaceRegistry } from "./workspaces.js";

export interface WebApiDeps {
  registry: WorkspaceRegistry;
  /** TEST-ONLY seam: substitutes the wire for URL sources. Never public. */
  urlTransport?: UrlTransport;
  /** TEST-ONLY seam: throws mid-build to prove transactional rollback. */
  buildFailureHook?: (() => void) | undefined;
  /**
   * TEST-ONLY seam: substitutes the native OS source dialog, so tests can
   * answer "picked a path" / "cancelled" without spawning UI.
   */
  pickSource?: () => Promise<PickSourceResult>;
}

export interface ApiSuccess {
  status: number;
  body: unknown;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function errToApi(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  if (err instanceof WorkspaceError) return new ApiError(err.status, err.message, err.code);
  if (err instanceof ArclumeError) return new ApiError(400, err.message, err.code, err.hint);
  if (err instanceof CliUsageError)
    return new ApiError(400, err.message, "web/bad-request", err.hint);
  return new ApiError(500, (err as Error).message, "web/internal");
}

function requireBodyObject(body: unknown, what: string): Record<string, unknown> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ApiError(400, `${what} must be a JSON object`, "web/bad-request");
  }
  return body as Record<string, unknown>;
}

function requireString(v: unknown, field: string): string {
  if (typeof v !== "string" || v.length === 0) {
    throw new ApiError(400, `"${field}" must be a non-empty string`, "web/bad-request");
  }
  return v;
}

function lock(ws: WebWorkspace): void {
  if (ws.busy) {
    throw new ApiError(409, "workspace is busy; another operation is running", "web/busy");
  }
  ws.busy = true;
}

function unlock(ws: WebWorkspace): void {
  ws.busy = false;
}

/** Normalized build request shape for the web API. */
export interface WebBuildRequest {
  audience: AudienceName;
  deckType?: DeckTypeName;
  theme: "minimal" | "executive";
  formats: ("html" | "pdf" | "pptx")[];
}

/**
 * Resolve the audience + deck-type + theme from the request. Legacy presets
 * (`preset: "executive"`) map to the corresponding audience + theme. Explicit
 * `audience` / `deckType` fields take precedence (the "Rebuild from Knowledge"
 * flow). Validation errors are 400 with the set of valid ids in the hint.
 */
function parseBuildRequest(body: Record<string, unknown>): WebBuildRequest {
  let audience: AudienceName = "general";
  let theme: "minimal" | "executive" = "minimal";

  const presetId = body["preset"];
  if (presetId !== undefined) {
    const p = typeof presetId === "string" ? presetId : "";
    const map: Record<string, { audience: AudienceName; theme: "minimal" | "executive" }> = {
      executive: { audience: "executive", theme: "executive" },
      technical: { audience: "technical", theme: "minimal" },
      general: { audience: "general", theme: "minimal" },
    };
    const found = map[p];
    if (found === undefined) {
      throw new ApiError(
        400,
        `unknown preset "${p}"`,
        "web/bad-request",
        "Presets: executive, technical, general.",
      );
    }
    audience = found.audience;
    theme = found.theme;
  }

  const audienceRaw = body["audience"];
  if (audienceRaw !== undefined) {
    const a = typeof audienceRaw === "string" ? audienceRaw : "";
    if (!isAudienceName(a)) {
      throw new ApiError(
        400,
        `unknown audience "${a}"`,
        "web/bad-request",
        `Audiences: ${AUDIENCE_NAME_VALUES.join(", ")}.`,
      );
    }
    audience = a;
  }
  if (body["theme"] !== undefined) {
    const t = typeof body["theme"] === "string" ? body["theme"] : "";
    if (t !== "minimal" && t !== "executive") {
      throw new ApiError(
        400,
        `unknown theme "${t}"`,
        "web/bad-request",
        "Themes: minimal, executive.",
      );
    }
    theme = t;
  }

  let deckType: DeckTypeName | undefined;
  if (body["deckType"] !== undefined) {
    const d = typeof body["deckType"] === "string" ? body["deckType"] : "";
    if (!isDeckTypeName(d)) {
      throw new ApiError(
        400,
        `unknown deckType "${d}"`,
        "web/bad-request",
        `Deck types: ${DECK_TYPE_NAMES.join(", ")}.`,
      );
    }
    deckType = d;
  }

  const formatsRaw = body["formats"];
  const formats = Array.isArray(formatsRaw)
    ? formatsRaw.filter((f): f is string => typeof f === "string")
    : [];
  if (formats.length === 0 || formats.some((f) => f !== "html" && f !== "pdf" && f !== "pptx")) {
    throw new ApiError(400, "formats must be a non-empty list of html/pdf/pptx", "web/bad-request");
  }
  return {
    audience,
    ...(deckType !== undefined ? { deckType } : {}),
    theme,
    formats: formats as WebBuildRequest["formats"],
  };
}

/* ------------------------------------------------------------------ */

export async function handleApi(
  method: string,
  pathname: string,
  body: unknown,
  deps: WebApiDeps,
): Promise<ApiSuccess> {
  try {
    return await handleApiInner(method, pathname, body, deps);
  } catch (err) {
    const e = errToApi(err);
    throw e;
  }
}

async function handleApiInner(
  method: string,
  pathname: string,
  body: unknown,
  deps: WebApiDeps,
): Promise<ApiSuccess> {
  const { registry } = deps;
  const parts = pathname.split("/").filter(Boolean);

  if (parts[0] === "api" && parts[1] === "settings") {
    return handleSettingsApi(method, parts, body);
  }

  // Native source picker. Zero input by design: the request body is
  // deliberately never read, so no client-supplied string can reach a
  // process invocation. Cancellation resolves as `{ cancelled: true }`,
  // never an error.
  if (parts[0] === "api" && parts[1] === "system" && parts[2] === "pick-source") {
    if (parts.length !== 3) throw new ApiError(404, "not found", "web/not-found");
    if (method === "GET") {
      // The TEST-ONLY seam stands in for the OS dialog on any platform; in
      // production the picker exists only where `pickSourceSupported()` says.
      return {
        status: 200,
        body: { ok: true, supported: pickSourceSupported() || deps.pickSource !== undefined },
      };
    }
    if (method === "POST") {
      if (deps.pickSource === undefined && !pickSourceSupported()) {
        throw new ApiError(
          400,
          "the native source picker is not available on this platform",
          "web/pick-source-unsupported",
        );
      }
      let result: PickSourceResult;
      try {
        result = deps.pickSource !== undefined ? await deps.pickSource() : await pickLocalSource();
      } catch (err) {
        if (err instanceof PickSourceBusyError) {
          throw new ApiError(409, err.message, "web/pick-source-busy");
        }
        throw new ApiError(
          500,
          "the native source dialog could not be opened",
          "web/pick-source-unavailable",
        );
      }
      return {
        status: 200,
        body: result.cancelled
          ? { ok: true, cancelled: true }
          : { ok: true, cancelled: false, path: result.path },
      };
    }
    throw new ApiError(405, "method not allowed", "web/method-not-allowed");
  }

  if (method === "POST" && pathname === "/api/workspaces") {
    const b = requireBodyObject(body, "workspace request");
    const sourceRaw = requireBodyObject(b["source"], "source");
    const kind = requireString(sourceRaw["kind"], "source.kind");
    const value = requireString(sourceRaw["value"], "source.value");
    if (kind !== "path" && kind !== "url") {
      throw new ApiError(400, `source.kind "${kind}" must be "path" or "url"`, "web/bad-request");
    }
    const ws = registry.create({ kind, value });
    return { status: 201, body: { ok: true, workspace: summaryOf(ws) } };
  }

  // everything below binds to an existing workspace
  const wsMatch = parts[0] === "api" && parts[1] === "workspaces" ? parts[2] : undefined;
  if (wsMatch === undefined) throw new ApiError(404, "not found", "web/not-found");
  const ws = registry.get(wsMatch);
  const action = parts[3];

  if (method === "GET" && parts.length === 3) {
    return { status: 200, body: { ok: true, workspace: summaryOf(ws) } };
  }

  if (method === "DELETE" && parts.length === 3) {
    if (ws.busy) {
      throw new ApiError(409, "workspace is busy; another operation is running", "web/busy");
    }
    registry.delete(ws.id);
    return { status: 200, body: { ok: true } };
  }

  if (method === "POST" && action === "prepare") {
    lock(ws);
    try {
      const prepared = await prepareAnalysis([inputOf(ws)], ingestionDeps(deps));
      const requestJson = serializeAnalysisRequest(prepared);
      const requestPath = join(ws.rootDir, "analysis-request.json");
      writeFileSync(requestPath, requestJson);
      const file = registry.registerFile(
        ws,
        requestPath,
        "analysis-request.json",
        "application/json",
      );
      ws.prepared = prepared;
      ws.prepareIssues = prepared.ingestion.issues.map((i) => ({
        code: i.code,
        severity: i.severity,
        message: i.message,
      }));
      ws.knowledge = undefined;
      // a deliberate new analysis turn invalidates the previous build
      registry.invalidateCurrentBuild(ws);
      return {
        status: 200,
        body: {
          ok: true,
          sourceDigest: prepared.sourceDigest,
          documents: prepared.request.documents.length,
          files: prepared.request.files.length,
          issues: ws.prepareIssues,
          requestFileId: file.id,
        },
      };
    } finally {
      unlock(ws);
    }
  }

  if (method === "POST" && action === "stub-preview") {
    lock(ws);
    try {
      const prepared = await prepareAnalysis([inputOf(ws)], ingestionDeps(deps));
      const analyzed = await analyzePrepared(prepared, new StubReasoner());
      const built = buildKnowledge(analyzed);
      ws.prepared = prepared;
      ws.knowledge = built.knowledge;
      registry.invalidateCurrentBuild(ws);
      return {
        status: 200,
        body: {
          ok: true,
          mode: "stub",
          reasonerId: analyzed.reasoner.id,
          sourceDigest: prepared.sourceDigest,
          issueCount: ws.prepareIssues.length + prepared.ingestion.issues.length,
        },
      };
    } finally {
      unlock(ws);
    }
  }

  if (method === "POST" && action === "agent-result") {
    const b = requireBodyObject(body, "agent result request");
    const envelope = b["envelope"];
    if (envelope === undefined) {
      throw new ApiError(400, "missing `envelope`", "web/bad-request");
    }
    lock(ws);
    try {
      // ALWAYS recompute the current digest: a result prepared for an older
      // state of the input is fatal at the boundary, never silently consumed.
      // Everything below stays in LOCAL variables: a rejected envelope (stale
      // digest, malformed shape) must leave the workspace byte-identical.
      const prepared = await prepareAnalysis([inputOf(ws)], ingestionDeps(deps));
      const analysis = bindAgentAnalysisEnvelope(envelope, "the posted envelope", prepared);
      const analyzed = await analyzePrepared(prepared, new AgentReasoner({ result: analysis }));
      const built = buildKnowledge(analyzed);
      // ── COMMIT: only after the whole agent result was accepted ──
      ws.prepared = prepared;
      ws.knowledge = built.knowledge;
      registry.invalidateCurrentBuild(ws);
      return {
        status: 200,
        body: {
          ok: true,
          mode: "agent",
          reasonerId: analyzed.reasoner.id,
          sourceDigest: prepared.sourceDigest,
        },
      };
    } finally {
      unlock(ws);
    }
  }

  if (method === "POST" && action === "analyze") {
    // Direct Analyze: the configured active provider, no manual envelope.
    // Fast mode commits immediately. Verified mode holds the primary's
    // validated candidate as `pendingCandidate` — nothing is committed to
    // `ws.knowledge` until the reviewer step (`.../review`) succeeds, or the
    // user explicitly accepts the candidate via `.../accept-candidate` after
    // a reviewer failure. Never a silent stub fallback: an unconfigured
    // provider throws `reasoner/provider-not-configured` here exactly as it
    // would from the CLI.
    lock(ws);
    try {
      const prepared = await prepareAnalysis([inputOf(ws)], ingestionDeps(deps));
      const config = loadProvidersConfig();
      const secrets = readSecretsFile();
      const primaryReasoner = buildReasoner(
        config.activeProvider,
        config.providers[config.activeProvider],
        secrets,
      );
      const analyzed = await analyzePrepared(prepared, primaryReasoner);

      if (config.analysisQuality !== "verified") {
        const built = buildKnowledge(analyzed);
        ws.prepared = prepared;
        ws.knowledge = built.knowledge;
        ws.pendingCandidate = undefined;
        registry.invalidateCurrentBuild(ws);
        return {
          status: 200,
          body: {
            ok: true,
            mode: "fast",
            reasonerId: analyzed.reasoner.id,
            sourceDigest: prepared.sourceDigest,
          },
        };
      }

      // Verified: stage the candidate, do not touch ws.knowledge yet.
      ws.prepared = prepared;
      ws.knowledge = undefined;
      ws.pendingCandidate = {
        analysis: analyzed.analysis,
        sourceDigest: prepared.sourceDigest,
        primaryReasonerId: analyzed.reasoner.id,
      };
      registry.invalidateCurrentBuild(ws);
      return {
        status: 200,
        body: {
          ok: true,
          mode: "verified-pending",
          reasonerId: analyzed.reasoner.id,
          sourceDigest: prepared.sourceDigest,
        },
      };
    } finally {
      unlock(ws);
    }
  }

  if (method === "POST" && action === "review") {
    // Verified mode's second step: runs the configured reviewer against the
    // pending candidate. Reviewer failure policy: NEVER silently falls back
    // to the candidate — returns a `verified-reviewer-failed` outcome and
    // leaves `ws.knowledge` untouched (still unset). The caller may then
    // retry `.../accept-candidate` (an explicit Fast acceptance) or fix the
    // reviewer configuration and call `.../review` again.
    lock(ws);
    try {
      if (ws.pendingCandidate === undefined) {
        throw new ApiError(
          409,
          "no pending Verified-mode candidate — call analyze first",
          "web/no-pending-candidate",
        );
      }
      const prepared = ws.prepared;
      if (prepared === undefined || prepared.sourceDigest !== ws.pendingCandidate.sourceDigest) {
        throw new ApiError(
          409,
          "source changed since analyze — re-run analyze",
          "web/source-digest-mismatch",
        );
      }
      const config = loadProvidersConfig();
      if (config.reviewer === undefined) {
        throw new ApiError(
          400,
          "no reviewer configured for Verified mode",
          "web/reviewer-not-configured",
        );
      }
      const secrets = readSecretsFile();
      const candidate = ws.pendingCandidate.analysis;
      const primaryReasonerId = ws.pendingCandidate.primaryReasonerId;

      // Reviewer failure policy: ANY failure to produce a usable, validated
      // review — a misconfigured reviewer (missing key/model — thrown
      // synchronously by buildReasoner before any network call), a transport
      // error, a timeout, or a malformed/invalid response — takes this same
      // graceful path. It never throws up as a raw API error and it never
      // silently promotes the candidate; ws.knowledge stays unset either way.
      let outcome: VerifiedOutcome;
      try {
        const reviewerNonSecret = config.providers[config.reviewer.provider];
        const reviewerConfig =
          config.reviewer.model !== undefined
            ? { ...reviewerNonSecret, model: config.reviewer.model }
            : reviewerNonSecret;
        const reviewerReasoner = buildReasoner(
          config.reviewer.provider,
          reviewerConfig,
          secrets,
          process.env,
          reviewerPromptBuilderFor(candidate),
        );
        outcome = await reviewCandidate(reviewerReasoner, prepared, candidate, primaryReasonerId);
      } catch (err) {
        return {
          status: 200,
          body: {
            ok: true,
            mode: "verified-reviewer-failed",
            reason: err instanceof ArclumeError ? err.message : (err as Error).message,
            primaryReasonerId,
          },
        };
      }
      if (outcome.status === "reviewer-failed") {
        return {
          status: 200,
          body: {
            ok: true,
            mode: "verified-reviewer-failed",
            reason: outcome.reason,
            primaryReasonerId: outcome.primaryReasonerId,
          },
        };
      }

      const built = buildKnowledge({
        analysis: outcome.analysis,
        ingestion: prepared.ingestion,
        sourceDigest: prepared.sourceDigest,
      });
      ws.knowledge = built.knowledge;
      ws.pendingCandidate = undefined;
      registry.invalidateCurrentBuild(ws);
      return {
        status: 200,
        body: {
          ok: true,
          mode: outcome.status === "approved" ? "verified-approved" : "verified-corrected",
          reasonerId: outcome.reviewer.id,
        },
      };
    } finally {
      unlock(ws);
    }
  }

  if (method === "POST" && action === "accept-candidate") {
    // The explicit, user-driven recovery path after a reviewer failure
    // (spec: never an automatic silent fallback). Accepts the primary's
    // already-validated candidate as-is, same as Fast mode would have.
    lock(ws);
    try {
      if (ws.pendingCandidate === undefined) {
        throw new ApiError(409, "no pending candidate to accept", "web/no-pending-candidate");
      }
      const prepared = ws.prepared;
      if (prepared === undefined) {
        throw new ApiError(409, "no prepared analysis", "web/no-prepared-analysis");
      }
      const built = buildKnowledge({
        analysis: ws.pendingCandidate.analysis,
        ingestion: prepared.ingestion,
        sourceDigest: prepared.sourceDigest,
      });
      ws.knowledge = built.knowledge;
      ws.pendingCandidate = undefined;
      registry.invalidateCurrentBuild(ws);
      return { status: 200, body: { ok: true, mode: "fast-accepted" } };
    } finally {
      unlock(ws);
    }
  }

  if (method === "GET" && action === "knowledge") {
    if (ws.knowledge === undefined) {
      throw new ApiError(409, "no knowledge yet — analyze first", "web/no-knowledge");
    }
    return { status: 200, body: { ok: true, knowledge: ws.knowledge } };
  }

  if (method === "GET" && action === "knowledge-evidence") {
    // Evidence Inspector — the deterministic read-model of every claim/risk
    // with per-ref verification. We compute it lazily and cache it on the
    // workspace; only invalidated when knowledge changes.
    if (ws.knowledge === undefined) {
      throw new ApiError(409, "no knowledge yet — analyze first", "web/no-knowledge");
    }
    const cacheKey = knowledgeHashOf(ws);
    if (ws.evidenceCache?.key !== cacheKey) {
      ws.evidenceCache = {
        key: cacheKey,
        value: inspectProjectKnowledge(ws.knowledge, evidenceOptionsFor(ws)),
      };
    }
    return { status: 200, body: { ok: true, ...ws.evidenceCache.value } };
  }

  if (method === "GET" && action === "capabilities") {
    // The deck vocabulary the UI offers (audiences, deck types, formats).
    // Fixed lists — they are code contracts, not data.
    return {
      status: 200,
      body: {
        ok: true,
        audiences: AUDIENCE_NAME_VALUES.map((id) => ({ id })),
        deckTypes: DECK_TYPE_NAMES.map((id) => ({ id })),
        formats: ["html", "pdf", "pptx"] as const,
        buildPresets: [
          { id: "executive", audience: "executive", theme: "executive" },
          { id: "technical", audience: "technical", theme: "minimal" },
          { id: "general", audience: "general", theme: "minimal" },
        ],
      },
    };
  }

  if (method === "POST" && action === "build") {
    const b = requireBodyObject(body, "build request");
    if (ws.knowledge === undefined) {
      throw new ApiError(409, "no knowledge yet — analyze first", "web/no-knowledge");
    }
    const buildReq = parseBuildRequest(b);

    lock(ws);
    // Transactional: everything is built into a fresh generation directory
    // and committed only when every requested format succeeded. A failure
    // leaves the previous current build fully intact (last known good).
    const genDir = join(ws.rootDir, "builds", newBuildGenerationId());
    const nextFileIds = new Set<string>();
    try {
      mkdirSync(genDir, { recursive: true });
      const deckOut = runDeck(ws.knowledge, {
        audience: buildReq.audience,
        ...(buildReq.deckType !== undefined ? { deckType: buildReq.deckType } : {}),
        theme: buildReq.theme,
      });
      const nextDeck = deckOut.deck;
      // The canonical HTML is the authoritative definition — never altered.
      const nextHtml = renderCanonicalDeckHtml({ deck: nextDeck }).html;

      let htmlFileId: string | undefined;
      if (buildReq.formats.includes("html")) {
        const htmlPath = join(genDir, "deck.html");
        writeFileSync(htmlPath, nextHtml);
        const f = registry.registerFile(ws, htmlPath, "deck.html", "text/html; charset=utf-8");
        nextFileIds.add(f.id);
        htmlFileId = f.id;
      }
      deps.buildFailureHook?.();

      const nextExports: WebExportRecord[] = [];
      if (buildReq.formats.includes("pdf")) {
        const { bytes, receipt } = await renderDeckPdf({ deck: nextDeck });
        const bundle = await publishExportBundle({
          destination: join(genDir, "deck.pdf-export"),
          fileName: "deck.pdf",
          format: "pdf",
          artifact: bytes,
          receipt,
          renderInput: { deck: nextDeck },
        });
        const artifact = registry.registerFile(
          ws,
          bundle.artifactPath,
          "deck.pdf",
          "application/pdf",
        );
        const rec = registry.registerFile(
          ws,
          bundle.receiptPath,
          "export-receipt.pdf.json",
          "application/json",
        );
        nextFileIds.add(artifact.id);
        nextFileIds.add(rec.id);
        nextExports.push({
          format: "pdf",
          bundlePath: bundle.bundlePath,
          exportId: bundle.exportId,
          warnings: [...receipt.validation.warnings],
          artifactFileId: artifact.id,
          receiptFileId: rec.id,
        });
      }
      if (buildReq.formats.includes("pptx")) {
        const { bytes, receipt } = await buildDeckPptx({ deck: nextDeck });
        const bundle = await publishExportBundle({
          destination: join(genDir, "deck.pptx-export"),
          fileName: "deck.pptx",
          format: "pptx",
          artifact: bytes,
          receipt,
          renderInput: { deck: nextDeck },
        });
        const artifact = registry.registerFile(
          ws,
          bundle.artifactPath,
          "deck.pptx",
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        );
        const rec = registry.registerFile(
          ws,
          bundle.receiptPath,
          "export-receipt.pptx.json",
          "application/json",
        );
        nextFileIds.add(artifact.id);
        nextFileIds.add(rec.id);
        nextExports.push({
          format: "pptx",
          bundlePath: bundle.bundlePath,
          exportId: bundle.exportId,
          warnings: [...receipt.validation.warnings],
          artifactFileId: artifact.id,
          receiptFileId: rec.id,
        });
      }

      // ── COMMIT: only after every requested format succeeded ──
      const oldDir = ws.currentBuildDir;
      const oldIds = ws.buildFileIds;
      ws.deck = nextDeck;
      ws.html = nextHtml;
      ws.exports = nextExports;
      ws.currentBuildDir = genDir;
      ws.buildFileIds = nextFileIds;
      for (const fid of oldIds) ws.files.delete(fid);
      if (oldDir !== undefined) {
        rmSync(oldDir, { recursive: true, force: true });
      }

      return {
        status: 200,
        body: {
          ok: true,
          slides: nextDeck.slides.length,
          html: htmlFileId !== undefined ? { fileId: htmlFileId } : undefined,
          exports: nextExports.map((e) => ({
            format: e.format,
            exportId: e.exportId,
            artifactFileId: e.artifactFileId,
            receiptFileId: e.receiptFileId,
            warnings: e.warnings,
          })),
        },
      };
    } catch (err) {
      // failed build: remove the ORPHAN generation + any files it registered
      for (const fid of nextFileIds) ws.files.delete(fid);
      rmSync(genDir, { recursive: true, force: true });
      throw err;
    } finally {
      unlock(ws);
    }
  }

  if (method === "POST" && action === "validate") {
    const b = requireBodyObject(body, "validate request");
    const format = requireString(b["format"], "format");
    const found = ws.exports.find((e) => e.format === format);
    if (found === undefined) {
      throw new ApiError(404, `no ${format} export in this workspace`, "web/no-export");
    }
    const issues = await validateExportBundle(found.bundlePath);
    return {
      status: 200,
      body: {
        ok: true,
        format,
        valid: issues.filter((i) => !i.code.startsWith("warning:")).length === 0,
        issues,
      },
    };
  }

  throw new ApiError(404, `no such API route: ${method} ${pathname}`, "web/not-found");
}

/* ------------------------------------------------------------------ */

function inputOf(ws: WebWorkspace): IngestionInput {
  return ws.source.kind === "url" ? { kind: "url", url: ws.source.value } : ws.source.value;
}

function ingestionDeps(deps: WebApiDeps) {
  return deps.urlTransport !== undefined
    ? { ingestion: { url: { transport: deps.urlTransport } } }
    : {};
}

function summaryOf(ws: WebWorkspace): Record<string, unknown> {
  return {
    id: ws.id,
    source: ws.source,
    stage:
      ws.exports.length > 0
        ? "export"
        : ws.knowledge !== undefined
          ? "knowledge"
          : ws.prepared !== undefined
            ? "analysis"
            : "source",
    hasKnowledge: ws.knowledge !== undefined,
    hasHtml: ws.html !== undefined,
    exports: ws.exports.map((e) => e.format),
  };
}

/**
 * The Evidence Inspector cache key. Uses the knowledge's content hash when
 * present; otherwise falls back to a stable sentinel based on the source —
 * knowledge identity is derived, never invented.
 */
function knowledgeHashOf(ws: WebWorkspace): string {
  const k = ws.knowledge;
  if (k?.meta?.contentHash) return k.meta.contentHash;
  // No hash: fall back to a stable fingerprint of the knowledge itself.
  return `cache:${ws.source.kind}:${ws.prepared?.sourceDigest ?? "unknown"}`;
}

/**
 * The `repoRoot` the Evidence Inspector verifies file locators against. For a
 * path source, the repo root is the source directory itself (or the parent of
 * a single-file source). For URL sources there is no local repo, so the
 * inspector reports "unavailable" for file locators — never guesses.
 */
function evidenceOptionsFor(ws: WebWorkspace): {
  repoRoot?: string;
  fallbackRevision?: string;
} {
  if (ws.source.kind !== "path") return {};
  const sourcePath = resolve(ws.source.value);
  if (!existsSync(sourcePath)) return {};
  const rootDir = statSync(sourcePath).isDirectory() ? sourcePath : dirname(sourcePath);
  return { repoRoot: rootDir };
}
