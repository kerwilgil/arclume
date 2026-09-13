/**
 * Native source picker bridge (1.0.1 UX patch).
 *
 * One native OS dialog resolves an absolute filesystem path for a
 * "Folder / file" source. The dialog is opened by the operating system on
 * this machine, never by the browser: the web page only learns the resulting
 * path string, which then flows through the exact same ingestion pipeline as
 * a manually typed path.
 *
 * Security contract:
 *  - The spawned program is a fixed, static literal
 *    (`PICK_SOURCE_POWERSHELL_COMMAND` + `PICK_SOURCE_POWERSHELL_ARGV`).
 *    Nothing the client sends is ever interpolated into it — the HTTP
 *    endpoint takes NO input at all.
 *  - The chosen path is data returned to the caller: never executed, never
 *    shell-expanded, never opened by this module.
 *  - Cancelling the dialog is a normal outcome (`{ cancelled: true }`),
 *    never an error.
 */

import { spawn } from "node:child_process";

/** Outcome of one native picker invocation. */
export type PickSourceResult = { cancelled: true } | { cancelled: false; path: string };

/** Thrown when a second pick is requested while a dialog is still open. */
export class PickSourceBusyError extends Error {
  constructor() {
    super("a native source dialog is already open");
    this.name = "PickSourceBusyError";
  }
}

/**
 * The native picker ships with the Windows Installer and Portable builds.
 * Other platforms keep the manual path field (the endpoint reports
 * `supported: false` and the UI simply never shows the Browse button).
 */
export function pickSourceSupported(platform: NodeJS.Platform = process.platform): boolean {
  return platform === "win32";
}

/** Hard upper bound so a forgotten dialog never pins an HTTP request open. */
export const PICK_SOURCE_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * The ENTIRE picker program. Static and final: no template interpolation, no
 * environment expansion, no client data. Covered by a structural test so a
 * future refactor that reintroduces input interpolation fails loudly.
 *
 * Dialog: Shell `BrowseForFolder` with BIF_EDITBOX (0x10), BIF_VALIDATE
 * (0x20), BIF_NEWDIALOGSTYLE (0x40) and BIF_BROWSEINCLUDEFILES (0x4000) —
 * a single native dialog that accepts either a folder/project or one allowed
 * file, plus an edit box for typed paths. Exit protocol: the chosen absolute
 * path on stdout (UTF-8) with exit 0; cancellation or a non-filesystem pick
 * exits 3 with no output. The title is a fixed bilingual literal — never a
 * request parameter.
 */
export const PICK_SOURCE_POWERSHELL_COMMAND = [
  "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
  "$title = 'ARCLUME - Choose folder or file / Seleccionar carpeta o archivo'",
  "$shell = New-Object -ComObject Shell.Application",
  "$dialog = $shell.BrowseForFolder(0, $title, 0x4070, 0)",
  "if ($null -eq $dialog) { exit 3 }",
  "$picked = $null",
  "try { $picked = $dialog.Self.Path } catch { $picked = $null }",
  "if ([string]::IsNullOrWhiteSpace($picked)) { exit 3 }",
  "Write-Output $picked",
].join("\n");

/**
 * Fixed argv for `powershell.exe`. `-STA` is required for the Shell dialog;
 * `windowsHide: true` (set by the caller of spawn) keeps the GUI-subsystem
 * launcher from flashing a console window.
 */
export const PICK_SOURCE_POWERSHELL_ARGV: readonly string[] = [
  "-NoProfile",
  "-STA",
  "-ExecutionPolicy",
  "Bypass",
  "-Command",
  PICK_SOURCE_POWERSHELL_COMMAND,
];

/** Absolute paths longer than this are pathological; treat as no pick. */
const MAX_PICKED_PATH_LENGTH = 32767;

let pickerInFlight = false;

/**
 * Opens the native dialog and resolves with the outcome. Never throws for a
 * user cancellation; throws only when the OS could not even start the dialog
 * process, or when a dialog is already open (`PickSourceBusyError`).
 */
export async function pickLocalSource(
  options: { timeoutMs?: number } = {},
): Promise<PickSourceResult> {
  if (!pickSourceSupported()) {
    throw new Error("the native source picker is not available on this platform");
  }
  if (pickerInFlight) throw new PickSourceBusyError();
  pickerInFlight = true;
  try {
    return await runPicker(options.timeoutMs ?? PICK_SOURCE_TIMEOUT_MS);
  } finally {
    pickerInFlight = false;
  }
}

function runPicker(timeoutMs: number): Promise<PickSourceResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    let stdout = "";
    let stderr = "";
    let settled = false;

    const child = spawn("powershell.exe", [...PICK_SOURCE_POWERSHELL_ARGV], {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timer = setTimeout(() => {
      child.kill();
      finish({ cancelled: true });
    }, timeoutMs);

    function finish(result: PickSourceResult): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise(result);
    }

    function fail(err: Error): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rejectPromise(err);
    }

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (err) => fail(err));
    child.on("close", (code) => {
      const picked = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.length > 0);
      if (code === 0 && picked !== undefined && picked.length <= MAX_PICKED_PATH_LENGTH) {
        finish({ cancelled: false, path: picked });
        return;
      }
      // Exit 3 is the scripted cancel path; anything else with output on
      // stderr is worth a diagnostic line in the (launcher-captured) server
      // log. Either way the API resolves it as a cancellation, never an
      // error surfaced to the user.
      if (stderr.trim().length > 0) {
        console.error(`[pick-source] dialog helper exited with diagnostics: ${stderr.trim()}`);
      }
      finish({ cancelled: true });
    });
  });
}
