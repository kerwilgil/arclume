import { describe, expect, it } from "vitest";
import { VIEWER_RUNTIME, renderDeckHtml } from "../src/index.js";
import { richDeck, sparseDeck } from "./helpers/decks.js";

describe("html renderer — viewer runtime", () => {
  it("is inlined once, with no framework and no network", () => {
    const html = renderDeckHtml(sparseDeck()).html;
    expect(html.match(/<script>/g)?.length).toBe(1);
    expect(html.match(/<style>/g)?.length).toBe(1);
    expect(VIEWER_RUNTIME).not.toMatch(/require\(|import\s|fetch\(|XMLHttpRequest|WebSocket/);
    expect(VIEWER_RUNTIME).not.toMatch(/innerHTML|outerHTML|document\.write|eval\(|new Function/);
  });

  it("wires previous / next / Home / End / hash handlers", () => {
    expect(VIEWER_RUNTIME).toContain('"ArrowRight"');
    expect(VIEWER_RUNTIME).toContain('"ArrowLeft"');
    expect(VIEWER_RUNTIME).toContain('"PageDown"');
    expect(VIEWER_RUNTIME).toContain('"PageUp"');
    expect(VIEWER_RUNTIME).toContain('"Home"');
    expect(VIEWER_RUNTIME).toContain('"End"');
    expect(VIEWER_RUNTIME).toContain('"hashchange"');
    expect(VIEWER_RUNTIME).toContain('"keydown"');
    expect(VIEWER_RUNTIME).toMatch(/#slide=/);
  });

  it("does not auto-advance (no timers)", () => {
    expect(VIEWER_RUNTIME).not.toMatch(/setInterval|setTimeout|requestAnimationFrame/);
  });

  it("renders the controls, counter (aria-live) and progress bar the runtime targets", () => {
    const html = renderDeckHtml(richDeck()).html;
    expect(html).toContain('class="arclume-prev"');
    expect(html).toContain('class="arclume-next"');
    expect(html).toContain('aria-label="Previous slide"');
    expect(html).toContain('aria-label="Next slide"');
    expect(html).toContain('class="arclume-counter" aria-live="polite"');
    expect(html).toContain('class="arclume-counter-current"');
    expect(html).toContain('class="arclume-progress-bar"');
    expect(html).toContain('class="arclume-counter-total">11<');
  });

  it("each slide is deep-linkable and the first is active", () => {
    const html = renderDeckHtml(richDeck()).html;
    expect(html).toContain('id="slide-sld-cover"');
    expect(html).toContain('data-slide-id="sld-cover"');
    expect(html).toContain('class="arclume-slide arclume-layout-centered is-active"');
    // non-first slides start hidden for assistive tech
    expect(html).toContain('data-slide-id="sld-text"');
    expect(html).toMatch(/data-slide-id="sld-text"[^>]*aria-hidden="true"/);
  });
});

describe("html renderer — accessibility structure", () => {
  const html = renderDeckHtml(richDeck()).html;

  it("has a document language, a <main>, slide <section>s and a heading per slide", () => {
    expect(html).toMatch(/<html lang="en">/);
    expect(html).toContain("<main ");
    expect((html.match(/<section /g) ?? []).length).toBe(11);
    expect((html.match(/<h2 class="arclume-slide-title"/g) ?? []).length).toBe(11);
  });

  it("labels each slide and the controls accessibly", () => {
    expect(html).toContain('aria-roledescription="slide"');
    expect(html).toMatch(/aria-label="Slide 1 of 11: /);
    expect(html).toContain('<nav class="arclume-controls" aria-label="Presentation navigation">');
  });

  it("ships a visible-focus rule, an aria-live region and a reduced-motion block", () => {
    expect(html).toContain(":focus-visible");
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("includes a print stylesheet that reveals every slide", () => {
    expect(html).toContain("@media print");
    expect(html).toMatch(/@media print[\s\S]*\.arclume-slide[\s\S]*break-after: page/);
  });
});
