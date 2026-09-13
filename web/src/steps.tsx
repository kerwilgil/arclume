import { useEffect, useState } from "react";
import type { AppState } from "./App";
import { WebApiError, api, downloadUrl, previewUrl } from "./api";
import { EvidenceInspector } from "./evidence-inspector";
import { useI18n } from "./i18n";
import { KnowledgeInspector } from "./inspector";
import type { KnowledgeView, ValidateResult } from "./types";

/* ---------------------------------------------------------------- source */

export function SourceStep(props: {
  busy: boolean;
  onSelect: (kind: "path" | "url", value: string) => void;
}) {
  const { t } = useI18n();
  const [kind, setKind] = useState<"path" | "url">("path");
  const [value, setValue] = useState("");
  // The native OS dialog exists only where the backend can open one (Windows
  // Installer/Portable); everywhere else the manual path field stands alone.
  const [pickerSupported, setPickerSupported] = useState(false);
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    let alive = true;
    api<{ supported?: boolean }>("GET", "/api/system/pick-source")
      .then((res) => {
        if (alive) setPickerSupported(res.supported === true);
      })
      .catch(() => {
        // Unreachable/unknown capability: keep manual entry only.
      });
    return () => {
      alive = false;
    };
  }, []);

  const browse = (): void => {
    setPicking(true);
    api<{ cancelled?: boolean; path?: string }>("POST", "/api/system/pick-source")
      .then((res) => {
        // A cancelled dialog is a no-op, never an error: the field keeps
        // exactly what the user had typed before.
        if (res.cancelled !== true && typeof res.path === "string" && res.path.length > 0) {
          setValue(res.path);
        }
      })
      .catch((err: unknown) => {
        // The picker vanished mid-flight on a platform that no longer claims
        // support: hide the button; the manual field keeps working.
        if (err instanceof WebApiError && err.code === "web/pick-source-unsupported") {
          setPickerSupported(false);
        }
      })
      .finally(() => setPicking(false));
  };

  return (
    <section aria-labelledby="src-title" className="panel">
      <h2 id="src-title">{t.source.title}</h2>
      <p className="muted">{t.source.description}</p>

      <div role="radiogroup" aria-label={t.source.typeGroupLabel} className="row gap">
        <button
          type="button"
          className={`pill${kind === "path" ? " active" : ""}`}
          onClick={() => setKind("path")}
        >
          {t.source.folderFile}
        </button>
        <button
          type="button"
          className={`pill${kind === "url" ? " active" : ""}`}
          onClick={() => setKind("url")}
        >
          {t.source.url}
        </button>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim().length > 0) props.onSelect(kind, value.trim());
        }}
      >
        <label htmlFor="source-input" className="label">
          {kind === "path" ? t.source.pathLabel : t.source.urlLabel}
        </label>
        <div className="source-picker-row">
          <input
            id="source-input"
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={kind === "path" ? t.source.pathPlaceholder : t.source.urlPlaceholder}
            disabled={props.busy}
            required
          />
          {kind === "path" && pickerSupported && (
            <button
              type="button"
              className="btn"
              aria-label={t.source.browseAriaLabel}
              aria-busy={picking || undefined}
              disabled={props.busy || picking}
              onClick={browse}
            >
              {t.source.browseButton}
            </button>
          )}
        </div>
        {kind === "url" && <p className="muted small">{t.source.urlNotice}</p>}
        <button type="submit" className="btn primary" disabled={props.busy || value.trim() === ""}>
          {t.source.submit}
        </button>
      </form>
    </section>
  );
}

/* ---------------------------------------------------------------- analysis */

export function AnalysisStep(props: {
  state: AppState;
  actions: {
    prepare(): Promise<void>;
    stubPreview(): Promise<void>;
    consumeAgentResult(envelope: string): Promise<void>;
    analyzeDirect(): Promise<void>;
    reviewCandidate(): Promise<void>;
    acceptCandidate(): Promise<void>;
  };
}) {
  const { t } = useI18n();
  const [envelopeText, setEnvelopeText] = useState("");
  const [activeProviderLabel, setActiveProviderLabel] = useState<string | undefined>(undefined);
  const { state } = props;

  useEffect(() => {
    void api<{ activeProvider: string; providers: Array<{ id: string; label: string }> }>(
      "GET",
      "/api/settings/providers",
    ).then((res) => {
      setActiveProviderLabel(
        res.providers.find((p) => p.id === res.activeProvider)?.label ?? res.activeProvider,
      );
    });
  }, []);

  const progressLabel =
    state.progress === "analyzing"
      ? t.analysis.progressAnalyzing
      : state.progress === "reviewing"
        ? t.analysis.progressReviewing
        : state.progress === "complete"
          ? t.analysis.progressComplete
          : undefined;

  return (
    <section aria-labelledby="analysis-title" className="panel">
      <h2 id="analysis-title">{t.analysis.title}</h2>

      <div className="direct-analyze">
        <h3>{t.analysis.directHeading}</h3>
        {activeProviderLabel !== undefined && (
          <p className="muted small">{t.analysis.directIntro(activeProviderLabel)}</p>
        )}
        <button
          type="button"
          className="btn primary"
          disabled={state.busy}
          onClick={() => void props.actions.analyzeDirect()}
        >
          {t.analysis.analyzeButton}
        </button>
        {progressLabel !== undefined && (
          <p className="muted small" aria-live="polite">
            {progressLabel}
          </p>
        )}

        {state.reviewerFailure !== undefined && (
          <div className="warning-box" role="alert">
            <strong>{t.analysis.reviewerFailedTitle}</strong>
            <p>{t.analysis.reviewerFailedBody(state.reviewerFailure)}</p>
            <div className="row gap">
              <button
                type="button"
                className="btn"
                disabled={state.busy}
                onClick={() => void props.actions.acceptCandidate()}
              >
                {t.analysis.acceptUnreviewedButton}
              </button>
              <button
                type="button"
                className="btn"
                disabled={state.busy}
                onClick={() => void props.actions.reviewCandidate()}
              >
                {t.analysis.retryReviewButton}
              </button>
            </div>
          </div>
        )}
      </div>

      <details className="advanced-block">
        <summary>{t.analysis.advancedToggle}</summary>

        <div className="agent-path">
          <h3>{t.analysis.agentHeading}</h3>
          <ol className="steps-list">
            <li>{t.analysis.agentSteps[0]}</li>
            <li>
              {t.analysis.agentSteps[1]} <code>{t.analysis.requestFileNote}</code>
            </li>
            <li>
              {t.analysis.agentSteps[2]} <code>{t.analysis.envelopeArtifactNote}</code>
            </li>
          </ol>
          <div className="row gap">
            <button
              type="button"
              className="btn primary"
              disabled={state.busy}
              onClick={() => void props.actions.prepare()}
            >
              {t.analysis.prepareButton}
            </button>
            {state.prepared && (
              <a
                className="btn"
                href={downloadUrl(state.workspaceId ?? "", state.prepared.requestFileId)}
              >
                {t.analysis.downloadRequest}
              </a>
            )}
          </div>

          {state.prepared && (
            <div className="request-summary" aria-live="polite">
              <div className="kv">
                <span className="label">{t.analysis.summarySourceDigest}</span>
                <code>{state.prepared.sourceDigest}</code>
              </div>
              <div className="kv">
                <span className="label">{t.analysis.summaryDocuments}</span>
                <code>{state.prepared.documents}</code>
              </div>
              <div className="kv">
                <span className="label">{t.analysis.summaryFiles}</span>
                <code>{state.prepared.files}</code>
              </div>
            </div>
          )}

          <label htmlFor="agent-result" className="label">
            {t.analysis.pasteLabel}
          </label>
          <textarea
            id="agent-result"
            rows={8}
            value={envelopeText}
            onChange={(e) => setEnvelopeText(e.target.value)}
            placeholder='{"artifact":"arclume/agent-analysis","version":"0.1.0","sourceDigest":"…","analysis":…}'
            spellCheck={false}
          />
          <button
            type="button"
            className="btn primary"
            disabled={state.busy || envelopeText.trim() === ""}
            onClick={() => void props.actions.consumeAgentResult(envelopeText)}
          >
            {t.analysis.consumeButton}
          </button>
        </div>

        <details className="stub-block">
          <summary>{t.analysis.stubSummary}</summary>
          <p className="warning-box" role="note">
            {t.analysis.stubWarning}
          </p>
          <button
            type="button"
            className="btn"
            disabled={state.busy}
            onClick={() => void props.actions.stubPreview()}
          >
            {t.analysis.stubButton}
          </button>
        </details>
      </details>

      {state.issues.length > 0 && (
        <div className="issues">
          <h3>{t.analysis.issuesHeading}</h3>
          <ul>
            {state.issues.map((i, idx) => (
              <li key={`${i.code}-${idx}`} data-severity={i.severity}>
                <code>{i.code}</code> — {i.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------- knowledge */

export function KnowledgeStep(props: {
  knowledge: KnowledgeView | undefined;
  raw: unknown;
  workspaceId: string | undefined;
}) {
  const { t } = useI18n();
  const [raw, setRaw] = useState(false);
  if (!props.knowledge) {
    return (
      <section className="panel">
        <h2>{t.knowledge.title}</h2>
        <p className="muted">{t.knowledge.emptyMessage}</p>
      </section>
    );
  }
  return (
    <section aria-labelledby="kn-title" className="panel">
      <div className="row between">
        <h2 id="kn-title">{t.knowledge.title}</h2>
        <button type="button" className="btn ghost" onClick={() => setRaw(!raw)}>
          {raw ? t.knowledge.viewStructured : t.knowledge.viewRawJson}
        </button>
      </div>
      {raw ? (
        <pre className="raw-json">{JSON.stringify(props.raw, null, 2)}</pre>
      ) : (
        <KnowledgeInspector knowledge={props.knowledge} />
      )}
      {props.workspaceId && (
        <details className="kv-block">
          <summary className="muted small">{t.knowledge.evidenceHeading}</summary>
          <EvidenceInspector workspaceId={props.workspaceId} />
        </details>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ build */

const AUDIENCES: Array<{ id: string }> = [
  { id: "executive" },
  { id: "technical" },
  { id: "client" },
  { id: "investor" },
  { id: "product" },
  { id: "internal-review" },
  { id: "general" },
];

const AUDIENCES_DETAIL: Record<string, { theme: "executive" | "minimal"; i18nKey: string }> = {
  executive: { theme: "executive", i18nKey: "executive" },
  technical: { theme: "minimal", i18nKey: "technical" },
  general: { theme: "minimal", i18nKey: "general" },
  product: { theme: "minimal", i18nKey: "product" },
  client: { theme: "minimal", i18nKey: "client" },
  investor: { theme: "minimal", i18nKey: "investor" },
  "internal-review": { theme: "minimal", i18nKey: "internalReview" },
};

const DECK_TYPES: Array<{ id: string }> = [
  { id: "project-overview" },
  { id: "architecture-review" },
  { id: "technical-deep-dive" },
  { id: "executive-brief" },
  { id: "proposal" },
  { id: "status-report" },
  { id: "migration-plan" },
  { id: "product-overview" },
  { id: "incident-postmortem" },
];

export function BuildStep(props: {
  state: AppState;
  onBuild: (req: {
    preset?: string;
    audience?: string;
    deckType?: string;
    formats: string[];
  }) => Promise<void>;
}) {
  const { t } = useI18n();
  const readPick = (key: string, validator: (v: string) => boolean): string | undefined => {
    try {
      if (typeof window === "undefined" || !window.localStorage) return undefined;
      const raw = window.localStorage.getItem(`arclume.ui.${key}`);
      return raw !== null && validator(raw) ? raw : undefined;
    } catch {
      return undefined;
    }
  };
  const [audience, setAudience] = useState<string>(
    readPick("build.audience", (v) => AUDIENCES.some((a) => a.id === v)) ?? "general",
  );
  const [deckType, setDeckType] = useState<string | undefined>(
    readPick("build.deckType", (v) => v === "" || DECK_TYPES.some((d) => d.id === v)) || undefined,
  );
  const commitPick = (key: string, value: string | undefined) => {
    try {
      if (typeof window === "undefined" || !window.localStorage) return;
      if (value === undefined) window.localStorage.removeItem(`arclume.ui.${key}`);
      else window.localStorage.setItem(`arclume.ui.${key}`, value);
    } catch {
      // Storage disabled / quota: keep the in-memory session value.
    }
  };
  const [formats, setFormats] = useState<string[]>(["html"]);
  const { state } = props;

  if (!state.knowledge) {
    return (
      <section className="panel">
        <h2>{t.build.title}</h2>
        <p className="muted">{t.build.emptyMessage}</p>
      </section>
    );
  }

  const audienceInfo = (a: string) => {
    const info = AUDIENCES_DETAIL[a];
    const label = info !== undefined ? t.build.audiences[a as keyof typeof t.build.audiences] : a;
    const themeBadge = info?.theme === "executive" ? t.build.themeExecutive : t.build.themeMinimal;
    return { label, themeBadge };
  };

  const descFor = (a: string) => {
    const labels: Record<string, string> = {
      executive: t.build.audienceDescriptions.executive,
      technical: t.build.audienceDescriptions.technical,
      client: t.build.audienceDescriptions.client,
      investor: t.build.audienceDescriptions.investor,
      product: t.build.audienceDescriptions.product,
      "internal-review": t.build.audienceDescriptions["internal-review"],
      general: t.build.audienceDescriptions.general,
    };
    return labels[a] ?? "";
  };

  return (
    <section aria-labelledby="build-title" className="panel">
      <h2 id="build-title">{t.build.title}</h2>

      <div className="build-controls">
        <div className="field-group">
          <label htmlFor="build-audience" className="label">
            {t.build.audienceLabel}
          </label>
          <select
            id="build-audience"
            className="select"
            value={audience}
            onChange={(e) => {
              setAudience(e.target.value);
              commitPick("build.audience", e.target.value);
            }}
            disabled={state.busy}
          >
            {AUDIENCES.map((a) => (
              <option key={a.id} value={a.id}>
                {audienceInfo(a.id).label}
              </option>
            ))}
          </select>
          {descFor(audience) && <p className="muted small">{descFor(audience)}</p>}
        </div>

        <div className="field-group">
          <label htmlFor="build-deck-type" className="label">
            {t.build.deckTypeLabel}
          </label>
          <select
            id="build-deck-type"
            className="select"
            value={deckType ?? ""}
            onChange={(e) => {
              const next = e.target.value === "" ? undefined : e.target.value;
              setDeckType(next);
              commitPick("build.deckType", next);
            }}
            disabled={state.busy}
          >
            <option value="">{t.build.deckTypeNone}</option>
            {DECK_TYPES.map((d) => (
              <option key={d.id} value={d.id}>
                {t.build.deckTypes[d.id as keyof typeof t.build.deckTypes]}
              </option>
            ))}
          </select>
          <p className="muted small">{t.build.deckTypeHint}</p>
        </div>
      </div>

      <fieldset className="formats">
        <legend>{t.build.formatsLegend}</legend>
        {(["html", "pdf", "pptx"] as const).map((f) => (
          <label key={f} className="checkbox">
            <input
              type="checkbox"
              checked={formats.includes(f)}
              onChange={(e) =>
                setFormats(e.target.checked ? [...formats, f] : formats.filter((x) => x !== f))
              }
            />
            {f.toUpperCase()}
          </label>
        ))}
      </fieldset>

      <button
        type="button"
        className="btn primary"
        disabled={state.busy || formats.length === 0}
        onClick={() =>
          void props.onBuild({
            audience,
            ...(deckType !== undefined ? { deckType } : {}),
            formats,
          })
        }
      >
        {t.build.rebuildFromKnowledgeButton}
      </button>

      {state.build && (
        <p className="muted small build-summary" aria-live="polite">
          {t.build.builtSummary(state.build.slides)}
          {state.build.html && (
            <>
              {" "}
              ·{" "}
              <a href={downloadUrl(state.workspaceId ?? "", state.build.html.fileId)}>
                {t.build.downloadHtml}
              </a>
            </>
          )}
          {state.build.exports.map((e) => ` · ${e.format} exportId ${e.exportId.slice(0, 16)}…`)}
        </p>
      )}
    </section>
  );
}

/* ---------------------------------------------------------------- preview */

export function PreviewPane(props: { workspaceId: string }): JSX.Element {
  const { t } = useI18n();
  return (
    <section aria-labelledby="preview-title" className="panel">
      <h2 id="preview-title">{t.preview.title}</h2>
      <iframe
        title={t.preview.frameTitle}
        className="preview-frame"
        sandbox="allow-scripts"
        src={previewUrl(props.workspaceId)}
      />
      <p className="muted small">{t.preview.caption}</p>
    </section>
  );
}

/* ----------------------------------------------------------------- export */

export function ExportStep(props: { state: AppState }): JSX.Element {
  const { t } = useI18n();
  const { state } = props;
  const [results, setResults] = useState<Record<string, ValidateResult>>({});
  const exports = state.build?.exports ?? [];
  if (exports.length === 0 && !state.build?.html) {
    return (
      <section className="panel">
        <h2>{t.export.title}</h2>
        <p className="muted">{t.export.emptyMessage}</p>
      </section>
    );
  }
  return (
    <section aria-labelledby="export-title" className="panel">
      <h2 id="export-title">{t.export.title}</h2>
      <ul className="export-list">
        {state.build?.html && (
          <li className="export-row">
            <div>
              <strong>{t.export.htmlLabel}</strong>
              <div className="muted small">{t.export.htmlDescription}</div>
            </div>
            <div className="row gap">
              <a
                className="btn"
                href={downloadUrl(state.workspaceId ?? "", state.build.html.fileId)}
              >
                {t.export.downloadHtml}
              </a>
            </div>
          </li>
        )}
        {exports.map((e) => (
          <li key={e.format} className="export-row">
            <div>
              <strong>{e.format.toUpperCase()}</strong>
              <div className="muted small">
                {t.export.exportIdLabel} <code>{e.exportId}</code>
              </div>
              {e.warnings.length > 0 && (
                <ul className="warnings">
                  {e.warnings.map((w) => (
                    <li key={w}>
                      <code>{w}</code>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="row gap">
              <a className="btn" href={downloadUrl(state.workspaceId ?? "", e.artifactFileId)}>
                {t.export.downloadFormat(e.format)}
              </a>
              <a className="btn ghost" href={downloadUrl(state.workspaceId ?? "", e.receiptFileId)}>
                {t.export.downloadReceipt}
              </a>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  void api<ValidateResult>(
                    "POST",
                    `/api/workspaces/${state.workspaceId}/validate`,
                    { format: e.format },
                  ).then((r) => setResults((prev) => ({ ...prev, [e.format]: r })));
                }}
              >
                {t.export.validateButton}
              </button>
            </div>
            {results[e.format] && (
              <output className={results[e.format]?.valid ? "ok" : "not-ok"}>
                {results[e.format]?.valid ? t.export.valid : t.export.invalid}
                {results[e.format]?.issues.map((i) => (
                  <span key={i.code}>
                    {" "}
                    — <code>{i.code}</code> {i.message}
                  </span>
                ))}
              </output>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
