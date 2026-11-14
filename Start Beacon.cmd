@echo off
cd /d "%~dp0"
echo Beacon will be available at http://localhost:5173/apps/headset/
echo Keep this window open while using the demo. Press Ctrl+C to stop.
call npm run dev
pause
