@echo off
cd /d "%~dp0"
echo Starting local site API...
start "zeth-server" cmd /k "cd /d %~dp0bot && npm run server"
echo Starting Discord bot...
start "zeth-bot" cmd /k "cd /d %~dp0bot && npm run bot"
echo.
echo Opened 2 windows: server + bot
echo Site: http://localhost:8787
pause
