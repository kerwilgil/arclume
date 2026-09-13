/**
 * Source Evidence — hermetic Git reference verification (Slice 2B).
 *
 * Every test builds its own throw-away Git repo in the OS temp dir with an
 * isolated HOME and no system/global config, so nothing here depends on the
 * machine's Git identity, hooks, or credentials.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  countBlobLines,
  isSafeRevision,
  verifyGitEvidence,
  verifySourceRefEvidence,
} from "../../src/evidence/index.js";
import type { SourceRef } from "../../src/index.js";

const created: string[] = [];
afterAll(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

interface Repo {
  dir: string;
  head: string;
}

function git(dir: string, args: string[]): { status: number; stdout: string; stderr: string } {
  const res = spawnSync("git", args, {
    cwd: dir,
    encoding: "utf8",
    env: {
      PATH: process.env["PATH"],
      SystemRoot: process.env["SystemRoot"],
      PATHEXT: process.env["PATHEXT"],
      HOME: dir,
      USERPROFILE: dir,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: join(dir, "no-global-config"),
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.invalid",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.invalid",
      GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z",
      GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z",
      GIT_TERMINAL_PROMPT: "0",
    },
  });
  return {
    status: res.status ?? 1,
    stdout: (res.stdout ?? "").trim(),
    stderr: (res.stderr ?? "").trim(),
  };
}

/** A repo with `src/app.ts` (5 lines), `docs/` dir, and a second commit. */
function makeRepo(): Repo {
  const dir = mkdtempSync(join(tmpdir(), "arclume-evidence-"));
  created.push(dir);
  git(dir, ["-c", "init.defaultBranch=main", "init", "-q"]);
  git(dir, ["config", "commit.gpgsign", "false"]);

  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src", "app.ts"), "line1\nline2\nline3\nline4\nline5\n");
  mkdirSync(join(dir, "docs"), { recursive: true });
  writeFileSync(join(dir, "docs", "readme.md"), "# docs\n");
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "initial"]);

  writeFileSync(join(dir, "src", "app.ts"), "one\ntwo\n");
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "shrink app"]);

  const head = git(dir, ["rev-parse", "HEAD"]).stdout;
  return { dir, head };
}

describe("verifyGitEvidence — happy paths", () => {
  const repo = makeRepo();
  const firstCommit = git(repo.dir, ["rev-parse", "HEAD~1"]).stdout;

  it("VERIFIED: repo + revision + relative path (no line range)", () => {
    const v = verifyGitEvidence({ repoRoot: repo.dir, revision: repo.head, path: "src/app.ts" });
    expect(v.verdict).toBe("VERIFIED");
    expect(v.reasonCode).toBe("verified");
    expect(v.checked.commit).toMatch(/^[0-9a-f]{40}$/);
  });

  it("VERIFIED: valid line range inside the file at that revision", () => {
    const v = verifyGitEvidence({
      repoRoot: repo.dir,
      revision: firstCommit,
      path: "src/app.ts",
      lineStart: 2,
      lineEnd: 4,
    });
    expect(v.verdict).toBe("VERIFIED");
    expect(v.checked.lineCount).toBe(5);
  });

  it("range is evaluated against the file AT THE GIVEN REVISION, not HEAD", () => {
    // app.ts has 5 lines in the first commit, 2 in HEAD.
    const atOld = verifyGitEvidence({
      repoRoot: repo.dir,
      revision: firstCommit,
      path: "src/app.ts",
      lineStart: 5,
      lineEnd: 5,
    });
    expect(atOld.verdict).toBe("VERIFIED");
    const atHead = verifyGitEvidence({
      repoRoot: repo.dir,
      revision: repo.head,
      path: "src/app.ts",
      lineStart: 5,
      lineEnd: 5,
    });
    expect(atHead.verdict).toBe("UNVERIFIED");
    expect(atHead.reasonCode).toBe("line-range-out-of-bounds");
    expect(atHead.checked.lineCount).toBe(2);
  });

  it("is deterministic — identical query yields an identical verification", () => {
    const q = {
      repoRoot: repo.dir,
      revision: repo.head,
      path: "src/app.ts",
      lineStart: 1,
      lineEnd: 2,
    };
    expect(JSON.stringify(verifyGitEvidence(q))).toBe(JSON.stringify(verifyGitEvidence(q)));
  });
});

describe("verifyGitEvidence — UNVERIFIED (well-formed but wrong)", () => {
  const repo = makeRepo();

  it("bad revision: a syntactically valid SHA that is not in the repo", () => {
    const v = verifyGitEvidence({
      repoRoot: repo.dir,
      revision: "0".repeat(40),
      path: "src/app.ts",
    });
    expect(v.verdict).toBe("UNVERIFIED");
    expect(v.reasonCode).toBe("revision-missing");
  });

  it("missing file at that revision", () => {
    const v = verifyGitEvidence({
      repoRoot: repo.dir,
      revision: repo.head,
      path: "src/does-not-exist.ts",
    });
    expect(v.verdict).toBe("UNVERIFIED");
    expect(v.reasonCode).toBe("path-missing");
  });

  it("path resolves to a directory, not a file", () => {
    const v = verifyGitEvidence({ repoRoot: repo.dir, revision: repo.head, path: "docs" });
    expect(v.verdict).toBe("UNVERIFIED");
    expect(v.reasonCode).toBe("path-not-blob");
  });

  it("invalid line range: lineEnd before lineStart", () => {
    const v = verifyGitEvidence({
      repoRoot: repo.dir,
      revision: "HEAD~1",
      path: "src/app.ts",
      lineStart: 4,
      lineEnd: 2,
    });
    // "HEAD~1" is itself an expression → refused before the range is even reached
    expect(v.verdict).toBe("UNVERIFIED");
    expect(v.reasonCode).toBe("revision-unsafe");
  });

  it("invalid line range on a safe revision: lineEnd before lineStart", () => {
    const first = git(repo.dir, ["rev-parse", "HEAD~1"]).stdout;
    const v = verifyGitEvidence({
      repoRoot: repo.dir,
      revision: first,
      path: "src/app.ts",
      lineStart: 4,
      lineEnd: 2,
    });
    expect(v.verdict).toBe("UNVERIFIED");
    expect(v.reasonCode).toBe("line-range-invalid");
  });

  it("line range past the end of the file", () => {
    const first = git(repo.dir, ["rev-parse", "HEAD~1"]).stdout;
    const v = verifyGitEvidence({
      repoRoot: repo.dir,
      revision: first,
      path: "src/app.ts",
      lineStart: 3,
      lineEnd: 99,
    });
    expect(v.verdict).toBe("UNVERIFIED");
    expect(v.reasonCode).toBe("line-range-out-of-bounds");
  });
});

describe("verifyGitEvidence — security: unsafe path / revision", () => {
  const repo = makeRepo();

  it.each([
    ["../outside.txt", "path traversal"],
    ["src/../../etc/passwd", "traversal via a mid-path .."],
    ["/etc/passwd", "absolute POSIX path"],
    ["C:/Windows/win.ini", "absolute Windows path"],
    ["src\\app.ts", "backslash separator"],
    ["a//b", "empty path segment"],
  ])("UNVERIFIED path-unsafe: %s (%s)", (badPath) => {
    const v = verifyGitEvidence({ repoRoot: repo.dir, revision: repo.head, path: badPath });
    expect(v.verdict).toBe("UNVERIFIED");
    expect(v.reasonCode).toBe("path-unsafe");
  });

  it.each([
    ["HEAD~1", "revision expression (~)"],
    ["main^", "revision expression (^)"],
    ["HEAD@{0}", "reflog expression"],
    ["-oProxyCommand=x", "option injection"],
    ["a b", "whitespace"],
    ["refs/heads/main:src/app.ts", "object-syntax path"],
  ])("UNVERIFIED revision-unsafe: %s (%s)", (badRev) => {
    const v = verifyGitEvidence({ repoRoot: repo.dir, revision: badRev, path: "src/app.ts" });
    expect(v.verdict).toBe("UNVERIFIED");
    expect(v.reasonCode).toBe("revision-unsafe");
  });

  it("does NOT execute a repo Git hook during verification", () => {
    const sentinel = join(repo.dir, "HOOK_RAN");
    const hooksDir = join(repo.dir, ".githooks");
    mkdirSync(hooksDir, { recursive: true });
    // A hook that would fire on any checkout/gc/commit if hooks were honored.
    for (const name of [
      "post-checkout",
      "post-index-change",
      "reference-transaction",
      "pre-auto-gc",
    ]) {
      writeFileSync(join(hooksDir, name), `#!/bin/sh\necho ran > "${sentinel}"\n`, { mode: 0o755 });
    }
    git(repo.dir, ["config", "core.hooksPath", hooksDir]);

    verifyGitEvidence({
      repoRoot: repo.dir,
      revision: repo.head,
      path: "src/app.ts",
      lineStart: 1,
      lineEnd: 1,
    });

    expect(existsSync(sentinel)).toBe(false);
  });
});

describe("verifyGitEvidence — UNAVAILABLE (check could not run)", () => {
  it("repo path does not exist", () => {
    const v = verifyGitEvidence({
      repoRoot: join(tmpdir(), `arclume-nope-${Date.now()}`),
      revision: "0".repeat(40),
      path: "src/app.ts",
    });
    expect(v.verdict).toBe("UNAVAILABLE");
    expect(v.reasonCode).toBe("repo-missing");
  });

  it("directory exists but is not a Git repository", () => {
    const dir = mkdtempSync(join(tmpdir(), "arclume-notgit-"));
    created.push(dir);
    const v = verifyGitEvidence({ repoRoot: dir, revision: "0".repeat(40), path: "x.ts" });
    expect(v.verdict).toBe("UNAVAILABLE");
    expect(v.reasonCode).toBe("repo-not-git");
  });
});

describe("verifySourceRefEvidence — SourceRef / FileLocator", () => {
  const repo = makeRepo();
  const first = git(repo.dir, ["rev-parse", "HEAD~1"]).stdout;

  it("VERIFIED when the file locator carries its own commit + range", () => {
    const ref: SourceRef = {
      sourceId: "s1",
      locator: { kind: "file", path: "src/app.ts", lineStart: 1, lineEnd: 3, commit: first },
    };
    const v = verifySourceRefEvidence(ref, { repoRoot: repo.dir });
    expect(v.verdict).toBe("VERIFIED");
  });

  it("UNVERIFIED locator-not-file for a non-file locator", () => {
    const ref: SourceRef = { sourceId: "s1", locator: { kind: "url", url: "https://example.com" } };
    const v = verifySourceRefEvidence(ref, { repoRoot: repo.dir });
    expect(v.verdict).toBe("UNVERIFIED");
    expect(v.reasonCode).toBe("locator-not-file");
  });

  it("UNVERIFIED locator-missing when there is no locator", () => {
    const v = verifySourceRefEvidence({ sourceId: "s1" }, { repoRoot: repo.dir });
    expect(v.reasonCode).toBe("locator-missing");
  });

  it("UNVERIFIED revision-missing when locator has no commit and no fallback", () => {
    const ref: SourceRef = { sourceId: "s1", locator: { kind: "file", path: "src/app.ts" } };
    const v = verifySourceRefEvidence(ref, { repoRoot: repo.dir });
    expect(v.reasonCode).toBe("revision-missing");
  });

  it("uses fallbackRevision when the locator omits the commit", () => {
    const ref: SourceRef = { sourceId: "s1", locator: { kind: "file", path: "src/app.ts" } };
    const v = verifySourceRefEvidence(ref, { repoRoot: repo.dir, fallbackRevision: repo.head });
    expect(v.verdict).toBe("VERIFIED");
  });
});

describe("isSafeRevision", () => {
  it.each(["a1b2c3d", "0".repeat(40), "0".repeat(64), "HEAD", "main", "release/1.2.0", "v1.0.0"])(
    "accepts %s",
    (r) => expect(isSafeRevision(r)).toBe(true),
  );
  it.each([
    "",
    " main",
    "-x",
    "HEAD~1",
    "main^",
    "a..b",
    "HEAD@{yesterday}",
    "refs/heads/x:y",
    "branch name",
    "main.lock",
    "feature/",
  ])("rejects %j", (r) => expect(isSafeRevision(r)).toBe(false));
});

describe("countBlobLines", () => {
  it.each<[string, number]>([
    ["", 0],
    ["a", 1],
    ["a\n", 1],
    ["a\nb", 2],
    ["a\nb\n", 2],
    ["\n", 1],
    ["a\n\n", 2],
  ])("%j -> %i", (text, expected) => {
    expect(countBlobLines(Buffer.from(text, "utf8"))).toBe(expected);
  });
});
