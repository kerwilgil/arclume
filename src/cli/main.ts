/**
 * Command dispatch. `runCli` returns the exit code and NEVER calls
 * `process.exit` itself — the bin entry does that once.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { UrlTransport } from "../ingestion/url-transport.js";
import { findPackageRoot } from "../schema/paths.js";
import { runAnalyzeCommand } from "./analyze.js";
import { CliUsageError, parseArgs } from "./args.js";
import { runBuildCommand } from "./build.js";
import { HELP_TEXT } from "./help.js";
import { type CliIo, emitError, exitCodeFor } from "./output.js";
import { ARCLUME_PRESETS, CLI_PRESET_VERSION } from "./presets.js";
import { runValidateCommand } from "./validate.js";
import { type WatchDeps, runWatchCommand } from "./watch.js";
import { runWebCommand } from "./web.js";

export interface CliDeps {
  /** Test-only: substitute the Phase 8 wire (never a CLI flag). */
  urlTransport?: UrlTransport;
  /** Test hooks for the watch loop. */
  watch?: WatchDeps;
}

export function packageVersion(): string {
  const raw = readFileSync(join(findPackageRoot(), "package.json"), "utf8");
  const parsed = JSON.parse(raw) as { version?: unknown };
  if (typeof parsed.version !== "string" || parsed.version.length === 0) {
    throw new CliUsageError("arclume package.json has no version");
  }
  return parsed.version;
}

function presetsCommand(argv: readonly string[], io: CliIo): number {
  const parsed = parseArgs(argv, { valueFlags: [], booleanFlags: ["json"] });
  if (parsed.booleans.has("json")) {
    io.stdout(JSON.stringify({ ok: true, command: "presets", presets: ARCLUME_PRESETS }));
    return 0;
  }
  io.stdout(`arclume presets v${CLI_PRESET_VERSION}`);
  for (const p of ARCLUME_PRESETS) {
    io.stdout(`  ${p.id.padEnd(10)} audience=${p.audience} theme=${p.theme} — ${p.description}`);
  }
  return 0;
}

export async function runCli(
  argv: readonly string[],
  io: CliIo = {
    stdout: (s) => process.stdout.write(`${s}\n`),
    stderr: (s) => process.stderr.write(`${s}\n`),
    cwd: () => process.cwd(),
  },
  deps: CliDeps = {},
): Promise<number> {
  const json = argv.includes("--json");
  const verbose = argv.includes("--verbose");
  try {
    const [command, ...rest] = argv;
    if (command === undefined || command === "--help" || command === "-h" || command === "help") {
      io.stdout(HELP_TEXT);
      return 0;
    }
    if (command === "--version" || command === "-v" || command === "version") {
      io.stdout(packageVersion());
      return 0;
    }
    switch (command) {
      case "analyze":
        return await runAnalyzeCommand(
          rest,
          io,
          deps.urlTransport ? { urlTransport: deps.urlTransport } : undefined,
        ).then(() => 0);
      case "build":
        return await runBuildCommand(rest, io);
      case "validate":
        return await runValidateCommand(rest, io);
      case "presets":
        return presetsCommand(rest, io);
      case "watch":
        return await runWatchCommand(rest, io, deps.watch ?? {});
      case "web":
        return await runWebCommand(rest, io);
      default:
        throw new CliUsageError(`unknown command "${command}"`, "Run `arclume --help`.");
    }
  } catch (err) {
    emitError(err, io, json, verbose);
    return exitCodeFor(err);
  }
}
