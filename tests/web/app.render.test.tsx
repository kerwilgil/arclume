// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../web/src/App";
import { I18nProvider } from "../../web/src/i18n";
import { AppearanceProvider } from "../../web/src/theme";
import { click, mount, setNavigatorLanguage, typeInto, waitFor } from "./helpers/dom";

function fakeResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

/** The Settings AI section fetches this unconditionally on mount (it lives
 * in the always-mounted sidebar block, not behind a lazy Settings route), so
 * every test that mounts <App/> needs it answered — not just Settings tests. */
function fakeProvidersState() {
  return {
    activeProvider: "stub",
    analysisQuality: "fast",
    providers: [
      {
        id: "stub",
        label: "Offline Preview (Stub)",
        authMode: "local",
        requiresBaseUrl: false,
        requiresModel: false,
        requiresApiKey: false,
        secretConfigured: false,
        config: {},
      },
    ],
  };
}

/** The two calls this suite's flows actually make: creating a workspace, and
 * the AI settings panel's always-on-mount provider list fetch. */
function installFetchMock(workspaceId = "ws-test-1"): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url === "/api/workspaces") {
        return fakeResponse(200, { workspace: { id: workspaceId } });
      }
      if (url === "/api/settings/providers") {
        return fakeResponse(200, fakeProvidersState());
      }
      return fakeResponse(404, { ok: false, code: "test/unhandled", message: "unhandled in test" });
    }),
  );
}

function renderApp() {
  return mount(
    <I18nProvider>
      <AppearanceProvider>
        <App />
      </AppearanceProvider>
    </I18nProvider>,
  );
}

async function createWorkspace(container: HTMLElement, path: string): Promise<void> {
  const input = container.querySelector<HTMLInputElement>("#source-input");
  if (!input) throw new Error("source input not found");
  typeInto(input, path);
  const submit = Array.from(container.querySelectorAll("button")).find((b) => b.type === "submit");
  if (!submit) throw new Error("submit button not found");
  click(submit);
  // The submit handler fires an unawaited async chain (mocked fetch -> JSON
  // -> setState); wait for its visible effect rather than assuming one act()
  // flush covers every microtask hop.
  await waitFor(() => container.querySelector(".ws-meta") !== null);
}

function clickByText(container: HTMLElement, tag: string, text: string): void {
  const el = Array.from(container.querySelectorAll(tag)).find((e) => e.textContent === text);
  if (!el) throw new Error(`no <${tag}> with text ${JSON.stringify(text)}`);
  click(el);
}

describe("App — English renders", () => {
  beforeEach(() => {
    window.localStorage.clear();
    installFetchMock();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("shows the English sidebar and Source panel by default (en-US)", () => {
    const restore = setNavigatorLanguage("en-US");
    const { container, unmount } = renderApp();
    const text = container.textContent ?? "";
    expect(text).toContain("1 · Source");
    expect(text).toContain("2 · Analysis");
    expect(text).toContain("3 · Knowledge");
    expect(text).toContain("4 · Build");
    expect(text).toContain("5 · Export");
    expect(text).toContain("Help");
    expect(text).toContain("Settings");
    expect(text).toContain("Create workspace");
    unmount();
    restore();
  });
});

describe("App — Spanish renders", () => {
  beforeEach(() => {
    window.localStorage.clear();
    installFetchMock();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("shows the Spanish sidebar and Source panel by default (es-PA)", () => {
    const restore = setNavigatorLanguage("es-PA");
    const { container, unmount } = renderApp();
    const text = container.textContent ?? "";
    expect(text).toContain("1 · Fuente");
    expect(text).toContain("2 · Análisis");
    expect(text).toContain("3 · Conocimiento");
    expect(text).toContain("4 · Construir");
    expect(text).toContain("5 · Exportar");
    expect(text).toContain("Ayuda");
    expect(text).toContain("Configuración");
    expect(text).toContain("Crear workspace");
    unmount();
    restore();
  });
});

describe("App — locale switching", () => {
  beforeEach(() => {
    window.localStorage.clear();
    installFetchMock();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("switches immediately, with no page reload, and never leaves mixed-language UI", async () => {
    const restore = setNavigatorLanguage("en-US");
    const { container, unmount } = renderApp();

    clickByText(container, "button", "Settings");
    expect(container.textContent).toContain("Language");
    expect(container.textContent).toContain("Appearance");

    const spanishRadio = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
    ).find((r) => r.value === "es");
    if (!spanishRadio) throw new Error("Spanish radio not found");
    click(spanishRadio);

    const text = container.textContent ?? "";
    // Fully switched: no leftover English chrome anywhere in the shell.
    expect(text).toContain("Configuración");
    expect(text).toContain("Idioma");
    expect(text).toContain("Apariencia");
    expect(text).not.toContain("Settings");
    expect(text).not.toContain("Language");
    expect(text).not.toContain("Appearance");
    expect(text).not.toContain("1 · Source");
    expect(text).toContain("1 · Fuente");

    unmount();
    restore();
  });

  it("persists the choice to localStorage under the versioned key", async () => {
    const restore = setNavigatorLanguage("en-US");
    const { container, unmount } = renderApp();
    clickByText(container, "button", "Settings");
    const spanishRadio = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
    ).find((r) => r.value === "es");
    if (!spanishRadio) throw new Error("Spanish radio not found");
    click(spanishRadio);
    expect(window.localStorage.getItem("arclume.ui.locale")).toBe("es");
    unmount();
    restore();
  });

  it("an invalid persisted locale falls back to detection instead of crashing", () => {
    window.localStorage.setItem("arclume.ui.locale", "klingon");
    const restore = setNavigatorLanguage("en-US");
    const { container, unmount } = renderApp();
    expect(container.textContent).toContain("1 · Source");
    unmount();
    restore();
  });
});

describe("App — workspace state survives a language change", () => {
  beforeEach(() => {
    window.localStorage.clear();
    installFetchMock("ws-survives-1");
  });
  afterEach(() => vi.unstubAllGlobals());

  it("keeps the same workspace id and source value across a locale switch", async () => {
    const restore = setNavigatorLanguage("en-US");
    const { container, unmount } = renderApp();

    await createWorkspace(container, "C:\\Project Alpha");
    expect(container.textContent).toContain("ws-survives-1");
    expect(container.textContent).toContain("C:\\Project Alpha");

    clickByText(container, "button", "Settings");
    const spanishRadio = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
    ).find((r) => r.value === "es");
    if (!spanishRadio) throw new Error("Spanish radio not found");
    click(spanishRadio);

    // Back to the workflow — workspace metadata (translated labels, untouched
    // values) is still there; nothing was reset by the locale switch.
    clickByText(container, "button", "2 · Análisis");
    const text = container.textContent ?? "";
    expect(text).toContain("ws-survives-1");
    expect(text).toContain("C:\\Project Alpha");
    expect(text).toContain("Análisis");

    unmount();
    restore();
  });
});

describe("App — user-supplied content is never translated", () => {
  beforeEach(() => {
    window.localStorage.clear();
    installFetchMock("ws-verbatim-1");
  });
  afterEach(() => vi.unstubAllGlobals());

  it("renders a user-provided path exactly as entered, in either UI locale", async () => {
    const restore = setNavigatorLanguage("es-PA");
    const { container, unmount } = renderApp();
    const userPath = "C:\\Documentos\\Informe Final (v2).md";
    await createWorkspace(container, userPath);
    expect(container.textContent).toContain(userPath);
    unmount();
    restore();
  });
});
