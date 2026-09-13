import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  contentHash,
  deriveId,
  deriveReadableId,
  slugify,
  stableStringify,
  validateArclumeDeck,
  validateProjectKnowledge,
} from "../src/index.js";
import { loadFixture } from "./helpers/fixtures.js";

const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (extname(full) === ".ts") out.push(full);
  }
  return out;
}

describe("stableStringify", () => {
  it("is independent of key insertion order", () => {
    const a = stableStringify({ b: 1, a: [{ y: 2, x: 1 }], c: { n: null } });
    const b = stableStringify({ c: { n: null }, a: [{ x: 1, y: 2 }], b: 1 });
    expect(a).toBe(b);
  });

  it("preserves array order", () => {
    expect(stableStringify([3, 1, 2])).toBe("[3,1,2]");
  });

  it("drops undefined members like JSON.stringify", () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it("throws on non-finite numbers and circular references", () => {
    expect(() => stableStringify({ x: Number.NaN })).toThrow();
    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;
    expect(() => stableStringify(cyclic)).toThrow(/circular/);
  });
});

describe("contentHash", () => {
  it("is stable across key order and runs", () => {
    const h1 = contentHash({ z: 1, a: 2 });
    const h2 = contentHash({ a: 2, z: 1 });
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

describe("id derivation is deterministic", () => {
  it("deriveId depends only on its inputs", () => {
    expect(deriveId("component", "Approval API")).toBe(deriveId("component", "Approval API"));
    expect(deriveId("component", "Approval API")).not.toBe(
      deriveId("component", "Approver Console"),
    );
  });

  it("slugify is stable and strips diacritics", () => {
    expect(slugify("Análisis de Diseño")).toBe("analisis-de-diseno");
    expect(slugify("  ")).toBe("x");
  });

  it("deriveReadableId avoids collisions deterministically", () => {
    const taken = new Set<string>(["approval-api"]);
    const a = deriveReadableId("Approval API", taken);
    const b = deriveReadableId("Approval API", taken);
    expect(a).toBe(b);
    expect(a).not.toBe("approval-api");
  });
});

describe("validation output is deterministic", () => {
  it("returns identical results across repeated runs", () => {
    const deck = loadFixture("deck/invalid/unknown-refs.json");
    expect(JSON.stringify(validateArclumeDeck(deck))).toBe(
      JSON.stringify(validateArclumeDeck(deck)),
    );
    const knowledge = loadFixture("knowledge/valid/rich.json");
    expect(JSON.stringify(validateProjectKnowledge(knowledge))).toBe(
      JSON.stringify(validateProjectKnowledge(knowledge)),
    );
  });
});

describe("the Core contains no nondeterministic primitives", () => {
  const forbidden: Array<[RegExp, string]> = [
    [/\bMath\.random\s*\(/, "Math.random()"],
    [/\bDate\.now\s*\(/, "Date.now()"],
    [/\bnew\s+Date\s*\(\s*\)/, "new Date()"],
    [/\bcrypto\.randomUUID\s*\(/, "crypto.randomUUID()"],
    [/\bprocess\.hrtime\b/, "process.hrtime"],
    [/\bperformance\.now\s*\(/, "performance.now()"],
  ];

  it("no src file references a clock or RNG", () => {
    const offenders: string[] = [];
    for (const file of walk(srcDir)) {
      const text = readFileSync(file, "utf8");
      for (const [re, label] of forbidden) {
        if (re.test(text)) offenders.push(`${file}: ${label}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
