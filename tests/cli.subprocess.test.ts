/**
 * Phase 9 CLI — subprocess tests: they spawn the COMPILEd binary
 * (`dist/cli/index.js` via `node`), proving bin resolution, argument parsing
 * exit codes and stdout/stderr over the real process boundary.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const CLI = join(process.cwd(), "dist", "cli", "index.js");

beforeAll(() => {
  if (!existsSync(CLI)) {
    execFileSync("npm", ["run", "build"], { cwd: process.cwd(), stdio: "inherit" });
  }
}, 240_000);

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "arclume-cli-proc-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

interface ProcResult {
  code: number;
  stdout: string;
  stderr: string;
}

function cli(args: string[], cwd: string): ProcResult {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
  return { code: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

describe("cli subprocess (compiled dist binary)", () => {
  it("--version prints the package version and exits 0 from a foreign cwd", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      version: string;
    };
    const r = cli(["--version"], dir);
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe(pkg.version);
  });

  it("--help exits 0 and documents every command", () => {
    const r = cli(["--help"], dir);
    expect(r.code).toBe(0);
    for (const cmd of ["analyze", "build", "validate", "presets", "watch"]) {
      expect(r.stdout).toContain(cmd);
    }
  });

  it("an unknown command exits 1 with no stack trace", () => {
    const r = cli(["no-such-command"], dir);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('unknown command "no-such-command"');
    expect(r.stderr).not.toContain("at ");
  });

  it("analyze + build + validate over the example fixture repo", () => {
    const fixtureRepo = join(process.cwd(), "examples", "fixtures", "sample-repo");
    expect(existsSync(fixtureRepo)).toBe(true);

    const a = cli(["analyze", fixtureRepo, "--reasoner", "stub", "--out", "knowledge.json"], dir);
    expect(a.code).toBe(0);
    expect(existsSync(join(dir, "knowledge.json"))).toBe(true);

    const b = cli(["build", "knowledge.json", "--format", "pptx"], dir);
    expect(b.code).toBe(0);
    expect(b.stdout).toContain("PPTX bundle:");
    const bundle = join(dir, "arclume-output", "deck.pptx-export");
    expect(statSync(join(bundle, "deck.pptx")).size).toBeGreaterThan(1000);
    expect(existsSync(join(bundle, "export-receipt.json"))).toBe(true);

    const v = cli(["validate", bundle], dir);
    expect(v.code).toBe(0);
    expect(v.stdout).toContain("VALID");
  });

  it("machine-readable error JSON with --json and exit 1", () => {
    const r = cli(["analyze", "does/not/exist", "--reasoner", "stub", "--json"], dir);
    expect(r.code).toBe(1);
    const payload = JSON.parse(r.stdout) as { ok: boolean; code: string };
    expect(payload.ok).toBe(false);
    expect(typeof payload.code).toBe("string");
  });

  it("validate --json on an INVALID bundle emits exactly ONE JSON document, exit 2", () => {
    const fixtureRepo = join(process.cwd(), "examples", "fixtures", "sample-repo");
    const a = cli(["analyze", fixtureRepo, "--reasoner", "stub", "--out", "knowledge.json"], dir);
    expect(a.code).toBe(0);
    const b = cli(["build", "knowledge.json", "--format", "pptx"], dir);
    expect(b.code).toBe(0);
    const bundle = join(dir, "arclume-output", "deck.pptx-export");
    writeFileSync(join(bundle, "deck.pptx"), Buffer.from([1, 2, 3])); // tamper
    const r = cli(["validate", bundle, "--json"], dir);
    expect(r.code).toBe(2);
    // EXACTLY one JSON document — direct parse of full stdout must succeed
    const payload = JSON.parse(r.stdout) as {
      ok: boolean;
      command: string;
      code: string;
      valid: boolean;
    };
    expect(payload).toMatchObject({
      ok: false,
      command: "validate",
      code: "cli/validate-failed",
      valid: false,
    });
  });
});
