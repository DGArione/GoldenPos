@echo off
rem Leave the full-screen POS for maintenance. The POS server keeps running.
rem Re-open with the "Golden POS" desktop shortcut (or just restart the PC).
if not exist "%LOCALAPPDATA%\GoldenPOS" mkdir "%LOCALAPPDATA%\GoldenPOS"
echo stop> "%LOCALAPPDATA%\GoldenPOS\kiosk.stop"
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*GoldenPOS\kiosk-profile*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
echo Kiosk closed. POS server is still running at http://localhost:3000
timeout /t 3 >nul
