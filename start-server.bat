@echo off
title HongGoCat Server
cd /d "%~dp0"
echo(
echo   ======================================================
echo   HongGoCat multiplayer server  (port 8787)
echo   Same-WiFi friends connect to:  ws://172.30.16.175:8787
echo   (if that IP changed, run  ipconfig  to find IPv4)
echo   Keep this window OPEN while playing.
echo   ======================================================
echo(
call npm run server
echo(
echo   Server stopped. You can close this window.
pause
