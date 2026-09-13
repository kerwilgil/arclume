import { describe, expect, it } from "vitest";
import {
  type AnalysisResult,
  type EntityCandidate,
  buildProjectKnowledge,
  contentHash,
  dedupeEntities,
  firstToken,
  normalizeName,
  stableStringify,
  validateProjectKnowledge,
} from "../src/index.js";
import { fakeIngestion } from "./helpers/fake-ingestion.js";

function analysisWith(over: Partial<AnalysisResult>): AnalysisResult {
  return {
    analysisVersion: "0.1.0",
    project: { name: "Demo", evidence: [{ documentId: "doc-x" }] },
    entities: [],
    relations: [],
    claims: [],
    gaps: [],
    ...over,
  };
}

function build(analysis: AnalysisResult) {
  return buildProjectKnowledge({
    analysis,
    ...fakeIngestion(),
    sourceDigest: "sha256:x",
  });
}

describe("dedupe primitives", () => {
  it("normalizes case and whitespace", () => {
    expect(normalizeName("  React   Native ")).toBe("react native");
    expect(firstToken("React.js")).toBe("react");
  });

  it("merges only exact normalized-name matches", () => {
    const cands: EntityCandidate[] = [
      { kind: "technology", name: "React", evidence: [] },
      { kind: "technology", name: "react", evidence: [] },
      { kind: "technology", name: "React.js", evidence: [] },
    ];
    const { groups, nearDuplicates } = dedupeEntities(cands);
    expect(groups.length).toBe(2); // React/react merge; React.js separate
    expect(nearDuplicates.some((n) => n.sharedToken === "react")).toBe(true);
  });
});

describe("KnowledgeBuilder", () => {
  it("is deterministic given the same analysis", () => {
    const analysis = analysisWith({
      entities: [
        {
          kind: "technology",
          name: "TypeScript",
          key: "technology:typescript",
          evidence: [{ documentId: "doc-x" }],
        },
        {
          kind: "component",
          name: "Core",
          key: "component:core",
          evidence: [{ documentId: "doc-x" }],
        },
      ],
      relations: [
        {
          fromKey: "component:core",
          toKey: "project",
          type: "PART_OF",
          evidence: [{ documentId: "doc-x" }],
        },
      ],
      claims: [
        {
          statement: "Shipped.",
          factType: "FACT",
          evidence: [{ documentId: "doc-x", lineStart: 3, lineEnd: 3 }],
        },
      ],
      gaps: [{ question: "Scale?" }],
    });
    const a = build(analysis).knowledge;
    const b = build(analysis).knowledge;
    expect(stableStringify(a)).toBe(stableStringify(b));
  });

  it("orders every collection by id", () => {
    const analysis = analysisWith({
      entities: [
        { kind: "technology", name: "Zeta", evidence: [{ documentId: "doc-x" }] },
        { kind: "technology", name: "Alpha", evidence: [{ documentId: "doc-x" }] },
        { kind: "technology", name: "Mu", evidence: [{ documentId: "doc-x" }] },
      ],
    });
    const { knowledge } = build(analysis);
    const ids = knowledge.technologies.map((t) => t.id);
    expect(ids).toEqual([...ids].sort());
  });

  it("resolves an in-bounds line range to a file locator", () => {
    // fake doc-x content is 5 lines: "# X", "", "line three", "line four", ""
    const analysis = analysisWith({
      entities: [
        {
          kind: "requirement",
          name: "Persist before responding",
          evidence: [{ documentId: "doc-x", lineStart: 3, lineEnd: 4 }],
        },
      ],
    });
    const { knowledge, report } = build(analysis);
    expect(knowledge.requirements[0]?.sourceRefs[0]?.locator).toMatchObject({
      kind: "file",
      path: "README.md",
      lineStart: 3,
      lineEnd: 4,
    });
    expect(report.stats.evidenceResolved).toBe(2); // project + requirement
    expect(report.stats.evidenceUnresolved).toBe(0);
    expect(validateProjectKnowledge(knowledge).valid).toBe(true);
  });

  it("discards an inverted line range instead of collapsing it", () => {
    const analysis = analysisWith({
      entities: [
        {
          kind: "requirement",
          name: "Persist before responding",
          evidence: [{ documentId: "doc-x", lineStart: 4, lineEnd: 2 }],
        },
      ],
    });
    const { knowledge, report } = build(analysis);
    expect(knowledge.requirements[0]?.sourceRefs).toEqual([]);
    expect(report.stats.evidenceUnresolved).toBe(1);
    expect(report.notes.some((n) => n.code === "builder/evidence-range-invalid")).toBe(true);
    expect(report.notes.some((n) => n.code === "builder/evidence-range-fixed")).toBe(false);
    expect(validateProjectKnowledge(knowledge).valid).toBe(true);
  });

  it("discards an out-of-bounds line range and does not clamp to the last line", () => {
    const analysis = analysisWith({
      entities: [
        {
          kind: "requirement",
          name: "Persist before responding",
          evidence: [{ documentId: "doc-x", lineStart: 3, lineEnd: 9000 }],
        },
      ],
    });
    const { knowledge, report } = build(analysis);
    expect(knowledge.requirements[0]?.sourceRefs).toEqual([]);
    expect(report.stats.evidenceUnresolved).toBe(1);
    expect(report.notes.some((n) => n.code === "builder/evidence-out-of-bounds")).toBe(true);
    expect(validateProjectKnowledge(knowledge).valid).toBe(true);
  });

  it("keeps evidence whose verbatim quote is present in the cited range", () => {
    const analysis = analysisWith({
      entities: [
        {
          kind: "requirement",
          name: "Persist before responding",
          evidence: [{ documentId: "doc-x", lineStart: 3, lineEnd: 3, quote: "line three" }],
        },
      ],
    });
    const { knowledge, report } = build(analysis);
    expect(knowledge.requirements[0]?.sourceRefs[0]?.quote).toBe("line three");
    expect(report.notes.some((n) => n.code === "builder/evidence-quote-mismatch")).toBe(false);
    expect(validateProjectKnowledge(knowledge).valid).toBe(true);
  });

  it("discards evidence whose quote is not in the document", () => {
    const analysis = analysisWith({
      entities: [
        {
          kind: "requirement",
          name: "Persist before responding",
          evidence: [{ documentId: "doc-x", quote: "this text does not appear" }],
        },
      ],
    });
    const { knowledge, report } = build(analysis);
    expect(knowledge.requirements[0]?.sourceRefs).toEqual([]);
    expect(report.stats.evidenceUnresolved).toBe(1);
    expect(report.notes.some((n) => n.code === "builder/evidence-quote-mismatch")).toBe(true);
    expect(validateProjectKnowledge(knowledge).valid).toBe(true);
  });

  it("discards evidence whose quote sits outside the declared range", () => {
    const analysis = analysisWith({
      entities: [
        {
          kind: "requirement",
          name: "Persist before responding",
          // "line four" is real, but on line 4 — not within the cited line 3
          evidence: [{ documentId: "doc-x", lineStart: 3, lineEnd: 3, quote: "line four" }],
        },
      ],
    });
    const { knowledge, report } = build(analysis);
    expect(knowledge.requirements[0]?.sourceRefs).toEqual([]);
    expect(report.stats.evidenceUnresolved).toBe(1);
    expect(report.notes.some((n) => n.code === "builder/evidence-quote-mismatch")).toBe(true);
    expect(validateProjectKnowledge(knowledge).valid).toBe(true);
  });

  it("records provenance whose contentHash matches the payload", () => {
    const { knowledge } = build(analysisWith({}));
    const { meta, ...rest } = knowledge;
    expect(meta?.contentHash).toBe(contentHash(rest));
    expect(meta?.generator).toContain("arclume-knowledge-builder");
  });

  it("emits a near-duplicate note but keeps entities separate", () => {
    const analysis = analysisWith({
      entities: [
        { kind: "technology", name: "React", evidence: [{ documentId: "doc-x" }] },
        { kind: "technology", name: "React Native", evidence: [{ documentId: "doc-x" }] },
      ],
    });
    const { knowledge, report } = build(analysis);
    expect(knowledge.technologies.length).toBe(2);
    expect(report.notes.some((n) => n.code === "builder/near-duplicate")).toBe(true);
  });

  it("splits a metric bullet into name and value", () => {
    const analysis = analysisWith({
      entities: [
        {
          kind: "metric",
          name: "Median approval time: 6 hours.",
          evidence: [{ documentId: "doc-x" }],
        },
      ],
    });
    const { knowledge } = build(analysis);
    expect(knowledge.metrics[0]).toMatchObject({ name: "Median approval time", value: "6 hours" });
  });

  it("always produces a valid ProjectKnowledge", () => {
    const { knowledge } = build(
      analysisWith({
        entities: [
          { kind: "actor", name: "Approver", evidence: [{ documentId: "doc-x" }] },
          { kind: "risk", name: "Duplicate webhooks", factType: "FACT", evidence: [] },
        ],
      }),
    );
    expect(validateProjectKnowledge(knowledge).valid).toBe(true);
    // the unsupported FACT risk was downgraded, not left invalid
    expect(knowledge.risks[0]?.factType).toBe("INFERENCE");
  });
});
