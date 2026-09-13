/**
 * CLI output contract: stdout carries the productive result (human paths, or
 * pure JSON with `--json`); stderr carries warnings/diagnostics. Exit codes:
 *
 *   0  success
 *  1  usage / input error (bad flags, missing input, stale destination)
 *  2  build / validation failure of the pipeline
 *  3  security refusal (SSRF, unsafe packages, unsafe paths)
 *
 * No stack traces by default; `--verbose` includes them.
 */

import { ArclumeError } from "../errors.js";
import { CliUsageError } from "./args.js";

export interface CliIo {
  stdout(line: string): void;
  stderr(line: string): void;
  cwd(): string;
}

export const EXIT_OK = 0;
export const EXIT_USAGE = 1;
export const EXIT_BUILD = 2;
export const EXIT_SECURITY = 3;

const SECURITY_PREFIXES = [
  "ingestion/url-",
  "ingestion/docx-unsafe",
  "ingestion/pdf-encrypted",
  "delivery/unsafe",
  "export/unsafe-path",
];

/** Map an error to its declared exit code. */
export function exitCodeFor(err: unknown): number {
  if (err instanceof CliUsageError) return EXIT_USAGE;
  if (err instanceof ArclumeError) {
    const code = err.code;
    if (SECURITY_PREFIXES.some((p) => code.startsWith(p))) return EXIT_SECURITY;
    if (code.startsWith("discovery/")) return EXIT_USAGE;
    if (code === "export/destination-exists") return EXIT_USAGE;
    if (code === "export/unsafe-filename") return EXIT_USAGE;
    return EXIT_BUILD;
  }
  return EXIT_BUILD;
}

export interface JsonSuccess {
  ok: true;
  command: string;
  [key: string]: unknown;
}

export function emitError(err: unknown, io: CliIo, json: boolean, verbose: boolean): void {
  const e = err as Error & { code?: string; hint?: string };
  if (json) {
    const payload: Record<string, unknown> = {
      ok: false,
      code: e.code ?? "cli/internal",
      message: e.message ?? String(err),
    };
    if (typeof e.hint === "string") payload["hint"] = e.hint;
    if (verbose && e.stack !== undefined) payload["stack"] = e.stack;
    io.stdout(JSON.stringify(payload));
    return;
  }
  const code = e.code !== undefined ? `\n[${e.code}]` : "";
  io.stderr(`ARCLUME: ${e.message ?? String(err)}${code}`);
  if (typeof e.hint === "string") io.stderr(e.hint);
  if (verbose && e.stack !== undefined) io.stderr(e.stack);
}

/** Diagnostics/warnings always go to stderr and never pollute JSON stdout. */
export function warnAll(io: CliIo, warnings: readonly string[]): void {
  for (const w of warnings) io.stderr(`warning: ${w}`);
}
