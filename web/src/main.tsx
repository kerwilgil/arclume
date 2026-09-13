import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { I18nProvider, useI18n } from "./i18n";
import { AppearanceProvider } from "./theme";
import "./styles.css";

/** Keeps `<html lang>` in sync with the active UI locale (accessibility —
 * screen readers and browser language tooling read this attribute). */
function DocumentLangSync(): null {
  const { locale } = useI18n();
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  return null;
}

const el = document.getElementById("root");
if (!el) throw new Error("missing #root");
createRoot(el).render(
  <StrictMode>
    <I18nProvider>
      <AppearanceProvider>
        <DocumentLangSync />
        <App />
      </AppearanceProvider>
    </I18nProvider>
  </StrictMode>,
);
