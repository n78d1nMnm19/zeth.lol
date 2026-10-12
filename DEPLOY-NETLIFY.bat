@echo off
cd /d "%~dp0"
echo.
echo === Deploy slits.lol with Functions (fixes badges 404) ===
echo Drag-and-drop ZIP cannot deploy the API. This CLI deploy can.
echo.
echo You may need to log in once in the browser.
echo.
call npx --yes netlify-cli login
call npx --yes netlify-cli link
call npx --yes netlify-cli env:set BADGE_API_SECRET "mdhgl1rx2z5ks8f094eqjt7yoiauvncw"
call npx --yes netlify-cli deploy --prod --build
echo.
echo Done. Test: https://slits.lol/api/health
pause
