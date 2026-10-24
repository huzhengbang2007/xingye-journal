@echo off
powershell.exe -NoProfile -STA -WindowStyle Hidden -ExecutionPolicy Bypass -File "%~dp0setup-wizard.ps1"
exit /b %errorlevel%
