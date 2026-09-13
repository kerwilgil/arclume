/**
 * Writes a fake CLI executable to disk so the Claude Code / Codex adapter
 * tests can exercise `invokeCli()` end-to-end (real spawn, real argv, real
 * stdout/stderr/exit-code capture) WITHOUT ever touching the real, possibly
 * installed `claude`/`codex` binaries. Never used for anything but tests.
 *
 * Cross-platform, mirroring the two adapters' real invocation shape:
 *  - POSIX: a single executable file with a `#!/usr/bin/env node` shebang.
 *  - Windows: an npm-style `.cmd` + `.js` pair (a `.cmd` batch wrapper
 *    invoking `node <name>.js %*`) — the exact shape that originally
 *    triggered the Windows `EINVAL` bug this test suite guards against.
 *
 * Safety: `writeFakeCli`/`pathWithNoCli` return a PATH value that resolves
 * ONLY the fake executable (plus Node's own directory, so the fake script
 * can run) — never the machine's real PATH. A "CLI not installed" test can
 * therefore never accidentally fall through to a real, system-installed
 * `claude`/`codex`.
 */

import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";

export interface FakeCliSpec {
  /** Text written to stdout before exiting. */
  stdout?: string;
  /** Text written to stderr before exiting. */
  stderr?: string;
  /** Process exit code. Defaults to 0. */
  exitCode?: number;
  /** Delay before exiting, to simulate a hang past a short test timeout. */
  delayMs?: number;
  /**
   * If argv contains `-o <path>` (Codex's "write final message to a file"
   * contract), write this content to that path. Omit to leave the file
   * untouched (simulating "codex exited 0 but wrote no output file").
   */
  outFileContent?: string;
}

export interface FakeCli {
  /** Directory the fake executable was written into. */
  dir: string;
  /** A PATH value resolving only this fake CLI (plus Node itself). */
  path: string;
}

const NODE_DIR = dirname(process.execPath);

function scriptBody(spec: FakeCliSpec): string {
  const lines: string[] = [
    "process.stdin.resume();",
    'process.stdin.on("data", () => {});',
    "function done() {",
  ];
  if (spec.outFileContent !== undefined) {
    lines.push(
      '  const fs = require("node:fs");',
      "  const argv = process.argv.slice(2);",
      '  const oIndex = argv.indexOf("-o");',
      "  if (oIndex !== -1 && argv[oIndex + 1]) {",
      `    fs.writeFileSync(argv[oIndex + 1], ${JSON.stringify(spec.outFileContent)});`,
      "  }",
    );
  }
  if (spec.stderr !== undefined) {
    lines.push(`  process.stderr.write(${JSON.stringify(spec.stderr)});`);
  }
  if (spec.stdout !== undefined) {
    lines.push(`  process.stdout.write(${JSON.stringify(spec.stdout)});`);
  }
  lines.push(`  process.exit(${spec.exitCode ?? 0});`, "}");
  const delayMs = spec.delayMs ?? 0;
  lines.push(delayMs > 0 ? `setTimeout(done, ${delayMs});` : "done();");
  return lines.join("\n");
}

/** Writes a fake `name` executable and returns a PATH pointing only at it. */
export function writeFakeCli(name: string, spec: FakeCliSpec): FakeCli {
  const dir = mkdtempSync(join(tmpdir(), `arclume-fake-cli-${name}-`));
  const body = scriptBody(spec);
  if (process.platform === "win32") {
    writeFileSync(join(dir, `${name}.js`), body, "utf8");
    writeFileSync(join(dir, `${name}.cmd`), `@echo off\r\nnode "%~dp0${name}.js" %*\r\n`, "utf8");
  } else {
    const scriptPath = join(dir, name);
    writeFileSync(scriptPath, `#!/usr/bin/env node\n${body}\n`, "utf8");
    chmodSync(scriptPath, 0o755);
  }
  return { dir, path: `${dir}${delimiter}${NODE_DIR}` };
}

/** A PATH with no fake CLI and no real system directories — every
 * `invokeCli` candidate resolves to nothing, simulating "not installed"
 * without any chance of falling through to a real, machine-installed CLI. */
export function pathWithNoCli(): string {
  return NODE_DIR;
}
