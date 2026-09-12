@echo off
chcp 65001 >nul
title Giữ Chuỗi TikTok VN
set PYTHONIOENCODING=utf-8
cd /d "%~dp0DouYinSparkFlow"

set "PY_EXE=C:\Users\Admin\AppData\Local\Programs\Python\Python312\python.exe"
if not exist "%PY_EXE%" set "PY_EXE=python"

echo ============================================================
echo        🚀 ĐANG KHỞI ĐỘNG GIỮ CHUỖI TIKTOK VN (2 ACC)
echo ============================================================
echo.
echo Giao diện quản lý: http://localhost:8787
echo Tự động gửi lúc: 05:00 sáng hàng ngày
echo.

start "" http://localhost:8787
"%PY_EXE%" -m tiktok_app.tiktok_server
pause

