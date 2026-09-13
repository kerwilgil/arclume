/**
 * Where a secret value actually comes from, in order:
 *
 *   1. an explicit process environment variable (never overwritten by ARCLUME)
 *   2. the stored `secrets\.env`
 *   3. absent
 *
 * ARCLUME never writes to `process.env` — it only reads it — so a value a
 * user set in their shell/CI job always wins over whatever is saved locally.
 */

import type { SecretsMap } from "./secrets-store.js";

export interface ResolvedSecret {
  value: string;
  source: "environment" | "stored";
}

export function resolveSecret(
  key: string,
  stored: SecretsMap,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedSecret | undefined {
  const fromEnv = env[key];
  if (fromEnv !== undefined && fromEnv.length > 0) {
    return { value: fromEnv, source: "environment" };
  }
  const fromStore = stored.get(key);
  if (fromStore !== undefined && fromStore.length > 0) {
    return { value: fromStore, source: "stored" };
  }
  return undefined;
}
