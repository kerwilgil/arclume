/**
 * `config\providers.json` — everything about AI provider configuration that
 * is NOT a secret: which provider is active, its model/base URL, the
 * analysis quality mode, and the Verified-mode reviewer choice. API keys
 * live only in `secrets\.env` (see `secret-store.ts`) and are never written
 * here.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { type ArclumeDirs, providersConfigPath, resolveArclumeDirs } from "./paths.js";

export const PROVIDER_IDS = [
  "stub",
  "claude-code",
  "codex",
  "anthropic",
  "openai",
  "nvidia",
  "openai-compatible",
  "ollama",
] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && (PROVIDER_IDS as readonly string[]).includes(value);
}

export const ANALYSIS_QUALITIES = ["fast", "verified"] as const;
export type AnalysisQuality = (typeof ANALYSIS_QUALITIES)[number];

export function isAnalysisQuality(value: unknown): value is AnalysisQuality {
  return value === "fast" || value === "verified";
}

export interface ProviderNonSecretConfig {
  model?: string;
  baseUrl?: string;
}

export interface ReviewerConfig {
  provider: ProviderId;
  model?: string;
}

export const PROVIDERS_CONFIG_VERSION = 1 as const;

export interface ProvidersConfig {
  version: typeof PROVIDERS_CONFIG_VERSION;
  activeProvider: ProviderId;
  analysisQuality: AnalysisQuality;
  reviewer?: ReviewerConfig;
  providers: Partial<Record<ProviderId, ProviderNonSecretConfig>>;
}

export function defaultProvidersConfig(): ProvidersConfig {
  return {
    version: PROVIDERS_CONFIG_VERSION,
    activeProvider: "stub",
    analysisQuality: "fast",
    providers: {},
  };
}

function normalizeProviderConfig(value: unknown): ProviderNonSecretConfig {
  if (typeof value !== "object" || value === null) return {};
  const v = value as Record<string, unknown>;
  const out: ProviderNonSecretConfig = {};
  const model = v["model"];
  const baseUrl = v["baseUrl"];
  if (typeof model === "string" && model.length > 0) out.model = model;
  if (typeof baseUrl === "string" && baseUrl.length > 0) out.baseUrl = baseUrl;
  return out;
}

function normalizeReviewer(value: unknown): ReviewerConfig | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const v = value as Record<string, unknown>;
  const provider = v["provider"];
  if (!isProviderId(provider)) return undefined;
  const reviewer: ReviewerConfig = { provider };
  const model = v["model"];
  if (typeof model === "string" && model.length > 0) reviewer.model = model;
  return reviewer;
}

/**
 * Defensively rebuilds a `ProvidersConfig` from an arbitrary parsed value:
 * unknown provider ids, a bad quality enum, or a missing/malformed section
 * all fall back to the corresponding default field rather than throwing —
 * one corrupted field never invalidates the rest of the file.
 */
export function normalizeProvidersConfig(value: unknown): ProvidersConfig {
  const defaults = defaultProvidersConfig();
  if (typeof value !== "object" || value === null) return defaults;
  const v = value as Record<string, unknown>;

  const rawActiveProvider = v["activeProvider"];
  const rawAnalysisQuality = v["analysisQuality"];
  const activeProvider = isProviderId(rawActiveProvider)
    ? rawActiveProvider
    : defaults.activeProvider;
  const analysisQuality = isAnalysisQuality(rawAnalysisQuality)
    ? rawAnalysisQuality
    : defaults.analysisQuality;
  const reviewer = normalizeReviewer(v["reviewer"]);

  const providers: Partial<Record<ProviderId, ProviderNonSecretConfig>> = {};
  const rawProviders = v["providers"];
  if (typeof rawProviders === "object" && rawProviders !== null) {
    for (const [id, cfg] of Object.entries(rawProviders as Record<string, unknown>)) {
      if (isProviderId(id)) providers[id] = normalizeProviderConfig(cfg);
    }
  }

  const config: ProvidersConfig = {
    version: PROVIDERS_CONFIG_VERSION,
    activeProvider,
    analysisQuality,
    providers,
  };
  if (reviewer !== undefined) config.reviewer = reviewer;
  return config;
}

/** A missing or corrupted file both resolve to the safe default — never throws. */
export function loadProvidersConfig(dirs: ArclumeDirs = resolveArclumeDirs()): ProvidersConfig {
  const path = providersConfigPath(dirs);
  if (!existsSync(path)) return defaultProvidersConfig();
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return normalizeProvidersConfig(parsed);
  } catch {
    return defaultProvidersConfig();
  }
}

/** Atomic write: temp file in the same directory, then rename over the
 * target, so a reader never observes a partially written file. */
export function saveProvidersConfig(
  config: ProvidersConfig,
  dirs: ArclumeDirs = resolveArclumeDirs(),
): void {
  mkdirSync(dirs.configDir, { recursive: true });
  const path = providersConfigPath(dirs);
  // pid-only, no timestamp — matches the atomic-write convention already
  // established in src/cli/build.ts; the Core's determinism test forbids
  // any wall-clock read anywhere under src/.
  const tempPath = `${path}.${process.pid}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  renameSync(tempPath, path);
}
