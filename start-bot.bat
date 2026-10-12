@echo off
cd /d "%~dp0bot"
echo Starting Discord bot only...
echo (Site API separately: npm run server)
echo.
call npm run bot
pause
