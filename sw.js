/* ═══════════════════════════════════════════════════════════════════
   NEXUS SERVICE WORKER — PWA offline + Notificaciones push
   ═══════════════════════════════════════════════════════════════════ */

const CACHE_NAME = 'nexus-v1';

// Archivos esenciales para funcionar sin conexión (shell de la app)
const PRECACHE_ASSETS = [
    '/',
    '/index.html',
    '/css/style.css',
    '/js/app.js',
    '/js/chat.js',
    '/js/voice.js',
    '/js/stream.js',
    '/js/theme.js',
    '/js/music.js',
    '/js/camera.js',
    '/js/dm.js',
    '/js/supabase-client.js',
    '/js/emailjs.config.js',
    '/assets/nexus_favicon.svg',
    '/assets/icons/icon-192.png',
    '/assets/icons/icon-512.png'
];

// ─── INSTALL: pre-cachear shell de la app ───────────────────────────
self.addEventListener('install', (event) => {
    console.log('[SW] Instalando Nexus PWA...');
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            // Cachear de forma individual para no fallar si un asset no existe
            return Promise.allSettled(
                PRECACHE_ASSETS.map(url => cache.add(url).catch(() => {}))
            );
        }).then(() => {
            console.log('[SW] Cache inicial completa.');
            return self.skipWaiting();
        })
    );
});

// ─── ACTIVATE: limpiar caches viejos ────────────────────────────────
self.addEventListener('activate', (event) => {
    console.log('[SW] Activando nuevo Service Worker...');
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
            )
        ).then(() => self.clients.claim())
    );
});

// ─── FETCH: Network-first para APIs, Cache-first para assets ────────
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // No interceptar llamadas a Supabase, PeerJS, CDNs externos o ads
    if (
        url.hostname.includes('supabase.co') ||
        url.hostname.includes('peerjs') ||
        url.hostname.includes('googleapis') ||
        url.hostname.includes('gstatic') ||
        url.hostname.includes('jsdelivr') ||
        url.hostname.includes('unpkg') ||
        url.hostname.includes('emailjs') ||
        url.hostname.includes('profitableratecpm')
    ) {
        return; // dejar pasar sin interceptar
    }

    // Para el resto: Cache-first con fallback a red
    event.respondWith(
        caches.match(event.request).then((cached) => {
            if (cached) return cached;
            return fetch(event.request).then((response) => {
                // Cachear solo respuestas válidas de mismo origen
                if (
                    response.ok &&
                    event.request.method === 'GET' &&
                    url.origin === self.location.origin
                ) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
                }
                return response;
            }).catch(() => {
                // Sin red y sin cache → devolver index.html como fallback SPA
                if (event.request.destination === 'document') {
                    return caches.match('/index.html');
                }
            });
        })
    );
});

// ─── PUSH: Recibir notificaciones push del servidor ──────────────────
self.addEventListener('push', (event) => {
    let data = {};
    try {
        data = event.data ? event.data.json() : {};
    } catch (e) {
        data = { title: 'Nexus', body: event.data ? event.data.text() : 'Nueva notificación' };
    }

    const title = data.title || 'Nexus';
    const options = {
        body: data.body || '',
        icon: data.icon || '/assets/icons/icon-192.png',
        badge: '/assets/icons/icon-72.png',
        tag: data.tag || 'nexus-notif',
        renotify: true,
        vibrate: [200, 100, 200],
        data: {
            url: data.url || '/'
        },
        actions: data.actions || []
    };

    event.waitUntil(self.registration.showNotification(title, options));
});

// ─── NOTIFICATION CLICK: abrir/enfocar la app ───────────────────────
self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    const targetUrl = event.notification.data?.url || '/';

    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
            // Si ya hay una ventana de Nexus abierta, enfocarla
            for (const client of clients) {
                if (client.url.includes(self.location.origin) && 'focus' in client) {
                    client.focus();
                    client.postMessage({ type: 'NOTIFICATION_CLICK', url: targetUrl });
                    return;
                }
            }
            // Si no hay ventana, abrir una nueva
            if (self.clients.openWindow) {
                return self.clients.openWindow(targetUrl);
            }
        })
    );
});

// ─── MESSAGE: recibir notificaciones locales desde la app ───────────
// La app puede pedir al SW que muestre una notificación local
// (para menciones @, alguien se une a voz, etc.)
self.addEventListener('message', (event) => {
    if (event.data?.type === 'SHOW_NOTIFICATION') {
        const { title, body, icon, tag, url } = event.data;
        self.registration.showNotification(title || 'Nexus', {
            body: body || '',
            icon: icon || '/assets/icons/icon-192.png',
            badge: '/assets/icons/icon-72.png',
            tag: tag || 'nexus-local',
            renotify: true,
            vibrate: [150, 75, 150],
            data: { url: url || '/' }
        });
    }
});
