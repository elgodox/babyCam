@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "REPO_URL=https://github.com/elgodox/babyCam.git"
set "DEFAULT_BRANCH=main"
set "SCRIPT_DIR=%~dp0"
set "APP_DIR=%SCRIPT_DIR%"

cd /d "%APP_DIR%" || (
  echo [ERROR] No se pudo abrir el directorio de la app.
  exit /b 1
)

echo.
echo ==============================================
echo   BabyCam - Bootstrap Windows
echo ==============================================
echo.

call :ensure_tool git Git.Git
if errorlevel 1 exit /b 1

call :ensure_tool node OpenJS.NodeJS.LTS
if errorlevel 1 exit /b 1

call :ensure_tool npm OpenJS.NodeJS.LTS
if errorlevel 1 exit /b 1

if not exist ".git" (
  echo [ERROR] Este script debe ejecutarse dentro del repo de BabyCam.
  echo [INFO] Repo esperado: %REPO_URL%
  exit /b 1
)

echo.
echo [INFO] Actualizando codigo (%DEFAULT_BRANCH%)...
git fetch --all --prune
if errorlevel 1 (
  echo [ERROR] Fallo git fetch.
  exit /b 1
)

git checkout %DEFAULT_BRANCH%
if errorlevel 1 (
  echo [ERROR] No se pudo cambiar a la rama %DEFAULT_BRANCH%.
  exit /b 1
)

git pull --ff-only origin %DEFAULT_BRANCH%
if errorlevel 1 (
  echo [ERROR] No se pudo hacer fast-forward pull.
  echo [TIP] Revisa si hay cambios locales sin commit.
  exit /b 1
)

echo.
echo [INFO] Instalando dependencias...
call npm install
if errorlevel 1 (
  echo [ERROR] Fallo npm install.
  exit /b 1
)

echo.
echo [INFO] Iniciando BabyCam...
echo [INFO] Host: http://localhost:8787/host
echo [INFO] Viewer local: http://localhost:8787/watch
echo.
call npm start
exit /b %errorlevel%

:ensure_tool
set "TOOL=%~1"
set "WINGET_ID=%~2"

where %TOOL% >nul 2>nul
if not errorlevel 1 (
  echo [OK] %TOOL% detectado.
  goto :eof
)

echo [WARN] %TOOL% no esta instalado.
where winget >nul 2>nul
if errorlevel 1 (
  echo [ERROR] winget no disponible. Instala %TOOL% manualmente y vuelve a ejecutar.
  exit /b 1
)

echo [INFO] Instalando %TOOL% con winget (%WINGET_ID%)...
winget install -e --id %WINGET_ID% --accept-source-agreements --accept-package-agreements
if errorlevel 1 (
  echo [ERROR] No se pudo instalar %TOOL% con winget.
  exit /b 1
)

REM Refresh PATH for current session (common install locations)
set "PATH=%PATH%;C:\Program Files\Git\cmd;C:\Program Files\nodejs;%LocalAppData%\Programs\Git\cmd;%LocalAppData%\Programs\nodejs"

where %TOOL% >nul 2>nul
if errorlevel 1 (
  echo [ERROR] %TOOL% se instalo pero no quedo en PATH de esta sesion.
  echo [TIP] Cierra y vuelve a abrir la terminal, luego reintenta.
  exit /b 1
)

echo [OK] %TOOL% instalado.
goto :eof
