# ARCLUME on Windows

ARCLUME has two distribution paths. Both carry their own Node.js runtime and
their own Chromium, so **nothing else has to be installed**.

| Path | Who it is for | Needs Node.js installed? |
|---|---|---|
| `ARCLUME-Setup-1.0.1.exe` | everyone | no |
| `ARCLUME-1.0.1-portable.zip` | portable / no-install users | no |

---

## 1. Installer

Run `ARCLUME-Setup-1.0.1.exe` and follow the wizard.

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

Extract `ARCLUME-1.0.1-portable.zip` anywhere — including a path with
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

Read `%LOCALAPPDATA%\ARCLUME\logs\arclume-launcher.log`. Fatal
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

### "Node.js not found" / version too old

Install Node.js 20.16.0+ from https://nodejs.org/ if you need to run ARCLUME
from a source checkout. The packaged distribution never shows this message: it
carries its own runtime.

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