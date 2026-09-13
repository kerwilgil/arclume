import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalysisResult } from "../src/analysis/analysis-result.js";
import { stableStringify } from "../src/determinism/hash.js";
import {
  type AudienceName,
  type DeckTypeName,
  type ProjectKnowledge,
  buildKnowledge,
} from "../src/index.js";
import { buildNarrativePlan } from "../src/narrative/planner.js";
import { buildSlidePlan } from "../src/planning/slide-planner.js";
import { buildVisualDeck } from "../src/visual/director.js";

function makeKnowledge(name: string): ProjectKnowledge {
  return structuredClone({
    knowledgeVersion: "0.1.0",
    project: {
      id: "p-demo",
      name,
      purpose: "Prove rebuild without a reasoner.",
      status: "known",
      sourceRefs: [],
    },
    sources: [],
    capabilities: [{ id: "cap-a", name: "rebuild", sourceRefs: [] }],
    components: [
      { id: "cmp-a", name: "req-builder", kind: "service", sourceRefs: [] },
      { id: "cmp-b", name: "preview-ui", kind: "ui", sourceRefs: [] },
    ],
    actors: [],
    dependencies: [],
    processes: [],
    phases: [],
    milestones: [],
    metrics: [],
    risks: [],
    decisions: [],
    requirements: [],
    technologies: [],
    results: [],
    constraints: [],
    relations: [{ id: "rel-1", from: "cmp-a", to: "cmp-b", type: "PRODUCES", sourceRefs: [] }],
    claims: [
      {
        id: "clm-safe",
        statement: "Rebuild has no reasoner.",
        factType: "FACT",
        sourceRefs: [],
      },
    ],
    gaps: [],
  }) as unknown as ProjectKnowledge;
}

function buildKnowledgeFixture(name: string): ProjectKnowledge {
  const analysis: AnalysisResult = {
    analysisVersion: "0.1.0",
    project: { name, purpose: "Prove rebuild without a reasoner.", status: "known", evidence: [] },
    entities: [],
    relations: [],
    claims: [],
    gaps: [],
  };
  const built = buildKnowledge({
    analysis,
    ingestion: { sources: [], documents: [], skipped: [], issues: [] },
    sourceDigest: "fixture-mock",
  });
  return built.knowledge;
}

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  globalThis.fetch = vi.fn() as unknown as typeof globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("Rebuild from ProjectKnowledge — zero-reasoner contract", () => {
  it("the rebuild pipeline is a pure ProjectKnowledge→Assets function", () => {
    const k = buildKnowledgeFixture("ZeroCalls");
    const narrative = buildNarrativePlan(k, {
      audience: "executive",
      deckType: "architecture-review",
    });
    const slidePlan = buildSlidePlan(k, narrative);
    const deck = buildVisualDeck({ knowledge: k, narrative, slidePlan });
    expect(deck.deck).toBeDefined();
    expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();
  });

  it("rebuild does not mutate the knowledge (full provenance equality)", () => {
    const k = makeKnowledge("Immutable");
    const before = stableStringify(k);
    const iterations: Array<{ audience: AudienceName; deckType?: DeckTypeName }> = [
      { audience: "executive" },
      { audience: "technical", deckType: "architecture-review" },
      { audience: "executive", deckType: "architecture-review" },
      { audience: "internal-review" },
    ];
    for (const run of iterations) {
      const narrative = buildNarrativePlan(k, {
        audience: run.audience,
        ...(run.deckType !== undefined ? { deckType: run.deckType } : {}),
      });
      const plan = buildSlidePlan(k, narrative);
      const deck = buildVisualDeck({ knowledge: k, narrative, slidePlan: plan });
      expect(deck.deck.slides.length).toBeGreaterThanOrEqual(2);
    }
    expect(stableStringify(k)).toBe(before);
  });

  it("multi-audience / multi-deck from the same knowledge stays distinct and deterministic", () => {
    const k = makeKnowledge("Combos");
    const cases: Array<[AudienceName, DeckTypeName]> = [
      ["executive", "executive-brief"],
      ["executive", "architecture-review"],
      ["technical", "architecture-review"],
      ["technical", "technical-deep-dive"],
      ["client", "product-overview"],
      ["client", "proposal"],
      ["investor", "project-overview"],
      ["internal-review", "technical-deep-dive"],
    ];
    const seen = new Set<string>();
    for (const [audience, deckType] of cases) {
      const n = buildNarrativePlan(k, { audience, deckType });
      const plan = buildSlidePlan(k, n);
      const deck = buildVisualDeck({ knowledge: k, narrative: n, slidePlan: plan });
      expect(deck.deck.narrative.preset).toBe(audience);
      expect(deck.deck.narrative.deckType).toBe(deckType);
      const sig = stableStringify(deck.deck);
      expect(seen.has(sig)).toBe(false);
      seen.add(sig);
    }
    const n1 = buildNarrativePlan(k, { audience: "executive", deckType: "executive-brief" });
    const n2 = buildNarrativePlan(k, { audience: "executive", deckType: "executive-brief" });
    expect(stableStringify(n1)).toBe(stableStringify(n2));
  });
});
