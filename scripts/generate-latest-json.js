const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const tauriConfPath = path.join(rootDir, 'src-tauri', 'tauri.conf.json');

if (!fs.existsSync(tauriConfPath)) {
    console.error('[Error] No se encontró src-tauri/tauri.conf.json');
    process.exit(1);
}

const tauriConfig = JSON.parse(fs.readFileSync(tauriConfPath, 'utf8'));
const version = process.argv[2] || tauriConfig.version || '1.0.0';
const githubRepo = 'SniderL06/nexus-gaming-chat';

const nsisDir = path.join(rootDir, 'src-tauri', 'target', 'release', 'bundle', 'nsis');

let installerName = `Nexus_${version}_x64-setup.exe`;
let sigName = `${installerName}.sig`;
let sigPath = path.join(nsisDir, sigName);
let signatureContent = '';

if (fs.existsSync(sigPath)) {
    signatureContent = fs.readFileSync(sigPath, 'utf8').trim();
    console.log(`[Updater] Archivo de firma encontrado: ${sigName}`);
} else {
    // Buscar cualquier .sig en el directorio nsis
    if (fs.existsSync(nsisDir)) {
        const files = fs.readdirSync(nsisDir);
        const sigFile = files.find(f => f.endsWith('.sig'));
        if (sigFile) {
            sigPath = path.join(nsisDir, sigFile);
            installerName = sigFile.replace(/\.sig$/, '');
            signatureContent = fs.readFileSync(sigPath, 'utf8').trim();
            console.log(`[Updater] Firma encontrada por escaneo: ${sigFile}`);
        }
    }
}

if (!signatureContent) {
    console.warn('[Aviso] No se encontró el archivo .sig de firma en target/release/bundle/nsis.');
    console.warn('Asegúrate de haber compilado con una clave privada configurada (TAURI_SIGNING_PRIVATE_KEY).');
    signatureContent = 'COPIA_AQUI_LA_FIRMA_DEL_ARCHIVO_SIG';
}

const latestJson = {
    version: version,
    notes: `Actualización de Nexus v${version} con optimizaciones y mejoras.`,
    pub_date: new Date().toISOString(),
    platforms: {
        'windows-x86_64': {
            signature: signatureContent,
            url: `https://github.com/${githubRepo}/releases/download/v${version}/${installerName}`
        }
    }
};

const jsonString = JSON.stringify(latestJson, null, 2);

// Guardar en la raíz y en nsisDir
const rootLatestPath = path.join(rootDir, 'latest.json');
fs.writeFileSync(rootLatestPath, jsonString, 'utf8');
console.log(`[Updater] Generado: ${rootLatestPath}`);

if (fs.existsSync(nsisDir)) {
    const nsisLatestPath = path.join(nsisDir, 'latest.json');
    fs.writeFileSync(nsisLatestPath, jsonString, 'utf8');
    console.log(`[Updater] Generado: ${nsisLatestPath}`);
}

console.log('\n======================================================');
console.log('  MANIFEST latest.json PARA AUTO-ACTUALIZADOR LISTO!');
console.log('======================================================');
console.log(`Versión:  v${version}`);
console.log(`URL Setup: https://github.com/${githubRepo}/releases/download/v${version}/${installerName}`);
console.log('\nPara publicar esta actualización en GitHub Releases:');
console.log(`1. Ve a: https://github.com/${githubRepo}/releases/new`);
console.log(`2. Crea una release con la etiqueta (tag): v${version}`);
console.log('3. Sube los siguientes 3 archivos a los assets de la release:');
console.log(`   - ${installerName}`);
console.log(`   - ${sigName}`);
console.log('   - latest.json');
console.log('4. Haz clic en "Publish release".');
console.log('¡Listo! Todos los clientes de Nexus se actualizarán automáticamente al abrir la app.');
console.log('======================================================\n');
