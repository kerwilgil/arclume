/**
 * Phase 9 final closure — PACKED PDF smoke: npm pack → clean consumer install
 * → installed binary builds a PDF bundle with the REAL Playwright/packaged
 * Chromium → validate the bundle. Proves the packed product, not repo dist.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let workDir = "";
let installDir = "";

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
  workDir = mkdtempSync(join(tmpdir(), "arclume-packpdf-"));
  // the tarball only carries dist/ — build first (CI jobs never build before pack)
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
  const tgz = packed[0];
  if (tgz === undefined) throw new Error("npm pack produced no tarball");

  installDir = join(workDir, "consumer");
  mkdirSync(installDir, { recursive: true });
  writeFileSync(
    join(installDir, "package.json"),
    JSON.stringify({ name: "arclume-pdf-consumer", version: "0.0.0", private: true }),
  );
  const install = run(
    "npm",
    ["install", join(workDir, tgz.filename), "--no-audit", "--no-fund", "--loglevel=error"],
    installDir,
  );
  if (install.code !== 0) throw new Error(`install failed: ${install.stderr}`);
}, 600_000);

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("packed PDF export smoke (installed package, real Chromium)", () => {
  it("installed arclume builds and validates a PDF bundle", async () => {
    const cli = join(installDir, "node_modules", "arclume", "dist", "cli", "index.js");
    const proj = join(installDir, "proj");
    mkdirSync(proj, { recursive: true });
    writeFileSync(
      join(proj, "README.md"),
      "# Pack Demo\n\nDemo for the packed PDF smoke.\n\n## Status\n\n- Ready\n",
    );
    const a = run(
      process.execPath,
      [cli, "analyze", proj, "--reasoner", "stub", "--out", "kn.json"],
      installDir,
    );
    if (a.code !== 0) {
      throw new Error(`packed analyze failed (${a.code}): ${a.stderr}\n${a.stdout}`);
    }
    expect(a.code).toBe(0);
    expect(a.stderr).not.toContain(process.cwd()); // no repo cwd coupling

    const b = run(
      process.execPath,
      [cli, "build", "kn.json", "--format", "pdf", "--preset", "general"],
      installDir,
    );
    if (b.code !== 0) throw new Error(`packed pdf build failed: ${b.stderr}`);
    expect(b.code).toBe(0);

    const bundle = join(installDir, "arclume-output", "deck.pdf-export");
    expect(existsSync(join(bundle, "deck.pdf"))).toBe(true);
    expect(existsSync(join(bundle, "export-receipt.json"))).toBe(true);

    const v = run(process.execPath, [cli, "validate", bundle], installDir);
    expect(v.code).toBe(0);
    expect(v.stdout).toContain("VALID");
  }, 300_000);
});
