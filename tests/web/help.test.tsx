// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { HelpView } from "../../web/src/help";
import { I18nProvider, getCatalog } from "../../web/src/i18n";
import { mount } from "./helpers/dom";

/**
 * The Help view renders directly off the active catalog, so we can exercise
 * both locales deterministically by seeding the persisted preference before
 * mount rather than juggling navigator.language.
 */
function renderHelp(locale: "en" | "es") {
  window.localStorage.setItem("arclume.ui.locale", locale);
  return mount(
    <I18nProvider>
      <HelpView />
    </I18nProvider>,
  );
}

describe("Help — explains every workflow stage and the Agent/Offline distinction", () => {
  for (const locale of ["en", "es"] as const) {
    it(`covers Source, Analysis, Knowledge, Build, Export, Agent and Offline Preview (${locale})`, () => {
      window.localStorage.clear();
      const { container, unmount } = renderHelp(locale);
      const t = getCatalog(locale);
      const text = container.textContent ?? "";

      expect(text).toContain(t.help.whatIsHeading);
      expect(text).toContain(t.help.quickStartHeading);
      expect(text).toContain(t.help.steps.source.title);
      expect(text).toContain(t.help.steps.analysis.title);
      expect(text).toContain(t.help.steps.analysis.agentLabel);
      expect(text).toContain(t.help.steps.analysis.stubLabel);
      expect(text).toContain(t.help.steps.knowledge.title);
      expect(text).toContain(t.help.steps.build.title);
      expect(text).toContain(t.help.steps.export.title);
      expect(text).toContain(t.help.agentWorkflowHeading);
      expect(text).toContain(t.help.privacyHeading);
      expect(text).toContain(t.help.keyTermsHeading);

      // The fact-type vocabulary is a protocol identifier — present verbatim
      // in the Knowledge explanation, unmodified in either locale.
      expect(text).toContain("FACT");
      expect(text).toContain("INFERENCE");
      expect(text).toContain("UNKNOWN");
      expect(text).toContain("RECOMMENDATION");

      unmount();
    });
  }

  it("does not mix languages within a single render", () => {
    window.localStorage.clear();
    const { container, unmount } = renderHelp("es");
    const text = container.textContent ?? "";
    expect(text).not.toContain(getCatalog("en").help.whatIsHeading);
    expect(text).not.toContain(getCatalog("en").help.quickStartHeading);
    unmount();
  });
});
