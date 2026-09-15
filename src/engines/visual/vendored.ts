/**
 * Vendored Visual Engine identity + integrity digest.
 *
 * The visual engine (https://github.com/tt-a1i/archify, tag `v2.16.0`) is vendored as a
 * fixed file copy under `vendor/archify/` — not an npm dependency, not a git
 * submodule. Any upstream change is a deliberate, reviewed vendor bump that
 * must update these constants together with the engine tests.
 */

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Vendored visual engine version (upstream tag without the `v`). */
export const VISUAL_ENGINE_VENDORED = "2.16.0" as const;

/** Full commit SHA the vendored subtree was taken from. */
export const VISUAL_ENGINE_COMMIT = "c826e6c3a7abad19c0f3cd1ca57207d54b1ad8de" as const;

/**
 * Canonical SHA-256 of the vendored subtree: for every file under
 * `vendor/archify/`, hash `(relative POSIX path, file bytes)` in
 * lexicographic path order. Pinned by `tests/engines/visual/vendor.test.ts`.
 *
 * The digest is computed over the repository-normalized bytes (`.gitattributes`
 * forces `eol=lf` for everything here), so it is identical on Windows, macOS
 * and Linux checkouts.
 */
export const VISUAL_ENGINE_SUBTREE_SHA256 =
  "1953cb41d71d3ba2af0f74ba1a2fc0443138d1ef6e95c4ca9d0706c4b2157257" as const;

/** Number of files in the vendored subtree. */
export const VISUAL_ENGINE_FILE_COUNT = 46 as const;

/** Absolute path of the vendored subtree root (`vendor/archify`). */
export function visualEngineVendorRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // src/engines/visual/vendor.ts → repo root is four levels up …/engines/visual
  return join(here, "..", "..", "..", "vendor", "archify");
}

/** Absolute path of the vendored CLI entry point. */
export function visualEngineCliPath(): string {
  return join(visualEngineVendorRoot(), "bin", "archify.mjs");
}

function walkFiles(root: string, rel: string, out: string[]): void {
  const entries = readdirSync(join(root, rel), { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
  for (const entry of entries) {
    const r = rel === "" ? entry.name : `${rel}/${entry.name}`;
    if (entry.isDirectory()) walkFiles(root, r, out);
    else if (entry.isFile()) out.push(r);
  }
}

/**
 * Recompute the canonical subtree digest. Used by the vendor integrity test;
 * also usable by tooling before a deliberate vendor bump.
 */
export function computeVisualEngineSubtreeDigest(root: string = visualEngineVendorRoot()): {
  sha256: string;
  fileCount: number;
  files: string[];
} {
  if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`vendored visual engine subtree not found at ${root}`);
  }
  const files: string[] = [];
  walkFiles(root, "", files);
  files.sort();
  const hash = createHash("sha256");
  for (const rel of files) {
    hash.update(rel, "utf8");
    hash.update(readFileSync(join(root, ...rel.split("/"))));
  }
  return { sha256: hash.digest("hex"), fileCount: files.length, files };
}
