/**
 * Phase 10 agent-result atomicity: a REJECTED agent result — stale source
 * digest or malformed envelope — must leave the workspace completely
 * untouched. Not just "the HTTP call failed": prepared digest, knowledge,
 * canonical preview bytes, build file ids and exports all stay identical.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { StubReasoner } from "../src/analysis/reasoners/stub.js";
import { analyzePrepared, prepareAnalysis } from "../src/pipeline/run.js";
import { type WebServerHandle, startArclumeWeb } from "../src/web/server.js";
import { WorkspaceRegistry } from "../src/web/workspaces.js";

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
let registry: WorkspaceRegistry;
let server: WebServerHandle;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "arclume-web-atomic-"));
  registry = new WorkspaceRegistry();
  server = await startArclumeWeb({ port: 0, registry });
});
afterEach(async () => {
  await server.close();
  rmSync(dir, { recursive: true, force: true });
});

function fixtureProject(): string {
  const p = join(dir, "proj");
  mkdirSync(p, { recursive: true });
  writeFileSync(join(p, "README.md"), "# Atomicity Project\n\nSource A, the accepted state.\n");
  return p;
}

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${server.url}${path}`, {
    method,
    headers: { "content-type": "application/json", "x-arclume-session": server.token },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    json = undefined;
  }
  return { status: res.status, json };
}

async function fileStatus(ws: string, fileId: string): Promise<number> {
  const res = await fetch(`${server.url}/files/${ws}/${fileId}?session=${server.token}`);
  await res.arrayBuffer();
  return res.status;
}

async function previewBytes(ws: string): Promise<Buffer> {
  const res = await fetch(`${server.url}/preview/${ws}?session=${server.token}`);
  expect(res.status).toBe(200);
  return Buffer.from(await res.arrayBuffer());
}

/** Snapshot of every piece of workspace state a rejected result must preserve. */
interface WorkspaceSnapshot {
  sourceDigest: string;
  knowledge: string;
  exports: string;
  currentBuildDir: string | undefined;
  fileIds: string[];
  preview: Buffer;
  buildFileIds: string[];
}

async function snapshot(wsId: string): Promise<WorkspaceSnapshot> {
  const ws = registry.get(wsId);
  expect(ws.prepared).toBeDefined();
  expect(ws.knowledge).toBeDefined();
  return {
    sourceDigest: ws.prepared?.sourceDigest as string,
    knowledge: JSON.stringify(ws.knowledge),
    exports: JSON.stringify(ws.exports),
    currentBuildDir: ws.currentBuildDir,
    fileIds: [...ws.files.keys()].sort(),
    preview: await previewBytes(wsId),
    buildFileIds: [...ws.buildFileIds].sort(),
  };
}

async function expectUnchanged(wsId: string, before: WorkspaceSnapshot): Promise<void> {
  const after = await snapshot(wsId);
  expect(after.sourceDigest).toBe(before.sourceDigest);
  expect(after.knowledge).toBe(before.knowledge);
  expect(after.exports).toBe(before.exports);
  expect(after.currentBuildDir).toBe(before.currentBuildDir);
  expect(after.fileIds).toEqual(before.fileIds);
  expect(after.buildFileIds).toEqual(before.buildFileIds);
  expect(after.preview.equals(before.preview)).toBe(true);
}

/** source A → accepted agent analysis → successful build. */
async function acceptedWorkspace(): Promise<{
  wsId: string;
  proj: string;
  envelope: unknown;
  htmlFileId: string;
  exportFileIds: string[];
}> {
  const proj = fixtureProject();
  const created = await call("POST", "/api/workspaces", {
    source: { kind: "path", value: proj },
  });
  expect(created.status).toBe(201);
  const wsId = (created.json as { workspace: { id: string } }).workspace.id;

  const prepared = await prepareAnalysis([{ kind: "path", path: proj }]);
  const analyzed = await analyzePrepared(prepared, new StubReasoner());
  const envelope = {
    artifact: "arclume/agent-analysis",
    version: "0.1.0",
    sourceDigest: prepared.sourceDigest,
    analysis: analyzed.analysis,
  };

  const accepted = await call("POST", `/api/workspaces/${wsId}/agent-result`, { envelope });
  expect(accepted.status).toBe(200);
  expect((accepted.json as { sourceDigest: string }).sourceDigest).toBe(prepared.sourceDigest);

  const built = await call("POST", `/api/workspaces/${wsId}/build`, {
    preset: "general",
    // pptx, not pdf: the unit lane has no Chromium (PDF lives in the visual lane)
    formats: ["html", "pptx"],
  });
  expect(built.status).toBe(200);
  const b = built.json as {
    html?: { fileId: string };
    exports: Array<{ artifactFileId: string; receiptFileId: string }>;
  };
  const htmlFileId = b.html?.fileId as string;
  expect(htmlFileId).toBeDefined();
  const exportFileIds = b.exports.flatMap((e) => [e.artifactFileId, e.receiptFileId]);
  expect(exportFileIds.length).toBeGreaterThan(0);

  return { wsId, proj, envelope, htmlFileId, exportFileIds };
}

describe("web agent-result is atomic", () => {
  it("a stale envelope is rejected and mutates NOTHING in the workspace", async () => {
    const { wsId, proj, envelope, htmlFileId, exportFileIds } = await acceptedWorkspace();
    const before = await snapshot(wsId);

    // the source moves on AFTER the accepted state was built
    writeFileSync(join(proj, "README.md"), "# Atomicity Project\n\nSource B, a later state.\n");

    const stale = await call("POST", `/api/workspaces/${wsId}/agent-result`, { envelope });
    expect(stale.status).toBe(400);
    expect((stale.json as { code: string }).code).toBe("reasoner/source-digest-mismatch");

    // the rejected result changed no workspace state whatsoever
    await expectUnchanged(wsId, before);

    // the old build is still fully served
    expect(await fileStatus(wsId, htmlFileId)).toBe(200);
    for (const fid of exportFileIds) expect(await fileStatus(wsId, fid)).toBe(200);

    // knowledge over the API is still the accepted one
    const kn = await call("GET", `/api/workspaces/${wsId}/knowledge`);
    expect(kn.status).toBe(200);
    expect(JSON.stringify((kn.json as { knowledge: unknown }).knowledge)).toBe(before.knowledge);

    // exports still validate against the untouched bundles
    const validated = await call("POST", `/api/workspaces/${wsId}/validate`, { format: "pptx" });
    expect(validated.status).toBe(200);
    expect((validated.json as { valid: boolean }).valid).toBe(true);
  });

  it("a malformed envelope is rejected and mutates NOTHING in the workspace", async () => {
    const { wsId, htmlFileId, exportFileIds } = await acceptedWorkspace();
    const before = await snapshot(wsId);

    for (const bad of [
      { envelope: { analysis: null } },
      { envelope: { artifact: "arclume/agent-analysis", version: "0.1.0" } },
      { envelope: "not-an-object" },
    ]) {
      const res = await call("POST", `/api/workspaces/${wsId}/agent-result`, bad);
      expect(res.status).toBe(400);
      await expectUnchanged(wsId, before);
    }

    expect(await fileStatus(wsId, htmlFileId)).toBe(200);
    for (const fid of exportFileIds) expect(await fileStatus(wsId, fid)).toBe(200);
  });
});
