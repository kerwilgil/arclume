@echo off
rem install-arclume.cmd - ARCLUME local installation script
rem Run this once after cloning/downloading ARCLUME to set up the environment

setlocal enabledelayedexpansion

rem Always operate from the script's directory (repo root)
cd /d "%~dp0"

rem ---------------------------------------------------------
rem Launch PowerShell handler
rem ---------------------------------------------------------

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "scripts\windows\install-arclume.ps1"

set "EXITCODE=%ERRORLEVEL%"

if not "%EXITCODE%"=="0" (
    echo.
    echo ARCLUME installation encountered an error.
    echo See the log shown above or check .tmp\windows\install-arclume.log
    echo.
    pause
)

exit /b %EXITCODE%