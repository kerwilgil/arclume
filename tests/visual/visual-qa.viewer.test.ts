import type { Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { renderDeckHtml } from "../../src/index.js";
import { sparseDeck } from "./helpers/decks.js";
import { type OpenDeck, activeSlide, openDeck, waitIndex } from "./helpers/page.js";

/**
 * Physically drive the self-contained viewer in Chromium — real clicks, real
 * key presses, real hash changes — and assert its invariants.
 */
describe("Visual QA — viewer physical interaction", () => {
  let deckHtml = "";
  let opened: OpenDeck;
  let page: Page;

  beforeAll(async () => {
    // a 4-slide deck so Home/End and mid-navigation are meaningful
    const deck = sparseDeck();
    deck.slides.splice(2, 0, {
      id: "s-extra",
      index: 2,
      sectionId: "sec-only",
      kind: "content",
      title: "Extra",
      keyMessage: "A middle slide.",
      narrativePurpose: "evidence",
      layout: "single",
      blocks: [{ id: "s-extra-text", type: "text", text: "middle" }],
      checks: {},
    });
    deck.slides[3] = { ...deck.slides[3], index: 3 } as (typeof deck.slides)[number];
    deckHtml = renderDeckHtml(deck).html;
    opened = await openDeck(deckHtml);
    page = opened.page;
  }, 60_000);

  afterAll(async () => {
    await opened?.close();
  });

  it("starts on slide 0, exactly one active, Previous disabled", async () => {
    await page.keyboard.press("Home");
    await waitIndex(page, 0);
    const s = await activeSlide(page);
    expect(s.index).toBe(0);
    expect(s.count).toBe(1);
    expect(await page.locator(".arclume-prev").isDisabled()).toBe(true);
    expect(await page.locator(".arclume-next").isDisabled()).toBe(false);
    expect(await page.locator(".arclume-counter-current").textContent()).toBe("1");
  });

  it("Next / Previous buttons move one slide and update the counter", async () => {
    await page.keyboard.press("Home");
    await waitIndex(page, 0);
    await page.click(".arclume-next");
    await waitIndex(page, 1);
    expect(await page.locator(".arclume-counter-current").textContent()).toBe("2");
    await page.click(".arclume-prev");
    await waitIndex(page, 0);
    expect(await page.locator(".arclume-counter-current").textContent()).toBe("1");
  });

  it("ArrowRight/Left, ArrowDown/Up, PageDown/Up and Space all navigate", async () => {
    for (const [fwd, back] of [
      ["ArrowRight", "ArrowLeft"],
      ["ArrowDown", "ArrowUp"],
      ["PageDown", "PageUp"],
      ["Space", "ArrowLeft"],
    ]) {
      await page.keyboard.press("Home");
      await waitIndex(page, 0);
      await page.keyboard.press(fwd as string);
      await waitIndex(page, 1);
      await page.keyboard.press(back as string);
      await waitIndex(page, 0);
    }
  });

  it("Home and End jump to the first / last slide and toggle the disabled state", async () => {
    await page.keyboard.press("End");
    await waitIndex(page, 3);
    expect(await page.locator(".arclume-next").isDisabled()).toBe(true);
    expect(await page.locator(".arclume-prev").isDisabled()).toBe(false);
    await page.keyboard.press("ArrowRight"); // past the end: no move
    const s = await activeSlide(page);
    expect(s.index).toBe(3);
    await page.keyboard.press("Home");
    await waitIndex(page, 0);
    expect(await page.locator(".arclume-prev").isDisabled()).toBe(true);
  });

  it("keyboard navigation moves focus onto the active slide", async () => {
    await page.keyboard.press("Home");
    await waitIndex(page, 0);
    await page.keyboard.press("ArrowRight");
    await waitIndex(page, 1);
    const focused = await page.evaluate(() => {
      const a = document.querySelector(".arclume-slide.is-active");
      return document.activeElement === a;
    });
    expect(focused).toBe(true);
  });

  it("the aria-hidden state tracks the active slide", async () => {
    await page.keyboard.press("Home");
    await waitIndex(page, 0);
    await page.keyboard.press("ArrowRight");
    await waitIndex(page, 1);
    const state = await page.evaluate(() => {
      const slides = Array.from(document.querySelectorAll(".arclume-slide")) as HTMLElement[];
      const active = document.querySelector(".arclume-slide.is-active");
      return {
        activeHasHidden: active?.hasAttribute("aria-hidden") ?? true,
        inactivesHidden: slides
          .filter((sl) => !sl.classList.contains("is-active"))
          .every((sl) => sl.getAttribute("aria-hidden") === "true"),
      };
    });
    expect(state.activeHasHidden).toBe(false);
    expect(state.inactivesHidden).toBe(true);
  });

  it("the progress bar width tracks position", async () => {
    await page.keyboard.press("Home");
    await waitIndex(page, 0);
    const w0 = await page.evaluate(
      () => (document.querySelector(".arclume-progress-bar") as HTMLElement).style.width,
    );
    await page.keyboard.press("End");
    await waitIndex(page, 3);
    const w1 = await page.evaluate(
      () => (document.querySelector(".arclume-progress-bar") as HTMLElement).style.width,
    );
    // the runtime writes "25.00%" / "100.00%"; the DOM normalizes trailing zeros
    expect(Number.parseFloat(w0)).toBeCloseTo(25, 5);
    expect(Number.parseFloat(w1)).toBeCloseTo(100, 5);
    expect(w0.endsWith("%")).toBe(true);
  });

  it("#slide=<valid-id> deep-links to that slide", async () => {
    await page.evaluate(() => {
      window.location.hash = "#slide=s-extra";
    });
    await waitIndex(page, 2);
    expect((await activeSlide(page)).id).toBe("s-extra");
  });

  it("an invalid hash falls back to the first slide without crashing", async () => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.evaluate(() => {
      window.location.hash = "#slide=does-not-exist";
    });
    await waitIndex(page, 0);
    expect((await activeSlide(page)).index).toBe(0);
    expect(errors).toEqual([]);
  });
});
