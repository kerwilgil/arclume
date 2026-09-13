import { createContext, createElement, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { readValidatedPreference, writePreference } from "../preferences";
import { en } from "./en";
import type { Translation } from "./en";
import { es } from "./es";

export type Locale = "en" | "es";

export const DEFAULT_LOCALE: Locale = "en";
const LOCALE_STORAGE_KEY = "locale";

const CATALOGS: Record<Locale, Translation> = { en, es };

export function isLocale(value: string): value is Locale {
  return value === "en" || value === "es";
}

export function getCatalog(locale: Locale): Translation {
  return CATALOGS[locale];
}

/**
 * `navigator.language` starting with "es" → Spanish, everything else →
 * English. No geolocation, no network. Used only when no preference has been
 * persisted yet.
 */
export function detectDefaultLocale(navigatorLanguage: string | undefined): Locale {
  if (navigatorLanguage?.toLowerCase().startsWith("es")) return "es";
  return DEFAULT_LOCALE;
}

function initialLocale(): Locale {
  const stored = readValidatedPreference(LOCALE_STORAGE_KEY, isLocale);
  if (stored !== undefined) return stored;
  const navLang = typeof navigator === "object" ? navigator.language : undefined;
  return detectDefaultLocale(navLang);
}

export interface I18nValue {
  locale: Locale;
  t: Translation;
  setLocale: (locale: Locale) => void;
}

const I18nContext = createContext<I18nValue | undefined>(undefined);

export function I18nProvider(props: { children: ReactNode }): JSX.Element {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    writePreference(LOCALE_STORAGE_KEY, next);
  }, []);

  const value = useMemo<I18nValue>(
    () => ({ locale, t: getCatalog(locale), setLocale }),
    [locale, setLocale],
  );

  return createElement(I18nContext.Provider, { value }, props.children);
}

/** Access the active locale, its catalog (`t`), and the setter. */
export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n() must be used within <I18nProvider>");
  return ctx;
}

export type { Translation } from "./en";
