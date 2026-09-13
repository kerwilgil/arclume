/**
 * ARCLUME theme bootstrap — pre-paint dark/light flash guard.
 *
 * A classic, synchronous, same-origin script (CSP `script-src 'self'`;
 * no inline script, no `unsafe-inline`). Loaded from <head>, before any
 * stylesheet, so it runs and sets `data-theme` before the page paints.
 *
 * Mirrors the logic in web/src/theme/index.ts (appearance preference +
 * prefers-color-scheme). React re-applies the same computation on mount and
 * keeps listening for live OS theme changes; this file only prevents the
 * first-paint flash and is otherwise inert.
 *
 * Never bundled by Vite: copied verbatim from web/public/ to web/dist/, and
 * served by the same static /assets/ route the built JS/CSS already use.
 */
(() => {
  const STORAGE_KEY = "arclume.ui.appearance";
  let theme = "light";
  try {
    const stored = window.localStorage ? window.localStorage.getItem(STORAGE_KEY) : null;
    const appearance =
      stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
    if (appearance === "dark") {
      theme = "dark";
    } else if (appearance === "light") {
      theme = "light";
    } else if (window.matchMedia?.("(prefers-color-scheme: dark)")?.matches) {
      theme = "dark";
    }
  } catch (e) {
    theme = "light";
  }
  const root = document.documentElement;
  root.setAttribute("data-theme", theme);
  root.style.colorScheme = theme;
})();
