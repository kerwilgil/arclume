import { useCallback, useMemo, useState } from "react";
import { WebApiError, api } from "./api";
import { HelpView } from "./help";
import { useI18n } from "./i18n";
import { SettingsView } from "./settings";
import {
  AnalysisStep,
  BuildStep,
  ExportStep,
  KnowledgeStep,
  PreviewPane,
  SourceStep,
} from "./steps";
import type { BuildResult, IssueDto, KnowledgeView, PrepareResult, Stage } from "./types";

export type AnalysisProgress = "preparing" | "analyzing" | "reviewing" | "complete";

export interface AppState {
  workspaceId: string | undefined;
  source: { kind: "path" | "url"; value: string } | undefined;
  prepared: PrepareResult | undefined;
  mode: "agent" | "stub" | "fast" | "verified" | undefined;
  knowledge: KnowledgeView | undefined;
  rawKnowledge: unknown;
  build: BuildResult | undefined;
  issues: IssueDto[];
  busy: boolean;
  error: { message: string; code: string; hint?: string } | undefined;
  /** Direct Analyze's real, backend-confirmed phase — never a simulated
   * progress bar. Cleared once the run settles (success or reviewer
   * failure). */
  progress: AnalysisProgress | undefined;
  /** Set only by the Verified-mode reviewer failure policy: the reviewer
   * errored/timed out/returned something invalid. The primary's already
   * schema-valid candidate is preserved server-side (`pendingCandidate`) —
   * never silently promoted to `knowledge`. */
  reviewerFailure: string | undefined;
}

/** What the main panel renders. `Stage` (the 5 workflow steps) plus the two
 * always-available, unnumbered destinations that sit outside the workflow. */
type View = Stage | "help" | "settings";

export function App(): JSX.Element {
  const { t } = useI18n();
  const [state, setState] = useState<AppState>({
    workspaceId: undefined,
    source: undefined,
    prepared: undefined,
    mode: undefined,
    knowledge: undefined,
    rawKnowledge: undefined,
    build: undefined,
    issues: [],
    busy: false,
    error: undefined,
    progress: undefined,
    reviewerFailure: undefined,
  });
  const [view, setView] = useState<View>("source");

  const STEPS: Array<{ id: Stage; label: string }> = [
    { id: "source", label: `1 · ${t.nav.source}` },
    { id: "analysis", label: `2 · ${t.nav.analysis}` },
    { id: "knowledge", label: `3 · ${t.nav.knowledge}` },
    { id: "build", label: `4 · ${t.nav.build}` },
    { id: "export", label: `5 · ${t.nav.export}` },
  ];

  const run = useCallback(async (fn: () => Promise<void>): Promise<void> => {
    setState((s) => ({ ...s, busy: true, error: undefined }));
    try {
      await fn();
      setState((s) => ({ ...s, busy: false }));
    } catch (err) {
      const e = err as WebApiError;
      setState((s) => ({
        ...s,
        busy: false,
        error: {
          message: e.message,
          code: e.code ?? "ui/unknown",
          ...(e.hint !== undefined ? { hint: e.hint } : {}),
        },
      }));
    }
  }, []);

  const patch = useCallback((p: Partial<AppState>) => setState((s) => ({ ...s, ...p })), []);

  const actions = useMemo(
    () => ({
      async createSource(kind: "path" | "url", value: string) {
        await run(async () => {
          const res = await api<{ workspace: { id: string } }>("POST", "/api/workspaces", {
            source: { kind, value },
          });
          patch({
            workspaceId: res.workspace.id,
            source: { kind, value },
            prepared: undefined,
            mode: undefined,
            knowledge: undefined,
            rawKnowledge: undefined,
            build: undefined,
            issues: [],
          });
          setView("analysis");
        });
      },
      async prepare() {
        if (!state.workspaceId) return;
        await run(async () => {
          const res = await api<PrepareResult>(
            "POST",
            `/api/workspaces/${state.workspaceId}/prepare`,
          );
          patch({ prepared: res, mode: undefined, issues: res.issues });
        });
      },
      /** Direct Analyze — the configured provider, no manual envelope. Each
       * progress state below corresponds to a real, distinct backend call
       * actually in flight (never a simulated timer): `/analyze` performs
       * ingestion + the primary reasoner + schema validation server-side in
       * one request, so "analyzing" covers all of that; "reviewing" is a
       * second, separate request only made for Verified mode. */
      async analyzeDirect() {
        if (!state.workspaceId) return;
        const wsId = state.workspaceId;
        await run(async () => {
          patch({ progress: "analyzing", reviewerFailure: undefined });
          const res = await api<{ mode: string; reasonerId: string; sourceDigest: string }>(
            "POST",
            `/api/workspaces/${wsId}/analyze`,
            {},
          );
          if (res.mode === "fast") {
            const kn = await api<{ knowledge: KnowledgeView }>(
              "GET",
              `/api/workspaces/${wsId}/knowledge`,
            );
            patch({
              knowledge: kn.knowledge,
              rawKnowledge: kn.knowledge,
              mode: "fast",
              progress: "complete",
            });
            setView("knowledge");
            return;
          }
          // verified-pending: run the reviewer step as its own real call.
          patch({ progress: "reviewing" });
          await actions.reviewCandidate();
        });
      },
      async reviewCandidate() {
        if (!state.workspaceId) return;
        const wsId = state.workspaceId;
        await run(async () => {
          patch({ progress: "reviewing", reviewerFailure: undefined });
          const rev = await api<{ mode: string; reason?: string }>(
            "POST",
            `/api/workspaces/${wsId}/review`,
            {},
          );
          if (rev.mode === "verified-reviewer-failed") {
            patch({ progress: undefined, reviewerFailure: rev.reason ?? "" });
            return;
          }
          const kn = await api<{ knowledge: KnowledgeView }>(
            "GET",
            `/api/workspaces/${wsId}/knowledge`,
          );
          patch({
            knowledge: kn.knowledge,
            rawKnowledge: kn.knowledge,
            mode: "verified",
            progress: "complete",
          });
          setView("knowledge");
        });
      },
      /** The explicit, user-driven recovery after a reviewer failure —
       * never automatic. Accepts the primary's already schema-valid
       * candidate exactly as Fast mode would have. */
      async acceptCandidate() {
        if (!state.workspaceId) return;
        const wsId = state.workspaceId;
        await run(async () => {
          await api("POST", `/api/workspaces/${wsId}/accept-candidate`, {});
          const kn = await api<{ knowledge: KnowledgeView }>(
            "GET",
            `/api/workspaces/${wsId}/knowledge`,
          );
          patch({
            knowledge: kn.knowledge,
            rawKnowledge: kn.knowledge,
            mode: "fast",
            progress: "complete",
            reviewerFailure: undefined,
          });
          setView("knowledge");
        });
      },
      async stubPreview() {
        if (!state.workspaceId) return;
        await run(async () => {
          await api("POST", `/api/workspaces/${state.workspaceId}/stub-preview`);
          const kn = await api<{ knowledge: KnowledgeView }>(
            "GET",
            `/api/workspaces/${state.workspaceId}/knowledge`,
          );
          patch({ knowledge: kn.knowledge, rawKnowledge: kn.knowledge, mode: "stub" });
          setView("knowledge");
        });
      },
      async consumeAgentResult(envelopeText: string) {
        if (!state.workspaceId) return;
        await run(async () => {
          let envelope: unknown;
          try {
            envelope = JSON.parse(envelopeText);
          } catch {
            throw new WebApiError(0, "ui/invalid-json", t.errors.invalidJson);
          }
          await api("POST", `/api/workspaces/${state.workspaceId}/agent-result`, { envelope });
          const kn = await api<{ knowledge: KnowledgeView }>(
            "GET",
            `/api/workspaces/${state.workspaceId}/knowledge`,
          );
          patch({ knowledge: kn.knowledge, rawKnowledge: kn.knowledge, mode: "agent" });
          setView("knowledge");
        });
      },
      async buildDecks(req: {
        preset?: string;
        audience?: string;
        deckType?: string;
        formats: string[];
      }) {
        if (!state.workspaceId) return;
        await run(async () => {
          const res = await api<BuildResult>("POST", `/api/workspaces/${state.workspaceId}/build`, {
            ...(req.preset !== undefined ? { preset: req.preset } : {}),
            ...(req.audience !== undefined ? { audience: req.audience } : {}),
            ...(req.deckType !== undefined ? { deckType: req.deckType } : {}),
            formats: req.formats,
          });
          patch({ build: res });
        });
      },
      async deleteWorkspace() {
        if (!state.workspaceId) return;
        await run(async () => {
          await api("DELETE", `/api/workspaces/${state.workspaceId}`);
          patch({
            workspaceId: undefined,
            source: undefined,
            prepared: undefined,
            mode: undefined,
            knowledge: undefined,
            rawKnowledge: undefined,
            build: undefined,
            issues: [],
          });
          setView("source");
        });
      },
    }),
    [state.workspaceId, run, patch, t.errors.invalidJson],
  );

  return (
    <div className="app">
      <aside className="sidebar" aria-label={t.nav.workflowHeading}>
        <div className="brand">
          {/* ARCLUME is a proper noun / brand name — identical in every
              locale (see i18n/en.ts and i18n/es.ts: app.name), so it is
              hardcoded here rather than routed through the catalog. */}
          <img src="/brand/arclume-logo-horizontal.svg" alt="ARCLUME" className="brand-logo" />
          <span className="brand-sub">{t.app.tagline}</span>
        </div>
        <nav aria-label={t.nav.workflowHeading}>
          {STEPS.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`stage-link${view === s.id ? " active" : ""}`}
              aria-current={view === s.id ? "step" : undefined}
              onClick={() => setView(s.id)}
            >
              {s.label}
            </button>
          ))}
        </nav>

        <div className="sidebar-utility" aria-label={`${t.nav.help} / ${t.nav.settings}`}>
          <button
            type="button"
            className={`stage-link${view === "help" ? " active" : ""}`}
            onClick={() => setView("help")}
          >
            {t.nav.help}
          </button>
          <button
            type="button"
            className={`stage-link${view === "settings" ? " active" : ""}`}
            onClick={() => setView("settings")}
          >
            {t.nav.settings}
          </button>
        </div>

        {state.workspaceId && (
          <div className="ws-meta">
            <div className="ws-meta-row">
              <span className="label">{t.workspace.idLabel}</span>
              <code>{state.workspaceId}</code>
            </div>
            {state.source && (
              <div className="ws-meta-row">
                <span className="label">{t.workspace.sourceLabel}</span>
                <code title={state.source.value}>{shorten(state.source.value)}</code>
              </div>
            )}
            {state.mode && (
              <div className="ws-meta-row">
                <span className="label">{t.workspace.modeLabel}</span>
                <code>{state.mode === "stub" ? t.workspace.modeStub : t.workspace.modeAgent}</code>
              </div>
            )}
            <button
              type="button"
              className="btn ghost danger"
              disabled={state.busy}
              onClick={() => void actions.deleteWorkspace()}
            >
              {t.workspace.discardButton}
            </button>
          </div>
        )}
      </aside>

      <main className="main">
        {state.error && (
          <div role="alert" className="error-box">
            <strong>{state.error.message}</strong>
            <code>{state.error.code}</code>
            {state.error.hint && <p className="hint">{state.error.hint}</p>}
          </div>
        )}
        {view === "source" && <SourceStep busy={state.busy} onSelect={actions.createSource} />}
        {view === "analysis" && <AnalysisStep state={state} actions={actions} />}
        {view === "knowledge" && (
          <KnowledgeStep
            knowledge={state.knowledge}
            raw={state.rawKnowledge}
            workspaceId={state.workspaceId}
          />
        )}
        {view === "build" && (
          <>
            <BuildStep state={state} onBuild={actions.buildDecks} />
            {state.build?.html && state.workspaceId && (
              <PreviewPane workspaceId={state.workspaceId} />
            )}
          </>
        )}
        {view === "export" && <ExportStep state={state} />}
        {view === "help" && <HelpView />}
        {view === "settings" && <SettingsView />}
      </main>
    </div>
  );
}

function shorten(v: string): string {
  return v.length > 44 ? `…${v.slice(-44)}` : v;
}
