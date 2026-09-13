import { describe, expect, it } from "vitest";
import { validateArclumeDeck, validateProjectKnowledge } from "../src/index.js";
import { clone, loadFixture } from "./helpers/fixtures.js";

const knowledge = () => loadFixture("knowledge/valid/rich.json");
const deck = () => loadFixture("deck/valid/rich.json");

describe("additionalProperties: false is enforced at every level", () => {
  it("rejects an unknown key at the knowledge root", () => {
    const doc = clone(knowledge()) as Record<string, unknown>;
    doc["extra"] = true;
    const result = validateProjectKnowledge(doc);
    expect(result.errors.some((e) => e.code === "schema/additional-properties")).toBe(true);
  });

  it("rejects an unknown key inside a knowledge relation", () => {
    const doc = clone(knowledge()) as { relations: Array<Record<string, unknown>> };
    (doc.relations[0] as Record<string, unknown>)["weight"] = 3;
    const result = validateProjectKnowledge(doc);
    const issue = result.errors.find((e) => e.code === "schema/additional-properties");
    expect(issue?.instancePath).toBe("/relations/0");
  });

  it("rejects an unknown key inside a locator", () => {
    const doc = clone(knowledge()) as {
      project: { sourceRefs: unknown[] };
    };
    doc.project.sourceRefs[0] = { sourceId: "brief", locator: { kind: "page", page: 1, zoom: 2 } };
    const result = validateProjectKnowledge(doc as unknown);
    expect(result.errors.some((e) => e.code === "schema/additional-properties")).toBe(true);
  });

  it("rejects an unknown key at the deck root", () => {
    const doc = clone(deck()) as Record<string, unknown>;
    doc["footer"] = "x";
    const result = validateArclumeDeck(doc);
    expect(result.errors.some((e) => e.code === "schema/additional-properties")).toBe(true);
  });

  it("rejects an unknown key inside slide.checks", () => {
    const doc = clone(deck()) as { slides: Array<{ checks: Record<string, unknown> }> };
    const first = doc.slides[0];
    if (first) first.checks["score"] = 9;
    const result = validateArclumeDeck(doc as unknown);
    const issue = result.errors.find((e) => e.code === "schema/additional-properties");
    expect(issue?.instancePath).toBe("/slides/0/checks");
  });

  it("rejects an unknown key inside a diagram-family block", () => {
    const doc = clone(deck()) as {
      slides: Array<{ blocks: Array<Record<string, unknown>> }>;
    };
    const archBlock = doc.slides[1]?.blocks[0];
    if (archBlock) archBlock["zoom"] = 1.5;
    const result = validateArclumeDeck(doc as unknown);
    expect(result.errors.some((e) => e.code === "schema/additional-properties")).toBe(true);
  });
});
