import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ArclumeDirs } from "../../src/config/paths.js";
import {
  defaultProvidersConfig,
  loadProvidersConfig,
  normalizeProvidersConfig,
  saveProvidersConfig,
} from "../../src/config/providers-config.js";

let base: string;
let dirs: ArclumeDirs;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "arclume-providers-config-"));
  dirs = {
    configDir: join(base, "config"),
    secretsDir: join(base, "secrets"),
    logsDir: join(base, "logs"),
  };
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe("defaultProvidersConfig", () => {
  it("defaults to the stub provider, fast quality, no reviewer, no providers", () => {
    const config = defaultProvidersConfig();
    expect(config).toEqual({
      version: 1,
      activeProvider: "stub",
      analysisQuality: "fast",
      providers: {},
    });
  });
});

describe("loadProvidersConfig", () => {
  it("returns the default config when no file exists", () => {
    expect(loadProvidersConfig(dirs)).toEqual(defaultProvidersConfig());
  });

  it("round-trips a saved config exactly", () => {
    const config = {
      version: 1 as const,
      activeProvider: "openai" as const,
      analysisQuality: "verified" as const,
      reviewer: { provider: "anthropic" as const, model: "claude-sonnet-5" },
      providers: { openai: { model: "gpt-4.1" } },
    };
    saveProvidersConfig(config, dirs);
    expect(loadProvidersConfig(dirs)).toEqual(config);
  });

  it("falls back to defaults for a corrupted (non-JSON) file rather than throwing", () => {
    mkdirSync(dirs.configDir, { recursive: true });
    writeFileSync(join(dirs.configDir, "providers.json"), "{ not json", "utf8");
    expect(loadProvidersConfig(dirs)).toEqual(defaultProvidersConfig());
  });
});

describe("normalizeProvidersConfig", () => {
  it("returns defaults for a non-object input", () => {
    expect(normalizeProvidersConfig(null)).toEqual(defaultProvidersConfig());
    expect(normalizeProvidersConfig("nope")).toEqual(defaultProvidersConfig());
    expect(normalizeProvidersConfig(42)).toEqual(defaultProvidersConfig());
  });

  it("falls back to defaults for an unknown activeProvider and analysisQuality", () => {
    const result = normalizeProvidersConfig({
      activeProvider: "not-a-provider",
      analysisQuality: "ultra",
    });
    expect(result.activeProvider).toBe("stub");
    expect(result.analysisQuality).toBe("fast");
  });

  it("drops a reviewer with an unknown provider id", () => {
    const result = normalizeProvidersConfig({ reviewer: { provider: "bogus" } });
    expect(result.reviewer).toBeUndefined();
  });

  it("keeps a valid reviewer, with or without a model override", () => {
    expect(normalizeProvidersConfig({ reviewer: { provider: "openai" } }).reviewer).toEqual({
      provider: "openai",
    });
    expect(
      normalizeProvidersConfig({ reviewer: { provider: "openai", model: "gpt-4o" } }).reviewer,
    ).toEqual({
      provider: "openai",
      model: "gpt-4o",
    });
  });

  it("drops unknown provider keys from the providers map and keeps known ones", () => {
    const result = normalizeProvidersConfig({
      providers: { openai: { model: "gpt-4.1" }, "totally-bogus": { model: "x" } },
    });
    expect(result.providers).toEqual({ openai: { model: "gpt-4.1" } });
  });

  it("drops empty-string model/baseUrl fields rather than keeping them", () => {
    const result = normalizeProvidersConfig({ providers: { openai: { model: "", baseUrl: "" } } });
    expect(result.providers["openai"]).toEqual({});
  });

  it("one corrupted field never invalidates the rest of the file", () => {
    const result = normalizeProvidersConfig({
      activeProvider: "openai",
      analysisQuality: "bogus-quality",
      providers: { openai: { model: "gpt-4.1" } },
    });
    expect(result.activeProvider).toBe("openai");
    expect(result.analysisQuality).toBe("fast");
    expect(result.providers).toEqual({ openai: { model: "gpt-4.1" } });
  });
});

describe("saveProvidersConfig", () => {
  it("writes atomically — no partial file left behind under the target name", () => {
    saveProvidersConfig(defaultProvidersConfig(), dirs);
    const files = readdirSync(dirs.configDir);
    expect(files).toEqual(["providers.json"]);
  });
});
