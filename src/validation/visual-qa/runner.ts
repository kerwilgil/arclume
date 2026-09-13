/**
 * `runVisualQa` — the browser-bound Visual QA entry point.
 *
 * For each viewport: launch a normalized Chromium context, load the
 * self-contained HTML, observe runtime behaviour, physically drive the viewer,
 * sweep slide geometry, (on the capture viewport) capture screenshots, and
 * collect findings. `valid` is `false` iff any finding is an error.
 */

import type { Browser, Page } from "playwright";
import { VisualQaError } from "../../errors.js";
import { launchChromium, loadDeckHtml, newNormalizedContext, observe } from "./browser.js";
import { contrastFindings, readPalette } from "./contrast.js";
import { runtimeFindings, sortFindings, summarizeViewport, tally } from "./findings.js";
import {
  type GeometryPolicy,
  type SlideMeasurement,
  geometryFindings,
  measureActiveSlide,
} from "./geometry.js";
import { captureDeckScreenshots } from "./screenshots.js";
import {
  CANONICAL_VIEWPORT,
  DEFAULT_VIEWPORTS,
  type ScreenshotArtifact,
  VISUAL_QA_VERSION,
  type Viewport,
  type ViewportResult,
  type VisualFinding,
  type VisualQaOptions,
  type VisualQaResult,
  type VisualQaRun,
} from "./types.js";
import { aspectRatioValue, sha256Utf8 } from "./util.js";
import { runViewerChecks } from "./viewer-checks.js";

const DEFAULT_TIMEOUT_MS = 15000;

async function readDomAspectRatio(browser: Browser, html: string): Promise<string | undefined> {
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    await page.setContent(html, { waitUntil: "load" });
    const v = await page.evaluate(() => {
      const d = document.querySelector(".arclume-deck");
      return d ? d.getAttribute("data-arclume-aspect-ratio") : null;
    });
    return v ?? undefined;
  } finally {
    await ctx.close();
  }
}

async function sweepGeometry(
  page: Page,
  viewport: Viewport,
  policy: GeometryPolicy,
  total: number,
  timeoutMs: number,
): Promise<{ measurements: SlideMeasurement[]; findings: VisualFinding[] }> {
  const measurements: SlideMeasurement[] = [];
  const findings: VisualFinding[] = [];
  // start at slide 0
  await page.keyboard.press("Home").catch(() => undefined);
  await page
    .waitForFunction(
      () => {
        const a = document.querySelector(".arclume-slide.is-active");
        return !!a && Number(a.getAttribute("data-slide-index")) === 0;
      },
      undefined,
      { timeout: timeoutMs },
    )
    .catch(() => undefined);

  for (let i = 0; i < total; i += 1) {
    if (i > 0) {
      await page.click(".arclume-next");
      try {
        await page.waitForFunction(
          (idx) => {
            const a = document.querySelector(".arclume-slide.is-active");
            return !!a && Number(a.getAttribute("data-slide-index")) === idx;
          },
          i,
          { timeout: timeoutMs },
        );
      } catch {
        findings.push({
          code: "visual/viewer-nav",
          severity: "error",
          viewport: viewport.name,
          slideIndex: i,
          message: `geometry sweep could not reach slide index ${i}`,
        });
        break;
      }
    }
    const m = await measureActiveSlide(page);
    measurements.push(m);
    findings.push(...geometryFindings(m, viewport, policy));
  }
  return { measurements, findings };
}

export async function runVisualQa(
  html: string,
  options: VisualQaOptions = {},
): Promise<VisualQaRun> {
  if (typeof html !== "string" || !html.startsWith("<!doctype html>")) {
    throw new VisualQaError("runVisualQa expects a rendered self-contained HTML document", {
      code: "visual/invalid-input",
    });
  }
  // Identity of the exact document this run validates. Derived here from the
  // real input — never accepted from the caller.
  const inputHtmlSha256 = sha256Utf8(html);
  const viewports = (options.viewports ?? DEFAULT_VIEWPORTS).slice();
  if (viewports.length === 0) {
    throw new VisualQaError("at least one viewport is required", { code: "visual/invalid-input" });
  }
  // viewport matrix must be well-formed: unique names, positive dimensions/DPR
  const names = new Set<string>();
  for (const vp of viewports) {
    if (typeof vp.name !== "string" || vp.name.length === 0) {
      throw new VisualQaError("every viewport needs a non-empty name", {
        code: "visual/invalid-input",
      });
    }
    if (names.has(vp.name)) {
      throw new VisualQaError(`duplicate viewport name "${vp.name}" in the matrix`, {
        code: "visual/invalid-input",
      });
    }
    names.add(vp.name);
    if (!(vp.width > 0) || !(vp.height > 0) || !(vp.deviceScaleFactor > 0)) {
      throw new VisualQaError(
        `viewport "${vp.name}" has a non-positive width / height / deviceScaleFactor`,
        { code: "visual/invalid-input" },
      );
    }
  }
  const captureName = options.captureViewport ?? CANONICAL_VIEWPORT.name;
  // if screenshots are requested, the capture viewport MUST be in the matrix —
  // otherwise a "valid" result would carry zero screenshots.
  if (options.screenshots !== false && !names.has(captureName)) {
    throw new VisualQaError(
      `captureViewport "${captureName}" is not present in the viewport matrix (${[...names].join(", ")})`,
      { code: "visual/invalid-input" },
    );
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const browser = await launchChromium(
    options.channel !== undefined ? { channel: options.channel } : {},
  );
  const browserVersion = browser.version();

  const findings: VisualFinding[] = [];
  const artifacts: ScreenshotArtifact[] = [];
  const viewportResults: ViewportResult[] = [];
  let slideCount = 0;

  try {
    const declaredAspect =
      options.aspectRatio ?? (await readDomAspectRatio(browser, html)) ?? "16:9";
    const aspectValue = aspectRatioValue(declaredAspect);

    for (const vp of viewports) {
      const strict = vp.name === CANONICAL_VIEWPORT.name;
      const policy: GeometryPolicy = { aspectRatio: aspectValue, strict };

      const ctx = await newNormalizedContext(browser, vp);
      ctx.setDefaultTimeout(timeoutMs);
      const page = await ctx.newPage();
      const obs = observe(page);

      try {
        await loadDeckHtml(page, html, timeoutMs);
      } catch (cause) {
        findings.push({
          code: "visual/page-error",
          severity: "error",
          viewport: vp.name,
          message: `the document failed to load: ${(cause as Error).message}`,
        });
        await ctx.close();
        viewportResults.push(summarizeViewport(vp, findings, slideCount));
        continue;
      }

      // physically drive the viewer
      const viewer = await runViewerChecks(page, vp, timeoutMs);
      findings.push(...viewer.findings);
      const total = viewer.inventory.total;
      slideCount = total;

      // geometry sweep
      const geo = await sweepGeometry(page, vp, policy, total, timeoutMs);
      findings.push(...geo.findings);

      // contrast (token-level; palette is viewport-independent but cheap to read)
      if (options.contrast !== false) {
        findings.push(...contrastFindings(await readPalette(page), vp.name));
      }

      // screenshots — capture viewport only
      if (options.screenshots !== false && vp.name === captureName) {
        const shots = await captureDeckScreenshots(page, vp, viewer.inventory.slideIds, timeoutMs);
        artifacts.push(...shots.artifacts);
        findings.push(...shots.findings);
      }

      // runtime observations, collected after all interaction
      findings.push(...runtimeFindings(obs, vp.name));

      await ctx.close();
      viewportResults.push(summarizeViewport(vp, findings, total));
    }
  } finally {
    await browser.close();
  }

  // drop a placeholder slideIndex (-1, "no active slide"); keep everything else
  const normalized = findings.map((f) => {
    if (f.slideIndex !== undefined && f.slideIndex < 0) {
      const { slideIndex: _drop, ...rest } = f;
      return rest;
    }
    return f;
  });
  const sorted = sortFindings(normalized, viewports);
  const summary = tally(sorted);
  const identity = {
    name: "chromium" as const,
    version: browserVersion,
    platform: process.platform,
    deviceScaleFactor: 1,
  };
  const result: VisualQaResult = {
    version: VISUAL_QA_VERSION,
    valid: summary.errors === 0,
    browser: identity,
    input: { htmlSha256: inputHtmlSha256 },
    viewports: viewportResults,
    findings: sorted,
    screenshots: artifacts
      .map((a) => {
        const { buffer: _buffer, ...rest } = a;
        return rest;
      })
      .sort((x, y) =>
        x.viewport !== y.viewport ? (x.viewport < y.viewport ? -1 : 1) : x.index - y.index,
      ),
    summary,
  };
  return Object.assign(result, { artifacts });
}
