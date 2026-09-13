import { describe, expect, it } from "vitest";
import {
  RenderError,
  assertRenderOutput,
  extractInlineScript,
  extractInlineStyle,
  formatValidationReport,
  renderDeckHtml,
  validateArclumeDeck,
} from "../src/index.js";
import type { ArclumeDeck, Block } from "../src/index.js";
import { slideAt, sparseDeck } from "./helpers/decks.js";
import { clone } from "./helpers/fixtures.js";

/* ================================================================== */
/* P1 — architecture SVG must be truly cycle-safe                       */
/* ================================================================== */

interface ArchNodeSpec {
  id: string;
  label: string;
  entityId: string;
  group: string;
}
interface ArchEdgeSpec {
  id: string;
  from: string;
  to: string;
  label: string;
  relationId: string;
  relationType: string;
}

function archDeck(nodes: ArchNodeSpec[], edges: ArchEdgeSpec[]): ArclumeDeck {
  const deck = clone(sparseDeck());
  deck.diagrams = [
    {
      id: "dgm-a",
      engine: "native",
      diagramType: "architecture",
      title: "Graph under test",
      spec: { format: "arclume.native.v1", kind: "architecture", condensed: false, nodes, edges },
    },
  ];
  slideAt(deck, 1).diagramRef = "dgm-a";
  slideAt(deck, 1).blocks = [{ id: "b-a", type: "architecture", diagramRef: "dgm-a" }];
  return deck;
}

function n(id: string): ArchNodeSpec {
  return { id: `n-${id}`, label: `Node ${id}`, entityId: `ent-${id}`, group: "components" };
}
function e(from: string, to: string): ArchEdgeSpec {
  return {
    id: `e-${from}-${to}`,
    from: `n-${from}`,
    to: `n-${to}`,
    label: "REL",
    relationId: `rel-${from}-${to}`,
    relationType: "DEPENDS_ON",
  };
}

/** Pull the architecture <svg> out of a rendered document. */
function archSvg(html: string): string {
  const at = html.indexOf('data-diagram-id="dgm-a"');
  expect(at, "architecture figure present").toBeGreaterThan(-1);
  const open = html.indexOf("<svg ", at);
  const end = html.indexOf("</svg>", open);
  return html.slice(open, end + "</svg>".length);
}

interface Bounds {
  vbW: number;
  vbH: number;
  rects: Array<{ x: number; y: number; w: number; h: number }>;
}

function archBounds(svg: string): Bounds {
  const vb = /viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/.exec(svg);
  if (!vb) throw new Error("no viewBox in architecture svg");
  const re =
    /<rect class="node-box"[^>]*\bx="(-?\d+(?:\.\d+)?)"[^>]*\by="(-?\d+(?:\.\d+)?)"[^>]*\bwidth="(\d+(?:\.\d+)?)"[^>]*\bheight="(\d+(?:\.\d+)?)"/g;
  const rects: Bounds["rects"] = [...svg.matchAll(re)].map((m) => ({
    x: Number(m[1]),
    y: Number(m[2]),
    w: Number(m[3]),
    h: Number(m[4]),
  }));
  return { vbW: Number(vb[1]), vbH: Number(vb[2]), rects };
}

function assertAllInsideViewBox(svg: string, expectedNodeCount: number): Bounds {
  const b = archBounds(svg);
  expect(b.rects.length, "one node rect per node").toBe(expectedNodeCount);
  for (const r of b.rects) {
    expect(r.x, `x >= 0 (${JSON.stringify(r)})`).toBeGreaterThanOrEqual(0);
    expect(r.y, `y >= 0 (${JSON.stringify(r)})`).toBeGreaterThanOrEqual(0);
    expect(
      r.x + r.w,
      `x+w <= viewBox.width (${JSON.stringify(r)}, vb=${b.vbW})`,
    ).toBeLessThanOrEqual(b.vbW);
    expect(
      r.y + r.h,
      `y+h <= viewBox.height (${JSON.stringify(r)}, vb=${b.vbH})`,
    ).toBeLessThanOrEqual(b.vbH);
  }
  return b;
}

describe("architecture SVG — cycle safety", () => {
  it("2-node cycle A⇄B renders both nodes + both relations, deterministically, inside the viewBox", () => {
    const deck = archDeck([n("A"), n("B")], [e("A", "B"), e("B", "A")]);
    const v = validateArclumeDeck(deck);
    expect(v.valid, formatValidationReport(v)).toBe(true);

    const html1 = renderDeckHtml(deck).html;
    const html2 = renderDeckHtml(clone(deck)).html;
    expect(html1).toBe(html2); // byte-deterministic, no hang

    const svg = archSvg(html1);
    expect(svg).toContain('data-node-id="n-A"');
    expect(svg).toContain('data-node-id="n-B"');
    expect(svg).toContain('data-relation-id="rel-A-B"');
    expect(svg).toContain('data-relation-id="rel-B-A"');
    expect((svg.match(/<line class="edge-line"/g) ?? []).length).toBe(2);
    assertAllInsideViewBox(svg, 2);
  });

  it("3-node cycle A→B→C→A keeps every node inside the viewBox", () => {
    const deck = archDeck([n("A"), n("B"), n("C")], [e("A", "B"), e("B", "C"), e("C", "A")]);
    const svg = archSvg(renderDeckHtml(deck).html);
    for (const id of ["n-A", "n-B", "n-C"]) expect(svg).toContain(`data-node-id="${id}"`);
    for (const rid of ["rel-A-B", "rel-B-C", "rel-C-A"]) {
      expect(svg).toContain(`data-relation-id="${rid}"`);
    }
    assertAllInsideViewBox(svg, 3);
  });

  it("a mixed graph (cycle component + acyclic component) renders everything visibly", () => {
    const deck = archDeck(
      [n("A"), n("B"), n("C"), n("D"), n("E")],
      [e("A", "B"), e("B", "A"), e("C", "D"), e("D", "E")],
    );
    const svg = archSvg(renderDeckHtml(deck).html);
    for (const id of ["n-A", "n-B", "n-C", "n-D", "n-E"]) {
      expect(svg).toContain(`data-node-id="${id}"`);
    }
    for (const rid of ["rel-A-B", "rel-B-A", "rel-C-D", "rel-D-E"]) {
      expect(svg).toContain(`data-relation-id="${rid}"`);
    }
    assertAllInsideViewBox(svg, 5);
  });

  it("DAG regression — a layered acyclic graph still lays out and stays inside the viewBox", () => {
    const deck = archDeck(
      [n("A"), n("B"), n("C"), n("D")],
      [e("A", "B"), e("A", "C"), e("B", "D"), e("C", "D")],
    );
    const html = renderDeckHtml(deck).html;
    const svg = archSvg(html);
    for (const id of ["n-A", "n-B", "n-C", "n-D"]) expect(svg).toContain(`data-node-id="${id}"`);
    const b = assertAllInsideViewBox(svg, 4);
    // layered: at least two distinct x columns exist
    expect(new Set(b.rects.map((r) => r.x)).size).toBeGreaterThan(1);
    // deterministic
    expect(renderDeckHtml(clone(deck)).html).toBe(html);
  });

  it("a self-loop node stays inside the viewBox", () => {
    const deck = archDeck([n("A"), n("B")], [e("A", "A"), e("A", "B")]);
    const svg = archSvg(renderDeckHtml(deck).html);
    assertAllInsideViewBox(svg, 2);
  });
});

/* ================================================================== */
/* P1 — network post-check: active code vs escaped deck content        */
/* ================================================================== */

function withBlocks(blocks: Block[]): ArclumeDeck {
  const deck = clone(sparseDeck());
  slideAt(deck, 1).blocks = blocks;
  return deck;
}

describe("network post-check — legitimate network-like TEXT is allowed", () => {
  it("a CodeBlock full of networking APIs renders as text and does not fail the render", () => {
    const code = [
      'const r = await fetch("/api/data");',
      "const xhr = new XMLHttpRequest();",
      'const ws = new WebSocket("wss://example.test");',
      'navigator.sendBeacon("/telemetry", body);',
      'const es = new EventSource("/stream");',
      'const mod = await import("./x.js");',
    ].join("\n");
    const deck = withBlocks([{ id: "c-net", type: "code", language: "js", code }]);

    const v = validateArclumeDeck(deck);
    expect(v.valid, formatValidationReport(v)).toBe(true);
    const { html } = renderDeckHtml(deck); // must not throw render/remote-resource-leak
    expect(html).toContain("<code");
    expect(html).toContain("fetch(&quot;/api/data&quot;)");
    expect(html).toContain("new WebSocket(&quot;wss://example.test&quot;)");
    expect(html).toContain("navigator.sendBeacon(&quot;/telemetry&quot;, body)");
  });

  it("a CodeBlock showing @import url(https://…) renders as text, no leak", () => {
    const deck = withBlocks([
      {
        id: "c-css",
        type: "code",
        language: "css",
        code: '@import url("https://example.test/x.css");',
      },
    ]);
    const { html } = renderDeckHtml(deck);
    expect(html).toContain("@import url(&quot;https://example.test/x.css&quot;)");
    // it is text inside <code>, not inside the renderer stylesheet
    expect(extractInlineStyle(html)).not.toContain("@import");
  });

  it("a TextBlock discussing fetch() and https URLs is fine", () => {
    const deck = withBlocks([
      {
        id: "t-net",
        type: "text",
        text: 'Call fetch("https://api.example.test/v1") and read the response. See <link rel="preload">.',
      },
    ]);
    const { html } = renderDeckHtml(deck);
    expect(html).toContain("fetch(&quot;https://api.example.test/v1&quot;)");
    expect(html).toContain("&lt;link rel=&quot;preload&quot;&gt;");
  });

  it("a table cell and a quote with network-like text are fine", () => {
    const deck = withBlocks([
      { id: "tb", type: "table", columns: ["api"], rows: [['fetch("https://x.test")']] },
      { id: "qb", type: "quote", text: 'we removed the WebSocket("wss://old") call' },
    ]);
    expect(() => renderDeckHtml(deck)).not.toThrow();
  });
});

describe("network post-check — real leaks in renderer-authored surface still fail", () => {
  const base = () => renderDeckHtml(sparseDeck()).html;
  const deck = sparseDeck();

  /** assertRenderOutput must throw a RenderError whose code is a leak. */
  function expectLeak(bad: string): void {
    let caught: unknown;
    try {
      assertRenderOutput(deck, bad);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RenderError);
    expect((caught as RenderError).code).toBe("render/remote-resource-leak");
  }

  it("a <script src> injected into the document is rejected", () => {
    expectLeak(base().replace("</head>", '<script src="https://evil.test/a.js"></script></head>'));
  });

  it("a <link href> injected into the document is rejected", () => {
    expectLeak(
      base().replace("</head>", '<link href="https://evil.test/x.css" rel="stylesheet"></head>'),
    );
  });

  it("an <iframe> injected into the document is rejected", () => {
    expectLeak(base().replace("</body>", '<iframe src="https://evil.test"></iframe></body>'));
  });

  it("fetch() introduced into the renderer <script> body is rejected", () => {
    const html = base();
    const js = extractInlineScript(html);
    expectLeak(html.replace(js, `${js}\nfetch("https://evil.test/x");`));
  });

  it("new WebSocket() introduced into the renderer <script> body is rejected", () => {
    const html = base();
    const js = extractInlineScript(html);
    expectLeak(html.replace(js, `${js}\nvar s = new WebSocket("wss://evil.test");`));
  });

  it("@import in the renderer <style> body is rejected", () => {
    const html = base();
    const css = extractInlineStyle(html);
    expectLeak(html.replace(css, `${css}\n@import url("https://evil.test/x.css");`));
  });

  it("a remote url() in the renderer <style> body is rejected", () => {
    const html = base();
    const css = extractInlineStyle(html);
    expectLeak(html.replace(css, `${css}\n.x { background: url(https://evil.test/bg.png); }`));
  });

  it("the untouched rendered document passes the post-check", () => {
    expect(() => assertRenderOutput(deck, base())).not.toThrow();
  });
});
