import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const helpersDir = dirname(fileURLToPath(import.meta.url));

/** Absolute path to the committed, read-only sample repository fixture. */
export function sampleRepoPath(): string {
  return join(helpersDir, "..", "..", "examples", "fixtures", "sample-repo");
}

export interface TmpRepo {
  dir: string;
  write(relPath: string, content: string | Uint8Array): void;
  mkdir(relPath: string): void;
  /** Create a symlink; returns false if the OS refused (e.g. Windows w/o privilege). */
  symlink(relPath: string, target: string): boolean;
  cleanup(): void;
}

/** Copy the sample repo into a fresh temp directory for mutation in a test. */
export function makeTmpRepo(seedFromSample = true): TmpRepo {
  const dir = mkdtempSync(join(tmpdir(), "arclume-repo-"));
  if (seedFromSample) cpSync(sampleRepoPath(), dir, { recursive: true });
  return {
    dir,
    write(relPath, content) {
      const full = join(dir, relPath);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content);
    },
    mkdir(relPath) {
      mkdirSync(join(dir, relPath), { recursive: true });
    },
    symlink(relPath, target) {
      try {
        symlinkSync(target, join(dir, relPath));
        return true;
      } catch {
        return false;
      }
    },
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** A fresh empty temp directory. */
export function makeEmptyDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "arclume-empty-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
