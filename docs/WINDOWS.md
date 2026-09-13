# ARCLUME on Windows

ARCLUME has three Windows paths. The first two are the product; the third is
for people working on ARCLUME itself.

| Path | Who it is for | Needs Node.js installed? |
|---|---|---|
| `ARCLUME-Setup-<version>.exe` | everyone | no |
| `ARCLUME-<version>-portable.zip` | portable / no-install users | no |
| source checkout (`install-arclume.cmd` + `ARCLUME.cmd`) | developers | yes |

> **Status:** the Windows distribution tooling is ready for the 1.0 release.
> The installer and portable artifacts are produced by
> `scripts/windows/build-distribution.ps1`. They are not published yet, so
> there is nothing to download from this repository today.

---

## 1. Installer

Run `ARCLUME-Setup-<version>.exe` and follow the wizard.

- Installs **per user** into `%LOCALAPPDATA%\Programs\ARCLUME`
- **No administrator rights** and no UAC prompt
- Creates a Start Menu group with **ARCLUME** and **Uninstall ARCLUME**
- Optionally creates a desktop shortcut (a checkbox, off by default)
- Optionally launches ARCLUME when it finishes

Every shortcut targets `ARCLUME.exe` directly — never `cmd.exe`,
`powershell.exe` or `node.exe` — and carries the official ARCLUME icon.

The installer only lays down an already-built payload. It never runs npm,
never downloads Node.js and never downloads Chromium.

### Uninstalling

Use **Uninstall ARCLUME** in the Start Menu, or Windows Settings → Apps.

The uninstaller removes the application files, the bundled Node runtime, the
bundled browser and the shortcuts. It deliberately leaves
`%LOCALAPPDATA%\ARCLUME` alone: that is where logs and runtime state live, and
removing it is not required to uninstall the program. Your projects and
documents are wherever you saved them and are never touched.

---

## 2. Portable

Extract `ARCLUME-<version>-portable.zip` anywhere — including a path with
spaces or a removable drive — and double-click `ARCLUME.exe`.

Layout:

```text
ARCLUME\
├── ARCLUME.exe      native launcher
├── runtime\         pinned Node.js runtime (node.exe)
├── app\             the ARCLUME application, exactly as published to npm
├── browsers\        Chromium used for PDF export
├── licenses\        ARCLUME and third-party licences and notices
├── arclume.ico
└── README.txt
```

---

## What ARCLUME.exe does

1. Resolves everything relative to **its own location**, never to the current
   working directory — so Explorer, a desktop shortcut and the Start Menu all
   behave identically.
2. Starts the **bundled** `runtime\node.exe`. It never looks for Node.js on
   your machine and never uses one if it is there.
3. Points the application at the bundled Chromium
   (`PLAYWRIGHT_BROWSERS_PATH=browsers\`), so PDF and PPTX export work
   offline with no `playwright install` step.
4. Reads the loopback address the server prints and refuses anything that is
   not exactly `http://127.0.0.1:<port>`.
5. Requires an **HTTP 200** from that address before doing anything else. No
   HTTP 200 means no browser: the launcher logs both captured streams, stops
   the server it started, and exits with a non-zero code.
6. Opens your default browser.
7. Owns the child process for its whole life. The server runs inside a
   kill-on-close Windows job object, so when the launcher exits — cleanly,
   via Ctrl+C, or because you closed its window — the bundled `node.exe` dies
   with it. No orphan, no stuck port. ARCLUME never kills Node processes it
   did not start.

Closing the ARCLUME window stops ARCLUME.

### Command line

```powershell
ARCLUME.exe                # start and open the browser
ARCLUME.exe --no-browser   # start without opening a browser
ARCLUME.exe --smoke-test   # start, require HTTP 200, stop, exit 0
ARCLUME.exe --version
ARCLUME.exe --help
```

`--smoke-test` is what CI and the distribution validation use.
`ARCLUME_SMOKE_TEST=1` and `ARCLUME_NO_BROWSER=1` do the same thing.

### Logs

```text
%LOCALAPPDATA%\ARCLUME\logs\arclume-launcher.log
```

Rewritten on each start. It records the resolved paths, the child PID, the
discovered URL and the readiness result. It never records document content.
Nothing is written inside the installation directory.

### Multiple instances

Starting ARCLUME twice is safe. The Web server takes port 3210 when it is
free and an ephemeral port otherwise, and each launcher opens the address its
own server actually reported. Two instances therefore run on two ports and do
not interfere; each one owns only its own child process.

### Code signing

The artifacts are **not** code-signed — there is no Authenticode certificate
for this project. Windows SmartScreen may warn the first time you run the
setup or the launcher. That warning reflects the missing certificate, not a
problem with the files. Verify your download against `SHA256SUMS.txt`.

---

## 3. Source checkout (developers)

Requirements:

- Windows 10 or 11
- Node.js **>= 20.16.0** (https://nodejs.org/)
- npm (bundled with Node.js)
- Windows PowerShell 5.1 (shipped with Windows) — PowerShell 7 is *not*
  required

First-time setup: **double-click `install-arclume.cmd`**. It verifies Node and
npm, runs `npm ci` and `npm run build`, installs Chromium via Playwright,
checks the build artifacts, smoke-tests the CLI, and then runs a **real**
Web-runtime smoke test (start → discover URL → HTTP 200 → stop). If the Web
runtime cannot start, the installation fails rather than reporting success.

Daily use: **double-click `ARCLUME.cmd`**.

```text
==========================================
 ARCLUME
 Local Visual Narrative Workspace
==========================================

ARCLUME is running:
http://127.0.0.1:3210

Press Ctrl+C or close this window to stop ARCLUME.
```

Both `.cmd` files are thin wrappers around
`scripts\windows\start-arclume.ps1` and `scripts\windows\install-arclume.ps1`.
The launcher script owns its child process and its own stdout/stderr capture
files, applies the same fail-closed HTTP 200 gate, and cleans up only what it
created.

```powershell
# equivalents
node .\dist\cli\index.js web
node .\dist\cli\index.js --help
node .\dist\cli\index.js analyze .\my-project --reasoner stub --out knowledge.json
node .\dist\cli\index.js build knowledge.json --preset executive --format html,pdf,pptx

# non-interactive checks
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\windows\start-arclume.ps1 -SmokeTest
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\windows\install-arclume.ps1 -NonInteractive
```

Logs for this path live in `.tmp\windows\` inside the checkout.

### Desktop shortcut for the checkout

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\windows\create-shortcut.ps1
```

Creates `ARCLUME.lnk` on your desktop pointing at `ARCLUME.cmd` with the
official icon from `docs/assets/brand/arclume.ico`.

---

## Building the distribution

From a source checkout, with Go and Inno Setup 6 installed:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\windows\build-distribution.ps1
```

The pipeline runs `npm ci` → `npm run build` → `npm pack`, installs the real
tarball with production dependencies only, downloads the **pinned** Node
runtime and verifies its official SHA256 before use, installs Chromium into
`browsers\`, builds `ARCLUME.exe` from `tools/windows-launcher`, assembles and
**validates** the portable layout, zips it, compiles the Inno Setup installer
and writes `SHA256SUMS.txt`. Output lands in `artifacts\windows\` (ignored by
Git). The version always comes from `package.json`; nothing is hardcoded and
nothing is published.

Useful switches: `-SkipNpmCi`, `-SkipInstaller`, `-SkipValidation`.

To validate an assembled layout on its own:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\windows\verify-distribution.ps1 -PortableRoot artifacts\windows\stage\ARCLUME
```

That runs a clean-room suite with a **sanitised PATH** (no Node, no npm on
it): layout and brand assets, `--version`, `--smoke-test`, orphan check,
loopback-only listener check, CLI smoke on the bundled runtime, and HTML, PDF
and PPTX export smoke.

---

## How it works (runtime)

**ARCLUME Web is not a Windows Service.** It is a local user process:

- The server binds **only** to `127.0.0.1` — never `0.0.0.0`, never a LAN
  address
- No firewall rules are added and no inbound ports are opened
- No registry modifications, no scheduled tasks, no admin requirement
- The process lives while its launcher lives
- No orphaned Node processes remain after shutdown

---

## Troubleshooting

### The window flashes and disappears / ARCLUME will not start

Read `%LOCALAPPDATA%\ARCLUME\logs\arclume-launcher.log` (packaged
distribution) or `.tmp\windows\arclume-launcher.log` (source checkout). Fatal
errors also appear in a dialog box, not only in the console.

### SmartScreen blocks the installer

The artifacts are unsigned. Verify the SHA256 against `SHA256SUMS.txt`, then
choose **More info → Run anyway** if you trust the download.

### Port 3210 already in use

Nothing to configure. The server takes another free port and the launcher
opens the address the server actually reported.

### The browser does not open

Check Windows Settings → Apps → Default apps. The address is printed in the
ARCLUME window; you can always open it by hand.

### "Node.js not found" / version too old (source checkout only)

Install Node.js 20.16.0+ from https://nodejs.org/ and re-run
`install-arclume.cmd`. The packaged distribution never shows this message: it
carries its own runtime.

### Playwright Chromium download fails (source checkout only)

Chromium is downloaded once. Corporate proxies may block it; configure
`npm config set proxy` / `npm config set https-proxy`, or run
`npx playwright install chromium` by hand. The packaged distribution has
Chromium inside it and needs no download.

### "Access denied" / permission errors

Do not run ARCLUME as Administrator. It is a user-level tool; the installer
is per-user by design and elevation is never required.

---

## Security notes

- The launcher never binds to `0.0.0.0` and never exposes a LAN port
- The discovered URL is validated against `^http://127\.0\.0\.1:\d+$` before
  it is used for anything, and is handed to the browser without a shell
- No HTTP 200, no browser: readiness fails closed
- Cleanup stops only the child process the launcher created; ARCLUME never
  runs `taskkill /IM node.exe` or stops Node processes by name
- Each run owns its own capture files and deletes only those
- No firewall rules, no registry modifications, no scheduled tasks, no
  Windows Service, no auto-updater
