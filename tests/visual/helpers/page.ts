/**
 * Direct Playwright page helper for the viewer-interaction tests (which drive
 * the viewer by hand rather than through `runVisualQa`).
 */

import { type Browser, type Page, chromium } from "playwright";

export interface OpenDeck {
  browser: Browser;
  page: Page;
  close: () => Promise<void>;
}

export async function openDeck(
  html: string,
  viewport: { width: number; height: number } = { width: 1440, height: 900 },
): Promise<OpenDeck> {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    colorScheme: "light",
    reducedMotion: "reduce",
    locale: "en-US",
  });
  const page = await context.newPage();
  await page.setContent(html, { waitUntil: "load" });
  await page.evaluate(async () => {
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    if (fonts?.ready) await fonts.ready;
  });
  return {
    browser,
    page,
    close: async () => {
      await browser.close();
    },
  };
}

export async function activeSlide(
  page: Page,
): Promise<{ index: number; id: string; count: number }> {
  return page.evaluate(() => {
    const a = document.querySelector(".arclume-slide.is-active");
    return {
      index: a ? Number(a.getAttribute("data-slide-index")) : -1,
      id: a ? (a.getAttribute("data-slide-id") ?? "") : "",
      count: document.querySelectorAll(".arclume-slide.is-active").length,
    };
  });
}

export async function waitIndex(page: Page, index: number): Promise<void> {
  await page.waitForFunction(
    (idx) => {
      const a = document.querySelector(".arclume-slide.is-active");
      return !!a && Number(a.getAttribute("data-slide-index")) === idx;
    },
    index,
    { timeout: 10_000 },
  );
}
