import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildManifest, hashFile, verifyManifest } from "../../src/index.js";

/**
 * Filesystem-real confinement (Issue 2): a delivery bundle must be regular files
 * only. `resolve(root, "screenshots/a.png")` can stay lexically inside the
 * bundle while `screenshots` (or `screenshots/a.png` itself) is a symlink /
 * junction that redirects the subsequent read outside the root. `verifyManifest`
 * must reject that WITHOUT following the link — even when the manifest hash of
 * the external target matches.
 */

/** A minimal but valid 1x1 transparent PNG. */
const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+P+/HgAFhAJ/wlseKgAAAABJRU5ErkJggg==",
  "base64",
);

/**
 * Feature detection. A file symlink needs `SeCreateSymbolicLinkPrivilege` on
 * Windows (a locked-down dev box lacks it); a *junction* does not. On Linux both
 * always work. We only ever skip when the runtime genuinely cannot create the
 * link AND the platform is not Linux — GitHub Actions Linux must really run
 * these cases.
 */
function probe(make: (linkPath: string, target: string) => void): boolean {
  const dir = mkdtempSync(join(tmpdir(), "arclume-symlink-probe-"));
  try {
    writeFileSync(join(dir, "t"), "t");
    mkdirSync(join(dir, "d"));
    make(join(dir, "link"), join(dir, "t"));
    return true;
  } catch {
    return false;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const canFileSymlink = probe((link, target) => symlinkSync(target, link));
const canDirLink = probe((link, _t) =>
  symlinkSync(resolve(link, "..", "d"), link, process.platform === "win32" ? "junction" : "dir"),
);

const fileSymlinkIt = canFileSymlink || process.platform === "linux" ? it : it.skip;
const dirLinkIt = canDirLink || process.platform === "linux" ? it : it.skip;

function makeDirLink(target: string, linkPath: string): void {
  // Windows needs an explicit type + absolute target for directory links;
  // "junction" does not require elevation. POSIX takes "dir".
  symlinkSync(resolve(target), linkPath, process.platform === "win32" ? "junction" : "dir");
}

function writeManifest(
  bundle: string,
  entries: Array<{ path: string; bytes: number; sha256: string }>,
): void {
  const manifest = buildManifest({
    deliveryId: "a".repeat(32),
    visualQa: { valid: true, version: "0.1.0" },
    entries,
  });
  writeFileSync(join(bundle, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

describe("delivery bundle — symbolic-link / junction escape", () => {
  let root = "";
  let bundle = "";

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "arclume-symlink-"));
    bundle = join(root, "bundle");
    mkdirSync(bundle, { recursive: true });
    writeFileSync(join(root, "outside.txt"), "SECRET that lives outside the bundle");
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  fileSymlinkIt(
    "rejects a file entry that is a symlink to a file outside the bundle, even with a matching hash",
    () => {
      mkdirSync(join(bundle, "screenshots"), { recursive: true });
      symlinkSync(join("..", "..", "outside.txt"), join(bundle, "screenshots", "escape.txt"));

      // hashFile follows the link → this is the hash of root/outside.txt
      const { bytes, sha256 } = hashFile(join(bundle, "screenshots", "escape.txt"));
      writeManifest(bundle, [{ path: "screenshots/escape.txt", bytes, sha256 }]);

      const v = verifyManifest(bundle);
      expect(v.valid).toBe(false);
      expect(v.issues.some((i) => i.code === "delivery/unsafe-path")).toBe(true);
      // the external secret was never accepted as a bundle artifact
      expect(v.issues.some((i) => i.code === "delivery/hash-mismatch")).toBe(false);
    },
  );

  dirLinkIt(
    "rejects a bundle whose screenshots/ directory is a symlink, without descending it",
    () => {
      const outsideDir = join(root, "outsidedir");
      mkdirSync(outsideDir, { recursive: true });
      writeFileSync(join(outsideDir, "a.png"), PNG_1x1);

      makeDirLink(outsideDir, join(bundle, "screenshots"));

      const { bytes, sha256 } = hashFile(join(outsideDir, "a.png"));
      writeManifest(bundle, [{ path: "screenshots/a.png", bytes, sha256 }]);

      const v = verifyManifest(bundle);
      expect(v.valid).toBe(false);
      expect(v.issues.some((i) => i.code === "delivery/unsafe-path")).toBe(true);
    },
  );

  it("positive control: a bundle with a regular screenshots/a.png verifies clean", () => {
    mkdirSync(join(bundle, "screenshots"), { recursive: true });
    writeFileSync(join(bundle, "screenshots", "a.png"), PNG_1x1);

    const { bytes, sha256 } = hashFile(join(bundle, "screenshots", "a.png"));
    writeManifest(bundle, [{ path: "screenshots/a.png", bytes, sha256 }]);

    expect(verifyManifest(bundle).valid).toBe(true);
  });
});
