/**
 * In-browser geometry measurement + the pure finding derivation over it.
 *
 * The measurement runs inside the page (`page.evaluate`) and only reads layout
 * (`getBoundingClientRect`, `scrollWidth/Height`, `clientWidth/Height`,
 * `getComputedStyle`, `SVGGraphicsElement.getBBox`). The finding derivation is a
 * pure function of the measurement + the viewport policy — no browser, no clock.
 */

import type { Page } from "playwright";
import type { Viewport, VisualFinding } from "./types.js";

/* ------------------------------------------------------------------ */
/* Measurement shapes (returned from the page)                         */
/* ------------------------------------------------------------------ */

export interface BoxMetrics {
  rectW: number;
  rectH: number;
  clientW: number;
  clientH: number;
  scrollW: number;
  scrollH: number;
}

export interface CriticalElement {
  kind: "title" | "keymessage" | "block" | "diagram";
  id: string | null;
  blockType: string | null;
  diagramId: string | null;
  /** Layout box relative to the slide content origin (scroll-independent). */
  x: number;
  y: number;
  right: number;
  bottom: number;
  w: number;
  h: number;
  scrollW: number;
  clientW: number;
  scrollH: number;
  clientH: number;
  overflowX: string;
  overflowY: string;
  clipped: boolean;
  scrollable: boolean;
  offLeft: number;
  offTop: number;
  offRight: number;
  offBottom: number;
  zeroSize: boolean;
  svg: {
    rectW: number;
    rectH: number;
    viewBoxW: number;
    viewBoxH: number;
    bboxW: number;
    bboxH: number;
    hasViewBox: boolean;
  } | null;
}

export interface LocalScrollElement {
  selector: string;
  blockId: string | null;
  diagramId: string | null;
  axis: "x" | "y";
  scroll: number;
  client: number;
}

export interface SlideMeasurement {
  slideId: string;
  slideIndex: number;
  totalSlides: number;
  activeCount: number;
  ariaOk: boolean;
  prevDisabled: boolean;
  nextDisabled: boolean;
  counterCurrent: number;
  counterTotal: number;
  progressWidthPct: number;
  stagePresent: boolean;
  stage: BoxMetrics | null;
  stageRatio: number;
  slide: BoxMetrics;
  overflowX: number;
  overflowY: number;
  criticals: CriticalElement[];
  localScrolls: LocalScrollElement[];
  controls: { present: boolean; intersectionPx: number; rectH: number } | null;
}

/* ------------------------------------------------------------------ */
/* The page-side measurement                                           */
/* ------------------------------------------------------------------ */

/** Measure the currently active slide. Assumes the viewer runtime has run. */
export async function measureActiveSlide(page: Page): Promise<SlideMeasurement> {
  return page.evaluate(() => {
    const CLIP = new Set(["hidden", "clip"]);
    const SCROLLY = new Set(["auto", "scroll"]);
    const num = (v: number): number => (Number.isFinite(v) ? Math.round(v * 100) / 100 : 0);

    const deck = document.querySelector(".arclume-deck");
    const stageEl = document.querySelector(".arclume-stage") as HTMLElement | null;
    const slideEl = document.querySelector(".arclume-slide.is-active") as HTMLElement | null;
    const allSlides = Array.prototype.slice.call(
      document.querySelectorAll(".arclume-slide"),
    ) as HTMLElement[];
    const controlsEl = document.querySelector(".arclume-controls") as HTMLElement | null;
    const barEl = document.querySelector(".arclume-progress-bar") as HTMLElement | null;
    const counterEl = document.querySelector(".arclume-counter") as HTMLElement | null;
    const counterCur = document.querySelector(".arclume-counter-current");
    const counterTot = document.querySelector(".arclume-counter-total");
    const btnPrev = document.querySelector(".arclume-prev") as HTMLButtonElement | null;
    const btnNext = document.querySelector(".arclume-next") as HTMLButtonElement | null;

    const box = (
      el: HTMLElement,
    ): {
      rectW: number;
      rectH: number;
      clientW: number;
      clientH: number;
      scrollW: number;
      scrollH: number;
    } => {
      const r = el.getBoundingClientRect();
      return {
        rectW: num(r.width),
        rectH: num(r.height),
        clientW: el.clientWidth,
        clientH: el.clientHeight,
        scrollW: el.scrollWidth,
        scrollH: el.scrollHeight,
      };
    };

    const stage = stageEl ? box(stageEl) : null;
    const stageRatio = stage && stage.rectH > 0 ? num(stage.rectW / stage.rectH) : 0;

    if (!slideEl) {
      return {
        slideId: "",
        slideIndex: -1,
        totalSlides: allSlides.length,
        activeCount: document.querySelectorAll(".arclume-slide.is-active").length,
        ariaOk: false,
        prevDisabled: !!btnPrev?.disabled,
        nextDisabled: !!btnNext?.disabled,
        counterCurrent: counterCur ? Number(counterCur.textContent) : 0,
        counterTotal: counterTot ? Number(counterTot.textContent) : 0,
        progressWidthPct: 0,
        stagePresent: !!stageEl,
        stage,
        stageRatio,
        slide: { rectW: 0, rectH: 0, clientW: 0, clientH: 0, scrollW: 0, scrollH: 0 },
        overflowX: 0,
        overflowY: 0,
        criticals: [],
        localScrolls: [],
        controls: null,
      };
    }

    const sRect = slideEl.getBoundingClientRect();
    const scrollLeft = slideEl.scrollLeft;
    const scrollTop = slideEl.scrollTop;
    const slide = box(slideEl);

    const rel = (el: Element) => {
      const r = el.getBoundingClientRect();
      const x = num(r.left - sRect.left + scrollLeft);
      const y = num(r.top - sRect.top + scrollTop);
      return {
        x,
        y,
        right: num(x + r.width),
        bottom: num(y + r.height),
        w: num(r.width),
        h: num(r.height),
      };
    };

    const collectCriticals = (): CriticalMeasure[] => {
      const out: CriticalMeasure[] = [];
      const add = (el: HTMLElement, kind: "title" | "keymessage" | "block" | "diagram"): void => {
        const cs = getComputedStyle(el);
        const rr = rel(el);
        const scrollW = el.scrollWidth;
        const clientW = el.clientWidth;
        const scrollH = el.scrollHeight;
        const clientH = el.clientHeight;
        const overflowX = cs.overflowX;
        const overflowY = cs.overflowY;
        const clippedX = scrollW > clientW + 1 && CLIP.has(overflowX);
        const clippedY = scrollH > clientH + 1 && CLIP.has(overflowY);
        const scrollableX = scrollW > clientW + 1 && SCROLLY.has(overflowX);
        const scrollableY = scrollH > clientH + 1 && SCROLLY.has(overflowY);

        let svg: CriticalMeasure["svg"] = null;
        if (kind === "diagram") {
          const svgEl = el.querySelector("svg") as SVGSVGElement | null;
          if (svgEl) {
            const sr = svgEl.getBoundingClientRect();
            let bboxW = 0;
            let bboxH = 0;
            try {
              const b = (svgEl as unknown as SVGGraphicsElement).getBBox();
              bboxW = num(b.width);
              bboxH = num(b.height);
            } catch {
              /* getBBox can throw on a detached / zero-size SVG */
            }
            const vb = svgEl.viewBox?.baseVal;
            svg = {
              rectW: num(sr.width),
              rectH: num(sr.height),
              viewBoxW: vb ? num(vb.width) : 0,
              viewBoxH: vb ? num(vb.height) : 0,
              bboxW,
              bboxH,
              hasViewBox: !!(vb && vb.width > 0 && vb.height > 0),
            };
          }
        }

        out.push({
          kind,
          id: el.getAttribute("data-block-id"),
          blockType: el.getAttribute("data-block-type"),
          diagramId: el.getAttribute("data-diagram-id"),
          x: rr.x,
          y: rr.y,
          right: rr.right,
          bottom: rr.bottom,
          w: rr.w,
          h: rr.h,
          scrollW,
          clientW,
          scrollH,
          clientH,
          overflowX,
          overflowY,
          clipped: clippedX || clippedY,
          scrollable: scrollableX || scrollableY,
          offLeft: num(Math.max(0, -rr.x)),
          offTop: num(Math.max(0, -rr.y)),
          offRight: num(Math.max(0, rr.right - slide.scrollW)),
          offBottom: num(Math.max(0, rr.bottom - slide.scrollH)),
          zeroSize: rr.w <= 0 || rr.h <= 0,
          svg,
        });
      };

      const title = slideEl.querySelector(".arclume-slide-title") as HTMLElement | null;
      if (title) add(title, "title");
      const km = slideEl.querySelector(".arclume-keymessage") as HTMLElement | null;
      if (km) add(km, "keymessage");
      for (const b of Array.prototype.slice.call(
        slideEl.querySelectorAll(".arclume-block"),
      ) as HTMLElement[]) {
        add(b, "block");
      }
      for (const d of Array.prototype.slice.call(
        slideEl.querySelectorAll(".arclume-diagram"),
      ) as HTMLElement[]) {
        add(d, "diagram");
      }
      return out;
    };

    interface CriticalMeasure {
      kind: "title" | "keymessage" | "block" | "diagram";
      id: string | null;
      blockType: string | null;
      diagramId: string | null;
      x: number;
      y: number;
      right: number;
      bottom: number;
      w: number;
      h: number;
      scrollW: number;
      clientW: number;
      scrollH: number;
      clientH: number;
      overflowX: string;
      overflowY: string;
      clipped: boolean;
      scrollable: boolean;
      offLeft: number;
      offTop: number;
      offRight: number;
      offBottom: number;
      zeroSize: boolean;
      svg: {
        rectW: number;
        rectH: number;
        viewBoxW: number;
        viewBoxH: number;
        bboxW: number;
        bboxH: number;
        hasViewBox: boolean;
      } | null;
    }

    const localScrolls: Array<{
      selector: string;
      blockId: string | null;
      diagramId: string | null;
      axis: "x" | "y";
      scroll: number;
      client: number;
    }> = [];
    for (const sel of [".arclume-table-wrap", ".arclume-code", ".arclume-diagram"]) {
      for (const el of Array.prototype.slice.call(slideEl.querySelectorAll(sel)) as HTMLElement[]) {
        const blockEl = el.closest(".arclume-block");
        const blockId = blockEl ? blockEl.getAttribute("data-block-id") : null;
        const diagramId = el.getAttribute("data-diagram-id");
        if (el.scrollWidth > el.clientWidth + 1) {
          localScrolls.push({
            selector: sel,
            blockId,
            diagramId,
            axis: "x",
            scroll: el.scrollWidth,
            client: el.clientWidth,
          });
        }
        if (el.scrollHeight > el.clientHeight + 1) {
          localScrolls.push({
            selector: sel,
            blockId,
            diagramId,
            axis: "y",
            scroll: el.scrollHeight,
            client: el.clientHeight,
          });
        }
      }
    }

    let controls: { present: boolean; intersectionPx: number; rectH: number } | null = null;
    if (controlsEl && stageEl) {
      const c = controlsEl.getBoundingClientRect();
      const s = stageEl.getBoundingClientRect();
      const ix = Math.max(0, Math.min(c.right, s.right) - Math.max(c.left, s.left));
      const iy = Math.max(0, Math.min(c.bottom, s.bottom) - Math.max(c.top, s.top));
      controls = { present: true, intersectionPx: num(ix * iy), rectH: num(c.height) };
    } else if (controlsEl) {
      controls = {
        present: true,
        intersectionPx: 0,
        rectH: num(controlsEl.getBoundingClientRect().height),
      };
    }

    const inactive = allSlides.filter((s) => !s.classList.contains("is-active"));
    const ariaOk =
      !slideEl.hasAttribute("aria-hidden") &&
      inactive.every((s) => s.getAttribute("aria-hidden") === "true");

    let progressWidthPct = 0;
    if (barEl) {
      const w = barEl.style.width || getComputedStyle(barEl).width;
      const m = /([\d.]+)%/.exec(w);
      if (m) progressWidthPct = num(Number(m[1]));
      else if (stage && stage.rectW > 0) {
        const px = Number.parseFloat(getComputedStyle(barEl).width);
        const parentPx = Number.parseFloat(
          getComputedStyle(barEl.parentElement as HTMLElement).width,
        );
        if (parentPx > 0) progressWidthPct = num((px / parentPx) * 100);
      }
    }

    return {
      slideId: slideEl.getAttribute("data-slide-id") ?? "",
      slideIndex: Number(slideEl.getAttribute("data-slide-index") ?? "-1"),
      totalSlides: allSlides.length,
      activeCount: document.querySelectorAll(".arclume-slide.is-active").length,
      ariaOk,
      prevDisabled: !!btnPrev?.disabled,
      nextDisabled: !!btnNext?.disabled,
      counterCurrent: counterCur ? Number(counterCur.textContent) : 0,
      counterTotal: counterTot ? Number(counterTot.textContent) : 0,
      progressWidthPct,
      stagePresent: !!stageEl,
      stage,
      stageRatio,
      slide,
      overflowX: num(slide.scrollW - slide.clientW),
      overflowY: num(slide.scrollH - slide.clientH),
      criticals: collectCriticals(),
      localScrolls,
      controls,
    };
  }) as Promise<SlideMeasurement>;
}

/* ------------------------------------------------------------------ */
/* Pure finding derivation                                             */
/* ------------------------------------------------------------------ */

export interface GeometryPolicy {
  /** Declared deck aspect ratio value (e.g. 16/9). `undefined` → skip the check. */
  aspectRatio: number | undefined;
  /** Overflow / off-slide / clipping become ERROR here, WARNING elsewhere. */
  strict: boolean;
}

const CRITICAL_OVERFLOW_TOLERANCE = 2;

const DIAGRAM_BBOX_UTILIZATION_THRESHOLD = 0.3; // content bbox should be at least 30% of viewBox
const EXCESSIVE_WHITESPACE_THRESHOLD = 0.3; // content bbox should be at least 30% of slide
const CANVAS_CENTERING_TOLERANCE = 0.15; // content center within 15% of viewBox center
const TITLE_DIAGRAM_CLEARANCE = 40; // minimum pixels between title bottom and diagram top

function sev(strict: boolean): "error" | "warning" {
  return strict ? "error" : "warning";
}

/** Derive findings for one measured slide. Pure. */
export function geometryFindings(
  m: SlideMeasurement,
  viewport: Viewport,
  policy: GeometryPolicy,
): VisualFinding[] {
  const out: VisualFinding[] = [];
  const base = { viewport: viewport.name, slideId: m.slideId, slideIndex: m.slideIndex };

  // stage present + non-zero
  if (!m.stagePresent || !m.stage || m.stage.rectW <= 0 || m.stage.rectH <= 0) {
    out.push({
      ...base,
      code: "visual/stage-zero-size",
      severity: "error",
      message: "the .arclume-stage is missing or has a zero-size box",
      metrics: {
        present: m.stagePresent,
        rectW: m.stage?.rectW ?? 0,
        rectH: m.stage?.rectH ?? 0,
      },
    });
    return out; // nothing else is meaningful without a stage
  }

  // aspect ratio — canonical viewport only
  if (policy.strict && policy.aspectRatio !== undefined && m.stageRatio > 0) {
    const rel = Math.abs(m.stageRatio - policy.aspectRatio) / policy.aspectRatio;
    if (rel > 0.02) {
      out.push({
        ...base,
        code: "visual/aspect-ratio-mismatch",
        severity: "error",
        message: `stage aspect ratio ${m.stageRatio.toFixed(3)} differs from the declared ratio ${policy.aspectRatio.toFixed(3)}`,
        metrics: {
          measured: m.stageRatio,
          declared: policy.aspectRatio,
          relError: Math.round(rel * 1000) / 1000,
        },
      });
    }
  }

  // slide-level overflow
  if (m.overflowX > CRITICAL_OVERFLOW_TOLERANCE) {
    out.push({
      ...base,
      code: "visual/slide-overflow-x",
      severity: sev(policy.strict),
      message: `slide content is ${m.overflowX}px wider than the slide (scrollWidth ${m.slide.scrollW} > clientWidth ${m.slide.clientW})`,
      metrics: { scrollW: m.slide.scrollW, clientW: m.slide.clientW, overflow: m.overflowX },
    });
  }
  if (m.overflowY > CRITICAL_OVERFLOW_TOLERANCE) {
    out.push({
      ...base,
      code: "visual/slide-overflow-y",
      severity: sev(policy.strict),
      message: `slide content is ${m.overflowY}px taller than the slide (scrollHeight ${m.slide.scrollH} > clientHeight ${m.slide.clientH})`,
      metrics: { scrollH: m.slide.scrollH, clientH: m.slide.clientH, overflow: m.overflowY },
    });
  }

  // per critical element
  for (const c of m.criticals) {
    const el = {
      ...base,
      ...(c.id ? { blockId: c.id } : {}),
      ...(c.diagramId ? { diagramId: c.diagramId } : {}),
    };

    if (c.zeroSize) {
      out.push({
        ...el,
        code: c.kind === "diagram" ? "visual/diagram-zero-size" : "visual/zero-size-element",
        severity: "error",
        message: `${describe(c)} has a zero-size box (${c.w}×${c.h})`,
        metrics: { kind: c.kind, w: c.w, h: c.h },
      });
      continue;
    }

    const off = Math.max(c.offLeft, c.offTop, c.offRight, c.offBottom);
    if (off > CRITICAL_OVERFLOW_TOLERANCE) {
      out.push({
        ...el,
        code: "visual/off-slide",
        severity: sev(policy.strict),
        message: `${describe(c)} is rendered ${off}px outside the slide content area`,
        metrics: {
          kind: c.kind,
          left: c.offLeft,
          top: c.offTop,
          right: c.offRight,
          bottom: c.offBottom,
        },
      });
    }

    if (c.clipped) {
      out.push({
        ...el,
        code: c.kind === "diagram" ? "visual/diagram-clipped" : "visual/text-clipped",
        severity: sev(policy.strict),
        message: `${describe(c)} is clipped by overflow:${CLIP_AXIS(c)} (content ${c.scrollW}×${c.scrollH} > box ${c.clientW}×${c.clientH})`,
        metrics: {
          scrollW: c.scrollW,
          clientW: c.clientW,
          scrollH: c.scrollH,
          clientH: c.clientH,
          overflowX: c.overflowX,
          overflowY: c.overflowY,
        },
      });
    }

    if (c.kind === "diagram" && c.svg) {
      if (c.svg.rectW <= 0 || c.svg.rectH <= 0) {
        out.push({
          ...el,
          code: "visual/diagram-zero-size",
          severity: "error",
          message: "a native diagram SVG has a zero-size rendered box",
          metrics: { rectW: c.svg.rectW, rectH: c.svg.rectH },
        });
      } else if (!c.svg.hasViewBox) {
        out.push({
          ...el,
          code: "visual/diagram-zero-size",
          severity: "error",
          message: "a native diagram SVG has no valid viewBox",
          metrics: { viewBoxW: c.svg.viewBoxW, viewBoxH: c.svg.viewBoxH },
        });
      }
    }
  }

  // local scroll — informational unless it also broke the slide (covered above)
  for (const ls of m.localScrolls) {
    out.push({
      ...base,
      ...(ls.blockId ? { blockId: ls.blockId } : {}),
      ...(ls.diagramId ? { diagramId: ls.diagramId } : {}),
      code: "visual/local-scroll",
      severity: "info",
      message: `${ls.selector} uses local ${ls.axis === "x" ? "horizontal" : "vertical"} scroll (${ls.scroll} > ${ls.client})`,
      metrics: { selector: ls.selector, axis: ls.axis, scroll: ls.scroll, client: ls.client },
    });
  }

  // controls overlap — measured, not inferred from CSS
  if (m.controls?.present && m.controls.intersectionPx > 0) {
    const stageArea = m.stage.rectW * m.stage.rectH;
    const frac = stageArea > 0 ? m.controls.intersectionPx / stageArea : 0;
    const heavy = frac > 0.02;
    out.push({
      ...base,
      code: "visual/controls-overlap",
      severity: heavy && policy.strict ? "error" : "warning",
      message: `the viewer controls overlap the stage by ${Math.round(m.controls.intersectionPx)}px² (${(frac * 100).toFixed(2)}% of the stage)`,
      metrics: {
        intersectionPx: Math.round(m.controls.intersectionPx),
        fraction: Math.round(frac * 1000) / 1000,
      },
    });
  }

  // --- NEW VISUAL QA GATES (1.0.1 Visual Quality Patch) ---

  // 1. Title/keyMessage collision
  const titleEl = m.criticals.find((c) => c.kind === "title");
  const keymessageEl = m.criticals.find((c) => c.kind === "keymessage");
  if (titleEl && keymessageEl) {
    const titleBottom = titleEl.bottom;
    const kmTop = keymessageEl.y;
    if (kmTop < titleBottom + 2) {
      out.push({
        ...base,
        code: "visual/title-keymessage-collision",
        severity: "error",
        message: `keyMessage overlaps title (gap: ${Math.round(kmTop - titleBottom)}px)`,
        metrics: { titleBottom, keymessageTop: kmTop, gap: Math.round(kmTop - titleBottom) },
      });
    }
  }

  // 2. Title/diagram clearance
  const diagramEl = m.criticals.find((c) => c.kind === "diagram");
  if (titleEl && diagramEl && m.stage) {
    const titleBottom = titleEl.bottom;
    const diagramTop = diagramEl.y;
    const clearance = diagramTop - titleBottom;
    if (clearance < TITLE_DIAGRAM_CLEARANCE) {
      out.push({
        ...base,
        ...(diagramEl.diagramId ? { diagramId: diagramEl.diagramId } : {}),
        code: "visual/title-diagram-clearance",
        severity: "error",
        message: `diagram too close to title (clearance: ${Math.round(clearance)}px, minimum: ${TITLE_DIAGRAM_CLEARANCE}px)`,
        metrics: {
          titleBottom,
          diagramTop,
          clearance: Math.round(clearance),
          minimum: TITLE_DIAGRAM_CLEARANCE,
        },
      });
    }
  }
  if (keymessageEl && diagramEl && m.stage) {
    const kmBottom = keymessageEl.bottom;
    const diagramTop = diagramEl.y;
    const clearance = diagramTop - kmBottom;
    if (clearance < TITLE_DIAGRAM_CLEARANCE) {
      out.push({
        ...base,
        ...(diagramEl.diagramId ? { diagramId: diagramEl.diagramId } : {}),
        code: "visual/keymessage-diagram-clearance",
        severity: "error",
        message: `diagram too close to keyMessage (clearance: ${Math.round(clearance)}px, minimum: ${TITLE_DIAGRAM_CLEARANCE}px)`,
        metrics: {
          keymessageBottom: kmBottom,
          diagramTop,
          clearance: Math.round(clearance),
          minimum: TITLE_DIAGRAM_CLEARANCE,
        },
      });
    }
  }

  // 3. Diagram bounding-box utilization (content vs viewBox)
  if (diagramEl?.svg?.hasViewBox && diagramEl.svg.viewBoxW > 0 && diagramEl.svg.viewBoxH > 0) {
    const viewBoxArea = diagramEl.svg.viewBoxW * diagramEl.svg.viewBoxH;
    const contentArea = diagramEl.svg.bboxW * diagramEl.svg.bboxH;
    if (viewBoxArea > 0) {
      const utilization = contentArea / viewBoxArea;
      if (utilization < DIAGRAM_BBOX_UTILIZATION_THRESHOLD) {
        out.push({
          ...base,
          ...(diagramEl.diagramId ? { diagramId: diagramEl.diagramId } : {}),
          code: "visual/diagram-bbox-underutilized",
          severity: sev(policy.strict),
          message: `diagram content uses only ${(utilization * 100).toFixed(1)}% of viewBox (threshold: ${(DIAGRAM_BBOX_UTILIZATION_THRESHOLD * 100).toFixed(1)}%)`,
          metrics: {
            utilization: Math.round(utilization * 1000) / 1000,
            threshold: DIAGRAM_BBOX_UTILIZATION_THRESHOLD,
            contentArea,
            viewBoxArea,
          },
        });
      }
    }
  }

  // 4. Excessive whitespace (slide content vs stage)
  if (m.stage && m.stage.rectW > 0 && m.stage.rectH > 0) {
    const stageArea = m.stage.rectW * m.stage.rectH;
    let contentArea = 0;
    for (const c of m.criticals) {
      if (c.kind !== "diagram" || c.svg?.hasViewBox) {
        contentArea += c.w * c.h;
      }
    }
    if (stageArea > 0) {
      const utilization = contentArea / stageArea;
      if (utilization < EXCESSIVE_WHITESPACE_THRESHOLD && m.criticals.length > 0) {
        out.push({
          ...base,
          code: "visual/excessive-whitespace",
          severity: sev(policy.strict),
          message: `slide content uses only ${(utilization * 100).toFixed(1)}% of stage area (threshold: ${(EXCESSIVE_WHITESPACE_THRESHOLD * 100).toFixed(1)}%)`,
          metrics: {
            utilization: Math.round(utilization * 1000) / 1000,
            threshold: EXCESSIVE_WHITESPACE_THRESHOLD,
            contentArea,
            stageArea,
          },
        });
      }
    }
  }

  // 5. Canvas centering (diagram content centered in viewBox)
  if (diagramEl?.svg?.hasViewBox && diagramEl.svg.viewBoxW > 0 && diagramEl.svg.viewBoxH > 0) {
    const viewBoxCenterX = diagramEl.svg.viewBoxW / 2;
    const viewBoxCenterY = diagramEl.svg.viewBoxH / 2;
    const contentCenterX =
      diagramEl.svg.bboxW > 0
        ? diagramEl.x + diagramEl.svg.bboxW / 2
        : diagramEl.x + diagramEl.w / 2;
    const contentCenterY =
      diagramEl.svg.bboxH > 0
        ? diagramEl.y + diagramEl.svg.bboxH / 2
        : diagramEl.y + diagramEl.h / 2;
    const offsetX = Math.abs(contentCenterX - viewBoxCenterX) / (diagramEl.svg.viewBoxW / 2);
    const offsetY = Math.abs(contentCenterY - viewBoxCenterY) / (diagramEl.svg.viewBoxH / 2);
    const maxOffset = Math.max(offsetX, offsetY);
    if (maxOffset > CANVAS_CENTERING_TOLERANCE) {
      out.push({
        ...base,
        ...(diagramEl.diagramId ? { diagramId: diagramEl.diagramId } : {}),
        code: "visual/diagram-not-centered",
        severity: sev(policy.strict),
        message: `diagram content not centered in viewBox (offset: ${(maxOffset * 100).toFixed(1)}%, tolerance: ${(CANVAS_CENTERING_TOLERANCE * 100).toFixed(1)}%)`,
        metrics: {
          offsetX: Math.round(offsetX * 1000) / 1000,
          offsetY: Math.round(offsetY * 1000) / 1000,
          maxOffset: Math.round(maxOffset * 1000) / 1000,
          tolerance: CANVAS_CENTERING_TOLERANCE,
        },
      });
    }
  }

  // 6. Node collision detection
  const diagramBlocks = m.criticals.filter((c) => c.kind === "block" || c.kind === "diagram");
  for (let i = 0; i < diagramBlocks.length; i++) {
    const a = diagramBlocks[i];
    if (!a) continue;
    for (let j = i + 1; j < diagramBlocks.length; j++) {
      const b = diagramBlocks[j];
      if (!b) continue;
      const overlapX = Math.max(0, Math.min(a.right, b.right) - Math.max(a.x, b.x));
      const overlapY = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y));
      if (overlapX > 2 && overlapY > 2) {
        out.push({
          ...base,
          ...(a.id ? { blockId: a.id } : {}),
          ...(b.id ? { blockId: b.id } : {}),
          ...(a.diagramId ? { diagramId: a.diagramId } : {}),
          ...(b.diagramId ? { diagramId: b.diagramId } : {}),
          code: "visual/node-collision",
          severity: "error",
          message: `elements overlap: ${describe(a)} and ${describe(b)} (overlap: ${Math.round(overlapX)}×${Math.round(overlapY)}px)`,
          metrics: {
            elementA: describe(a),
            elementB: describe(b),
            overlapX: Math.round(overlapX),
            overlapY: Math.round(overlapY),
          },
        });
      }
    }
  }

  return out;
}

function describe(c: {
  kind: string;
  id: string | null;
  diagramId: string | null;
  blockType: string | null;
}): string {
  if (c.kind === "title") return "the slide title";
  if (c.kind === "keymessage") return "the key message";
  if (c.kind === "diagram") return `diagram "${c.diagramId ?? "?"}"`;
  return `block "${c.id ?? "?"}" (${c.blockType ?? "?"})`;
}

function CLIP_AXIS(c: {
  scrollW: number;
  clientW: number;
  scrollH: number;
  clientH: number;
  overflowX: string;
  overflowY: string;
}): string {
  const parts: string[] = [];
  if (c.scrollW > c.clientW + 1) parts.push(`x=${c.overflowX}`);
  if (c.scrollH > c.clientH + 1) parts.push(`y=${c.overflowY}`);
  return parts.join(",") || "hidden";
}
