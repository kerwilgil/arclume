import { describe, expect, it } from "vitest";
import {
  type ProjectKnowledge,
  THEME_IDS,
  buildNarrativePlan,
  buildSlidePlan,
  buildVisualDeck,
  getTheme,
  themeTokensRef,
} from "../src/index.js";
import { loadFixture } from "./helpers/fixtures.js";

const wide = () => loadFixture<ProjectKnowledge>("planning/wide-knowledge.json");

function deckWith(theme: "minimal" | "executive") {
  const k = wide();
  const narrative = buildNarrativePlan(k, { audience: "technical" });
  const slidePlan = buildSlidePlan(k, narrative);
  return buildVisualDeck({ knowledge: k, narrative, slidePlan, theme }).deck;
}

describe("Themes — token model", () => {
  it("Phase 4 implements exactly minimal and executive", () => {
    expect([...THEME_IDS]).toEqual(["minimal", "executive"]);
  });

  it("a theme is a bag of abstract tokens — no hex, no CSS", () => {
    for (const id of THEME_IDS) {
      const t = getTheme(id);
      const json = JSON.stringify(t.tokens);
      expect(json).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(json).not.toMatch(/px|rem|rgba?\(/);
      expect(Object.keys(t.tokens.color)).toEqual([
        "background",
        "surface",
        "text-primary",
        "text-secondary",
        "accent",
        "positive",
        "warning",
        "negative",
        "neutral",
      ]);
      expect(Object.keys(t.tokens.typography)).toEqual([
        "display",
        "title",
        "heading",
        "body",
        "caption",
        "metric",
      ]);
    }
  });

  it("tokensRef is deterministic and differs between themes", () => {
    expect(themeTokensRef(getTheme("minimal"))).toBe(themeTokensRef(getTheme("minimal")));
    expect(themeTokensRef(getTheme("minimal"))).not.toBe(themeTokensRef(getTheme("executive")));
  });
});

describe("Themes — semantic invariance", () => {
  it("the same SlidePlan under minimal vs executive is the same deck, minus theme representation", () => {
    const min = deckWith("minimal");
    const exe = deckWith("executive");

    // content, provenance and meaning are identical
    expect(min.slides.length).toBe(exe.slides.length);
    expect(min.slides.map((s) => s.keyMessage)).toEqual(exe.slides.map((s) => s.keyMessage));
    expect(min.slides.map((s) => s.id)).toEqual(exe.slides.map((s) => s.id));
    expect(min.slides.map((s) => s.narrativePurpose)).toEqual(
      exe.slides.map((s) => s.narrativePurpose),
    );
    expect(min.slides.map((s) => s.blocks.map((b) => b.type))).toEqual(
      exe.slides.map((s) => s.blocks.map((b) => b.type)),
    );
    expect(min.slides.map((s) => s.layout)).toEqual(exe.slides.map((s) => s.layout));
    expect(min.provenance).toEqual(exe.provenance);
    expect(min.narrative).toEqual(exe.narrative);
    expect(JSON.stringify(min.diagrams)).toBe(JSON.stringify(exe.diagrams));

    // only the theme block differs
    expect(min.theme.name).toBe("minimal");
    expect(exe.theme.name).toBe("executive");
    expect(min.theme.tokensRef).not.toBe(exe.theme.tokensRef);
  });
});
