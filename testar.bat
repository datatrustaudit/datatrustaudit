@echo off
REM ASCII puro: ver comentario no iniciar.bat.
setlocal
cd /d "%~dp0"
title DataTrust Audit - Ferramentas

if not exist ".venv\Scripts\python.exe" (
    echo.
    echo   Ambiente ainda nao preparado. Rode o iniciar.bat primeiro.
    echo.
    pause
    exit /b 1
)

".venv\Scripts\python.exe" "scripts\ferramentas.py"

echo.
pause
