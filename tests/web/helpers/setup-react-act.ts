// Silences React's "not configured to support act(...)" warning for the
// jsdom-environment component tests under tests/web/**. Harmless no-op for
// every other (Node-environment) test file.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Node 26 exposes a process-level `localStorage` global. Vitest intentionally
// leaves globals already present on Node untouched when it populates jsdom,
// then aliases `window` to that global. Rebind the Web Storage surface to the
// active jsdom window so browser-contract tests exercise jsdom storage.
const jsdomWindow = (
  globalThis as typeof globalThis & {
    jsdom?: { window?: Window };
  }
).jsdom?.window;

if (jsdomWindow) {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get: () => jsdomWindow.localStorage,
  });
}
