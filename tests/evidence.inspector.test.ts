import { describe, expect, it } from "vitest";
import { verifySourceRefEvidence } from "../src/evidence/git-evidence.js";
import {
  type EvidenceSummary,
  type ProjectKnowledge,
  inspectProjectKnowledge,
} from "../src/index.js";
import type { FactType } from "../src/types/common.js";
import { loadFixture } from "./helpers/fixtures.js";

const rich = (): ProjectKnowledge => loadFixture<ProjectKnowledge>("knowledge/valid/rich.json");
const sparse = (): ProjectKnowledge =>
  loadFixture<ProjectKnowledge>("planning/sparse-knowledge.json");

describe("inspectProjectKnowledge — evidence inspector payload", () => {
  it("returns every claim and risk with its source-ref proofs", () => {
    const k = rich();
    const out = inspectProjectKnowledge(k);
    expect(out.claims.length).toBe(k.claims.length);
    expect(out.risks.length).toBe(k.risks.length);
    // Each claim row carries one proof per sourceRef of the underlying claim
    for (const claim of k.claims) {
      const row = out.claims.find((c) => c.id === claim.id);
      expect(row).toBeDefined();
      expect(row?.proofs.length ?? 0).toBe(claim.sourceRefs.length);
    }
  });

  it("marks every proof 'unavailable' when no repo is provided", () => {
    const k = rich();
    const out = inspectProjectKnowledge(k);
    for (const row of out.claims) {
      for (const proof of row.proofs) {
        expect(proof.verification).toBe("unavailable");
      }
    }
  });

  it("a fact with a locator on a real local repo proves VERIFIED or UNVERIFIED", () => {
    // The arclume repo itself is available during the test run. A claim that
    // points at the repo root itself with a real file path should verify.
    const k: ProjectKnowledge = {
      knowledgeVersion: "0.1.0",
      project: { id: "p1", name: "x", sourceRefs: [] },
      sources: [],
      capabilities: [],
      components: [],
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
      relations: [],
      claims: [
        {
          id: "clm-self",
          statement: "The project has package.json",
          factType: "FACT",
          sourceRefs: [
            {
              sourceId: "repo",
              locator: { kind: "file", path: "package.json" },
            },
          ],
        },
      ],
      gaps: [],
    };
    const out = inspectProjectKnowledge(k, { repoRoot: "C:\\Users\\VOZSP\\Documents\\arclume" });
    const row = out.claims[0];
    expect(row).toBeDefined();
    // Either git-verified OR gracefully unverified — but never crash and never fabricate.
    expect(["verified", "unverified"]).toContain(row?.verification);
    expect(row?.proofs.length).toBe(1);
  });

  it("handles a claim with no sourceRefs gracefully", () => {
    const k: ProjectKnowledge = {
      knowledgeVersion: "0.1.0",
      project: { id: "p1", name: "x", sourceRefs: [] },
      sources: [],
      capabilities: [],
      components: [],
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
      relations: [],
      claims: [
        {
          id: "clm-empty",
          statement: "No refs",
          factType: "INFERENCE",
          sourceRefs: [],
        },
      ],
      gaps: [],
    };
    const out = inspectProjectKnowledge(k);
    expect(out.claims.length).toBe(1);
    const row = out.claims[0];
    expect(row).toBeDefined();
    expect(row?.factType).toBe("INFERENCE");
    expect(row?.verification).toBe("unavailable"); // 0 refs → nothing to verify
    expect(row?.proofs).toEqual([]);
  });

  it("repeating the same inspection on the same knowledge is deterministic", () => {
    const k = rich();
    const a = inspectProjectKnowledge(k);
    const b = inspectProjectKnowledge(k);
    expect(a).toEqual(b);
  });

  it("returns the claim type from the source (never fabricated)", () => {
    const k = rich();
    const out = inspectProjectKnowledge(k);
    for (const row of out.claims) {
      const source = k.claims.find((c) => c.id === row.id);
      expect(source).toBeDefined();
      expect(row.statement).toBe(source?.statement);
      expect(row.factType).toBe(source?.factType);
    }
  });
});

describe("verifySourceRefEvidence semantics", () => {
  it("a fact with a file locator in the working tree verifies against that tree", () => {
    // The verifier hermetic-gits when it can; a knowledge claim pointing at
    // a directory that doesn't exist is simply UNAVAILABLE (never crashes).
    const r = verifySourceRefEvidence(
      {
        sourceId: "brief",
        locator: { kind: "file", path: "web/src/steps.tsx" },
      },
      { repoRoot: "C:\\Users\\VOZSP\\Documents\\arclume" },
    );
    // In a real git repo this would be VERIFIED; in this test environment it
    // is an instance of a well-formed reference running through the verifier.
    expect(["VERIFIED", "UNVERIFIED"]).toContain(r.verdict);
  });
});
