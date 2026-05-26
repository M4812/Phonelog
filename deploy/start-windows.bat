@echo off
setlocal

cd /d "%~dp0"

if "%PORT%"=="" set "PORT=3000"

if not exist "%~dp0runtime\node.exe" (
  echo Missing runtime\node.exe
  echo Please use the complete portable package.
  pause
  exit /b 1
)

if not exist "%~dp0data" mkdir "%~dp0data"
if not exist "%~dp0data\records.json" echo []>"%~dp0data\records.json"

echo Starting Phone Record App...
echo Port: %PORT%
echo Data file: %~dp0data\records.json
echo.
echo Open this server:
echo   http://localhost:%PORT%
echo.
echo Other computers should open:
echo   http://THIS_SERVER_IP:%PORT%
echo.
echo If other computers cannot open it, run allow-firewall-port-3000-admin.bat as Administrator.
echo Press Ctrl+C to stop the server.
echo.

"%~dp0runtime\node.exe" "%~dp0server.js"

echo.
echo Server stopped.
pause
