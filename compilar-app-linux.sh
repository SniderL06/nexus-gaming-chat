#!/usr/bin/env bash
set -e

echo "======================================================"
echo "   NEXUS - COMPILADOR LINUX (APPIMAGE Y .DEB)"
echo "======================================================"
echo ""

# Detección de clave de firma para auto-actualizador
if [ -f "$HOME/.tauri/nexus.key" ]; then
    echo "[Updater] Clave privada detectada en $HOME/.tauri/nexus.key"
    export TAURI_SIGNING_PRIVATE_KEY="$HOME/.tauri/nexus.key"
elif [ -n "$TAURI_SIGNING_PRIVATE_KEY" ]; then
    echo "[Updater] Clave privada configurada en variable de entorno."
else
    echo "[Updater Aviso] No se encontró clave privada en $HOME/.tauri/nexus.key."
    echo "Si deseas firmas para auto-actualización, genera una clave con: npx @tauri-apps/cli signer generate"
fi

echo ""
echo "[1/3] Sincronizando archivos web a /dist..."
node scripts/prepare-dist.js

echo ""
echo "[2/3] Compilando con Tauri para Linux (AppImage y .deb)..."
npx --yes @tauri-apps/cli build

echo ""
echo "[3/3] Generando/Actualizando manifest latest.json..."
node scripts/generate-latest-json.js

echo ""
echo "======================================================"
echo "   COMPILACIÓN FINALIZADA CON ÉXITO!"
echo "======================================================"
echo "Los paquetes se generaron en:"
echo "  src-tauri/target/release/bundle/appimage/"
echo "  src-tauri/target/release/bundle/deb/"
echo "======================================================"
