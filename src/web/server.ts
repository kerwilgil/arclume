/**
 * Phase 10 web server — loopback-only Node http, session-token gated, serving
 * the built React app and the `/api/*` surface. No framework, no socket
 * listeners outside 127.0.0.1, no background polling.
 */

import { existsSync, readFileSync } from "node:fs";
import { type IncomingMessage, type Server, type ServerResponse, createServer } from "node:http";
import { join } from "node:path";
import type { UrlTransport } from "../ingestion/url-transport.js";
import { findPackageRoot } from "../schema/paths.js";
import { type ApiError, handleApi } from "./api.js";
import type { PickSourceResult } from "./pick-source.js";
import {
  APP_CSP,
  MAX_JSON_BODY_BYTES,
  WEB_BIND_HOST,
  WEB_DEFAULT_PORT,
  applySecurityHeaders,
  checkHost,
  checkOrigin,
  checkSession,
  checkTokenQuery,
  generateSessionToken,
  readBoundedJsonBody,
  safeStaticName,
} from "./security.js";
import { WorkspaceRegistry } from "./workspaces.js";

const SESSION_PLACEHOLDER = "__ARCLUME_SESSION__";

export interface WebServerOptions {
  port?: number;
  registry?: WorkspaceRegistry;
  /** TEST-ONLY seam — substitute the wire for URL sources. */
  urlTransport?: UrlTransport;
  /** TEST-ONLY seam — throw mid-build to prove transactional rollback. */
  buildFailureHook?: (() => void) | undefined;
  /** TEST-ONLY seam — answer the native source dialog without spawning UI. */
  pickSource?: () => Promise<PickSourceResult>;
}

export interface WebServerHandle {
  url: string;
  port: number;
  token: string;
  close(): Promise<void>;
}

function contentTypeFor(name: string): string {
  if (name.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (name.endsWith(".css")) return "text/css; charset=utf-8";
  if (name.endsWith(".html")) return "text/html; charset=utf-8";
  if (name.endsWith(".svg")) return "image/svg+xml";
  if (name.endsWith(".json")) return "application/json; charset=utf-8";
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".woff2")) return "font/woff2";
  return "application/octet-stream";
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  applySecurityHeaders(res);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

export async function startArclumeWeb(options: WebServerOptions = {}): Promise<WebServerHandle> {
  const registry = options.registry ?? new WorkspaceRegistry();
  const token = generateSessionToken();
  const webDist = join(findPackageRoot(), "web", "dist");

  const server = createServer((req, res) => {
    void serve(req, res).catch((err) => {
      const e = err as ApiError;
      sendJson(res, e.status ?? 500, {
        ok: false,
        code: e.code ?? "web/internal",
        message: e.message,
        ...(e.hint !== undefined ? { hint: e.hint } : {}),
      });
    });
  });

  async function serve(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const port = (server.address() as { port: number }).port;
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const method = (req.method ?? "GET").toUpperCase();

    // zero-trust perimeter — everything passes Host + Origin, mutations also
    // the session token
    const host = checkHost(req, port);
    if (!host.ok) return sendJson(res, host.status, { ok: false, message: host.message });
    const origin = checkOrigin(req, port);
    if (!origin.ok) return sendJson(res, origin.status, { ok: false, message: origin.message });
    const session = checkSession(req, token);
    if (!session.ok) return sendJson(res, session.status, { ok: false, message: session.message });

    if (pathnameOf(url).startsWith("/api/")) {
      const body = await readBoundedJsonBody(req, MAX_JSON_BODY_BYTES);
      const out = await handleApi(method, pathnameOf(url), body, {
        registry,
        ...(options.urlTransport !== undefined ? { urlTransport: options.urlTransport } : {}),
        ...(options.buildFailureHook !== undefined
          ? { buildFailureHook: options.buildFailureHook }
          : {}),
        ...(options.pickSource !== undefined ? { pickSource: options.pickSource } : {}),
      });
      return sendJson(res, out.status, out.body);
    }

    if (method !== "GET" && method !== "HEAD") {
      return sendJson(res, 405, { ok: false, message: "method not allowed" });
    }

    // preview + downloads are accessible by token query only
    if (url.pathname.startsWith("/preview/") || url.pathname.startsWith("/files/")) {
      const gate = checkTokenQuery(req, token);
      if (!gate.ok) return sendJson(res, gate.status, { ok: false, message: gate.message });
      if (url.pathname.startsWith("/preview/")) {
        const wsId = url.pathname.slice("/preview/".length);
        const ws = registry.get(wsId);
        if (ws.html === undefined) {
          return sendJson(res, 404, { ok: false, message: "no built deck yet — build first" });
        }
        // canonical HTML bytes verbatim; its own inner CSP governs the content
        res.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "x-content-type-options": "nosniff",
          // sandbox policy: server-side we serve as a distinct document path
          // and the UI embeds it in a sandboxed iframe
        });
        res.end(ws.html);
        return;
      }
      // /files/:wsId/:fileId
      const parts = url.pathname.slice("/files/".length).split("/");
      const wsId = parts[0] ?? "";
      const fileId = parts[1] ?? "";
      const file = registry.file(fileId, wsId);
      const bytes = readFileSync(file.absPath);
      res.writeHead(200, {
        "content-type": file.contentType,
        "content-disposition": `attachment; filename="${file.name}"`,
        "x-content-type-options": "nosniff",
        "content-length": bytes.length,
      });
      res.end(bytes);
      return;
    }

    // static brand assets (favicon, logo, symbol, .ico)
    if (url.pathname.startsWith("/brand/")) {
      const name = safeStaticName(url.pathname.slice("/brand/".length));
      const full = name === undefined ? undefined : join(webDist, "brand", name);
      if (full === undefined || !full.startsWith(join(webDist, "brand")) || !existsSync(full)) {
        return sendJson(res, 404, { ok: false, message: "asset not found" });
      }
      res.writeHead(200, {
        "content-type": contentTypeFor(full),
        "x-content-type-options": "nosniff",
        "cache-control": "no-store",
      });
      res.end(readFileSync(full));
      return;
    }

    // static assets (built React app)
    if (url.pathname.startsWith("/assets/")) {
      const name = safeStaticName(url.pathname.slice("/assets/".length));
      const full = name === undefined ? undefined : join(webDist, "assets", name);
      if (full === undefined || !full.startsWith(join(webDist, "assets")) || !existsSync(full)) {
        return sendJson(res, 404, { ok: false, message: "asset not found" });
      }
      res.writeHead(200, {
        "content-type": contentTypeFor(full),
        "x-content-type-options": "nosniff",
        "cache-control": "no-store",
      });
      res.end(readFileSync(full));
      return;
    }

    // app shell — injects the session token as a <meta> so no inline script is
    // needed (script-src 'self')
    if (url.pathname === "/" || url.pathname === "/index.html") {
      const indexPath = join(webDist, "index.html");
      if (!existsSync(indexPath)) {
        return sendJson(res, 500, {
          ok: false,
          message: "web UI is not built (run `npm run build`)",
        });
      }
      const html = readFileSync(indexPath, "utf8").replace(SESSION_PLACEHOLDER, token);
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "content-security-policy": APP_CSP,
        "x-content-type-options": "nosniff",
        "x-frame-options": "DENY",
        "cache-control": "no-store",
      });
      res.end(html);
      return;
    }

    return sendJson(res, 404, { ok: false, message: "not found" });
  }

  function pathnameOf(url: URL): string {
    return url.pathname;
  }

  const tryPort = options.port ?? WEB_DEFAULT_PORT;
  const started = await bind(server, tryPort);
  if (!started.ok) {
    if (options.port !== undefined) {
      registry.deleteAll();
      throw new Error(`port ${options.port} is not available on ${WEB_BIND_HOST}`);
    }
    await listenOn(server, 0); // ephemeral
  }
  const port = (server.address() as { port: number }).port;

  const handle: WebServerHandle = {
    url: `http://${WEB_BIND_HOST}:${port}`,
    port,
    token,
    async close(): Promise<void> {
      await new Promise<void>((resolvePromise, rejectPromise) =>
        server.close((err) => (err ? rejectPromise(err) : resolvePromise())),
      );
      registry.deleteAll();
    },
  };
  return handle;
}

async function bind(server: Server, port: number): Promise<{ ok: boolean }> {
  try {
    await listenOn(server, port);
    return { ok: true };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EADDRINUSE") return { ok: false };
    throw err;
  }
}

function listenOn(server: Server, port: number): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(port, WEB_BIND_HOST, () => resolvePromise());
  });
}
