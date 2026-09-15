/**
 * Sidebar clipping fix — real Chromium evidence.
 *
 * Drives the actual UI, scrolls Help to the very bottom and proves the
 * sidebar still covers the whole viewport (the 1.0.0 bug left an empty gap
 * there). Covers the QA matrix cheaply: start / middle / bottom of Help,
 * Source and Settings views, a reduced-height viewport, CSS zoom at
 * 100/125/150 %, Light and Dark themes, EN and ES locales.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Browser, Page } from "playwright";
import { chromium } from "playwright";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type WebServerHandle, startArclumeWeb } from "../../src/web/server.js";

let browser: Browser;
let server: WebServerHandle;
let shots: string;

const VISIBLE_TIMEOUT = 180_000;

beforeAll(async () => {
  if (!existsSync(join(process.cwd(), "web", "dist", "index.html"))) {
    execFileSync("npm", ["run", "build"], {
      cwd: process.cwd(),
      stdio: "inherit",
      shell: process.platform === "win32",
    });
  }
  browser = await chromium.launch();
  shots = mkdtempSync(join(tmpdir(), "arclume-sidebar-"));
}, 300_000);

afterAll(async () => {
  await browser.close();
});

beforeEach(async () => {
  server = await startArclumeWeb({ port: 0 });
});

afterEach(async () => {
  await server.close();
});

interface SidebarMetrics {
  present: boolean;
  top: number;
  bottom: number;
  viewportHeight: number;
  position: string;
  scrollY: number;
  docHeight: number;
}

async function sidebarMetrics(page: Page): Promise<SidebarMetrics> {
  return page.evaluate(() => {
    const el = document.querySelector(".sidebar");
    if (!el) {
      return {
        present: false,
        top: 0,
        bottom: 0,
        viewportHeight: window.innerHeight,
        position: "",
        scrollY: window.scrollY,
        docHeight: document.documentElement.scrollHeight,
      };
    }
    const r = el.getBoundingClientRect();
    return {
      present: true,
      top: r.top,
      bottom: r.bottom,
      viewportHeight: window.innerHeight,
      position: getComputedStyle(el).position,
      scrollY: window.scrollY,
      docHeight: document.documentElement.scrollHeight,
    };
  });
}

/** The rail covers the whole viewport: pinned at the very top edge, ending
 * exactly at the bottom edge (±1px for sub-pixel rounding). */
function expectFullViewportCoverage(m: SidebarMetrics): void {
  expect(m.present).toBe(true);
  expect(m.position).toBe("sticky");
  expect(Math.abs(m.top)).toBeLessThanOrEqual(1);
  expect(Math.abs(m.bottom - m.viewportHeight)).toBeLessThanOrEqual(1);
}

async function scrollToBottom(page: Page): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  // Let the sticky positioning settle after the scroll.
  await page.waitForTimeout(300);
}

async function openApp(locale: string, viewport = { width: 1280, height: 800 }): Promise<Page> {
  const page = await browser.newPage({ locale, viewport });
  await page.goto(`${server.url}/`, { waitUntil: "networkidle" });
  await page.waitForSelector("#source-input", { state: "visible", timeout: VISIBLE_TIMEOUT });
  await page.waitForTimeout(2000);
  return page;
}

async function openHelp(locale = "en-US"): Promise<Page> {
  const page = await openApp(locale);
  const helpLabel = locale.startsWith("es") ? "Ayuda" : "Help";
  const heading = locale.startsWith("es") ? "Ayuda" : "Help";
  await page.getByRole("button", { name: helpLabel, exact: true }).click();
  await page.waitForSelector(`h2:has-text("${heading}")`, {
    state: "visible",
    timeout: VISIBLE_TIMEOUT,
  });
  return page;
}

describe("web — sidebar clipping regression", () => {
  it("Help at top/middle/bottom: the sidebar covers the whole viewport throughout", async () => {
    const page = await openHelp();
    const mid = await sidebarMetrics(page);
    expect(mid.scrollY).toBe(0);
    expectFullViewportCoverage(mid);

    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight / 2));
    await page.waitForTimeout(300);
    const halfway = await sidebarMetrics(page);
    expect(halfway.scrollY).toBeGreaterThan(0);
    expectFullViewportCoverage(halfway);

    await scrollToBottom(page);
    const bottom = await sidebarMetrics(page);
    expect(bottom.scrollY).toBeGreaterThan(0);
    expect(bottom.docHeight).toBeGreaterThan(bottom.viewportHeight);
    expectFullViewportCoverage(bottom);

    // The utility links are still clickable at the bottom of the page.
    const settings = page.getByRole("button", { name: "Settings", exact: true });
    const box = await settings.boundingBox();
    expect(box).not.toBeNull();
    expect(box?.y ?? 0).toBeGreaterThanOrEqual(0);
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(bottom.viewportHeight + 1);
    await page.screenshot({ path: join(shots, "help-bottom-light-en.png") });
    await page.close();
  });

  it("zoom 100/125/150: scrolling Help to the bottom never exposes the gap", async () => {
    for (const zoom of [1, 1.25, 1.5]) {
      const page = await openHelp();
      // CSSOM (not addStyleTag): the app's strict CSP forbids inline <style>
      // injection, which would fail the test for the wrong reason.
      // CSSOM property writes are exempt from style-src by design.
      await page.evaluate((z) => {
        document.documentElement.style.zoom = String(z);
      }, zoom);
      await page.waitForTimeout(300);
      await scrollToBottom(page);

      // Under a non-1 CSS zoom, rect math and innerHeight report in mixed
      // units — the zoom-invariant question is instead: do real viewport
      // probes on the left column land on the sidebar, also at the very
      // bottom of the page? With the 1.0.0 bug they hit empty background.
      const probes = await page.evaluate(() => {
        const el = document.querySelector(".sidebar");
        if (!el) return { present: false, hits: [] as boolean[], position: "", top: 0 };
        const h = window.innerHeight;
        const ys = [8, Math.floor(h / 2), h - 8];
        const hits = ys.map((y) => {
          const probe = document.elementFromPoint(8, y);
          return probe === el || el.contains(probe);
        });
        return { present: true, hits, position: getComputedStyle(el).position, gap: 0 };
      });
      expect(probes.present).toBe(true);
      expect(probes.position).toBe("sticky");
      expect(probes.hits).toEqual([true, true, true]);
      await page.close();
    }
  });

  it("reduced-height viewport: Help bottom still has a full-height sidebar", async () => {
    const page = await browser.newPage({ locale: "en-US", viewport: { width: 1280, height: 420 } });
    await page.goto(`${server.url}/`, { waitUntil: "networkidle" });
    await page.waitForSelector("#source-input", { state: "visible", timeout: VISIBLE_TIMEOUT });
    await page.waitForTimeout(2000);
    await page.getByRole("button", { name: "Help", exact: true }).click();
    await page.waitForSelector('h2:has-text("Help")', {
      state: "visible",
      timeout: VISIBLE_TIMEOUT,
    });
    await scrollToBottom(page);
    const m = await sidebarMetrics(page);
    expect(m.docHeight).toBeGreaterThan(m.viewportHeight);
    expectFullViewportCoverage(m);
    await page.close();
  });

  it("Dark theme + Spanish: same bottom-of-Help coverage", async () => {
    const page = await browser.newPage({ locale: "es-PA", colorScheme: "dark" });
    await page.goto(`${server.url}/`, { waitUntil: "networkidle" });
    await page.waitForSelector("#source-input", { state: "visible", timeout: VISIBLE_TIMEOUT });
    await page.waitForTimeout(2000);
    await page.getByRole("button", { name: "Ayuda", exact: true }).click();
    await page.waitForSelector('h2:has-text("Ayuda")', {
      state: "visible",
      timeout: VISIBLE_TIMEOUT,
    });
    await scrollToBottom(page);
    const m = await sidebarMetrics(page);
    expectFullViewportCoverage(m);
    await page.screenshot({ path: join(shots, "help-bottom-dark-es.png") });
    await page.close();
  });

  it("Source and Settings (short views): full-height rail, no horizontal overflow", async () => {
    const page = await openApp("en-US");
    const source = await sidebarMetrics(page);
    expectFullViewportCoverage(source);

    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.waitForSelector("h2", { state: "visible", timeout: VISIBLE_TIMEOUT });
    const settings = await sidebarMetrics(page);
    expectFullViewportCoverage(settings);

    const hOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(hOverflow).toBeLessThanOrEqual(1);
    await page.close();
  });
});
