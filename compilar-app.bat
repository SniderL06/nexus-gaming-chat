@echo off
title Compilando Nexus para Windows con Auto-Actualizador...
echo ======================================================
echo    NEXUS - COMPILADOR DE ESCRITORIO CON AUTO-UPDATER
echo ======================================================
echo.

set PATH=%USERPROFILE%\.cargo\bin;%PATH%

rem ── Deteccion de clave de firma para el auto-actualizador ──
if exist "%USERPROFILE%\.tauri\nexus.key" (
    echo [Updater] Clave privada detectada en %USERPROFILE%\.tauri\nexus.key
    set "TAURI_SIGNING_PRIVATE_KEY=%USERPROFILE%\.tauri\nexus.key"
) else (
    echo [Updater Aviso] No se encontro "%USERPROFILE%\.tauri\nexus.key".
    echo Si deseas que el instalador genere firmas (.sig) para auto-actualizarse,
    echo ejecuta primero el archivo "generar-claves-updater.bat".
)

echo.
echo [1/3] Sincronizando archivos web a /dist...
node scripts/prepare-dist.js
if %errorlevel% neq 0 (
    echo Error al sincronizar archivos web.
    pause
    exit /b %errorlevel%
)

echo.
echo [2/3] Compilando instalador y generando firmas (.sig)...
npx --yes @tauri-apps/cli build
if %errorlevel% neq 0 (
    echo Error durante la compilacion de Tauri.
    pause
    exit /b %errorlevel%
)

echo.
echo [3/3] Generando manifest de actualizacion (latest.json)...
node scripts/generate-latest-json.js

echo.
echo ======================================================
echo    COMPILACION Y FIRMA COMPLETADA CON EXITO!
echo ======================================================
echo.
echo Archivos generados en:
echo src-tauri\target\release\bundle\nsis\
echo.
echo Para que los usuarios de Windows se actualicen solos:
echo 1. Sube a GitHub Releases el instalador .exe, el .sig y latest.json.
echo.
pause
