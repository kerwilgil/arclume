/**
 * Phase 10 final workspace lifecycle: repeated generation builds, transactional
 * rollback, reanalysis invalidation, DELETE-vs-mutation race, canonical
 * preview byte identity, structural file confinement.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { UrlTransport } from "../src/ingestion/url-transport.js";
import { renderCanonicalDeckHtml } from "../src/pipeline/canonical-render.js";
import { runDeck } from "../src/pipeline/run.js";
import { type WebServerHandle, startArclumeWeb } from "../src/web/server.js";

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
  dir = mkdtempSync(join(tmpdir(), "arclume-web-lc-"));
  server = await startArclumeWeb({ port: 0 });
});
afterEach(async () => {
  await server.close();
  rmSync(dir, { recursive: true, force: true });
});

function fixtureProject(): string {
  const p = join(dir, "proj");
  mkdirSync(p, { recursive: true });
  writeFileSync(join(p, "README.md"), "# Lifecycle Project\n\nFor build generations.\n");
  return p;
}

async function call(method: string, path: string, body?: unknown, srv: WebServerHandle = server) {
  const res = await fetch(`${srv.url}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-arclume-session": srv.token,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    json = undefined;
  }
  return { status: res.status, json, headers: res.headers };
}

async function createAndAnalyze(srv: WebServerHandle = server): Promise<string> {
  const proj = fixtureProject();
  const created = await call(
    "POST",
    "/api/workspaces",
    { source: { kind: "path", value: proj } },
    srv,
  );
  const wsId = (created.json as { workspace: { id: string } }).workspace.id;
  const stub = await call("POST", `/api/workspaces/${wsId}/stub-preview`, undefined, srv);
  expect(stub.status).toBe(200);
  return wsId;
}

describe("web build generations", () => {
  it("a second build with a different preset succeeds and swaps generations", async () => {
    const ws = await createAndAnalyze();
    const b1 = await call("POST", `/api/workspaces/${ws}/build`, {
      preset: "executive",
      formats: ["html", "pptx"],
    });
    expect(b1.status).toBe(200);
    const r1 = b1.json as {
      html?: { fileId: string };
      exports: Array<{ format: string; artifactFileId: string }>;
    };
    expect(r1.html?.fileId).toBeDefined();

    const b2 = await call("POST", `/api/workspaces/${ws}/build`, {
      preset: "technical",
      formats: ["html", "pptx"],
    });
    expect(b2.status).toBe(200);
    const r2 = b2.json as typeof r1;

    // old generation ids → 404; new ones work
    const oldArtifact = await fetch(
      `${server.url}/files/${ws}/${r1.exports[0]?.artifactFileId}?session=${server.token}`,
    );
    expect(oldArtifact.status).toBe(404);
    const oldHtml = await fetch(
      `${server.url}/files/${ws}/${r1.html?.fileId}?session=${server.token}`,
    );
    expect(oldHtml.status).toBe(404);

    const newArtifact = await fetch(
      `${server.url}/files/${ws}/${r2.exports[0]?.artifactFileId}?session=${server.token}`,
    );
    expect(newArtifact.status).toBe(200);
    const newHtml = await fetch(
      `${server.url}/files/${ws}/${r2.html?.fileId}?session=${server.token}`,
    );
    expect(newHtml.status).toBe(200);

    // generation dirs: exactly ONE generation under builds/
    const buildsDir = join(tmpdir(), "arclume-web", ws, "builds");
    expect(readdirSync(buildsDir).length).toBe(1);
  });

  it("canonical preview is byte-for-byte the canonical render", async () => {
    const ws = await createAndAnalyze();
    const b = await call("POST", `/api/workspaces/${ws}/build`, {
      preset: "general",
      formats: ["html"],
    });
    expect(b.status).toBe(200);

    const preview = await fetch(`${server.url}/preview/${ws}?session=${server.token}`);
    const previewBytes = Buffer.from(await preview.arrayBuffer());

    // recompute the expected canonical bytes from the current knowledge
    const kn = await call("GET", `/api/workspaces/${ws}/knowledge`);
    const knowledge = (kn.json as { knowledge: Parameters<typeof runDeck>[0] }).knowledge;
    const deckOut = runDeck(knowledge, { audience: "general", theme: "minimal" });
    const expected = Buffer.from(renderCanonicalDeckHtml({ deck: deckOut.deck }).html, "utf8");
    expect(previewBytes.equals(expected)).toBe(true);
  });

  it("a failing second build keeps the previous build intact (rollback)", async () => {
    await server.close();
    let shouldFail = false;
    server = await startArclumeWeb({
      port: 0,
      buildFailureHook: () => {
        if (shouldFail) throw new Error("injected failure");
      },
    });
    const ws = await createAndAnalyze(server);
    const b1 = await call(
      "POST",
      `/api/workspaces/${ws}/build`,
      { preset: "executive", formats: ["html"] },
      server,
    );
    expect(b1.status).toBe(200);
    const r1 = b1.json as { html?: { fileId: string } };
    const f1 = r1.html?.fileId;

    shouldFail = true;
    const b2 = await call(
      "POST",
      `/api/workspaces/${ws}/build`,
      { preset: "technical", formats: ["html"] },
      server,
    );
    expect(b2.status).toBe(500); // injected failure → internal error, no partial swap

    // previous build is still downloadable and preview intact
    const still = await fetch(`${server.url}/files/${ws}/${f1}?session=${server.token}`);
    expect(still.status).toBe(200);
    const prev = await fetch(`${server.url}/preview/${ws}?session=${server.token}`);
    expect(prev.status).toBe(200);

    // no orphan generation dirs: rebuilds dir holds exactly the current one
    const buildsDir = join(tmpdir(), "arclume-web", ws, "builds");
    const gens = existsSync(buildsDir) ? readdirSync(buildsDir) : [];
    expect(gens.length).toBe(1);
  });

  it("a new analysis invalidates old build artifacts (404) but a fresh build works", async () => {
    const ws = await createAndAnalyze();
    const b = await call("POST", `/api/workspaces/${ws}/build`, {
      preset: "general",
      formats: ["html", "pptx"],
    });
    const r1 = b.json as {
      html?: { fileId: string };
      exports: Array<{ artifactFileId: string }>;
    };

    const prep = await call("POST", `/api/workspaces/${ws}/prepare`);
    expect(prep.status).toBe(200);

    // old build artifacts are dead, knowledge is gone, preview has no deck
    const oldArtifact = await fetch(
      `${server.url}/files/${ws}/${r1.exports[0]?.artifactFileId}?session=${server.token}`,
    );
    expect(oldArtifact.status).toBe(404);
    const oldHtml = await fetch(
      `${server.url}/files/${ws}/${r1.html?.fileId}?session=${server.token}`,
    );
    expect(oldHtml.status).toBe(404);
    const prev = await fetch(`${server.url}/preview/${ws}?session=${server.token}`);
    expect(prev.status).toBe(404);
    const kn = await call("GET", `/api/workspaces/${ws}/knowledge`);
    expect(kn.status).toBe(409);

    // a fresh stub analysis + build works just fine
    const re = await call("POST", `/api/workspaces/${ws}/stub-preview`);
    expect(re.status).toBe(200);
    const b2 = await call("POST", `/api/workspaces/${ws}/build`, {
      preset: "general",
      formats: ["html"],
    });
    expect(b2.status).toBe(200);
  });

  it("DELETE while prepare is in flight is refused (409), then accepted after", async () => {
    await server.close();
    // a URL transport that we can park inside the wire fetch
    let gateResolve: (() => void) | undefined;
    const parked = new Promise<void>((res) => {
      gateResolve = res;
    });
    const fake: UrlTransport = {
      async resolve() {
        return ["93.184.216.34"];
      },
      async request() {
        await parked;
        async function* body(): AsyncIterable<Uint8Array> {
          yield new TextEncoder().encode(
            "<!doctype html><html><body><h1>Slow</h1><p>payload</p></body></html>",
          );
        }
        return { status: 200, headers: { "content-type": "text/html" }, body: body() };
      },
    };
    server = await startArclumeWeb({ port: 0, urlTransport: fake });
    const created = await call(
      "POST",
      "/api/workspaces",
      { source: { kind: "url", value: "https://example.com/x" } },
      server,
    );
    const wsId = (created.json as { workspace: { id: string } }).workspace.id;

    const prepPromise = call("POST", `/api/workspaces/${wsId}/prepare`, undefined, server);
    await new Promise((r) => setTimeout(r, 200)); // let prepare reach the parked transport
    const deleted = await call("DELETE", `/api/workspaces/${wsId}`, undefined, server);
    expect(deleted.status).toBe(409);
    expect((deleted.json as { code: string }).code).toBe("web/busy");

    gateResolve?.();
    const prep = await prepPromise;
    expect(prep.status).toBe(200);

    const deleted2 = await call("DELETE", `/api/workspaces/${wsId}`, undefined, server);
    expect(deleted2.status).toBe(200);
  });

  it("registerFile rejects paths outside the workspace even with same prefix", async () => {
    // structural confinement: `…/abc-evil/x` must not pass `…/abc`
    const { WorkspaceRegistry } = await import("../src/web/workspaces.js");
    const reg = new WorkspaceRegistry();
    const ws = reg.create({ kind: "path", value: fixtureProject() });
    const evil = join(`${ws.rootDir}-evil`, "payload.txt");
    mkdirSync(join(`${ws.rootDir}-evil`), { recursive: true });
    writeFileSync(evil, "x");

    expect(() => reg.registerFile(ws, evil, "evil.txt", "text/plain")).toThrow();
    expect(() =>
      reg.registerFile(ws, join(ws.rootDir, "nested", "ok.txt"), "ok.txt", "text/plain"),
    ).not.toThrow();
  });
});
