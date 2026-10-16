/* ═══════════════════════════════════════════════════════════════════
   NEXUS DESKTOP AUTO-UPDATER — Notificaciones y reinicio en Tauri
   ═══════════════════════════════════════════════════════════════════ */

import { showInAppToast } from './pwa.js';

export function initDesktopUpdater() {
    const isTauri = typeof window !== 'undefined' && (window.__TAURI__ || window.__TAURI_INTERNALS__);
    if (!isTauri) return;

    console.log('[Updater] Nexus Desktop detectado. Inicializando escuchadores de auto-actualizador...');

    // Esperar a que la API de eventos de Tauri esté disponible
    const checkInterval = setInterval(() => {
        const eventApi = window.__TAURI__?.event;
        if (!eventApi) return;
        clearInterval(checkInterval);

        // 1. Evento: Actualización encontrada y descargándose
        eventApi.listen('nexus:update-available', (event) => {
            const payload = event?.payload || {};
            const version = payload.version || '';
            console.log(`[Updater] Descargando actualización en segundo plano: v${version}`);

            try {
                showInAppToast({
                    icon: '🚀',
                    title: 'Nueva versión de Nexus',
                    body: `Descargando v${version} en segundo plano...`,
                    color: 'var(--accent-cyan)',
                    duration: 7000
                });
            } catch (e) {
                console.log('[Updater] Toast:', e);
            }
        });

        // 2. Evento: Actualización descargada y lista para aplicar
        eventApi.listen('nexus:update-ready', (event) => {
            const payload = event?.payload || {};
            const version = payload.version || '';
            console.log(`[Updater] Actualización lista para aplicar: v${version}`);
            showDesktopUpdateReadyBanner(version);
        });
    }, 500);

    // Timeout de seguridad para no dejar el intervalo corriendo si no hay Tauri
    setTimeout(() => clearInterval(checkInterval), 15000);
}

/**
 * Muestra el banner flotante estilo Discord para reiniciar y aplicar la actualización
 */
function showDesktopUpdateReadyBanner(version = '') {
    if (document.getElementById('nexus-desktop-update-banner')) return;

    const banner = document.createElement('div');
    banner.id = 'nexus-desktop-update-banner';
    banner.className = 'nexus-update-banner';
    banner.innerHTML = `
        <div class="update-banner-content">
            <span class="update-banner-icon">✨</span>
            <div class="update-banner-info">
                <strong>¡Actualización ${version ? 'v' + version : ''} lista!</strong>
                <span>Reinicia Nexus para disfrutar de las nuevas funciones.</span>
            </div>
        </div>
        <div class="update-banner-actions">
            <button id="nexus-restart-now-btn" class="update-banner-btn-restart">Reiniciar ahora</button>
            <button id="nexus-dismiss-banner-btn" class="update-banner-btn-dismiss" title="Posponer">✕</button>
        </div>
    `;

    document.body.appendChild(banner);

    // Botón reiniciar ahora
    document.getElementById('nexus-restart-now-btn')?.addEventListener('click', async () => {
        const btn = document.getElementById('nexus-restart-now-btn');
        if (btn) btn.textContent = 'Reiniciando...';
        try {
            if (window.__TAURI__?.core?.invoke) {
                await window.__TAURI__.core.invoke('restart_app');
            } else {
                window.location.reload();
            }
        } catch (err) {
            console.error('[Updater] Error al solicitar reinicio a Tauri:', err);
            window.location.reload();
        }
    });

    // Botón descartar / posponer
    document.getElementById('nexus-dismiss-banner-btn')?.addEventListener('click', () => {
        banner.style.opacity = '0';
        banner.style.transform = 'translate(-50%, 20px)';
        setTimeout(() => banner.remove(), 300);
    });
}
