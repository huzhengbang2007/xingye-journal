@echo off
setlocal
set "NODE_OPTIONS="
set "NODE_PATH="
cd /d "%~dp0"
if /i "%~1"=="--browser" goto browser
if exist "%~dp0xingye-desktop.exe" (
  start "" "%~dp0xingye-desktop.exe"
  exit /b 0
)
:browser
set "NODE_EXE=node"
if exist "%~dp0runtime\node.exe" (
  set "NODE_EXE=%~dp0runtime\node.exe"
  goto run
)
where node >nul 2>nul
:run
"%NODE_EXE%" --version >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 or newer is required. Install it from https://nodejs.org/
  pause
  exit /b 1
)
echo.
echo Xingye Journal - Local encrypted planner
echo Open http://127.0.0.1:3210 in your browser.
echo Keep this window open while using Xingye Journal.
echo.
"%NODE_EXE%" scripts\desktop-launcher.mjs
pause
