/**
 * Shared plumbing every network-backed Reasoner adapter uses: turning a raw
 * provider response into a validated {@link ReasonerResult}, and mapping
 * transport failures onto a small, stable set of `ReasonerError` codes the UI
 * (Test Connection, Analyze) can branch on without parsing prose messages.
 */

import { ReasonerError } from "../../errors.js";
import { formatValidationReport, validateAnalysisResult } from "../../validation/validator.js";
import type { AnalysisResult } from "../analysis-result.js";
import type { ReasonerCapabilities, ReasonerResult } from "../reasoner.js";
import { JsonExtractionError, extractJsonObject } from "./json-extract.js";

/**
 * Strips every `undefined`-valued key, so the result satisfies
 * `exactOptionalPropertyTypes: true` when spread into a config object whose
 * fields are declared `field?: T` (an explicit `field: undefined` is a type
 * error under that flag — the key must be absent instead). Only fields whose
 * declared type already included `undefined` become optional in the result;
 * a field that is never `undefined` stays required, so this is safe to use
 * even when some values in `obj` are always-present. Every provider
 * adapter's config-building call site uses this instead of repeating a
 * manual conditional-spread per optional field.
 */
export type DefinedFields<T> = {
  [K in keyof T as undefined extends T[K] ? never : K]: T[K];
} & {
  [K in keyof T as undefined extends T[K] ? K : never]?: Exclude<T[K], undefined>;
};

export function definedFields<T extends Record<string, unknown>>(obj: T): DefinedFields<T> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    if (value !== undefined) out[key] = value;
  }
  return out as DefinedFields<T>;
}

/** The provider-agnostic shape of "what went wrong talking to the provider". */
export type ProviderFailureKind =
  | "unavailable" // could not reach it at all (DNS/connect failure, ECONNREFUSED)
  | "timeout"
  | "auth" // 401/403, or a CLI's "not authenticated" signature
  | "not-installed" // CLI providers only
  | "invalid-base-url"
  | "model-unavailable" // 404 on model, or provider says "model not found"
  | "http-error" // any other non-2xx
  | "malformed-response"; // couldn't parse a response body / expected field missing

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly kind: ProviderFailureKind,
    readonly providerId: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

const CODE_BY_KIND: Record<ProviderFailureKind, string> = {
  unavailable: "reasoner/provider-unavailable",
  timeout: "reasoner/provider-timeout",
  auth: "reasoner/provider-auth-failed",
  "not-installed": "reasoner/provider-not-installed",
  "invalid-base-url": "reasoner/provider-invalid-base-url",
  "model-unavailable": "reasoner/provider-model-unavailable",
  "http-error": "reasoner/provider-http-error",
  "malformed-response": "reasoner/provider-malformed-response",
};

/** Converts a {@link ProviderError} (or any other thrown value) into the
 * fatal `ReasonerError` the pipeline expects, never leaking a raw stack as
 * the primary message. */
export function toReasonerError(err: unknown, providerId: string): ReasonerError {
  if (err instanceof ProviderError) {
    return new ReasonerError(err.message, {
      code: CODE_BY_KIND[err.kind],
      severity: "fatal",
      cause: err,
    });
  }
  if (err instanceof ReasonerError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new ReasonerError(`${providerId}: ${message}`, {
    code: "reasoner/provider-http-error",
    severity: "fatal",
    cause: err,
  });
}

/**
 * Extracts JSON from `rawText` (or accepts an already-parsed `parsedValue`)
 * and validates it as an `AnalysisResult`. Never trusts a provider's own
 * claim of structured output — this is the one real enforcement point every
 * adapter funnels through.
 */
export function validateAndWrap(
  input: { rawText: string } | { parsedValue: unknown },
  capabilities: ReasonerCapabilities,
): ReasonerResult {
  let candidate: unknown;
  if ("parsedValue" in input) {
    candidate = input.parsedValue;
  } else {
    try {
      candidate = extractJsonObject(input.rawText);
    } catch (cause) {
      const raw = cause instanceof JsonExtractionError ? cause.raw : input.rawText;
      throw new ReasonerError(`${capabilities.id}: response was not valid JSON`, {
        code: "reasoner/malformed-output",
        severity: "fatal",
        hint: firstChars(raw, 400),
        cause,
      });
    }
  }

  const validation = validateAnalysisResult(candidate);
  if (!validation.valid) {
    throw new ReasonerError(`${capabilities.id}: the AnalysisResult failed schema validation`, {
      code: "reasoner/malformed-output",
      severity: "fatal",
      hint: firstLines(formatValidationReport(validation), 8),
    });
  }

  return {
    analysis: candidate as AnalysisResult,
    reasoner: { id: capabilities.id, version: capabilities.version },
  };
}

function firstLines(text: string, n: number): string {
  return text.split("\n").slice(0, n).join("\n");
}

function firstChars(text: string, n: number): string {
  return text.length > n ? `${text.slice(0, n)}…` : text;
}
