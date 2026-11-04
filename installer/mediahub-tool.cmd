@echo off
rem Break-glass tools for MediaHub: create-user, reset-plex-admin, migrate.
rem Usage: mediahub-tool.cmd <create-user|reset-plex-admin|migrate> [args...]
rem Run from an ELEVATED Command Prompt: the config folder is locked to Administrators and the MediaHub service.
setlocal
set "TOOL=%~1"
if /i "%TOOL%"=="create-user" goto run
if /i "%TOOL%"=="reset-plex-admin" goto run
if /i "%TOOL%"=="migrate" goto run
echo Usage: mediahub-tool.cmd ^<create-user^|reset-plex-admin^|migrate^> [args...]
exit /b 2
:run
"%~dp0node.exe" --env-file="%ProgramData%\MediaHub\mediahub.env" "%~dp0app\tools\%TOOL%.mjs" %2 %3 %4 %5 %6 %7 %8 %9
