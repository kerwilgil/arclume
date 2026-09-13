import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";
import { readValidatedPreference, writePreference } from "../preferences";

export type Appearance = "system" | "light" | "dark";
export type EffectiveTheme = "light" | "dark";

export const DEFAULT_APPEARANCE: Appearance = "system";
const APPEARANCE_STORAGE_KEY = "appearance";
const DARK_MEDIA_QUERY = "(prefers-color-scheme: dark)";

export function isAppearance(value: string): value is Appearance {
  return value === "system" || value === "light" || value === "dark";
}

/** Pure — no DOM access. The one place appearance + OS preference meet. */
export function resolveEffectiveTheme(
  appearance: Appearance,
  systemPrefersDark: boolean,
): EffectiveTheme {
  if (appearance === "light") return "light";
  if (appearance === "dark") return "dark";
  return systemPrefersDark ? "dark" : "light";
}

function systemPrefersDarkNow(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia(DARK_MEDIA_QUERY).matches;
  } catch {
    return false;
  }
}

function initialAppearance(): Appearance {
  return readValidatedPreference(APPEARANCE_STORAGE_KEY, isAppearance) ?? DEFAULT_APPEARANCE;
}

function applyThemeAttribute(theme: EffectiveTheme): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.style.colorScheme = theme;
}

export interface AppearanceValue {
  appearance: Appearance;
  effectiveTheme: EffectiveTheme;
  setAppearance: (appearance: Appearance) => void;
}

const AppearanceContext = createContext<AppearanceValue | undefined>(undefined);

export function AppearanceProvider(props: { children: ReactNode }): JSX.Element {
  const [appearance, setAppearanceState] = useState<Appearance>(initialAppearance);
  const [systemPrefersDark, setSystemPrefersDark] = useState<boolean>(systemPrefersDarkNow);

  // Live reaction to the OS theme changing while ARCLUME is open — computed
  // once at mount is not enough; "system" must keep tracking the OS.
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    let mql: MediaQueryList;
    try {
      mql = window.matchMedia(DARK_MEDIA_QUERY);
    } catch {
      return;
    }
    const onChange = (event: MediaQueryListEvent): void => setSystemPrefersDark(event.matches);
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    }
    // Safari < 14 fallback.
    type LegacyMql = {
      addListener?: (cb: (e: MediaQueryListEvent) => void) => void;
      removeListener?: (cb: (e: MediaQueryListEvent) => void) => void;
    };
    const legacy = mql as unknown as LegacyMql;
    legacy.addListener?.(onChange);
    return () => legacy.removeListener?.(onChange);
  }, []);

  const effectiveTheme = useMemo<EffectiveTheme>(
    () => resolveEffectiveTheme(appearance, systemPrefersDark),
    [appearance, systemPrefersDark],
  );

  useEffect(() => {
    applyThemeAttribute(effectiveTheme);
  }, [effectiveTheme]);

  const setAppearance = useCallback((next: Appearance) => {
    setAppearanceState(next);
    writePreference(APPEARANCE_STORAGE_KEY, next);
  }, []);

  const value = useMemo<AppearanceValue>(
    () => ({ appearance, effectiveTheme, setAppearance }),
    [appearance, effectiveTheme, setAppearance],
  );

  return createElement(AppearanceContext.Provider, { value }, props.children);
}

export function useAppearance(): AppearanceValue {
  const ctx = useContext(AppearanceContext);
  if (!ctx) throw new Error("useAppearance() must be used within <AppearanceProvider>");
  return ctx;
}
