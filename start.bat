@echo off
setlocal
title VideoSave
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [VideoSave] Node.js not found. Please install Node.js first.
  pause
  exit /b 1
)

if not exist node_modules (
  echo [VideoSave] Installing dependencies, please wait...
  call npm install
  if errorlevel 1 (
    echo [VideoSave] Failed to install dependencies.
    pause
    exit /b 1
  )
)

echo [VideoSave] Starting... your browser will open automatically.
echo [VideoSave] Keep this window open while using the app. Close it to stop.
call npm start

echo.
echo [VideoSave] Stopped.
pause
