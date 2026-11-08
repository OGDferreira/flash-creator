@echo off
title Flash Creator - gerar executavel

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

:: ---- Remove lock antigo (pode ter travado o npm no empacotador anterior) ----
if exist "package-lock.json" del /q "package-lock.json"

:: ---- Nao assina nem baixa ferramenta de assinatura (evita o erro de symlink) ----
set CSC_IDENTITY_AUTO_DISCOVERY=false

if not exist "node_modules\electron-builder" (
  echo Instalando dependencias...
  call npm install
  if errorlevel 1 ( echo. & echo  Falha ao instalar. Veja o erro acima. & pause & exit /b 1 )
)

:: ---- Limpa saida anterior ----
if exist "dist" rmdir /s /q "dist"

echo.
echo Gerando o executavel... ^(a primeira vez baixa o Electron, pode demorar^)
call npm run dist
if errorlevel 1 ( echo. & echo  Falha ao gerar. Veja o erro acima. & pause & exit /b 1 )

if not exist "dist\win-unpacked\Flash Creator.exe" (
  echo.
  echo  O build terminou mas o Flash Creator.exe nao apareceu em dist\win-unpacked.
  echo  Tire um print desta janela inteira.
  echo.
  pause
  exit /b 1
)

echo.
echo Pronto! O app esta em:
echo   dist\win-unpacked\Flash Creator.exe
echo.
echo E uma pasta portatil - copie a pasta "win-unpacked" inteira
echo para onde quiser e abra o "Flash Creator.exe" dentro dela.
echo.
explorer "%~dp0dist\win-unpacked"
pause
