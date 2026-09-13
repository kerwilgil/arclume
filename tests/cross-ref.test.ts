import { describe, expect, it } from "vitest";
import { validateArclumeDeck, validateProjectKnowledge } from "../src/index.js";
import { clone, loadFixture } from "./helpers/fixtures.js";

describe("ProjectKnowledge cross-references", () => {
  it("flags duplicate ids across collections", () => {
    const result = validateProjectKnowledge(loadFixture("knowledge/invalid/duplicate-id.json"));
    const dups = result.errors.filter((e) => e.code === "cross-ref/duplicate-id");
    expect(dups.length).toBeGreaterThanOrEqual(2);
    expect(dups.every((e) => typeof e.message === "string")).toBe(true);
  });

  it("flags a sourceRef pointing to an unknown source", () => {
    const result = validateProjectKnowledge(loadFixture("knowledge/invalid/unknown-source.json"));
    const issue = result.errors.find((e) => e.code === "cross-ref/unknown-source");
    expect(issue).toBeDefined();
    expect(issue?.instancePath).toBe("/project/sourceRefs/0");
  });

  it("flags a relation endpoint that is not an entity", () => {
    const doc = clone(loadFixture("knowledge/valid/rich.json")) as {
      relations: Array<{ from: string; to: string }>;
    };
    const rel = doc.relations[0];
    if (rel) rel.to = "nope";
    const result = validateProjectKnowledge(doc as unknown);
    expect(result.errors.some((e) => e.code === "cross-ref/unknown-relation-endpoint")).toBe(true);
  });

  it("flags milestone.phaseId / result.metricId / component.technologies dangling refs", () => {
    const doc = clone(loadFixture("knowledge/valid/rich.json")) as {
      milestones: Array<{ phaseId?: string }>;
      results: Array<{ metricId?: string }>;
      components: Array<{ technologies?: string[] }>;
    };
    if (doc.milestones[0]) doc.milestones[0].phaseId = "ghost";
    if (doc.results[0]) doc.results[0].metricId = "ghost";
    if (doc.components[0]) doc.components[0].technologies = ["ghost"];
    const result = validateProjectKnowledge(doc as unknown);
    const targets = result.errors.filter((e) => e.code === "cross-ref/unknown-target");
    expect(targets.length).toBe(3);
  });

  it("accepts the rich fixture's internal references", () => {
    const result = validateProjectKnowledge(loadFixture("knowledge/valid/rich.json"));
    expect(result.errors).toEqual([]);
  });
});

describe("claim.supports domain", () => {
  type KDoc = {
    claims: Array<{ id: string; supports?: string[] }>;
  };

  function withSupports(target: string): unknown {
    const doc = clone(loadFixture("knowledge/valid/rich.json")) as KDoc;
    const claim = doc.claims[0];
    if (claim) claim.supports = [target];
    return doc;
  }

  function hasSupportsError(result: ReturnType<typeof validateProjectKnowledge>): boolean {
    return result.errors.some(
      (e) =>
        e.code === "cross-ref/unknown-target" && e.instancePath.startsWith("/claims/0/supports/"),
    );
  }

  it("accepts a domain entity as a supports target", () => {
    expect(hasSupportsError(validateProjectKnowledge(withSupports("cmp-api")))).toBe(false);
  });

  it("accepts another claim as a supports target", () => {
    expect(hasSupportsError(validateProjectKnowledge(withSupports("clm-scale")))).toBe(false);
  });

  it("accepts the project id as a supports target", () => {
    expect(hasSupportsError(validateProjectKnowledge(withSupports("orderflow")))).toBe(false);
  });

  it("rejects a source id", () => {
    expect(hasSupportsError(validateProjectKnowledge(withSupports("brief")))).toBe(true);
  });

  it("rejects a relation id", () => {
    expect(hasSupportsError(validateProjectKnowledge(withSupports("rel-ui-api")))).toBe(true);
  });

  it("rejects a gap id", () => {
    expect(hasSupportsError(validateProjectKnowledge(withSupports("gap-sso")))).toBe(true);
  });

  it("rejects an unknown id", () => {
    expect(hasSupportsError(validateProjectKnowledge(withSupports("nope")))).toBe(true);
  });
});

describe("ArclumeDeck cross-references", () => {
  it("flags a slide.index that does not match its position", () => {
    const result = validateArclumeDeck(loadFixture("deck/invalid/slide-index-mismatch.json"));
    const issue = result.errors.find((e) => e.code === "deck/slide-index-mismatch");
    expect(issue).toBeDefined();
    expect(issue?.instancePath).toBe("/slides/1/index");
  });

  it("flags unknown section, diagram and source references", () => {
    const result = validateArclumeDeck(loadFixture("deck/invalid/unknown-refs.json"));
    const codes = new Set(result.errors.map((e) => e.code));
    expect(codes.has("cross-ref/unknown-section")).toBe(true);
    expect(codes.has("cross-ref/unknown-diagram")).toBe(true);
    expect(codes.has("cross-ref/unknown-source")).toBe(true);
  });

  it("flags a table whose rows do not match the column count", () => {
    const result = validateArclumeDeck(loadFixture("deck/invalid/semantic-issues.json"));
    const issue = result.errors.find((e) => e.code === "block/table-row-arity");
    expect(issue).toBeDefined();
    expect(issue?.instancePath).toBe("/slides/0/blocks/0/rows/1");
  });

  it("warns when an architecture block points at a non-architecture diagram", () => {
    const doc = clone(loadFixture("deck/valid/rich.json")) as {
      diagrams: Array<{ diagramType: string }>;
    };
    if (doc.diagrams[0]) doc.diagrams[0].diagramType = "timeline";
    const result = validateArclumeDeck(doc as unknown);
    expect(result.warnings.some((w) => w.code === "block/diagram-type-mismatch")).toBe(true);
    expect(result.valid).toBe(true);
  });

  it("warns on a non-cover slide with no blocks", () => {
    const doc = clone(loadFixture("deck/valid/minimal.json")) as {
      slides: Array<{ blocks: unknown[] }>;
    };
    if (doc.slides[1]) doc.slides[1].blocks = [];
    const result = validateArclumeDeck(doc as unknown);
    expect(result.warnings.some((w) => w.code === "deck/empty-slide")).toBe(true);
  });
});
