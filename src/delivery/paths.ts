/**
 * The single canonical validator for a bundle-relative artifact path.
 *
 * A manifest is untrusted input: a tampered `entries[].path` must never make the
 * verifier (or the writer) touch a file outside the bundle. Lexical validation
 * here is the first gate; callers additionally resolve-confine the path against
 * the bundle root before any filesystem access.
 */

import { resolve, sep } from "node:path";

const SEGMENT_RE = /^[A-Za-z0-9._-]+$/;
const DRIVE_SEGMENT_RE = /^[A-Za-z]:$/;

export interface PathCheck {
  ok: boolean;
  reason?: string;
}

/**
 * Accept only a canonical POSIX bundle-relative path:
 *  - non-empty, no NUL, no backslash, no leading `/`
 *  - `/`-separated; every segment non-empty, not `.` / `..`, not a drive letter
 *  - each segment matches `[A-Za-z0-9._-]+`
 *  - never `manifest.json` (the manifest never lists itself)
 */
export function validateBundleRelativePath(path: unknown): PathCheck {
  if (typeof path !== "string" || path.length === 0) {
    return { ok: false, reason: "path is empty" };
  }
  if (path.includes("\0")) return { ok: false, reason: "path contains a NUL byte" };
  if (path.includes("\\")) return { ok: false, reason: "path contains a backslash" };
  if (path.startsWith("/")) return { ok: false, reason: "path is absolute" };
  if (path === "manifest.json") {
    return { ok: false, reason: "the manifest must not list itself" };
  }

  const segments = path.split("/");
  for (const seg of segments) {
    if (seg.length === 0) return { ok: false, reason: "path has an empty segment" };
    if (seg === "." || seg === "..") {
      return { ok: false, reason: `path has a "${seg}" segment` };
    }
    if (DRIVE_SEGMENT_RE.test(seg)) return { ok: false, reason: "path has a drive-letter segment" };
    if (!SEGMENT_RE.test(seg)) {
      return { ok: false, reason: `path segment "${seg}" has a disallowed character` };
    }
  }
  return { ok: true };
}

/**
 * Lexical check **plus** resolve confinement: the resolved target must be `dir`
 * itself or strictly inside `dir`. Returns the absolute target on success.
 */
export function resolveConfined(
  dir: string,
  path: string,
): { ok: false; reason: string } | { ok: true; target: string } {
  const lexical = validateBundleRelativePath(path);
  if (!lexical.ok) return { ok: false, reason: lexical.reason ?? "invalid path" };

  const root = resolve(dir);
  const target = resolve(root, ...path.split("/"));
  if (target !== root && !target.startsWith(root + sep)) {
    return { ok: false, reason: "path resolves outside the bundle root" };
  }
  return { ok: true, target };
}
