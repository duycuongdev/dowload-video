@echo off
setlocal
title VideoSave - Refresh Facebook cookies
cd /d "%~dp0"

set "PROFILE_DIR=%~dp0server\cookies\fb-profile"
set "COOKIE_SRC=%APPDATA%\ZCode\session\Partitions\zcode-embedded-browser\Network\Cookies"
set "LOCAL_STATE_SRC=%APPDATA%\ZCode\session\Local State"

if not exist "%COOKIE_SRC%" (
  echo [!] ZCode embedded browser cookie database not found.
  echo     Log into facebook.com inside the ZCode browser first.
  pause
  exit /b 1
)

if not exist "%PROFILE_DIR%\Network" mkdir "%PROFILE_DIR%\Network"
copy /y "%LOCAL_STATE_SRC%" "%PROFILE_DIR%\Local State" >nul

echo Copying cookie database... (accept the Windows admin prompt)
powershell -NoProfile -Command "Start-Process esentutl -Verb RunAs -Wait -ArgumentList '/y','%COOKIE_SRC%','/d','%PROFILE_DIR%\Network\Cookies','/vss'"

if exist "%PROFILE_DIR%\Network\Cookies" (
  echo.
  echo [OK] Facebook cookies updated. Restart VideoSave if it is running.
) else (
  echo.
  echo [!] Copy failed - did you accept the admin prompt?
)
pause
