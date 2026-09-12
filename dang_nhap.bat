@echo off
chcp 65001 >nul
set PYTHONIOENCODING=utf-8
cd /d "%~dp0"
set "PY_EXE=C:\Users\Admin\AppData\Local\Programs\Python\Python312\python.exe"
if not exist "%PY_EXE%" set "PY_EXE=python"
"%PY_EXE%" dang_nhap.py
pause
