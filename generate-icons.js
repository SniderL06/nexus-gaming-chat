/**
 * generate-icons.js
 * Genera todos los iconos PNG requeridos por el manifest de Nexus PWA
 * desde el SVG del favicon usando Canvas del navegador (o sharp si hay Node).
 * 
 * USO: Abre index.html en el navegador y ejecuta en la consola:
 *   await generatePWAIcons()
 * 
 * O en Node con: node generate-icons.js
 * (requiere: npm install sharp)
 */

// ─── VERSIÓN NAVEGADOR (copiar y pegar en la consola del navegador) ──
window.generatePWAIcons = async function() {
    const sizes = [72, 96, 128, 144, 152, 192, 384, 512];
    const svgUrl = '/assets/nexus_favicon.svg';

    const svgText = await fetch(svgUrl).then(r => r.text());
    const blob = new Blob([svgText], { type: 'image/svg+xml' });
    const svgObjectUrl = URL.createObjectURL(blob);

    for (const size of sizes) {
        await new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = size;
                canvas.height = size;
                const ctx = canvas.getContext('2d');

                // Fondo sólido (para maskable)
                ctx.fillStyle = '#0d0d1a';
                ctx.fillRect(0, 0, size, size);
                ctx.drawImage(img, 0, 0, size, size);

                canvas.toBlob((pngBlob) => {
                    const a = document.createElement('a');
                    a.download = `icon-${size}.png`;
                    a.href = URL.createObjectURL(pngBlob);
                    a.click();
                    URL.revokeObjectURL(a.href);
                    console.log(`✅ Generado icon-${size}.png`);
                    resolve();
                }, 'image/png');
            };
            img.src = svgObjectUrl;
        });
        await new Promise(r => setTimeout(r, 200)); // pausa entre descargas
    }

    URL.revokeObjectURL(svgObjectUrl);
    console.log('🎉 Todos los iconos generados. Ponlos en /assets/icons/');
};

console.log('Ejecuta: await generatePWAIcons()');
