@echo off
rem Golden POS control panel - right-click > Run as administrator
setlocal
set TASK=GoldenPOS Server
set ROOT=%~dp0..\..
:menu
cls
echo ==========================================
echo   GOLDEN POS - CONTROL
echo ==========================================
echo   1. Is the POS running?
echo   2. Restart the POS (fixes most problems)
echo   3. Stop the POS
echo   4. Start the POS
echo   5. Make a backup now
echo   6. Open error logs (for technicians)
echo   7. Open the bill log (every printed bill)
echo   8. Leave full-screen
echo   0. Close this window
echo.
set /p c=Choose:
if "%c%"=="1" goto status
if "%c%"=="2" goto restart
if "%c%"=="3" goto stop
if "%c%"=="4" goto start
if "%c%"=="5" goto backup
if "%c%"=="6" start "" "%ROOT%\logs" & goto menu
if "%c%"=="7" start "" "%ROOT%\backend\data\print-log" & goto menu
if "%c%"=="8" call "%~dp0exit-kiosk.cmd" & goto menu
goto end
:status
schtasks /Query /TN "%TASK%" /V /FO LIST | findstr /I "Status Last"
for %%u in (http://127.0.0.1:3000/login http://127.0.0.1:3001/healthz http://127.0.0.1:9110/health http://127.0.0.1:3100/gateway-health) do (
  curl.exe -s -o NUL --noproxy "*" --max-time 5 -w "  %%{http_code}  %%u\n" %%u || echo   DOWN  %%u
)
echo   (200 = working)
pause & goto menu
:restart
schtasks /End /TN "%TASK%" >nul 2>&1
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*GoldenPOS*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
timeout /t 2 >nul
schtasks /Run /TN "%TASK%"
echo Restarting... give it ~20 seconds.
pause & goto menu
:stop
schtasks /End /TN "%TASK%"
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*GoldenPOS*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
pause & goto menu
:start
schtasks /Run /TN "%TASK%"
pause & goto menu
:backup
pushd "%ROOT%"
node backend\src\backup.js --now
popd
pause & goto menu
:end
endlocal
