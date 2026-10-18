@echo off
rem ================================================================
rem  GOLDEN POS - double-click to install or update this POS terminal
rem  (asks for administrator permission, then does everything itself)
rem ================================================================
title Golden POS - Install / Update
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Asking Windows for administrator permission...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
cd /d "%~dp0"
echo.
echo  Installing Golden POS. This takes 3-10 minutes the first time.
echo  Keep this window open until it says DONE.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy\windows\install.ps1"
if %errorlevel% neq 0 (
  echo.
  echo  Something went wrong - read the red message above.
  echo  Fix it, then double-click INSTALL-POS again. Your data is safe.
) else (
  echo.
  echo  DONE. Next: open the POS, log in as Admin, go to Settings - Printer management.
)
echo.
pause
