@echo off
rem ============================================================
rem  GOLDEN POS - double-click to open the POS.
rem  Starts it if needed, then opens it. Nothing else to do.
rem ============================================================
start "" powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%~dp0deploy\windows\open-pos.ps1"
exit /b
