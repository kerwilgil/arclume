import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import {
  CANONICAL_VIEWPORT,
  DEFAULT_VIEWPORTS,
  buildVisualQaReceipt,
  checkPhase6Schema,
  renderDeckHtml,
  runVisualQa,
  visualQaConfigHash,
  visualQaJson,
} from "../../src/index.js";
import type { VisualQaRun } from "../../src/index.js";
import { sparseDeck } from "./helpers/decks.js";

describe("Visual QA — visual-qa.json + receipt", () => {
  let run: VisualQaRun;
  let html = "";

  beforeAll(async () => {
    html = renderDeckHtml(sparseDeck()).html;
    run = await runVisualQa(html, { viewports: [CANONICAL_VIEWPORT] });
  }, 120_000);

  it("runVisualQa records the SHA-256 of the exact HTML it opened (caller cannot supply it)", () => {
    const expected = createHash("sha256").update(html, "utf8").digest("hex");
    expect(run.input.htmlSha256).toBe(expected);
    expect(run.input.htmlSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("buildVisualQaReceipt refuses to certify an HTML that Visual QA did not open", () => {
    expect(() =>
      buildVisualQaReceipt({
        result: run,
        html: `${html}<!-- a different document -->`,
        deckIrVersion: "0.2.0",
        configHash: visualQaConfigHash([CANONICAL_VIEWPORT], {}),
      }),
    ).toThrow(/different HTML/i);
  });

  it("the receipt's HTML hash is derived from result.input.htmlSha256", () => {
    const receipt = buildVisualQaReceipt({
      result: run,
      html,
      deckIrVersion: "0.2.0",
      configHash: visualQaConfigHash([CANONICAL_VIEWPORT], {}),
    });
    expect(receipt.inputs.htmlSha256).toBe(run.input.htmlSha256);
  });

  it("visualQaJson is schema-valid and carries no screenshot buffers", () => {
    const json = visualQaJson(run);
    const check = checkPhase6Schema("visualQa", json);
    expect(check.errors).toEqual([]);
    expect(check.valid).toBe(true);
    expect(json.input.htmlSha256).toBe(run.input.htmlSha256);
    expect(JSON.stringify(json)).not.toContain("buffer");
    expect(json.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(json.screenshots.length).toBeGreaterThan(0);
  });

  it("the receipt binds the HTML hash, deck identity, versions and browser", () => {
    const configHash = visualQaConfigHash([CANONICAL_VIEWPORT], {});
    const receipt = buildVisualQaReceipt({
      result: run,
      html,
      deckIrVersion: "0.2.0",
      deckContentHash: "a".repeat(64),
      configHash,
    });
    const check = checkPhase6Schema("visualQaReceipt", receipt);
    expect(check.errors).toEqual([]);

    const expectedHtmlHash = createHash("sha256").update(html, "utf8").digest("hex");
    expect(receipt.inputs.htmlSha256).toBe(expectedHtmlHash);
    expect(receipt.deck.irVersion).toBe("0.2.0");
    expect(receipt.renderer.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(receipt.visualQa.version).toBe(run.version);
    expect(receipt.visualQa.configHash).toBe(configHash);
    expect(receipt.browser.name).toBe("chromium");
    expect(receipt.browser.version).toBe(run.browser.version);
    expect(receipt.result.valid).toBe(run.valid);
    expect(receipt.screenshots.length).toBe(3);
    for (const s of receipt.screenshots) expect(s.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("the receipt has no ambient fields in its body", () => {
    const receipt = buildVisualQaReceipt({
      result: run,
      html,
      deckIrVersion: "0.2.0",
      configHash: visualQaConfigHash([CANONICAL_VIEWPORT], {}),
    });
    const text = JSON.stringify(receipt);
    expect(text).not.toMatch(/staging|Users|\/tmp|[Tt]imestamp|generatedAt/);
  });

  it("visualQaConfigHash is stable across viewport array order and ignores nothing material", () => {
    const a = visualQaConfigHash(DEFAULT_VIEWPORTS, { contrast: true });
    const reordered = [...DEFAULT_VIEWPORTS].reverse();
    const b = visualQaConfigHash(reordered, { contrast: true });
    expect(a).toBe(b);
    const c = visualQaConfigHash(DEFAULT_VIEWPORTS, { contrast: false });
    expect(c).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});
