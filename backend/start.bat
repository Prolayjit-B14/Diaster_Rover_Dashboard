@echo off
echo =========================================================
echo   RescueBOT AI Inference Engine — Launcher
echo =========================================================
echo.

cd /d "%~dp0"

REM Check if Python is available
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python not found. Please install Python 3.10+
    pause
    exit /b 1
)

REM Install dependencies if not already installed
echo [1/3] Checking dependencies...
pip install -r requirements.txt --quiet --disable-pip-version-check

echo.
echo [2/3] Starting RescueBOT AI Server...
echo.
echo   REST API:  http://localhost:8000
echo   API Docs:  http://localhost:8000/docs
echo   WebSocket: ws://localhost:8000/ws
echo.
echo [3/3] Press Ctrl+C to stop the server.
echo.

REM Launch with synthetic demo by default
REM Change --synthetic to --stream http://ESP32_IP:81/stream for real hardware
python main.py --synthetic --port 8000

pause
