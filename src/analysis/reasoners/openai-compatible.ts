/**
 * `OpenAICompatibleReasoner` — one implementation shared by every provider
 * that speaks the OpenAI Chat Completions wire shape: OpenAI itself, NVIDIA
 * NIM, a user's custom OpenAI-compatible endpoint, and Ollama's own
 * compatibility layer. Each provider is a distinct, separately registered
 * `id` (for the registry/UI) built from this one class.
 */

import type {
  Reasoner,
  ReasonerCapabilities,
  ReasonerRequest,
  ReasonerResult,
} from "../reasoner.js";
import { callOpenAiCompatibleChat } from "./http-chat.js";
import { type ChatPrompt, buildAnalysisPrompt } from "./prompt.js";
import { definedFields, toReasonerError, validateAndWrap } from "./shared.js";

export interface OpenAICompatibleConfig {
  /** Registry id, e.g. "openai", "nvidia", "openai-compatible", "ollama". */
  id: string;
  version?: string;
  baseUrl: string;
  apiKey?: string | undefined;
  model: string;
  timeoutMs?: number;
  extraHeaders?: Record<string, string>;
  /** Defaults to the primary analysis prompt. Verified-mode reviewer duty
   * swaps this for `buildReviewerPrompt` bound to a candidate — same
   * transport, different instructions. */
  promptBuilder?: (request: ReasonerRequest) => ChatPrompt;
}

export class OpenAICompatibleReasoner implements Reasoner {
  readonly capabilities: ReasonerCapabilities;
  readonly #config: OpenAICompatibleConfig;

  constructor(config: OpenAICompatibleConfig) {
    this.#config = config;
    this.capabilities = {
      id: config.id,
      version: config.version ?? "0.1.0",
      deterministic: false,
      network: true,
    };
  }

  async analyze(request: ReasonerRequest): Promise<ReasonerResult> {
    const prompt = (this.#config.promptBuilder ?? buildAnalysisPrompt)(request);
    try {
      const { content } = await callOpenAiCompatibleChat(
        definedFields({
          baseUrl: this.#config.baseUrl,
          apiKey: this.#config.apiKey,
          model: this.#config.model,
          system: prompt.system,
          user: prompt.user,
          timeoutMs: this.#config.timeoutMs,
          extraHeaders: this.#config.extraHeaders,
          jsonMode: true,
          providerId: this.capabilities.id,
        }),
      );
      return validateAndWrap({ rawText: content }, this.capabilities);
    } catch (err) {
      throw toReasonerError(err, this.capabilities.id);
    }
  }
}

export const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1";
export const OPENAI_RECOMMENDED_MODEL = "gpt-4.1";

export function createOpenAiReasoner(config: {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
  promptBuilder?: (request: ReasonerRequest) => ChatPrompt;
}): OpenAICompatibleReasoner {
  return new OpenAICompatibleReasoner(
    definedFields({
      id: "openai",
      baseUrl: config.baseUrl ?? OPENAI_DEFAULT_BASE_URL,
      apiKey: config.apiKey,
      model: config.model ?? OPENAI_RECOMMENDED_MODEL,
      timeoutMs: config.timeoutMs,
      promptBuilder: config.promptBuilder,
    }),
  );
}

export const NVIDIA_DEFAULT_BASE_URL = "https://integrate.api.nvidia.com/v1";
export const NVIDIA_RECOMMENDED_MODEL = "meta/llama-3.1-70b-instruct";

export function createNvidiaReasoner(config: {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
  promptBuilder?: (request: ReasonerRequest) => ChatPrompt;
}): OpenAICompatibleReasoner {
  return new OpenAICompatibleReasoner(
    definedFields({
      id: "nvidia",
      baseUrl: config.baseUrl ?? NVIDIA_DEFAULT_BASE_URL,
      apiKey: config.apiKey,
      model: config.model ?? NVIDIA_RECOMMENDED_MODEL,
      timeoutMs: config.timeoutMs,
      promptBuilder: config.promptBuilder,
    }),
  );
}

export function createCustomOpenAiCompatibleReasoner(config: {
  baseUrl: string;
  model: string;
  apiKey?: string | undefined;
  timeoutMs?: number;
  promptBuilder?: (request: ReasonerRequest) => ChatPrompt;
}): OpenAICompatibleReasoner {
  return new OpenAICompatibleReasoner(
    definedFields({
      id: "openai-compatible",
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      model: config.model,
      timeoutMs: config.timeoutMs,
      promptBuilder: config.promptBuilder,
    }),
  );
}
