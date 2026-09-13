import { describe, expect, it } from "vitest";
import { resolveSecret } from "../../src/config/secret-precedence.js";

describe("resolveSecret", () => {
  it("prefers an explicit process environment variable over the stored value", () => {
    const stored = new Map([["OPENAI_API_KEY", "sk-stored"]]);
    const resolved = resolveSecret("OPENAI_API_KEY", stored, { OPENAI_API_KEY: "sk-env" });
    expect(resolved).toEqual({ value: "sk-env", source: "environment" });
  });

  it("falls back to the stored secret when no environment variable is set", () => {
    const stored = new Map([["OPENAI_API_KEY", "sk-stored"]]);
    const resolved = resolveSecret("OPENAI_API_KEY", stored, {});
    expect(resolved).toEqual({ value: "sk-stored", source: "stored" });
  });

  it("treats an empty-string environment variable as unset, not as a real value", () => {
    const stored = new Map([["OPENAI_API_KEY", "sk-stored"]]);
    const resolved = resolveSecret("OPENAI_API_KEY", stored, { OPENAI_API_KEY: "" });
    expect(resolved).toEqual({ value: "sk-stored", source: "stored" });
  });

  it("returns undefined when neither source has a value", () => {
    expect(resolveSecret("OPENAI_API_KEY", new Map(), {})).toBeUndefined();
  });

  it("treats an empty-string stored value as absent too", () => {
    const stored = new Map([["OPENAI_API_KEY", ""]]);
    expect(resolveSecret("OPENAI_API_KEY", stored, {})).toBeUndefined();
  });
});
