/**
 * Physically drive the self-contained viewer in Chromium and assert its
 * invariants. This is not a source scan — every button is really clicked, every
 * key really pressed, and the resulting DOM state is read back.
 */

import type { Page } from "playwright";
import type { Viewport, VisualFinding } from "./types.js";

export interface ViewerInventory {
  slideIds: string[];
  total: number;
}

interface ActiveState {
  index: number;
  id: string;
  activeCount: number;
  ariaOk: boolean;
  counterCurrent: number;
  counterTotal: number;
  prevDisabled: boolean;
  nextDisabled: boolean;
  progressPct: number;
  focusIsActiveSlide: boolean;
  hash: string;
}

async function readActive(page: Page): Promise<ActiveState> {
  return page.evaluate(() => {
    const slides = Array.from(document.querySelectorAll(".arclume-slide")) as HTMLElement[];
    const active = document.querySelector(".arclume-slide.is-active") as HTMLElement | null;
    const inactive = slides.filter((s) => !s.classList.contains("is-active"));
    const cur = document.querySelector(".arclume-counter-current");
    const tot = document.querySelector(".arclume-counter-total");
    const bar = document.querySelector(".arclume-progress-bar") as HTMLElement | null;
    const prev = document.querySelector(".arclume-prev") as HTMLButtonElement | null;
    const next = document.querySelector(".arclume-next") as HTMLButtonElement | null;
    const barPct = (() => {
      if (!bar) return 0;
      const m = /([\d.]+)%/.exec(bar.style.width || "");
      return m ? Number(m[1]) : 0;
    })();
    return {
      index: active ? Number(active.getAttribute("data-slide-index")) : -1,
      id: active ? (active.getAttribute("data-slide-id") ?? "") : "",
      activeCount: document.querySelectorAll(".arclume-slide.is-active").length,
      ariaOk:
        !!active &&
        !active.hasAttribute("aria-hidden") &&
        inactive.every((s) => s.getAttribute("aria-hidden") === "true"),
      counterCurrent: cur ? Number(cur.textContent) : 0,
      counterTotal: tot ? Number(tot.textContent) : 0,
      prevDisabled: !!prev?.disabled,
      nextDisabled: !!next?.disabled,
      progressPct: barPct,
      focusIsActiveSlide: !!active && document.activeElement === active,
      hash: window.location.hash,
    };
  });
}

async function inventory(page: Page): Promise<ViewerInventory> {
  return page.evaluate(() => {
    const slides = Array.from(document.querySelectorAll(".arclume-slide")) as HTMLElement[];
    return {
      slideIds: slides.map((s) => s.getAttribute("data-slide-id") ?? ""),
      total: slides.length,
    };
  });
}

async function waitForIndex(page: Page, index: number, timeoutMs: number): Promise<boolean> {
  try {
    await page.waitForFunction(
      (idx) => {
        const a = document.querySelector(".arclume-slide.is-active");
        return !!a && Number(a.getAttribute("data-slide-index")) === idx;
      },
      index,
      { timeout: timeoutMs },
    );
    return true;
  } catch {
    return false;
  }
}

/** Run the full viewer interaction battery. Leaves the viewer on slide 0. */
export async function runViewerChecks(
  page: Page,
  viewport: Viewport,
  timeoutMs: number,
): Promise<{ findings: VisualFinding[]; inventory: ViewerInventory }> {
  const findings: VisualFinding[] = [];
  const inv = await inventory(page);
  const total = inv.total;
  const vp = viewport.name;
  const add = (code: string, message: string, extra: Partial<VisualFinding> = {}): void => {
    findings.push({ code, severity: "error", viewport: vp, message, ...extra });
  };
  const invariants = (s: ActiveState, where: string): void => {
    if (s.activeCount !== 1) {
      add(
        "visual/viewer-active-count",
        `${where}: ${s.activeCount} slides carry .is-active (want exactly 1)`,
        {
          slideIndex: s.index,
          metrics: { activeCount: s.activeCount },
        },
      );
    }
    if (!s.ariaOk) {
      add(
        "visual/viewer-aria",
        `${where}: aria-hidden is wrong on the active or an inactive slide`,
        {
          slideIndex: s.index,
        },
      );
    }
    if (s.counterTotal !== total) {
      add("visual/viewer-counter", `${where}: counter total is ${s.counterTotal} (want ${total})`, {
        metrics: { counterTotal: s.counterTotal, want: total },
      });
    }
    if (s.index >= 0 && s.counterCurrent !== s.index + 1) {
      add(
        "visual/viewer-counter",
        `${where}: counter shows ${s.counterCurrent} on slide index ${s.index}`,
        {
          slideIndex: s.index,
          metrics: { counterCurrent: s.counterCurrent, index: s.index },
        },
      );
    }
    if (s.index >= 0 && total > 0) {
      const want = Number((((s.index + 1) / total) * 100).toFixed(2));
      if (Math.abs(s.progressPct - want) > 0.5) {
        add(
          "visual/viewer-progress",
          `${where}: progress bar at ${s.progressPct}% (want ~${want}%)`,
          {
            slideIndex: s.index,
            metrics: { progressPct: s.progressPct, want },
          },
        );
      }
    }
  };

  // 1) initial state
  await page.keyboard.press("Home").catch(() => undefined);
  await waitForIndex(page, 0, timeoutMs);
  let s = await readActive(page);
  invariants(s, "initial");
  if (s.index !== 0) add("visual/viewer-nav", `initial slide index is ${s.index} (want 0)`);
  if (!s.prevDisabled) add("visual/viewer-nav", "Previous is not disabled on the first slide");
  if (total === 1 && !s.nextDisabled) {
    add("visual/viewer-nav", "Next is not disabled on a single-slide deck");
  }

  if (total > 1) {
    // 2) button navigation
    await page.click(".arclume-next");
    if (await waitForIndex(page, 1, timeoutMs)) {
      s = await readActive(page);
      invariants(s, "after Next");
      if (s.prevDisabled)
        add("visual/viewer-nav", "Previous stayed disabled after moving off slide 0");
      if (!s.focusIsActiveSlide) {
        add("visual/viewer-focus", "focus did not move to the active slide after Next");
      }
    } else {
      add("visual/viewer-nav", "clicking Next did not advance to slide index 1");
    }

    await page.click(".arclume-prev");
    if (!(await waitForIndex(page, 0, timeoutMs))) {
      add("visual/viewer-nav", "clicking Previous did not return to slide index 0");
    }

    // 3) keyboard navigation — each pair moves forward then back
    const pairs: Array<[string, string]> = [
      ["ArrowRight", "ArrowLeft"],
      ["ArrowDown", "ArrowUp"],
      ["PageDown", "PageUp"],
      [" ", "ArrowLeft"],
    ];
    for (const [fwd, back] of pairs) {
      await page.keyboard.press(fwd === " " ? "Space" : fwd);
      if (!(await waitForIndex(page, 1, timeoutMs))) {
        add("visual/viewer-nav", `key "${fwd}" did not advance the viewer`);
      }
      await page.keyboard.press(back === " " ? "Space" : back);
      if (!(await waitForIndex(page, 0, timeoutMs))) {
        add("visual/viewer-nav", `key "${back}" did not move the viewer back`);
      }
    }

    // 4) Home / End
    await page.keyboard.press("End");
    if (await waitForIndex(page, total - 1, timeoutMs)) {
      s = await readActive(page);
      invariants(s, "after End");
      if (!s.nextDisabled) add("visual/viewer-nav", "Next is not disabled on the last slide");
      // pressing forward again must not move past the end
      await page.keyboard.press("ArrowRight");
      const stay = await readActive(page);
      if (stay.index !== total - 1) {
        add("visual/viewer-nav", `ArrowRight past the end moved to index ${stay.index}`);
      }
    } else {
      add("visual/viewer-nav", "End did not jump to the last slide");
    }
    await page.keyboard.press("Home");
    await waitForIndex(page, 0, timeoutMs);

    // 5) focus after keyboard nav
    await page.keyboard.press("ArrowRight");
    await waitForIndex(page, 1, timeoutMs);
    s = await readActive(page);
    if (!s.focusIsActiveSlide) {
      add("visual/viewer-focus", "focus is not on the active slide after keyboard navigation", {
        slideIndex: s.index,
      });
    }
    await page.keyboard.press("Home");
    await waitForIndex(page, 0, timeoutMs);
  }

  // 6) hash navigation — valid + invalid
  const lastId = inv.slideIds[total - 1] ?? "";
  if (total > 1 && lastId) {
    await page.evaluate((h) => {
      window.location.hash = h;
    }, `#slide=${lastId}`);
    if (await waitForIndex(page, total - 1, timeoutMs)) {
      s = await readActive(page);
      if (s.id !== lastId) {
        add("visual/viewer-hash", `#slide=${lastId} activated "${s.id}" instead`);
      }
    } else {
      add("visual/viewer-hash", `#slide=${lastId} did not navigate to the last slide`);
    }
  }
  await page.evaluate(() => {
    window.location.hash = "#slide=__arclume_does_not_exist__";
  });
  const settled = await waitForIndex(page, 0, timeoutMs);
  s = await readActive(page);
  if (!settled || s.index !== 0) {
    add(
      "visual/viewer-hash",
      `an invalid hash left the viewer on index ${s.index} (want 0, no crash)`,
    );
  }
  invariants(s, "after invalid hash");

  // reset to slide 0 for the geometry sweep
  await page.keyboard.press("Home").catch(() => undefined);
  await waitForIndex(page, 0, timeoutMs);

  return { findings, inventory: inv };
}
