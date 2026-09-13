import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesRoot = join(here, "..", "fixtures");

/** Load and parse a JSON fixture given a path relative to `tests/fixtures/`. */
export function loadFixture<T = unknown>(relativePath: string): T {
  const full = join(fixturesRoot, relativePath);
  return JSON.parse(readFileSync(full, "utf8")) as T;
}

/** Deep clone via JSON round-trip (fixtures are plain JSON). */
export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
