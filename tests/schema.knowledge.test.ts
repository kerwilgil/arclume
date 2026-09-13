import { describe, expect, it } from "vitest";
import { validateProjectKnowledge } from "../src/index.js";
import { loadFixture } from "./helpers/fixtures.js";

describe("ProjectKnowledge — valid fixtures", () => {
  it("accepts the minimal document", () => {
    const result = validateProjectKnowledge(loadFixture("knowledge/valid/minimal.json"));
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("accepts the rich document with no errors and no warnings", () => {
    const result = validateProjectKnowledge(loadFixture("knowledge/valid/rich.json"));
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.valid).toBe(true);
  });
});

describe("ProjectKnowledge — invalid fixtures", () => {
  it("rejects an unknown property on a nested object", () => {
    const result = validateProjectKnowledge(
      loadFixture("knowledge/invalid/additional-property.json"),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "schema/additional-properties")).toBe(true);
    const issue = result.errors.find((e) => e.code === "schema/additional-properties");
    expect(issue?.instancePath).toBe("/project");
    expect(issue?.message).toContain("colour");
  });

  it("rejects a value outside an enum", () => {
    const result = validateProjectKnowledge(loadFixture("knowledge/invalid/bad-enum.json"));
    expect(result.valid).toBe(false);
    const issue = result.errors.find((e) => e.code === "schema/enum");
    expect(issue).toBeDefined();
    expect(issue?.instancePath).toBe("/components/0/kind");
    expect(issue?.entityId).toBe("cmp");
  });

  it("requires every entity collection to be present", () => {
    const doc = loadFixture<Record<string, unknown>>("knowledge/valid/minimal.json");
    delete doc["gaps"];
    const result = validateProjectKnowledge(doc);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "schema/required")).toBe(true);
  });
});
