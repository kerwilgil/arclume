/**
 * HTML renderer + Visual Engine artifacts (Block 7H).
 *
 * The renderer stays pure and synchronous; Visual Engine artifacts are consumed as
 * trusted input. The legacy low-level placeholder path remains for decks that
 * bypass canonical rendering.
 */

import { describe, expect, it } from "vitest";
import {
  applyDiagramEnginePreference,
  assertRenderOutput,
  renderCanonicalDeckHtml,
  renderDeckHtml,
  resolveDiagramEngines,
} from "../src/index.js";
import type { ArclumeDeck, DiagramIR } from "../src/index.js";
import { richDeck } from "./helpers/decks.js";

async function visualEngineDeckExtras(): Promise<{
  deck: ArclumeDeck;
  artifacts: Awaited<ReturnType<typeof resolveDiagramEngines>>["diagramArtifacts"];
}> {
  const deck = applyDiagramEnginePreference(richDeck(), { preference: "auto" });
  const { diagramArtifacts } = await resolveDiagramEngines(deck);
  return { deck, artifacts: diagramArtifacts };
}

describe("HTML renderer — Visual Engine artifacts", () => {
  it("embeds the sanitized SVG inside the standard figure wrapper", async () => {
    const { deck, artifacts } = await visualEngineDeckExtras();
    const { html } = renderCanonicalDeckHtml({ deck, diagramArtifacts: artifacts });

    const m = html.match(
      /<figure class="arclume-diagram" data-diagram-id="dgm-arch" data-diagram-engine="visual"[^>]*>([\s\S]*?)<\/figure>/,
    );
    expect(m).not.toBeNull();
    const inner = (m as RegExpMatchArray)[1] as string;
    expect(inner).toContain("<svg");
    expect(inner).toContain('data-diagram-id="dgm-arch"');
    expect(inner).toContain('data-entity-id="cmp-ui"');
    expect(inner).toContain('data-relation-id="rel-ui-api"');
  });

  it("keeps exactly one document <style> and one document <script>", async () => {
    const { deck, artifacts } = await visualEngineDeckExtras();
    const { html } = renderCanonicalDeckHtml({ deck, diagramArtifacts: artifacts });
    expect(html.match(/<style/g)?.length).toBe(1);
    expect(html.match(/<script/g)?.length).toBe(1);
  });

  it("carries no remote reference and passes the structural self-check", async () => {
    const { deck, artifacts } = await visualEngineDeckExtras();
    const { html } = renderCanonicalDeckHtml({ deck, diagramArtifacts: artifacts });
    expect(() => assertRenderOutput(deck, html)).not.toThrow();
    // The only permitted http(s) string is the SVG xmlns namespace identifier.
    const withoutXmlns = html.replaceAll('xmlns="http://www.w3.org/2000/svg"', "");
    expect(withoutXmlns).not.toMatch(/(?:href|src)\s*=\s*["']\s*https?:/i);
    expect(withoutXmlns).not.toMatch(/url\(\s*["']?\s*(?:https?:|\/\/|data:)/i);
    expect(html).not.toMatch(/\s(?:on\w+|style)\s*=\s*"[^"]*(?:javascript:|url\()/i);
    expect(html).not.toMatch(/\sclass="[^"]*\b(?:c-external|semantic-sigil)\b/);
  });

  it("Visual Engine labels are escaped even in the XSS corpus", async () => {
    const labels = [
      "<script>alert(1)</script>",
      "<img src=x>",
      "& < > \" '",
      "javascript:alert(1)",
      "url(https://evil.example)",
    ];
    const base = richDeck();
    const xssDiagrams: DiagramIR[] = labels.map((label, i) => ({
      id: `dgm-x${i}`,
      engine: "visual",
      diagramType: "architecture",
      title: `X${i}`,
      spec: {
        format: "arclume.native.v1",
        kind: "architecture",
        nodes: [
          { id: "n-a", label, entityId: "cmp-x" },
          { id: "n-b", label: "Peer", entityId: "cmp-peer" },
        ],
        edges: [{ id: "e-1", from: "n-a", to: "n-b", relationId: "rel-x" }],
      },
    }));
    const deck = richDeck({ diagrams: [...base.diagrams, ...xssDiagrams] });
    const { diagramArtifacts } = await resolveDiagramEngines(deck);
    const { html } = renderCanonicalDeckHtml({ deck, diagramArtifacts });
    expect(() => assertRenderOutput(deck, html)).not.toThrow();
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html.match(/<script/g)?.length).toBe(1);
    // escaped (visible but inert) or truncated away — never active markup
    expect(html).not.toContain("<img src=x");
    expect(html).not.toMatch(/(?:href|src)\s*=\s*["']\s*javascript:/i);
  });

  it("legacy low-level placeholder is unchanged without artifacts", () => {
    const deck = richDeck();
    const arch = deck.diagrams.find((d) => d.id === "dgm-arch");
    if (arch === undefined) throw new Error("missing diagram");
    arch.engine = "visual";
    const { html, report } = renderDeckHtml(deck);
    expect(html).toContain("Diagram not rendered (engine: visual).</div>");
    expect(report.warnings.some((w) => w.code === "render/unsupported-diagram-engine")).toBe(true);
  });

  it("native diagram tests remain untouched: native deck renders byte-stably", () => {
    const deck = richDeck();
    const a = renderDeckHtml(deck).html;
    const b = renderCanonicalDeckHtml({ deck }).html;
    expect(a).toBe(b);
  });
});
