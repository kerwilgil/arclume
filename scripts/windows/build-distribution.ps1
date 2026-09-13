<#
.SYNOPSIS
    Builds the professional ARCLUME Windows distribution: ARCLUME.exe, a
    portable ZIP, an Inno Setup installer and SHA256SUMS.txt.

.DESCRIPTION
    Reproducible pipeline:

        clean staging
        npm ci
        npm run build
        npm pack
        stage the real npm package with production dependencies only
        fetch + checksum-verify the pinned Node runtime
        install Chromium into the bundled browsers directory
        build the native Go launcher
        assemble the portable layout
        validate the portable layout (smoke, CLI, HTML/PDF/PPTX exports)
        zip the portable layout
        compile the Inno Setup installer
        write SHA256SUMS.txt

    Nothing is published. The version always comes from package.json.

    Compatibility: Windows PowerShell 5.1 (powershell.exe).

.PARAMETER SkipNpmCi
    Reuse the existing node_modules instead of running npm ci.

.PARAMETER SkipInstaller
    Build only the portable distribution (no Inno Setup step).

.PARAMETER SkipValidation
    Assemble artifacts without running the portable validation suite.
    Intended only for fast iteration; never for a release candidate.

.NOTES
    Output lands in artifacts\windows\ which is ignored by Git.
#>

[CmdletBinding()]
param(
    [switch]$SkipNpmCi,
    [switch]$SkipInstaller,
    [switch]$SkipValidation
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$RepoRoot = (Resolve-Path (Join-Path $ScriptDir "..\..")).Path

# ---------------------------------------------------------
# Pinned bundled Node runtime.
#
# Exact version, official URL and official SHA256 from
# https://nodejs.org/dist/v24.20.0/SHASUMS256.txt. The build refuses to use a
# runtime whose checksum does not match. Never "latest".
# ---------------------------------------------------------
$NodeVersion = "24.20.0"
$NodeArchive = "node-v$NodeVersion-win-x64.zip"
$NodeUrl = "https://nodejs.org/dist/v$NodeVersion/$NodeArchive"
$NodeSha256 = "6cac9ffbca8f6a47091e4b5c772e0606049c3871cb67d900c0cedde630e545ba"

# Pinned resource compiler used to stamp the icon and version metadata onto
# ARCLUME.exe. Best effort: if it cannot be fetched the build continues and
# says so, because the installer and shortcuts carry the icon regardless.
$GoVersionInfoPackage = "github.com/josephspurrier/goversioninfo/cmd/goversioninfo@v1.5.0"

$ArtifactsDir = Join-Path $RepoRoot "artifacts\windows"
$StageDir = Join-Path $ArtifactsDir "stage"
$PortableRoot = Join-Path $StageDir "ARCLUME"
$CacheDir = Join-Path $ArtifactsDir "cache"
$BuildLog = Join-Path $ArtifactsDir "build-distribution.log"

function Write-Step {
    param([string]$Message)
    $line = "==> $Message"
    Write-Host ""
    Write-Host $line -ForegroundColor Cyan
    Add-Log $line
}

function Write-Info {
    param([string]$Message)
    Write-Host "    $Message"
    Add-Log "    $Message"
}

function Write-Warn {
    param([string]$Message)
    Write-Host "    WARNING: $Message" -ForegroundColor Yellow
    Add-Log "    WARNING: $Message"
}

function Add-Log {
    param([string]$Message)
    if (-not (Test-Path -LiteralPath $ArtifactsDir)) { return }
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    try {
        Add-Content -LiteralPath $BuildLog -Value "[$timestamp] $Message" -ErrorAction SilentlyContinue
    } catch { }
}

function Stop-Build {
    param([string]$Message)
    Write-Host ""
    Write-Host "BUILD FAILED: $Message" -ForegroundColor Red
    Add-Log "BUILD FAILED: $Message"
    exit 1
}

<#
    Runs a command, streaming output to the console, and stops the build if it
    fails. Arguments are passed as an array so paths with spaces survive.
#>
function Invoke-Checked {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [string[]]$Arguments = @(),
        [string]$WorkingDirectory = $RepoRoot,
        [hashtable]$Environment = @{},
        [string]$Label
    )

    if (-not $Label) { $Label = (Split-Path -Leaf $FilePath) + " " + ($Arguments -join " ") }
    Write-Info "run: $Label"

    $saved = @{}
    foreach ($key in $Environment.Keys) {
        $saved[$key] = [Environment]::GetEnvironmentVariable($key, "Process")
        [Environment]::SetEnvironmentVariable($key, $Environment[$key], "Process")
    }

    $previous = Get-Location
    try {
        Set-Location -LiteralPath $WorkingDirectory
        & $FilePath @Arguments
        $code = $LASTEXITCODE
    } finally {
        Set-Location $previous
        foreach ($key in $saved.Keys) {
            [Environment]::SetEnvironmentVariable($key, $saved[$key], "Process")
        }
    }

    if ($code -ne 0) {
        Stop-Build "$Label exited with code $code"
    }
}

function Get-CommandPath {
    param([string]$Name)
    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if ($command -eq $null) { return $null }
    return $command.Source
}

function Get-PackageVersion {
    $packageJson = Get-Content -LiteralPath (Join-Path $RepoRoot "package.json") -Raw | ConvertFrom-Json
    return $packageJson.version
}

# =========================================================
# 0. Preflight
# =========================================================
if (-not (Test-Path -LiteralPath $ArtifactsDir)) {
    New-Item -ItemType Directory -Path $ArtifactsDir -Force | Out-Null
}

Write-Step "ARCLUME Windows distribution build"
$Version = Get-PackageVersion
Write-Info "Version (from package.json): $Version"
Write-Info "Repo root: $RepoRoot"
Write-Info "Artifacts: $ArtifactsDir"

$npmPath = Get-CommandPath "npm"
if (-not $npmPath) { Stop-Build "npm not found in PATH" }
$nodePath = Get-CommandPath "node"
if (-not $nodePath) { Stop-Build "node not found in PATH" }
$goPath = Get-CommandPath "go"
if (-not $goPath) { Stop-Build "go not found in PATH (required to build the native launcher)" }

Write-Info "npm:  $npmPath"
Write-Info "node: $nodePath"
Write-Info "go:   $(& $goPath version)"

# =========================================================
# 1. Clean staging
# =========================================================
Write-Step "Cleaning staging directory"
if (Test-Path -LiteralPath $StageDir) {
    Remove-Item -LiteralPath $StageDir -Recurse -Force
}
New-Item -ItemType Directory -Path $PortableRoot -Force | Out-Null
New-Item -ItemType Directory -Path $CacheDir -Force | Out-Null
Write-Info "Staging: $PortableRoot"

# =========================================================
# 2. Build the application
# =========================================================
if ($SkipNpmCi) {
    Write-Step "Skipping npm ci (--SkipNpmCi)"
} else {
    Write-Step "npm ci"
    Invoke-Checked -FilePath $npmPath -Arguments @("ci") -Label "npm ci"
}

Write-Step "npm run build"
Invoke-Checked -FilePath $npmPath -Arguments @("run", "build") -Label "npm run build"

# =========================================================
# 3. npm pack - the distribution ships the real published package
# =========================================================
Write-Step "npm pack"
$packDir = Join-Path $ArtifactsDir "pack"
if (Test-Path -LiteralPath $packDir) { Remove-Item -LiteralPath $packDir -Recurse -Force }
New-Item -ItemType Directory -Path $packDir -Force | Out-Null

Invoke-Checked -FilePath $npmPath -Arguments @("pack", "--pack-destination", $packDir) -Label "npm pack"

$tarball = Get-ChildItem -LiteralPath $packDir -Filter "*.tgz" | Select-Object -First 1
if ($tarball -eq $null) { Stop-Build "npm pack produced no tarball" }
Write-Info "Tarball: $($tarball.Name) ($([math]::Round($tarball.Length / 1MB, 2)) MB)"

# =========================================================
# 4. Stage the application with production dependencies only
# =========================================================
Write-Step "Staging application (production dependencies only)"
$appDir = Join-Path $PortableRoot "app"
New-Item -ItemType Directory -Path $appDir -Force | Out-Null

$stagePackageJson = @{
    name        = "arclume-windows-distribution"
    version     = "0.0.0"
    private     = $true
    description = "Staging project that installs the real ARCLUME npm package for the Windows distribution."
} | ConvertTo-Json
Set-Content -LiteralPath (Join-Path $appDir "package.json") -Value $stagePackageJson -Encoding ASCII

# --omit=dev keeps devDependencies out. --ignore-scripts keeps Playwright from
# downloading browsers into the machine-wide cache; Chromium is installed
# explicitly into the bundled browsers directory in the next step.
Invoke-Checked `
    -FilePath $npmPath `
    -Arguments @("install", $tarball.FullName, "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel", "error") `
    -WorkingDirectory $appDir `
    -Label "npm install <tarball> --omit=dev"

$stagedCli = Join-Path $appDir "node_modules\arclume\dist\cli\index.js"
if (-not (Test-Path -LiteralPath $stagedCli)) {
    Stop-Build "staged application is missing dist\cli\index.js"
}
Write-Info "Staged CLI: $stagedCli"

# Staging leftovers that are meaningless inside a distribution.
foreach ($leftover in @("package-lock.json", "node_modules\.package-lock.json")) {
    $path = Join-Path $appDir $leftover
    if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force }
}

# =========================================================
# 5. Bundled Chromium
# =========================================================
Write-Step "Installing Chromium into the bundled browsers directory"
$browsersDir = Join-Path $PortableRoot "browsers"
$browsersCache = Join-Path $CacheDir "browsers"
New-Item -ItemType Directory -Path $browsersCache -Force | Out-Null

$playwrightCli = Join-Path $appDir "node_modules\playwright\cli.js"
if (-not (Test-Path -LiteralPath $playwrightCli)) {
    Stop-Build "staged application is missing node_modules\playwright\cli.js"
}

# Installed into a build cache first: Playwright is idempotent there, so a
# rebuild does not re-download several hundred megabytes. The distribution
# always gets a fresh copy of the cache contents.
Invoke-Checked `
    -FilePath $nodePath `
    -Arguments @($playwrightCli, "install", "chromium") `
    -WorkingDirectory $appDir `
    -Environment @{ PLAYWRIGHT_BROWSERS_PATH = $browsersCache } `
    -Label "playwright install chromium (bundled)"

Write-Info "Copying the bundled browser into the distribution"
Copy-Item -LiteralPath $browsersCache -Destination $browsersDir -Recurse -Force

$chromiumDirs = @(Get-ChildItem -LiteralPath $browsersDir -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -like "chromium*" })
if ($chromiumDirs.Count -eq 0) {
    Stop-Build "Chromium was not installed into $browsersDir"
}
Write-Info "Chromium: $($chromiumDirs[0].Name)"

# =========================================================
# 6. Pinned Node runtime
# =========================================================
Write-Step "Fetching the pinned Node runtime (v$NodeVersion)"
$runtimeDir = Join-Path $PortableRoot "runtime"
New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null

$archivePath = Join-Path $CacheDir $NodeArchive
if (-not (Test-Path -LiteralPath $archivePath)) {
    Write-Info "Downloading $NodeUrl"
    Invoke-WebRequest -Uri $NodeUrl -OutFile $archivePath -UseBasicParsing
} else {
    Write-Info "Using cached $NodeArchive"
}

$actualSha = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualSha -ne $NodeSha256.ToLowerInvariant()) {
    Remove-Item -LiteralPath $archivePath -Force
    Stop-Build "Node runtime checksum mismatch. Expected $NodeSha256, got $actualSha. The download was discarded."
}
Write-Info "SHA256 verified: $actualSha"

$extractDir = Join-Path $CacheDir "node-v$NodeVersion"
if (Test-Path -LiteralPath $extractDir) { Remove-Item -LiteralPath $extractDir -Recurse -Force }
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::ExtractToDirectory($archivePath, $extractDir)

$sourceNode = Join-Path $extractDir "node-v$NodeVersion-win-x64\node.exe"
if (-not (Test-Path -LiteralPath $sourceNode)) {
    Stop-Build "node.exe not found inside $NodeArchive"
}
Copy-Item -LiteralPath $sourceNode -Destination (Join-Path $runtimeDir "node.exe") -Force
Write-Info "Bundled runtime: runtime\node.exe (Node v$NodeVersion)"

# The Node licence travels with the runtime.
$nodeLicense = Join-Path $extractDir "node-v$NodeVersion-win-x64\LICENSE"
$licensesDir = Join-Path $PortableRoot "licenses"
New-Item -ItemType Directory -Path $licensesDir -Force | Out-Null
if (Test-Path -LiteralPath $nodeLicense) {
    Copy-Item -LiteralPath $nodeLicense -Destination (Join-Path $licensesDir "NODEJS-LICENSE.txt") -Force
}

# =========================================================
# 7. Native launcher
# =========================================================
Write-Step "Building the native launcher (ARCLUME.exe)"
$launcherSrc = Join-Path $RepoRoot "tools\windows-launcher"
$iconPath = Join-Path $RepoRoot "docs\assets\brand\arclume.ico"
$sysoPath = Join-Path $launcherSrc "resource_windows.syso"

if (Test-Path -LiteralPath $sysoPath) { Remove-Item -LiteralPath $sysoPath -Force }

# Version metadata + official icon, derived from package.json.
$versionParts = $Version.Split(".")
while ($versionParts.Count -lt 3) { $versionParts += "0" }
$versionInfo = [ordered]@{
    FixedFileInfo  = [ordered]@{
        FileVersion    = [ordered]@{
            Major = [int]$versionParts[0]
            Minor = [int]$versionParts[1]
            Patch = [int]$versionParts[2]
            Build = 0
        }
        ProductVersion = [ordered]@{
            Major = [int]$versionParts[0]
            Minor = [int]$versionParts[1]
            Patch = [int]$versionParts[2]
            Build = 0
        }
        FileFlagsMask  = "3f"
        FileFlags      = "00"
        FileOS         = "040004"
        FileType       = "01"
        FileSubType    = "00"
    }
    StringFileInfo = [ordered]@{
        ProductName      = "ARCLUME"
        FileDescription  = "ARCLUME - Local Visual Narrative Workspace"
        InternalName     = "ARCLUME"
        OriginalFilename = "ARCLUME.exe"
        ProductVersion   = $Version
        FileVersion      = $Version
        CompanyName      = "Kerwil Gil"
        LegalCopyright   = "MIT License"
    }
    VarFileInfo    = [ordered]@{
        Translation = [ordered]@{
            LangID    = "0409"
            CharsetID = "04B0"
        }
    }
    IconPath       = $iconPath
}
$versionInfoPath = Join-Path $launcherSrc "versioninfo.json"
Set-Content -LiteralPath $versionInfoPath -Value ($versionInfo | ConvertTo-Json -Depth 6) -Encoding ASCII

$resourceStamped = $false
try {
    Write-Info "run: go run $GoVersionInfoPackage"
    $previous = Get-Location
    Set-Location -LiteralPath $launcherSrc
    & $goPath run $GoVersionInfoPackage -64 -o resource_windows.syso versioninfo.json
    $rcCode = $LASTEXITCODE
    Set-Location $previous
    if ($rcCode -eq 0 -and (Test-Path -LiteralPath $sysoPath)) {
        $resourceStamped = $true
        Write-Info "Icon and version metadata stamped onto ARCLUME.exe"
    } else {
        Write-Warn "goversioninfo exited with code $rcCode; building ARCLUME.exe without embedded icon/version metadata"
    }
} catch {
    Write-Warn "goversioninfo unavailable ($($_.Exception.Message)); building ARCLUME.exe without embedded icon/version metadata"
}

$launcherExe = Join-Path $PortableRoot "ARCLUME.exe"
Invoke-Checked `
    -FilePath $goPath `
    -Arguments @("build", "-trimpath", "-ldflags", "-s -w -X main.version=$Version -H=windowsgui", "-o", $launcherExe, ".") `
    -WorkingDirectory $launcherSrc `
    -Environment @{ GOOS = "windows"; GOARCH = "amd64"; CGO_ENABLED = "0" } `
    -Label "go build ARCLUME.exe"

if (Test-Path -LiteralPath $sysoPath) { Remove-Item -LiteralPath $sysoPath -Force }
if (Test-Path -LiteralPath $versionInfoPath) { Remove-Item -LiteralPath $versionInfoPath -Force }

if (-not (Test-Path -LiteralPath $launcherExe)) { Stop-Build "ARCLUME.exe was not produced" }
Write-Info "ARCLUME.exe: $([math]::Round((Get-Item -LiteralPath $launcherExe).Length / 1MB, 2)) MB (resources stamped: $resourceStamped)"

# =========================================================
# 8. Licences, icon and README
# =========================================================
Write-Step "Assembling licences and documentation"
Copy-Item -LiteralPath (Join-Path $RepoRoot "LICENSE") -Destination (Join-Path $licensesDir "ARCLUME-LICENSE.txt") -Force
Copy-Item -LiteralPath (Join-Path $RepoRoot "THIRD_PARTY_NOTICES.md") -Destination (Join-Path $licensesDir "THIRD_PARTY_NOTICES.md") -Force

$playwrightNotice = Join-Path $appDir "node_modules\playwright-core\ThirdPartyNotices.txt"
if (Test-Path -LiteralPath $playwrightNotice) {
    Copy-Item -LiteralPath $playwrightNotice -Destination (Join-Path $licensesDir "PLAYWRIGHT-THIRD-PARTY-NOTICES.txt") -Force
}
$playwrightLicense = Join-Path $appDir "node_modules\playwright-core\LICENSE"
if (Test-Path -LiteralPath $playwrightLicense) {
    Copy-Item -LiteralPath $playwrightLicense -Destination (Join-Path $licensesDir "PLAYWRIGHT-LICENSE.txt") -Force
}

# ARCLUME.exe statically links the Go standard library (BSD-3-Clause).
$goRoot = (& $goPath env GOROOT)
if ($goRoot -and (Test-Path -LiteralPath (Join-Path $goRoot "LICENSE"))) {
    Copy-Item -LiteralPath (Join-Path $goRoot "LICENSE") -Destination (Join-Path $licensesDir "GO-LICENSE.txt") -Force
} else {
    Write-Warn "Go LICENSE not found under GOROOT; licenses\GO-LICENSE.txt will be missing"
}

Copy-Item -LiteralPath $iconPath -Destination (Join-Path $PortableRoot "arclume.ico") -Force

$readmeText = @"
ARCLUME $Version - Local Visual Narrative Workspace
==================================================

Double-click ARCLUME.exe. Your default browser opens on a local address
(http://127.0.0.1:<port>) served only to this machine.

Closing the ARCLUME window stops the local server.

This distribution is self-contained. It does NOT require Node.js, npm,
PowerShell 7, Playwright or Chromium to be installed on this machine:

  runtime\   the pinned Node.js runtime ARCLUME runs on
  app\       the ARCLUME application, exactly as published to npm
  browsers\  the Chromium build used for PDF export
  licenses\  ARCLUME and third-party licences and notices

Logs:  %LOCALAPPDATA%\ARCLUME\logs\arclume-launcher.log

Command line:
  ARCLUME.exe --no-browser   start without opening a browser
  ARCLUME.exe --smoke-test   start, verify, stop, exit 0
  ARCLUME.exe --version      print the version

These binaries are not code-signed. Windows SmartScreen may warn the first
time you run them; that warning reflects the absence of an Authenticode
certificate, not a problem with the files.

ARCLUME is MIT licensed. See licenses\.
"@
Set-Content -LiteralPath (Join-Path $PortableRoot "README.txt") -Value $readmeText -Encoding ASCII

# =========================================================
# 9. Validate the portable layout
# =========================================================
if ($SkipValidation) {
    Write-Step "Skipping portable validation (--SkipValidation)"
} else {
    Write-Step "Validating the portable distribution"
    $verifyScript = Join-Path $ScriptDir "verify-distribution.ps1"
    & $verifyScript -PortableRoot $PortableRoot
    if ($LASTEXITCODE -ne 0) {
        Stop-Build "portable validation failed"
    }
}

# =========================================================
# 10. Portable ZIP
# =========================================================
Write-Step "Creating the portable ZIP"
$zipName = "ARCLUME-$Version-portable.zip"
$zipPath = Join-Path $ArtifactsDir $zipName
if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
[System.IO.Compression.ZipFile]::CreateFromDirectory(
    $PortableRoot,
    $zipPath,
    [System.IO.Compression.CompressionLevel]::Optimal,
    $true)
Write-Info "$zipName ($([math]::Round((Get-Item -LiteralPath $zipPath).Length / 1MB, 2)) MB)"

# =========================================================
# 11. Inno Setup installer
# =========================================================
$setupPath = $null
if ($SkipInstaller) {
    Write-Step "Skipping the installer (--SkipInstaller)"
} else {
    Write-Step "Compiling the Inno Setup installer"
    $iscc = Get-CommandPath "ISCC.exe"
    if (-not $iscc) {
        foreach ($candidate in @(
                "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
                "$env:ProgramFiles\Inno Setup 6\ISCC.exe",
                "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe")) {
            if ($candidate -and (Test-Path -LiteralPath $candidate)) { $iscc = $candidate; break }
        }
    }
    if (-not $iscc) {
        Stop-Build "ISCC.exe (Inno Setup 6) not found. Install Inno Setup 6 or re-run with -SkipInstaller."
    }
    Write-Info "ISCC: $iscc"

    $issPath = Join-Path $RepoRoot "installer\windows\arclume.iss"
    Invoke-Checked `
        -FilePath $iscc `
        -Arguments @(
        "/DArclumeVersion=$Version",
        "/DPortableRoot=$PortableRoot",
        "/DRepoRoot=$RepoRoot",
        "/O$ArtifactsDir",
        $issPath) `
        -Label "ISCC arclume.iss"

    $setupPath = Join-Path $ArtifactsDir "ARCLUME-Setup-$Version.exe"
    if (-not (Test-Path -LiteralPath $setupPath)) {
        Stop-Build "the installer was not produced at $setupPath"
    }
    Write-Info "ARCLUME-Setup-$Version.exe ($([math]::Round((Get-Item -LiteralPath $setupPath).Length / 1MB, 2)) MB)"
}

# =========================================================
# 12. SHA256SUMS
# =========================================================
Write-Step "Writing SHA256SUMS.txt"
$sumsPath = Join-Path $ArtifactsDir "SHA256SUMS.txt"
$lines = @()
$targets = @($zipPath)
if ($setupPath) { $targets += $setupPath }
foreach ($target in $targets) {
    $hash = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
    $lines += "$hash  $(Split-Path -Leaf $target)"
    Write-Info "$hash  $(Split-Path -Leaf $target)"
}
Set-Content -LiteralPath $sumsPath -Value $lines -Encoding ASCII

Write-Step "Distribution build complete"
Write-Info "Artifacts in: $ArtifactsDir"
Write-Host ""
exit 0
