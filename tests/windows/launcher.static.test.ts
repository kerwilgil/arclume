import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..", "..");

function read(...parts: string[]): string {
  return readFileSync(resolve(ROOT, ...parts), "utf8");
}

/**
 * Strips PowerShell comments so syntax scans never trip on prose. Block
 * comments (`<# ... #>`) and whole-line `#` comments are removed; inline
 * trailing comments are left alone because none of these scripts embed
 * operator-like text after code on the same line.
 */
function stripPowerShellComments(source: string): string {
  return source
    .replace(/<#[\s\S]*?#>/g, "")
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
}

const arclumeCmd = read("ARCLUME.cmd");
const installCmd = read("install-arclume.cmd");
const shortcutPs1 = read("scripts", "windows", "create-shortcut.ps1");
const installPs1 = read("scripts", "windows", "install-arclume.ps1");
const startPs1 = read("scripts", "windows", "start-arclume.ps1");

function findNonAscii(source: string): string[] {
  const offenders: string[] = [];
  for (const char of source) {
    const code = char.codePointAt(0);
    if (code !== undefined && code > 0x7f) {
      offenders.push(char);
    }
  }
  return offenders;
}

const POWERSHELL_SCRIPTS: ReadonlyArray<readonly [string, string]> = [
  ["start-arclume.ps1", startPs1],
  ["install-arclume.ps1", installPs1],
  ["create-shortcut.ps1", shortcutPs1],
];

describe("Windows launcher — PowerShell 5.1 compatibility", () => {
  for (const [name, source] of POWERSHELL_SCRIPTS) {
    const code = stripPowerShellComments(source);

    describe(name, () => {
      it("does not use the PowerShell 7 null-coalescing operator", () => {
        expect(code).not.toMatch(/\?\?/);
      });

      it("does not use the PowerShell 7 ternary operator", () => {
        // `cond ? $a : $b` / `cond ? (…) : (…)` — the shapes a ternary takes.
        expect(code).not.toMatch(/\s\?\s+[$(]/);
      });

      it("does not use PowerShell 7 only pipeline chain operators", () => {
        expect(code).not.toMatch(/&&|\|\|/);
      });

      it("does not require pwsh / PowerShell 7", () => {
        expect(code).not.toMatch(/\bpwsh\b/);
      });

      it("does not use ForEach-Object -Parallel (PowerShell 7 only)", () => {
        expect(code).not.toMatch(/-Parallel\b/);
      });
    });
  }
});

describe("Windows launcher — encoding", () => {
  // Windows PowerShell 5.1 reads a BOM-less .ps1 as ANSI, so a UTF-8 em dash
  // arrives as two mojibake bytes and can derail the parser mid-file. Keeping
  // the launcher scripts pure ASCII removes the whole failure class.
  for (const [name, source] of POWERSHELL_SCRIPTS) {
    it(`${name} is pure ASCII`, () => {
      expect(findNonAscii(source)).toEqual([]);
    });
  }

  for (const [name, source] of [
    ["ARCLUME.cmd", arclumeCmd],
    ["install-arclume.cmd", installCmd],
  ] as const) {
    it(`${name} is pure ASCII`, () => {
      expect(findNonAscii(source)).toEqual([]);
    });
  }
});

describe("Windows launcher — process and file ownership", () => {
  for (const [name, source] of POWERSHELL_SCRIPTS) {
    describe(name, () => {
      it("never kills Node globally by image name", () => {
        expect(source).not.toContain("taskkill");
        expect(source).not.toMatch(/Get-Process\s+node/i);
        expect(source).not.toMatch(/Stop-Process\s+-Name/i);
      });

      it("never binds or references 0.0.0.0", () => {
        expect(source).not.toContain("0.0.0.0");
      });

      it("does not publish, force-push or rewrite history", () => {
        expect(source).not.toContain("npm publish");
        expect(source).not.toContain("git push --force");
        expect(source).not.toContain("git rebase");
      });
    });
  }
});

describe("scripts/windows/start-arclume.ps1 — launcher core", () => {
  it("owns its stdout and stderr paths explicitly", () => {
    expect(startPs1).toContain("$script:OwnedStdoutPath");
    expect(startPs1).toContain("$script:OwnedStderrPath");
    expect(startPs1).toContain("arclume-stdout-");
    expect(startPs1).toContain("arclume-stderr-");
  });

  it("uses two distinct files for stdout and stderr", () => {
    expect(startPs1).toMatch(/OwnedStdoutPath\s*=\s*Join-Path/);
    expect(startPs1).toMatch(/OwnedStderrPath\s*=\s*Join-Path/);
  });

  it("never guesses the stdout path by globbing the temp directory", () => {
    expect(startPs1).not.toMatch(/Get-ChildItem[^\n]*arclume-stdout/);
    expect(startPs1).not.toMatch(/Filter\s+"arclume-/);
  });

  it("never reads the stdout path off ProcessStartInfo", () => {
    expect(startPs1).not.toMatch(/StartInfo\.RedirectStandardOutput\s*\?/);
    expect(startPs1).not.toMatch(/\$\w+\.StartInfo\.RedirectStandardOutput\b(?!\s*=)/);
  });

  it("starts the server through System.Diagnostics.ProcessStartInfo", () => {
    expect(startPs1).toContain("System.Diagnostics.ProcessStartInfo");
    expect(startPs1).toContain("System.Diagnostics.Process");
    expect(startPs1).toContain("UseShellExecute");
  });

  it("quotes arguments so paths with spaces survive", () => {
    expect(startPs1).toContain("function Format-CommandLine");
    expect(startPs1).toMatch(/Arguments\s*=\s*Format-CommandLine/);
  });

  it("validates the discovered URL strictly against loopback", () => {
    expect(startPs1).toContain("^http://127\\.0\\.0\\.1:\\d+$");
  });

  it("requires HTTP 200 and fails closed", () => {
    expect(startPs1).toContain("Invoke-WebRequest");
    expect(startPs1).toContain("never returned HTTP 200");
    expect(startPs1).not.toContain("but continuing");
  });

  it("opens the browser only after the readiness gate", () => {
    const readinessGate = startPs1.indexOf("never returned HTTP 200");
    const browserLaunch = startPs1.indexOf("Opening browser:");
    expect(readinessGate).toBeGreaterThan(-1);
    expect(browserLaunch).toBeGreaterThan(readinessGate);
  });

  it("does not hardcode browser executables", () => {
    expect(startPs1).not.toContain("chrome.exe");
    expect(startPs1).not.toContain("msedge.exe");
    expect(startPs1).not.toContain("firefox.exe");
  });

  it("does not hardcode a port", () => {
    expect(startPs1).not.toContain("3210");
  });

  it("stops only the process it owns and waits for exit", () => {
    expect(startPs1).toContain("function Stop-OwnedServer");
    expect(startPs1).toContain("$script:OwnedProcess.Kill()");
    expect(startPs1).toContain("WaitForExit");
  });

  it("deletes only its own temp files on cleanup", () => {
    expect(startPs1).toMatch(/Remove-Item -LiteralPath \$path -Force/);
  });

  it("exposes a smoke-test mode that never opens a browser", () => {
    expect(startPs1).toContain("[switch]$SmokeTest");
    expect(startPs1).toContain("[switch]$NoBrowser");
  });

  it("points the user at a log file on failure", () => {
    expect(startPs1).toContain("ARCLUME could not start.");
    expect(startPs1).toContain("arclume-launcher.log");
  });

  it("verifies build artifacts before starting", () => {
    expect(startPs1).toContain("dist\\cli\\index.js");
    expect(startPs1).toContain("web\\dist\\index.html");
  });

  it("checks Node.js >= 20.16.0", () => {
    expect(startPs1).toContain("20.16.0");
  });

  it("shows the running URL banner", () => {
    expect(startPs1).toContain("ARCLUME is running");
  });
});

describe("scripts/windows/install-arclume.ps1 — installer core", () => {
  it("runs the real build pipeline", () => {
    expect(installPs1).toMatch(/@\("ci"\)/);
    expect(installPs1).toMatch(/@\("run", "build"\)/);
    expect(installPs1).toMatch(/@\("playwright", "install", "chromium"\)/);
  });

  it("captures stdout and stderr into distinct owned files", () => {
    expect(installPs1).toContain('$stdoutPath = Join-Path $LogDir ($Label + "-stdout-"');
    expect(installPs1).toContain('$stderrPath = Join-Path $LogDir ($Label + "-stderr-"');
  });

  it("never redirects stdout and stderr to the same file", () => {
    expect(installPs1).not.toMatch(
      /-RedirectStandardOutput\s+(\$\w+)[^\n]*-RedirectStandardError\s+\1\b/,
    );
    expect(installPs1).not.toContain("$smokeUrlFile");
  });

  it("uses ProcessStartInfo rather than Invoke-Expression", () => {
    expect(installPs1).toContain("System.Diagnostics.ProcessStartInfo");
    expect(installPs1).not.toContain("Invoke-Expression");
  });

  it("verifies build artifacts and brand assets", () => {
    expect(installPs1).toContain("dist\\cli\\index.js");
    expect(installPs1).toContain("web\\dist\\index.html");
    expect(installPs1).toContain("web\\dist\\brand\\favicon.svg");
  });

  it("smoke tests the CLI", () => {
    expect(installPs1).toContain("--version");
    expect(installPs1).toContain("--help");
  });

  it("runs a real fail-closed Web runtime smoke test", () => {
    expect(installPs1).toContain("start-arclume.ps1");
    expect(installPs1).toContain("-SmokeTest");
    expect(installPs1).toContain("Installation aborted: the Web runtime could not start.");
  });

  it("does not treat a failing Web runtime as a warning", () => {
    expect(installPs1).not.toContain("server may still work");
  });

  it("supports a non-interactive mode for CI", () => {
    expect(installPs1).toContain("[switch]$NonInteractive");
  });

  it("aborts on any failed step", () => {
    expect(installPs1).toContain("function Assert-StepSucceeded");
    expect(installPs1).toContain("exit 1");
  });
});

describe("scripts/windows/create-shortcut.ps1", () => {
  it("exists and is non-empty", () => {
    expect(shortcutPs1.length).toBeGreaterThan(0);
  });

  it("targets the source-checkout ARCLUME.cmd", () => {
    expect(shortcutPs1).toContain("ARCLUME.cmd");
  });

  it("sets the working directory to the repo root", () => {
    expect(shortcutPs1).toContain("WorkingDirectory");
  });

  it("uses the WScript.Shell COM object", () => {
    expect(shortcutPs1).toContain("WScript.Shell");
  });

  it("uses the official ARCLUME icon", () => {
    expect(shortcutPs1).toContain("docs\\assets\\brand\\arclume.ico");
  });

  it("does not hardcode browser executables", () => {
    expect(shortcutPs1).not.toContain("chrome.exe");
    expect(shortcutPs1).not.toContain("msedge.exe");
    expect(shortcutPs1).not.toContain("firefox.exe");
  });
});

describe("ARCLUME.cmd — thin developer wrapper", () => {
  it("uses %~dp0 to resolve the repo root", () => {
    expect(arclumeCmd).toContain("%~dp0");
  });

  it("delegates everything to start-arclume.ps1", () => {
    expect(arclumeCmd).toContain("start-arclume.ps1");
    expect(arclumeCmd).not.toMatch(/NODE_MAJOR|NODE_MINOR/);
    expect(arclumeCmd).not.toContain("dist\\cli\\index.js");
    expect(arclumeCmd).not.toContain("findstr");
    expect(arclumeCmd).not.toContain("Start-Process");
  });

  it("invokes Windows PowerShell 5.1, not pwsh", () => {
    expect(arclumeCmd).toContain("powershell.exe");
    expect(arclumeCmd).not.toMatch(/\bpwsh\b/);
  });

  it("propagates the PowerShell exit code", () => {
    expect(arclumeCmd).toContain("%ERRORLEVEL%");
  });

  it("never kills Node globally", () => {
    expect(arclumeCmd).not.toContain("taskkill");
    expect(arclumeCmd).not.toContain("0.0.0.0");
  });
});

describe("install-arclume.cmd — thin developer wrapper", () => {
  it("uses %~dp0 to resolve the repo root", () => {
    expect(installCmd).toContain("%~dp0");
  });

  it("delegates everything to install-arclume.ps1", () => {
    expect(installCmd).toContain("install-arclume.ps1");
    expect(installCmd).not.toContain("npm ci");
    expect(installCmd).not.toContain("npm run build");
    expect(installCmd).not.toContain("npx playwright install chromium");
  });

  it("invokes Windows PowerShell 5.1, not pwsh", () => {
    expect(installCmd).toContain("powershell.exe");
    expect(installCmd).not.toMatch(/\bpwsh\b/);
  });

  it("propagates the PowerShell exit code", () => {
    expect(installCmd).toContain("%ERRORLEVEL%");
  });

  it("never kills Node globally", () => {
    expect(installCmd).not.toContain("taskkill");
    expect(installCmd).not.toContain("0.0.0.0");
  });
});
