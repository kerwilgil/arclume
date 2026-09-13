/**
 * Phase 9 — canonical packaging gate.
 *
 * npm pack → temp project → npm install <tarball> → run the INSTALLED binary.
 * Proves the package is a working product outside the repo: bin resolution,
 * dist, schemas, no src/tests dependence, no cwd coupling.
 */

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let workDir = "";
let tarballPath = "";
let installDir = "";

/** Run a command and return {code, stdout, stderr} (never throws). */
function run(cmd: string, args: string[], cwd: string) {
  const r = spawnSync(cmd, args, {
    cwd,
    windowsHide: true,
    shell: process.platform === "win32" && !cmd.endsWith(".exe"),
  });
  return {
    code: r.status ?? -1,
    stdout: (r.stdout ?? "").toString(),
    stderr: (r.stderr ?? "").toString(),
  };
}

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), "arclume-pack-"));
  // build fresh dist, then pack into the temp dir
  execFileSync("npm", ["run", "build"], {
    cwd: process.cwd(),
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  const packOut = execFileSync("npm", ["pack", `--pack-destination=${workDir}`, "--json"], {
    cwd: process.cwd(),
    shell: process.platform === "win32",
  }).toString();
  const packed = JSON.parse(packOut) as Array<{ filename: string }>;
  const first = packed[0];
  if (first === undefined) throw new Error("npm pack produced no tarball");
  tarballPath = join(workDir, first.filename);

  // clean temp project, install the tarball
  installDir = join(workDir, "consumer");
  mkdirSync(installDir, { recursive: true });
  writeFileSync(
    join(installDir, "package.json"),
    JSON.stringify({ name: "arclume-consumer", version: "0.0.0", private: true }),
  );
  const install = run(
    "npm",
    ["install", tarballPath, "--no-audit", "--no-fund", "--loglevel=error"],
    installDir,
  );
  if (install.code !== 0) {
    throw new Error(`npm install of the tarball failed: ${install.stderr}`);
  }
}, 600_000);

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

const INSTALL_TIMEOUT = 600_000;

function installedCli(args: string[], cwd: string) {
  // Run the installed binary through node directly (portable across OS; the
  // .bin shim itself is exercised indirectly by the path provenance).
  const bin = join(installDir, "node_modules", "arclume", "dist", "cli", "index.js");
  return run(process.execPath, [bin, ...args], cwd);
}

describe("npm pack → clean install smoke", () => {
  it("the tarball contains bin, schemas, SKILL.md and vendor/archify — not tests/", () => {
    const list = run("npm", ["pack", "--dry-run", "--json"], process.cwd());
    const parsed = JSON.parse(list.stdout) as Array<{ files: Array<{ path: string }> }>;
    const files = (parsed[0]?.files ?? []).map((f) => f.path);
    for (const required of [
      "dist/cli/index.js",
      "dist/index.js",
      "dist/web/server.js",
      "web/dist/index.html",
      "schemas/export-receipt.schema.json",
      "schemas/arclume-deck.schema.json",
      "SKILL.md",
      "LICENSE",
    ]) {
      expect(files).toContain(required);
    }
    expect(files.some((f) => f.startsWith("web/dist/assets/index-"))).toBe(true);
    expect(files.some((f) => f.startsWith("vendor/archify/"))).toBe(true);
    expect(files.some((f) => f.startsWith("tests/"))).toBe(false);
    expect(files.some((f) => f.startsWith("src/"))).toBe(false);
  });

  it("installed binary: --version and --help work outside the repo", () => {
    const v = installedCli(["--version"], installDir);
    expect(v.code).toBe(0);
    expect(v.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    const h = installedCli(["--help"], installDir);
    expect(h.code).toBe(0);
    expect(h.stdout).toContain("arclume analyze");
  });

  it("REAL npm bin wiring: `npm exec` resolves the installed shim", () => {
    // npm's own bin resolution — not a hand-rolled dist path.
    const v = run("npm", ["exec", "--", "arclume", "--version"], installDir);
    expect(v.code).toBe(0);
    expect(v.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    const h = run("npm", ["exec", "--", "arclume", "--help"], installDir);
    expect(h.code).toBe(0);
    expect(h.stdout).toContain("arclume analyze");
  });

  it("installed binary analyzes + builds HTML without any repo trace", () => {
    const proj = join(installDir, "proj de prueba");
    mkdirSync(proj, { recursive: true });
    writeFileSync(
      join(proj, "README.md"),
      "# Proyecto Ejemplo\n\nUn proyecto para la prueba del paquete.\n\n## Estado\n\n- Listo\n",
    );
    writeFileSync(join(proj, "package.json"), '{"name":"proyecto-ejemplo"}');

    const a = installedCli(
      ["analyze", proj, "--reasoner", "stub", "--out", "knowledge.json"],
      installDir,
    );
    expect(a.code).toBe(0);
    expect(a.stderr).not.toContain("src/");
    const knowledge = JSON.parse(readFileSync(join(installDir, "knowledge.json"), "utf8")) as {
      knowledgeVersion: string;
    };
    expect(knowledge.knowledgeVersion).toMatch(/^\d+\.\d+\.\d+$/);

    const b = installedCli(["build", "knowledge.json", "--preset", "executive"], installDir);
    expect(b.code).toBe(0);
    const html = readFileSync(join(installDir, "arclume-output", "deck.html"), "utf8");
    expect(html).toContain("arclume");
  });

  it(
    "installed binary builds a PPTX export bundle and validates it",
    () => {
      const code = installedCli(
        ["build", "knowledge.json", "--format", "pptx", "--out", "pptx-out"],
        installDir,
      );
      expect(code.code).toBe(0);
      const bundle = join(installDir, "pptx-out", "deck.pptx-export");
      expect(existsSync(join(bundle, "deck.pptx"))).toBe(true);
      const v = installedCli(["validate", bundle], installDir);
      expect(v.code).toBe(0);
      expect(v.stdout).toContain("VALID");
    },
    INSTALL_TIMEOUT,
  );

  it("packed web server: `arclume web` serves the built UI with CSP, then exits", async () => {
    const cliBin = join(installDir, "node_modules", "arclume", "dist", "cli", "index.js");
    const proc = spawn(process.execPath, [cliBin, "web", "--port", "0"], {
      cwd: installDir,
      stdio: ["ignore", "pipe", "pipe"],
    });
    try {
      const url = await new Promise<string>((resolvePromise, rejectPromise) => {
        let out = "";
        const timer = setTimeout(
          () => rejectPromise(new Error("web server never printed a URL")),
          60_000,
        );
        proc.stdout?.on("data", (chunk: Buffer) => {
          out += chunk.toString();
          const m = out.match(/http:\/\/127\.0\.0\.1:\d+/);
          if (m) {
            clearTimeout(timer);
            resolvePromise(m[0]);
          }
        });
        proc.on("exit", () => rejectPromise(new Error(`web exited early: ${out}`)));
      });
      const page = await fetch(`${url}/`);
      expect(page.status).toBe(200);
      expect(page.headers.get("content-security-policy")).toContain("object-src 'none'");
      const html = await page.text();
      expect(html).toContain('name="arclume-session"');
      expect(html).not.toContain("__ARCLUME_SESSION__");
    } finally {
      proc.kill("SIGINT");
      await new Promise<void>((res) => {
        const t = setTimeout(res, 5_000);
        proc.once("exit", () => {
          clearTimeout(t);
          res();
        });
      });
    }
  });

  it("packed web runtime: assets load, API prepare→stub→build html→preview→download", async () => {
    const cliBin = join(installDir, "node_modules", "arclume", "dist", "cli", "index.js");
    const proc = spawn(process.execPath, [cliBin, "web", "--port", "0"], {
      cwd: installDir,
      stdio: ["ignore", "pipe", "pipe"],
    });
    try {
      const url = await new Promise<string>((resolvePromise, rejectPromise) => {
        let out = "";
        const timer = setTimeout(() => rejectPromise(new Error("no web URL printed")), 60_000);
        proc.stdout?.on("data", (chunk: Buffer) => {
          out += chunk.toString();
          const m = out.match(/http:\/\/127\.0\.0\.1:\d+/);
          if (m) {
            clearTimeout(timer);
            resolvePromise(m[0]);
          }
        });
      });

      // app shell with session token
      const page = await fetch(`${url}/`);
      expect(page.status).toBe(200);
      const html = await page.text();
      const tokenMatch = html.match(/name="arclume-session" content="([^"]+)"/);
      expect(tokenMatch).not.toBeNull();
      const token = (tokenMatch as RegExpMatchArray)[1] as string;

      // every referenced /assets/* must download with the right MIME
      const assets = [...html.matchAll(/(?:src|href)="((?:\/)?assets\/[^"]+)"/g)]
        .map((m) => m[1])
        .filter((a): a is string => typeof a === "string" && a.length > 0);
      expect(assets.length).toBeGreaterThanOrEqual(2);
      for (const a of assets) {
        const r = await fetch(`${url}/${a.startsWith("/") ? a.slice(1) : a}`);
        expect(r.status).toBe(200);
        const ct = r.headers.get("content-type") ?? "";
        if (a.endsWith(".js")) expect(ct).toContain("javascript");
        if (a.endsWith(".css")) expect(ct).toContain("text/css");
      }

      // full packed API smoke: workspace → stub → build html → preview → download
      const proj = join(installDir, "packed-proj");
      mkdirSync(proj, { recursive: true });
      writeFileSync(join(proj, "README.md"), "# Packed Web\n\nPacked web runtime proof.\n");
      const post = async (path: string, body?: unknown) =>
        fetch(`${url}${path}`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-arclume-session": token },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        });
      const wsCreated = await post("/api/workspaces", {
        source: { kind: "path", value: proj },
      });
      expect(wsCreated.status).toBe(201);
      const wsId = ((await wsCreated.json()) as { workspace: { id: string } }).workspace.id;

      expect((await post(`/api/workspaces/${wsId}/stub-preview`)).status).toBe(200);
      const built = await post(`/api/workspaces/${wsId}/build`, {
        preset: "general",
        formats: ["html"],
      });
      expect(built.status).toBe(200);
      const buildJson = (await built.json()) as { html?: { fileId: string } };
      expect(buildJson.html?.fileId).toBeDefined();

      const preview = await fetch(`${url}/preview/${wsId}?session=${token}`);
      expect(preview.status).toBe(200);
      expect((await preview.text()).startsWith("<")).toBe(true);

      const dl = await fetch(`${url}/files/${wsId}/${buildJson.html?.fileId}?session=${token}`);
      expect(dl.status).toBe(200);
      expect(dl.headers.get("content-disposition")).toContain("attachment");
      expect(dl.headers.get("content-type")).toContain("text/html");
    } finally {
      proc.kill("SIGINT");
      await new Promise<void>((res) => {
        const t = setTimeout(res, 5_000);
        proc.once("exit", () => {
          clearTimeout(t);
          res();
        });
      });
    }
  });

  it("packed web runtime: brand assets served at /brand/*", async () => {
    const cliBin = join(installDir, "node_modules", "arclume", "dist", "cli", "index.js");
    const proc = spawn(process.execPath, [cliBin, "web", "--port", "0"], {
      cwd: installDir,
      stdio: ["ignore", "pipe", "pipe"],
    });
    try {
      const url = await new Promise<string>((resolvePromise, rejectPromise) => {
        let out = "";
        const timer = setTimeout(() => rejectPromise(new Error("no web URL printed")), 60_000);
        proc.stdout?.on("data", (chunk: Buffer) => {
          out += chunk.toString();
          const m = out.match(/http:\/\/127\.0\.0\.1:\d+/);
          if (m) {
            clearTimeout(timer);
            resolvePromise(m[0]);
          }
        });
        proc.on("exit", () => rejectPromise(new Error(`web exited early: ${out}`)));
      });
      for (const asset of [
        "/brand/favicon.svg",
        "/brand/favicon-16.png",
        "/brand/favicon-32.png",
        "/brand/arclume.ico",
        "/brand/arclume-logo-horizontal.svg",
        "/brand/arclume-symbol.svg",
      ]) {
        const r = await fetch(`${url}${asset}`);
        expect(r.status).toBe(200);
        const ct = r.headers.get("content-type") ?? "";
        expect(ct).not.toBe("");
        const body = await r.arrayBuffer();
        expect(body.byteLength).toBeGreaterThan(0);
      }
    } finally {
      proc.kill("SIGINT");
      await new Promise<void>((res) => {
        const t = setTimeout(res, 5_000);
        proc.once("exit", () => {
          clearTimeout(t);
          res();
        });
      });
    }
  });
});
