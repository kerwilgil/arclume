import { describe, expect, it } from "vitest";
import { validateArclumeDeck } from "../src/index.js";
import { loadFixture } from "./helpers/fixtures.js";

describe("ArclumeDeck — valid fixtures", () => {
  it("accepts the minimal deck", () => {
    const result = validateArclumeDeck(loadFixture("deck/valid/minimal.json"));
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("accepts the rich deck with no errors", () => {
    const result = validateArclumeDeck(loadFixture("deck/valid/rich.json"));
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });
});

describe("ArclumeDeck — invalid fixtures", () => {
  it("rejects an unknown property on a block", () => {
    const result = validateArclumeDeck(loadFixture("deck/invalid/additional-property.json"));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "schema/additional-properties")).toBe(true);
  });

  it("rejects a block that matches no variant", () => {
    const result = validateArclumeDeck(loadFixture("deck/invalid/bad-block.json"));
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) => e.code === "schema/one-of" || e.code === "schema/required"),
    ).toBe(true);
    const anyBlockIssue = result.errors.find((e) =>
      e.instancePath.startsWith("/slides/0/blocks/0"),
    );
    expect(anyBlockIssue).toBeDefined();
  });

  it("requires slide.checks", () => {
    const doc = loadFixture<{ slides: Array<Record<string, unknown>> }>("deck/valid/minimal.json");
    const slide = doc.slides[0];
    if (slide) delete slide["checks"];
    const result = validateArclumeDeck(doc);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) => e.code === "schema/required" && e.instancePath === "/slides/0"),
    ).toBe(true);
  });

  it("requires slide.keyMessage", () => {
    const doc = loadFixture<{ slides: Array<Record<string, unknown>> }>("deck/valid/minimal.json");
    const slide = doc.slides[1];
    if (slide) delete slide["keyMessage"];
    const result = validateArclumeDeck(doc);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "schema/required")).toBe(true);
  });
});
