import { describe, expect, it } from "vitest";
import { RenderError, renderDeckHtml } from "../src/index.js";
import type { ArclumeDeck, Block } from "../src/index.js";
import { diagramOf, first, richDeck, slideAt, sparseDeck } from "./helpers/decks.js";
import { clone } from "./helpers/fixtures.js";

const PAYLOADS = [
  "<script>alert(1)</script>",
  "<img src=x onerror=alert(1)>",
  "</style><script>alert(1)</script>",
  '" onclick="alert(1)',
  "</title></head><body><script>alert(1)</script>",
];

/**
 * The payload must never become a live tag. Its `<` / `>` / `"` are entity
 * escaped, so no `<script>` / `<img>` / `<svg onload>` element or attribute
 * break-out is created; the escaped text may still appear (harmless) inside a
 * text node or a quoted attribute value.
 */
function assertNeutralised(html: string, payload: string): void {
  expect(html).not.toContain("<script>alert(1)</script>");
  expect(html).not.toMatch(/<script[^>]*>[^<]{0,40}alert\(1\)/i);
  expect(html).not.toContain("<img src=x");
  expect(html).not.toContain("<iframe");
  expect(html).not.toMatch(/<svg\b[^>]*\bonload=/i);
  if (payload.includes("<")) {
    expect(html).toContain("&lt;");
    expect(html).not.toContain(payload);
  }
  if (payload.includes('"')) expect(html).toContain("&quot;");
}

describe("html renderer — XSS escaping", () => {
  for (const payload of PAYLOADS) {
    it(`neutralises ${JSON.stringify(payload)} in slide title / keyMessage / subtitle / meta`, () => {
      const deck = clone(sparseDeck());
      const s = slideAt(deck, 1);
      s.title = payload;
      s.keyMessage = `key ${payload}`;
      s.subtitle = payload;
      deck.meta.title = payload;
      assertNeutralised(renderDeckHtml(deck).html, payload);
    });

    it(`neutralises ${JSON.stringify(payload)} in text / quote / callout / code blocks`, () => {
      const deck = clone(sparseDeck());
      const blocks: Block[] = [
        { id: "x-text", type: "text", text: payload },
        { id: "x-quote", type: "quote", text: payload, attribution: payload },
        { id: "x-callout", type: "callout", tone: "info", text: payload },
        { id: "x-code", type: "code", code: payload },
      ];
      slideAt(deck, 1).blocks = blocks;
      assertNeutralised(renderDeckHtml(deck).html, payload);
    });

    it(`neutralises ${JSON.stringify(payload)} in table cells and headers`, () => {
      const deck = clone(sparseDeck());
      slideAt(deck, 1).blocks = [
        {
          id: "x-table",
          type: "table",
          columns: [payload.slice(0, 40), "b"],
          rows: [[payload, payload]],
        },
      ];
      assertNeutralised(renderDeckHtml(deck).html, payload);
    });

    it(`neutralises ${JSON.stringify(payload)} in diagram labels`, () => {
      const deck = clone(richDeck()) as ArclumeDeck;
      const spec = diagramOf(deck, "dgm-arch").spec as {
        nodes: Array<{ label: string }>;
        edges: Array<{ label: string }>;
      };
      first(spec.nodes).label = payload;
      first(spec.edges).label = payload;
      assertNeutralised(renderDeckHtml(deck).html, payload);
    });
  }

  it("a code block never becomes executable and keeps only an allowlisted language token", () => {
    const deck = clone(sparseDeck());
    slideAt(deck, 1).blocks = [
      { id: "c1", type: "code", language: "ts", code: "const a = 1 < 2 && 3 > 2;" },
      { id: "c2", type: "code", language: "'; DROP", code: "x" },
    ];
    const { html } = renderDeckHtml(deck);
    expect(html).toContain('class="language-ts"');
    expect(html).not.toContain("language-'; DROP");
    expect(html).toContain("const a = 1 &lt; 2 &amp;&amp; 3 &gt; 2;");
  });
});

describe("html renderer — external resource policy", () => {
  it("an external image src is not fetched — placeholder + warning instead", () => {
    const { html, report } = renderDeckHtml(richDeck());
    expect(report.warnings.some((w) => w.code === "render/image-external-not-embedded")).toBe(true);
    expect(html).not.toContain("https://example.com/not-embedded.png");
    expect(html).toContain('<figure class="arclume-image-missing"');
  });

  it("an embedded raster data: URI image is allowed", () => {
    const deck = clone(sparseDeck());
    const px =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAoMBgDTD2qgAAAAASUVORK5CYII=";
    slideAt(deck, 1).blocks = [{ id: "img-ok", type: "image", src: px, alt: "1px" }];
    const { html } = renderDeckHtml(deck);
    expect(html).toContain(`<img class="arclume-image" src="${px}"`);
    expect(html).not.toContain('<figure class="arclume-image-missing"');
  });

  it("an svg data: URI image is rejected (placeholder)", () => {
    const deck = clone(sparseDeck());
    slideAt(deck, 1).blocks = [
      {
        id: "img-svg",
        type: "image",
        src: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
        alt: "svg",
      },
    ];
    expect(renderDeckHtml(deck).html).toContain('<figure class="arclume-image-missing"');
  });

  it("the whole document declares no remote script, link, fetch, socket or beacon", () => {
    const html = renderDeckHtml(richDeck()).html;
    expect(html).not.toMatch(/<script[^>]+src=/i);
    expect(html).not.toMatch(/<link\b/i);
    expect(html).not.toMatch(/\bsrc=["']https?:/i);
    expect(html).not.toMatch(/\bhref=["']https?:/i);
    expect(html).not.toMatch(/\bfetch\s*\(/);
    expect(html).not.toMatch(/XMLHttpRequest|new WebSocket|sendBeacon/);
    expect(html).not.toMatch(/@import|url\(\s*["']?https?:/i);
  });

  it("a payload that tries to smuggle a remote <script src> through an attribute stays escaped", () => {
    const deck = clone(sparseDeck());
    slideAt(deck, 1).blocks = [
      {
        id: "img-x",
        type: "image",
        src: "http://evil/x",
        alt: '"><script src="http://evil"></script>',
      },
    ];
    const { html } = renderDeckHtml(deck);
    expect(html).not.toMatch(/<script src="http/);
    expect(html).toContain("&lt;script src=");
  });

  it("exports RenderError for callers that need to catch a fatal render", () => {
    expect(RenderError).toBeTypeOf("function");
  });
});
