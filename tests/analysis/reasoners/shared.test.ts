import { describe, expect, it } from "vitest";
import {
  ProviderError,
  definedFields,
  toReasonerError,
  validateAndWrap,
} from "../../../src/analysis/reasoners/shared.js";
import { ReasonerError } from "../../../src/errors.js";
import { sampleAnalysisResult } from "../../helpers/reasoner-fixtures.js";
import { invalidAnalysisResultJson } from "../../helpers/reasoner-fixtures.js";

const CAPS = { id: "test-provider", version: "0.1.0", deterministic: false, network: true };

describe("validateAndWrap", () => {
  it("accepts a valid AnalysisResult given as raw text", () => {
    const analysis = sampleAnalysisResult();
    const result = validateAndWrap({ rawText: JSON.stringify(analysis) }, CAPS);
    expect(result.analysis).toEqual(analysis);
    expect(result.reasoner).toEqual({ id: "test-provider", version: "0.1.0" });
  });

  it("accepts a valid AnalysisResult given as an already-parsed value", () => {
    const analysis = sampleAnalysisResult();
    const result = validateAndWrap({ parsedValue: analysis }, CAPS);
    expect(result.analysis).toEqual(analysis);
  });

  it("extracts JSON from a markdown-fenced response before validating", () => {
    const analysis = sampleAnalysisResult();
    const wrapped = `\`\`\`json\n${JSON.stringify(analysis)}\n\`\`\``;
    const result = validateAndWrap({ rawText: wrapped }, CAPS);
    expect(result.analysis).toEqual(analysis);
  });

  it("throws reasoner/malformed-output for text with no recoverable JSON", () => {
    try {
      validateAndWrap({ rawText: "I cannot comply." }, CAPS);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ReasonerError);
      expect((err as ReasonerError).code).toBe("reasoner/malformed-output");
    }
  });

  it("throws reasoner/malformed-output for syntactically valid JSON that fails the schema", () => {
    try {
      validateAndWrap({ rawText: invalidAnalysisResultJson() }, CAPS);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ReasonerError);
      expect((err as ReasonerError).code).toBe("reasoner/malformed-output");
    }
  });

  it("throws reasoner/malformed-output for an already-parsed value that fails the schema", () => {
    expect(() => validateAndWrap({ parsedValue: { nope: true } }, CAPS)).toThrow(ReasonerError);
  });

  it("never trusts a provider's own JSON-mode claim — always re-validates", () => {
    // a bare array is valid JSON syntax but never a valid AnalysisResult
    expect(() => validateAndWrap({ rawText: "[1,2,3]" }, CAPS)).toThrow(ReasonerError);
  });
});

describe("toReasonerError", () => {
  it("maps each ProviderFailureKind to a distinct, stable error code", () => {
    const cases: Array<[ConstructorParameters<typeof ProviderError>[1], string]> = [
      ["unavailable", "reasoner/provider-unavailable"],
      ["timeout", "reasoner/provider-timeout"],
      ["auth", "reasoner/provider-auth-failed"],
      ["not-installed", "reasoner/provider-not-installed"],
      ["invalid-base-url", "reasoner/provider-invalid-base-url"],
      ["model-unavailable", "reasoner/provider-model-unavailable"],
      ["http-error", "reasoner/provider-http-error"],
      ["malformed-response", "reasoner/provider-malformed-response"],
    ];
    for (const [kind, code] of cases) {
      const err = toReasonerError(new ProviderError("boom", kind, "test"), "test");
      expect(err.code).toBe(code);
    }
  });

  it("passes an existing ReasonerError through unchanged", () => {
    const original = new ReasonerError("already structured", {
      code: "reasoner/custom",
      severity: "fatal",
    });
    expect(toReasonerError(original, "test")).toBe(original);
  });

  it("wraps any other thrown value as reasoner/provider-http-error", () => {
    const err = toReasonerError(new Error("network exploded"), "test");
    expect(err.code).toBe("reasoner/provider-http-error");
    expect(err.message).toContain("network exploded");
  });
});

describe("definedFields", () => {
  it("drops undefined-valued keys and keeps defined ones", () => {
    expect(definedFields({ a: 1, b: undefined, c: "x" })).toEqual({ a: 1, c: "x" });
  });

  it("keeps a falsy-but-defined value (0, empty string, false)", () => {
    expect(definedFields({ a: 0, b: "", c: false })).toEqual({ a: 0, b: "", c: false });
  });

  it("returns an empty object when every field is undefined", () => {
    expect(definedFields({ a: undefined, b: undefined })).toEqual({});
  });
});
