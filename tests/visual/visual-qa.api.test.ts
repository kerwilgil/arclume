import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_VIEWPORTS,
  checkPhase6Schema,
  renderDeckHtml,
  runValidatedDelivery,
  runVisualQa,
  validateRenderedDeck,
} from "../../src/index.js";
import { clone } from "../helpers/fixtures.js";
import { pipelineDeck, sparseDeck } from "./helpers/decks.js";

describe("Visual QA — public API + responsive matrix", () => {
  it("validateRenderedDeck refuses an invalid deck before opening a browser", async () => {
    const bad = clone(sparseDeck()) as unknown as Record<string, unknown>;
    delete bad["slides"];
    await expect(
      validateRenderedDeck(bad as never, "<!doctype html><html></html>"),
    ).rejects.toMatchObject({ code: "visual/invalid-deck" });
  });

  it("validateRenderedDeck refuses an HTML that is out of sync with the deck", async () => {
    const deck = sparseDeck();
    await expect(
      validateRenderedDeck(deck, "<!doctype html><html><body>nope</body></html>"),
    ).rejects.toMatchObject({ code: "visual/html-deck-mismatch" });
  });

  it("runs the full 3-viewport matrix; only the canonical viewport is strict", async () => {
    const { html } = pipelineDeck("planning/wide-knowledge.json", "executive", "executive");
    const run = await runVisualQa(html);
    expect(run.viewports.map((v) => v.viewport)).toEqual(DEFAULT_VIEWPORTS.map((v) => v.name));
    // canonical is clean
    const canonicalErrors = run.findings.filter(
      (f) => f.viewport === "desktop-1440x900" && f.severity === "error",
    );
    expect(canonicalErrors).toEqual([]);
    // any overflow/off-slide on the small viewports is at most a warning
    for (const f of run.findings) {
      if (
        f.viewport !== "desktop-1440x900" &&
        ["visual/slide-overflow-x", "visual/slide-overflow-y", "visual/off-slide"].includes(f.code)
      ) {
        expect(f.severity).toBe("warning");
      }
    }
  }, 120_000);
});

describe("runValidatedDelivery — end to end", () => {
  let dir = "";
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "arclume-rvd-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("HTML -> Visual QA -> receipt -> manifest -> atomic bundle", async () => {
    const { deck } = pipelineDeck("planning/sparse-knowledge.json", "general", "minimal");
    const html = renderDeckHtml(deck).html;
    const dest = join(dir, "delivery");

    const out = await runValidatedDelivery(deck, html, dest, {
      viewports: [DEFAULT_VIEWPORTS[0] as (typeof DEFAULT_VIEWPORTS)[number]],
    });

    expect(out.delivery.delivered).toBe(true);
    expect(out.visualQa.valid).toBe(true);

    const files = readdirSync(dest).sort();
    expect(files).toContain("visual-qa.json");
    expect(files).toContain("visual-qa-receipt.json");
    expect(files).toContain("manifest.json");
    expect(files).toContain("arclume-deck.html");

    const qaJson = JSON.parse(readFileSync(join(dest, "visual-qa.json"), "utf8"));
    expect(checkPhase6Schema("visualQa", qaJson).valid).toBe(true);
    const receipt = JSON.parse(readFileSync(join(dest, "visual-qa-receipt.json"), "utf8"));
    expect(checkPhase6Schema("visualQaReceipt", receipt).valid).toBe(true);
    expect(receipt.inputs.htmlSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(out.manifest.deliveryId).toMatch(/^[0-9a-f]{32}$/);

    const slideShots = readdirSync(join(dest, "screenshots")).filter((n) => n.startsWith("slide-"));
    expect(slideShots.length).toBe(deck.slides.length);
  }, 120_000);
});
