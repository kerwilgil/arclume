/** Small shared helpers for Visual QA. Pure, deterministic. */

import { createHash } from "node:crypto";

/** Lowercase hex SHA-256 of raw bytes (screenshot / file content). */
export function sha256Bytes(buf: Uint8Array): string {
  return createHash("sha256").update(buf).digest("hex");
}

/** Lowercase hex SHA-256 of a UTF-8 string. */
export function sha256Utf8(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * A filesystem-safe token derived from a slide id. Deck ids already match
 * `^[A-Za-z][A-Za-z0-9_-]*$`, but a defensive pass keeps screenshot filenames
 * predictable even for a hand-built fixture.
 */
export function safeSlug(id: string): string {
  const cleaned = id
    .replace(/[^A-Za-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned.length > 0 ? cleaned.slice(0, 64) : "slide";
}

/** `16:9` → `1.7778`. Returns `undefined` for anything malformed. */
export function aspectRatioValue(raw: string | undefined): number | undefined {
  if (typeof raw !== "string") return undefined;
  const m = /^(\d+):(\d+)$/.exec(raw.trim());
  if (!m) return undefined;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!(w > 0) || !(h > 0)) return undefined;
  return w / h;
}

/** Zero-padded 1-based slide number for a filename, e.g. `1` → `001`. */
export function pad3(n: number): string {
  return String(n).padStart(3, "0");
}
