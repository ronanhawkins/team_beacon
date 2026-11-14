@echo off
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File tools\install-quest-native.ps1 -LaunchOnly
pause
