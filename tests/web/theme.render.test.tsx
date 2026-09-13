// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { AppearanceProvider, useAppearance } from "../../web/src/theme/index";
import { actAsync, installMatchMediaMock, mount } from "./helpers/dom";

function Probe(): JSX.Element {
  const { appearance, effectiveTheme, setAppearance } = useAppearance();
  return (
    <div>
      <span data-testid="appearance">{appearance}</span>
      <span data-testid="effective">{effectiveTheme}</span>
      <button type="button" onClick={() => setAppearance("dark")}>
        go-dark
      </button>
      <button type="button" onClick={() => setAppearance("light")}>
        go-light
      </button>
      <button type="button" onClick={() => setAppearance("system")}>
        go-system
      </button>
    </div>
  );
}

function text(container: HTMLElement, testId: string): string {
  return container.querySelector(`[data-testid="${testId}"]`)?.textContent ?? "";
}

describe("AppearanceProvider — default (no persisted preference)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it("defaults to system and follows a dark OS preference", async () => {
    const media = installMatchMediaMock(true);
    const { container, unmount } = mount(
      <AppearanceProvider>
        <Probe />
      </AppearanceProvider>,
    );
    expect(text(container, "appearance")).toBe("system");
    expect(text(container, "effective")).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    unmount();
    media.restore();
  });

  it("defaults to system and follows a light OS preference", () => {
    const media = installMatchMediaMock(false);
    const { container, unmount } = mount(
      <AppearanceProvider>
        <Probe />
      </AppearanceProvider>,
    );
    expect(text(container, "effective")).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    unmount();
    media.restore();
  });

  it("reacts live when the OS preference changes while mounted", async () => {
    const media = installMatchMediaMock(false);
    const { container, unmount } = mount(
      <AppearanceProvider>
        <Probe />
      </AppearanceProvider>,
    );
    expect(text(container, "effective")).toBe("light");

    await actAsync(() => {
      media.setDark(true);
    });

    expect(text(container, "effective")).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    unmount();
    media.restore();
  });
});

describe("AppearanceProvider — explicit choice overrides the OS", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it("explicit dark stays dark even if the OS is light", async () => {
    const media = installMatchMediaMock(false);
    const { container, unmount } = mount(
      <AppearanceProvider>
        <Probe />
      </AppearanceProvider>,
    );
    await actAsync(() => {
      container.querySelector<HTMLButtonElement>("button")?.click(); // go-dark is first
    });
    expect(text(container, "appearance")).toBe("dark");
    expect(text(container, "effective")).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");

    // OS flipping to dark too must not change anything — already dark.
    await actAsync(() => media.setDark(true));
    expect(text(container, "effective")).toBe("dark");
    unmount();
    media.restore();
  });

  it("explicit light stays light even if the OS is dark", async () => {
    const media = installMatchMediaMock(true);
    const { container, unmount } = mount(
      <AppearanceProvider>
        <Probe />
      </AppearanceProvider>,
    );
    const buttons = container.querySelectorAll("button");
    await actAsync(() => {
      (buttons[1] as HTMLButtonElement).click(); // go-light
    });
    expect(text(container, "appearance")).toBe("light");
    expect(text(container, "effective")).toBe("light");
    unmount();
    media.restore();
  });
});

describe("AppearanceProvider — persistence", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it("persists the explicit choice and a fresh mount reads it back", async () => {
    const media = installMatchMediaMock(false);
    const first = mount(
      <AppearanceProvider>
        <Probe />
      </AppearanceProvider>,
    );
    const buttons = first.container.querySelectorAll("button");
    await actAsync(() => (buttons[0] as HTMLButtonElement).click()); // go-dark
    expect(window.localStorage.getItem("arclume.ui.appearance")).toBe("dark");
    first.unmount();

    const second = mount(
      <AppearanceProvider>
        <Probe />
      </AppearanceProvider>,
    );
    expect(text(second.container, "appearance")).toBe("dark");
    expect(text(second.container, "effective")).toBe("dark");
    second.unmount();
    media.restore();
  });

  it("an invalid persisted value falls back to system", () => {
    window.localStorage.setItem("arclume.ui.appearance", "neon");
    const media = installMatchMediaMock(true);
    const { container, unmount } = mount(
      <AppearanceProvider>
        <Probe />
      </AppearanceProvider>,
    );
    expect(text(container, "appearance")).toBe("system");
    expect(text(container, "effective")).toBe("dark");
    unmount();
    media.restore();
  });
});
