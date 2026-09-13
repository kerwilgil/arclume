import { describe, expect, it } from "vitest";
import { DEFAULT_APPEARANCE, isAppearance, resolveEffectiveTheme } from "../../web/src/theme/index";

describe("theme — resolveEffectiveTheme (pure)", () => {
  it("explicit light always wins, regardless of the OS preference", () => {
    expect(resolveEffectiveTheme("light", true)).toBe("light");
    expect(resolveEffectiveTheme("light", false)).toBe("light");
  });

  it("explicit dark always wins, regardless of the OS preference", () => {
    expect(resolveEffectiveTheme("dark", true)).toBe("dark");
    expect(resolveEffectiveTheme("dark", false)).toBe("dark");
  });

  it("system follows the OS preference", () => {
    expect(resolveEffectiveTheme("system", true)).toBe("dark");
    expect(resolveEffectiveTheme("system", false)).toBe("light");
  });
});

describe("theme — isAppearance", () => {
  it("accepts system/light/dark", () => {
    expect(isAppearance("system")).toBe(true);
    expect(isAppearance("light")).toBe(true);
    expect(isAppearance("dark")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isAppearance("Dark")).toBe(false);
    expect(isAppearance("auto")).toBe(false);
    expect(isAppearance("")).toBe(false);
  });
});

describe("theme — defaults", () => {
  it("defaults to system", () => {
    expect(DEFAULT_APPEARANCE).toBe("system");
  });
});
