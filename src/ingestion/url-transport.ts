/**
 * URL transport boundary (Phase 8).
 *
 * The transport returns response HEADERS + a streaming body (async iterable of
 * chunks) so the caller can enforce compressed/decompressed byte budgets
 * BEFORE materializing anything big. Production transport is bound to the
 * hardened policy in `url-security.ts` + this file; tests inject a fake
 * transport through the same contract — and contract requires that the fake
 * exercises the SAME bounded reader (no pre-assembled Buffer shortcuts).
 *
 * Nothing in this module is ambient: a caller supplies the transport; the
 * security decisions are not configurable.
 */

import * as dns from "node:dns/promises";
import * as http from "node:http";
import type { Http2ServerRequest } from "node:http2";
import * as https from "node:https";
import { isIP } from "node:net";
import { IngestionError } from "../errors.js";

/* ------------------------------------------------------------------ */
/* wire shape                                                          */
/* ------------------------------------------------------------------ */

export type { Http2ServerRequest };

export interface WireResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  /** Header-block bytes really read by the transport layer. */
  headerBytes?: number;
  /** Streaming body; producers MUST honor backpressure. */
  body: AsyncIterable<Uint8Array>;
}

export interface WireRequest {
  url: URL;
  /** The validated, pinned IP to connect to. */
  address: string;
  timeoutMs: number;
  /** Node-level cap on header bytes; productive requests MUST set it. */
  maxHeaderBytes?: number | undefined;
}

export interface UrlTransport {
  resolve(host: string): Promise<string[]>;
  request(options: WireRequest): Promise<WireResponse>;
}

/* ------------------------------------------------------------------ */
/* limits                                                              */
/* ------------------------------------------------------------------ */

export interface UrlLimits {
  timeoutMs: number;
  maxRedirects: number;
  maxCompressedBytes: number;
  maxDecompressedBytes: number;
  maxHeaderBytes: number;
  maxHtmlNodes: number;
  maxExtractedChars: number;
  maxTableCells: number;
}

export const DEFAULT_URL_LIMITS: UrlLimits = {
  timeoutMs: 15_000,
  maxRedirects: 5,
  maxCompressedBytes: 8 * 1024 * 1024,
  maxDecompressedBytes: 16 * 1024 * 1024,
  maxHeaderBytes: 32 * 1024,
  maxHtmlNodes: 100_000,
  maxExtractedChars: 4_000_000,
  maxTableCells: 20_000,
};

/** Merge caller overrides over the defaults; every field is honored. */
export function resolveUrlLimits(overrides?: Partial<UrlLimits>): UrlLimits {
  return { ...DEFAULT_URL_LIMITS, ...(overrides ?? {}) };
}

function fail(code: string, message: string): never {
  throw new IngestionError(message, { code, severity: "fatal" });
}

/* ------------------------------------------------------------------ */
/* real transport (pinned socket)                                      */
/* ------------------------------------------------------------------ */

export function createDefaultTransport(): UrlTransport {
  return {
    resolve: (host) =>
      dns.lookup(host, { all: true, verbatim: true }).then((rows) => rows.map((a) => a.address)),
    request: async ({ url, address, timeoutMs, maxHeaderBytes }) =>
      new Promise<WireResponse>((resolve, reject) => {
        const mod = url.protocol === "https:" ? https : http;
        const req = mod.request(
          {
            hostname: url.hostname,
            port: url.port === "" ? undefined : Number(url.port),
            path: url.pathname + url.search,
            method: "GET",
            timeout: timeoutMs,
            agent: false,
            headers: {
              "Accept-Encoding": "gzip, deflate, br",
              "User-Agent": "Arclume/0.8 (+https://github.com/kerwilgil/arclume)",
            },
            // the entire network attack surface is pinned here: the socket
            // connects ONLY to the validated address (DNS rebinding inert).
            lookup: (_host, _opts, cb) => cb(null, address, isIP(address) as 4 | 6),
            ...(url.protocol === "https:" ? { servername: url.hostname } : {}),
            ...(maxHeaderBytes !== undefined ? { maxHeaderSize: maxHeaderBytes } : {}),
          },
          (res) => {
            const bodyAsync = (async function* () {
              for await (const chunk of res) yield chunk as Uint8Array;
            })();
            resolve({
              status: res.statusCode ?? 0,
              headers: res.headers,
              body: bodyAsync,
            });
          },
        );
        req.on("timeout", () =>
          req.destroy(new IngestionError("request timed out", { code: "ingestion/url-timeout" })),
        );
        req.on("error", (err) => {
          if (err instanceof IngestionError) reject(err);
          else
            reject(
              new IngestionError((err as Error).message, {
                code: "ingestion/url-invalid",
                cause: err,
              }),
            );
        });
        req.end();
      }),
  };
}
