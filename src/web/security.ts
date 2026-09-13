/**
 * Phase 10 web security boundary. The ARCLUME web server is a LOCAL
 * application: loopback-only binding, strict Host/Origin checks, a per-process
 * session token for mutating API calls, hard body size limits and a strict CSP.
 *
 * There is NO public host flag in Phase 10. Nothing here is configurable.
 */

import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

export const WEB_BIND_HOST = "127.0.0.1";
export const WEB_DEFAULT_PORT = 3210;
export const MAX_JSON_BODY_BYTES = 8 * 1024 * 1024;
export const SESSION_HEADER = "x-arclume-session";

/** One random token per server process. Runtime-only; never written to Core artifacts. */
export function generateSessionToken(): string {
  return randomBytes(24).toString("base64url");
}

export interface GateResult {
  ok: boolean;
  status: number;
  message: string;
}

/** Host header exactly `127.0.0.1:<port>` / `localhost:<port>` / `[::1]:<port>`. */
export function checkHost(req: IncomingMessage, port: number): GateResult {
  const host = req.headers.host ?? "";
  const allowed = new Set([`${WEB_BIND_HOST}:${port}`, `localhost:${port}`, `[::1]:${port}`]);
  if (!allowed.has(host)) {
    return { ok: false, status: 403, message: "unexpected Host" };
  }
  return { ok: true, status: 200, message: "" };
}

/**
 * Origin / Referer must be same-origin when present (any browser-driven
 * cross-origin API call is killed here). A missing Origin (curl/node) is fine:
 * the session token still guards mutations.
 */
export function checkOrigin(req: IncomingMessage, port: number): GateResult {
  const origin = req.headers.origin;
  if (origin === undefined) return { ok: true, status: 200, message: "" };
  const accepted: string[] = [
    `http://${WEB_BIND_HOST}:${port}`,
    `http://localhost:${port}`,
    `http://[::1]:${port}`,
  ];
  if (!accepted.includes(origin)) {
    return { ok: false, status: 403, message: "cross-origin request refused" };
  }
  return { ok: true, status: 200, message: "" };
}

/**
 * Mutating methods (POST/DELETE) require the session token either as the
 * `x-arclume-session` header or as a `?session=` query (for <iframe> and
 * download links, which cannot set headers).
 */
export function checkSession(req: IncomingMessage, token: string): GateResult {
  const method = (req.method ?? "GET").toUpperCase();
  if (method === "GET" || method === "HEAD") return { ok: true, status: 200, message: "" };
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const presented = req.headers[SESSION_HEADER] ?? url.searchParams.get("session") ?? "";
  if (presented !== token) {
    return { ok: false, status: 401, message: "missing or wrong session token" };
  }
  return { ok: true, status: 200, message: "" };
}

/** Preview iframe + document downloads: token via query (never a header). */
export function checkTokenQuery(req: IncomingMessage, token: string): GateResult {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (url.searchParams.get("session") !== token) {
    return { ok: false, status: 401, message: "missing or wrong session token" };
  }
  return { ok: true, status: 200, message: "" };
}

/** Exact allowlisted static file fetch. */
export function safeStaticName(name: string): string | undefined {
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,120}$/.test(name)) return undefined;
  if (name.includes("..")) return undefined;
  return name;
}

export const APP_CSP = [
  "default-src 'self'",
  "connect-src 'self'",
  "img-src 'self' data: blob:",
  "style-src 'self'", // vite emits a link stylesheet; system fonts only
  "script-src 'self'",
  "frame-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join("; ");

export function applySecurityHeaders(res: ServerResponse, opts?: { html?: boolean }): void {
  res.setHeader("content-security-policy", APP_CSP);
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("x-frame-options", "SAMEORIGIN");
  if (opts?.html === true) res.setHeader("content-type", "text/html; charset=utf-8");
}

/**
 * Read a request body with a hard cap. Over the cap → reject the request with
 * 413 and stop reading; never materialize an unbounded payload.
 */
export async function readBoundedJsonBody(
  req: IncomingMessage,
  maxBytes: number = MAX_JSON_BODY_BYTES,
): Promise<unknown> {
  return new Promise((resolvePromise, rejectPromise) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let rejected = false;
    req.on("data", (chunk: Buffer) => {
      if (rejected) return;
      total += chunk.length;
      if (total > maxBytes) {
        rejected = true;
        // Do NOT destroy the socket: the router will send a clean 413.
        rejectPromise(Object.assign(new Error("request body too large"), { status: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (rejected) return;
      if (chunks.length === 0) return resolvePromise(undefined);
      try {
        resolvePromise(JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown);
      } catch (err) {
        rejectPromise(
          Object.assign(new Error("body is not valid JSON"), { status: 400, cause: err }),
        );
      }
    });
    req.on("error", (err) => rejectPromise(err));
  });
}
