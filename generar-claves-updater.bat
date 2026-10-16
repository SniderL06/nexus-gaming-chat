@echo off
title Generador de Claves de Auto-Actualizador - Nexus
echo ======================================================
echo    NEXUS - GENERADOR DE CLAVES DEL AUTO-ACTUALIZADOR
echo ======================================================
echo.
echo Este asistente genera el par de claves (publica y privada)
echo necesarias para que Tauri firme los instaladores de Windows
echo y permita que la app se actualice sola de forma segura.
echo.

if not exist "%USERPROFILE%\.tauri" mkdir "%USERPROFILE%\.tauri"

if exist "%USERPROFILE%\.tauri\nexus.key" (
    echo [INFO] Ya existe una clave en: %USERPROFILE%\.tauri\nexus.key
    echo Tu clave publica actual (.pub) contiene:
    echo ------------------------------------------------------
    type "%USERPROFILE%\.tauri\nexus.key.pub"
    echo.
    echo ------------------------------------------------------
    echo Esta clave ya esta configurada en src-tauri\tauri.conf.json.
    echo.
    echo Si deseas reemplazarla por una nueva, elimina los archivos
    echo nexus.key y nexus.key.pub en %USERPROFILE%\.tauri y reejecuta este script.
    echo.
    pause
    exit /b 0
)

echo Generando nuevas claves con el CLI de Tauri...
npx --yes @tauri-apps/cli signer generate -w "%USERPROFILE%\.tauri\nexus.key"
if %errorlevel% neq 0 (
    echo Error al generar las claves con Tauri CLI.
    pause
    exit /b %errorlevel%
)

echo.
echo ======================================================
echo    CLAVES GENERADAS CON EXITO!
echo ======================================================
echo Clave privada guardada en: %USERPROFILE%\.tauri\nexus.key (GUARDALA EN SECRETO)
echo Clave publica guardada en: %USERPROFILE%\.tauri\nexus.key.pub
echo.
echo Clave publica generada:
type "%USERPROFILE%\.tauri\nexus.key.pub"
echo.
echo Recuerda que la clave publica debe estar en:
echo src-tauri\tauri.conf.json -> plugins -> updater -> pubkey
echo ======================================================
pause
