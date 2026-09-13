/**
 * Shared subprocess plumbing for CLI-backed reasoners (Claude Code, Codex):
 * portable executable resolution, an allowlisted environment (the same
 * discipline `src/engines/visual/runner.ts` uses for the vendored visual engine
 * CLI), a hard timeout with SIGTERM-then-SIGKILL escalation, and capped
 * stdout/stderr capture. Spawning goes through `cross-spawn` rather than
 * `node:child_process` directly: Node's own `spawn(..., {shell:false})`
 * throws a synchronous EINVAL for Windows npm `.cmd`/`.bat` shims (exactly
 * how Claude Code and Codex are commonly installed on Windows via npm),
 * which `cross-spawn` resolves correctly while still passing argv directly
 * with no shell string interpolation — so there is still no quoting/
 * injection surface.
 *
 * These CLIs use the caller's own already-authenticated session; ARCLUME
 * never reads, copies, or persists their credentials. It only starts the
 * process, feeds it a prompt, reads its stdout, and validates the result.
 */

import { execFile } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { join as joinPath } from "node:path";
import spawn from "cross-spawn";

/** Environment keys a CLI child process may see. No provider API keys are
 * ever added here — CLI providers authenticate themselves. */
const ENV_ALLOWLIST = [
  "PATH",
  "PATHEXT",
  "SystemRoot",
  "WINDIR",
  "TEMP",
  "TMP",
  "TMPDIR",
  "HOME",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "APPDATA",
  "LOCALAPPDATA",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
] as const;

function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ENV_ALLOWLIST) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

/**
 * Terminates `pid` and, on Windows, its ENTIRE descendant process tree.
 *
 * A Windows npm `.cmd`/`.bat` shim can only run under `cmd.exe` (an OS
 * requirement — cross-spawn routes through it for exactly this reason), so
 * the process Node actually spawned is that intermediate `cmd.exe`, not the
 * real CLI. Calling `ChildProcess#kill()` only signals that top-level
 * `cmd.exe` — it does not reach the grandchild `node.exe` (or whatever the
 * shim ultimately execs) that is doing the real work, which is left running
 * as an orphan even after this module reports the call as timed out.
 * `taskkill /t /f` kills the whole tree in one shot and is the standard,
 * documented way to do this on Windows (there is no POSIX-style process
 * group here). On POSIX, `ChildProcess#kill()` already reaches the real
 * process directly, so this just forwards to it.
 */
function taskkillPath(): string {
  // Resolved by absolute path, never via PATH lookup: a caller (or, as
  // observed while testing this, a test harness) may legitimately narrow
  // `process.env.PATH` for its own purposes (e.g. to make a fake CLI the
  // only resolvable executable) without meaning to break this internal,
  // unrelated use of a bundled Windows system tool.
  const systemRoot = process.env["SystemRoot"] || process.env["WINDIR"] || "C:Windows";
  return joinPath(systemRoot, "System32", "taskkill.exe");
}

function killProcessTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (process.platform === "win32") {
    if (child.pid === undefined) return;
    execFile(taskkillPath(), ["/pid", String(child.pid), "/t", "/f"], () => {
      // Ignore failures: the process may have already exited on its own,
      // which is the common case and not an error worth surfacing.
    });
    return;
  }
  child.kill(signal);
}

/** `["claude"]` on POSIX, `["claude", "claude.cmd", "claude.exe", "claude.bat"]`
 * on Windows — covers the common npm-shim install shape without a shell. */
function platformCandidates(name: string): string[] {
  if (process.platform !== "win32") return [name];
  return [name, `${name}.cmd`, `${name}.exe`, `${name}.bat`];
}

export interface CliInvokeResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  /** The exact executable that actually ran, e.g. `claude.cmd`. */
  resolvedExecutable: string;
}

export class CliNotFoundError extends Error {
  constructor(readonly candidates: readonly string[]) {
    super(`none of [${candidates.join(", ")}] could be started (not installed / not on PATH)`);
    this.name = "CliNotFoundError";
  }
}

const MAX_CAPTURE_BYTES = 4 * 1024 * 1024; // 4 MiB per stream

/**
 * Runs one of `candidates` (tried in order — the first that isn't ENOENT is
 * used) with `args`, optionally feeding `stdin`, under `timeoutMs`. Never
 * leaves an orphaned child: on timeout it sends SIGTERM, then SIGKILL after a
 * grace period, and always awaits the actual exit before resolving.
 */
export async function invokeCli(options: {
  candidates: readonly string[];
  args: readonly string[];
  stdin?: string;
  timeoutMs: number;
  cwd?: string;
}): Promise<CliInvokeResult> {
  // Every candidate that fails with ENOENT is skipped silently: the final
  // CliNotFoundError already lists all of them by name, so there is nothing
  // more useful to carry forward from an individual ENOENT.
  for (const candidate of options.candidates.flatMap((c) => platformCandidates(c))) {
    try {
      return await runOne(candidate, options.args, options.stdin, options.timeoutMs, options.cwd);
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === "ENOENT") continue;
      throw err;
    }
  }
  throw new CliNotFoundError(options.candidates);
}

function runOne(
  executable: string,
  args: readonly string[],
  stdin: string | undefined,
  timeoutMs: number,
  cwd: string | undefined,
): Promise<CliInvokeResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    let child: ChildProcess;
    try {
      child = spawn(executable, args, {
        cwd,
        env: childEnv(),
        stdio: "pipe",
        windowsHide: true,
        shell: false,
      });
    } catch (err) {
      rejectPromise(err);
      return;
    }

    let spawnFailed = false;
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      // On Windows this is already an unconditional, immediate tree-kill
      // (taskkill /f) — no POSIX-style SIGTERM grace period applies there.
      killProcessTree(child, "SIGTERM");
      // POSIX escalation: give a real SIGTERM a grace period, then SIGKILL
      // if the process ignored it. (No-op on Windows: already force-killed.)
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          killProcessTree(child, "SIGKILL");
        }
      }, 3000).unref();
    }, timeoutMs);
    timer.unref?.();

    child.once("error", (err) => {
      spawnFailed = true;
      clearTimeout(timer);
      rejectPromise(err);
    });

    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdout.length < MAX_CAPTURE_BYTES) stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < MAX_CAPTURE_BYTES) stderr += chunk.toString("utf8");
    });

    child.once("close", (code, signal) => {
      if (spawnFailed) return;
      clearTimeout(timer);
      resolvePromise({
        exitCode: code,
        signal,
        stdout,
        stderr,
        timedOut,
        resolvedExecutable: executable,
      });
    });

    if (stdin !== undefined) {
      child.stdin?.write(stdin, "utf8");
    }
    child.stdin?.end();
  });
}
