@echo off
rem ARCLUME - Local Visual Narrative Workspace launcher
rem Usage: double-click this file to start ARCLUME Web UI

setlocal enabledelayedexpansion

rem Always operate from the script's directory (repo root)
cd /d "%~dp0"

rem ---------------------------------------------------------
rem Launch PowerShell handler
rem ---------------------------------------------------------

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "scripts\windows\start-arclume.ps1"

set "EXITCODE=%ERRORLEVEL%"

if not "%EXITCODE%"=="0" (
    echo.
    echo ARCLUME encountered an error.
    echo See the log shown above or check .tmp\windows\arclume-launcher.log
    echo.
    pause
)

exit /b %EXITCODE%