<#
.SYNOPSIS
    ARCLUME developer / source-checkout installer.

.DESCRIPTION
    Verifies prerequisites, runs npm ci and npm run build, installs the
    Playwright Chromium browser, then smoke-tests the CLI and the Web runtime.
    The Web runtime smoke test is real and fail-closed: if the server cannot
    start and answer HTTP 200, the installation FAILS.

    This installer is the source-checkout path for developers. End users get
    the packaged ARCLUME.exe distribution instead, which bundles its own Node
    runtime and Chromium.

    Compatibility: Windows PowerShell 5.1 (powershell.exe). No PowerShell 7
    only syntax (ternary `? :`, null-coalescing `??` / `??=`) is used.

.PARAMETER NonInteractive
    Never prompt (skips the desktop shortcut question). Intended for CI.

.NOTES
    Run via: install-arclume.cmd (double-click) or directly:
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\windows\install-arclume.ps1
#>

[CmdletBinding()]
param(
    [switch]$NonInteractive
)

$ErrorActionPreference = "Stop"

# Resolve repo root (script lives in scripts/windows/)
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$RepoRoot = (Resolve-Path (Join-Path $ScriptDir "..\..")).Path

# Setup logging
$LogDir = Join-Path $RepoRoot ".tmp\windows"
if (-not (Test-Path -LiteralPath $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}
$LogFile = Join-Path $LogDir "install-arclume.log"

function Write-Log {
    param([string]$Message, [string]$Level = "INFO")
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $entry = "[$timestamp] [$Level] $Message"
    Write-Host $entry
    try {
        Add-Content -LiteralPath $LogFile -Value $entry -ErrorAction SilentlyContinue
    } catch {
        # Logging must never abort the installer.
    }
}

function Write-ErrorLog {
    param([string]$Message)
    Write-Log -Message $Message -Level "ERROR"
}

function Write-WarnLog {
    param([string]$Message)
    Write-Log -Message $Message -Level "WARN"
}

<#
    Reads a log file that may still be open for writing by a child process.
#>
function Read-OwnedLog {
    param([string]$Path)

    if (-not $Path) { return "" }
    if (-not (Test-Path -LiteralPath $Path)) { return "" }
    $stream = $null
    try {
        $stream = New-Object System.IO.FileStream(
            $Path,
            [System.IO.FileMode]::Open,
            [System.IO.FileAccess]::Read,
            [System.IO.FileShare]::ReadWrite)
        $reader = New-Object System.IO.StreamReader($stream)
        return $reader.ReadToEnd()
    } catch {
        return ""
    } finally {
        if ($stream -ne $null) {
            try { $stream.Dispose() } catch { }
        }
    }
}

<#
    Quotes discrete arguments into a Windows command line so that paths with
    spaces survive intact.
#>
function Format-CommandLine {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)

    $parts = @()
    foreach ($argument in $Arguments) {
        if ($argument -match '[\s"]') {
            $escaped = $argument -replace '(\\*)"', '$1$1\"'
            $escaped = $escaped -replace '(\\+)$', '$1$1'
            $parts += ('"' + $escaped + '"')
        } else {
            $parts += $argument
        }
    }
    return ($parts -join ' ')
}

function New-OwnedLogStream {
    param([string]$Path)

    return New-Object System.IO.FileStream(
        $Path,
        [System.IO.FileMode]::Create,
        [System.IO.FileAccess]::Write,
        [System.IO.FileShare]::ReadWrite,
        1,
        $false)
}

<#
    Runs a child process to completion with stdout and stderr captured into
    two DISTINCT owned files. Returns exit code plus both captured streams.
#>
function Invoke-OwnedProcess {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [string[]]$Arguments = @(),
        [Parameter(Mandatory = $true)][string]$Label,
        [int]$TimeoutSeconds = 900
    )

    $runId = [System.Guid]::NewGuid().ToString("N")
    $stdoutPath = Join-Path $LogDir ($Label + "-stdout-" + $runId + ".log")
    $stderrPath = Join-Path $LogDir ($Label + "-stderr-" + $runId + ".log")

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $FilePath
    if ($Arguments -and $Arguments.Count -gt 0) {
        $psi.Arguments = Format-CommandLine -Arguments $Arguments
    }
    $psi.WorkingDirectory = $RepoRoot
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true

    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $psi
    [void]$process.Start()

    $stdoutStream = New-OwnedLogStream -Path $stdoutPath
    $stderrStream = New-OwnedLogStream -Path $stderrPath
    $stdoutTask = $process.StandardOutput.BaseStream.CopyToAsync($stdoutStream, 512)
    $stderrTask = $process.StandardError.BaseStream.CopyToAsync($stderrStream, 512)

    $exited = $process.WaitForExit($TimeoutSeconds * 1000)
    if (-not $exited) {
        Write-ErrorLog "$Label timed out after $TimeoutSeconds seconds; stopping owned PID $($process.Id)"
        try { $process.Kill() } catch { }
        [void]$process.WaitForExit(10000)
    }

    foreach ($task in @($stdoutTask, $stderrTask)) {
        try { [void]$task.Wait(5000) } catch { }
    }
    foreach ($stream in @($stdoutStream, $stderrStream)) {
        try { $stream.Dispose() } catch { }
    }

    $stdout = Read-OwnedLog -Path $stdoutPath
    $stderr = Read-OwnedLog -Path $stderrPath

    foreach ($path in @($stdoutPath, $stderrPath)) {
        try { Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue } catch { }
    }

    $code = 1
    if ($exited) { $code = $process.ExitCode }

    return [pscustomobject]@{
        ExitCode = $code
        Stdout   = $stdout
        Stderr   = $stderr
        TimedOut = (-not $exited)
    }
}

function Assert-StepSucceeded {
    param(
        [Parameter(Mandatory = $true)]$Result,
        [Parameter(Mandatory = $true)][string]$Step
    )

    if ($Result.ExitCode -ne 0) {
        Write-ErrorLog "$Step failed with exit code $($Result.ExitCode)"
        Write-ErrorLog "--- stdout ---"
        Write-ErrorLog $Result.Stdout
        Write-ErrorLog "--- stderr ---"
        Write-ErrorLog $Result.Stderr
        Write-ErrorLog "Installation aborted."
        exit 1
    }
    Write-Log "$Step completed successfully"
}

Write-Log "=== ARCLUME Installation Started ==="
Write-Log "Repo root: $RepoRoot"
Write-Log "Log file: $LogFile"
Write-Log "PowerShell version: $($PSVersionTable.PSVersion.ToString())"

try {
    # ---------------------------------------------------------
    # 1. Check Node.js >= 20.16.0
    # ---------------------------------------------------------
    Write-Log "[1/7] Checking Node.js availability..."
    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
    $nodePath = $null
    if ($nodeCommand -ne $null) { $nodePath = $nodeCommand.Source }
    if (-not $nodePath) {
        Write-ErrorLog "Node.js not found in PATH."
        Write-ErrorLog "Install Node.js 20.16.0 or newer from https://nodejs.org/ and re-run this installer."
        exit 1
    }
    Write-Log "Node.js found at: $nodePath"

    $nodeVersionOutput = & $nodePath --version
    Write-Log "Node.js version output: $nodeVersionOutput"
    if ($nodeVersionOutput -match '^v(\d+)\.(\d+)\.(\d+)') {
        $major = [int]$matches[1]
        $minor = [int]$matches[2]
        if ($major -lt 20 -or ($major -eq 20 -and $minor -lt 16)) {
            Write-ErrorLog "Node.js version $nodeVersionOutput is too old. ARCLUME requires >= 20.16.0"
            exit 1
        }
        Write-Log "Node.js version $nodeVersionOutput - OK"
    } else {
        Write-ErrorLog "Could not parse Node.js version: $nodeVersionOutput"
        exit 1
    }

    # ---------------------------------------------------------
    # 2. Check npm
    # ---------------------------------------------------------
    Write-Log "[2/7] Checking npm availability..."
    $npmCommand = Get-Command npm -ErrorAction SilentlyContinue
    $npmPath = $null
    if ($npmCommand -ne $null) { $npmPath = $npmCommand.Source }
    if (-not $npmPath) {
        Write-ErrorLog "npm not found in PATH. npm ships with Node.js; reinstall from https://nodejs.org/"
        exit 1
    }
    $npmVersionResult = Invoke-OwnedProcess -FilePath $npmPath -Arguments @("--version") -Label "npm-version" -TimeoutSeconds 120
    Assert-StepSucceeded -Result $npmVersionResult -Step "npm --version"
    Write-Log "npm version: $($npmVersionResult.Stdout.Trim())"

    # ---------------------------------------------------------
    # 3. npm ci
    # ---------------------------------------------------------
    Write-Log "[3/7] Running: npm ci"
    $result = Invoke-OwnedProcess -FilePath $npmPath -Arguments @("ci") -Label "npm-ci"
    Assert-StepSucceeded -Result $result -Step "npm ci"

    # ---------------------------------------------------------
    # 4. npm run build
    # ---------------------------------------------------------
    Write-Log "[4/7] Running: npm run build"
    $result = Invoke-OwnedProcess -FilePath $npmPath -Arguments @("run", "build") -Label "npm-build"
    Assert-StepSucceeded -Result $result -Step "npm run build"

    # ---------------------------------------------------------
    # 5. Playwright Chromium
    # ---------------------------------------------------------
    Write-Log "[5/7] Running: npx playwright install chromium"
    $npxCommand = Get-Command npx -ErrorAction SilentlyContinue
    $npxPath = $null
    if ($npxCommand -ne $null) { $npxPath = $npxCommand.Source }
    if (-not $npxPath) {
        Write-ErrorLog "npx not found in PATH. npx ships with Node.js; reinstall from https://nodejs.org/"
        exit 1
    }
    $result = Invoke-OwnedProcess -FilePath $npxPath -Arguments @("playwright", "install", "chromium") -Label "playwright-install"
    Assert-StepSucceeded -Result $result -Step "npx playwright install chromium"

    # ---------------------------------------------------------
    # 6. Verify build artifacts
    # ---------------------------------------------------------
    Write-Log "[6/7] Verifying build artifacts..."
    $cliPath = Join-Path $RepoRoot "dist\cli\index.js"
    $webIndexPath = Join-Path $RepoRoot "web\dist\index.html"
    $faviconPath = Join-Path $RepoRoot "web\dist\brand\favicon.svg"
    $logoPath = Join-Path $RepoRoot "web\dist\brand\arclume-logo-horizontal.svg"

    $missing = @()
    if (-not (Test-Path -LiteralPath $cliPath)) { $missing += "dist\cli\index.js" }
    if (-not (Test-Path -LiteralPath $webIndexPath)) { $missing += "web\dist\index.html" }
    if (-not (Test-Path -LiteralPath $faviconPath)) { $missing += "web\dist\brand\favicon.svg" }
    if (-not (Test-Path -LiteralPath $logoPath)) { $missing += "web\dist\brand\arclume-logo-horizontal.svg" }

    if ($missing.Count -gt 0) {
        Write-ErrorLog "Missing build artifacts: $($missing -join ', ')"
        exit 1
    }
    Write-Log "Build artifacts verified"

    # ---------------------------------------------------------
    # 7. Smoke tests - CLI then real Web runtime
    # ---------------------------------------------------------
    Write-Log "[7/7] Running smoke tests..."

    $result = Invoke-OwnedProcess -FilePath $nodePath -Arguments @($cliPath, "--version") -Label "cli-version" -TimeoutSeconds 120
    Assert-StepSucceeded -Result $result -Step "arclume --version"
    Write-Log "arclume --version: $($result.Stdout.Trim())"

    $result = Invoke-OwnedProcess -FilePath $nodePath -Arguments @($cliPath, "--help") -Label "cli-help" -TimeoutSeconds 120
    Assert-StepSucceeded -Result $result -Step "arclume --help"

    # Real Web runtime smoke: start, discover URL, require HTTP 200, stop,
    # confirm the process exited. Delegated to the launcher's own smoke mode so
    # the installer verifies exactly the code path users run. Fail-closed.
    Write-Log "Verifying Web runtime (start -> URL -> HTTP 200 -> stop)..."
    $startScript = Join-Path $RepoRoot "scripts\windows\start-arclume.ps1"
    $powershellExe = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
    if (-not (Test-Path -LiteralPath $powershellExe)) { $powershellExe = "powershell.exe" }

    $smokeResult = Invoke-OwnedProcess `
        -FilePath $powershellExe `
        -Arguments @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $startScript, "-SmokeTest") `
        -Label "web-smoke" `
        -TimeoutSeconds 180

    if ($smokeResult.ExitCode -ne 0) {
        Write-ErrorLog "ARCLUME Web runtime smoke test FAILED (exit code $($smokeResult.ExitCode))."
        Write-ErrorLog "--- smoke stdout ---"
        Write-ErrorLog $smokeResult.Stdout
        Write-ErrorLog "--- smoke stderr ---"
        Write-ErrorLog $smokeResult.Stderr
        Write-ErrorLog "Installation aborted: the Web runtime could not start."
        exit 1
    }
    Write-Log "Web runtime smoke test PASS"

    # ---------------------------------------------------------
    # Success
    # ---------------------------------------------------------
    Write-Log "=== ARCLUME Installation Complete ==="
    Write-Host ""
    Write-Host "=========================================="
    Write-Host " ARCLUME installation complete"
    Write-Host "=========================================="
    Write-Host ""
    Write-Host "To start ARCLUME:"
    Write-Host ""
    Write-Host "  double-click ARCLUME.cmd"
    Write-Host ""
    Write-Host "Or from command line:"
    Write-Host ""
    Write-Host "  node dist\cli\index.js web"
    Write-Host ""

    $shortcutScript = Join-Path $RepoRoot "scripts\windows\create-shortcut.ps1"
    if ((Test-Path -LiteralPath $shortcutScript) -and (-not $NonInteractive)) {
        Write-Host ""
        $choice = Read-Host "Create desktop shortcut? [Y/N]"
        if ($choice -ieq 'Y') {
            & $powershellExe -NoProfile -ExecutionPolicy Bypass -File $shortcutScript
        }
    }

    exit 0
}
catch {
    Write-ErrorLog "Unhandled exception: $($_.Exception.Message)"
    Write-Log "Stack trace: $($_.ScriptStackTrace)"
    exit 1
}
