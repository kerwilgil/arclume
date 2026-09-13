import { describe, expect, it } from "vitest";
import {
  formatValidationReport,
  validateArclumeDeck,
  validateProjectKnowledge,
} from "../src/index.js";
import { clone, loadFixture } from "./helpers/fixtures.js";

describe("error formatting adds context beyond raw AJV output", () => {
  it("includes code, readable message, instancePath and nearest entity id", () => {
    const doc = clone(loadFixture("knowledge/valid/rich.json")) as {
      components: Array<Record<string, unknown>>;
    };
    const cmp = doc.components[0];
    if (cmp) cmp["kind"] = "not-a-kind";
    const result = validateProjectKnowledge(doc as unknown);
    const issue = result.errors.find((e) => e.instancePath === "/components/0/kind");
    expect(issue).toBeDefined();
    expect(issue?.code).toBe("schema/enum");
    expect(issue?.entityKind).toBe("component");
    expect(issue?.entityId).toBe("cmp-api");
    expect(issue?.label).toBe("Approval API");
    expect(issue?.message).toMatch(/allowed values/);
  });

  it("names the offending additional property and gives a hint", () => {
    const doc = clone(loadFixture("deck/valid/minimal.json")) as Record<string, unknown>;
    doc["mystery"] = 1;
    const result = validateArclumeDeck(doc);
    const issue = result.errors.find((e) => e.code === "schema/additional-properties");
    expect(issue?.message).toContain("mystery");
    expect(issue?.hint).toBeTruthy();
  });

  it("reports a missing required property with its name", () => {
    const doc = clone(loadFixture("deck/valid/minimal.json")) as {
      meta: Record<string, unknown>;
    };
    delete doc.meta["title"];
    const result = validateArclumeDeck(doc as unknown);
    const issue = result.errors.find((e) => e.code === "schema/required");
    expect(issue?.message).toContain("title");
    expect(issue?.instancePath).toBe("/meta");
  });

  it("produces a stable, sorted, human-readable report", () => {
    const result = validateArclumeDeck(loadFixture("deck/invalid/unknown-refs.json"));
    const report = formatValidationReport(result);
    expect(report.startsWith("INVALID")).toBe(true);
    expect(report).toContain("error(s):");
    // deterministic: same input, same report
    expect(
      formatValidationReport(validateArclumeDeck(loadFixture("deck/invalid/unknown-refs.json"))),
    ).toBe(report);
  });

  it("orders issues by instancePath then severity", () => {
    const result = validateArclumeDeck(loadFixture("deck/invalid/semantic-issues.json"));
    const paths = result.errors.map((e) => e.instancePath);
    const sorted = [...paths].sort();
    expect(paths).toEqual(sorted);
  });
});
