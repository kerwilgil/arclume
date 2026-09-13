// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  readPreference,
  readValidatedPreference,
  writePreference,
} from "../../web/src/preferences";

describe("preferences — storage-safe read/write", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("round-trips a value written and read back", () => {
    writePreference("locale", "es");
    expect(readPreference("locale")).toBe("es");
  });

  it("uses the versioned arclume.ui.* key prefix", () => {
    writePreference("locale", "es");
    expect(window.localStorage.getItem("arclume.ui.locale")).toBe("es");
  });

  it("returns undefined for a key that was never set", () => {
    expect(readPreference("nonexistent")).toBeUndefined();
  });

  it("readValidatedPreference accepts a value the validator approves", () => {
    writePreference("appearance", "dark");
    const isDarkOrLight = (v: string): v is "dark" | "light" => v === "dark" || v === "light";
    expect(readValidatedPreference("appearance", isDarkOrLight)).toBe("dark");
  });

  it("readValidatedPreference falls back to undefined for a corrupted value", () => {
    window.localStorage.setItem("arclume.ui.appearance", "not-a-real-value-🙃");
    const isDarkOrLight = (v: string): v is "dark" | "light" => v === "dark" || v === "light";
    expect(readValidatedPreference("appearance", isDarkOrLight)).toBeUndefined();
  });

  it("readValidatedPreference falls back to undefined when unset", () => {
    const isDarkOrLight = (v: string): v is "dark" | "light" => v === "dark" || v === "light";
    expect(readValidatedPreference("appearance", isDarkOrLight)).toBeUndefined();
  });

  it("never throws when localStorage.getItem throws (SecurityError-like failure)", () => {
    const original = window.localStorage.getItem;
    window.localStorage.getItem = () => {
      throw new DOMException("blocked", "SecurityError");
    };
    try {
      expect(() => readPreference("locale")).not.toThrow();
      expect(readPreference("locale")).toBeUndefined();
    } finally {
      window.localStorage.getItem = original;
    }
  });

  it("never throws when localStorage.setItem throws (quota exceeded)", () => {
    const original = window.localStorage.setItem;
    window.localStorage.setItem = () => {
      throw new DOMException("quota exceeded", "QuotaExceededError");
    };
    try {
      expect(() => writePreference("locale", "es")).not.toThrow();
    } finally {
      window.localStorage.setItem = original;
    }
  });
});
