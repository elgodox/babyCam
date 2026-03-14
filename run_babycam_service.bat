@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "SCRIPT_DIR=%~dp0"
set "APP_DIR=%SCRIPT_DIR%"

cd /d "%APP_DIR%" || (
  echo [ERROR] No se pudo abrir el directorio de la app.
  exit /b 1
)

echo.
echo ==============================================
echo   BabyCam - Servicio en segundo plano
echo ==============================================
echo.

call npm install
if errorlevel 1 (
  echo [ERROR] Fallo npm install.
  exit /b 1
)

echo.
echo [INFO] Iniciando BabyCam Service...
echo [INFO] La ventana puede cerrarse y seguira activo en la bandeja del sistema.
echo [INFO] Viewer local: http://localhost:8787/watch
echo.
call npm run service
exit /b %errorlevel%
