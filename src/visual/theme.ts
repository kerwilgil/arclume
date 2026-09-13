/**
 * Theme token contract (Phase 4).
 *
 * A theme is a bag of **abstract, renderer-independent tokens** — no HTML, no
 * CSS, no hex colours. Phase 5 resolves these into a concrete stylesheet. The
 * `ArclumeDeck` only carries `theme.name` and `theme.tokensRef` (a deterministic
 * hash of the resolved token set); the token table itself lives here.
 *
 * Invariant: a theme never changes content, knowledge references, narrative or
 * meaning. Two themes over the same `SlidePlan` differ only in these tokens.
 */

import { contentHash } from "../determinism/hash.js";

export type ThemeId = "minimal" | "executive";

/** Semantic colour roles. Values are token *names*, never literals. */
export interface ColorRoles {
  background: string;
  surface: string;
  "text-primary": string;
  "text-secondary": string;
  accent: string;
  positive: string;
  warning: string;
  negative: string;
  neutral: string;
}

/** Typographic roles. Values are abstract scale/weight names. */
export interface TypographyRoles {
  display: string;
  title: string;
  heading: string;
  body: string;
  caption: string;
  metric: string;
}

export interface ThemeTokens {
  fontFamilyRole: "sans" | "serif" | "mono-accent";
  typography: TypographyRoles;
  spacingScale: "compact" | "regular" | "roomy";
  radius: "none" | "sm" | "md";
  border: "none" | "hairline" | "solid";
  shadow: "none" | "soft" | "strong";
  surfaceStyle: "flat" | "raised";
  color: ColorRoles;
  /** Visual density preference this theme leans toward. */
  density: "lean" | "balanced" | "dense";
  diagramStyle: "outline" | "soft" | "filled";
}

export interface Theme {
  id: ThemeId;
  /** Maps 1:1 to `ArclumeDeck.theme.name` (both are in the IR enum). */
  deckThemeName: "minimal" | "executive";
  mode: "auto" | "light" | "dark";
  aspectRatio: "16:9" | "16:10" | "4:3";
  tokens: ThemeTokens;
}

const SEMANTIC_COLORS: ColorRoles = {
  background: "color.background",
  surface: "color.surface",
  "text-primary": "color.text.primary",
  "text-secondary": "color.text.secondary",
  accent: "color.accent",
  positive: "color.positive",
  warning: "color.warning",
  negative: "color.negative",
  neutral: "color.neutral",
};

/** Minimal: quiet, editorial, lots of whitespace, outline diagrams. */
export const minimalTheme: Theme = {
  id: "minimal",
  deckThemeName: "minimal",
  mode: "light",
  aspectRatio: "16:9",
  tokens: {
    fontFamilyRole: "sans",
    typography: {
      display: "scale.2xl/regular",
      title: "scale.xl/regular",
      heading: "scale.lg/medium",
      body: "scale.md/regular",
      caption: "scale.sm/regular",
      metric: "scale.2xl/medium",
    },
    spacingScale: "roomy",
    radius: "none",
    border: "hairline",
    shadow: "none",
    surfaceStyle: "flat",
    color: SEMANTIC_COLORS,
    density: "lean",
    diagramStyle: "outline",
  },
};

/** Executive: confident, high-contrast, raised surfaces, filled diagrams. */
export const executiveTheme: Theme = {
  id: "executive",
  deckThemeName: "executive",
  mode: "auto",
  aspectRatio: "16:9",
  tokens: {
    fontFamilyRole: "sans",
    typography: {
      display: "scale.3xl/bold",
      title: "scale.2xl/semibold",
      heading: "scale.lg/semibold",
      body: "scale.md/regular",
      caption: "scale.sm/medium",
      metric: "scale.3xl/bold",
    },
    spacingScale: "regular",
    radius: "md",
    border: "none",
    shadow: "soft",
    surfaceStyle: "raised",
    color: SEMANTIC_COLORS,
    density: "balanced",
    diagramStyle: "filled",
  },
};

const THEMES: Record<ThemeId, Theme> = {
  minimal: minimalTheme,
  executive: executiveTheme,
};

/** Theme ids implemented in Phase 4. `corporate` / `technical` / `futuristic` are PLANNED. */
export const THEME_IDS: readonly ThemeId[] = ["minimal", "executive"];

export function getTheme(id: ThemeId): Theme {
  const theme = THEMES[id];
  if (!theme)
    throw new Error(`arclume: no theme "${id}" (Phase 4 implements: ${THEME_IDS.join(", ")})`);
  return theme;
}

/**
 * Deterministic id for a theme's resolved token set — the value stamped as
 * `ArclumeDeck.theme.tokensRef`. Stable across runs; changes only when the
 * tokens change.
 */
export function themeTokensRef(theme: Theme): string {
  return `tokens:${theme.id}:${contentHash(theme.tokens).slice("sha256:".length, "sha256:".length + 16)}`;
}
