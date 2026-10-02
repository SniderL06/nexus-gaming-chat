/**
 * Script para generar iconos PNG de la PWA desde el SVG del favicon.
 * Requiere: npm install sharp
 * 
 * Ejecutar desde la raíz del proyecto:
 *   node scripts/generate-pwa-icons.js
 */

const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const sizes = [72, 96, 128, 144, 152, 192, 384, 512];
const svgPath = path.join(__dirname, '..', 'assets', 'nexus_favicon.svg');
const outDir = path.join(__dirname, '..', 'assets', 'icons');

fs.mkdirSync(outDir, { recursive: true });

(async () => {
    const svgBuffer = fs.readFileSync(svgPath);
    console.log(`Generando ${sizes.length} iconos PNG desde el SVG...`);

    for (const size of sizes) {
        const outPath = path.join(outDir, `icon-${size}.png`);
        await sharp(svgBuffer)
            .resize(size, size)
            .flatten({ background: { r: 13, g: 13, b: 26 } })  // fondo #0d0d1a
            .png()
            .toFile(outPath);
        console.log(`  ✅ icon-${size}.png`);
    }

    console.log('\n🎉 Iconos generados en assets/icons/');
    console.log('   Haz commit y push de la carpeta assets/icons/');
})();
