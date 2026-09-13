// Silences React's "not configured to support act(...)" warning for the
// jsdom-environment component tests under tests/web/**. Harmless no-op for
// every other (Node-environment) test file.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
