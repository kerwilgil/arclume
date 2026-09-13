import { join, win32 } from "node:path";
import { describe, expect, it } from "vitest";
import {
  providersConfigPath,
  resolveArclumeDirs,
  secretsFilePath,
} from "../../src/config/paths.js";

const w = (p: string) => win32.join(...p.split("\\"));

describe("resolveArclumeDirs", () => {
  it("uses %LOCALAPPDATA%\\ARCLUME\\{config,secrets,logs} on Windows", () => {
    const dirs = resolveArclumeDirs("win32", { LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local" });
    expect(dirs.configDir).toBe(w("C:\\Users\\test\\AppData\\Local\\ARCLUME\\config"));
    expect(dirs.secretsDir).toBe(w("C:\\Users\\test\\AppData\\Local\\ARCLUME\\secrets"));
    expect(dirs.logsDir).toBe(w("C:\\Users\\test\\AppData\\Local\\ARCLUME\\logs"));
  });

  it("falls back to a HOME-relative AppData\\Local when %LOCALAPPDATA% is unset", () => {
    const dirs = resolveArclumeDirs("win32", {});
    expect(dirs.configDir).toContain("AppData");
    expect(dirs.configDir).toContain("ARCLUME");
  });

  it("falls back when %LOCALAPPDATA% is an empty string", () => {
    const dirs = resolveArclumeDirs("win32", { LOCALAPPDATA: "" });
    expect(dirs.configDir).toContain("ARCLUME");
  });

  it("uses XDG base directories on Linux", () => {
    const dirs = resolveArclumeDirs("linux", {
      XDG_CONFIG_HOME: "/home/u/.config",
      XDG_DATA_HOME: "/home/u/.local/share",
      XDG_STATE_HOME: "/home/u/.local/state",
    });
    expect(dirs.configDir).toBe(join("/home/u/.config", "arclume"));
    expect(dirs.secretsDir).toBe(join("/home/u/.local/share", "arclume", "secrets"));
    expect(dirs.logsDir).toBe(join("/home/u/.local/state", "arclume", "logs"));
  });

  it("falls back to ~/.config, ~/.local/share, ~/.local/state on Linux when XDG vars are unset", () => {
    const dirs = resolveArclumeDirs("linux", {});
    expect(dirs.configDir).toContain(".config");
    expect(dirs.secretsDir).toContain(".local");
    expect(dirs.secretsDir).toContain("share");
    expect(dirs.logsDir).toContain("state");
  });

  it("uses the same XDG scheme on darwin", () => {
    const dirs = resolveArclumeDirs("darwin", { XDG_CONFIG_HOME: "/Users/u/.config" });
    expect(dirs.configDir).toBe(join("/Users/u/.config", "arclume"));
  });
});

describe("providersConfigPath / secretsFilePath", () => {
  it("point at providers.json inside configDir and .env inside secretsDir", () => {
    const dirs = resolveArclumeDirs("win32", { LOCALAPPDATA: "C:\\LA" });
    expect(providersConfigPath(dirs)).toBe(w("C:\\LA\\ARCLUME\\config\\providers.json"));
    expect(secretsFilePath(dirs)).toBe(w("C:\\LA\\ARCLUME\\secrets\\.env"));
  });
});
