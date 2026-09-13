/**
 * The Reasoner registry: one place that knows every provider id, what it
 * needs to be configured (a CLI, an API key, a base URL), and how to build a
 * live {@link Reasoner} from `providers.json` + the secrets store. Nothing
 * provider-specific ever leaks into the Knowledge Model or the pipeline —
 * they only ever see the plain `Reasoner` interface this module returns.
 */

import type { ProviderId, ProviderNonSecretConfig } from "../../config/providers-config.js";
import { PROVIDER_IDS } from "../../config/providers-config.js";
import { resolveSecret } from "../../config/secret-precedence.js";
import type { SecretsMap } from "../../config/secrets-store.js";
import { ReasonerError } from "../../errors.js";
import type { Reasoner, ReasonerRequest } from "../reasoner.js";
import { ANTHROPIC_RECOMMENDED_MODEL, AnthropicReasoner } from "./anthropic.js";
import { ClaudeCodeReasoner } from "./claude-code.js";
import { CodexReasoner } from "./codex.js";
import { OLLAMA_DEFAULT_BASE_URL, OllamaReasoner } from "./ollama.js";
import {
  NVIDIA_DEFAULT_BASE_URL,
  NVIDIA_RECOMMENDED_MODEL,
  OPENAI_DEFAULT_BASE_URL,
  OPENAI_RECOMMENDED_MODEL,
  createCustomOpenAiCompatibleReasoner,
  createNvidiaReasoner,
  createOpenAiReasoner,
} from "./openai-compatible.js";
import type { ChatPrompt } from "./prompt.js";
import { definedFields } from "./shared.js";
import { StubReasoner } from "./stub.js";

export type ProviderAuthMode = "subscription-cli" | "api-key" | "local";

export interface ProviderDescriptor {
  id: ProviderId;
  label: string;
  authMode: ProviderAuthMode;
  /** The `secrets\.env` key this provider reads, if it needs one. */
  secretEnvKey?: string;
  defaultBaseUrl?: string;
  recommendedModel?: string;
  requiresBaseUrl: boolean;
  requiresModel: boolean;
  /** Set for the two CLI-based providers — they need no key/URL, only the
   * CLI itself to be installed and authenticated. */
  requiresApiKey: boolean;
}

export const PROVIDER_DESCRIPTORS: Record<ProviderId, ProviderDescriptor> = {
  stub: {
    id: "stub",
    label: "Offline Preview (Stub)",
    authMode: "local",
    requiresBaseUrl: false,
    requiresModel: false,
    requiresApiKey: false,
  },
  "claude-code": {
    id: "claude-code",
    label: "Claude Code",
    authMode: "subscription-cli",
    requiresBaseUrl: false,
    requiresModel: false,
    requiresApiKey: false,
  },
  codex: {
    id: "codex",
    label: "Codex",
    authMode: "subscription-cli",
    requiresBaseUrl: false,
    requiresModel: false,
    requiresApiKey: false,
  },
  anthropic: {
    id: "anthropic",
    label: "Anthropic API",
    authMode: "api-key",
    secretEnvKey: "ANTHROPIC_API_KEY",
    recommendedModel: ANTHROPIC_RECOMMENDED_MODEL,
    requiresBaseUrl: false,
    requiresModel: false,
    requiresApiKey: true,
  },
  openai: {
    id: "openai",
    label: "OpenAI API",
    authMode: "api-key",
    secretEnvKey: "OPENAI_API_KEY",
    defaultBaseUrl: OPENAI_DEFAULT_BASE_URL,
    recommendedModel: OPENAI_RECOMMENDED_MODEL,
    requiresBaseUrl: false,
    requiresModel: false,
    requiresApiKey: true,
  },
  nvidia: {
    id: "nvidia",
    label: "NVIDIA API / NIM",
    authMode: "api-key",
    secretEnvKey: "NVIDIA_API_KEY",
    defaultBaseUrl: NVIDIA_DEFAULT_BASE_URL,
    recommendedModel: NVIDIA_RECOMMENDED_MODEL,
    requiresBaseUrl: false,
    requiresModel: false,
    requiresApiKey: true,
  },
  "openai-compatible": {
    id: "openai-compatible",
    label: "Custom OpenAI-compatible",
    authMode: "api-key",
    secretEnvKey: "OPENAI_COMPATIBLE_API_KEY",
    requiresBaseUrl: true,
    requiresModel: true,
    requiresApiKey: false, // optional for this one
  },
  ollama: {
    id: "ollama",
    label: "Ollama",
    authMode: "local",
    defaultBaseUrl: OLLAMA_DEFAULT_BASE_URL,
    requiresBaseUrl: false,
    requiresModel: true,
    requiresApiKey: false,
  },
};

export function listProviderDescriptors(): ProviderDescriptor[] {
  return PROVIDER_IDS.map((id) => PROVIDER_DESCRIPTORS[id]);
}

function requireSecret(
  providerId: ProviderId,
  envKey: string,
  secrets: SecretsMap,
  env: NodeJS.ProcessEnv,
): string {
  const resolved = resolveSecret(envKey, secrets, env);
  if (resolved === undefined) {
    throw new ReasonerError(`${providerId}: no API key configured (expected ${envKey})`, {
      code: "reasoner/provider-not-configured",
      severity: "fatal",
    });
  }
  return resolved.value;
}

/**
 * Builds a live `Reasoner` for `id` from its non-secret config plus the
 * secrets store. Throws `ReasonerError` (`reasoner/provider-not-configured`)
 * for an unregistered id or a required secret that is missing — never a
 * silent fallback to the stub.
 */
export function buildReasoner(
  id: ProviderId,
  config: ProviderNonSecretConfig | undefined,
  secrets: SecretsMap,
  env: NodeJS.ProcessEnv = process.env,
  promptBuilder?: (request: ReasonerRequest) => ChatPrompt,
): Reasoner {
  switch (id) {
    case "stub":
      return new StubReasoner();
    case "claude-code":
      return new ClaudeCodeReasoner(definedFields({ model: config?.model, promptBuilder }));
    case "codex":
      return new CodexReasoner(definedFields({ model: config?.model, promptBuilder }));
    case "anthropic": {
      const apiKey = requireSecret(id, "ANTHROPIC_API_KEY", secrets, env);
      return new AnthropicReasoner(
        definedFields({ apiKey, model: config?.model, baseUrl: config?.baseUrl, promptBuilder }),
      );
    }
    case "openai": {
      const apiKey = requireSecret(id, "OPENAI_API_KEY", secrets, env);
      return createOpenAiReasoner(
        definedFields({ apiKey, model: config?.model, baseUrl: config?.baseUrl, promptBuilder }),
      );
    }
    case "nvidia": {
      const apiKey = requireSecret(id, "NVIDIA_API_KEY", secrets, env);
      return createNvidiaReasoner(
        definedFields({ apiKey, model: config?.model, baseUrl: config?.baseUrl, promptBuilder }),
      );
    }
    case "openai-compatible": {
      if (!config?.baseUrl || !config?.model) {
        throw new ReasonerError(`${id}: baseUrl and model are both required`, {
          code: "reasoner/provider-not-configured",
          severity: "fatal",
        });
      }
      const resolvedKey = resolveSecret("OPENAI_COMPATIBLE_API_KEY", secrets, env);
      return createCustomOpenAiCompatibleReasoner(
        definedFields({
          baseUrl: config.baseUrl,
          model: config.model,
          apiKey: resolvedKey?.value,
          promptBuilder,
        }),
      );
    }
    case "ollama": {
      if (!config?.model) {
        throw new ReasonerError(
          `${id}: a model is required (see Test Connection for locally available models)`,
          {
            code: "reasoner/provider-not-configured",
            severity: "fatal",
          },
        );
      }
      return new OllamaReasoner(
        definedFields({ baseUrl: config.baseUrl, model: config.model, promptBuilder }),
      );
    }
    default: {
      const _exhaustive: never = id;
      throw new ReasonerError(`unknown provider id "${_exhaustive as string}"`, {
        code: "reasoner/provider-not-configured",
        severity: "fatal",
      });
    }
  }
}
