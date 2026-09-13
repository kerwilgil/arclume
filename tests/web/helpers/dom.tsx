import type { ReactElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";

/** Mounts a React element into a fresh, attached DOM container for a jsdom test. */
export function mount(element: ReactElement): { container: HTMLDivElement; unmount: () => void } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root;
  act(() => {
    root = createRoot(container);
    root.render(element);
  });
  return {
    container,
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

/** Runs an async state-updating action inside `act`, awaiting it fully. */
export async function actAsync(fn: () => Promise<void> | void): Promise<void> {
  await act(async () => {
    await fn();
  });
}

/** Dispatches a click inside `act`, so the resulting DOM update is
 * observable immediately afterwards (a raw jsdom `.click()` outside `act`
 * schedules React's update on a microtask this synchronous call never
 * waits for). */
export function click(el: Element): void {
  act(() => {
    (el as HTMLElement).click();
  });
}

/**
 * Sets a controlled React <input>'s value the way a real user typing would,
 * bypassing React's tracked-value instrumentation on the native setter (a
 * plain `input.value = x` is invisible to React's onChange — the same reason
 * testing-library's fireEvent.change does this).
 */
export function typeInto(input: HTMLInputElement, value: string): void {
  const nativeSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  act(() => {
    nativeSetter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/**
 * Polls `check()` until it is true, ticking the event loop (wrapped in
 * `act`) between attempts. For state updates that resolve through a promise
 * chain a single `act()` cannot fully await (e.g. a click that kicks off an
 * async, unawaited handler — exactly ARCLUME's own fire-and-forget
 * `void actions.createSource(...)` pattern).
 */
export async function waitFor(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitFor timed out");
    }
    await actAsync(() => new Promise((resolve) => setTimeout(resolve, 0)));
  }
}

/**
 * A controllable fake for `window.matchMedia("(prefers-color-scheme: dark)")`.
 * jsdom does not implement matchMedia at all; ARCLUME's theme system needs a
 * real (if fake) MediaQueryList to observe live OS theme changes.
 */
export function installMatchMediaMock(initialDarkPreferred: boolean): {
  setDark(next: boolean): void;
  restore(): void;
} {
  let dark = initialDarkPreferred;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const original = window.matchMedia;

  window.matchMedia = ((query: string) => {
    const mql = {
      media: query,
      get matches() {
        return query.includes("dark") ? dark : !dark;
      },
      addEventListener: (_type: string, cb: (event: MediaQueryListEvent) => void) => {
        listeners.add(cb);
      },
      removeEventListener: (_type: string, cb: (event: MediaQueryListEvent) => void) => {
        listeners.delete(cb);
      },
      addListener: (cb: (event: MediaQueryListEvent) => void) => listeners.add(cb),
      removeListener: (cb: (event: MediaQueryListEvent) => void) => listeners.delete(cb),
      dispatchEvent: () => true,
      onchange: null,
    } as unknown as MediaQueryList;
    return mql;
  }) as typeof window.matchMedia;

  return {
    setDark(next: boolean) {
      dark = next;
      const event = { matches: dark, media: "(prefers-color-scheme: dark)" } as MediaQueryListEvent;
      for (const cb of Array.from(listeners)) cb(event);
    },
    restore() {
      window.matchMedia = original;
    },
  };
}

/** Overrides `navigator.language` for one test (jsdom allows redefining it). */
export function setNavigatorLanguage(language: string): () => void {
  const original = Object.getOwnPropertyDescriptor(window.navigator, "language");
  Object.defineProperty(window.navigator, "language", {
    value: language,
    configurable: true,
  });
  return () => {
    if (original) Object.defineProperty(window.navigator, "language", original);
  };
}
