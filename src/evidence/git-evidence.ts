/**
 * Local, hermetic verification of a Git source reference (Slice 2B).
 *
 * Given a repo root, a source-root-relative path, a revision and an optional
 * 1-based inclusive line range, `verifyGitEvidence` confirms — or refuses to
 * confirm — that the reference points at real content.
 *
 * Security model (every point is enforced here, not assumed):
 *  - **No network.** Only read-only plumbing (`rev-parse`, `ls-tree`,
 *    `cat-file`) is ever spawned; `GIT_TERMINAL_PROMPT=0` and
 *    `GIT_ALLOW_PROTOCOL=""` make any accidental transport fail closed.
 *  - **No Git hooks.** `core.hooksPath` is pinned to the null device, so a
 *    hook checked into the repo can never run.
 *  - **No repo scripts / filters.** File bytes come from `cat-file blob`,
 *    which returns the raw object with no smudge filter, no `textconv`, no
 *    diff driver.
 *  - **No path traversal, no absolute-path injection.** The path is rejected
 *    unless `isSafeRelativeLocatorPath` accepts it (no `..`, no leading `/`,
 *    no drive letter, no backslash, no control chars) and Git runs with
 *    `GIT_LITERAL_PATHSPECS=1` so `:(magic)` pathspecs are inert.
 *  - **No option injection.** Every dynamic argument is a 40-hex commit or an
 *    already-validated path, passed after `--` / `--end-of-options`; a
 *    revision that starts with `-` or carries a revision-expression character
 *    is refused before Git sees it.
 *  - **No config / secret leakage.** System and global Git config are
 *    disabled; the child sees only an allowlisted environment (no
 *    `GIT_ASKPASS`, no `*_TOKEN`, no `SSH_*`).
 *
 * Deterministic and side-effect free: it reads Git objects and returns a
 * verdict. It never writes to the repo, checks anything out, or fetches.
 */

import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { join as joinPath, resolve as resolvePath } from "node:path";
import type { CommitSha, SourceRef } from "../types/common.js";
import { isSafeRelativeLocatorPath } from "../validation/cross-ref.js";
import type {
  EvidenceChecked,
  EvidenceReasonCode,
  EvidenceRef,
  EvidenceVerification,
  GitEvidenceQuery,
} from "./types.js";

const GIT_TIMEOUT_MS = 7_000;
const GIT_MAX_BUFFER = 24 * 1024 * 1024;

/** Environment variables the `git` child is allowed to inherit. */
const ENV_ALLOWLIST = [
  "PATH",
  "PATHEXT",
  "SystemRoot",
  "WINDIR",
  "HOMEDRIVE",
  "HOMEPATH",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
] as const;

const FULL_SHA_RE = /^[0-9a-f]{40}$/;
const ABBREV_OR_FULL_SHA_RE = /^[0-9a-fA-F]{7,64}$/;
const REVISION_EXPR_CHARS_RE = /[~^:?*[\]\\@{} ]/;
const REF_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,200}$/;

/** True if `value` contains any C0 control character or DEL. */
function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * A restricted revision: a 7–64 hex SHA, `HEAD`, or a plain branch/tag/ref
 * name. Never a revision *expression* — anything with `~ ^ : @{ .. ? * [ \`,
 * whitespace, a control char, or a leading `-` (option injection) is refused.
 */
export function isSafeRevision(revision: string): boolean {
  if (typeof revision !== "string" || revision.length === 0) return false;
  if (revision.trim() !== revision) return false;
  if (hasControlChar(revision)) return false;
  if (revision.startsWith("-")) return false;
  if (ABBREV_OR_FULL_SHA_RE.test(revision)) return true;
  if (revision === "HEAD") return true;
  if (revision.includes("..")) return false;
  if (REVISION_EXPR_CHARS_RE.test(revision)) return false;
  if (revision.endsWith(".lock") || revision.endsWith("/") || revision.endsWith(".")) return false;
  return REF_NAME_RE.test(revision);
}

type GitRun =
  | { kind: "ok"; status: number; stdout: Buffer; stderr: string }
  | { kind: "failed"; reason: "git-unavailable" | "git-timeout" | "git-error"; detail: string };

function runGit(repoRoot: string, args: readonly string[]): GitRun {
  // Paths that are guaranteed not to exist: Git reads a missing global/system
  // config as empty and finds no hooks in a missing hooks dir. Unlike the OS
  // null device (`\\.\nul` on Windows), a plain missing path never errors.
  const noConfig = joinPath(repoRoot, "arclume-evidence.nonexistent-gitconfig");
  const noHooks = joinPath(repoRoot, "arclume-evidence.nonexistent-hooks");

  const env: NodeJS.ProcessEnv = {};
  for (const key of ENV_ALLOWLIST) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  env["GIT_TERMINAL_PROMPT"] = "0";
  env["GIT_CONFIG_NOSYSTEM"] = "1";
  env["GIT_CONFIG_GLOBAL"] = noConfig;
  env["GIT_CONFIG_SYSTEM"] = noConfig;
  env["GIT_ALLOW_PROTOCOL"] = "";
  env["GIT_PROTOCOL_FROM_USER"] = "0";
  env["GIT_OPTIONAL_LOCKS"] = "0";
  env["GIT_LITERAL_PATHSPECS"] = "1";
  env["GIT_PAGER"] = "cat";
  env["GIT_ASKPASS"] = "";
  env["GIT_SSH_COMMAND"] = "false";

  const hardened = [
    "-c",
    `core.hooksPath=${noHooks}`,
    "-c",
    "core.fsmonitor=false",
    "-c",
    `safe.directory=${repoRoot}`,
    ...args,
  ];

  const result = spawnSync("git", hardened, {
    cwd: repoRoot,
    env,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER,
    windowsHide: true,
  });

  if (result.error) {
    const code = (result.error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return {
        kind: "failed",
        reason: "git-unavailable",
        detail: "`git` executable not found on PATH",
      };
    }
    if (code === "ETIMEDOUT" || result.signal === "SIGTERM") {
      return {
        kind: "failed",
        reason: "git-timeout",
        detail: `git timed out after ${GIT_TIMEOUT_MS}ms`,
      };
    }
    return { kind: "failed", reason: "git-error", detail: result.error.message };
  }
  if (result.signal === "SIGTERM" || result.signal === "SIGKILL") {
    return { kind: "failed", reason: "git-timeout", detail: `git killed (${result.signal})` };
  }
  return {
    kind: "ok",
    status: typeof result.status === "number" ? result.status : 1,
    stdout: result.stdout ?? Buffer.alloc(0),
    stderr: (result.stderr ?? Buffer.alloc(0)).toString("utf8").trim(),
  };
}

/** 1-based line count of a blob; a trailing newline does NOT add a line. */
export function countBlobLines(buffer: Buffer): number {
  if (buffer.length === 0) return 0;
  let count = 1;
  for (let i = 0; i < buffer.length; i += 1) {
    if (buffer[i] === 0x0a) count += 1;
  }
  if (buffer[buffer.length - 1] === 0x0a) count -= 1;
  return count;
}

function make(
  verdict: EvidenceVerification["verdict"],
  reasonCode: EvidenceReasonCode,
  detail: string,
  checked: EvidenceChecked,
): EvidenceVerification {
  return { verdict, reasonCode, detail, checked };
}

/**
 * Verify a Git source reference locally. Pure w.r.t. the repo (read-only).
 * Returns `VERIFIED` only when the repo, revision, file and line range all
 * check out; `UNVERIFIED` when the reference is well-formed but wrong;
 * `UNAVAILABLE` when the check could not run.
 */
export function verifyGitEvidence(query: GitEvidenceQuery): EvidenceVerification {
  const repoRoot = resolvePath(query.repoRoot);
  const checked: EvidenceChecked = { repoRoot };

  if (!existsSync(repoRoot)) {
    return make("UNAVAILABLE", "repo-missing", `no such path: ${repoRoot}`, checked);
  }
  try {
    if (!statSync(repoRoot).isDirectory()) {
      return make("UNAVAILABLE", "repo-missing", `not a directory: ${repoRoot}`, checked);
    }
  } catch (err) {
    return make("UNAVAILABLE", "repo-missing", `cannot stat ${repoRoot}: ${String(err)}`, checked);
  }

  const toplevel = runGit(repoRoot, ["rev-parse", "--show-toplevel"]);
  if (toplevel.kind === "failed") {
    return make("UNAVAILABLE", toplevel.reason, toplevel.detail, checked);
  }
  if (toplevel.status !== 0) {
    return make("UNAVAILABLE", "repo-not-git", `not a git repository: ${repoRoot}`, checked);
  }

  checked.revision = query.revision;
  if (!isSafeRevision(query.revision)) {
    return make(
      "UNVERIFIED",
      "revision-unsafe",
      `revision is not a plain SHA or ref name: ${JSON.stringify(query.revision)}`,
      checked,
    );
  }

  const revParse = runGit(repoRoot, [
    "rev-parse",
    "--verify",
    "--quiet",
    "--end-of-options",
    `${query.revision}^{commit}`,
  ]);
  if (revParse.kind === "failed") {
    return make("UNAVAILABLE", revParse.reason, revParse.detail, checked);
  }
  const commit = revParse.stdout.toString("utf8").trim() as CommitSha;
  if (revParse.status !== 0 || !FULL_SHA_RE.test(commit)) {
    return make(
      "UNVERIFIED",
      "revision-missing",
      `revision not found in repo: ${query.revision}`,
      checked,
    );
  }
  checked.commit = commit;

  checked.path = query.path;
  if (!isSafeRelativeLocatorPath(query.path)) {
    return make(
      "UNVERIFIED",
      "path-unsafe",
      `not a safe source-root-relative POSIX path: ${JSON.stringify(query.path)}`,
      checked,
    );
  }

  const lsTree = runGit(repoRoot, ["ls-tree", "--end-of-options", commit, "--", query.path]);
  if (lsTree.kind === "failed") {
    return make("UNAVAILABLE", lsTree.reason, lsTree.detail, checked);
  }
  if (lsTree.status !== 0) {
    return make("UNAVAILABLE", "git-error", lsTree.stderr || "git ls-tree failed", checked);
  }
  const lsLine = lsTree.stdout.toString("utf8").split("\n")[0]?.trim() ?? "";
  if (lsLine === "") {
    return make(
      "UNVERIFIED",
      "path-missing",
      `no such file at ${query.revision}: ${query.path}`,
      checked,
    );
  }
  const objectType = lsLine.split(/\s+/)[1] ?? "";
  if (objectType !== "blob") {
    return make(
      "UNVERIFIED",
      "path-not-blob",
      `path at ${query.revision} is a ${objectType || "non-blob"}, not a file: ${query.path}`,
      checked,
    );
  }

  const hasStart = query.lineStart !== undefined;
  const hasEnd = query.lineEnd !== undefined;
  if (!hasStart && !hasEnd) {
    return make("VERIFIED", "verified", `file present at ${commit.slice(0, 12)}`, checked);
  }
  if (hasStart !== hasEnd) {
    return make(
      "UNVERIFIED",
      "line-range-invalid",
      "a line range needs both lineStart and lineEnd",
      checked,
    );
  }
  const lineStart = query.lineStart as number;
  const lineEnd = query.lineEnd as number;
  checked.lineStart = lineStart;
  checked.lineEnd = lineEnd;
  if (
    !Number.isInteger(lineStart) ||
    !Number.isInteger(lineEnd) ||
    lineStart < 1 ||
    lineEnd < lineStart
  ) {
    return make(
      "UNVERIFIED",
      "line-range-invalid",
      `invalid line range ${lineStart}..${lineEnd}`,
      checked,
    );
  }

  const blob = runGit(repoRoot, [
    "cat-file",
    "blob",
    "--end-of-options",
    `${commit}:${query.path}`,
  ]);
  if (blob.kind === "failed") {
    return make("UNAVAILABLE", blob.reason, blob.detail, checked);
  }
  if (blob.status !== 0) {
    return make("UNAVAILABLE", "git-error", blob.stderr || "git cat-file failed", checked);
  }
  const lineCount = countBlobLines(blob.stdout);
  checked.lineCount = lineCount;
  if (lineEnd > lineCount) {
    return make(
      "UNVERIFIED",
      "line-range-out-of-bounds",
      `line range ${lineStart}..${lineEnd} exceeds file length ${lineCount}`,
      checked,
    );
  }

  return make(
    "VERIFIED",
    "verified",
    `lines ${lineStart}-${lineEnd} of ${query.path} present at ${commit.slice(0, 12)}`,
    checked,
  );
}

export interface SourceRefEvidenceOptions {
  /** Absolute path to the repository working tree (trusted, caller-supplied). */
  repoRoot: string;
  /** Revision to pin against when the locator itself carries no `commit`. */
  fallbackRevision?: string;
}

/**
 * Verify a `SourceRef` against a Git repo by reading its `FileLocator`
 * (`path`, `lineStart`/`lineEnd`, `commit`). A non-file locator, a missing
 * locator, or a locator with no commit and no `fallbackRevision` is
 * `UNVERIFIED` — never guessed.
 */
export function verifySourceRefEvidence(
  ref: SourceRef,
  options: SourceRefEvidenceOptions,
): EvidenceVerification {
  const repoRoot = resolvePath(options.repoRoot);
  const loc = ref.locator;
  if (!loc) {
    return make("UNVERIFIED", "locator-missing", "sourceRef has no locator to verify", {
      repoRoot,
    });
  }
  if (loc.kind !== "file") {
    return make(
      "UNVERIFIED",
      "locator-not-file",
      `locator kind "${loc.kind}" is not a file reference`,
      { repoRoot },
    );
  }
  const revision = loc.commit ?? options.fallbackRevision;
  if (revision === undefined) {
    return make(
      "UNVERIFIED",
      "revision-missing",
      "no commit on the locator and no fallback revision supplied",
      { repoRoot, path: loc.path },
    );
  }
  const query: GitEvidenceQuery = { repoRoot: options.repoRoot, path: loc.path, revision };
  if (typeof loc.lineStart === "number") {
    query.lineStart = loc.lineStart;
    query.lineEnd = typeof loc.lineEnd === "number" ? loc.lineEnd : loc.lineStart;
  } else if (typeof loc.lineEnd === "number") {
    query.lineStart = loc.lineEnd;
    query.lineEnd = loc.lineEnd;
  }
  return verifyGitEvidence(query);
}

/** `{ ref, verification }` envelope — the provenance unit a diagram node/edge carries. */
export function attachEvidence(ref: SourceRef, options: SourceRefEvidenceOptions): EvidenceRef {
  return { ref, verification: verifySourceRefEvidence(ref, options) };
}
