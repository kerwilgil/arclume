/**
 * Ollama — a local model server. Chat goes through Ollama's own
 * OpenAI-compatible endpoint (`{baseUrl}/v1/chat/completions`, exposed by
 * Ollama itself since 0.1.26), reusing {@link OpenAICompatibleReasoner}
 * rather than a second implementation. Model discovery and the lightweight
 * "is it even running" check use Ollama's native `GET /api/tags` — no chat
 * round-trip needed just to prove the server is up.
 */

import type {
  Reasoner,
  ReasonerCapabilities,
  ReasonerRequest,
  ReasonerResult,
} from "../reasoner.js";
import { OpenAICompatibleReasoner } from "./openai-compatible.js";
import type { ChatPrompt } from "./prompt.js";
import { ProviderError, definedFields } from "./shared.js";
import type { ProviderStatusResult } from "./test-connection.js";

export const OLLAMA_DEFAULT_BASE_URL = "http://127.0.0.1:11434";
export const OLLAMA_DEFAULT_TIMEOUT_MS = 60_000;

export interface OllamaConfig {
  baseUrl?: string;
  model: string;
  timeoutMs?: number;
  /** Defaults to the primary analysis prompt. Verified-mode reviewer duty
   * swaps this for `buildReviewerPrompt` bound to a candidate. */
  promptBuilder?: (request: ReasonerRequest) => ChatPrompt;
}

export class OllamaReasoner implements Reasoner {
  readonly capabilities: ReasonerCapabilities;
  readonly #inner: OpenAICompatibleReasoner;

  constructor(config: OllamaConfig) {
    const baseUrl = (config.baseUrl ?? OLLAMA_DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.#inner = new OpenAICompatibleReasoner(
      definedFields({
        id: "ollama",
        baseUrl: `${baseUrl}/v1`,
        model: config.model,
        timeoutMs: config.timeoutMs ?? OLLAMA_DEFAULT_TIMEOUT_MS,
        promptBuilder: config.promptBuilder,
      }),
    );
    this.capabilities = { ...this.#inner.capabilities, id: "ollama" };
  }

  async analyze(request: ReasonerRequest): Promise<ReasonerResult> {
    return this.#inner.analyze(request);
  }
}

export interface OllamaModel {
  name: string;
}

/**
 * `GET {baseUrl}/api/tags` — Ollama's native, stable model-listing endpoint.
 * Throws a {@link ProviderError} (`unavailable`) when Ollama is not running.
 */
export async function listOllamaModels(
  baseUrl: string = OLLAMA_DEFAULT_BASE_URL,
  timeoutMs = 5000,
): Promise<OllamaModel[]> {
  const url = `${baseUrl.replace(/\/+$/, "")}/api/tags`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, { method: "GET", signal: controller.signal });
  } catch (err) {
    if ((err as { name?: string }).name === "AbortError") {
      throw new ProviderError(
        `request to ${url} timed out after ${timeoutMs}ms`,
        "timeout",
        "ollama",
      );
    }
    throw new ProviderError(
      `Ollama is not reachable at ${baseUrl} — is it running? (${(err as Error).message})`,
      "unavailable",
      "ollama",
    );
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    throw new ProviderError(
      `Ollama returned HTTP ${res.status}`,
      "http-error",
      "ollama",
      res.status,
    );
  }
  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    throw new ProviderError(
      "Ollama's /api/tags response was not valid JSON",
      "malformed-response",
      "ollama",
    );
  }
  const models = (parsed as { models?: Array<{ name?: unknown }> })?.models;
  if (!Array.isArray(models)) {
    throw new ProviderError(
      "Ollama's /api/tags response is missing `models`",
      "malformed-response",
      "ollama",
    );
  }
  return models
    .filter((m): m is { name: string } => typeof m?.name === "string")
    .map((m) => ({ name: m.name }));
}

/** Test Connection for Ollama: reachability + (if a model is configured)
 * that the model is actually present locally. Never starts a full analysis.
 * Never throws — expected failures come back as `{ ready: false, kind, message }`. */
export async function testOllamaConnection(config: OllamaConfig): Promise<ProviderStatusResult> {
  try {
    const models = await listOllamaModels(config.baseUrl, 5000);
    const names = models.map((m) => m.name);
    if (config.model && !names.includes(config.model)) {
      return {
        ready: false,
        kind: "model-unavailable",
        message: `Ollama is running, but model "${config.model}" is not pulled locally. Available: ${names.join(", ") || "(none)"}`,
        models: names,
      };
    }
    return {
      ready: true,
      message: `Ollama is reachable (${names.length} model(s) available)`,
      models: names,
    };
  } catch (err) {
    if (err instanceof ProviderError) {
      return { ready: false, kind: err.kind, message: err.message };
    }
    return { ready: false, kind: "unavailable", message: (err as Error).message };
  }
}
