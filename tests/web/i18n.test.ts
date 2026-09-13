import { describe, expect, it } from "vitest";
import { en } from "../../web/src/i18n/en";
import { es } from "../../web/src/i18n/es";
import {
  DEFAULT_LOCALE,
  detectDefaultLocale,
  getCatalog,
  isLocale,
} from "../../web/src/i18n/index";

/**
 * Translation completeness: `es.ts` is already typed against `en.ts`'s exact
 * shape (see i18n/es.ts), so a missing/extra/typo'd key is normally a compile
 * error. This test is the runtime insurance policy — it catches a gap even if
 * someone bypasses the type system (an `as any`, a future refactor that loses
 * the type annotation, etc).
 */
function collectLeafPaths(value: unknown, prefix = ""): string[] {
  if (value === null || typeof value !== "object") return [prefix];
  if (typeof value === "function") return [prefix];
  const entries = Object.entries(value as Record<string, unknown>);
  const paths: string[] = [];
  for (const [key, child] of entries) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof child === "function") {
      paths.push(path);
    } else if (Array.isArray(child)) {
      // Arrays vary in per-locale wording but must have the same shape
      // (same length, and for object-array entries, the same keys).
      paths.push(`${path}[]`);
      if (child.length > 0 && typeof child[0] === "object" && child[0] !== null) {
        paths.push(...collectLeafPaths(child[0], `${path}[].0`));
      }
    } else if (child !== null && typeof child === "object") {
      paths.push(...collectLeafPaths(child, path));
    } else {
      paths.push(path);
    }
  }
  return paths;
}

describe("i18n — translation completeness", () => {
  it("en and es expose exactly the same set of keys", () => {
    const enPaths = collectLeafPaths(en).sort();
    const esPaths = collectLeafPaths(es).sort();
    expect(esPaths).toEqual(enPaths);
  });

  it("es never falls back to an identical English string for prose (spot check)", () => {
    // A handful of representative long-form strings must actually differ —
    // guards against an accidental copy-paste of the English catalog.
    expect(es.help.whatIsBody).not.toBe(en.help.whatIsBody);
    expect(es.source.description).not.toBe(en.source.description);
    expect(es.analysis.stubWarning).not.toBe(en.analysis.stubWarning);
  });

  it("array-valued entries have matching lengths", () => {
    expect(es.help.quickStartSteps.length).toBe(en.help.quickStartSteps.length);
    expect(es.help.agentWorkflowSteps.length).toBe(en.help.agentWorkflowSteps.length);
    expect(es.help.privacyBody.length).toBe(en.help.privacyBody.length);
    expect(es.help.keyTerms.length).toBe(en.help.keyTerms.length);
    expect(es.analysis.agentSteps.length).toBe(en.analysis.agentSteps.length);
  });

  it("function-valued entries produce a string in both locales", () => {
    expect(typeof en.build.builtSummary(3)).toBe("string");
    expect(typeof es.build.builtSummary(3)).toBe("string");
    expect(typeof en.export.downloadFormat("pdf")).toBe("string");
    expect(typeof es.export.downloadFormat("pdf")).toBe("string");
  });
});

describe("i18n — locale validation and detection", () => {
  it("isLocale accepts only en/es", () => {
    expect(isLocale("en")).toBe(true);
    expect(isLocale("es")).toBe(true);
    expect(isLocale("fr")).toBe(false);
    expect(isLocale("")).toBe(false);
    expect(isLocale("EN")).toBe(false);
  });

  it("getCatalog returns the matching catalog", () => {
    expect(getCatalog("en")).toBe(en);
    expect(getCatalog("es")).toBe(es);
  });

  it("detects Spanish from any es-* navigator.language", () => {
    expect(detectDefaultLocale("es")).toBe("es");
    expect(detectDefaultLocale("es-ES")).toBe("es");
    expect(detectDefaultLocale("es-PA")).toBe("es");
    expect(detectDefaultLocale("ES-mx")).toBe("es");
  });

  it("defaults to English for anything else, including undefined", () => {
    expect(detectDefaultLocale("en-US")).toBe("en");
    expect(detectDefaultLocale("fr-FR")).toBe("en");
    expect(detectDefaultLocale("pt-BR")).toBe("en");
    expect(detectDefaultLocale(undefined)).toBe("en");
    expect(detectDefaultLocale("")).toBe("en");
  });

  it("DEFAULT_LOCALE is English", () => {
    expect(DEFAULT_LOCALE).toBe("en");
  });
});

describe("i18n — never translates protocol/technical tokens", () => {
  it("fact-type tokens never appear as translatable catalog values", () => {
    const enPaths = JSON.stringify(en);
    const esPaths = JSON.stringify(es);
    // The tokens are mentioned as literal, untranslated words inside help
    // prose (by design — see #4/#19) but must never appear as a *different*
    // spelling per locale; both catalogs must reference the exact same
    // canonical spellings.
    for (const token of ["FACT", "INFERENCE", "UNKNOWN", "RECOMMENDATION"]) {
      expect(enPaths.includes(token)).toBe(esPaths.includes(token));
    }
  });
});
