/**
 * Token-level contrast QA.
 *
 * Reads the *resolved* theme custom properties from the deck root and checks the
 * principal text/background pairs against the WCAG 2.2 contrast formula. This is
 * a token check, not a per-glyph audit — it never claims "WCAG certified".
 */

import type { Page } from "playwright";
import type { VisualFinding } from "./types.js";

export interface Palette {
  background: string;
  textPrimary: string;
  textSecondary: string;
  accent: string;
}

export async function readPalette(page: Page): Promise<Palette> {
  return page.evaluate(() => {
    const deck = document.querySelector(".arclume-deck") as HTMLElement | null;
    const cs = deck ? getComputedStyle(deck) : null;
    const v = (name: string): string => (cs ? cs.getPropertyValue(name).trim() : "");
    return {
      background: v("--arclume-color-background") || v("--arclume-color-surface"),
      textPrimary: v("--arclume-color-text-primary"),
      textSecondary: v("--arclume-color-text-secondary"),
      accent: v("--arclume-color-accent"),
    };
  });
}

/** Parse `#rgb` / `#rrggbb` / `rgb(...)` / `rgba(...)` → [r,g,b] 0-255, or undefined. */
function parseColor(raw: string): [number, number, number] | undefined {
  const s = raw.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(s);
  if (hex) {
    const h = hex[1] as string;
    if (h.length === 3) {
      return [
        Number.parseInt(h[0] as string, 16) * 17,
        Number.parseInt(h[1] as string, 16) * 17,
        Number.parseInt(h[2] as string, 16) * 17,
      ];
    }
    return [
      Number.parseInt(h.slice(0, 2), 16),
      Number.parseInt(h.slice(2, 4), 16),
      Number.parseInt(h.slice(4, 6), 16),
    ];
  }
  const rgb = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(s);
  if (rgb) {
    return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  }
  return undefined;
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(rgb: [number, number, number]): number {
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

/** WCAG contrast ratio, 1..21. Returns `undefined` if a colour cannot be parsed. */
export function contrastRatio(a: string, b: string): number | undefined {
  const ca = parseColor(a);
  const cb = parseColor(b);
  if (!ca || !cb) return undefined;
  const la = luminance(ca);
  const lb = luminance(cb);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

export function contrastFindings(palette: Palette, viewportName: string): VisualFinding[] {
  const out: VisualFinding[] = [];
  const pairs: Array<{ role: string; fg: string; min: number }> = [
    { role: "text-primary", fg: palette.textPrimary, min: 4.5 },
    { role: "text-secondary", fg: palette.textSecondary, min: 4.5 },
    { role: "accent", fg: palette.accent, min: 3 },
  ];
  for (const p of pairs) {
    const ratio = contrastRatio(p.fg, palette.background);
    if (ratio === undefined) continue;
    if (ratio < p.min) {
      out.push({
        code: "visual/contrast-low",
        severity: ratio < 3 ? "error" : "warning",
        viewport: viewportName,
        message: `${p.role} on background contrast is ${ratio.toFixed(2)}:1 (target ${p.min}:1)`,
        metrics: { role: p.role, ratio: Math.round(ratio * 100) / 100, target: p.min },
      });
    }
  }
  return out;
}
