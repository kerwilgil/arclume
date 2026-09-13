/**
 * Phase 8 — URL ingestion (unit, offline, fully injected transport).
 */

import { brotliCompressSync, deflateSync, gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { IngestionError, ingestInputs } from "../src/index.js";
import {
  assertAllAddressesAllowed,
  isBlockedIp,
  normalizeRequestedUrl,
} from "../src/ingestion/url-security.js";
import { URL_INGESTION_VERSION, ingestUrl } from "../src/ingestion/url.js";
import type { UrlTransport } from "../src/ingestion/url.js";
import { buildTextPdf } from "./helpers/fixture-builders.js";

/** Deterministic chunked body for the injected transport. */
function chunksOf(body: string | Buffer, chunkSize = 4096): AsyncIterable<Uint8Array> {
  const buf = typeof body === "string" ? Buffer.from(body, "utf8") : body;
  return (async function* () {
    for (let i = 0; i < buf.length; i += chunkSize) {
      yield new Uint8Array(buf.subarray(i, Math.min(buf.length, i + chunkSize)));
    }
  })();
}

const okTransport = (body: string | Buffer, mediaType = "text/html"): UrlTransport => ({
  resolve: async () => ["93.184.216.34"],
  request: async () => ({
    status: 200,
    headers: { "content-type": mediaType },
    body: chunksOf(typeof body === "string" ? body : body),
  }),
});

describe("URL normalization (security)", () => {
  it("strips fragments, keeps query order, normalizes default ports", () => {
    expect(normalizeRequestedUrl("https://Example.com:443/p?q=1&r=2#sec")).toBe(
      "https://example.com/p?q=1&r=2",
    );
    expect(normalizeRequestedUrl("http://x.test")).toBe("http://x.test/");
  });

  it("rejects non-http schemes, credentials and garbage", () => {
    expect(() => normalizeRequestedUrl("ftp://x")).toThrow();
    expect(() => normalizeRequestedUrl("file:///etc/passwd")).toThrow();
    expect(() => normalizeRequestedUrl("https://user:pw@example.com/")).toThrow();
    expect(() => normalizeRequestedUrl("notaurl")).toThrow();
    expect(() => normalizeRequestedUrl("javascript:alert(1)")).toThrow();
  });
});

describe("SSRF address policy", () => {
  it("blocks private/reserved addresses exactly", () => {
    for (const ip of [
      "127.0.0.1",
      "10.0.0.5",
      "172.16.4.1",
      "192.168.1.1",
      "169.254.169.254",
      "0.0.0.0",
      "192.0.2.1",
      "198.51.100.5",
      "203.0.113.7",
      "255.255.255.255",
      "224.0.0.1",
    ]) {
      expect(isBlockedIp(ip)).toBe(true);
    }
    for (const ip of ["::1", "::", "fc00::1", "fd12::9", "fe80::1", "::ffff:127.0.0.1"]) {
      expect(isBlockedIp(ip)).toBe(true);
    }
    expect(isBlockedIp("1.1.1.1")).toBe(false);
    expect(isBlockedIp("8.8.8.8")).toBe(false);
    expect(isBlockedIp("2606:4700:4700::1111")).toBe(false);
  });

  it("mixed public/private answers reject the whole host", () => {
    expect(() =>
      assertAllAddressesAllowed(["93.184.216.34", "127.0.0.1"], "example.com"),
    ).toThrow();
    expect(() => assertAllAddressesAllowed(["93.184.216.34", "93.184.216.35"], "x")).not.toThrow();
  });
});

describe("URL acquisition with injected transport", () => {
  it("fetches, snapshots and parses an HTML document", async () => {
    const transport: UrlTransport = {
      resolve: async () => ["93.184.216.34"],
      request: async () => ({
        status: 200,
        headers: { "content-type": "text/html" },
        body: chunksOf(
          "<html><head><title>T</title></head><body><h1>Big news</h1><p>Body text</p></body></html>",
        ),
      }),
    };
    const out = await ingestUrl("https://example.com/article#frag", transport);
    expect(out.snapshot.normalizedRequestedUrl).toBe("https://example.com/article");
    expect(out.snapshot.parserVersion).toBe(URL_INGESTION_VERSION);
    expect(out.documents[0]?.content).toContain("Big news");
    expect(out.snapshot.bodyHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(out.documents[0]?.path).toBe("snapshot");
    expect(out.documents[0]?.sourceId).toBe(out.source.id);
    expect(out.documents[0]?.metadata.finalUrl).toBe("https://example.com/article");
  });

  it("rejects blocked targets before any request", async () => {
    const transport: UrlTransport = {
      resolve: async () => ["127.0.0.1"],
      request: async () => {
        throw new Error("should never be called");
      },
    };
    await expect(ingestUrl("https://intranet.local/", transport)).rejects.toMatchObject({
      code: "ingestion/url-blocked-address",
    });
  });

  it("rejects redirect loops and https→http downgrades", async () => {
    const loop: UrlTransport = {
      resolve: async () => ["93.184.216.34"],
      request: async () => ({
        status: 301,
        headers: { location: "https://example.com/loop" },
        body: chunksOf(""),
      }),
    };
    await expect(ingestUrl("https://example.com/loop", loop)).rejects.toMatchObject({
      code: "ingestion/url-redirect-blocked",
    });
    const downgrade: UrlTransport = {
      resolve: async () => ["93.184.216.34"],
      request: async () => ({
        status: 302,
        headers: { location: "http://example.com/" },
        body: chunksOf(""),
      }),
    };
    await expect(ingestUrl("https://example.com/", downgrade)).rejects.toMatchObject({
      code: "ingestion/url-redirect-blocked",
    });
  });

  it("bounds compressed and decompressed sizes independently", async () => {
    const big = Buffer.from("A".repeat(2 * 1024 * 1024));
    const gz = gzipSync(big);
    const t: UrlTransport = {
      resolve: async () => ["93.184.216.34"],
      request: async () => ({
        status: 200,
        headers: { "content-type": "text/plain", "content-encoding": "gzip" },
        body: chunksOf(gz),
      }),
    };
    await expect(
      ingestUrl("https://example.com/", t, {
        maxRedirects: 5,
        timeoutMs: 1000,
        maxCompressedBytes: gz.length + 1024,
        maxDecompressedBytes: 1024,
        maxHeaderBytes: 1024,
        maxHtmlNodes: 1000,
        maxExtractedChars: 1000,
        maxTableCells: 100,
      }),
    ).rejects.toMatchObject({ code: "ingestion/url-too-large" });
    void brotliCompressSync;
    void deflateSync;
    void buildTextPdf;
  });

  it("rejects unsupported content-encoding", async () => {
    const t: UrlTransport = {
      resolve: async () => ["93.184.216.34"],
      request: async () => ({
        status: 200,
        headers: { "content-type": "text/plain", "content-encoding": "lzma" },
        body: chunksOf(""),
      }),
    };
    await expect(ingestUrl("https://example.com/", t)).rejects.toMatchObject({
      code: "ingestion/unsupported-media-type",
    });
  });

  it("rejects unsupported media types", async () => {
    const t: UrlTransport = {
      resolve: async () => ["93.184.216.34"],
      request: async () => ({
        status: 200,
        headers: { "content-type": "application/octet-stream" },
        body: chunksOf(""),
      }),
    };
    await expect(ingestUrl("https://example.com/", t)).rejects.toMatchObject({
      code: "ingestion/unsupported-media-type",
    });
  });

  it("rejects HTTP error statuses", async () => {
    const t: UrlTransport = {
      resolve: async () => ["93.184.216.34"],
      request: async () => ({ status: 500, headers: {}, body: chunksOf("") }),
    };
    await expect(ingestUrl("https://example.com/", t)).rejects.toMatchObject({
      code: "ingestion/url-invalid",
    });
  });
});

describe("pipeline integration", () => {
  it("an explicit URL input produces a snapshot with a bound document id", async () => {
    const transport: UrlTransport = okTransport(
      Buffer.from("<html><body><h1>Alpha</h1><p>From URL.</p></body></html>"),
    );
    const result = await ingestInputs([{ kind: "url", url: "https://example.com/x" }], {
      url: { transport },
    } as never);
    expect(result.urlSnapshots.length).toBe(1);
    const s = result.urlSnapshots[0];
    if (!s) throw new Error("no snapshot");
    expect(result.documents[0]?.id).toBe(s.documentId);
    expect(result.documents[0]?.sourceId).toBe(s.sourceId);
    expect(result.issues.every((i) => i.code !== "ingestion/url-blocked-address")).toBe(true);
  });
});

describe("IngestionError contract", () => {
  it("is an ArclumeError with stable code", () => {
    const err = new IngestionError("test", { code: "ingestion/url-invalid" });
    expect(err.code).toBe("ingestion/url-invalid");
    expect(err.stage).toBe("INGESTION");
  });
});
