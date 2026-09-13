/**
 * Locating the bundled schema files without assuming a specific OS path style
 * or a fixed depth from source to build output.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Directory of the current module, resolved portably. */
function moduleDir(): string {
  // `import.meta.dirname` exists on Node >= 20.11; fall back for older 20.x.
  const metaDir = (import.meta as { dirname?: string }).dirname;
  if (typeof metaDir === "string" && metaDir.length > 0) return metaDir;
  return dirname(fileURLToPath(import.meta.url));
}

/**
 * Walk upward from `start` until a directory containing a `package.json` whose
 * `name` is `arclume` is found. Throws if none is found before the filesystem
 * root — that would mean a broken install.
 */
export function findPackageRoot(start: string = moduleDir()): string {
  let dir = resolve(start);
  for (;;) {
    const manifest = join(dir, "package.json");
    if (existsSync(manifest)) {
      try {
        const parsed = JSON.parse(readFileSync(manifest, "utf8")) as { name?: unknown };
        if (parsed.name === "arclume") return dir;
      } catch {
        // ignore malformed package.json and keep walking up
      }
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(`arclume: could not locate the package root starting from "${start}"`);
    }
    dir = parent;
  }
}

/** Absolute path to the bundled `schemas/` directory. */
export function schemasDir(): string {
  return join(findPackageRoot(), "schemas");
}
