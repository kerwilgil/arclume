import { describe, expect, it } from "vitest";
import {
  AUDIENCE_NAME_VALUES,
  type AudienceName,
  DECK_TYPE_NAMES,
  type DeckTypeName,
  type NarrativePlan,
  type ProjectKnowledge,
  buildNarrativePlan,
  buildSlidePlan,
  stableStringify,
} from "../src/index.js";
import { loadFixture } from "./helpers/fixtures.js";

const rich = (): ProjectKnowledge => loadFixture<ProjectKnowledge>("knowledge/valid/rich.json");
const wide = (): ProjectKnowledge => loadFixture<ProjectKnowledge>("planning/wide-knowledge.json");
const sparse = (): ProjectKnowledge =>
  loadFixture<ProjectKnowledge>("planning/sparse-knowledge.json");

function plan(k: ProjectKnowledge, audience: AudienceName, deckType?: DeckTypeName): NarrativePlan {
  const p = buildNarrativePlan(k, {
    audience,
    ...(deckType !== undefined ? { deckType } : {}),
  });
  return p;
}

describe("Audience presets — structural differentiation", () => {
  it("each of the six audience presets shapes a distinct narrative", () => {
    const k = wide();
    const plans = AUDIENCE_NAME_VALUES.map((a) => ({
      audience: a,
      sectionIds: plan(k, a)
        .sections.map((s) => s.id)
        .join(","),
    }));
    // Every pair must differ
    for (let i = 0; i < plans.length; i++) {
      for (let j = i + 1; j < plans.length; j++) {
        const a = plans[i];
        const b = plans[j];
        if (a === undefined || b === undefined) {
          throw new Error("unreachable: fixed-length iteration");
        }
        expect(a.sectionIds).not.toBe(b.sectionIds);
      }
    }
  });

  it("client keeps internals (contributions) out of the presentation narrative", () => {
    const k = wide();
    const client = plan(k, "client");
    const tech = plan(k, "technical");
    const clientIds = client.sections.map((s) => s.id);
    expect(clientIds.every((s) => s !== "sec-technologies")).toBe(true);
    expect(tech.sections.map((s) => s.id)).toContain("sec-technologies");
  });

  it("executive leads with impact + evidence only when FACT claims exist", () => {
    const k = rich(); // has one FACT claim
    const exec = plan(k, "executive");
    expect(exec.sections.map((s) => s.id)).toContain("sec-evidence"); // rich has a FACT claim
    const sparseK = sparse();
    const sparseExec = plan(sparseK, "executive");
    expect(sparseExec.sections.map((s) => s.id)).not.toContain("sec-evidence");
  });

  it("internal-review surfaces uncertainty at maximum density", () => {
    const k = rich();
    const p = plan(k, "internal-review");
    const ids = p.sections.map((s) => s.id);
    expect(ids).toContain("sec-uncertainty"); // gaps
    expect(ids).toContain("sec-risks");
    expect(p.selection.selected.includes("gap-sso")).toBe(true);
    expect(p.selection.selected.includes("risk-erp-api")).toBe(true);
  });

  it("plans are deterministic across knowledge ordering (same knowledge, same order)", () => {
    const k = wide();
    const shuffled = structuredClone(k);
    shuffled.claims = [...shuffled.claims].reverse();
    shuffled.risks = [...shuffled.risks].reverse();
    shuffled.gaps = [...shuffled.gaps].reverse();
    for (const a of AUDIENCE_NAME_VALUES) {
      expect(stableStringify(plan(k, a))).toBe(stableStringify(plan(shuffled, a)));
    }
  });

  it("every preset keeps knowledge provenance identical across audiences", () => {
    const k = wide();
    const hashes = AUDIENCE_NAME_VALUES.map((a) => plan(k, a).knowledgeHash);
    expect(new Set(hashes).size).toBe(1);
  });
});

describe("Deck Type presets — composition and contract", () => {
  it("audience and deck-type are independent axes — changing deck-type reorganizes structure", () => {
    const k = wide();
    const base = plan(k, "executive");
    const brief = plan(k, "executive", "executive-brief");
    // Must differ (the exec arc is different from the exec brief arc)
    expect(base.sections.map((s) => s.id).join(",")).not.toBe(
      brief.sections.map((s) => s.id).join(","),
    );
  });

  it("architecture-review works for every audience; sections come from the arc", () => {
    const k = wide();
    for (const a of AUDIENCE_NAME_VALUES) {
      const p = plan(k, a, "architecture-review");
      expect(p.sections.map((s) => s.id)).toContain("sec-architecture");
    }
  });

  it("same deck-type under two audiences: same section arc, different selection+objective", () => {
    const k = wide();
    const execArch = plan(k, "executive", "architecture-review");
    const techArch = plan(k, "technical", "architecture-review");
    // deck-type governs the section arc (same section ids)
    expect(execArch.sections.map((s) => s.id)).toEqual(techArch.sections.map((s) => s.id));
    // audience changes evidence density: how much is pulled into each section
    expect(execArch.decisions).not.toEqual(techArch.decisions);
  });

  it("no section is produced for a deck type that lacks supported knowledge", () => {
    const sparseK = sparse();
    const p = plan(sparseK, "executive", "incident-postmortem");
    // sparse has no rels → no timeline section
    expect(p.sections.map((s) => s.id)).not.toContain("sec-timeline");
    // But it must still produce a cover + closing
    expect(p.sections.length).toBeGreaterThanOrEqual(2);
  });

  it("identical inputs → identical plan (deterministic)", () => {
    const k = rich();
    const a = plan(k, "technical", "architecture-review");
    const b = plan(k, "technical", "architecture-review");
    expect(stableStringify(a)).toBe(stableStringify(b));
  });

  it("slide planning carries the deck-type through to the SlidePlan", () => {
    const k = rich();
    const exec = plan(k, "executive", "architecture-review");
    const sp = buildSlidePlan(k, exec);
    expect(sp.deckType).toBe("architecture-review");
  });

  it("every deck type produces a valid-slide plan", () => {
    const k = rich();
    for (const d of [
      "architecture-review",
      "technical-deep-dive",
      "executive-brief",
      "proposal",
      "status-report",
      "migration-plan",
      "product-overview",
      "incident-postmortem",
    ]) {
      const p = plan(k, "technical", d as DeckTypeName);
      const sp = buildSlidePlan(k, p);
      expect(Array.isArray(sp.slides)).toBe(true);
      expect(sp.slides.length).toBeGreaterThanOrEqual(2);
    }
  });
});
