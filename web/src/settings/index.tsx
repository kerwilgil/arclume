import type { Locale } from "../i18n";
import { useI18n } from "../i18n";
import type { Appearance } from "../theme";
import { useAppearance } from "../theme";
import { AiSettingsSection } from "./ai";

/**
 * Settings view. Frontend-only: locale and appearance, both persisted to
 * localStorage (see web/src/preferences.ts). Never mixes with
 * AppState/workspace/knowledge/build — these preferences outlive workspaces.
 *
 * Native <fieldset>/<input type="radio"> rather than a hand-rolled
 * role="radio" pattern: real keyboard arrow-key navigation between options
 * and real screen-reader semantics, for free.
 */
export function SettingsView(): JSX.Element {
  const { t, locale, setLocale } = useI18n();
  const { appearance, setAppearance } = useAppearance();

  const languages: Array<{ value: Locale; label: string }> = [
    { value: "en", label: t.settings.languageEnglish },
    { value: "es", label: t.settings.languageSpanish },
  ];
  const appearances: Array<{ value: Appearance; label: string }> = [
    { value: "system", label: t.settings.appearanceSystem },
    { value: "light", label: t.settings.appearanceLight },
    { value: "dark", label: t.settings.appearanceDark },
  ];

  return (
    <section aria-labelledby="settings-title" className="panel">
      <h2 id="settings-title">{t.settings.title}</h2>

      <fieldset className="pill-fieldset">
        <legend>{t.settings.languageHeading}</legend>
        <div className="row gap">
          {languages.map((l) => (
            <label key={l.value} className={`pill-radio${locale === l.value ? " active" : ""}`}>
              <input
                type="radio"
                name="arclume-language"
                value={l.value}
                checked={locale === l.value}
                onChange={() => setLocale(l.value)}
              />
              {l.label}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="pill-fieldset">
        <legend>{t.settings.appearanceHeading}</legend>
        <div className="row gap">
          {appearances.map((a) => (
            <label key={a.value} className={`pill-radio${appearance === a.value ? " active" : ""}`}>
              <input
                type="radio"
                name="arclume-appearance"
                value={a.value}
                checked={appearance === a.value}
                onChange={() => setAppearance(a.value)}
              />
              {a.label}
            </label>
          ))}
        </div>
        <p className="muted small">{t.settings.appearanceHint}</p>
      </fieldset>

      <AiSettingsSection />
    </section>
  );
}
