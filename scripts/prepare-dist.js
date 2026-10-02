const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const distDir = path.resolve(rootDir, 'dist');

if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
}

const copyItems = ['index.html', 'privacy.html', 'manifest.json', 'sw.js', 'ads.js', 'css', 'js', 'assets'];

for (const item of copyItems) {
    const src = path.join(rootDir, item);
    const dest = path.join(distDir, item);
    if (fs.existsSync(src)) {
        fs.cpSync(src, dest, { recursive: true, force: true });
        console.log(`[Dist] Copiado: ${item}`);
    }
}

console.log('[Dist] Preparación de frontend finalizada con éxito en /dist');
