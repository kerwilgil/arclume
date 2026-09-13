// Entry point: wires the HTTP handler to the three components.
// TODO: add a graceful shutdown that drains in-flight decisions.
import { createIngest } from "./ingest/webhook.js";
import { createRulesEngine } from "./rules/engine.js";
import { createStore } from "./store/repository.js";

export function createApp() {
  const store = createStore();
  const rules = createRulesEngine();
  const ingest = createIngest({ rules, store });
  return { ingest };
}
