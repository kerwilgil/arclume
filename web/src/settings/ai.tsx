import { useEffect, useState } from "react";
import { api } from "../api";
import { useI18n } from "../i18n";

type AuthMode = "subscription-cli" | "api-key" | "local";

interface ProviderDescriptorDto {
  id: string;
  label: string;
  authMode: AuthMode;
  requiresBaseUrl: boolean;
  requiresModel: boolean;
  requiresApiKey: boolean;
  defaultBaseUrl?: string;
  recommendedModel?: string;
  secretConfigured: boolean;
  secretHint?: string;
  secretSource?: "environment" | "stored";
  config: { model?: string; baseUrl?: string };
}

interface ProvidersStateDto {
  activeProvider: string;
  analysisQuality: "fast" | "verified";
  reviewer?: { provider: string; model?: string };
  providers: ProviderDescriptorDto[];
}

interface TestResult {
  ready: boolean;
  message: string;
  kind?: string;
}

/** AI & Analysis — provider selection, per-provider config/secret, Fast vs
 * Verified, and the Verified reviewer choice. Frontend-only state (loading,
 * drafts, test results) never touches AppState/workspace — this whole panel
 * is independent of any workspace, matching the backend's own separation. */
export function AiSettingsSection(): JSX.Element {
  const { t } = useI18n();
  const [state, setState] = useState<ProvidersStateDto | undefined>(undefined);
  const [selected, setSelected] = useState<string>("stub");
  const [modelDraft, setModelDraft] = useState("");
  const [baseUrlDraft, setBaseUrlDraft] = useState("");
  const [quality, setQuality] = useState<"fast" | "verified">("fast");
  const [reviewerProvider, setReviewerProvider] = useState("stub");
  const [reviewerModel, setReviewerModel] = useState("");
  const [editingKey, setEditingKey] = useState(false);
  const [keyDraft, setKeyDraft] = useState("");
  const [ollamaModels, setOllamaModels] = useState<string[] | undefined>(undefined);
  const [discovering, setDiscovering] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | undefined>(undefined);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);
  const [models, setModels] = useState<string[]>([]);
  const [discoveringModels, setDiscoveringModels] = useState(false);
  const [modelError, setModelError] = useState<string | undefined>(undefined);
  const [showManualModel, setShowManualModel] = useState(false);

  async function reload(): Promise<void> {
    const res = await api<ProvidersStateDto>("GET", "/api/settings/providers");
    setState(res);
    setSelected(res.activeProvider);
    setQuality(res.analysisQuality);
    if (res.reviewer) {
      setReviewerProvider(res.reviewer.provider);
      setReviewerModel(res.reviewer.model ?? "");
    }
    const current = res.providers.find((p) => p.id === res.activeProvider);
    setModelDraft(current?.config.model ?? "");
    setBaseUrlDraft(current?.config.baseUrl ?? current?.defaultBaseUrl ?? "");
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload only needs to run once, on mount.
  useEffect(() => {
    // Unlike the button-triggered calls below (persist/runTest/removeKey,
    // whose failures are attributable to the action the user just took),
    // this fetch fires with no user action at all — an uncaught rejection
    // here would leave the panel stuck on its loading placeholder with no
    // visible explanation. Surface it instead of letting it go silent.
    void reload().catch((err: unknown) => {
      setLoadError(err instanceof Error ? err.message : String(err));
    });
  }, []);

  const descriptor = state?.providers.find((p) => p.id === selected);

  function selectProvider(id: string): void {
    setSelected(id);
    setTestResult(undefined);
    setEditingKey(false);
    setKeyDraft("");
    setModels([]);
    setModelError(undefined);
    setShowManualModel(false);
    const found = state?.providers.find((p) => p.id === id);
    setModelDraft(found?.config.model ?? "");
    setBaseUrlDraft(found?.config.baseUrl ?? found?.defaultBaseUrl ?? "");
    // Auto-discover models for providers that support it
    if (
      found &&
      (found.id === "nvidia" ||
        found.id === "openai" ||
        found.id === "openai-compatible" ||
        found.id === "ollama")
    ) {
      if (found.secretConfigured || found.authMode === "local") {
        void discoverProviderModels();
      }
    }
  }

  async function persist(): Promise<void> {
    setSaving(true);
    try {
      await api("PUT", "/api/settings/providers/active", {
        activeProvider: selected,
        analysisQuality: quality,
        ...(quality === "verified"
          ? {
              reviewer: {
                provider: reviewerProvider,
                ...(reviewerModel ? { model: reviewerModel } : {}),
              },
            }
          : {}),
      });
      await api("PUT", `/api/settings/providers/${selected}/config`, {
        ...(modelDraft ? { model: modelDraft } : {}),
        ...(baseUrlDraft ? { baseUrl: baseUrlDraft } : {}),
      });
      if (editingKey && keyDraft.trim().length > 0) {
        const envKey = secretKeyFor(selected);
        if (envKey) await api("PUT", `/api/settings/secrets/${envKey}`, { value: keyDraft.trim() });
      }
      setEditingKey(false);
      setKeyDraft("");
      await reload();
      setSavedAt(Date.now());
    } finally {
      setSaving(false);
    }
  }

  async function removeKey(): Promise<void> {
    const envKey = secretKeyFor(selected);
    if (!envKey) return;
    await api("DELETE", `/api/settings/secrets/${envKey}`);
    await reload();
  }

  async function runTest(): Promise<void> {
    setTesting(true);
    setTestResult(undefined);
    try {
      await persist();
      const res = await api<TestResult & { ok: true }>(
        "POST",
        `/api/settings/providers/${selected}/test`,
      );
      setTestResult(res);
    } finally {
      setTesting(false);
    }
  }

  async function discoverModels(): Promise<void> {
    setDiscovering(true);
    try {
      const res = await api<{ models: string[] }>("GET", "/api/settings/providers/ollama/models");
      setOllamaModels(res.models);
    } finally {
      setDiscovering(false);
    }
  }

  async function discoverProviderModels(): Promise<void> {
    const id = selected;
    const descriptor = state?.providers.find((p) => p.id === id);
    if (!descriptor) return;

    setDiscoveringModels(true);
    setModelError(undefined);
    try {
      const res = await api<{ ok: boolean; models?: string[]; error?: string; message?: string }>(
        "GET",
        `/api/settings/providers/${id}/models`,
      );
      if (res.ok && res.models) {
        setModels(res.models);
        setShowManualModel(false);
      } else {
        setModelError(res.message || res.error || "Failed to load models");
        setShowManualModel(true);
      }
    } catch (err) {
      setModelError((err as Error).message);
      setShowManualModel(true);
    } finally {
      setDiscoveringModels(false);
    }
  }

  if (state === undefined || descriptor === undefined) {
    return (
      <fieldset className="pill-fieldset">
        <legend>{t.settings.aiHeading}</legend>
        {loadError !== undefined ? (
          <p className="warning-box" role="alert">
            {t.settings.loadFailed}
          </p>
        ) : (
          <p className="muted small">…</p>
        )}
      </fieldset>
    );
  }

  const showModel = descriptor.authMode !== "local" || descriptor.requiresModel;
  const showBaseUrl = descriptor.requiresBaseUrl || descriptor.defaultBaseUrl !== undefined;
  const showKey = descriptor.requiresApiKey || descriptor.authMode === "api-key";

  return (
    <>
      <fieldset className="pill-fieldset">
        <legend>{t.settings.aiHeading}</legend>

        <label htmlFor="ai-active-provider" className="label">
          {t.settings.activeProviderLabel}
        </label>
        <select
          id="ai-active-provider"
          value={selected}
          onChange={(e) => selectProvider(e.target.value)}
        >
          {state.providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>

        <p className="muted small">{privacyNoticeFor(descriptor, t)}</p>

        {showModel &&
          (descriptor.id === "ollama" && ollamaModels !== undefined ? (
            <>
              <label htmlFor="ai-model" className="label">
                {descriptor.requiresModel ? t.settings.modelLabel : t.settings.modelOptionalLabel}
              </label>
              <select
                id="ai-model"
                value={modelDraft}
                onChange={(e) => setModelDraft(e.target.value)}
              >
                <option value="">—</option>
                {ollamaModels.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn ghost"
                disabled={discovering}
                onClick={() => void discoverModels()}
              >
                {discovering ? t.settings.discoveringModels : t.settings.discoverModelsButton}
              </button>
              {ollamaModels.length === 0 && (
                <p className="muted small">{t.settings.noModelsFound}</p>
              )}
            </>
          ) : descriptor.id === "claude-code" || descriptor.id === "codex" ? (
            <>
              <label htmlFor="ai-model" className="label">
                {descriptor.requiresModel ? t.settings.modelLabel : t.settings.modelOptionalLabel}
              </label>
              <div className="model-auto">
                <span className="model-auto-label">{t.settings.modelAuto}</span>
                <span className="muted small">
                  {descriptor.id === "claude-code"
                    ? t.settings.modelManagedByClaudeCode
                    : t.settings.modelManagedByCodex}
                </span>
              </div>
            </>
          ) : (
            // NVIDIA, OpenAI, OpenAI-compatible: dropdown with model discovery
            <>
              <label htmlFor="ai-model" className="label">
                {descriptor.requiresModel ? t.settings.modelLabel : t.settings.modelOptionalLabel}
              </label>
              <select
                id="ai-model"
                value={modelDraft}
                onChange={(e) => setModelDraft(e.target.value)}
                disabled={discoveringModels}
              >
                <option value="">{t.settings.modelSelect}</option>
                {models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <div className="row gap">
                <button
                  type="button"
                  className="btn ghost"
                  disabled={discoveringModels}
                  onClick={() => void discoverProviderModels()}
                >
                  {discoveringModels ? t.settings.loadingModels : t.settings.refreshModels}
                </button>
                {!discoveringModels && models.length === 0 && (
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => setShowManualModel(true)}
                  >
                    {t.settings.enterModelManually}
                  </button>
                )}
              </div>
              {modelError && (
                <p className="warning-box muted small" role="alert">
                  {modelError}
                </p>
              )}
              {showManualModel && (
                <input
                  id="ai-model-manual"
                  type="text"
                  value={modelDraft}
                  onChange={(e) => setModelDraft(e.target.value)}
                  placeholder={descriptor.recommendedModel ?? ""}
                />
              )}
            </>
          ))}

        {showBaseUrl && (
          <>
            <label htmlFor="ai-base-url" className="label">
              {t.settings.baseUrlLabel}
            </label>
            <input
              id="ai-base-url"
              type="text"
              value={baseUrlDraft}
              onChange={(e) => setBaseUrlDraft(e.target.value)}
              placeholder={descriptor.defaultBaseUrl ?? ""}
            />
          </>
        )}

        {showKey && (
          <>
            <span className="label">{t.settings.apiKeyLabel}</span>
            {!editingKey ? (
              <div className="row gap">
                <code>
                  {descriptor.secretConfigured && descriptor.secretHint !== undefined
                    ? t.settings.apiKeyConfigured(descriptor.secretHint)
                    : t.settings.apiKeyNotConfigured}
                </code>
                <button type="button" className="btn ghost" onClick={() => setEditingKey(true)}>
                  {t.settings.apiKeyChangeButton}
                </button>
                {descriptor.secretConfigured && descriptor.secretSource === "stored" && (
                  <button
                    type="button"
                    className="btn ghost danger"
                    onClick={() => void removeKey()}
                  >
                    {t.settings.apiKeyRemoveButton}
                  </button>
                )}
              </div>
            ) : (
              <div className="row gap">
                <input
                  type="password"
                  value={keyDraft}
                  onChange={(e) => setKeyDraft(e.target.value)}
                  placeholder={t.settings.apiKeyPlaceholder}
                  autoComplete="off"
                />
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => {
                    setEditingKey(false);
                    setKeyDraft("");
                  }}
                >
                  {t.settings.apiKeyCancelButton}
                </button>
              </div>
            )}
          </>
        )}

        <div className="row gap">
          <button
            type="button"
            className="btn primary"
            disabled={saving}
            onClick={() => void persist()}
          >
            {t.settings.saveButton}
          </button>
          <button type="button" className="btn" disabled={testing} onClick={() => void runTest()}>
            {testing ? t.settings.testingConnection : t.settings.testConnectionButton}
          </button>
          {savedAt !== undefined && !saving && (
            <span className="muted small">{t.settings.savedNotice}</span>
          )}
        </div>

        {testResult !== undefined && (
          <output className={testResult.ready ? "ok" : "not-ok"}>
            {testResult.ready ? t.settings.statusReady : testResult.message}
          </output>
        )}
      </fieldset>

      <fieldset className="pill-fieldset">
        <legend>{t.settings.analysisQualityHeading}</legend>
        <div className="row gap">
          <label className="pill-radio">
            <input
              type="radio"
              name="arclume-quality"
              checked={quality === "fast"}
              onChange={() => setQuality("fast")}
            />
            {t.settings.qualityFast}
          </label>
          <label className="pill-radio">
            <input
              type="radio"
              name="arclume-quality"
              checked={quality === "verified"}
              onChange={() => setQuality("verified")}
            />
            {t.settings.qualityVerified}
          </label>
        </div>
        <p className="muted small">
          {quality === "fast" ? t.settings.qualityFastHint : t.settings.qualityVerifiedHint}
        </p>

        {quality === "verified" && (
          <>
            <h3>{t.settings.reviewerHeading}</h3>
            <label htmlFor="ai-reviewer-provider" className="label">
              {t.settings.reviewerProviderLabel}
            </label>
            <select
              id="ai-reviewer-provider"
              value={reviewerProvider}
              onChange={(e) => setReviewerProvider(e.target.value)}
            >
              {state.providers
                .filter((p) => p.id !== "stub")
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
            </select>
            <label htmlFor="ai-reviewer-model" className="label">
              {t.settings.reviewerModelLabel}
            </label>
            <input
              id="ai-reviewer-model"
              type="text"
              value={reviewerModel}
              onChange={(e) => setReviewerModel(e.target.value)}
            />
          </>
        )}
      </fieldset>
    </>
  );
}

function secretKeyFor(providerId: string): string | undefined {
  switch (providerId) {
    case "anthropic":
      return "ANTHROPIC_API_KEY";
    case "openai":
      return "OPENAI_API_KEY";
    case "nvidia":
      return "NVIDIA_API_KEY";
    case "openai-compatible":
      return "OPENAI_COMPATIBLE_API_KEY";
    default:
      return undefined;
  }
}

function privacyNoticeFor(
  descriptor: ProviderDescriptorDto,
  t: ReturnType<typeof useI18n>["t"],
): string {
  if (descriptor.authMode === "subscription-cli") return t.settings.privacyCliNotice;
  if (descriptor.authMode === "local") return t.settings.privacyLocalNotice;
  return t.settings.privacyRemoteNotice;
}
