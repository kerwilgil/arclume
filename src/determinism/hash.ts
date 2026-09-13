/**
 * Deterministic serialization and hashing.
 *
 * Used to produce stable `contentHash` / `sourceDigest` values and stable
 * derived identifiers. No randomness, no clock, no network.
 */

import { createHash } from "node:crypto";

/** JSON value domain accepted by {@link stableStringify}. */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * Serialize a JSON value with object keys sorted lexicographically at every
 * level and no insignificant whitespace. Array order is preserved.
 *
 * Throws on values that cannot be represented deterministically:
 *  - non-finite numbers (`NaN`, `Infinity`)
 *  - `undefined`, functions, symbols, `bigint`
 *  - circular references
 */
export function stableStringify(value: unknown): string {
  return write(value, new Set());
}

function write(value: unknown, seen: Set<object>): string {
  if (value === null) return "null";

  const t = typeof value;

  if (t === "string") return JSON.stringify(value);
  if (t === "boolean") return value ? "true" : "false";
  if (t === "number") {
    if (!Number.isFinite(value as number)) {
      throw new TypeError(
        `stableStringify: non-finite number is not representable (${String(value)})`,
      );
    }
    return JSON.stringify(value);
  }
  if (t === "undefined" || t === "function" || t === "symbol" || t === "bigint") {
    throw new TypeError(`stableStringify: value of type "${t}" is not representable`);
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) throw new TypeError("stableStringify: circular reference");
    seen.add(value);
    const body = value.map((item) => write(item, seen)).join(",");
    seen.delete(value);
    return `[${body}]`;
  }

  // plain object
  const obj = value as Record<string, unknown>;
  if (seen.has(obj)) throw new TypeError("stableStringify: circular reference");
  seen.add(obj);
  const keys = Object.keys(obj).sort();
  const parts: string[] = [];
  for (const key of keys) {
    const v = obj[key];
    if (v === undefined) continue; // mirror JSON.stringify: drop undefined members
    parts.push(`${JSON.stringify(key)}:${write(v, seen)}`);
  }
  seen.delete(obj);
  return `{${parts.join(",")}}`;
}

/** Lowercase hex SHA-256 of a string. */
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** `sha256:`-prefixed hex SHA-256 of a string (the `contentHash` shape). */
export function sha256Prefixed(input: string): string {
  return `sha256:${sha256Hex(input)}`;
}

/**
 * Deterministic content hash of any JSON-serializable value, in the
 * `sha256:<64 hex>` form used by the schemas' `contentHash`.
 */
export function contentHash(value: unknown): string {
  return sha256Prefixed(stableStringify(value));
}
