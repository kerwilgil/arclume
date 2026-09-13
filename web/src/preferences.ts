/**
 * UI preference persistence — locale and appearance only.
 *
 * These are frontend-only conveniences, deliberately kept separate from
 * `AppState` (workspace/knowledge/build): they must survive across workspaces
 * and must never be cleared when a workspace is discarded.
 *
 * `localStorage` is wrapped defensively everywhere: a private window, cleared
 * site data, a disabled storage API (SecurityError), a quota error, or a
 * corrupted stored value must never crash ARCLUME — they fall back to
 * `undefined` (caller applies its own default) rather than throwing.
 */

const KEY_PREFIX = "arclume.ui.";

/** Reads a raw string preference. Returns `undefined` on any failure. */
export function readPreference(key: string): string | undefined {
  try {
    if (typeof window === "undefined" || !window.localStorage) return undefined;
    const value = window.localStorage.getItem(KEY_PREFIX + key);
    return value === null ? undefined : value;
  } catch {
    return undefined;
  }
}

/** Writes a raw string preference. Silently no-ops on any failure. */
export function writePreference(key: string, value: string): void {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    window.localStorage.setItem(KEY_PREFIX + key, value);
  } catch {
    // Quota exceeded, SecurityError, storage disabled — ARCLUME keeps
    // working with the in-memory value for the rest of this session.
  }
}

/**
 * Reads a preference and validates it against `isValid`. An unset, corrupted
 * or otherwise invalid stored value resolves to `undefined` so the caller can
 * apply its own safe default — it is never surfaced as-is.
 */
export function readValidatedPreference<T extends string>(
  key: string,
  isValid: (value: string) => value is T,
): T | undefined {
  const raw = readPreference(key);
  if (raw !== undefined && isValid(raw)) return raw;
  return undefined;
}
