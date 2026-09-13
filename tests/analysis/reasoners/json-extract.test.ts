import { describe, expect, it } from "vitest";
import {
  JsonExtractionError,
  extractJsonObject,
} from "../../../src/analysis/reasoners/json-extract.js";

describe("extractJsonObject", () => {
  it("parses a bare JSON object", () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 });
  });

  it("extracts JSON from a fenced ```json code block", () => {
    const text = 'Here you go:\n```json\n{"a":1}\n```\nThanks!';
    expect(extractJsonObject(text)).toEqual({ a: 1 });
  });

  it("extracts JSON from a fenced code block with no language tag", () => {
    const text = '```\n{"a":1}\n```';
    expect(extractJsonObject(text)).toEqual({ a: 1 });
  });

  it("falls back to the outermost {...} slice around stray prose", () => {
    const text = 'Sure, here is the analysis: {"a":1} — let me know if you need more.';
    expect(extractJsonObject(text)).toEqual({ a: 1 });
  });

  it("handles nested braces inside the outermost slice", () => {
    const text = 'prefix {"a":{"b":2}} suffix';
    expect(extractJsonObject(text)).toEqual({ a: { b: 2 } });
  });

  it("rejects a bare JSON array (an AnalysisResult is always an object)", () => {
    expect(() => extractJsonObject("[1,2,3]")).toThrow(JsonExtractionError);
  });

  it("rejects an empty response", () => {
    expect(() => extractJsonObject("")).toThrow(JsonExtractionError);
    expect(() => extractJsonObject("   ")).toThrow(JsonExtractionError);
  });

  it("rejects truncated JSON", () => {
    expect(() => extractJsonObject('{"a": {"b": 1')).toThrow(JsonExtractionError);
  });

  it("rejects prose with no JSON at all", () => {
    expect(() => extractJsonObject("I cannot help with that request.")).toThrow(
      JsonExtractionError,
    );
  });

  it("preserves the raw text on the thrown error for diagnostics", () => {
    try {
      extractJsonObject("not json");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(JsonExtractionError);
      expect((err as JsonExtractionError).raw).toBe("not json");
    }
  });
});
