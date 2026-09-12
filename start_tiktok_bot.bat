@echo off
chcp 65001 > nul
title TikTok SparkFlow VN - Tự Động Giữ Chuỗi Lửa

cd /d "%~dp0DouYinSparkFlow"

echo ========================================================
echo        KHOI DONG TIKTOK SPARKFLOW VIET NAM
echo ========================================================
echo.
echo [1] Dang kiem tra Python...
python --version > nul 2>&1
if %errorlevel% neq 0 (
    echo [LOI] Khong tim thay Python! Vui long cai dat Python 3.9+ vao may.
    pause
    exit /b 1
)

set "PY_EXE=C:\Users\Admin\AppData\Local\Programs\Python\Python312\python.exe"
if not exist "%PY_EXE%" set "PY_EXE=python"

echo [2] Dang khoi dong Web Server tai http://localhost:8787 ...
start "" http://localhost:8787

"%PY_EXE%" -m tiktok_app.tiktok_server

pause

