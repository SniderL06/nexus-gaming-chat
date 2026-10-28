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

const bundleDir = path.join(rootDir, 'src-tauri', 'target', 'release', 'bundle');
const nsisDir = path.join(bundleDir, 'nsis');
const appimageDir = path.join(bundleDir, 'appimage');

const rootLatestPath = path.join(rootDir, 'latest.json');
let latestJson = {
    version: version,
    notes: `Actualización de Nexus v${version} con optimizaciones y mejoras.`,
    pub_date: new Date().toISOString(),
    platforms: {}
};

// Si ya existía un latest.json previo, cargar sus plataformas para no sobrescribir las otras plataformas
if (fs.existsSync(rootLatestPath)) {
    try {
        const prev = JSON.parse(fs.readFileSync(rootLatestPath, 'utf8'));
        if (prev.platforms && typeof prev.platforms === 'object') {
            latestJson.platforms = prev.platforms;
        }
    } catch (_) {}
}

// ── 1. Detección de Windows (.exe / NSIS) ──
let winInstallerName = `Nexus_${version}_x64-setup.exe`;
let winSigName = `${winInstallerName}.sig`;
let winSigPath = path.join(nsisDir, winSigName);
let winSigContent = '';

if (fs.existsSync(winSigPath)) {
    winSigContent = fs.readFileSync(winSigPath, 'utf8').trim();
    console.log(`[Updater] Firma Windows encontrada: ${winSigName}`);
} else if (fs.existsSync(nsisDir)) {
    const files = fs.readdirSync(nsisDir);
    const sigFile = files.find(f => f.endsWith('.sig'));
    if (sigFile) {
        winSigPath = path.join(nsisDir, sigFile);
        winInstallerName = sigFile.replace(/\.sig$/, '');
        winSigContent = fs.readFileSync(winSigPath, 'utf8').trim();
        console.log(`[Updater] Firma Windows encontrada por escaneo: ${sigFile}`);
    }
}

if (winSigContent) {
    latestJson.platforms['windows-x86_64'] = {
        signature: winSigContent,
        url: `https://github.com/${githubRepo}/releases/download/v${version}/${winInstallerName}`
    };
}

// ── 2. Detección de Linux (AppImage) ──
let linuxTarName = `Nexus_${version}_amd64.AppImage.tar.gz`;
let linuxSigName = `${linuxTarName}.sig`;
let linuxSigPath = path.join(appimageDir, linuxSigName);
let linuxSigContent = '';

if (fs.existsSync(linuxSigPath)) {
    linuxSigContent = fs.readFileSync(linuxSigPath, 'utf8').trim();
    console.log(`[Updater] Firma Linux (AppImage) encontrada: ${linuxSigName}`);
} else if (fs.existsSync(appimageDir)) {
    const files = fs.readdirSync(appimageDir);
    const sigFile = files.find(f => f.endsWith('.sig'));
    if (sigFile) {
        linuxSigPath = path.join(appimageDir, sigFile);
        linuxTarName = sigFile.replace(/\.sig$/, '');
        linuxSigContent = fs.readFileSync(linuxSigPath, 'utf8').trim();
        console.log(`[Updater] Firma Linux encontrada por escaneo: ${sigFile}`);
    }
}

if (linuxSigContent) {
    latestJson.platforms['linux-x86_64'] = {
        signature: linuxSigContent,
        url: `https://github.com/${githubRepo}/releases/download/v${version}/${linuxTarName}`
    };
}

const jsonString = JSON.stringify(latestJson, null, 2);
fs.writeFileSync(rootLatestPath, jsonString, 'utf8');
console.log(`[Updater] Manifest generado: ${rootLatestPath}`);

if (fs.existsSync(nsisDir)) {
    fs.writeFileSync(path.join(nsisDir, 'latest.json'), jsonString, 'utf8');
}
if (fs.existsSync(appimageDir)) {
    fs.writeFileSync(path.join(appimageDir, 'latest.json'), jsonString, 'utf8');
}

console.log('\n======================================================');
console.log('  MANIFEST latest.json PARA AUTO-ACTUALIZADOR LISTO!');
console.log('======================================================');
console.log(`Versión:  v${version}`);
console.log(`Plataformas configuradas: ${Object.keys(latestJson.platforms).join(', ') || 'Ninguna (compila antes con claves)'}`);
console.log('======================================================\n');
