# Security model

Arclume analyses material that may be untrusted (a third party's repository, a
document from outside). This file states what the pipeline guarantees.

Status legend: **IMPLEMENTED** now · **PLANNED** later.

---

## Absolute rules

- **No execution.** Arclume never runs an analysed repository or any part of it:
  no `npm install` / `npm run` / `npm test`, no `node`, `python`, `pip`,
  `cargo`, `go`, `make`, no shell / PowerShell, no build step, no lifecycle
  scripts. Ingestion is *reading only*. (**IMPLEMENTED** — Phase 2 has no code
  path that spawns a process.)
- **No network in the Core.** Discovery, parsers, the KnowledgeBuilder and all
  validators perform zero network I/O. Only a future provider `Reasoner` adapter
  may make network calls, and only that adapter. (**IMPLEMENTED**.)
- **No clock, no RNG in `src/`.** Enforced by a test that scans the source tree
  for `Date.now`, `new Date()`, `Math.random`, `crypto.randomUUID`,
  `performance.now`, `process.hrtime`. Timestamps appear in an artifact only when
  a caller injects them. (**IMPLEMENTED**.)

---

## Ingestion guarantees (**IMPLEMENTED**)

| Concern | Guarantee |
| --- | --- |
| **Secrets** | A file whose basename matches the secret patterns (`.env*`, `*.pem`, `*.key`, `id_rsa`/`id_ed25519`/…, `credentials.json`, `secrets.json`, `*secret*`, `*credential*`, `*password*`, `*.private.*`) is skipped with reason `sensitive` **before any read** — never opened, not even to confirm it is a secret. This overrides the fact that `.json`/`.yaml` are otherwise supported. |
| **Denylisted dirs** | `.git`, `node_modules`, `dist`, `build`, `out`, `coverage`, `.cache`, `.next`, `tmp`, `temp`, `vendor`, `__pycache__`, … are pruned wholesale; their contents are never enumerated or read. |
| **Symlinks** | A symbolic link (file or directory) is recorded (`skipped` reason `symlink`) and never followed, read, or descended. This is the primary defence against path-traversal out of the root. |
| **Containment** | Anything that resolves to a path outside the input root is skipped `outside-root`. |
| **Path style** | Every emitted path is POSIX, source-root-relative — no absolute paths, no drive letters, no `\`, no `..` segments — on every OS. |
| **`.gitignore`** | The root `.gitignore` is honoured by default (opt out explicitly). |
| **Size before read** | A file's size is checked against `maxFileBytes` / `maxTotalBytes` *before* its bytes are loaded; oversized files are skipped unread. |
| **Binary** | Non-text content (NUL byte / high control-byte ratio in the first 8 KiB) is skipped `binary`. No parser is run on it. No OCR, ever. |
| **Bounds** | `maxFiles`, `maxFileBytes`, `maxTotalBytes`, `maxDepth` — conservative defaults, all configurable. |
| **Parsers** | JSON via `JSON.parse` (values never executed). YAML via `yaml` pinned to `schema: "core"`, `merge: false`, `uniqueKeys: true` — no custom tags, no merge keys, no executable constructs. |
| **Nothing hidden** | Every non-included file is listed in `skipped` with a reason (and usually a `detail`). |

---

## Fail-soft classification (**IMPLEMENTED**)

Errors carry a `severity`:

| Severity | Meaning | Example |
| --- | --- | --- |
| `fatal` | The run cannot produce a result. | input root missing (`DiscoveryError`); the built `ProjectKnowledge` is invalid (`KnowledgeBuildError`); the reasoner returned a malformed `AnalysisResult` (`ReasonerError`). |
| `recoverable` | This item is dropped; the run continues. | one file fails to parse (`parse-error`); one binary file. |
| `warning` | Noted, no data lost. | a FACT downgraded to INFERENCE; a relation with a dangling endpoint dropped; a near-duplicate entity kept separate. |

A single unsupported or binary file never fails the analysis. A missing input
root, or a final `ProjectKnowledge` that does not validate, does.

---

## Provenance & traceability

`SourceDocument.provenance` records `sourceHash` (raw bytes) and `contentHash`
(normalized content). Every `SourceRef` the builder emits points at a real
ingested `Source` and, through a `file` locator, at an exact path and line
range. `file` locator paths are constrained to safe, source-root-relative POSIX
paths (Phase 1 `isSafeRelativeLocatorPath`).

---

## Not yet addressed (**PLANNED**)

- PDF/DOCX parsing (Phase 8) — will need its own bounds and a "text layer only,
  no scripts" contract.
- Remote URL ingestion (Phase 8) — will need an allowlist, size caps, and a
  clear statement that only that fetch path touches the network.
- Nested `.gitignore` files.
- A provider `Reasoner` adapter — will document credential handling and the fact
  that it is the only networked component.
