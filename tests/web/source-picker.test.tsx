// @vitest-environment jsdom
/**
 * Source picker UI — the "Browse…" button on the Source step.
 *
 * Contract under test:
 *  - Browse shows only for a Folder / file source, never for URL.
 *  - A successful pick fills the existing path input; submitting afterwards
 *    sends that exact path through the unchanged workspace pipeline.
 *  - Cancelling the dialog changes nothing (manual text survives).
 *  - Manual typing keeps working, with or without picker support.
 *  - The button is a real <button type="button"> with a locale-correct
 *    aria-label, keyboard-operable by construction.
 *  - The page never sends any input to the picker endpoint.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../web/src/i18n";
import { SourceStep } from "../../web/src/steps";
import { actAsync, click, mount, setNavigatorLanguage, typeInto, waitFor } from "./helpers/dom";

function fakeResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

interface RecordedCall {
  method: string;
  url: string;
  body: unknown;
}

/** Per-test control surface for the fetch stub. */
const pickControl = {
  supported: true,
  status: 200,
  body: { ok: true, cancelled: true } as unknown,
};
let calls: RecordedCall[];

function installFetchMock(): void {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: { method?: string; body?: string }) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({
        method,
        url,
        body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      });
      if (url === "/api/system/pick-source" && method === "GET") {
        return fakeResponse(200, { ok: true, supported: pickControl.supported });
      }
      if (url === "/api/system/pick-source" && method === "POST") {
        return fakeResponse(pickControl.status, pickControl.body);
      }
      return fakeResponse(404, { ok: false, code: "test/unhandled", message: "unhandled" });
    }),
  );
}

function browseButton(container: HTMLElement, ariaLabel: string): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>(`button[aria-label="${ariaLabel}"]`);
}

function sourceInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>("#source-input");
  if (!input) throw new Error("source input not found");
  return input;
}

function submitButton(container: HTMLElement): HTMLButtonElement {
  const submit = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
    (b) => b.type === "submit",
  );
  if (!submit) throw new Error("submit button not found");
  return submit;
}

function renderSource(onSelect: (kind: "path" | "url", value: string) => void) {
  return mount(
    <I18nProvider>
      <SourceStep busy={false} onSelect={onSelect} />
    </I18nProvider>,
  );
}

describe("Source picker — Browse button", () => {
  beforeEach(() => {
    pickControl.supported = true;
    pickControl.status = 200;
    pickControl.body = { ok: true, cancelled: true };
    installFetchMock();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("appears for a Folder / file source once the capability check resolves", async () => {
    const restore = setNavigatorLanguage("en-US");
    const { container, unmount } = renderSource(() => {});
    await waitFor(() => browseButton(container, "Choose folder or file") !== null);
    const btn = browseButton(container, "Choose folder or file");
    expect(btn).not.toBeNull();
    expect(btn?.type).toBe("button");
    expect(btn?.textContent).toBe("Browse…");
    // The capability probe fired, and it carried no payload.
    expect(calls.some((c) => c.method === "GET" && c.url === "/api/system/pick-source")).toBe(true);
    unmount();
    restore();
  });

  it("never appears for a URL source", async () => {
    const restore = setNavigatorLanguage("en-US");
    const { container, unmount } = renderSource(() => {});
    await waitFor(() => browseButton(container, "Choose folder or file") !== null);
    const urlPill = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "URL",
    );
    if (!urlPill) throw new Error("URL pill not found");
    click(urlPill);
    expect(browseButton(container, "Choose folder or file")).toBeNull();
    unmount();
    restore();
  });

  it("stays hidden when the backend reports the picker as unsupported", async () => {
    pickControl.supported = false;
    const restore = setNavigatorLanguage("en-US");
    const { container, unmount } = renderSource(() => {});
    // Let the capability round-trip complete before asserting its absence.
    await waitFor(() =>
      calls.some((c) => c.method === "GET" && c.url === "/api/system/pick-source"),
    );
    await actAsync(() => Promise.resolve());
    expect(browseButton(container, "Choose folder or file")).toBeNull();
    unmount();
    restore();
  });

  it("a successful pick fills the field and that exact path is submitted", async () => {
    const onSelect = vi.fn();
    const restore = setNavigatorLanguage("en-US");
    const { container, unmount } = renderSource(onSelect);
    await waitFor(() => browseButton(container, "Choose folder or file") !== null);

    pickControl.body = { ok: true, cancelled: false, path: "C:\\Mis Proyectos\\demo" };
    click(browseButton(container, "Choose folder or file") as HTMLButtonElement);
    await waitFor(() => sourceInput(container).value === "C:\\Mis Proyectos\\demo");

    click(submitButton(container));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("path", "C:\\Mis Proyectos\\demo");

    // The pick request carried no client data at all.
    const posts = calls.filter((c) => c.method === "POST" && c.url === "/api/system/pick-source");
    expect(posts).toHaveLength(1);
    expect(posts[0]?.body).toBeUndefined();
    unmount();
    restore();
  });

  it("cancelling the dialog preserves whatever the user had typed", async () => {
    const restore = setNavigatorLanguage("en-US");
    const { container, unmount } = renderSource(() => {});
    await waitFor(() => browseButton(container, "Choose folder or file") !== null);

    typeInto(sourceInput(container), "C:\\typed\\by-hand");
    pickControl.body = { ok: true, cancelled: true };
    click(browseButton(container, "Choose folder or file") as HTMLButtonElement);
    await waitFor(() =>
      calls.some((c) => c.method === "POST" && c.url === "/api/system/pick-source"),
    );
    await actAsync(() => Promise.resolve());
    expect(sourceInput(container).value).toBe("C:\\typed\\by-hand");
    unmount();
    restore();
  });

  it("manual typing still submits even when the picker is available", async () => {
    const onSelect = vi.fn();
    const restore = setNavigatorLanguage("en-US");
    const { container, unmount } = renderSource(onSelect);
    await waitFor(() => browseButton(container, "Choose folder or file") !== null);

    typeInto(sourceInput(container), "C:\\manual\\entry");
    click(submitButton(container));
    expect(onSelect).toHaveBeenCalledWith("path", "C:\\manual\\entry");
    // …and the picker endpoint was never invoked.
    expect(calls.some((c) => c.method === "POST" && c.url === "/api/system/pick-source")).toBe(
      false,
    );
    unmount();
    restore();
  });

  it("uses the Spanish labels in an es-* locale", async () => {
    const restore = setNavigatorLanguage("es-PA");
    const { container, unmount } = renderSource(() => {});
    await waitFor(() => browseButton(container, "Seleccionar carpeta o archivo") !== null);
    const btn = browseButton(container, "Seleccionar carpeta o archivo");
    expect(btn?.textContent).toBe("Examinar…");
    unmount();
    restore();
  });
});
