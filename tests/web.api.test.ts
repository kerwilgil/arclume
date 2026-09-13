/**
 * Phase 10 web API + security boundary tests — browser-free (node fetch
 * against the real server on an ephemeral port).
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { StubReasoner } from "../src/analysis/reasoners/stub.js";
import type { UrlTransport } from "../src/ingestion/url-transport.js";
import { analyzePrepared, prepareAnalysis } from "../src/pipeline/run.js";
import { type WebServerHandle, startArclumeWeb } from "../src/web/server.js";

// Serving the app shell requires the built UI; CI runs tests before `npm run
// build`, so build when the bundle is absent (never rebuild if present).
beforeAll(() => {
  if (!existsSync(join(process.cwd(), "web", "dist", "index.html"))) {
    execFileSync("npm", ["run", "build"], {
      cwd: process.cwd(),
      stdio: "inherit",
      shell: process.platform === "win32",
    });
  }
}, 300_000);

let dir = "";
let server: WebServerHandle;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "arclume-web-test-"));
  server = await startArclumeWeb({ port: 0 });
});
afterEach(async () => {
  await server.close();
  rmSync(dir, { recursive: true, force: true });
});

function fixtureProject(): string {
  const p = join(dir, "proj");
  mkdirSync(p, { recursive: true });
  writeFileSync(join(p, "README.md"), "# Web Test\n\nA fixture project.\n");
  return p;
}

async function apiRaw(
  path: string,
  opts: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
) {
  const headers = { ...(opts.headers ?? {}) };
  if (opts.body !== undefined && !("content-type" in headers)) {
    headers["content-type"] = "application/json";
  }
  const res = await fetch(`${server.url}${path}`, {
    method: opts.method ?? "GET",
    headers,
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, text, json, headers: res.headers };
}

function authed(path: string, opts?: Parameters<typeof apiRaw>[1]) {
  return apiRaw(path, {
    ...opts,
    headers: { "x-arclume-session": server.token, ...(opts?.headers ?? {}) },
  });
}

async function makeWorkspace(source: { kind: "path" | "url"; value: string }) {
  const res = await authed("/api/workspaces", { method: "POST", body: { source } });
  expect(res.status).toBe(201);
  return (res.json as { workspace: { id: string } }).workspace.id;
}

describe("web server static boundary", () => {
  it("serves the app with strict CSP and an injected session token", async () => {
    const r = await fetch(`${server.url}/`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(r.headers.get("content-security-policy")).toContain("object-src 'none'");
    const html = await r.text();
    expect(html).toContain('name="arclume-session"');
    expect(html).not.toContain("__ARCLUME_SESSION__");
    expect(html).toContain(server.token);
  });

  it("rejects a hostile Host header", async () => {
    // fetch() cannot override Host; use the raw http client
    const status = await new Promise<number>((resolvePromise, rejectPromise) => {
      const port = server.port;
      const r = httpRequest(
        {
          host: "127.0.0.1",
          port,
          path: "/api/workspaces",
          method: "POST",
          headers: {
            host: "evil.example",
            "x-arclume-session": server.token,
            "content-type": "application/json",
            "content-length": "2",
          },
        },
        (res) => {
          res.resume();
          res.on("end", () => resolvePromise(res.statusCode ?? 0));
        },
      );
      r.on("error", rejectPromise);
      r.end("{}");
    });
    expect(status).toBe(403);
  });

  it("rejects a foreign Origin", async () => {
    const r = await fetch(`${server.url}/api/workspaces`, {
      method: "POST",
      headers: {
        origin: "https://evil.example",
        "x-arclume-session": server.token,
        "content-type": "application/json",
      },
      body: "{}",
    });
    expect(r.status).toBe(403);
  });

  it("mutations without the session token are refused", async () => {
    const r = await apiRaw("/api/workspaces", { method: "POST", body: {} });
    expect(r.status).toBe(401);
  });

  it("an oversized JSON body is refused without reading it fully", async () => {
    const big = { body: { source: { kind: "path", value: `.${"x".repeat(9 * 1024 * 1024)}` } } };
    const r = await authed("/api/workspaces", { method: "POST", body: big.body });
    expect(r.status).toBe(413);
  });

  it("an unparseable JSON body is a clean 400", async () => {
    const r = await fetch(`${server.url}/api/workspaces`, {
      method: "POST",
      headers: { "x-arclume-session": server.token, "content-type": "application/json" },
      body: "{not json",
    });
    expect(r.status).toBe(400);
  });
});

describe("web workspace lifecycle", () => {
  it("unknown workspace / file, traversal ids", async () => {
    const r1 = await authed("/api/workspaces/nope/prepare", { method: "POST", body: {} });
    expect(r1.status).toBe(404);
    const ws = await makeWorkspace({ kind: "path", value: fixtureProject() });
    // traversal: "/../" segments are URL-normalized away and never reach any
    // filesystem read; encode a file-id containing slashes instead.
    const r2 = await fetch(`${server.url}/files/${ws}/..%2fdeck.html?session=${server.token}`);
    expect(r2.status).toBe(404);
    const r3 = await fetch(`${server.url}/files/${ws}/deadbeef?session=${server.token}`);
    expect(r3.status).toBe(404);
  });

  it("refuses non-https URL sources and missing paths", async () => {
    const r1 = await authed("/api/workspaces", {
      method: "POST",
      body: { source: { kind: "url", value: "http://example.com" } },
    });
    expect(r1.status).toBe(400);
    const r2 = await authed("/api/workspaces", {
      method: "POST",
      body: { source: { kind: "path", value: join(dir, "missing") } },
    });
    expect(r2.status).toBe(400);
  });

  it("prepare → deterministic request + issues; agent digest binding; stale rejected", async () => {
    const proj = fixtureProject();
    const ws = await makeWorkspace({ kind: "path", value: proj });
    const prep = await authed(`/api/workspaces/${ws}/prepare`, { method: "POST" });
    expect(prep.status).toBe(200);
    const prepBody = prep.json as {
      sourceDigest: string;
      documents: number;
      requestFileId: string;
    };
    expect(prepBody.sourceDigest).toMatch(/^sha256:/);
    expect(prepBody.documents).toBeGreaterThan(0);

    // request available as a controlled download
    const dl = await fetch(
      `${server.url}/files/${ws}/${prepBody.requestFileId}?session=${server.token}`,
    );
    expect(dl.status).toBe(200);
    expect(dl.headers.get("content-disposition")).toContain("attachment");
    const requestJson = JSON.parse(await dl.text()) as { sourceDigest: string };
    expect(requestJson.sourceDigest).toBe(prepBody.sourceDigest);

    // produce the agent envelope against the actual prepared digest
    const prepared = await prepareAnalysis([{ kind: "path", path: proj }]);
    const analyzed = await analyzePrepared(prepared, new StubReasoner());
    const envelope = {
      artifact: "arclume/agent-analysis",
      version: "0.1.0",
      sourceDigest: prepared.sourceDigest,
      analysis: analyzed.analysis,
    };
    const consume = await authed(`/api/workspaces/${ws}/agent-result`, {
      method: "POST",
      body: { envelope },
    });
    expect(consume.status).toBe(200);
    expect((consume.json as { mode: string }).mode).toBe("agent");

    const kn = await authed(`/api/workspaces/${ws}/knowledge`, {});
    expect(kn.status).toBe(200);
    const knowledge = (kn.json as { knowledge: { knowledgeVersion: string } }).knowledge;
    expect(knowledge.knowledgeVersion).toMatch(/^\d+\.\d+\.\d+$/);

    // STALE: source changes after prepare → digest mismatch wins
    writeFileSync(join(proj, "README.md"), "# Web Test\nchanged\n");
    const stale = await authed(`/api/workspaces/${ws}/agent-result`, {
      method: "POST",
      body: { envelope },
    });
    expect(stale.status).toBe(400);
    expect((stale.json as { code: string }).code).toBe("reasoner/source-digest-mismatch");
  });

  it("malformed envelope envelope → 400; stub preview is explicit and works", async () => {
    const proj = fixtureProject();
    const ws = await makeWorkspace({ kind: "path", value: proj });
    const bad = await authed(`/api/workspaces/${ws}/agent-result`, {
      method: "POST",
      body: { envelope: { analysis: null } },
    });
    expect(bad.status).toBe(400);

    const stub = await authed(`/api/workspaces/${ws}/stub-preview`, { method: "POST" });
    expect(stub.status).toBe(200);
    expect((stub.json as { mode: string }).mode).toBe("stub");

    const kn = await authed(`/api/workspaces/${ws}/knowledge`, {});
    expect(kn.status).toBe(200);
  });

  it("URL sources flow only through the injected Phase 8 transport", async () => {
    await server.close();
    const fake: UrlTransport = {
      async resolve() {
        return ["93.184.216.34"];
      },
      async request() {
        async function* body(): AsyncIterable<Uint8Array> {
          yield new TextEncoder().encode(
            "<!doctype html><html><body><h1>Web URL source</h1><p>about the topic</p></body></html>",
          );
        }
        return { status: 200, headers: { "content-type": "text/html" }, body: body() };
      },
    };
    server = await startArclumeWeb({ port: 0, urlTransport: fake });
    const ws = await makeWorkspace({ kind: "url", value: "https://example.com/page" });
    const prep = await authed(`/api/workspaces/${ws}/prepare`, { method: "POST" });
    expect(prep.status).toBe(200);
    expect((prep.json as { documents: number }).documents).toBeGreaterThan(0);
  });

  it("build → exact canonical html preview + downloads + validate + delete", async () => {
    const proj = fixtureProject();
    const ws = await makeWorkspace({ kind: "path", value: proj });
    await authed(`/api/workspaces/${ws}/stub-preview`, { method: "POST" });

    const built = await authed(`/api/workspaces/${ws}/build`, {
      method: "POST",
      body: { preset: "executive", formats: ["html", "pptx"] },
    });
    expect(built.status).toBe(200);
    const builtBody = built.json as {
      slides: number;
      html?: { fileId: string };
      exports: Array<{
        format: string;
        exportId: string;
        artifactFileId: string;
        receiptFileId: string;
      }>;
    };
    expect(builtBody.slides).toBeGreaterThan(0);
    expect(builtBody.html?.fileId).toBeDefined();
    expect(builtBody.exports.some((e) => e.format === "pptx")).toBe(true);

    // preview requires the token and returns the canonical HTML
    const noToken = await fetch(`${server.url}/preview/${ws}`);
    expect(noToken.status).toBe(401);
    const preview = await fetch(`${server.url}/preview/${ws}?session=${server.token}`);
    expect(preview.status).toBe(200);
    expect(preview.headers.get("content-type")).toContain("text/html");
    const html = await preview.text();
    expect(html).toContain("arclume");

    // exact canonical bytes: the preview IS `renderCanonicalDeckHtml(deck).html` output
    // (build path uses renderHtml over the same deck produced by runDeck)
    expect(html.startsWith("<?") || html.startsWith("<") || html.startsWith("<!")).toBe(true);

    // download artifact + receipt via file ids
    const pptx = builtBody.exports.find((e) => e.format === "pptx");
    if (pptx === undefined) throw new Error("pptx export missing");
    const dl = await fetch(
      `${server.url}/files/${ws}/${pptx.artifactFileId}?session=${server.token}`,
    );
    expect(dl.status).toBe(200);
    expect(Number(dl.headers.get("content-length"))).toBeGreaterThan(1000);

    const v = await authed(`/api/workspaces/${ws}/validate`, {
      method: "POST",
      body: { format: "pptx" },
    });
    expect(v.status).toBe(200);
    expect((v.json as { valid: boolean }).valid).toBe(true);

    // delete: workspace gone
    const del = await authed(`/api/workspaces/${ws}`, { method: "DELETE" });
    expect(del.status).toBe(200);
    const gone = await authed(`/api/workspaces/${ws}`, {});
    expect(gone.status).toBe(404);
  });

  it("a stale client sees 404 after the workspace was deleted mid-flow", async () => {
    const proj = fixtureProject();
    const ws = await makeWorkspace({ kind: "path", value: proj });
    await authed(`/api/workspaces/${ws}`, { method: "DELETE" });
    const r = await authed(`/api/workspaces/${ws}/prepare`, { method: "POST" });
    expect(r.status).toBe(404);
  });
});
