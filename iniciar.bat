@echo off
title Flash Creator
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js nao encontrado. Instale a versao LTS em https://nodejs.org
  echo  e rode este arquivo de novo.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\electron" (
  echo Instalando dependencias ^(so na primeira vez^)...
  call npm install
  if errorlevel 1 (
    echo.
    echo  Falha ao instalar as dependencias. Veja o erro acima.
    pause
    exit /b 1
  )
)

echo Abrindo Flash Creator...
call npm start
