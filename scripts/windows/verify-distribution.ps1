<#
.SYNOPSIS
    Validates an assembled ARCLUME portable distribution.

.DESCRIPTION
    Clean-room checks against a portable layout, run with a sanitised PATH so
    the distribution cannot borrow a machine-wide Node.js, npm or Chromium:

        layout and brand assets present
        ARCLUME.exe --version matches package.json
        ARCLUME.exe --smoke-test  (start, HTTP 200, stop, exit 0)
        no orphaned bundled node.exe afterwards
        the listener binds 127.0.0.1 only
        CLI: --version, --help, analyze (stub), build HTML, validate
        exports: HTML, PDF and PPTX (proves bundled Chromium works)

    Exits 0 on success, 1 on the first failure.

    Compatibility: Windows PowerShell 5.1 (powershell.exe).

.PARAMETER PortableRoot
    Directory containing ARCLUME.exe.

.PARAMETER ExpectedVersion
    Version the distribution must report. Defaults to the repository
    package.json version when the script runs from a checkout.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$PortableRoot,
    [string]$ExpectedVersion
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$PortableRoot = (Resolve-Path -LiteralPath $PortableRoot).Path

$script:Failures = 0

function Write-Check {
    param([string]$Name)
    Write-Host "    [ ] $Name"
}

function Write-Pass {
    param([string]$Name, [string]$Detail = "")
    if ($Detail) {
        Write-Host "    [PASS] $Name - $Detail" -ForegroundColor Green
    } else {
        Write-Host "    [PASS] $Name" -ForegroundColor Green
    }
}

function Write-Fail {
    param([string]$Name, [string]$Detail = "")
    $script:Failures++
    Write-Host "    [FAIL] $Name" -ForegroundColor Red
    if ($Detail) { Write-Host "           $Detail" -ForegroundColor Red }
}

function Assert-True {
    param([bool]$Condition, [string]$Name, [string]$Detail = "")
    if ($Condition) { Write-Pass $Name } else { Write-Fail $Name $Detail }
}

<#
    Quotes discrete arguments into a Windows command line so paths with spaces
    survive intact.
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
    Reads a capture file that is still being written by a child process.
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

# A deliberately minimal PATH: no Node.js, no npm, no developer tooling. If the
# distribution needs anything from the machine it fails here.
$CleanPath = (Join-Path $env:SystemRoot "System32") + ";" + $env:SystemRoot + ";" + (Join-Path $env:SystemRoot "System32\Wbem")

function New-CleanRoomStartInfo {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [string[]]$Arguments = @(),
        [string]$WorkingDirectory = $PortableRoot
    )

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $FilePath
    if ($Arguments -and $Arguments.Count -gt 0) {
        $psi.Arguments = Format-CommandLine -Arguments $Arguments
    }
    $psi.WorkingDirectory = $WorkingDirectory
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.EnvironmentVariables["PATH"] = $CleanPath
    return $psi
}

<#
    Runs a command to completion under the clean-room PATH and returns its exit
    code plus both captured streams (kept separate).
#>
function Invoke-CleanRoom {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [string[]]$Arguments = @(),
        [string]$WorkingDirectory = $PortableRoot,
        [int]$TimeoutSeconds = 300
    )

    $psi = New-CleanRoomStartInfo -FilePath $FilePath -Arguments $Arguments -WorkingDirectory $WorkingDirectory
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $psi
    [void]$process.Start()

    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $exited = $process.WaitForExit($TimeoutSeconds * 1000)
    if (-not $exited) {
        try { $process.Kill() } catch { }
        [void]$process.WaitForExit(10000)
    }
    [void]$stdoutTask.Wait(10000)
    [void]$stderrTask.Wait(10000)

    $code = 1
    if ($exited) { $code = $process.ExitCode }

    return [pscustomobject]@{
        ExitCode = $code
        Stdout   = $stdoutTask.Result
        Stderr   = $stderrTask.Result
        TimedOut = (-not $exited)
    }
}

function Get-BundledNodeProcessCount {
    param([string]$NodeExe)
    $processes = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
            Where-Object { $_.ExecutablePath -and ($_.ExecutablePath -ieq $NodeExe) })
    return $processes.Count
}

Write-Host ""
Write-Host "ARCLUME portable distribution validation"
Write-Host "  Root: $PortableRoot"
Write-Host "  PATH: $CleanPath"
Write-Host ""

# ---------------------------------------------------------
# 1. Layout
# ---------------------------------------------------------
Write-Host "1. Layout"
$launcherExe = Join-Path $PortableRoot "ARCLUME.exe"
$bundledNode = Join-Path $PortableRoot "runtime\node.exe"
$appRoot = Join-Path $PortableRoot "app\node_modules\arclume"
$cliPath = Join-Path $appRoot "dist\cli\index.js"
$browsersDir = Join-Path $PortableRoot "browsers"

Assert-True (Test-Path -LiteralPath $launcherExe) "ARCLUME.exe present"
Assert-True (Test-Path -LiteralPath $bundledNode) "runtime\node.exe present"
Assert-True (Test-Path -LiteralPath $cliPath) "app\node_modules\arclume\dist\cli\index.js present"
Assert-True (Test-Path -LiteralPath $browsersDir) "browsers\ present"
Assert-True (Test-Path -LiteralPath (Join-Path $PortableRoot "licenses\ARCLUME-LICENSE.txt")) "licenses\ARCLUME-LICENSE.txt present"
Assert-True (Test-Path -LiteralPath (Join-Path $PortableRoot "licenses\THIRD_PARTY_NOTICES.md")) "licenses\THIRD_PARTY_NOTICES.md present"
Assert-True (Test-Path -LiteralPath (Join-Path $PortableRoot "README.txt")) "README.txt present"
foreach ($notice in @("NODEJS-LICENSE.txt", "PLAYWRIGHT-LICENSE.txt", "PLAYWRIGHT-THIRD-PARTY-NOTICES.txt", "GO-LICENSE.txt")) {
    Assert-True (Test-Path -LiteralPath (Join-Path $PortableRoot "licenses\$notice")) "licenses\$notice present"
}

$chromiumDirs = @(Get-ChildItem -LiteralPath $browsersDir -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -like "chromium*" })
Assert-True ($chromiumDirs.Count -gt 0) "bundled Chromium present" "no chromium* directory under browsers\"

# Source, tests and developer noise must never ship.
foreach ($forbidden in @("app\node_modules\arclume\src", "app\node_modules\arclume\tests", "app\node_modules\arclume\examples", ".git")) {
    $path = Join-Path $PortableRoot $forbidden
    Assert-True (-not (Test-Path -LiteralPath $path)) "distribution excludes $forbidden"
}

# ---------------------------------------------------------
# 2. Brand assets
# ---------------------------------------------------------
Write-Host ""
Write-Host "2. Brand assets"
$brandDir = Join-Path $appRoot "web\dist\brand"
foreach ($asset in @("favicon.svg", "favicon-32.png", "arclume-logo-horizontal.svg", "arclume-symbol.svg", "arclume.ico")) {
    Assert-True (Test-Path -LiteralPath (Join-Path $brandDir $asset)) "brand asset web\dist\brand\$asset"
}
Assert-True (Test-Path -LiteralPath (Join-Path $PortableRoot "arclume.ico")) "ARCLUME icon shipped at the distribution root"

if ($script:Failures -gt 0) {
    Write-Host ""
    Write-Host "Layout validation failed; skipping runtime checks." -ForegroundColor Red
    exit 1
}

# ---------------------------------------------------------
# 3. Version
# ---------------------------------------------------------
Write-Host ""
Write-Host "3. Version"
if (-not $ExpectedVersion) {
    $repoPackageJson = Join-Path (Split-Path -Parent (Split-Path -Parent $ScriptDir)) "package.json"
    if (Test-Path -LiteralPath $repoPackageJson) {
        $ExpectedVersion = (Get-Content -LiteralPath $repoPackageJson -Raw | ConvertFrom-Json).version
    }
}

$result = Invoke-CleanRoom -FilePath $launcherExe -Arguments @("--version") -TimeoutSeconds 60
if ($result.ExitCode -ne 0) {
    Write-Fail "ARCLUME.exe --version" "exit code $($result.ExitCode): $($result.Stderr)"
} else {
    $reported = $result.Stdout.Trim()
    if ($ExpectedVersion -and $reported -ne $ExpectedVersion) {
        Write-Fail "ARCLUME.exe --version" "reported '$reported', expected '$ExpectedVersion'"
    } else {
        Write-Pass "ARCLUME.exe --version" $reported
    }
}

# ---------------------------------------------------------
# 4. Launcher smoke test (clean room, no Node in PATH)
# ---------------------------------------------------------
Write-Host ""
Write-Host "4. Launcher smoke test"
$before = Get-BundledNodeProcessCount -NodeExe $bundledNode
$result = Invoke-CleanRoom -FilePath $launcherExe -Arguments @("--smoke-test") -TimeoutSeconds 240
if ($result.ExitCode -ne 0) {
    Write-Fail "ARCLUME.exe --smoke-test" "exit code $($result.ExitCode)`n$($result.Stdout)`n$($result.Stderr)"
} else {
    Write-Pass "ARCLUME.exe --smoke-test" "exit 0"
}
if ($result.Stdout -match 'smoke test PASS \((http://127\.0\.0\.1:\d+)\)') {
    Write-Pass "smoke test reported a loopback URL" $matches[1]
} else {
    Write-Fail "smoke test reported a loopback URL" $result.Stdout
}
Assert-True ($result.Stdout -notmatch 'Program Files\\nodejs') "smoke test did not use a machine-wide Node.js"

Start-Sleep -Seconds 1
$after = Get-BundledNodeProcessCount -NodeExe $bundledNode
Assert-True ($after -le $before) "no orphaned bundled node.exe after shutdown" "before=$before after=$after"

# ---------------------------------------------------------
# 5. Network binding
# ---------------------------------------------------------
Write-Host ""
Write-Host "5. Network binding"
$psi = New-CleanRoomStartInfo -FilePath $launcherExe -Arguments @("--no-browser")
$liveProcess = New-Object System.Diagnostics.Process
$liveProcess.StartInfo = $psi
[void]$liveProcess.Start()

# Both streams are pumped into owned temp files so this poll is time-bounded:
# a blocking ReadLine on a launcher that goes quiet would hang the validation.
$liveStdoutPath = Join-Path ([System.IO.Path]::GetTempPath()) ("arclume-verify-live-" + [System.Guid]::NewGuid().ToString("N") + ".log")
$liveStdoutStream = New-Object System.IO.FileStream(
    $liveStdoutPath,
    [System.IO.FileMode]::Create,
    [System.IO.FileAccess]::Write,
    [System.IO.FileShare]::ReadWrite,
    1,
    $false)
$liveStdoutTask = $liveProcess.StandardOutput.BaseStream.CopyToAsync($liveStdoutStream, 512)
$liveStderrTask = $liveProcess.StandardError.ReadToEndAsync()

$liveUrl = $null
$deadline = (Get-Date).AddSeconds(90)
try {
    while ((Get-Date) -lt $deadline -and -not $liveUrl) {
        $captured = Read-OwnedLog -Path $liveStdoutPath
        if ($captured -match 'Discovered URL:\s*(http://127\.0\.0\.1:\d+)') {
            $liveUrl = $matches[1]
            break
        }
        if ($liveProcess.HasExited) { break }
        Start-Sleep -Milliseconds 250
    }

    if (-not $liveUrl) {
        Write-Fail "live run reported a loopback URL" (Read-OwnedLog -Path $liveStdoutPath)
    } else {
        Write-Pass "live run reported a loopback URL" $liveUrl
        $port = [int]($liveUrl -replace '^.*:', '')

        $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
        if ($listeners.Count -eq 0) {
            Write-Fail "listener found on port $port" "no listening socket"
        } else {
            $addresses = @($listeners | ForEach-Object { $_.LocalAddress } | Sort-Object -Unique)
            $onlyLoopback = $true
            foreach ($address in $addresses) {
                if ($address -ne "127.0.0.1") { $onlyLoopback = $false }
            }
            Assert-True $onlyLoopback "listener binds 127.0.0.1 only" ("addresses: " + ($addresses -join ", "))
        }

        try {
            $response = Invoke-WebRequest -Uri $liveUrl -UseBasicParsing -TimeoutSec 10
            Assert-True ($response.StatusCode -eq 200) "live run answers HTTP 200"
            Assert-True ($response.Content -match 'arclume') "served page carries ARCLUME branding"
        } catch {
            Write-Fail "live run answers HTTP 200" $_.Exception.Message
        }
    }
} finally {
    try {
        if (-not $liveProcess.HasExited) { $liveProcess.Kill() }
        [void]$liveProcess.WaitForExit(15000)
    } catch { }
    try { [void]$liveStdoutTask.Wait(2000) } catch { }
    try { [void]$liveStderrTask.Wait(2000) } catch { }
    try { $liveStdoutStream.Dispose() } catch { }
    try { Remove-Item -LiteralPath $liveStdoutPath -Force -ErrorAction SilentlyContinue } catch { }
}

Start-Sleep -Seconds 1
$after = Get-BundledNodeProcessCount -NodeExe $bundledNode
Assert-True ($after -le $before) "killing the launcher takes the bundled node.exe with it" "before=$before after=$after"

# ---------------------------------------------------------
# 6. CLI smoke from the distribution
# ---------------------------------------------------------
Write-Host ""
Write-Host "6. CLI smoke (bundled runtime)"
$work = Join-Path ([System.IO.Path]::GetTempPath()) ("arclume-verify-" + [System.Guid]::NewGuid().ToString("N"))
# Deliberately a path with a space: nothing here may assume otherwise.
$work = $work + " space"
New-Item -ItemType Directory -Path $work -Force | Out-Null

try {
    $result = Invoke-CleanRoom -FilePath $bundledNode -Arguments @($cliPath, "--version") -WorkingDirectory $work -TimeoutSeconds 120
    Assert-True ($result.ExitCode -eq 0 -and $result.Stdout.Trim() -match '^\d+\.\d+\.\d+$') "arclume --version" $result.Stderr

    $result = Invoke-CleanRoom -FilePath $bundledNode -Arguments @($cliPath, "--help") -WorkingDirectory $work -TimeoutSeconds 120
    Assert-True ($result.ExitCode -eq 0 -and $result.Stdout -match 'arclume analyze') "arclume --help" $result.Stderr

    # A synthetic project: the validation must not depend on the repo checkout.
    $project = Join-Path $work "sample project"
    New-Item -ItemType Directory -Path $project -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $project "README.md") -Encoding ASCII -Value @"
# Sample Project

A small project used to validate the ARCLUME Windows distribution.

## Status

- Packaging validated
- Exports validated
"@
    Set-Content -LiteralPath (Join-Path $project "package.json") -Encoding ASCII -Value '{"name":"sample-project"}'

    $result = Invoke-CleanRoom -FilePath $bundledNode -Arguments @($cliPath, "analyze", $project, "--reasoner", "stub", "--out", "knowledge.json") -WorkingDirectory $work -TimeoutSeconds 300
    Assert-True ($result.ExitCode -eq 0 -and (Test-Path -LiteralPath (Join-Path $work "knowledge.json"))) "arclume analyze (stub)" $result.Stderr

    # ---------------------------------------------------------
    # 7. Exports: HTML, PDF, PPTX
    # ---------------------------------------------------------
    Write-Host ""
    Write-Host "7. Exports"

    $result = Invoke-CleanRoom -FilePath $bundledNode -Arguments @($cliPath, "build", "knowledge.json", "--format", "html", "--out", "html-out") -WorkingDirectory $work -TimeoutSeconds 300
    Assert-True ($result.ExitCode -eq 0 -and (Test-Path -LiteralPath (Join-Path $work "html-out\deck.html"))) "build HTML" $result.Stderr

    $browsersEnvNote = "PLAYWRIGHT_BROWSERS_PATH=$browsersDir"
    $pdfPsi = New-CleanRoomStartInfo -FilePath $bundledNode -Arguments @($cliPath, "build", "knowledge.json", "--format", "pdf", "--out", "pdf-out") -WorkingDirectory $work
    $pdfPsi.EnvironmentVariables["PLAYWRIGHT_BROWSERS_PATH"] = $browsersDir
    $pdfProcess = New-Object System.Diagnostics.Process
    $pdfProcess.StartInfo = $pdfPsi
    [void]$pdfProcess.Start()
    $pdfOut = $pdfProcess.StandardOutput.ReadToEndAsync()
    $pdfErr = $pdfProcess.StandardError.ReadToEndAsync()
    [void]$pdfProcess.WaitForExit(600000)
    [void]$pdfOut.Wait(10000)
    [void]$pdfErr.Wait(10000)
    $pdfBundle = Join-Path $work "pdf-out\deck.pdf-export\deck.pdf"
    Assert-True ($pdfProcess.ExitCode -eq 0 -and (Test-Path -LiteralPath $pdfBundle)) "build PDF (bundled Chromium) - $browsersEnvNote" $pdfErr.Result

    $result = Invoke-CleanRoom -FilePath $bundledNode -Arguments @($cliPath, "build", "knowledge.json", "--format", "pptx", "--out", "pptx-out") -WorkingDirectory $work -TimeoutSeconds 600
    $pptxBundle = Join-Path $work "pptx-out\deck.pptx-export"
    Assert-True ($result.ExitCode -eq 0 -and (Test-Path -LiteralPath (Join-Path $pptxBundle "deck.pptx"))) "build PPTX" $result.Stderr

    if (Test-Path -LiteralPath $pptxBundle) {
        $result = Invoke-CleanRoom -FilePath $bundledNode -Arguments @($cliPath, "validate", $pptxBundle) -WorkingDirectory $work -TimeoutSeconds 300
        Assert-True ($result.ExitCode -eq 0 -and $result.Stdout -match 'VALID') "arclume validate (PPTX bundle)" $result.Stderr
    }
} finally {
    try { Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue } catch { }
}

Write-Host ""
if ($script:Failures -gt 0) {
    Write-Host "Distribution validation FAILED ($($script:Failures) check(s))." -ForegroundColor Red
    exit 1
}
Write-Host "Distribution validation PASS." -ForegroundColor Green
exit 0
