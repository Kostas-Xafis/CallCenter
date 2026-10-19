@echo off
rem Updates katalogos.html with the files in the "data" folder.
rem Double-click to run. Details: update.ps1 / ODHGIES (instructions) file.
setlocal
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0update.ps1" %*
set "EXITCODE=%ERRORLEVEL%"
echo.
pause
exit /b %EXITCODE%
