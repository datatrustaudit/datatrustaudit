@echo off
REM ASCII puro de proposito: o cmd le este arquivo com a codepage do
REM sistema, entao acento ou caractere de caixa aqui quebra o parsing.
REM Todo o trabalho fica em scripts/preparar.py.
setlocal enabledelayedexpansion
cd /d "%~dp0"
title DataTrust Audit

echo.
echo ============================================================
echo   DataTrust Audit
echo ============================================================
echo.

if exist ".venv\Scripts\python.exe" goto preparar

echo [0/4] Procurando Python...

REM O 3.14 fica de fora: varias dependencias ainda nao tem wheel
REM para ele, e a instalacao termina sem o Playwright.
set "PY="
py -3.13 --version >nul 2>&1
if !errorlevel! equ 0 set "PY=py -3.13"

if not defined PY (
    py -3.12 --version >nul 2>&1
    if !errorlevel! equ 0 set "PY=py -3.12"
)

if not defined PY (
    py -3.11 --version >nul 2>&1
    if !errorlevel! equ 0 set "PY=py -3.11"
)

if not defined PY (
    echo.
    echo   ERRO: Python 3.11, 3.12 ou 3.13 nao encontrado.
    echo   Instale o Python 3.13 em https://www.python.org/downloads/
    echo.
    pause
    exit /b 1
)

echo       Criando ambiente virtual com !PY! ...
!PY! -m venv .venv
if not exist ".venv\Scripts\python.exe" (
    echo.
    echo   ERRO: falha ao criar o ambiente virtual.
    echo.
    pause
    exit /b 1
)

:preparar
".venv\Scripts\python.exe" "scripts\preparar.py" %*

echo.
pause
