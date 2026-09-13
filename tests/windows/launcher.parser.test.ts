import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Windows PowerShell 5.1 parser gate.
 *
 * The Linux CI jobs can only reason about the launcher scripts as text, which
 * is exactly how a PowerShell 7 only ternary shipped undetected. On Windows we
 * hand each script to the real Windows PowerShell 5.1 parser
 * ([System.Management.Automation.Language.Parser]::ParseFile) and require zero
 * parse errors. Elsewhere the suite records a platform skip.
 */

const ROOT = resolve(__dirname, "..", "..");
const SCRIPTS = ["start-arclume.ps1", "install-arclume.ps1", "create-shortcut.ps1"] as const;

const isWindows = process.platform === "win32";

function parseWithWindowsPowerShell(scriptPath: string): { code: number; output: string } {
  const command = [
    "$tokens = $null; $errors = $null;",
    `[void][System.Management.Automation.Language.Parser]::ParseFile('${scriptPath.replace(/'/g, "''")}', [ref]$tokens, [ref]$errors);`,
    "if ($errors -and $errors.Count -gt 0) {",
    '  foreach ($e in $errors) { Write-Output ("{0}: {1}" -f $e.Extent.StartLineNumber, $e.Message) }',
    "  exit 1",
    "}",
    'Write-Output "PARSE_OK"',
  ].join(" ");

  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command],
    { encoding: "utf8", windowsHide: true },
  );

  return {
    code: result.status ?? 1,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

describe.skipIf(!isWindows)("Windows PowerShell 5.1 — real parser gate", () => {
  it("runs against Windows PowerShell 5.1", () => {
    const result = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "$PSVersionTable.PSVersion.Major.ToString() + '.' + $PSVersionTable.PSVersion.Minor.ToString()",
      ],
      { encoding: "utf8", windowsHide: true },
    );
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toMatch(/^5\.\d+$/);
  });

  for (const script of SCRIPTS) {
    it(`parses ${script} without errors`, () => {
      const scriptPath = resolve(ROOT, "scripts", "windows", script);
      const { code, output } = parseWithWindowsPowerShell(scriptPath);
      expect(output).toContain("PARSE_OK");
      expect(code).toBe(0);
    });
  }
});
