/**
 * Visual Engine subprocess runner.
 *
 * Invokes the vendored CLI (`node vendor/archify/bin/archify.mjs render …`)
 * with a direct argv array (no shell interpolation), inside an isolated,
 * deterministically-named temp directory, under a timeout, with a scrubbed
 * environment. The output HTML is read back and the scratch directory is
 * removed on every path.
 *
 * Nothing about the scratch location (temp path, PID, timestamp, username)
 * leaks into the returned value or into error messages — it is never part of a
 * canonical artifact identity.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { VisualEngineError } from "./errors.js";
import { visualEngineCliPath } from "./vendored.js";

export interface VisualEngineRunOptions {
  /** Per-render timeout in milliseconds. Default 20000. */
  timeoutMs?: number;
  /** Override the CLI path (tests use this to simulate a missing binary). */
  cliPath?: string;
  /** Scratch-directory prefix under the OS temp dir. Default `arclume-visual-`. */
  scratchPrefix?: string;
}

export interface VisualEngineRunResult {
  /** The raw, still-untrusted HTML document the visual engine wrote. */
  html: string;
}

/** Environment keys the child process is allowed to inherit. */
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
] as const;

/**
 * Network guard preload (offline engine proof).
 *
 * The vendored render path is offline by construction (see
 * `tests/engines/visual/vendor.test.ts` and `docs/DIAGRAM_ENGINES.md`): the
 * only network-capable code (`brand-marks.mjs` remote capture) gates on
 * `node.brand`, which the adapter never emits. This preload is a cheap
 * runtime tripwire on top of that: any socket use inside the child crashes it
 * immediately (→ `visual-engine/render-failed`, loud), without depending on any OS
 * sandbox facility.
 */
const NETGUARD_SOURCE = [
  "import http from 'node:http';",
  "import https from 'node:https';",
  "import net from 'node:net';",
  "import { Socket } from 'node:net';",
  "import dns from 'node:dns';",
  "import dnsPromises from 'node:dns/promises';",
  "const blocked = (what) => (...args) => {",
  "  throw new Error(`arclume visual engine runner: network access blocked (${what})`);",
  "};",
  "http.request = blocked('http.request');",
  "http.get = blocked('http.get');",
  "https.request = blocked('https.request');",
  "https.get = blocked('https.get');",
  "net.connect = blocked('net.connect');",
  "net.createConnection = blocked('net.createConnection');",
  "net.Socket = class extends Socket {",
  "  connect() { throw new Error('arclume visual engine runner: network access blocked (net.Socket)'); }",
  "};",
  "dns.lookup = blocked('dns.lookup');",
  "dnsPromises.lookup = blocked('dns.promises.lookup');",
  "globalThis.fetch = blocked('fetch');",
  "globalThis.WebSocket = class { constructor() { throw new Error('arclume visual engine runner: network access blocked (WebSocket)'); } };",
  "globalThis.EventSource = class { constructor() { throw new Error('arclume visual engine runner: network access blocked (EventSource)'); } };",
  "globalThis.XMLHttpRequest = class { constructor() { throw new Error('arclume visual engine runner: network access blocked (XMLHttpRequest)'); } };",
].join("\n");

function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ENV_ALLOWLIST) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

/**
 * Run the visual engine once. Throws `VisualEngineError`:
 *  - `visual-engine/engine-unavailable` — CLI missing or the process cannot start;
 *  - `visual-engine/render-failed` — non-zero exit, timeout, or no output produced.
 */
export async function runVisualEngine(
  kind: "architecture" | "workflow" | "dataflow" | "lifecycle" | "sequence",
  requestJson: string,
  diagramId: string,
  options: VisualEngineRunOptions = {},
): Promise<VisualEngineRunResult> {
  const cli = options.cliPath ?? visualEngineCliPath();
  if (!existsSync(cli)) {
    throw new VisualEngineError(
      "visual-engine/engine-unavailable",
      "the vendored visual engine CLI is not present on disk",
      diagramId,
    );
  }

  const timeoutMs = options.timeoutMs ?? 20_000;
  const scratch = mkdtempSync(join(tmpdir(), options.scratchPrefix ?? "arclume-visual-"));
  const inputPath = join(scratch, "input.json");
  const outputPath = join(scratch, "output.html");

  try {
    writeFileSync(inputPath, requestJson, "utf8");
    // Network tripwire: any socket use by the vendored engine crashes the
    // child immediately (→ visual-engine/render-failed). Defence in depth over the
    // documented audit boundary — see P1 discussion in docs/DIAGRAM_ENGINES.md.
    const netguardPath = join(scratch, "netguard.mjs");
    writeFileSync(netguardPath, NETGUARD_SOURCE, "utf8");

    const status = await new Promise<{
      code: number | null;
      timedOut: boolean;
      spawnError?: string;
    }>((resolve) => {
      let settled = false;
      let timedOut = false;
      let child: import("node:child_process").ChildProcess;
      try {
        child = spawn(
          process.execPath,
          [
            "--import",
            pathToFileURL(netguardPath).href,
            cli,
            "render",
            kind,
            inputPath,
            outputPath,
          ],
          {
            cwd: scratch,
            env: childEnv(),
            stdio: ["ignore", "ignore", "pipe"],
            windowsHide: true,
          },
        );
      } catch (err) {
        resolve({ code: null, timedOut: false, spawnError: (err as Error).message });
        return;
      }
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, timeoutMs);
      child.on("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ code: null, timedOut, spawnError: err.message });
      });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ code, timedOut });
      });
      // stderr is drained so the child cannot stall on a full pipe.
      child.stderr?.resume();
    });

    if (status.spawnError !== undefined) {
      throw new VisualEngineError(
        "visual-engine/engine-unavailable",
        "the visual engine subprocess could not be started",
        diagramId,
      );
    }
    if (status.timedOut) {
      throw new VisualEngineError(
        "visual-engine/render-failed",
        "the visual engine subprocess exceeded its time budget",
        diagramId,
      );
    }
    if (status.code !== 0) {
      throw new VisualEngineError(
        "visual-engine/render-failed",
        `the visual engine subprocess exited with code ${String(status.code)}`,
        diagramId,
      );
    }
    if (!existsSync(outputPath)) {
      throw new VisualEngineError(
        "visual-engine/render-failed",
        "the visual engine subprocess produced no output file",
        diagramId,
      );
    }
    const html = readFileSync(outputPath, "utf8");
    if (!html.includes("<svg")) {
      throw new VisualEngineError(
        "visual-engine/render-failed",
        "the visual engine subprocess produced output without an SVG region",
        diagramId,
      );
    }
    return { html };
  } finally {
    try {
      rmSync(scratch, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup only; never mask the real outcome and never leak
      // the scratch path into errors.
    }
  }
}
