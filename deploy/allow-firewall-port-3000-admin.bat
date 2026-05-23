@echo off
setlocal

if "%PORT%"=="" set "PORT=3000"

net session >nul 2>nul
if not "%errorlevel%"=="0" (
  echo Please right-click this file and choose "Run as administrator".
  pause
  exit /b 1
)

netsh advfirewall firewall add rule name="Phone Record App TCP %PORT%" dir=in action=allow protocol=TCP localport=%PORT%

echo.
echo Firewall rule added for TCP port %PORT%.
pause
