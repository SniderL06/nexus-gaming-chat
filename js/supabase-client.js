/* NEXUS SUPABASE CLIENT MODULE (ES MODULE) */

// ─── Credenciales hardcodeadas — los usuarios no necesitan configurar nada ───
const NEXUS_SUPABASE_URL = 'https://postlkgqpuirhfcyyqje.supabase.co';
const NEXUS_SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBvc3Rsa2dxcHVpcmhmY3l5cWplIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAyNzY5MDgsImV4cCI6MjA5NTg1MjkwOH0.gclaXRWKgon1Wys5-M_PLHzS_7sPuCXw9voPurez0Bo';

export let supabase = null;
export let supabaseUrl = NEXUS_SUPABASE_URL;
export let supabaseKey = NEXUS_SUPABASE_KEY;
export let supabaseReady = false;

// ─── Canal de presencia global (quién está en línea) ─────────
let globalPresenceChannel = null;

// Inicializar cliente automáticamente con las credenciales hardcodeadas
function tryInitClient(url, key) {
    if (url && key && window.supabase) {
        try {
            const client = window.supabase.createClient(url, key, {
                realtime: {
                    params: { eventsPerSecond: 10 }
                }
            });
            supabase = client;
            supabaseReady = true;
            console.log('[Supabase] Cliente inicializado correctamente.');
            setTimeout(updateStatusIndicator, 500);
            return true;
        } catch (e) {
            console.error('[Supabase] Error al inicializar cliente:', e);
            return false;
        }
    }
    return false;
}

tryInitClient(NEXUS_SUPABASE_URL, NEXUS_SUPABASE_KEY);

// ─────────────────────────────────────────────────────────────
// PRESENCIA GLOBAL: quién está conectado en tiempo real
// Llama a esta función desde app.js tras el login del usuario.
// ─────────────────────────────────────────────────────────────
export function startGlobalPresence(userName) {
    if (!supabase || !userName) return;

    // Obtener avatar y estilo del correo actual
    const email = localStorage.getItem('nexus_user_email') || '';
    const userAvatar = email ? localStorage.getItem('nexus_user_avatar_' + email) : null;
    const userAvatarStyle = email ? (localStorage.getItem('nexus_user_avatar_style_' + email) || 'circle') : 'circle';

    // Limpiar canal anterior si existía
    if (globalPresenceChannel) {
        supabase.removeChannel(globalPresenceChannel);
        globalPresenceChannel = null;
    }

    globalPresenceChannel = supabase.channel('nexus:online-users', {
        config: { presence: { key: userName } }
    });

    globalPresenceChannel
        .on('presence', { event: 'sync' }, () => {
            const state = globalPresenceChannel.presenceState();
            updateOnlineMembersSidebar(state);
        })
        .on('presence', { event: 'join' }, ({ key, newPresences }) => {
            console.log(`[Presencia] ${key} se conectó.`);
        })
        .on('presence', { event: 'leave' }, ({ key, leftPresences }) => {
            console.log(`[Presencia] ${key} se desconectó.`);
        })
        .subscribe(async (status) => {
            if (status === 'SUBSCRIBED') {
                await globalPresenceChannel.track({
                    name: userName,
                    email: email,          // identificador seguro para DMs
                    avatar: userAvatar || '',
                    avatarStyle: userAvatarStyle,
                    online_at: new Date().toISOString()
                });
                console.log(`[Presencia] ${userName} marcado como en línea.`);
            }
        });
}

export function stopGlobalPresence() {
    if (globalPresenceChannel && supabase) {
        supabase.removeChannel(globalPresenceChannel);
        globalPresenceChannel = null;
    }
}

// ─────────────────────────────────────────────────────────────
// ACTUALIZAR SIDEBAR DE MIEMBROS EN LÍNEA
// ─────────────────────────────────────────────────────────────
function updateOnlineMembersSidebar(presenceState) {
    const membersList = document.querySelector('.members-list');
    const onlineCountEl = document.getElementById('online-count');
    if (!membersList) return;

    // Recopilar todos los usuarios únicos presentes
    const onlineUsers = [];
    Object.values(presenceState).forEach(presences => {
        presences.forEach(p => {
            if (p.name && !onlineUsers.find(u => u.name === p.name)) {
                onlineUsers.push({
                    name: p.name,
                    email: p.email || '',   // email para DM seguro
                    online_at: p.online_at,
                    avatar: p.avatar || '',
                    avatarStyle: p.avatarStyle || 'circle'
                });
            }
        });
    });

    // Actualizar contador
    if (onlineCountEl) onlineCountEl.textContent = onlineUsers.length;

    // Obtener nombre propio (considerando nombre personalizado)
    const myEmail = localStorage.getItem('nexus_user_email') || '';
    const myName = (() => {
        if (!myEmail) return null;
        const customName = localStorage.getItem('nexus_username_' + myEmail);
        if (customName) return customName;
        const base = myEmail.split('@')[0];
        return base.charAt(0).toUpperCase() + base.slice(1);
    })();

    // Reconstruir lista
    membersList.innerHTML = '';

    onlineUsers.forEach(user => {
        const isMe = user.name === myName;
        const initial = user.name.charAt(0).toUpperCase();
        const bgColors = ['bg-blue', 'bg-purple', 'bg-green', 'bg-orange', 'bg-cyan'];
        const colorIdx = user.name.charCodeAt(0) % bgColors.length;
        const bgClass = bgColors[colorIdx];
        const borderRadius = user.avatarStyle === 'circle' ? '50%' : '8px';

        // Construir el HTML del avatar
        let avatarInnerHtml;
        if (user.avatar && user.avatar.startsWith('data:image/')) {
            avatarInnerHtml = `<div class="avatar ${bgClass}" style="background-image: url(${user.avatar}); background-size: cover; background-position: center; border-radius: ${borderRadius}; text-indent: -9999px;"></div>`;
        } else {
            avatarInnerHtml = `<div class="avatar ${bgClass}">${initial}</div>`;
        }

        const li = document.createElement('li');
        li.className = 'member-item';
        if (isMe) li.id = 'local-user-sidebar-item';

        // Botón DM — solo para otros usuarios, y solo si tienen email disponible
        const dmBtnHtml = (!isMe)
            ? `<button class="member-dm-btn" title="Mensaje directo a ${escapeHTMLPresence(user.name)}" onclick="(function(e){
                e.stopPropagation();
                if(window.openDMWith) window.openDMWith('${user.email.replace(/'/g, "\\'") || ''}', '${escapeHTMLPresence(user.name).replace(/'/g, "\\'") || ''}');
              })(event)">💬</button>`
            : '';

        li.innerHTML = `
            <div class="avatar-container small">
                ${avatarInnerHtml}
                <span class="user-status online"></span>
            </div>
            <div class="member-info">
                <span class="member-name">${escapeHTMLPresence(user.name)}</span>
                <span class="member-game">${isMe ? 'Tú · En línea' : 'En línea'}</span>
            </div>
            ${dmBtnHtml}
        `;
        membersList.appendChild(li);
    });

    if (onlineUsers.length === 0 && onlineCountEl) {
        onlineCountEl.textContent = '0';
    }
}

function escapeHTMLPresence(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/[&<>'"]/g, t =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[t] || t)
    );
}

// ─────────────────────────────────────────────────────────────
// INICIALIZACIÓN DE SUPABASE
// Las credenciales están configuradas en el código.
// El modal de configuración ha sido removido por seguridad.
// ─────────────────────────────────────────────────────────────
export function initSupabaseSetup() {
    // Disparar evento para que el resto de la app sepa que Supabase está listo
    window.dispatchEvent(new CustomEvent('supabase-ready', { detail: { client: supabase } }));
    updateStatusIndicator();
}

function showConnectionSuccess() {
    updateStatusIndicator();

    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed; bottom: 24px; right: 24px; z-index: 100001;
        background: linear-gradient(135deg, #0a1628 0%, #0d1f3c 100%);
        border: 1px solid #00d4ff; border-radius: 12px;
        padding: 16px 24px; box-shadow: 0 0 30px rgba(0,212,255,0.3);
        animation: fadeInUp 0.4s ease; color: #c9d1d9; font-family: 'Inter', sans-serif;
    `;
    notification.innerHTML = `
        <div style="font-weight: 700; color: #00d4ff; font-size: 0.85rem; margin-bottom: 4px; font-family: 'Orbitron', monospace;">⚡ NEXUS CONECTADO</div>
        <div style="font-size: 0.78rem;">Supabase activo – mensajes en tiempo real habilitados</div>
    `;
    document.body.appendChild(notification);
    setTimeout(() => {
        notification.style.animation = 'fadeInUp 0.4s ease reverse';
        setTimeout(() => notification.remove(), 400);
    }, 4000);
}

function updateStatusIndicator() {
    const dot = document.getElementById('supabase-status-dot');
    const text = document.getElementById('supabase-status-text');
    if (dot && text) {
        if (supabaseReady && supabase) {
            dot.style.background = '#22c55e';
            dot.style.boxShadow = '0 0 6px rgba(34,197,94,0.6)';
            text.textContent = 'Supabase conectado – tiempo real activo';
            text.style.color = '#22c55e';
        } else {
            dot.style.background = '#ef4444';
            dot.style.boxShadow = 'none';
            text.textContent = 'Sin conexión a base de datos';
            text.style.color = '';
        }
    }
}
