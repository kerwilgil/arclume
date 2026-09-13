import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  StubReasoner,
  renderDeckHtml,
  renderHtml,
  runDeck,
  runHtml,
  runPipeline,
  stableStringify,
  writeArtifacts,
  writeHtmlArtifact,
} from "../src/index.js";
import type { ProjectKnowledge } from "../src/index.js";
import { richDeck, sparseDeck } from "./helpers/decks.js";
import { clone } from "./helpers/fixtures.js";
import { sampleRepoPath } from "./helpers/tmp-repo.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

describe("html renderer — end to end", () => {
  it("sample-repo → Knowledge → Narrative → SlidePlan → Deck → HTML (no browser)", async () => {
    const out = await runPipeline(sampleRepoPath(), new StubReasoner());
    const r = runHtml(out.knowledge, { audience: "technical" });

    // every intermediate stays inspectable
    expect(out.knowledge.project).toBeDefined();
    expect(r.narrative.sections.length).toBeGreaterThan(0);
    expect(r.slidePlan.slides.length).toBe(r.deck.slides.length);

    expect(r.html.startsWith("<!doctype html>")).toBe(true);
    expect(r.renderReport.slideCount).toBe(r.deck.slides.length);
    expect(r.html).toContain(`data-arclume-slide-count="${r.deck.slides.length}"`);
    // every planned slide id survives into the DOM
    for (const s of r.deck.slides) expect(r.html).toContain(`data-slide-id="${s.id}"`);
  });

  it("renders the same knowledge under both themes, each declared by its deck", async () => {
    const out = await runPipeline(sampleRepoPath(), new StubReasoner());
    const min = runHtml(out.knowledge, { audience: "technical", theme: "minimal" });
    const exe = runHtml(out.knowledge, { audience: "executive", theme: "executive" });
    expect(min.html).toContain('data-arclume-theme="minimal"');
    expect(exe.html).toContain('data-arclume-theme="executive"');
    // the two stylesheets differ (genuinely different themes, not a rename)
    expect(min.renderReport.theme).not.toBe(exe.renderReport.theme);
    expect(min.html).not.toBe(exe.html);
  });

  it("is deterministic through the whole pipeline", async () => {
    const out = await runPipeline(sampleRepoPath(), new StubReasoner());
    const a = runHtml(out.knowledge, { audience: "general" }).html;
    const b = runHtml(out.knowledge, { audience: "general" }).html;
    expect(a).toBe(b);
  });

  it("reordering knowledge collections yields an identical deck and identical HTML", async () => {
    const out = await runPipeline(sampleRepoPath(), new StubReasoner());
    const reordered = clone(out.knowledge) as ProjectKnowledge & Record<string, unknown>;
    for (const key of Object.keys(reordered)) {
      const v = reordered[key];
      if (Array.isArray(v)) reordered[key] = [...v].reverse();
    }
    const deckA = runDeck(out.knowledge, { audience: "technical" }).deck;
    const deckB = runDeck(reordered as ProjectKnowledge, { audience: "technical" }).deck;
    expect(stableStringify(deckB)).toBe(stableStringify(deckA));
    expect(renderDeckHtml(deckB).html).toBe(renderDeckHtml(deckA).html);
  });

  it("renders the sparse deck as a plain three-slide presentation with no filler", () => {
    const { html, report } = renderDeckHtml(sparseDeck());
    expect(report.slideCount).toBe(3);
    expect(report.diagramCount).toBe(0);
    expect(report.warnings).toEqual([]);
    expect(html).toContain('data-slide-id="s-cover"');
    expect(html).toContain('data-slide-id="s-body"');
    expect(html).toContain('data-slide-id="s-close"');
    expect(html).not.toContain('<div class="arclume-diagram-fallback">');
  });

  it("writeHtmlArtifact + writeArtifacts emit arclume-deck.html next to the JSON", async () => {
    const out = await runPipeline(sampleRepoPath(), new StubReasoner());
    const r = runHtml(out.knowledge, { audience: "general" });

    const dir = mkdtempSync(join(tmpdir(), "arclume-html-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));

    writeHtmlArtifact(join(dir, "standalone", "arclume-deck.html"), r.html);
    expect(readFileSync(join(dir, "standalone", "arclume-deck.html"), "utf8")).toBe(r.html);

    writeArtifacts(dir, {
      ingestion: out.ingestion,
      sourceDigest: out.sourceDigest,
      analysisDigest: out.analysisDigest,
      analysis: out.analysis,
      reasoner: out.reasoner,
      knowledge: out.knowledge,
      narrative: r.narrative,
      slidePlan: r.slidePlan,
      deck: r.deck,
      html: r.html,
    });
    expect(existsSync(join(dir, "arclume-deck.json"))).toBe(true);
    expect(existsSync(join(dir, "arclume-deck.html"))).toBe(true);
    expect(readFileSync(join(dir, "arclume-deck.html"), "utf8")).toBe(r.html);
  });

  it("renderHtml stage matches runHtml output for the same deck", async () => {
    const out = await runPipeline(sampleRepoPath(), new StubReasoner());
    const deckOut = runDeck(out.knowledge, { audience: "technical" });
    const staged = renderHtml(deckOut.deck, {
      knowledge: out.knowledge,
      narrative: deckOut.narrative,
      slidePlan: deckOut.slidePlan,
    });
    const full = runHtml(out.knowledge, { audience: "technical" });
    expect(staged.html).toBe(full.html);
  });

  it("the generated document contains no NUL byte", () => {
    const html = renderDeckHtml(richDeck()).html;
    expect(html.includes(String.fromCharCode(0))).toBe(false);
  });
});
