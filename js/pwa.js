/* ═══════════════════════════════════════════════════════════════════
   NEXUS PWA — Notificaciones locales, registro SW e instalación
   ═══════════════════════════════════════════════════════════════════ */

// ─── Estado ───────────────────────────────────────────────────────────
let swRegistration = null;
let notifPermission = (typeof window !== 'undefined' && 'Notification' in window) ? Notification.permission : 'default';
let installPromptEvent = null; // BeforeInstallPromptEvent guardado


// ─── REGISTRO DEL SERVICE WORKER ─────────────────────────────────────
export async function initPWA() {
    // Si estamos en la app de escritorio de Tauri, desregistrar SW y limpiar cachés
    // para evitar que WebView2 sirva HTML/JS desactualizado en lugar de los archivos compilados
    const isTauri = typeof window !== 'undefined' && (window.__TAURI__ || window.__TAURI_INTERNALS__);
    if (isTauri) {
        if ('serviceWorker' in navigator) {
            try {
                const regs = await navigator.serviceWorker.getRegistrations();
                for (const reg of regs) {
                    await reg.unregister();
                }
                if ('caches' in window) {
                    const keys = await caches.keys();
                    for (const key of keys) {
                        await caches.delete(key);
                    }
                }
                console.log('[PWA] Ejecutando en Tauri nativo: Service Worker y cachés locales purgados.');
            } catch (e) {}
        }
        return;
    }

    if (!('serviceWorker' in navigator)) {
        console.warn('[PWA] Service Worker no soportado en este navegador.');
        return;
    }

    try {
        swRegistration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
        console.log('[PWA] Service Worker registrado:', swRegistration.scope);

        swRegistration.addEventListener('updatefound', () => {
            const newWorker = swRegistration.installing;
            newWorker?.addEventListener('statechange', () => {
                if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                    console.log('[PWA] Nueva versión disponible. Recarga para actualizar.');
                    showUpdateToast();
                }
            });
        });
    } catch (err) {
        console.error('[PWA] Error al registrar Service Worker:', err);
    }

    // Guardar el prompt de instalación cuando el navegador lo emite
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        installPromptEvent = e;
        showInstallButton();
        console.log('[PWA] App instalable — mostrando botón de instalación.');
    });

    // Detectar cuando ya está instalada
    window.addEventListener('appinstalled', () => {
        installPromptEvent = null;
        hideInstallButton();
        console.log('[PWA] Nexus instalado como app.');
    });
}

// ─── PERMISOS DE NOTIFICACIÓN ─────────────────────────────────────────
export async function requestNotificationPermission() {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;

    const result = await Notification.requestPermission();
    notifPermission = result;
    console.log('[PWA] Permiso de notificaciones:', result);
    return result === 'granted';
}

// ─── TOAST EN-APP (cuando la ventana está visible) ────────────────────────
export function showInAppToast({ icon = '🔔', title, body, color = 'var(--accent-purple)', duration = 5000 }) {
    // Crear contenedor persistente si no existe
    let container = document.getElementById('nexus-toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'nexus-toast-container';
        container.style.cssText = `
            position: fixed; bottom: 80px; right: 20px; z-index: 999999;
            display: flex; flex-direction: column-reverse; gap: 8px;
            pointer-events: none;
        `;
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.style.cssText = `
        display: flex; align-items: flex-start; gap: 10px;
        background: var(--bg-secondary); border: 1px solid ${color};
        border-left: 4px solid ${color}; border-radius: 10px;
        padding: 12px 16px; box-shadow: 0 8px 24px rgba(0,0,0,0.5);
        pointer-events: all; cursor: pointer; max-width: 300px;
        animation: nexusToastIn 0.3s ease; opacity: 1;
        transition: opacity 0.3s ease;
    `;
    toast.innerHTML = `
        <span style="font-size: 1.3rem; flex-shrink: 0;">${icon}</span>
        <div style="flex: 1; min-width: 0;">
            <div style="font-weight: 700; font-size: 0.82rem; color: var(--text-normal); font-family: 'Orbitron', sans-serif; margin-bottom: 2px;">${title}</div>
            <div style="font-size: 0.78rem; color: var(--text-muted); line-height: 1.4; word-break: break-word;">${body}</div>
        </div>
        <span style="font-size: 0.7rem; color: var(--text-muted); cursor: pointer; flex-shrink: 0; padding: 2px;" onclick="this.closest('div').remove()">✕</span>
    `;
    toast.onclick = () => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); };

    container.appendChild(toast);

    // CSS animation si no existe
    if (!document.getElementById('nexus-toast-css')) {
        const style = document.createElement('style');
        style.id = 'nexus-toast-css';
        style.textContent = `@keyframes nexusToastIn { from { opacity:0; transform: translateX(40px); } to { opacity:1; transform: translateX(0); } }`;
        document.head.appendChild(style);
    }

    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

// ─── ENVIAR NOTIFICACIÓN LOCAL (vía SW para que funcione en background) ──
export function sendLocalNotification({ title, body, icon, tag, url }) {
    if (Notification.permission !== 'granted') return;

    // Si la página está visible, usar toast en-app en vez de notificación del sistema
    if (document.visibilityState === 'visible') return;

    if (swRegistration?.active) {
        // Pedir al SW que muestre la notificación (funciona incluso con la pantalla apagada)
        swRegistration.active.postMessage({
            type: 'SHOW_NOTIFICATION',
            title,
            body,
            icon: icon || '/assets/icons/icon-192.png',
            tag: tag || 'nexus-local',
            url: url || '/'
        });
    } else if ('Notification' in window) {
        // Fallback: notificación directa desde la pestaña
        new Notification(title, { body, icon: icon || '/assets/nexus_favicon.svg', tag });
    }
}

// ─── NOTIFICACIÓN DE @MENCIÓN ─────────────────────────────────────────
/**
 * Llama a esta función cuando llega un mensaje que menciona al usuario actual.
 * @param {string} authorName - Nombre de quien mandó el mensaje
 * @param {string} messageText - Texto del mensaje
 * @param {string} channelName - Nombre del canal (#general, etc.)
 */
export function notifyMention(authorName, messageText, channelName) {
    // Siempre mostrar toast en-app (app visible o no)
    showInAppToast({
        icon: '💬',
        title: `@mención en #${channelName}`,
        body: `${authorName}: ${messageText.slice(0, 90)}`,
        color: 'var(--accent-cyan)',
        duration: 7000
    });
    // Notificación del sistema si la app está en background
    sendLocalNotification({
        title: `@mención en #${channelName}`,
        body: `${authorName}: ${messageText.slice(0, 100)}`,
        tag: 'nexus-mention',
        url: '/'
    });
}

// ─── NOTIFICACIÓN DE ALGUIEN SE UNE A VOZ ────────────────────────────
export function notifyVoiceJoin(memberName, channelName) {
    // Siempre mostrar toast en-app
    showInAppToast({
        icon: '🎙️',
        title: `${memberName} se unió a la llamada`,
        body: `Canal: ${channelName}`,
        color: 'var(--accent-green)',
        duration: 5000
    });
    // Notificación del sistema si la app está en background
    sendLocalNotification({
        title: `🎙️ ${memberName} se unió a la llamada`,
        body: `Canal: ${channelName}`,
        tag: 'nexus-voice-join',
        url: '/'
    });
}

// ─── NOTIFICACIÓN DE MENSAJE DIRECTO (DM) ────────────────────────────
export function notifyDM(senderName, messageText) {
    showInAppToast({
        icon: '📩',
        title: `DM de ${senderName}`,
        body: messageText.slice(0, 90),
        color: '#ec4899',
        duration: 6000
    });
    sendLocalNotification({
        title: `💬 Mensaje de ${senderName}`,
        body: messageText.slice(0, 120),
        tag: `nexus-dm-${senderName}`,
        url: '/'
    });
}

// ─── BOTÓN DE INSTALACIÓN ─────────────────────────────────────────────
function showInstallButton() {
    let btn = document.getElementById('pwa-install-btn');
    if (btn) { btn.style.display = ''; return; }

    btn = document.createElement('button');
    btn.id = 'pwa-install-btn';
    btn.className = 'pwa-install-btn';
    btn.innerHTML = `
        <span class="pwa-install-icon">📲</span>
        <span class="pwa-install-text">Instalar Nexus</span>
    `;
    btn.title = 'Instalar Nexus como aplicación';
    btn.addEventListener('click', triggerInstall);

    // Insertar en el sidebar de servidores (esquina inferior izquierda)
    const sidebar = document.querySelector('.sidebar-servers') || document.body;
    sidebar.appendChild(btn);
}

function hideInstallButton() {
    const btn = document.getElementById('pwa-install-btn');
    if (btn) btn.style.display = 'none';
}

async function triggerInstall() {
    if (!installPromptEvent) return;
    installPromptEvent.prompt();
    const { outcome } = await installPromptEvent.userChoice;
    console.log('[PWA] Resultado instalación:', outcome);
    if (outcome === 'accepted') {
        installPromptEvent = null;
        hideInstallButton();
    }
}

// ─── TOAST DE ACTUALIZACIÓN DISPONIBLE ────────────────────────────────
function showUpdateToast() {
    const toast = document.createElement('div');
    toast.className = 'pwa-update-toast';
    toast.innerHTML = `
        <span>🔄 Nueva versión disponible</span>
        <button onclick="window.location.reload()">Actualizar</button>
    `;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 15000);
}
