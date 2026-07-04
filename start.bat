@echo off
title MyBidBook Pro - Estimator Server
echo ==================================================
echo  Starting MyBidBook Pro Estimator Server...
echo ==================================================
echo.

node server.js
if %errorlevel% neq 0 (
  echo.
  echo [ERROR] Node.js is not detected on your system.
  echo To run this application locally, please install Node.js.
  echo Download from: https://nodejs.org/
  echo.
  pause
)
