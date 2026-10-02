/* ═══════════════════════════════════════════════════════════════════
   NEXUS PWA — Notificaciones locales, registro SW e instalación
   ═══════════════════════════════════════════════════════════════════ */

// ─── Estado ───────────────────────────────────────────────────────────
let swRegistration = null;
let notifPermission = (typeof window !== 'undefined' && 'Notification' in window) ? Notification.permission : 'default';
let installPromptEvent = null; // BeforeInstallPromptEvent guardado


// ─── REGISTRO DEL SERVICE WORKER ─────────────────────────────────────
export async function initPWA() {
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

// ─── ENVIAR NOTIFICACIÓN LOCAL (vía SW para que funcione en background) ──
export function sendLocalNotification({ title, body, icon, tag, url }) {
    if (Notification.permission !== 'granted') return;

    // Si la página está visible, no molestar con notificación
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
    sendLocalNotification({
        title: `@mención en #${channelName}`,
        body: `${authorName}: ${messageText.slice(0, 100)}`,
        tag: 'nexus-mention',
        url: '/'
    });
}

// ─── NOTIFICACIÓN DE ALGUIEN SE UNE A VOZ ────────────────────────────
/**
 * Llama a esta función cuando alguien se une al canal de voz activo.
 * @param {string} memberName - Nombre del miembro que se unió
 * @param {string} channelName - Nombre del canal de voz
 */
export function notifyVoiceJoin(memberName, channelName) {
    sendLocalNotification({
        title: `🎙️ ${memberName} se unió a la llamada`,
        body: `Canal: ${channelName}`,
        tag: 'nexus-voice-join',
        url: '/'
    });
}

// ─── NOTIFICACIÓN DE MENSAJE DIRECTO (DM) ────────────────────────────
/**
 * Notifica cuando llega un DM mientras la app está en background.
 * @param {string} senderName - Nombre del remitente
 * @param {string} messageText - Texto del mensaje
 */
export function notifyDM(senderName, messageText) {
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
