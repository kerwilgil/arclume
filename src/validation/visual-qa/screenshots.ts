/**
 * Screenshot capture. The browser layer only produces PNG buffers + metadata;
 * the delivery layer decides where (and whether) they land on disk.
 *
 *  - one PNG per slide, of the `.arclume-stage` element, from the capture
 *    viewport, named `slide-<NNN>-<safe-slide-id>.png`;
 *  - one `viewer-overview.png` of the full viewport, showing the stage plus the
 *    fixed controls and progress bar.
 */

import type { Page } from "playwright";
import type { ScreenshotArtifact, Viewport, VisualFinding } from "./types.js";
import { pad3, safeSlug, sha256Bytes } from "./util.js";

async function activeIndex(page: Page): Promise<number> {
  return page.evaluate(() => {
    const a = document.querySelector(".arclume-slide.is-active");
    return a ? Number(a.getAttribute("data-slide-index")) : -1;
  });
}

async function gotoFirst(page: Page, timeoutMs: number): Promise<void> {
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
}

async function pngMeta(buffer: Buffer): Promise<{ width: number; height: number }> {
  // PNG: bytes 16..24 are IHDR width/height, big-endian.
  if (buffer.length >= 24 && buffer.toString("ascii", 12, 16) === "IHDR") {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  return { width: 0, height: 0 };
}

/** Capture every slide + the viewer overview. Assumes `page` is on the capture viewport. */
export async function captureDeckScreenshots(
  page: Page,
  viewport: Viewport,
  slideIds: string[],
  timeoutMs: number,
): Promise<{ artifacts: ScreenshotArtifact[]; findings: VisualFinding[] }> {
  const artifacts: ScreenshotArtifact[] = [];
  const findings: VisualFinding[] = [];
  const total = slideIds.length;

  await gotoFirst(page, timeoutMs);
  const stage = page.locator(".arclume-stage");

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
          code: "visual/screenshot-failed",
          severity: "error",
          viewport: viewport.name,
          slideIndex: i,
          message: `could not navigate to slide index ${i} to capture it`,
        });
        continue;
      }
    }
    const id = slideIds[i] ?? `slide-${i}`;
    try {
      const buffer = await stage.screenshot({ animations: "disabled", timeout: timeoutMs });
      const { width, height } = await pngMeta(buffer);
      const name = `slide-${pad3(i + 1)}-${safeSlug(id)}.png`;
      artifacts.push({
        viewport: viewport.name,
        slideId: id,
        index: i + 1,
        kind: "slide",
        width,
        height,
        bytes: buffer.length,
        sha256: sha256Bytes(buffer),
        path: `screenshots/${name}`,
        buffer,
      });
    } catch (cause) {
      findings.push({
        code: "visual/screenshot-failed",
        severity: "error",
        viewport: viewport.name,
        slideId: id,
        slideIndex: i,
        message: `stage screenshot failed for slide "${id}": ${(cause as Error).message}`,
      });
    }
  }

  // viewer overview — full viewport, controls + progress visible
  await gotoFirst(page, timeoutMs);
  await activeIndex(page);
  try {
    const buffer = await page.screenshot({ animations: "disabled", timeout: timeoutMs });
    const { width, height } = await pngMeta(buffer);
    artifacts.push({
      viewport: viewport.name,
      slideId: slideIds[0] ?? "",
      index: 0,
      kind: "viewer",
      width,
      height,
      bytes: buffer.length,
      sha256: sha256Bytes(buffer),
      path: "screenshots/viewer-overview.png",
      buffer,
    });
  } catch (cause) {
    findings.push({
      code: "visual/screenshot-failed",
      severity: "error",
      viewport: viewport.name,
      message: `viewer overview screenshot failed: ${(cause as Error).message}`,
    });
  }

  return { artifacts, findings };
}
