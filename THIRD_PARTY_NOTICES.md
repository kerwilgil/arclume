# Third-Party Notices

Arclume bundles or depends on the following third-party software. Licenses are
reproduced or referenced as required.

## Archify (vendored)

- **Source**: https://github.com/tt-a1i/archify
- **Tag / version**: `v2.16.0`
- **Commit**: `c826e6c3a7abad19c0f3cd1ca57207d54b1ad8de`
- **License**: MIT (Copyright (c) 2026 tt-a1i (Archify); Copyright (c) 2025
  Cocoon AI (original "architecture-diagram-generator"))
- **Location**: `vendor/archify/` (full license text: `vendor/archify/LICENSE`)
- **Usage**: downstream SVG render engine for `architecture` and `workflow`
  diagrams. Vendored as a fixed file copy — not installed from npm.
  Archify's own dependencies are devDependencies only (used by its upstream
  test tooling); the vendored runtime entry point requires zero npm packages.

## Phase 8: advanced ingestion & export

### pdfjs-dist (runtime dependency)

- **Source**: https://github.com/mozilla/pdfjs-dist
- **Version**: `5.4.296` (exact, pinned)
- **License**: Apache-2.0
- **Usage**: PDF text-layer parsing (`src/ingestion/pdf.ts`). Never executes
  PDF content (`isEvalSupported: false`), never renders to canvas; the
  optional native canvas surface (`@napi-rs/canvas@0.1.100`, MIT) is present
  under pdfjs's optional dependencies but is never imported by Phase 8 code.

### fflate (runtime dependency)

- **Source**: https://github.com/101arrowz/fflate
- **Version**: `0.8.2` (exact)
- **License**: MIT
- **Usage**: in-memory OPC/zip handling for DOCX input and PPTX output
  validation (`src/ingestion/docx-zip.ts`, `src/export/pptx.ts`).

### parse5 (runtime dependency)

- **Source**: https://github.com/inikulin/parse5
- **Version**: `8.0.1` (exact)
- **License**: MIT
- **Usage**: HTML → walked DOM for URL ingestion (`src/ingestion/url.ts`).
- **Transitive**: `entities@8.0.0` (BSD-2-Clause).

### pptxgenjs (runtime dependency)

- **Source**: https://github.com/gitbrent/PptxGenJS
- **Version**: `4.0.1` (exact)
- **License**: MIT
- **Usage**: PPTX writer (`src/export/pptx.ts`). Only `write({outputType})`;
  never `writeFile`, never hyperlinks/OLE/macros.
- **Transitives (locked)**: `jszip@3.10.1` (MIT OR GPL-3.0-or-later), `lie@3.3.0` (MIT),
  `pako@1.0.11` (MIT AND Zlib), `setimmediate@1.0.5` (MIT), `readable-stream@2.3.8` (MIT)
  → `core-util-is` (MIT), `inherits` (ISC), `isarray` (MIT), `process-nextick-args` (MIT),
  `safe-buffer` (MIT), `string_decoder` (MIT), `util-deprecate` (MIT);
  `image-size@1.2.1` (MIT), `https@1.0.0` (ISC).

## saxes (runtime dependency)

- **Source**: https://github.com/lddubeau/saxes
- **Version**: `6.0.0` (exact; pinned in `package.json` and `package-lock.json`)
- **License**: ISC
- **Usage**: streaming XML parser used by `src/engines/archify/sanitize.ts` to
  parse and rebuild untrusted Archify SVG output.

## xmlchars (transitive dependency of saxes)

- **Source**: https://github.com/lddubeau/xmlchars
- **Version**: `2.2.0` (pinned by `package-lock.json`)
- **License**: MIT
- **Usage**: XML character-class tables used by saxes.

## Windows distribution (portable ZIP and installer)

The packaged Windows distribution redistributes third-party runtimes so the
end user does not have to install anything. These components are **not** part
of the npm package and are only present in the Windows artifacts built by
`scripts/windows/build-distribution.ps1`. Every licence below is shipped
inside the distribution under `licenses/`.

### Node.js (redistributed runtime)

- **Source**: https://nodejs.org/dist/
- **Version**: `24.20.0` (exact, pinned; official `node-v24.20.0-win-x64.zip`,
  SHA256 verified during the build)
- **License**: MIT, plus the third-party licences (V8, libuv, OpenSSL, ICU and
  others) enumerated in Node's own `LICENSE` file
- **Location in the distribution**: `runtime\node.exe`
- **Notice shipped as**: `licenses\NODEJS-LICENSE.txt`
- **Usage**: the only JavaScript runtime the distribution ever executes. The
  launcher never looks for Node.js on the machine.

### Playwright and the bundled Chromium browser

- **Source**: https://github.com/microsoft/playwright
- **Version**: `1.62.1` (exact, pinned in `package.json`)
- **License**: Apache-2.0
- **Browser payload**: the Chromium ("Chrome for Testing") build, the Chromium
  headless shell, the FFmpeg build and `winldd` that Playwright installs for
  that exact version. Chromium is licensed under BSD-3-Clause together with
  the additional third-party licences the browser itself enumerates at
  `chrome://credits`; the FFmpeg build Playwright ships is covered by
  Playwright's own third-party notices.
- **Location in the distribution**: `browsers\` (`PLAYWRIGHT_BROWSERS_PATH`)
- **Notices shipped as**: `licenses\PLAYWRIGHT-LICENSE.txt` and
  `licenses\PLAYWRIGHT-THIRD-PARTY-NOTICES.txt`
- **Usage**: PDF and PPTX export rendering (`src/export/pdf.ts`,
  `src/export/pptx.ts`). Bundling the browser is what makes export work
  offline, with no `playwright install` step for the end user.

### Go standard library (native launcher)

- **Source**: https://go.dev
- **License**: BSD-3-Clause
- **Location in the distribution**: statically linked into `ARCLUME.exe`
- **Notice shipped as**: `licenses\GO-LICENSE.txt`
- **Usage**: `tools/windows-launcher` is a dependency-free Go program (Go
  standard library only) that starts the bundled runtime, verifies readiness
  and owns the child process lifecycle.

### Code signing

The Windows artifacts are **not** code-signed: no Authenticode certificate is
associated with this project. Windows SmartScreen may therefore warn the first
time a user runs `ARCLUME-Setup-<version>.exe` or `ARCLUME.exe`. That warning
reflects the absence of a certificate, not a defect in the files. Verify the
downloads against `SHA256SUMS.txt`.
