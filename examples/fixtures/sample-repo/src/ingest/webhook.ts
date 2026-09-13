// Ingest component: receive and normalize tracker webhooks.
export interface TaskEvent {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
}

export function createIngest(deps: { rules: unknown; store: unknown }) {
  return {
    handle(_event: TaskEvent) {
      // FIXME: stop logging the raw payload once field-level redaction lands.
      return { accepted: true, deps };
    },
  };
}
