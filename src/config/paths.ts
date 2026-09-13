/**
 * Where ARCLUME's per-user, non-project configuration lives — provider
 * settings, secrets, and logs. Separate from the ARCLUME package/install
 * directory (never written to) and from any workspace's temp directory
 * (never a place for long-lived state).
 *
 * Windows (the primary distribution target):
 *   %LOCALAPPDATA%\ARCLUME\{config,secrets,logs}
 * Anything else (Linux/macOS — the Core's own CI runs there too):
 *   $XDG_CONFIG_HOME/arclume (or ~/.config/arclume) for config,
 *   $XDG_DATA_HOME/arclume/secrets (or ~/.local/share/arclume/secrets),
 *   $XDG_STATE_HOME/arclume/logs (or ~/.local/state/arclume/logs).
 */

import { homedir } from "node:os";
import { join, win32 } from "node:path";

function windowsBaseDir(env: NodeJS.ProcessEnv): string {
  const localAppData = env["LOCALAPPDATA"];
  if (localAppData && localAppData.length > 0) return win32.join(localAppData, "ARCLUME");
  return win32.join(homedir(), "AppData", "Local", "ARCLUME");
}

export interface ArclumeDirs {
  configDir: string;
  secretsDir: string;
  logsDir: string;
}

/** Pure — takes `platform`/`env` explicitly so tests never depend on the
 * real OS or a real `%LOCALAPPDATA%`. */
export function resolveArclumeDirs(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): ArclumeDirs {
  if (platform === "win32") {
    const base = windowsBaseDir(env);
    return {
      configDir: win32.join(base, "config"),
      secretsDir: win32.join(base, "secrets"),
      logsDir: win32.join(base, "logs"),
    };
  }

  const xdgConfigHome = env["XDG_CONFIG_HOME"];
  const xdgDataHome = env["XDG_DATA_HOME"];
  const xdgStateHome = env["XDG_STATE_HOME"];
  const configBase =
    xdgConfigHome && xdgConfigHome.length > 0 ? xdgConfigHome : join(homedir(), ".config");
  const dataBase =
    xdgDataHome && xdgDataHome.length > 0 ? xdgDataHome : join(homedir(), ".local", "share");
  const stateBase =
    xdgStateHome && xdgStateHome.length > 0 ? xdgStateHome : join(homedir(), ".local", "state");

  return {
    configDir: join(configBase, "arclume"),
    secretsDir: join(dataBase, "arclume", "secrets"),
    logsDir: join(stateBase, "arclume", "logs"),
  };
}

function isWindowsPath(p: string): boolean {
  return p.includes("\\");
}

function platformJoin(p: string, ...segments: string[]): string {
  return isWindowsPath(p) ? win32.join(p, ...segments) : join(p, ...segments);
}

export function providersConfigPath(dirs: ArclumeDirs = resolveArclumeDirs()): string {
  return platformJoin(dirs.configDir, "providers.json");
}

export function secretsFilePath(dirs: ArclumeDirs = resolveArclumeDirs()): string {
  return platformJoin(dirs.secretsDir, ".env");
}
