/**
 * Read-side verification of a delivered (or staged) bundle.
 *
 * `verifyManifest(dir)` re-reads every file the manifest lists, re-hashes it,
 * and reports any missing / mismatched / unlisted artifact. It also validates
 * the manifest against its JSON Schema. The manifest never lists itself.
 *
 * Confinement is both lexical and *filesystem-real*: a manifest entry may not
 * pass through a symbolic link / junction at any path component, and the
 * directory walk never follows or descends a link. `resolve(root, seg…)` can
 * stay lexically inside the bundle while a component is a reparse point that
 * redirects the subsequent `readFileSync` / `hashFile` outside it — so every
 * component from the bundle root to the target is checked with `lstatSync`
 * (which does not follow links) before any byte is read.
 */

import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { checkPhase6Schema } from "../validation/visual-qa/schema.js";
import { resolveConfined } from "./paths.js";
import type { DeliveryManifest, ManifestIssue, ManifestVerification } from "./types.js";
import { MANIFEST_FILENAME } from "./types.js";

export function hashFile(path: string): { bytes: number; sha256: string } {
  const buf = readFileSync(path);
  return { bytes: buf.length, sha256: createHash("sha256").update(buf).digest("hex") };
}

/**
 * Walk every path component of `relPath` from `root` downwards with `lstatSync`
 * (never `statSync` — that follows links). Returns the bundle-relative path of
 * the first existing component that is a symbolic link / junction, or
 * `undefined` when the whole chain is plain directories / a plain file. A
 * bundle verifier must not reach an artifact through filesystem indirection,
 * even when `resolve()` keeps the path lexically inside the root. `relPath` must
 * already be a validated safe bundle-relative POSIX path.
 */
function symlinkComponent(root: string, relPath: string): string | undefined {
  const rootAbs = resolve(root);
  let current = rootAbs;
  for (const seg of relPath.split("/")) {
    current = join(current, seg);
    let st: ReturnType<typeof lstatSync>;
    try {
      st = lstatSync(current);
    } catch {
      // component does not exist — nothing here to follow
      return undefined;
    }
    if (st.isSymbolicLink()) {
      return relative(rootAbs, current).split(sep).join("/");
    }
  }
  return undefined;
}

interface BundleListing {
  /** Regular files, bundle-relative POSIX paths. */
  files: string[];
  /** Symbolic-link components found anywhere in the tree (never followed). */
  symlinks: string[];
}

/**
 * List the bundle tree with `lstatSync`. A symbolic link (file *or* directory)
 * is recorded and never followed or descended — a delivery bundle is regular
 * files only. Sockets / FIFOs / devices are ignored here; the manifest
 * cross-check still flags anything listed but not a regular file.
 */
function listEntries(dir: string): BundleListing {
  const files: string[] = [];
  const symlinks: string[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d).sort()) {
      const full = join(d, name);
      const rel = relative(dir, full).split(sep).join("/");
      const st = lstatSync(full);
      if (st.isSymbolicLink()) {
        symlinks.push(rel);
        continue;
      }
      if (st.isDirectory()) walk(full);
      else if (st.isFile()) files.push(rel);
    }
  };
  walk(dir);
  return { files, symlinks };
}

export function verifyManifest(dir: string): ManifestVerification {
  const issues: ManifestIssue[] = [];
  const manifestPath = join(dir, MANIFEST_FILENAME);

  if (!existsSync(manifestPath)) {
    return {
      valid: false,
      deliveryId: "",
      issues: [
        {
          code: "delivery/manifest-missing",
          message: `${MANIFEST_FILENAME} is not present in ${dir}`,
        },
      ],
    };
  }

  let manifest: DeliveryManifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as DeliveryManifest;
  } catch (cause) {
    return {
      valid: false,
      deliveryId: "",
      issues: [
        {
          code: "delivery/manifest-unreadable",
          message: `manifest.json is not valid JSON: ${(cause as Error).message}`,
        },
      ],
    };
  }

  const schema = checkPhase6Schema("deliveryManifest", manifest);
  if (!schema.valid) {
    for (const e of schema.errors) {
      issues.push({ code: "delivery/manifest-schema", message: e });
    }
  }

  const listed = new Set<string>();
  const seen = new Set<string>();
  for (const entry of manifest.entries ?? []) {
    // A tampered manifest must never make the verifier read outside the bundle.
    // Lexical check + resolve confinement, BEFORE any filesystem access.
    const confined = resolveConfined(dir, entry.path);
    if (!confined.ok) {
      issues.push({
        code: "delivery/unsafe-path",
        path: entry.path,
        message: `manifest entry "${entry.path}" is not a safe bundle path: ${confined.reason}`,
      });
      continue;
    }
    if (seen.has(entry.path)) {
      issues.push({
        code: "delivery/duplicate-path",
        path: entry.path,
        message: `manifest lists "${entry.path}" more than once`,
      });
      continue;
    }
    seen.add(entry.path);
    listed.add(entry.path);

    // Filesystem-real confinement: reject the entry if any component from the
    // bundle root to the target is a symbolic link / junction. Runs BEFORE any
    // existsSync / readFileSync / hashFile so a link is never followed.
    const badLink = symlinkComponent(dir, entry.path);
    if (badLink) {
      issues.push({
        code: "delivery/unsafe-path",
        path: entry.path,
        message: `manifest entry "${entry.path}" passes through a symbolic link ("${badLink}") — symbolic links are not allowed in a delivery bundle`,
      });
      continue;
    }

    const full = confined.target;
    if (!existsSync(full)) {
      issues.push({
        code: "delivery/missing-artifact",
        path: entry.path,
        message: `manifest lists "${entry.path}" but it is not on disk`,
      });
      continue;
    }
    if (!lstatSync(full).isFile()) {
      issues.push({
        code: "delivery/unsafe-path",
        path: entry.path,
        message: `manifest entry "${entry.path}" is not a regular file`,
      });
      continue;
    }
    const { bytes, sha256 } = hashFile(full);
    if (bytes !== entry.bytes) {
      issues.push({
        code: "delivery/hash-mismatch",
        path: entry.path,
        message: `"${entry.path}" is ${bytes} bytes, manifest says ${entry.bytes}`,
      });
    }
    if (sha256 !== entry.sha256) {
      issues.push({
        code: "delivery/hash-mismatch",
        path: entry.path,
        message: `"${entry.path}" SHA-256 ${sha256.slice(0, 12)}… does not match manifest ${entry.sha256.slice(0, 12)}…`,
      });
    }
  }

  const listing = listEntries(dir);
  for (const rel of listing.symlinks) {
    issues.push({
      code: "delivery/unsafe-path",
      path: rel,
      message: `"${rel}" is a symbolic link — symbolic links are not allowed in a delivery bundle`,
    });
  }
  for (const rel of listing.files) {
    if (rel === MANIFEST_FILENAME) continue;
    if (!listed.has(rel)) {
      issues.push({
        code: "delivery/unlisted-artifact",
        path: rel,
        message: `"${rel}" is in the bundle but not in the manifest`,
      });
    }
  }

  return { valid: issues.length === 0, deliveryId: manifest.deliveryId ?? "", issues };
}
