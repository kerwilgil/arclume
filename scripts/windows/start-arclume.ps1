<#
.SYNOPSIS
    ARCLUME developer / source-checkout launcher.

.DESCRIPTION
    Starts the ARCLUME Web UI from a source checkout: preflight, start server,
    discover the loopback URL, require HTTP 200, open the default browser and
    own the child process lifecycle until shutdown.

    This script is the source-checkout fallback. The primary Windows product
    experience is the native ARCLUME.exe launcher shipped in the portable and
    installer distributions.

    Compatibility: Windows PowerShell 5.1 (powershell.exe). No PowerShell 7
    only syntax (ternary `? :`, null-coalescing `??` / `??=`) is used.

.PARAMETER NoBrowser
    Start ARCLUME but do not open the default browser.

.PARAMETER SmokeTest
    Start ARCLUME, require HTTP 200, stop it again and exit 0. Never opens a
    browser. Intended for CI and for post-install verification.

.NOTES
    Run via: ARCLUME.cmd (double-click) or directly:
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\windows\start-arclume.ps1
#>

[CmdletBinding()]
param(
    [switch]$NoBrowser,
    [switch]$SmokeTest
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
$LogFile = Join-Path $LogDir "arclume-launcher.log"

function Write-Log {
    param([string]$Message, [string]$Level = "INFO")
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $entry = "[$timestamp] [$Level] $Message"
    Write-Host $entry
    try {
        Add-Content -LiteralPath $LogFile -Value $entry -ErrorAction SilentlyContinue
    } catch {
        # Logging must never abort the launcher.
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

# ---------------------------------------------------------
# Owned run state
#
# Every launcher run owns exactly one child process, one stdout file and one
# stderr file. Nothing is ever discovered by globbing: a run touches only the
# handles it created itself, so concurrent ARCLUME instances cannot read or
# delete each other's files.
# ---------------------------------------------------------
$script:OwnedProcess = $null
$script:OwnedStdoutPath = $null
$script:OwnedStderrPath = $null
$script:OwnedStdoutStream = $null
$script:OwnedStderrStream = $null
$script:OwnedStdoutTask = $null
$script:OwnedStderrTask = $null
$script:ServerUrl = $null

<#
    Builds a Windows command line from discrete arguments, quoting anything
    that contains whitespace or quotes. Required because paths such as
    "C:\Users\me\ARCLUME Test\dist\cli\index.js" must survive intact; passing
    an array to Start-Process -ArgumentList in Windows PowerShell 5.1 joins
    with spaces and does not quote.
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

<#
    Reads a log file that is still being written by the child process.
    Opened with FileShare::ReadWrite so it never fights the writer.
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

function Write-OwnedDiagnostics {
    $stdout = Read-OwnedLog -Path $script:OwnedStdoutPath
    $stderr = Read-OwnedLog -Path $script:OwnedStderrPath

    Write-Log "--- ARCLUME server stdout ---"
    if ($stdout.Trim().Length -gt 0) { Write-Log $stdout } else { Write-Log "(empty)" }
    Write-Log "--- ARCLUME server stderr ---"
    if ($stderr.Trim().Length -gt 0) { Write-Log $stderr } else { Write-Log "(empty)" }
    Write-Log "--- end of server output ---"
}

<#
    Stops only the child process this launcher created, waits for it to exit,
    then releases and deletes only the temp files this launcher created.
    Never enumerates or kills node.exe globally.
#>
function Stop-OwnedServer {
    if ($script:OwnedProcess -ne $null) {
        try {
            if (-not $script:OwnedProcess.HasExited) {
                Write-Log "Stopping ARCLUME server (owned PID: $($script:OwnedProcess.Id))..."
                $script:OwnedProcess.Kill()
            }
        } catch {
            Write-WarnLog "Failed to stop owned server process: $($_.Exception.Message)"
        }
        try {
            [void]$script:OwnedProcess.WaitForExit(10000)
            Write-Log "Owned server process exited (PID: $($script:OwnedProcess.Id))"
        } catch {
            Write-WarnLog "Timed out waiting for owned server process to exit"
        }
    }

    foreach ($task in @($script:OwnedStdoutTask, $script:OwnedStderrTask)) {
        if ($task -ne $null) {
            try { [void]$task.Wait(2000) } catch { }
        }
    }

    foreach ($stream in @($script:OwnedStdoutStream, $script:OwnedStderrStream)) {
        if ($stream -ne $null) {
            try { $stream.Dispose() } catch { }
        }
    }
    $script:OwnedStdoutStream = $null
    $script:OwnedStderrStream = $null

    foreach ($path in @($script:OwnedStdoutPath, $script:OwnedStderrPath)) {
        if ($path -and (Test-Path -LiteralPath $path)) {
            try { Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue } catch { }
        }
    }
    $script:OwnedStdoutPath = $null
    $script:OwnedStderrPath = $null

    Write-Log "Cleanup complete"
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
    Starts the ARCLUME Web server as an owned child process using
    System.Diagnostics.Process, with stdout and stderr copied asynchronously
    into two distinct files whose paths are generated up front.
#>
function Start-OwnedServer {
    param(
        [Parameter(Mandatory = $true)][string]$NodeExe,
        [Parameter(Mandatory = $true)][string]$CliPath,
        [string[]]$ExtraArguments = @()
    )

    $runId = [System.Guid]::NewGuid().ToString("N")
    $script:OwnedStdoutPath = Join-Path $LogDir ("arclume-stdout-" + $runId + ".log")
    $script:OwnedStderrPath = Join-Path $LogDir ("arclume-stderr-" + $runId + ".log")

    $arguments = @($CliPath, "web")
    if ($ExtraArguments -and $ExtraArguments.Count -gt 0) {
        $arguments = $arguments + $ExtraArguments
    }

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $NodeExe
    $psi.Arguments = Format-CommandLine -Arguments $arguments
    $psi.WorkingDirectory = $RepoRoot
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true

    Write-Log "Starting server: $NodeExe $($psi.Arguments)"

    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $psi
    [void]$process.Start()
    $script:OwnedProcess = $process

    $script:OwnedStdoutStream = New-OwnedLogStream -Path $script:OwnedStdoutPath
    $script:OwnedStderrStream = New-OwnedLogStream -Path $script:OwnedStderrPath
    $script:OwnedStdoutTask = $process.StandardOutput.BaseStream.CopyToAsync($script:OwnedStdoutStream, 512)
    $script:OwnedStderrTask = $process.StandardError.BaseStream.CopyToAsync($script:OwnedStderrStream, 512)

    Write-Log "Owned server PID: $($process.Id)"
    Write-Log "Owned stdout: $($script:OwnedStdoutPath)"
    Write-Log "Owned stderr: $($script:OwnedStderrPath)"

    return $process
}

<#
    Polls the owned stdout (and, as a fallback, the owned stderr) for the
    loopback URL the server prints. Only owned files are read.
#>
function Wait-ForServerUrl {
    param([int]$TimeoutSeconds = 30)

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $stdout = Read-OwnedLog -Path $script:OwnedStdoutPath
        if ($stdout -match '(http://127\.0\.0\.1:\d+)') {
            return $matches[1]
        }
        $stderr = Read-OwnedLog -Path $script:OwnedStderrPath
        if ($stderr -match '(http://127\.0\.0\.1:\d+)') {
            return $matches[1]
        }
        if ($script:OwnedProcess -ne $null -and $script:OwnedProcess.HasExited) {
            return $null
        }
        Start-Sleep -Milliseconds 250
    }
    return $null
}

<#
    Readiness is fail-closed: without an HTTP 200 the launcher never opens a
    browser and never reports success.
#>
function Test-ServerReady {
    param(
        [Parameter(Mandatory = $true)][string]$Url,
        [int]$TimeoutSeconds = 20
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $response = Invoke-WebRequest -Uri $Url -Method GET -UseBasicParsing -TimeoutSec 5
            if ($response.StatusCode -eq 200) {
                return $true
            }
            Write-WarnLog "Server responded with HTTP $($response.StatusCode); still waiting for 200"
        } catch {
            # Not ready yet.
        }
        if ($script:OwnedProcess -ne $null -and $script:OwnedProcess.HasExited) {
            return $false
        }
        Start-Sleep -Milliseconds 500
    }
    return $false
}

function Exit-WithFailure {
    param([string]$Message)

    Write-ErrorLog $Message
    Write-OwnedDiagnostics
    Stop-OwnedServer
    Write-Host ""
    Write-Host "ARCLUME could not start."
    Write-Host "See: $LogFile"
    Write-Host ""
    exit 1
}

Write-Log "=== ARCLUME Launcher Started ==="
Write-Log "Repo root: $RepoRoot"
Write-Log "Log file: $LogFile"
Write-Log "PowerShell version: $($PSVersionTable.PSVersion.ToString())"
if ($SmokeTest) { Write-Log "Mode: smoke test (no browser)" }

try {
    # ---------------------------------------------------------
    # Preflight checks
    # ---------------------------------------------------------
    Write-Host "=========================================="
    Write-Host " ARCLUME"
    Write-Host " Local Visual Narrative Workspace"
    Write-Host "=========================================="
    Write-Host ""

    Write-Log "[Preflight] Checking Node.js availability..."
    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
    $nodePath = $null
    if ($nodeCommand -ne $null) { $nodePath = $nodeCommand.Source }
    if (-not $nodePath) {
        Write-ErrorLog "Node.js not found in PATH."
        Write-Host ""
        Write-Host "ERROR: Node.js not found in PATH."
        Write-Host "This source-checkout launcher requires Node.js 20.16.0 or newer."
        Write-Host "Install Node.js from https://nodejs.org/ then run: install-arclume.cmd"
        Write-Host "(The packaged ARCLUME.exe distribution bundles its own Node runtime.)"
        exit 1
    }
    Write-Log "Node.js found at: $nodePath"

    $nodeVersionOutput = & $nodePath --version
    Write-Log "Node.js version: $nodeVersionOutput"
    if ($nodeVersionOutput -match '^v(\d+)\.(\d+)\.(\d+)') {
        $major = [int]$matches[1]
        $minor = [int]$matches[2]
        if ($major -lt 20 -or ($major -eq 20 -and $minor -lt 16)) {
            Write-ErrorLog "Node.js version $nodeVersionOutput is too old. ARCLUME requires >= 20.16.0"
            Write-Host ""
            Write-Host "ERROR: Node.js version $nodeVersionOutput is too old."
            Write-Host "ARCLUME requires Node.js 20.16.0 or newer."
            exit 1
        }
        Write-Log "Node.js version check passed"
    } else {
        Write-ErrorLog "Could not parse Node.js version: $nodeVersionOutput"
        exit 1
    }

    # Verify build artifacts
    $cliPath = Join-Path $RepoRoot "dist\cli\index.js"
    $webIndexPath = Join-Path $RepoRoot "web\dist\index.html"

    if (-not (Test-Path -LiteralPath $cliPath)) {
        Write-ErrorLog "ARCLUME is not built yet. Missing: $cliPath"
        Write-Host ""
        Write-Host "ERROR: ARCLUME is not built yet."
        Write-Host "Missing: dist\cli\index.js"
        Write-Host "Run the installer first: install-arclume.cmd"
        exit 1
    }

    if (-not (Test-Path -LiteralPath $webIndexPath)) {
        Write-ErrorLog "ARCLUME Web UI assets not found. Missing: $webIndexPath"
        Write-Host ""
        Write-Host "ERROR: ARCLUME Web UI assets not found."
        Write-Host "Missing: web\dist\index.html"
        Write-Host "Run the installer first: install-arclume.cmd"
        exit 1
    }

    Write-Log "Preflight OK: Node.js, dist\cli\index.js, web\dist\index.html found"

    # ---------------------------------------------------------
    # Start ARCLUME Web UI and discover the actual URL
    # ---------------------------------------------------------
    Write-Host ""
    Write-Host "Starting ARCLUME Web UI..."

    [void](Start-OwnedServer -NodeExe $nodePath -CliPath $cliPath)

    $arclumeUrl = Wait-ForServerUrl -TimeoutSeconds 30
    if (-not $arclumeUrl) {
        Exit-WithFailure "ARCLUME server did not report a loopback URL within 30 seconds."
    }

    # Validate URL format strictly before it is used for anything.
    if ($arclumeUrl -notmatch '^http://127\.0\.0\.1:\d+$') {
        Exit-WithFailure "Invalid URL reported by ARCLUME server: $arclumeUrl"
    }

    $script:ServerUrl = $arclumeUrl
    Write-Log "Discovered URL: $arclumeUrl"

    # ---------------------------------------------------------
    # HTTP readiness - fail closed
    # ---------------------------------------------------------
    Write-Log "Waiting for HTTP 200 on $arclumeUrl ..."
    if (-not (Test-ServerReady -Url $arclumeUrl -TimeoutSeconds 20)) {
        Exit-WithFailure "ARCLUME server never returned HTTP 200 at $arclumeUrl"
    }
    Write-Log "Server ready (HTTP 200)"

    if ($SmokeTest) {
        Write-Log "Smoke test passed: $arclumeUrl returned HTTP 200"
        Stop-OwnedServer
        Write-Host ""
        Write-Host "ARCLUME smoke test PASS ($arclumeUrl)"
        exit 0
    }

    Write-Host ""
    Write-Host "=========================================="
    Write-Host " ARCLUME"
    Write-Host " Local Visual Narrative Workspace"
    Write-Host "=========================================="
    Write-Host ""
    Write-Host "ARCLUME is running:"
    Write-Host $arclumeUrl
    Write-Host ""
    Write-Host "Press Ctrl+C or close this window to stop ARCLUME."
    Write-Host ""

    # ---------------------------------------------------------
    # Browser - only after readiness
    # ---------------------------------------------------------
    if ($NoBrowser) {
        Write-Log "Browser launch skipped (-NoBrowser)"
    } else {
        Write-Log "Opening browser: $arclumeUrl"
        try {
            Start-Process -FilePath $arclumeUrl | Out-Null
            Write-Log "Browser launched"
        } catch {
            Write-WarnLog "Failed to open browser: $($_.Exception.Message)"
            Write-Host "Could not open the browser automatically. Navigate to: $arclumeUrl"
        }
    }

    # ---------------------------------------------------------
    # Keep launcher alive while the owned server runs
    # ---------------------------------------------------------
    Write-Log "Launcher waiting for Ctrl+C or server exit..."
    while (-not $script:OwnedProcess.HasExited) {
        Start-Sleep -Milliseconds 500
    }
    Write-Log "Server process exited"
    Stop-OwnedServer
    Write-Log "Launcher exiting normally"
    exit 0
}
catch {
    Write-ErrorLog "Unhandled exception: $($_.Exception.Message)"
    Write-Log "Stack trace: $($_.ScriptStackTrace)"
    Write-OwnedDiagnostics
    Stop-OwnedServer
    Write-Host ""
    Write-Host "ARCLUME could not start."
    Write-Host "See: $LogFile"
    exit 1
}
finally {
    if ($script:OwnedProcess -ne $null -and (-not $script:OwnedProcess.HasExited)) {
        Stop-OwnedServer
    }
}
