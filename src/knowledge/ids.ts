/**
 * Deterministic identifier helpers.
 *
 * Phase 1 does not generate knowledge or decks, but downstream phases must
 * derive identifiers *deterministically* — never from randomness or a clock.
 * These helpers are the sanctioned way to do that.
 */

import { sha256Hex } from "../determinism/hash.js";

const ID_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;
const NON_ID_CHARS = /[^A-Za-z0-9]+/g;
const COMBINING_MARKS = /\p{Diacritic}/gu;
const EDGE_HYPHENS = /^-+|-+$/g;

/** True if `value` is a syntactically valid Arclume identifier. */
export function isValidId(value: string): boolean {
  return value.length >= 1 && value.length <= 128 && ID_RE.test(value);
}

/**
 * Lowercase, hyphen-separated slug of arbitrary text, safe as an id body.
 * Deterministic. Returns `"x"` for input that has no alphanumeric content.
 */
export function slugify(text: string): string {
  const slug = text
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    .replace(NON_ID_CHARS, "-")
    .replace(EDGE_HYPHENS, "")
    .toLowerCase();
  return slug.length > 0 ? slug : "x";
}

/** First `length` hex chars of the SHA-256 of `parts` joined with a space. */
export function shortHash(parts: readonly string[], length = 8): string {
  return sha256Hex(parts.join(" ")).slice(0, length);
}

/**
 * Derive a stable id of the form `<prefix>-<shortHash(parts)>`.
 * The same `prefix` + `parts` always yield the same id.
 */
export function deriveId(prefix: string, ...parts: string[]): string {
  const p = slugify(prefix);
  return `${p}-${shortHash(parts.length > 0 ? parts : [p])}`;
}

/**
 * Derive a readable id: `<slug(text)>` if that is free within `taken`,
 * otherwise `<slug(text)>-<shortHash>` and, as a last resort, a numeric suffix.
 * Deterministic given the same `text` and `taken` contents.
 */
export function deriveReadableId(text: string, taken: ReadonlySet<string>): string {
  const base = slugify(text).slice(0, 100);
  if (!taken.has(base)) return base;
  const hashed = `${base}-${shortHash([text])}`;
  if (!taken.has(hashed)) return hashed;
  let n = 2;
  while (taken.has(`${hashed}-${n}`)) n += 1;
  return `${hashed}-${n}`;
}
