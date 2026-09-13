import { describe, expect, it } from "vitest";
import { validateArclumeDeck, validateProjectKnowledge } from "../src/index.js";
import { clone, loadFixture } from "./helpers/fixtures.js";

describe("claims never become FACT without evidence", () => {
  it("errors on a schema-valid FACT claim with no sourceRefs", () => {
    const result = validateProjectKnowledge(
      loadFixture("knowledge/invalid/fact-without-evidence.json"),
    );
    const issue = result.errors.find((e) => e.code === "claim/fact-without-evidence");
    expect(issue).toBeDefined();
    expect(issue?.instancePath).toBe("/claims/0");
    expect(result.valid).toBe(false);
  });

  it("errors on a FACT claim whose only sourceRef points to an unknown source", () => {
    const doc = clone(loadFixture("knowledge/valid/rich.json")) as {
      claims: Array<{ factType: string; sourceRefs: Array<{ sourceId: string }> }>;
    };
    const claim = doc.claims[0];
    if (claim) claim.sourceRefs = [{ sourceId: "ghost" }];
    const result = validateProjectKnowledge(doc as unknown);
    expect(result.errors.some((e) => e.code === "claim/fact-without-evidence")).toBe(true);
  });

  it("accepts a FACT claim with a resolvable sourceRef", () => {
    const result = validateProjectKnowledge(loadFixture("knowledge/valid/rich.json"));
    expect(result.errors.some((e) => e.code === "claim/fact-without-evidence")).toBe(false);
  });

  it("applies the same rule to risks classified as FACT", () => {
    const doc = clone(loadFixture("knowledge/valid/rich.json")) as {
      risks: Array<{ factType: string; sourceRefs: unknown[] }>;
    };
    const risk = doc.risks[0];
    if (risk) {
      risk.factType = "FACT";
      risk.sourceRefs = [];
    }
    const result = validateProjectKnowledge(doc as unknown);
    const issue = result.errors.find((e) => e.code === "claim/fact-without-evidence");
    expect(issue?.instancePath).toBe("/risks/0");
  });

  it("warns (not errors) on an INFERENCE claim with no sourceRefs", () => {
    const doc = clone(loadFixture("knowledge/valid/rich.json")) as {
      claims: Array<{ factType: string; sourceRefs: unknown[] }>;
    };
    const claim = doc.claims[1];
    if (claim) claim.sourceRefs = [];
    const result = validateProjectKnowledge(doc as unknown);
    expect(result.warnings.some((w) => w.code === "claim/inference-without-basis")).toBe(true);
    expect(result.errors.some((e) => e.code === "claim/inference-without-basis")).toBe(false);
  });

  it("errors on deck evidence classified as FACT with no resolvable source", () => {
    const result = validateArclumeDeck(loadFixture("deck/invalid/semantic-issues.json"));
    expect(result.errors.some((e) => e.code === "evidence/fact-without-evidence")).toBe(true);
  });

  it("accepts all four factType values in a schema-valid document", () => {
    const doc = clone(loadFixture("knowledge/valid/rich.json")) as {
      sources: Array<{ id: string }>;
      claims: Array<Record<string, unknown>>;
    };
    doc.claims = [
      { id: "c-fact", statement: "backed", factType: "FACT", sourceRefs: [{ sourceId: "brief" }] },
      {
        id: "c-inf",
        statement: "reasoned",
        factType: "INFERENCE",
        sourceRefs: [{ sourceId: "brief" }],
      },
      { id: "c-unk", statement: "open question", factType: "UNKNOWN", sourceRefs: [] },
      { id: "c-rec", statement: "should do X", factType: "RECOMMENDATION", sourceRefs: [] },
    ];
    const result = validateProjectKnowledge(doc as unknown);
    expect(result.errors).toEqual([]);
  });
});
