@echo off
title Compilando Nexus para Windows...
echo ======================================================
echo    NEXUS - COMPILADOR AUTOMATICO DE APP DE ESCRITORIO
echo ======================================================
echo.

set PATH=%USERPROFILE%\.cargo\bin;%PATH%

echo [1/2] Sincronizando archivos web a /dist...
node scripts/prepare-dist.js
if %errorlevel% neq 0 (
    echo Error al sincronizar archivos web.
    pause
    exit /b %errorlevel%
)

echo.
echo [2/2] Compilando instalador optimizado de Nexus...
npx --yes @tauri-apps/cli build
if %errorlevel% neq 0 (
    echo Error durante la compilacion de Tauri.
    pause
    exit /b %errorlevel%
)

echo.
echo ======================================================
echo    COMPILACION COMPLETADA CON EXITO!
echo ======================================================
echo.
echo Tu nuevo instalador listo para usar esta en:
echo src-tauri\target\release\bundle\nsis\Nexus_1.0.0_x64-setup.exe
echo.
echo O el ejecutable directo en:
echo src-tauri\target\release\nexus.exe
echo.
pause
