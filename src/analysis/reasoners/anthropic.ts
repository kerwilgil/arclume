/**
 * Anthropic — direct Messages API. Forces the response into a single
 * `tool_use` block (a real, stable Anthropic feature — `tool_choice: {type:
 * "tool", ...}`) purely to guarantee clean JSON syntax with no prose or
 * markdown wrapper around it. The tool's own `input_schema` is deliberately
 * generic (`{ result: object }`) rather than the full AnalysisResult schema:
 * that schema `$ref`s an external `common.json` document Anthropic's API has
 * no way to resolve, and — per the project's rule that a provider's own
 * schema obedience is never trusted — ARCLUME's own `validateAnalysisResult`
 * is the actual enforcement point regardless.
 */

import type {
  Reasoner,
  ReasonerCapabilities,
  ReasonerRequest,
  ReasonerResult,
} from "../reasoner.js";
import { type ChatPrompt, buildAnalysisPrompt } from "./prompt.js";
import { ProviderError, definedFields, toReasonerError, validateAndWrap } from "./shared.js";

export const ANTHROPIC_DEFAULT_BASE_URL = "https://api.anthropic.com";
export const ANTHROPIC_DEFAULT_VERSION = "2023-06-01";
export const ANTHROPIC_RECOMMENDED_MODEL = "claude-sonnet-5";

export interface AnthropicConfig {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
  /** Defaults to the primary analysis prompt. Verified-mode reviewer duty
   * swaps this for `buildReviewerPrompt` bound to a candidate. */
  promptBuilder?: (request: ReasonerRequest) => ChatPrompt;
}

const SUBMIT_TOOL_NAME = "submit_analysis";

const CAPABILITIES: ReasonerCapabilities = {
  id: "anthropic",
  version: "0.1.0",
  deterministic: false,
  network: true,
};

export class AnthropicReasoner implements Reasoner {
  readonly capabilities = CAPABILITIES;
  readonly #config: AnthropicConfig;

  constructor(config: AnthropicConfig) {
    this.#config = config;
  }

  async analyze(request: ReasonerRequest): Promise<ReasonerResult> {
    const prompt = (this.#config.promptBuilder ?? buildAnalysisPrompt)(request);
    try {
      const input = await callAnthropicTool(
        definedFields({
          apiKey: this.#config.apiKey,
          model: this.#config.model ?? ANTHROPIC_RECOMMENDED_MODEL,
          baseUrl: this.#config.baseUrl,
          timeoutMs: this.#config.timeoutMs,
          system: prompt.system,
          user: prompt.user,
        }),
      );
      return validateAndWrap({ parsedValue: input }, this.capabilities);
    } catch (err) {
      throw toReasonerError(err, this.capabilities.id);
    }
  }
}

/** Calls the Messages API forcing a `submit_analysis` tool call and returns
 * the `result` field of its input — the raw candidate value, not yet
 * validated. Shared by {@link AnthropicReasoner} so the wire format lives in
 * exactly one place. */
export async function callAnthropicTool(opts: {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  baseUrl?: string;
  timeoutMs?: number;
}): Promise<unknown> {
  const baseUrl = (opts.baseUrl ?? ANTHROPIC_DEFAULT_BASE_URL).replace(/\/+$/, "");
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": opts.apiKey,
        "anthropic-version": ANTHROPIC_DEFAULT_VERSION,
      },
      body: JSON.stringify({
        model: opts.model,
        max_tokens: 8192,
        system: opts.system,
        messages: [{ role: "user", content: opts.user }],
        tools: [
          {
            name: SUBMIT_TOOL_NAME,
            description: "Submit the ARCLUME AnalysisResult JSON object as `result`.",
            input_schema: {
              type: "object",
              additionalProperties: false,
              required: ["result"],
              properties: { result: { type: "object" } },
            },
          },
        ],
        tool_choice: { type: "tool", name: SUBMIT_TOOL_NAME },
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if ((err as { name?: string }).name === "AbortError") {
      throw new ProviderError(`request timed out after ${timeoutMs}ms`, "timeout", "anthropic");
    }
    throw new ProviderError(
      `could not reach Anthropic: ${(err as Error).message}`,
      "unavailable",
      "anthropic",
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
        "anthropic",
        res.status,
      );
    }
    if (res.status === 404) {
      throw new ProviderError(
        `model "${opts.model}" not found`,
        "model-unavailable",
        "anthropic",
        res.status,
      );
    }
    throw new ProviderError(
      `Anthropic returned HTTP ${res.status}: ${firstChars(text, 300)}`,
      "http-error",
      "anthropic",
      res.status,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ProviderError(
      "Anthropic response was not valid JSON",
      "malformed-response",
      "anthropic",
    );
  }

  const content = (parsed as { content?: Array<{ type?: string; name?: string; input?: unknown }> })
    ?.content;
  const toolUse = Array.isArray(content)
    ? content.find((block) => block?.type === "tool_use" && block?.name === SUBMIT_TOOL_NAME)
    : undefined;
  const result = (toolUse?.input as { result?: unknown } | undefined)?.result;
  if (result === undefined) {
    throw new ProviderError(
      "Anthropic response did not include the expected tool_use block",
      "malformed-response",
      "anthropic",
    );
  }
  return result;
}

function firstChars(text: string, n: number): string {
  return text.length > n ? `${text.slice(0, n)}…` : text;
}
