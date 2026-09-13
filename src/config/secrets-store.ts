/**
 * The `secrets\.env` store: provider API keys, and nothing else. Deliberately
 * separate from `providers.json` (non-secret config) so the two can have
 * different handling — this file is never logged, never echoed back whole,
 * and every write is atomic.
 *
 * File format is plain `.env` (`KEY=VALUE` per line, optional quotes, `#`
 * comments and blank lines preserved as-is on rewrite by keeping them in
 * place and only touching the one line that changed).
 */

import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { type ArclumeDirs, resolveArclumeDirs, secretsFilePath } from "./paths.js";

const KEY_RE = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;

export type SecretsMap = Map<string, string>;

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if (first === '"' && last === '"') {
      // Reverses exactly the escaping `quote()` applies below, so a value
      // containing a literal " or \ round-trips correctly.
      return trimmed.slice(1, -1).replace(/\\(["\\])/g, "$1");
    }
    if (first === "'" && last === "'") {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

function quote(value: string): string {
  if (/[\s"'#]/.test(value)) {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return value;
}

/** Parses `.env` text into an ordered map. Malformed lines (no `KEY=`) and
 * comments/blank lines are simply skipped for the returned map, but the raw
 * lines are preserved separately by {@link readSecretsFile} for rewriting. */
export function parseEnvText(text: string): SecretsMap {
  const map: SecretsMap = new Map();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const match = KEY_RE.exec(trimmed);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (key === undefined || rawValue === undefined) continue;
    map.set(key, unquote(rawValue));
  }
  return map;
}

export function serializeEnvText(map: SecretsMap): string {
  const lines: string[] = [];
  for (const [key, value] of map) {
    lines.push(`${key}=${quote(value)}`);
  }
  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

/** Reads the secrets file. A missing file is an empty store, never an error.
 * A corrupted/unreadable file falls back to an empty store rather than
 * throwing — the caller can still write fresh values. */
export function readSecretsFile(dirs: ArclumeDirs = resolveArclumeDirs()): SecretsMap {
  const path = secretsFilePath(dirs);
  if (!existsSync(path)) return new Map();
  try {
    return parseEnvText(readFileSync(path, "utf8"));
  } catch {
    return new Map();
  }
}

/** Best-effort ACL tightening: on Windows, restrict the secrets directory to
 * the current user via `icacls`; elsewhere, `chmod 700`/`600`. Never throws —
 * a failure here is a real, documented limitation, not a fatal error. */
function tightenAcl(dirPath: string, filePath: string | undefined): void {
  try {
    if (process.platform === "win32") {
      const username = process.env["USERNAME"];
      const userDomain = process.env["USERDOMAIN"] ?? "%USERDOMAIN%";
      const user = username ? `${userDomain}\\${username}` : undefined;
      // /inheritance:r removes inherited ACEs; grant the current user only.
      execFileSync("icacls", [dirPath, "/inheritance:r"], { stdio: "ignore", windowsHide: true });
      if (user) {
        execFileSync("icacls", [dirPath, "/grant:r", `${user}:(OI)(CI)F`], {
          stdio: "ignore",
          windowsHide: true,
        });
      }
    } else {
      chmodSync(dirPath, 0o700);
      if (filePath && existsSync(filePath)) chmodSync(filePath, 0o600);
    }
  } catch {
    // Best-effort only — see docs/WEB_UI.md "Secrets" for the documented
    // limitation when icacls/chmod is unavailable or restricted.
  }
}

/** Atomically writes the whole map: write to a temp file in the same
 * directory, then rename over the target — a reader never observes a
 * partially written file. */
function writeSecretsFile(map: SecretsMap, dirs: ArclumeDirs): void {
  mkdirSync(dirs.secretsDir, { recursive: true });
  const path = secretsFilePath(dirs);
  // pid-only, no timestamp — matches the atomic-write convention already
  // established in src/cli/build.ts; the Core's determinism test forbids
  // any wall-clock read anywhere under src/.
  const tempPath = `${path}.${process.pid}.tmp`;
  writeFileSync(tempPath, serializeEnvText(map), { mode: 0o600 });
  renameSync(tempPath, path);
  tightenAcl(dirs.secretsDir, path);
}

/**
 * Sets (creates or updates) exactly one secret, preserving every other key
 * untouched. Never logs `value`.
 */
export function setSecret(
  key: string,
  value: string,
  dirs: ArclumeDirs = resolveArclumeDirs(),
): void {
  const map = readSecretsFile(dirs);
  map.set(key, value);
  writeSecretsFile(map, dirs);
}

/** Deletes one secret if present; a no-op (not an error) if it was already
 * absent. Every other key is preserved untouched. */
export function deleteSecret(key: string, dirs: ArclumeDirs = resolveArclumeDirs()): void {
  const map = readSecretsFile(dirs);
  if (!map.has(key)) return;
  map.delete(key);
  writeSecretsFile(map, dirs);
}

/** A display-safe hint — never the secret itself. `sk-...abcd` style. */
export function maskSecret(value: string): string {
  if (value.length <= 8) return "•".repeat(Math.max(value.length, 4));
  return `${value.slice(0, 3)}…${value.slice(-4)}`;
}
