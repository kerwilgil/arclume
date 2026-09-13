import { describe, expect, it } from "vitest";
import { CANONICAL_VIEWPORT, renderDeckHtml, runVisualQa } from "../../src/index.js";
import { sparseDeck } from "./helpers/decks.js";

/**
 * Config validation happens before Chromium launches, so these never open a
 * browser.
 */
const html = renderDeckHtml(sparseDeck()).html;

describe("Visual QA — config validation", () => {
  it("rejects a capture viewport that is not in the matrix", async () => {
    await expect(
      runVisualQa(html, { viewports: [CANONICAL_VIEWPORT], captureViewport: "laptop-1366x768" }),
    ).rejects.toMatchObject({ code: "visual/invalid-input" });
  });

  it("allows a bogus capture viewport when screenshots are disabled", async () => {
    const run = await runVisualQa(html, {
      viewports: [CANONICAL_VIEWPORT],
      captureViewport: "does-not-exist",
      screenshots: false,
    });
    expect(run.screenshots).toEqual([]);
  }, 60_000);

  it("rejects duplicate viewport names", async () => {
    await expect(
      runVisualQa(html, {
        viewports: [CANONICAL_VIEWPORT, { ...CANONICAL_VIEWPORT, width: 800 }],
      }),
    ).rejects.toMatchObject({ code: "visual/invalid-input" });
  });

  it("rejects a non-positive dimension", async () => {
    await expect(
      runVisualQa(html, {
        viewports: [{ name: "bad", width: 0, height: 600, deviceScaleFactor: 1 }],
      }),
    ).rejects.toMatchObject({ code: "visual/invalid-input" });
  });

  it("rejects a non-positive deviceScaleFactor", async () => {
    await expect(
      runVisualQa(html, {
        viewports: [{ name: "bad", width: 800, height: 600, deviceScaleFactor: 0 }],
      }),
    ).rejects.toMatchObject({ code: "visual/invalid-input" });
  });

  it("rejects an empty viewport name", async () => {
    await expect(
      runVisualQa(html, {
        viewports: [{ name: "", width: 800, height: 600, deviceScaleFactor: 1 }],
      }),
    ).rejects.toMatchObject({ code: "visual/invalid-input" });
  });

  it("rejects an empty viewport matrix", async () => {
    await expect(runVisualQa(html, { viewports: [] })).rejects.toMatchObject({
      code: "visual/invalid-input",
    });
  });
});
