import { describe, expect, it } from "vitest";
import {
  DECK_CSP,
  HTML_RENDERER_VERSION,
  RenderError,
  formatValidationReport,
  keyMessageClass,
  renderDeckHtml,
  validateArclumeDeck,
} from "../src/index.js";
import { richDeck, slideAt, sparseDeck } from "./helpers/decks.js";
import { clone } from "./helpers/fixtures.js";

const ALL_BLOCK_TYPES = [
  "text",
  "metric",
  "metric-grid",
  "comparison",
  "timeline",
  "roadmap",
  "risk",
  "status",
  "callout",
  "quote",
  "table",
  "image",
  "code",
  "diagram",
  "architecture",
  "workflow",
] as const;

const ALL_LAYOUTS = [
  "single",
  "split-2",
  "grid",
  "full-bleed-visual",
  "centered",
  "quote",
] as const;

describe("html renderer — document", () => {
  it("the rich fixture validates clean, context-free", () => {
    const v = validateArclumeDeck(richDeck());
    expect(v.valid, formatValidationReport(v)).toBe(true);
  });

  it("emits a valid HTML5 shell with charset, viewport, CSP and a deterministic generator tag", () => {
    const { html } = renderDeckHtml(sparseDeck());
    expect(html.startsWith("<!doctype html>\n<html lang=")).toBe(true);
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain('name="viewport"');
    expect(html).toContain('http-equiv="Content-Security-Policy"');
    expect(html).toContain(`Arclume HTML Renderer ${HTML_RENDERER_VERSION}`);
    expect(html.trimEnd().endsWith("</html>")).toBe(true);
    // no timestamp of any kind
    expect(html).not.toMatch(/generated[- ]?at/i);
    expect(html).not.toMatch(/\b20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}/);
  });

  it("the CSP forbids every network fetch", () => {
    expect(DECK_CSP).toContain("default-src 'none'");
    expect(DECK_CSP).toContain("connect-src 'none'");
    for (const dir of ["img-src", "font-src", "media-src"]) {
      expect(DECK_CSP).toContain(`${dir} data:`);
    }
    const { html } = renderDeckHtml(richDeck());
    expect(html).toContain(DECK_CSP.replace(/'/g, "&#39;"));
  });

  it("carries a machine-readable manifest on the deck root", () => {
    const { html } = renderDeckHtml(richDeck());
    expect(html).toMatch(/data-arclume-ir-version="0\.2\.0"/);
    expect(html).toContain(`data-arclume-renderer-version="${HTML_RENDERER_VERSION}"`);
    expect(html).toContain('data-arclume-theme="minimal"');
    expect(html).toContain('data-arclume-slide-count="11"');
    expect(html).toContain('data-arclume-aspect-ratio="16:9"');
  });

  it("is byte-identical across repeated renders", () => {
    const deck = richDeck();
    const a = renderDeckHtml(deck).html;
    const b = renderDeckHtml(deck).html;
    const c = renderDeckHtml(clone(deck)).html;
    expect(a).toBe(b);
    expect(a).toBe(c);
  });

  it("uses no forbidden non-deterministic construct in its own output", () => {
    const { html } = renderDeckHtml(richDeck());
    expect(html).not.toMatch(/Date\.now|Math\.random|randomUUID|new Date\(/);
  });

  it("reports slide / block / diagram counts, theme and byte size — no timestamp", () => {
    const { report } = renderDeckHtml(richDeck());
    expect(report.rendererVersion).toBe(HTML_RENDERER_VERSION);
    expect(report.irVersion).toBe("0.2.0");
    expect(report.theme).toBe("minimal");
    expect(report.slideCount).toBe(11);
    expect(report.blockCount).toBeGreaterThan(15);
    expect(report.diagramCount).toBe(5);
    expect(report.bytes).toBeGreaterThan(1000);
    expect(Object.keys(report)).not.toContain("generatedAt");
  });
});

describe("html renderer — validation before render", () => {
  it("refuses an invalid deck (fatal RenderError, nothing rendered)", () => {
    const bad = clone(richDeck());
    slideAt(bad, 2).index = 99; // break the 0-based index invariant
    expect(() => renderDeckHtml(bad)).toThrowError(RenderError);
    try {
      renderDeckHtml(bad);
    } catch (e) {
      expect((e as RenderError).code).toBe("render/invalid-deck");
    }
  });

  it("refuses a stale deck when context is supplied", () => {
    const deck = richDeck();
    // knowledge whose hash cannot match — deck has no knowledgeHash, so supply one via ctx
    expect(() =>
      renderDeckHtml(deck, {
        context: {
          knowledge: {
            knowledgeVersion: "0.1.0",
            project: { id: "p", name: "P", sourceRefs: [] },
            sources: [],
            meta: { contentHash: `sha256:${"a".repeat(64)}` },
          } as never,
        },
      }),
    ).toThrowError(RenderError);
  });

  it("rejects a theme it cannot resolve", () => {
    const deck = clone(sparseDeck());
    deck.theme.name = "futuristic";
    // schema allows the enum value, so this reaches the renderer's theme gate
    expect(() => renderDeckHtml(deck)).toThrowError(/theme/i);
  });
});

describe("html renderer — layouts & blocks are exhaustive", () => {
  it("renders every one of the six layouts with a namespaced class", () => {
    const { html } = renderDeckHtml(richDeck());
    for (const layout of ALL_LAYOUTS) {
      expect(html, layout).toContain(`arclume-layout-${layout}`);
    }
  });

  it("renders every one of the sixteen block types", () => {
    const { html } = renderDeckHtml(richDeck());
    for (const type of ALL_BLOCK_TYPES) {
      expect(html, type).toContain(`data-block-type="${type}"`);
    }
  });

  it("keyMessageClass buckets purely by length", () => {
    expect(keyMessageClass("short")).toBe("is-normal");
    expect(keyMessageClass("x".repeat(120))).toBe("is-long");
    expect(keyMessageClass("x".repeat(220))).toBe("is-very-long");
  });

  it("does not truncate or reword a long keyMessage", () => {
    const deck = richDeck();
    const long = deck.slides.find((s) => s.id === "sld-close")?.keyMessage ?? "";
    expect(long.length).toBeGreaterThan(120);
    const { html } = renderDeckHtml(deck);
    expect(html).toContain(long.replace(/&/g, "&amp;"));
  });
});

describe("html renderer — semantics are preserved", () => {
  it("keyMessage and quote text appear verbatim (only escaped)", () => {
    const deck = richDeck();
    const { html } = renderDeckHtml(deck);
    expect(html).toContain("A deterministic approval pipeline with a full audit trail.");
    expect(html).toContain("We need the decision recorded, not emailed.");
  });

  it("does not recolour status by meaning — it renders the IR state as-is", () => {
    const { html } = renderDeckHtml(richDeck());
    expect(html).toContain('class="arclume-status state-unknown"');
    // nothing invented a green/amber/red status element from an "unknown" state
    expect(html).not.toMatch(/class="arclume-status state-(green|amber|red)"/);
  });

  it("keeps provenance in the DOM as data-* attributes", () => {
    const { html } = renderDeckHtml(richDeck());
    expect(html).toContain('data-slide-id="sld-risk"');
    expect(html).toContain('data-block-id="b-risk"');
    expect(html).toContain('data-risk-id="rsk-erp"');
    expect(html).toContain('data-metric-id="mtr-cycle"');
    expect(html).toContain('data-source-ids="brief"');
    expect(html).toContain('data-diagram-id="dgm-arch"');
    expect(html).toContain('data-entity-id="cmp-ui"');
    expect(html).toContain('data-relation-id="rel-ui-api"');
    expect(html).toContain("arclume-evidence");
  });
});
