/**
 * Safe, deterministic filesystem discovery.
 *
 * Guarantees:
 *  - never executes anything; only stats and reads file bytes
 *  - never follows a symbolic link (links are recorded and skipped)
 *  - never reads a file classified as sensitive (not even to confirm it)
 *  - never reads a file before checking its size against the limits
 *  - prunes the built-in denylist directories wholesale
 *  - honours the root `.gitignore` when present (opt-out)
 *  - visits entries in a fixed (name-sorted) order, so the result does not
 *    depend on the filesystem's own ordering
 *  - bounds depth, file count, per-file size and total bytes
 */

import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import { DiscoveryError } from "../errors.js";
import { deriveId } from "../knowledge/ids.js";
import type { Source } from "../types/common.js";
import { isProbablyBinary } from "./binary.js";
import { isDenylistedDir, isSensitiveFileName, supportedKindForExtension } from "./ignore-rules.js";
import {
  DEFAULT_SAFETY_LIMITS,
  type DiscoveredFile,
  type DiscoveryResult,
  type IngestionOptions,
  type SafetyLimits,
  type SkipReason,
  type SkippedInput,
  type SourceDocumentKind,
  maxFileBytesForKind,
} from "./types.js";

interface IgnoreMatcher {
  ignores(path: string): boolean;
}
type IgnoreFactory = () => {
  add(patterns: string): unknown;
  ignores(p: string): boolean;
};

// `ignore` is CJS; load it through require so interop stays unambiguous.
const require = createRequire(import.meta.url);
const createIgnore = require("ignore") as IgnoreFactory;

export interface WalkedFile extends DiscoveredFile {
  /** Absolute filesystem path. Never serialized. */
  absPath: string;
  /** Present only for included text files. Never serialized. */
  bytes?: Buffer;
}

export interface WalkResult {
  source: Source;
  rootAbsPath: string;
  /** True when the input was a single file (the Source IS the document). */
  singleFile: boolean;
  files: WalkedFile[];
  skipped: SkippedInput[];
}

function toPosix(p: string): string {
  return sep === "/" ? p : p.split(sep).join("/");
}

function resolveLimits(partial: Partial<SafetyLimits> | undefined): SafetyLimits {
  const merged = { ...DEFAULT_SAFETY_LIMITS, ...(partial ?? {}) };
  if (partial?.maxFileBytes !== undefined && partial.maxTextFileBytes === undefined) {
    merged.maxTextFileBytes = partial.maxFileBytes;
  }
  return merged;
}

function buildIgnore(rootAbsPath: string, options: IngestionOptions): IgnoreMatcher | undefined {
  const parts: string[] = [];
  if (options.respectGitignore !== false) {
    const gitignorePath = join(rootAbsPath, ".gitignore");
    if (existsSync(gitignorePath)) {
      try {
        parts.push(readFileSync(gitignorePath, "utf8"));
      } catch {
        // a .gitignore we cannot read is simply not applied
      }
    }
  }
  if (options.extraIgnore && options.extraIgnore.length > 0) {
    parts.push(options.extraIgnore.join("\n"));
  }
  if (parts.length === 0) return undefined;
  const ig = createIgnore();
  ig.add(parts.join("\n"));
  return ig;
}

function isIgnored(ig: IgnoreMatcher | undefined, relPosix: string, isDir: boolean): boolean {
  if (!ig || relPosix === "") return false;
  if (ig.ignores(relPosix)) return true;
  return isDir && ig.ignores(`${relPosix}/`);
}

function classifyExtension(name: string): SourceDocumentKind | "unsupported" {
  return supportedKindForExtension(extname(name)) ?? "unsupported";
}

interface WalkState {
  limits: SafetyLimits;
  ig: IgnoreMatcher | undefined;
  rootAbsPath: string;
  files: WalkedFile[];
  skipped: SkippedInput[];
  totalBytes: number;
  includedCount: number;
}

function skip(state: WalkState, path: string, reason: SkipReason, detail?: string): void {
  const entry: SkippedInput = { path, reason };
  if (detail !== undefined) entry.detail = detail;
  state.skipped.push(entry);
}

function sortedEntries(dirAbs: string): { name: string; isDir: boolean; isSymlink: boolean }[] {
  return readdirSync(dirAbs, { withFileTypes: true })
    .map((d) => ({ name: d.name, isDir: d.isDirectory(), isSymlink: d.isSymbolicLink() }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

function walkDir(state: WalkState, dirAbs: string, depth: number): void {
  let entries: ReturnType<typeof sortedEntries>;
  try {
    entries = sortedEntries(dirAbs);
  } catch {
    skip(
      state,
      toPosix(relative(state.rootAbsPath, dirAbs)) || ".",
      "unreadable",
      "readdir failed",
    );
    return;
  }

  for (const entry of entries) {
    const absPath = join(dirAbs, entry.name);
    const relPosix = toPosix(relative(state.rootAbsPath, absPath));

    // structural containment: nothing should ever resolve above the root
    if (relPosix === "" || relPosix.startsWith("../") || relPosix === "..") {
      skip(state, relPosix || entry.name, "outside-root");
      continue;
    }

    if (entry.isSymlink) {
      skip(state, relPosix, "symlink");
      continue;
    }

    if (entry.isDir) {
      if (isDenylistedDir(entry.name)) {
        skip(state, relPosix, "denylisted");
        continue;
      }
      if (depth + 1 > state.limits.maxDepth) {
        skip(state, relPosix, "too-deep");
        continue;
      }
      if (isIgnored(state.ig, relPosix, true)) {
        skip(state, relPosix, "ignored");
        continue;
      }
      walkDir(state, absPath, depth + 1);
      continue;
    }

    handleFile(state, absPath, relPosix, entry.name);
  }
}

function handleFile(state: WalkState, absPath: string, relPosix: string, name: string): void {
  if (isSensitiveFileName(name)) {
    skip(state, relPosix, "sensitive");
    return;
  }
  if (isIgnored(state.ig, relPosix, false)) {
    skip(state, relPosix, "ignored");
    return;
  }
  if (state.includedCount >= state.limits.maxFiles) {
    skip(state, relPosix, "too-many");
    return;
  }

  let size: number;
  try {
    size = statSync(absPath).size;
  } catch {
    skip(state, relPosix, "unreadable", "stat failed");
    return;
  }

  const kind = classifyExtension(name);
  if (kind === "unsupported") {
    state.files.push({
      path: relPosix,
      absPath,
      kind: "unsupported",
      byteLength: size,
      included: false,
    });
    skip(state, relPosix, "unsupported", extname(name) || "(no extension)");
    return;
  }

  // Per-format size gate BEFORE reading (a 32 MiB PDF must never be read just
  // to discover it is too large).
  const maxFileBytes = maxFileBytesForKind(state.limits, kind);
  if (size > maxFileBytes) {
    state.files.push({
      path: relPosix,
      absPath,
      kind: "unsupported",
      byteLength: size,
      included: false,
    });
    skip(state, relPosix, "too-large", `${size} bytes`);
    return;
  }
  if (state.totalBytes + size > state.limits.maxTotalBytes) {
    state.files.push({
      path: relPosix,
      absPath,
      kind: "unsupported",
      byteLength: size,
      included: false,
    });
    skip(state, relPosix, "total-budget", `${size} bytes`);
    return;
  }

  let bytes: Buffer;
  try {
    bytes = readFileSync(absPath);
  } catch {
    skip(state, relPosix, "unreadable", "read failed");
    return;
  }
  // Text sniffing applies only to text-native kinds; PDF/DOCX are binary-safe by spec.
  if (kind !== "pdf" && kind !== "docx" && isProbablyBinary(bytes)) {
    state.files.push({
      path: relPosix,
      absPath,
      kind: "binary",
      byteLength: size,
      included: false,
    });
    skip(state, relPosix, "binary");
    return;
  }

  state.totalBytes += size;
  state.includedCount += 1;
  state.files.push({ path: relPosix, absPath, kind, byteLength: size, included: true, bytes });
}

/** Walk `inputPath` and return every file plus every skip decision. */
export function walkRoot(inputPath: string, options: IngestionOptions = {}): WalkResult {
  const resolved = resolve(inputPath);
  if (!existsSync(resolved)) {
    throw new DiscoveryError(`input root does not exist: ${inputPath}`, {
      code: "discovery/root-not-found",
      path: inputPath,
      severity: "fatal",
      hint: "pass a path to an existing directory or a supported file",
    });
  }

  let rootAbsPath: string;
  let rootStat: ReturnType<typeof statSync>;
  try {
    rootAbsPath = realpathSync(resolved);
    rootStat = statSync(rootAbsPath);
  } catch (cause) {
    throw new DiscoveryError(`cannot access input root: ${inputPath}`, {
      code: "discovery/root-unreadable",
      path: inputPath,
      severity: "fatal",
      cause,
    });
  }

  const limits = resolveLimits(options.limits);

  if (rootStat.isFile()) return walkSingleFile(rootAbsPath, inputPath, options, limits);
  if (!rootStat.isDirectory()) {
    throw new DiscoveryError(`input root is neither a file nor a directory: ${inputPath}`, {
      code: "discovery/root-unsupported",
      path: inputPath,
      severity: "fatal",
    });
  }

  const isRepo = existsSync(join(rootAbsPath, ".git"));
  const sourceKind = isRepo ? "repo" : "directory";
  const sourceId =
    options.sourceId && options.sourceId.length > 0
      ? options.sourceId
      : deriveId(sourceKind, basename(rootAbsPath));

  const source: Source = {
    id: sourceId,
    kind: sourceKind,
    title: basename(rootAbsPath),
    uri: inputPath,
  };

  const state: WalkState = {
    limits,
    ig: buildIgnore(rootAbsPath, options),
    rootAbsPath,
    files: [],
    skipped: [],
    totalBytes: 0,
    includedCount: 0,
  };
  walkDir(state, rootAbsPath, 0);

  state.files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  state.skipped.sort((a, b) =>
    a.path === b.path ? (a.reason < b.reason ? -1 : 1) : a.path < b.path ? -1 : 1,
  );

  return { source, rootAbsPath, singleFile: false, files: state.files, skipped: state.skipped };
}

function walkSingleFile(
  fileAbs: string,
  inputPath: string,
  options: IngestionOptions,
  limits: SafetyLimits,
): WalkResult {
  const name = basename(fileAbs);
  const kind = classifyExtension(name);
  const sourceId =
    options.sourceId && options.sourceId.length > 0
      ? options.sourceId
      : deriveId(kind === "unsupported" ? "file" : kind, name);
  const source: Source = {
    id: sourceId,
    kind: kind === "unsupported" ? "other" : kind,
    title: name,
    uri: inputPath,
  };
  const skipped: SkippedInput[] = [];
  const files: WalkedFile[] = [];

  if (isSensitiveFileName(name)) {
    skipped.push({ path: name, reason: "sensitive" });
    return { source, rootAbsPath: fileAbs, singleFile: true, files, skipped };
  }
  const size = statSync(fileAbs).size;
  if (size > maxFileBytesForKind(limits, kind === "unsupported" ? "text" : kind)) {
    files.push({
      path: name,
      absPath: fileAbs,
      kind: "unsupported",
      byteLength: size,
      included: false,
    });
    skipped.push({ path: name, reason: "too-large", detail: `${size} bytes` });
    return { source, rootAbsPath: fileAbs, singleFile: true, files, skipped };
  }
  if (kind === "unsupported") {
    files.push({
      path: name,
      absPath: fileAbs,
      kind: "unsupported",
      byteLength: size,
      included: false,
    });
    skipped.push({ path: name, reason: "unsupported", detail: extname(name) || "(no extension)" });
    return { source, rootAbsPath: fileAbs, singleFile: true, files, skipped };
  }
  const bytes = readFileSync(fileAbs);
  if (kind !== "pdf" && kind !== "docx" && isProbablyBinary(bytes)) {
    files.push({ path: name, absPath: fileAbs, kind: "binary", byteLength: size, included: false });
    skipped.push({ path: name, reason: "binary" });
    return { source, rootAbsPath: fileAbs, singleFile: true, files, skipped };
  }
  files.push({ path: name, absPath: fileAbs, kind, byteLength: size, included: true, bytes });
  return { source, rootAbsPath: fileAbs, singleFile: true, files, skipped };
}

/** Public discovery: the walk result with no file contents or absolute paths. */
export function discover(inputPath: string, options: IngestionOptions = {}): DiscoveryResult {
  const walk = walkRoot(inputPath, options);
  const files: DiscoveredFile[] = walk.files.map((f) => ({
    path: f.path,
    kind: f.kind,
    byteLength: f.byteLength,
    included: f.included,
  }));
  return { source: walk.source, rootAbsPath: walk.rootAbsPath, files, skipped: walk.skipped };
}
