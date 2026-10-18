@echo off
rem ================================================================
rem  GOLDEN POS - let customers on MOBILE DATA order from the table QR
rem  (asks for administrator permission, then guides you step by step)
rem ================================================================
title Golden POS - Online ordering setup
net session >nul 2>&1
if %errorlevel% neq 0 (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
set SCRIPT=%~dp0deploy\windows\setup-online-ordering.ps1
if exist "C:\GoldenPOS\deploy\windows\setup-online-ordering.ps1" set SCRIPT=C:\GoldenPOS\deploy\windows\setup-online-ordering.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%"
