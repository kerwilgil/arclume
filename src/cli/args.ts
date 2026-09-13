/**
 * Minimal CLI argument parser — no framework.
 *
 * Supports:
 *  - `cmd pos1 pos2`
 *  - `--flag value`, `--flag=value` (repeatable → string[])
 *  - boolean flags declared by the command (`--json`, `--quiet`, …)
 *  - `--` end of flags
 *
 * Unknown flags are fatal; commands declare exactly what they accept.
 */

export interface ParsedArgs {
  positionals: string[];
  values: Map<string, string[]>;
  booleans: Set<string>;
}

export class CliUsageError extends Error {
  readonly hint: string | undefined;
  constructor(message: string, hint?: string) {
    super(message);
    this.name = "CliUsageError";
    this.hint = hint;
  }
}

export interface CommandFlags {
  /** Flags that take a value (`--format pdf`). */
  valueFlags: readonly string[];
  /** Flags without value (`--json`). */
  booleanFlags: readonly string[];
}

export function parseArgs(argv: readonly string[], spec: CommandFlags): ParsedArgs {
  const valueFlags = new Set(spec.valueFlags);
  const booleanFlags = new Set(spec.booleanFlags);
  const positionals: string[] = [];
  const values = new Map<string, string[]>();
  const booleans = new Set<string>();

  let endOfFlags = false;
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i] as string;
    if (endOfFlags) {
      positionals.push(token);
      continue;
    }
    if (token === "--") {
      endOfFlags = true;
      continue;
    }
    if (!token.startsWith("--") || token === "--") {
      positionals.push(token);
      continue;
    }
    const eq = token.indexOf("=");
    const name = (eq === -1 ? token : token.slice(0, eq)).slice(2);
    let inline: string | undefined = eq === -1 ? undefined : token.slice(eq + 1);

    if (booleanFlags.has(name)) {
      if (inline !== undefined) {
        throw new CliUsageError(`flag --${name} does not take a value`);
      }
      booleans.add(name);
      continue;
    }
    if (valueFlags.has(name)) {
      if (inline === undefined) {
        const next = argv[i + 1];
        if (next === undefined || (next.startsWith("--") && next.length > 2)) {
          throw new CliUsageError(`flag --${name} requires a value`);
        }
        inline = next;
        i += 1;
      }
      const list = values.get(name) ?? [];
      list.push(inline);
      values.set(name, list);
      continue;
    }
    throw new CliUsageError(`unknown flag --${name}`, "Run `arclume --help` for usage.");
  }
  return { positionals, values, booleans };
}

/** Single value helper (last occurrence wins within a command invocation). */
export function singleValue(parsed: ParsedArgs, name: string): string | undefined {
  const list = parsed.values.get(name);
  return list === undefined || list.length === 0 ? undefined : list[list.length - 1];
}

/** Repeated and/or comma-separated values, flattened and trimmed. */
export function multiValue(parsed: ParsedArgs, name: string): string[] {
  const out: string[] = [];
  for (const v of parsed.values.get(name) ?? []) {
    for (const part of v.split(",")) {
      const t = part.trim();
      if (t.length > 0) out.push(t);
    }
  }
  return out;
}
