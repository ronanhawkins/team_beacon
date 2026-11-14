@echo off
cd /d "%~dp0"
echo Starting Beacon: hub and helmet share one local relay.
echo Open http://127.0.0.1:5174/hub/ and http://127.0.0.1:5174/headset/?helmet=1
echo Keep this window open during the demo.
call npm run demo
pause
