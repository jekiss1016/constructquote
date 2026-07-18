@echo off
title MyBidBook Pro - Estimator Server
echo ==================================================
echo  Starting MyBidBook Pro Estimator Server...
echo ==================================================
echo.

cd /d "%~dp0"

if not exist "C:\Program Files\nodejs\node.exe" (
  echo.
  echo [ERROR] Node.js is not detected on your system at C:\Program Files\nodejs\node.exe
  echo To run this application locally, please install Node.js.
  echo Download from: https://nodejs.org/
  echo.
  pause
  exit /b
)

"C:\Program Files\nodejs\node.exe" server.js
