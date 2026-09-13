# Ingestion (Phase 2)

Status legend: **IMPLEMENTED** now · **PLANNED** later.

`DISCOVER → INGEST → SourceDocument[]`. Pure reads; no execution, no network.

---

## Supported inputs (MVP)

**IMPLEMENTED:** a directory, a local git repository (a `.git/` directory makes
the produced `Source.kind` `"repo"` instead of `"directory"`), and single files
of a supported kind. Supported file kinds by extension:

| Kind | Extensions |
| --- | --- |
| `markdown` | `.md` `.markdown` `.mdx` |
| `text` | `.txt` `.text` |
| `json` | `.json` |
| `yaml` | `.yaml` `.yml` |

**PLANNED (Phase 8):** PDF, DOCX, remote URLs.

Any other file is recorded in the discovery inventory with `kind: "unsupported"`
and `included: false`, and appears in `skipped` with reason `unsupported`. Its
path is still available for structural reasoning (e.g. inferring components from
`src/<name>/`).

---

## Discovery — `discover(inputPath, options?)`

Returns `DiscoveryResult`: `{ source, rootAbsPath, files, skipped }`.

Guarantees (**IMPLEMENTED**):

- **Deterministic order** — directory entries are name-sorted before traversal,
  so the result never depends on the filesystem's own ordering. `files` and
  `skipped` are also sorted in the output.
- **POSIX paths** — every `path` is source-root-relative with `/` separators,
  on every OS.
- **No symlink following** — a symbolic link (file or directory) is recorded in
  `skipped` with reason `symlink` and never traversed or read.
- **Security denylist** — directories such as `.git`, `node_modules`, `dist`,
  `build`, `out`, `coverage`, `.cache`, `tmp`, `temp`, `vendor`,
  `__pycache__`, … are pruned wholesale (`skipped` reason `denylisted`). See
  `DENYLIST_DIRS`.
- **Sensitive files are never read** — a basename matching the secret patterns
  (`.env*`, `*.pem`, `*.key`, `id_rsa`/`id_ed25519`/…, `credentials.json`,
  `secrets.json`, `*secret*`, `*credential*`, `*password*`, …) is skipped with
  reason `sensitive` **before any read**, even though `.json`/`.yaml` are
  otherwise supported.
- **`.gitignore`** — the root `.gitignore` is honoured when present (matched via
  the `ignore` package). Opt out with `{ respectGitignore: false }`. Nested
  `.gitignore` files are **PLANNED**.
- **Size checked before read** — a file's size is `stat`ed and compared to the
  limits before its bytes are ever loaded.
- **Binary detection** — a candidate text file whose first 8 KiB contain a NUL
  byte or a high ratio of control bytes is skipped with reason `binary`.
- **Containment** — anything that resolves outside the root is skipped
  `outside-root`.

### Safety limits — `options.limits`

| Field | Default | Skip reason on breach |
| --- | --- | --- |
| `maxFiles` | 4000 | `too-many` |
| `maxFileBytes` | 2 MiB | `too-large` |
| `maxTotalBytes` | 64 MiB | `total-budget` |
| `maxDepth` | 24 | `too-deep` |

### Skip reasons

`ignored` · `denylisted` · `sensitive` · `binary` · `too-large` ·
`total-budget` · `too-deep` · `too-many` · `unsupported` · `outside-root` ·
`symlink` · `parse-error` · `unreadable`. Nothing is skipped silently — every
non-included file is in `skipped` with its reason (and often a `detail`).

---

## Ingestion — `ingest(inputs, options?)`

Returns `IngestionResult`: `{ sources, documents, discovery, skipped }`.

For each included file: raw bytes → `normalizeText` (strip UTF-8 BOM, CRLF/CR →
LF) → `parseDocument(kind, content, path)` → `SourceDocument`.

**Fail-soft:** a file that cannot be parsed as its kind (bad JSON/YAML) is added
to `skipped` with reason `parse-error` and a `detail`; the run continues. Only a
fatal discovery problem (missing root) throws (`DiscoveryError`, severity
`fatal`).

### `SourceDocument`

```ts
interface SourceDocument {
  id: string;            // deterministic: deriveId("doc", sourceId, path)
  sourceId: string;      // the Source.id this document belongs to
  kind: "markdown" | "text" | "json" | "yaml";
  path: string;          // POSIX, source-root-relative
  mediaType: string;     // text/markdown | text/plain | application/json | application/yaml
  content: string;       // normalized UTF-8 text
  metadata: { title?; language?; headings?; byteLength; lineCount };
  provenance: {
    sourceHash: string;  // sha256: of the raw bytes as read
    contentHash: string; // sha256: of the normalized content
  };
  outline: MarkdownOutline | StructuredOutline | TextOutline;
}
```

- **Serializable & deterministic** — no timestamps, no absolute paths.
- **Traceable** — `sourceId` + `path` + per-outline 1-based line numbers let a
  later claim cite e.g. `{ kind: "file", path: "src/auth/login.ts",
  lineStart: 20, lineEnd: 35 }`.
- **Cache-friendly** — `provenance.contentHash` is the unit of change detection.

### Outlines

- **Markdown** (hand-rolled, no dependency): `title`, `sections`
  (`{ heading, depth, line, endLine }`, ATX + setext), fenced `codeBlocks`
  (`{ lang?, line, endLine }`), inline `links` (`{ text, url, line }`). Headings
  inside fenced blocks are ignored; YAML front matter is skipped for heading
  detection.
- **JSON** — parsed with `JSON.parse` (values are never executed); outline has
  `keyPaths` (bounded, dotted; arrays collapse to `key[]`) and `rootIsObject`.
- **YAML** — parsed with the `yaml` package pinned to `schema: "core"`,
  `merge: false`, `uniqueKeys: true`: no custom tags, no merge keys, no
  executable constructs, `yes`/`no` stay strings. Same `keyPaths` / `rootIsObject`
  outline as JSON.
- **Text** — `{ kind: "text", lineCount }`.

---

## Digests

- `sourceDigest(documents)` — `sha256:` over each document's
  `{ sourceId, path, kind, contentHash }`, **sorted** before hashing. Order in
  which discovery found the files does not matter; changing any file's content,
  or adding/removing a file, changes the digest.
- `analysisDigest({ sourceDigest, reasoner, config? })` — the reuse key for an
  analysis: folds in the reasoner `id` + `version` and any analysis-affecting
  config. `runAnalyze` passes `canonicalAnalysisConfig(hints)` here, so the
  advisory `audience` / `focus` hints are part of the key (`focus` canonicalized
  as an unordered, de-duplicated set). Schema-versioned independently of
  `sourceDigest` (`v: 2`).

---

## `Source` mapping

A directory/repo produces one `Source` (`kind` `"repo"` or `"directory"`,
`id = deriveId(kind, basename(root))`, portable — pass `options.sourceId` to set
it explicitly). Every `SourceDocument` from that walk carries that `sourceId`;
its evidence locators are `file` locators with the document's root-relative
`path`.

When two inputs of a multi-input run share a basename, their `Source.id`s
collide. The collision is resolved **deterministically and independent of input
order**: within a colliding group the members are ordered by an intrinsic key
(the source's own content digest, which is portable across OSes and embeds no
absolute path), the first keeps the base id, the rest get a
`deriveId(kind, title, contentDigest, n)` suffix. `[A, B]` and `[B, A]` with the
same contents therefore produce the same `sourceDigest`.
