<# 
.SYNOPSIS
    Creates a desktop shortcut for ARCLUME.cmd

.DESCRIPTION
    Creates ARCLUME.lnk on the user's desktop pointing to ARCLUME.cmd
    in the ARCLUME repository root. Uses the official ARCLUME.ico icon.

.NOTES
    This script is intentionally separate from install-arclume.cmd so it
    can be run manually or skipped. It does not run automatically in CI.
#>

param(
    [Parameter(Mandatory=$false)]
    [string]$TargetScript = "ARCLUME.cmd"
)

$ErrorActionPreference = "Stop"

# Resolve script directory (repo root)
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$RepoRoot = Resolve-Path (Join-Path $ScriptDir "..\..")

$TargetPath = Join-Path $RepoRoot $TargetScript
if (-not (Test-Path $TargetPath)) {
    Write-Error "Target script not found: $TargetPath"
    exit 1
}

# Icon path (official ARCLUME.ico from brand assets)
$IconPath = Join-Path $RepoRoot "docs\assets\brand\arclume.ico"
if (-not (Test-Path $IconPath)) {
    Write-Warning "Icon not found at $IconPath, falling back to default"
    $IconPath = "cmd.exe"
}

# Desktop path
$Desktop = [Environment]::GetFolderPath("Desktop")
$ShortcutPath = Join-Path $Desktop "ARCLUME.lnk"

# Check if shortcut already exists
if (Test-Path $ShortcutPath) {
    Write-Host "Shortcut already exists at: $ShortcutPath"
    Write-Host "Remove it first if you want to recreate."
    exit 0
}

# Create shortcut using WScript.Shell COM object
$Shell = New-Object -ComObject WScript.Shell
$Shortcut = $Shell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = "cmd.exe"
$Shortcut.Arguments = "/c `"$TargetPath`""
$Shortcut.WorkingDirectory = $RepoRoot.Path
$Shortcut.Description = "ARCLUME - Local Visual Narrative Workspace"
$Shortcut.WindowStyle = 1  # Normal window
$Shortcut.IconLocation = $IconPath

$Shortcut.Save()

Write-Host "Created desktop shortcut: $ShortcutPath"
Write-Host "Target: $TargetPath"
Write-Host "Working directory: $RepoRoot"
Write-Host "Icon: $IconPath"

exit 0