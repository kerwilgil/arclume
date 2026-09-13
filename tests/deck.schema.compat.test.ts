import { describe, expect, it } from "vitest";
import { migrate, validateArclumeDeck } from "../src/index.js";
import { clone, loadFixture } from "./helpers/fixtures.js";

/**
 * Phase 4 widened the ArclumeDeck IR from 0.1.0 to 0.2.0:
 *  - slides[].keyMessage maxLength 200 → 240
 *  - provenance.narrativeRef / provenance.slidePlanRef added (optional)
 * Both changes are loosening / additive: every 0.1.0 deck stays valid.
 */

const HASH = `sha256:${"0".repeat(64)}`;

describe("ArclumeDeck 0.1.0 → 0.2.0 compatibility", () => {
  it("a committed 0.1.0 deck still validates clean under the 0.2.0 build", () => {
    for (const name of ["deck/valid/minimal.json", "deck/valid/rich.json"]) {
      const r = validateArclumeDeck(loadFixture(name));
      expect(r.errors, `${name}: ${JSON.stringify(r.errors)}`).toEqual([]);
      expect(r.valid).toBe(true);
    }
  });

  it("accepts a keyMessage between 201 and 240 chars (was rejected at 0.1.0)", () => {
    const doc = clone(loadFixture("deck/valid/minimal.json")) as {
      irVersion: string;
      slides: Array<{ keyMessage: string }>;
    };
    doc.irVersion = "0.2.0";
    if (doc.slides[1]) doc.slides[1].keyMessage = "x".repeat(230);
    const r = validateArclumeDeck(doc);
    expect(r.errors).toEqual([]);
  });

  it("still rejects a keyMessage over the new 240 cap", () => {
    const doc = clone(loadFixture("deck/valid/minimal.json")) as {
      slides: Array<{ keyMessage: string }>;
    };
    if (doc.slides[1]) doc.slides[1].keyMessage = "x".repeat(260);
    expect(validateArclumeDeck(doc).valid).toBe(false);
  });

  it("accepts the new optional provenance.narrativeRef / provenance.slidePlanRef", () => {
    const doc = clone(loadFixture("deck/valid/minimal.json")) as {
      irVersion: string;
      provenance: Record<string, unknown>;
    };
    doc.irVersion = "0.2.0";
    doc.provenance["narrativeRef"] = HASH;
    doc.provenance["slidePlanRef"] = HASH;
    const r = validateArclumeDeck(doc);
    expect(r.errors).toEqual([]);
  });

  it("migrate restamps a 0.1.0 deck to 0.2.0 without touching the payload", () => {
    const doc = loadFixture("deck/valid/rich.json");
    const result = migrate("deck", doc);
    expect(result.migrated).toBe(true);
    expect(result.appliedSteps).toEqual(["0.1.0->0.2.0"]);
    expect((result.doc as { irVersion: string }).irVersion).toBe("0.2.0");
    const { irVersion: _a, ...restBefore } = doc as Record<string, unknown>;
    const { irVersion: _b, ...restAfter } = result.doc as Record<string, unknown>;
    expect(JSON.stringify(restAfter)).toBe(JSON.stringify(restBefore));
  });
});
