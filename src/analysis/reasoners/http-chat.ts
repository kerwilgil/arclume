/**
 * A single, provider-agnostic caller for the OpenAI Chat Completions wire
 * shape (`POST {baseUrl}/chat/completions`), which OpenAI itself, NVIDIA
 * NIM, Ollama's compatibility layer, and most "OpenAI-compatible" servers all
 * mirror closely enough to share one implementation. This is the "reuse the
 * OpenAI-compatible architecture" the spec asks for.
 */

import { ProviderError } from "./shared.js";

export interface ChatCallOptions {
  /** Without the trailing `/chat/completions` — e.g. `https://api.openai.com/v1`. */
  baseUrl: string;
  apiKey?: string | undefined;
  model: string;
  system: string;
  user: string;
  timeoutMs?: number;
  extraHeaders?: Record<string, string>;
  /** Requests `response_format: {type:"json_object"}`. Best-effort: servers
   * that don't understand the field simply ignore it; validation downstream
   * is the real enforcement point either way. */
  jsonMode?: boolean;
  providerId: string;
}

export interface ChatCallResult {
  content: string;
  raw: unknown;
}

const DEFAULT_TIMEOUT_MS = 60_000;

export async function callOpenAiCompatibleChat(opts: ChatCallOptions): Promise<ChatCallResult> {
  let normalizedBase: string;
  try {
    normalizedBase = opts.baseUrl.replace(/\/+$/, "");
    // eslint-disable-next-line no-new
    new URL(normalizedBase);
  } catch {
    throw new ProviderError(
      `invalid base URL: "${opts.baseUrl}"`,
      "invalid-base-url",
      opts.providerId,
    );
  }
  const url = `${normalizedBase}/chat/completions`;

  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...opts.extraHeaders,
  };
  if (opts.apiKey) headers["authorization"] = `Bearer ${opts.apiKey}`;

  const body: Record<string, unknown> = {
    model: opts.model,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
  };
  if (opts.jsonMode) body["response_format"] = { type: "json_object" };

  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if ((err as { name?: string }).name === "AbortError") {
      throw new ProviderError(
        `request to ${url} timed out after ${timeoutMs}ms`,
        "timeout",
        opts.providerId,
      );
    }
    throw new ProviderError(
      `could not reach ${url}: ${(err as Error).message}`,
      "unavailable",
      opts.providerId,
    );
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new ProviderError(
        `authentication failed (HTTP ${res.status})`,
        "auth",
        opts.providerId,
        res.status,
      );
    }
    if (res.status === 404) {
      throw new ProviderError(
        `model "${opts.model}" or endpoint not found (HTTP 404)`,
        "model-unavailable",
        opts.providerId,
        res.status,
      );
    }
    throw new ProviderError(
      `provider returned HTTP ${res.status}: ${firstChars(text, 300)}`,
      "http-error",
      opts.providerId,
      res.status,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ProviderError(
      "provider response was not valid JSON",
      "malformed-response",
      opts.providerId,
    );
  }

  const content = (parsed as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]
    ?.message?.content;
  if (typeof content !== "string") {
    throw new ProviderError(
      "provider response is missing choices[0].message.content",
      "malformed-response",
      opts.providerId,
    );
  }

  return { content, raw: parsed };
}

function firstChars(text: string, n: number): string {
  return text.length > n ? `${text.slice(0, n)}…` : text;
}
