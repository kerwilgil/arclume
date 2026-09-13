/**
 * Theme resolution: abstract `ThemeTokens` → concrete CSS custom properties.
 *
 * The canonical source is always `deck.theme.name` (+ `deck.theme.tokensRef`).
 * This module never invents a theme and never accepts an override — it resolves
 * the theme the deck declares into the variables the stylesheet consumes.
 *
 * The two themes are made to look genuinely different: `minimal` is flat,
 * editorial, roomy, hairline dividers, restrained accent; `executive` is
 * higher-contrast, raised cards, a stronger display scale, a more assertive
 * accent — driven by the Phase 4 token differences plus a per-theme palette.
 */

import type { Theme, ThemeTokens } from "../../visual/theme.js";

/** Concrete palettes, one per implemented theme. Renderer-owned, deterministic. */
const PALETTE: Record<"minimal" | "executive", Record<string, string>> = {
  minimal: {
    background: "#ffffff",
    surface: "#ffffff",
    "text-primary": "#1a1a1a",
    "text-secondary": "#5b5b5b",
    accent: "#3a5f8a",
    positive: "#2f7d4f",
    warning: "#8a6d1f",
    negative: "#9c3535",
    neutral: "#6b6b6b",
    "surface-border": "#e2e2e2",
    "stage-ground": "#f4f3f1",
  },
  executive: {
    background: "#ffffff",
    surface: "#ffffff",
    "text-primary": "#0f1720",
    "text-secondary": "#48566a",
    accent: "#1f4fd6",
    positive: "#1f7a44",
    warning: "#9a6b00",
    negative: "#b02a2a",
    neutral: "#5a6675",
    "surface-border": "#dfe4ec",
    "stage-ground": "#eef1f6",
  },
};

const FONT_STACKS: Record<ThemeTokens["fontFamilyRole"], string> = {
  sans: "ui-sans-serif, system-ui, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  serif: "ui-serif, Georgia, Cambria, 'Times New Roman', Times, serif",
  "mono-accent": "ui-monospace, 'Cascadia Mono', 'Segoe UI Mono', Menlo, Consolas, monospace",
};

/** Abstract type-scale step → rem size. */
const SCALE_REM: Record<string, number> = {
  "scale.sm": 0.82,
  "scale.md": 1,
  "scale.lg": 1.32,
  "scale.xl": 1.85,
  "scale.2xl": 2.55,
  "scale.3xl": 3.35,
};
const WEIGHT: Record<string, number> = {
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
};
const SPACE_BASE_REM: Record<ThemeTokens["spacingScale"], number> = {
  compact: 0.55,
  regular: 0.78,
  roomy: 1.05,
};
const RADIUS_PX: Record<ThemeTokens["radius"], number> = { none: 0, sm: 6, md: 14 };
const BORDER_PX: Record<ThemeTokens["border"], number> = { none: 0, hairline: 1, solid: 2 };
const SHADOW_CSS: Record<ThemeTokens["shadow"], string> = {
  none: "none",
  soft: "0 2px 10px rgba(15, 23, 32, 0.08)",
  strong: "0 10px 34px rgba(15, 23, 32, 0.16)",
};

function typeVar(spec: string): { size: number; weight: number } {
  const [scale, weight] = spec.split("/");
  return {
    size: SCALE_REM[scale ?? "scale.md"] ?? 1,
    weight: WEIGHT[weight ?? "regular"] ?? 400,
  };
}

/**
 * Return the body of a CSS rule (custom properties only) for the given theme.
 * The caller places it on `.arclume-deck[data-arclume-theme="<name>"]`.
 */
export function resolveThemeVars(theme: Theme): string {
  const t = theme.tokens;
  const pal = PALETTE[theme.deckThemeName];
  const s = SPACE_BASE_REM[t.spacingScale];
  const type = t.typography;

  const lines: string[] = [];
  const push = (k: string, v: string): void => {
    lines.push(`  --arclume-${k}: ${v};`);
  };

  for (const [role, value] of Object.entries(pal)) push(`color-${role}`, value);

  push("font-body", FONT_STACKS[t.fontFamilyRole]);
  push("font-display", FONT_STACKS[t.fontFamilyRole]);
  push("font-mono", FONT_STACKS["mono-accent"]);

  for (const [role, spec] of Object.entries(type)) {
    const { size, weight } = typeVar(spec);
    push(`fs-${role}`, `${size.toFixed(3)}rem`);
    push(`fw-${role}`, String(weight));
  }

  push("space-1", `${(s * 0.5).toFixed(3)}rem`);
  push("space-2", `${s.toFixed(3)}rem`);
  push("space-3", `${(s * 1.6).toFixed(3)}rem`);
  push("space-4", `${(s * 2.4).toFixed(3)}rem`);
  push("radius", `${RADIUS_PX[t.radius]}px`);
  push("border-width", `${BORDER_PX[t.border]}px`);
  push("border-color", pal["surface-border"] ?? "#e2e2e2");
  push("shadow", SHADOW_CSS[t.shadow]);
  push("surface-fill", t.surfaceStyle === "raised" ? (pal["surface"] ?? "#fff") : "transparent");
  push(
    "divider",
    `${Math.max(1, BORDER_PX[t.border])}px solid ${pal["surface-border"] ?? "#e2e2e2"}`,
  );
  push("diagram-node-fill", t.diagramStyle === "filled" ? "var(--arclume-color-surface)" : "none");
  push("diagram-stroke", "var(--arclume-color-text-secondary)");
  push("accent-weight", theme.deckThemeName === "executive" ? "700" : "600");

  return lines.join("\n");
}

/** The theme names this renderer can resolve (mirrors Phase 4). */
export const RENDERABLE_THEME_NAMES = ["minimal", "executive"] as const;
export type RenderableThemeName = (typeof RENDERABLE_THEME_NAMES)[number];

export function isRenderableTheme(name: string): name is RenderableThemeName {
  return (RENDERABLE_THEME_NAMES as readonly string[]).includes(name);
}
