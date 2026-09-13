/**
 * Arclume's own security denylist, independent of any `.gitignore`.
 *
 * Directory names here are pruned during the walk (their contents are never
 * read). File-name patterns here classify a file as `sensitive` — and a
 * sensitive file's contents are NEVER read, not even to confirm it is a secret.
 */

/** Directory basenames pruned wholesale. */
export const DENYLIST_DIRS: ReadonlySet<string> = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  "bower_components",
  "dist",
  "build",
  "out",
  "coverage",
  ".cache",
  ".next",
  ".nuxt",
  ".turbo",
  ".parcel-cache",
  "tmp",
  "temp",
  "vendor",
  ".venv",
  "venv",
  "__pycache__",
]);

/**
 * Exact sensitive file basenames.
 */
const SENSITIVE_NAMES: ReadonlySet<string> = new Set([
  ".env",
  ".envrc",
  "credentials.json",
  "credentials.yaml",
  "credentials.yml",
  "secrets.json",
  "secrets.yaml",
  "secrets.yml",
  "id_rsa",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
  ".netrc",
  ".pgpass",
  ".htpasswd",
]);

/**
 * Sensitive file-name patterns (tested against the basename, case-insensitive).
 */
const SENSITIVE_PATTERNS: readonly RegExp[] = [
  /^\.env(\..+)?$/i, // .env, .env.local, .env.production
  /\.pem$/i,
  /\.key$/i,
  /\.pfx$/i,
  /\.p12$/i,
  /\.keystore$/i,
  /\.jks$/i,
  /\.ppk$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)(\..+)?$/i,
  /(^|[._-])secret(s)?([._-]|$)/i,
  /(^|[._-])credential(s)?([._-]|$)/i,
  /(^|[._-])password(s)?([._-]|$)/i,
  /\.(secret|private)\.(json|ya?ml|txt)$/i,
];

/** True if a file basename should be treated as sensitive (never read). */
export function isSensitiveFileName(basename: string): boolean {
  if (SENSITIVE_NAMES.has(basename)) return true;
  return SENSITIVE_PATTERNS.some((re) => re.test(basename));
}

/** True if a directory basename is on the security denylist. */
export function isDenylistedDir(basename: string): boolean {
  return DENYLIST_DIRS.has(basename);
}

import type { SourceDocumentKind } from "./types.js";

const SUPPORTED_EXTENSIONS: ReadonlyMap<string, SourceDocumentKind> = new Map([
  [".md", "markdown"],
  [".markdown", "markdown"],
  [".mdx", "markdown"],
  [".txt", "text"],
  [".text", "text"],
  [".json", "json"],
  [".yaml", "yaml"],
  [".yml", "yaml"],
  [".pdf", "pdf"],
  [".docx", "docx"],
]);

/** Map a lower-cased extension (with dot) to a supported kind, or undefined. */
export function supportedKindForExtension(ext: string): SourceDocumentKind | undefined {
  return SUPPORTED_EXTENSIONS.get(ext.toLowerCase());
}
