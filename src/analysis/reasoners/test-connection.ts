/**
 * "Test Connection" — checks a configured provider adapter is reachable and
 * usable WITHOUT running a full analysis (no ARCLUME schema, no source
 * documents sent). Never throws for an expected failure: every result comes
 * back as a structured `ProviderStatusResult` so the Settings API can always
 * answer with a normal response body, and never leaks a secret value into
 * `message`.
 */

import { callOpenAiCompatibleChat } from "./http-chat.js";
import type { ProviderFailureKind } from "./shared.js";
import { ProviderError } from "./shared.js";

export interface ProviderStatusResult {
  ready: boolean;
  message: string;
  kind?: ProviderFailureKind | "not-authenticated";
  models?: string[];
}

const PING_SYSTEM = "You are a connectivity check. Reply with exactly one word: ok";
const PING_USER = "ping";

/** A minimal chat round-trip — proves auth + reachability + model
 * availability without spending the tokens a full analysis prompt would. */
export async function pingOpenAiCompatible(opts: {
  providerId: string;
  baseUrl: string;
  apiKey?: string | undefined;
  model: string;
  timeoutMs?: number;
}): Promise<ProviderStatusResult> {
  try {
    await callOpenAiCompatibleChat({
      baseUrl: opts.baseUrl,
      apiKey: opts.apiKey,
      model: opts.model,
      system: PING_SYSTEM,
      user: PING_USER,
      timeoutMs: opts.timeoutMs ?? 15_000,
      providerId: opts.providerId,
    });
    return { ready: true, message: `Connected to ${opts.providerId} (model "${opts.model}")` };
  } catch (err) {
    if (err instanceof ProviderError) {
      return { ready: false, kind: err.kind, message: err.message };
    }
    return { ready: false, kind: "unavailable", message: (err as Error).message };
  }
}

export async function pingAnthropic(opts: {
  apiKey: string;
  model: string;
  baseUrl?: string;
  timeoutMs?: number;
}): Promise<ProviderStatusResult> {
  const baseUrl = (opts.baseUrl ?? "https://api.anthropic.com").replace(/\/+$/, "");
  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": opts.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: opts.model,
        max_tokens: 8,
        messages: [{ role: "user", content: PING_USER }],
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const kind: ProviderFailureKind = res.status === 401 ? "auth" : "http-error";
      return { ready: false, kind, message: `Anthropic returned HTTP ${res.status}` };
    }
    return { ready: true, message: `Connected to Anthropic (model "${opts.model}")` };
  } catch (err) {
    if ((err as { name?: string }).name === "AbortError") {
      return { ready: false, kind: "timeout", message: `timed out after ${timeoutMs}ms` };
    }
    return { ready: false, kind: "unavailable", message: (err as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * List models for OpenAI-compatible providers (OpenAI, NVIDIA, custom).
 * Hits `{baseUrl}/models`. `baseUrl` already carries the version segment
 * (e.g. `https://api.openai.com/v1`, `https://integrate.api.nvidia.com/v1`),
 * exactly like `callOpenAiCompatibleChat` which appends `/chat/completions`.
 */
export async function listOpenAiCompatibleModels(opts: {
  providerId: string;
  baseUrl: string;
  apiKey?: string | undefined;
  timeoutMs?: number;
}): Promise<string[]> {
  let normalizedBase: string;
  try {
    normalizedBase = opts.baseUrl.replace(/\/+$/, "");
    new URL(normalizedBase);
  } catch {
    throw new ProviderError(
      `invalid base URL: "${opts.baseUrl}"`,
      "invalid-base-url",
      opts.providerId,
    );
  }
  const url = `${normalizedBase}/models`;
  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        ...(opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {}),
        "content-type": "application/json",
      },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      if (res.status === 401) {
        throw new ProviderError(
          "authentication failed (HTTP 401)",
          "auth",
          opts.providerId,
          res.status,
        );
      }
      if (res.status === 404) {
        throw new ProviderError(
          "models endpoint not found (HTTP 404)",
          "model-unavailable",
          opts.providerId,
          res.status,
        );
      }
      throw new ProviderError(
        `provider returned HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`,
        "http-error",
        opts.providerId,
        res.status,
      );
    }

    let parsed: unknown;
    try {
      parsed = await res.json();
    } catch {
      throw new ProviderError(
        "provider response was not valid JSON",
        "malformed-response",
        opts.providerId,
      );
    }

    const models = (parsed as { data?: Array<{ id?: unknown; name?: unknown }> })?.data;
    if (!Array.isArray(models)) {
      throw new ProviderError(
        "provider response is missing models array",
        "malformed-response",
        opts.providerId,
      );
    }

    return models.filter((m): m is { id: string } => typeof m?.id === "string").map((m) => m.id);
  } catch (err) {
    if ((err as { name?: string }).name === "AbortError") {
      throw new ProviderError(
        `request to ${opts.providerId} timed out after ${timeoutMs}ms`,
        "timeout",
        opts.providerId,
      );
    }
    if (err instanceof ProviderError) throw err;
    throw new ProviderError(
      `could not reach ${opts.providerId}: ${(err as Error).message}`,
      "unavailable",
      opts.providerId,
    );
  }
}
