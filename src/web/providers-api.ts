/**
 * `/api/settings/*` — AI provider configuration. Same-origin, same session
 * token, same Host/Origin checks as every other `/api/*` route (wired in
 * from `api.ts`); nothing here adds CORS or a new trust boundary.
 *
 * A secret value is never returned to the frontend once saved — only
 * `configured: true/false` and a display-safe hint (`maskSecret`). Nothing
 * here logs a secret value either.
 */

import { detectClaudeCode, testClaudeCodeConnection } from "../analysis/reasoners/claude-code.js";
import { detectCodex, testCodexConnection } from "../analysis/reasoners/codex.js";
import { listOllamaModels, testOllamaConnection } from "../analysis/reasoners/ollama.js";
import { PROVIDER_DESCRIPTORS, listProviderDescriptors } from "../analysis/reasoners/registry.js";
import { ProviderError } from "../analysis/reasoners/shared.js";
import {
  type ProviderStatusResult,
  listOpenAiCompatibleModels,
  pingAnthropic,
  pingOpenAiCompatible,
} from "../analysis/reasoners/test-connection.js";
import {
  type AnalysisQuality,
  type ProviderId,
  type ProvidersConfig,
  isAnalysisQuality,
  isProviderId,
  loadProvidersConfig,
  saveProvidersConfig,
} from "../config/providers-config.js";
import { resolveSecret } from "../config/secret-precedence.js";
import { deleteSecret, maskSecret, readSecretsFile, setSecret } from "../config/secrets-store.js";
import { ApiError } from "./api.js";

/** The only secret keys Settings is ever allowed to write/delete — never an
 * arbitrary environment variable name from the request. */
const KNOWN_SECRET_KEYS = new Set([
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "NVIDIA_API_KEY",
  "OPENAI_COMPATIBLE_API_KEY",
]);

function requireBodyObject(body: unknown, what: string): Record<string, unknown> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ApiError(400, `${what} must be a JSON object`, "web/bad-request");
  }
  return body as Record<string, unknown>;
}

function requireProviderId(raw: string | undefined): ProviderId {
  if (!isProviderId(raw)) {
    throw new ApiError(400, `unknown provider id "${raw ?? ""}"`, "web/bad-request");
  }
  return raw;
}

function providerSummary(config: ProvidersConfig, id: ProviderId): Record<string, unknown> {
  const descriptor = PROVIDER_DESCRIPTORS[id];
  const secrets = readSecretsFile();
  const envKey = id === "openai-compatible" ? "OPENAI_COMPATIBLE_API_KEY" : descriptor.secretEnvKey;
  const resolvedSecret = envKey !== undefined ? resolveSecret(envKey, secrets) : undefined;
  const nonSecret = config.providers[id] ?? {};

  return {
    id,
    label: descriptor.label,
    authMode: descriptor.authMode,
    requiresBaseUrl: descriptor.requiresBaseUrl,
    requiresModel: descriptor.requiresModel,
    requiresApiKey: descriptor.requiresApiKey,
    defaultBaseUrl: descriptor.defaultBaseUrl,
    recommendedModel: descriptor.recommendedModel,
    secretConfigured: resolvedSecret !== undefined,
    secretHint: resolvedSecret !== undefined ? maskSecret(resolvedSecret.value) : undefined,
    secretSource: resolvedSecret?.source,
    config: nonSecret,
  };
}

export async function handleSettingsApi(
  method: string,
  parts: readonly string[],
  body: unknown,
): Promise<{ status: number; body: unknown }> {
  // parts = ["api", "settings", ...]
  const section = parts[2];

  if (method === "GET" && section === "providers" && parts.length === 3) {
    const config = loadProvidersConfig();
    return {
      status: 200,
      body: {
        ok: true,
        activeProvider: config.activeProvider,
        analysisQuality: config.analysisQuality,
        reviewer: config.reviewer,
        providers: listProviderDescriptors().map((d) => providerSummary(config, d.id)),
      },
    };
  }

  if (method === "PUT" && section === "providers" && parts[3] === "active") {
    const b = requireBodyObject(body, "active provider request");
    const activeProvider = requireProviderId(b["activeProvider"] as string | undefined);
    const analysisQualityRaw = b["analysisQuality"];
    const analysisQuality: AnalysisQuality = isAnalysisQuality(analysisQualityRaw)
      ? analysisQualityRaw
      : "fast";
    const reviewerRaw = b["reviewer"];

    const config = loadProvidersConfig();
    config.activeProvider = activeProvider;
    config.analysisQuality = analysisQuality;
    if (typeof reviewerRaw === "object" && reviewerRaw !== null) {
      const r = reviewerRaw as Record<string, unknown>;
      const reviewerProvider = r["provider"];
      if (isProviderId(reviewerProvider)) {
        config.reviewer = { provider: reviewerProvider };
        if (typeof r["model"] === "string" && (r["model"] as string).length > 0) {
          config.reviewer.model = r["model"] as string;
        }
      }
    } else {
      delete config.reviewer;
    }
    saveProvidersConfig(config);
    return { status: 200, body: { ok: true } };
  }

  if (
    method === "PUT" &&
    section === "providers" &&
    parts[3] !== undefined &&
    parts[4] === "config"
  ) {
    const id = requireProviderId(parts[3]);
    const b = requireBodyObject(body, "provider config request");
    const config = loadProvidersConfig();
    const current = config.providers[id] ?? {};
    if (typeof b["model"] === "string") current.model = b["model"] as string;
    if (typeof b["baseUrl"] === "string") current.baseUrl = b["baseUrl"] as string;
    config.providers[id] = current;
    saveProvidersConfig(config);
    return { status: 200, body: { ok: true } };
  }

  if (method === "PUT" && section === "secrets" && parts[3] !== undefined) {
    const key = parts[3];
    if (!KNOWN_SECRET_KEYS.has(key)) {
      throw new ApiError(400, `unknown secret key "${key}"`, "web/bad-request");
    }
    const b = requireBodyObject(body, "secret request");
    const value = b["value"];
    if (typeof value !== "string" || value.length === 0) {
      throw new ApiError(400, `"value" must be a non-empty string`, "web/bad-request");
    }
    setSecret(key, value);
    return { status: 200, body: { ok: true, configured: true, secretHint: maskSecret(value) } };
  }

  if (method === "DELETE" && section === "secrets" && parts[3] !== undefined) {
    const key = parts[3];
    if (!KNOWN_SECRET_KEYS.has(key)) {
      throw new ApiError(400, `unknown secret key "${key}"`, "web/bad-request");
    }
    deleteSecret(key);
    return { status: 200, body: { ok: true, configured: false } };
  }

  if (
    method === "POST" &&
    section === "providers" &&
    parts[3] !== undefined &&
    parts[4] === "test"
  ) {
    const id = requireProviderId(parts[3]);
    const result = await testProviderConnection(id);
    return { status: 200, body: { ok: true, ...result } };
  }

  if (
    method === "GET" &&
    section === "providers" &&
    parts[3] !== undefined &&
    parts[4] === "models"
  ) {
    const id = requireProviderId(parts[3]);
    const config = loadProvidersConfig();
    const nonSecret = config.providers[id] ?? {};
    const secrets = readSecretsFile();

    // Providers that support model discovery (OpenAI-compatible `{baseUrl}/models`,
    // or Ollama's local `/api/tags`).
    const discoverableProviders = ["nvidia", "openai", "openai-compatible", "ollama"] as const;

    type DiscoverableProvider = (typeof discoverableProviders)[number];
    if (!discoverableProviders.includes(id as DiscoverableProvider)) {
      return { status: 200, body: { ok: true, models: [] } };
    }
    const discoverableId = id as DiscoverableProvider;

    try {
      if (discoverableId === "ollama") {
        const baseUrl = nonSecret.baseUrl;
        const models = await listOllamaModels(baseUrl);
        return { status: 200, body: { ok: true, models: models.map((m) => m.name) } };
      }
      // OpenAI-compatible providers (OpenAI, NVIDIA, custom)
      const resolved = resolveSecret(
        discoverableId === "openai-compatible"
          ? "OPENAI_COMPATIBLE_API_KEY"
          : `${discoverableId.toUpperCase()}_API_KEY`,
        secrets,
      );
      const apiKey = resolved?.value;
      const baseUrl =
        nonSecret.baseUrl ??
        PROVIDER_DESCRIPTORS[discoverableId].defaultBaseUrl ??
        (discoverableId === "nvidia"
          ? "https://integrate.api.nvidia.com/v1"
          : "https://api.openai.com/v1");

      const models = await listOpenAiCompatibleModels({
        providerId: discoverableId,
        baseUrl,
        apiKey,
        timeoutMs: 15_000,
      });
      return { status: 200, body: { ok: true, models } };
    } catch (err) {
      if (err instanceof ProviderError) {
        // Return structured error info to the frontend
        return {
          status: 200,
          body: {
            ok: false,
            error: err.kind,
            message: err.message,
          },
        };
      }
      throw new ApiError(502, (err as Error).message, "web/provider-unavailable");
    }
  }

  throw new ApiError(404, `no such settings route: ${method} ${parts.join("/")}`, "web/not-found");
}

async function testProviderConnection(
  id: ProviderId,
): Promise<ProviderStatusResult & { provider: ProviderId }> {
  const config = loadProvidersConfig();
  const nonSecret = config.providers[id] ?? {};
  const secrets = readSecretsFile();

  switch (id) {
    case "stub":
      return { provider: id, ready: true, message: "Offline Preview is always available" };
    case "claude-code": {
      const status = await testClaudeCodeConnection(
        nonSecret.model !== undefined ? { model: nonSecret.model } : {},
      );
      return { provider: id, ready: status.state === "ready", message: status.message };
    }
    case "codex": {
      const status = await testCodexConnection(
        nonSecret.model !== undefined ? { model: nonSecret.model } : {},
      );
      return { provider: id, ready: status.state === "ready", message: status.message };
    }
    case "anthropic": {
      const resolved = resolveSecret("ANTHROPIC_API_KEY", secrets);
      if (resolved === undefined) {
        return { provider: id, ready: false, kind: "auth", message: "no API key configured" };
      }
      const result = await pingAnthropic({
        apiKey: resolved.value,
        model:
          nonSecret.model ?? PROVIDER_DESCRIPTORS.anthropic.recommendedModel ?? "claude-sonnet-5",
        ...(nonSecret.baseUrl !== undefined ? { baseUrl: nonSecret.baseUrl } : {}),
      });
      return { provider: id, ...result };
    }
    case "openai": {
      const resolved = resolveSecret("OPENAI_API_KEY", secrets);
      if (resolved === undefined) {
        return { provider: id, ready: false, kind: "auth", message: "no API key configured" };
      }
      const result = await pingOpenAiCompatible({
        providerId: id,
        baseUrl:
          nonSecret.baseUrl ??
          PROVIDER_DESCRIPTORS.openai.defaultBaseUrl ??
          "https://api.openai.com/v1",
        apiKey: resolved.value,
        model: nonSecret.model ?? PROVIDER_DESCRIPTORS.openai.recommendedModel ?? "gpt-4.1",
      });
      return { provider: id, ...result };
    }
    case "nvidia": {
      const resolved = resolveSecret("NVIDIA_API_KEY", secrets);
      if (resolved === undefined) {
        return { provider: id, ready: false, kind: "auth", message: "no API key configured" };
      }
      const result = await pingOpenAiCompatible({
        providerId: id,
        baseUrl:
          nonSecret.baseUrl ??
          PROVIDER_DESCRIPTORS.nvidia.defaultBaseUrl ??
          "https://integrate.api.nvidia.com/v1",
        apiKey: resolved.value,
        model:
          nonSecret.model ??
          PROVIDER_DESCRIPTORS.nvidia.recommendedModel ??
          "meta/llama-3.1-70b-instruct",
      });
      return { provider: id, ...result };
    }
    case "openai-compatible": {
      if (!nonSecret.baseUrl || !nonSecret.model) {
        return {
          provider: id,
          ready: false,
          kind: "invalid-base-url",
          message: "baseUrl and model are both required",
        };
      }
      const resolved = resolveSecret("OPENAI_COMPATIBLE_API_KEY", secrets);
      const result = await pingOpenAiCompatible({
        providerId: id,
        baseUrl: nonSecret.baseUrl,
        model: nonSecret.model,
        ...(resolved !== undefined ? { apiKey: resolved.value } : {}),
      });
      return { provider: id, ...result };
    }
    case "ollama": {
      if (!nonSecret.model) {
        return {
          provider: id,
          ready: false,
          kind: "model-unavailable",
          message: "select a model (see the model list below)",
        };
      }
      const result = await testOllamaConnection({
        ...(nonSecret.baseUrl !== undefined ? { baseUrl: nonSecret.baseUrl } : {}),
        model: nonSecret.model,
      });
      return { provider: id, ...result };
    }
    default: {
      const _exhaustive: never = id;
      throw new ApiError(400, `unknown provider id "${_exhaustive as string}"`, "web/bad-request");
    }
  }
}

/** Only used by the secret-leakage tests: the exact set of writable keys. */
export const SETTINGS_KNOWN_SECRET_KEYS = KNOWN_SECRET_KEYS;
