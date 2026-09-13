import { describe, expect, it } from "vitest";
import {
  IR_VERSION,
  KNOWLEDGE_VERSION,
  checkCompatibility,
  migrate,
  parseSemVer,
  validateArclumeDeck,
  validateProjectKnowledge,
} from "../src/index.js";
import { clone, loadFixture } from "./helpers/fixtures.js";

describe("parseSemVer", () => {
  it("parses a core version", () => {
    expect(parseSemVer("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 });
  });
  it("parses a pre-release", () => {
    expect(parseSemVer("0.1.0-rc.1")).toEqual({
      major: 0,
      minor: 1,
      patch: 0,
      prerelease: "rc.1",
    });
  });
  it("rejects malformed input", () => {
    expect(parseSemVer("1.2")).toBeUndefined();
    expect(parseSemVer("v1.2.3")).toBeUndefined();
    expect(parseSemVer("1.2.3.4")).toBeUndefined();
  });
});

describe("checkCompatibility", () => {
  it("is compatible with the same version", () => {
    expect(checkCompatibility("0.1.0", "0.1.0").level).toBe("compatible");
  });
  it("is compatible with a lower minor", () => {
    expect(checkCompatibility("1.0.0", "1.4.0").level).toBe("compatible");
  });
  it("flags a newer minor as a warning-level mismatch", () => {
    expect(checkCompatibility("1.9.0", "1.2.0").level).toBe("newer-minor");
  });
  it("flags a different major as incompatible", () => {
    expect(checkCompatibility("2.0.0", "1.0.0").level).toBe("incompatible");
  });
  it("flags malformed input as incompatible", () => {
    expect(checkCompatibility("nope", "1.0.0").level).toBe("incompatible");
  });
});

describe("validators react to declared version", () => {
  it("errors on an incompatible major for a deck", () => {
    const doc = clone(loadFixture("deck/valid/minimal.json")) as { irVersion: string };
    doc.irVersion = "9.0.0";
    const result = validateArclumeDeck(doc);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "version/incompatible")).toBe(true);
  });

  it("warns on a newer minor for knowledge but stays valid", () => {
    const doc = clone(loadFixture("knowledge/valid/minimal.json")) as {
      knowledgeVersion: string;
    };
    const s = parseSemVer(KNOWLEDGE_VERSION);
    doc.knowledgeVersion = `${s?.major}.${(s?.minor ?? 0) + 5}.0`;
    const result = validateProjectKnowledge(doc);
    expect(result.warnings.some((w) => w.code === "version/newer-minor")).toBe(true);
    expect(result.valid).toBe(true);
  });

  it("current constants: deck IR at 0.2.0 (Phase 4), knowledge at 0.1.0", () => {
    expect(IR_VERSION).toBe("0.2.0");
    expect(KNOWLEDGE_VERSION).toBe("0.1.0");
  });

  it("a 0.1.0 deck still validates clean under the 0.2.0 build (loosening only)", () => {
    const result = validateArclumeDeck(loadFixture("deck/valid/minimal.json"));
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });
});

describe("migrate skeleton", () => {
  it("is a no-op when already at the target version", () => {
    const doc = { ...(loadFixture("deck/valid/minimal.json") as object), irVersion: IR_VERSION };
    const result = migrate("deck", doc);
    expect(result.migrated).toBe(false);
    expect(result.appliedSteps).toEqual([]);
    expect(result.doc).toBe(doc);
  });

  it("restamps a 0.1.0 deck to the current IR version (0.1.0 -> 0.2.0)", () => {
    const doc = loadFixture("deck/valid/minimal.json");
    const result = migrate("deck", doc);
    expect(result.migrated).toBe(true);
    expect(result.appliedSteps).toEqual(["0.1.0->0.2.0"]);
    expect((result.doc as { irVersion: string }).irVersion).toBe("0.2.0");
    // the payload is otherwise untouched
    expect(validateArclumeDeck(result.doc).valid).toBe(true);
  });

  it("throws when no step path exists to the target", () => {
    const doc = clone(loadFixture("deck/valid/minimal.json")) as { irVersion: string };
    doc.irVersion = "0.0.1";
    expect(() => migrate("deck", doc, "0.1.0")).toThrow(/no migration step/);
  });

  it("throws when the document has no version", () => {
    expect(() => migrate("knowledge", {})).toThrow(/no version/);
  });
});
