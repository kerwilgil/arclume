import { useI18n } from "../i18n";

/**
 * Integrated Help/Manual. Static, offline, translated — no external
 * documentation site opened by default. Content is deliberately compact: a
 * product overview, a quick start, a per-stage explanation (including the
 * Agent vs Offline Preview distinction, which is functionally important, not
 * cosmetic), the Agent workflow, a plain-language privacy note, and a short
 * glossary. See docs/WEB_UI.md and REASONER.md for the full technical detail.
 */
export function HelpView(): JSX.Element {
  const { t } = useI18n();
  const steps = t.help.steps;

  return (
    <section aria-labelledby="help-title" className="panel help-view">
      <h2 id="help-title">{t.help.title}</h2>

      <h3>{t.help.whatIsHeading}</h3>
      <p>{t.help.whatIsBody}</p>

      <h3>{t.help.quickStartHeading}</h3>
      <ol className="steps-list">
        {t.help.quickStartSteps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>

      <h3>{t.help.workflowHeading}</h3>
      <div className="help-steps">
        <article>
          <h4>{steps.source.title}</h4>
          <p>{steps.source.body}</p>
        </article>
        <article>
          <h4>{steps.analysis.title}</h4>
          <p>{steps.analysis.body}</p>
          <dl className="help-modes">
            <dt>{steps.analysis.agentLabel}</dt>
            <dd>{steps.analysis.agentBody}</dd>
            <dt>{steps.analysis.stubLabel}</dt>
            <dd>{steps.analysis.stubBody}</dd>
          </dl>
        </article>
        <article>
          <h4>{steps.knowledge.title}</h4>
          <p>{steps.knowledge.body}</p>
        </article>
        <article>
          <h4>{steps.build.title}</h4>
          <p>{steps.build.body}</p>
          <p className="muted small">
            {steps.build.presetsIntro} {steps.build.presetExecutive}, {steps.build.presetTechnical},{" "}
            {steps.build.presetGeneral}
          </p>
        </article>
        <article>
          <h4>{steps.export.title}</h4>
          <p>{steps.export.body}</p>
        </article>
      </div>

      <h3>{t.help.agentWorkflowHeading}</h3>
      <ol className="steps-list">
        {t.help.agentWorkflowSteps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>

      <h3>{t.help.privacyHeading}</h3>
      <ul className="help-privacy">
        {t.help.privacyBody.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>

      <h3>{t.help.keyTermsHeading}</h3>
      <dl className="help-terms">
        {t.help.keyTerms.map((entry) => (
          <div key={entry.term} className="help-term-row">
            <dt>{entry.term}</dt>
            <dd>{entry.def}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
