@echo off
REM ============================================================
REM  install.bat — RescueBOT AI Server Installer (Windows)
REM ============================================================
REM  Usage: Double-click or run from Command Prompt
REM  This script installs all dependencies and sets up the env.

TITLE RescueBOT AI Server — Windows Installer

echo.
echo  ============================================================
echo    RescueBOT AI Server — Windows Installer
echo  ============================================================
echo.

REM ── Check Python ─────────────────────────────────────────────
python --version >nul 2>&1
IF %ERRORLEVEL% NEQ 0 (
    echo  [ERROR] Python not found in PATH.
    echo  Please install Python 3.9+ from https://www.python.org/downloads/
    echo  Make sure to check "Add Python to PATH" during installation.
    pause
    exit /b 1
)

echo  [OK] Python detected:
python --version
echo.

REM ── Upgrade pip ──────────────────────────────────────────────
echo  Upgrading pip...
python -m pip install --upgrade pip --quiet
IF %ERRORLEVEL% NEQ 0 (
    echo  [WARN] Could not upgrade pip. Continuing...
)

REM ── Install dependencies ──────────────────────────────────────
echo.
echo  Installing Python packages from requirements.txt...
echo  (This may take 5-10 minutes on first install)
echo.
python -m pip install -r requirements.txt
IF %ERRORLEVEL% NEQ 0 (
    echo.
    echo  [ERROR] Package installation failed.
    echo  Try: python -m pip install -r requirements.txt --verbose
    pause
    exit /b 1
)

echo.
echo  [OK] All Python packages installed!
echo.

REM ── Check for CUDA ────────────────────────────────────────────
echo  Checking for NVIDIA GPU / CUDA...
python -c "import torch; print('CUDA:', torch.cuda.is_available())" 2>nul
IF %ERRORLEVEL% NEQ 0 (
    echo  [INFO] PyTorch not yet installed. Run init_project.py for full setup.
)

REM ── Run full initialization ───────────────────────────────────
echo.
echo  Running full project initialization...
echo  (Downloads models, validates environment, runs benchmarks)
echo.
python init_project.py
IF %ERRORLEVEL% NEQ 0 (
    echo.
    echo  [WARN] Initialization had warnings. Check output above.
)

echo.
echo  ============================================================
echo    SETUP COMPLETE
echo  ============================================================
echo.
echo  To start the AI inference server:
echo    python inference_server.py
echo.
echo  To re-verify your setup:
echo    python verify_environment.py
echo.
echo  To re-download models:
echo    python download_models.py
echo.
pause
