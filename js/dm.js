/* NEXUS DIRECT MESSAGES MODULE — EFIMERO VIA SUPABASE BROADCAST */

import { supabase, supabaseReady } from './supabase-client.js';

// Estado local del modulo DM
let dmPanel         = null;
let dmMessages      = null;
let dmTextarea      = null;
let dmSendBtn       = null;
let dmCloseBtn      = null;
let dmTargetName    = null;
let dmAvatar        = null;
let dmUnreadBadge   = null;
let dmSidebarBtn    = null;
let dmStatusEl      = null;

let activeDMConvId    = null;
let activeDMChannel   = null;
let activeDMTarget    = { email: null, name: null };
let unreadDMCount     = 0;
let isPanelOpen       = false;
let notifyChannel     = null;  // Canal personal de notificaciones entrantes

// --- UTILIDADES ---

function getConvId(emailA, emailB) {
    return [emailA.toLowerCase(), emailB.toLowerCase()].sort().join(':');
}
function getMyEmail() {
    return localStorage.getItem('nexus_user_email') || '';
}
function getMyName() {
    const email = getMyEmail();
    if (!email) return 'Tu';
    const customName = localStorage.getItem('nexus_username_' + email);
    if (customName) return customName;
    const base = email.split('@')[0];
    return base.charAt(0).toUpperCase() + base.slice(1);
}
function esc(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/[&<>'"\/]/g, t => (
        {'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;','/':'&#x2F;'}[t] || t
    ));
}
function relTime(ts) {
    const diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 5)  return 'Ahora';
    if (diff < 60) return `${diff}s`;
    const m = Math.floor(diff / 60);
    if (m < 60) return `${m}m`;
    return `${Math.floor(m / 60)}h`;
}
function getAvatarData(name) {
    const initial = (name || '?').charAt(0).toUpperCase();
    const colors = ['#00d4ff','#a855f7','#ec4899','#22c55e','#f97316','#06b6d4'];
    const color = colors[(name || '').charCodeAt(0) % colors.length];
    return { initial, color };
}

// --- INICIALIZACION ---
export function initDM() {
    dmPanel       = document.getElementById('dm-panel');
    dmMessages    = document.getElementById('dm-messages');
    dmTextarea    = document.getElementById('dm-textarea');
    dmSendBtn     = document.getElementById('dm-send-btn');
    dmCloseBtn    = document.getElementById('dm-close-btn');
    dmTargetName  = document.getElementById('dm-target-name');
    dmAvatar      = document.getElementById('dm-avatar');
    dmUnreadBadge = document.getElementById('dm-unread-badge');
    dmSidebarBtn  = document.getElementById('dm-sidebar-btn');
    dmStatusEl    = document.getElementById('dm-status');

    if (dmCloseBtn) dmCloseBtn.addEventListener('click', closeDMPanel);

    if (dmSidebarBtn) {
        dmSidebarBtn.addEventListener('click', () => {
            if (isPanelOpen && !activeDMTarget.email) {
                closeDMPanel();
            } else if (!isPanelOpen) {
                showDMEmptyState();
            } else {
                closeDMPanel();
            }
        });
    }

    if (dmTextarea) {
        dmTextarea.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendDM();
            }
        });
        dmTextarea.addEventListener('input', () => {
            dmTextarea.style.height = 'auto';
            dmTextarea.style.height = Math.min(dmTextarea.scrollHeight, 100) + 'px';
        });
    }
    if (dmSendBtn) dmSendBtn.addEventListener('click', sendDM);

    window.openDMWith        = openDMWith;
    window.closeDMPanel      = closeDMPanel;
    window.replyToDMMessage  = setDMReplyTarget;

    const dmReplyCloseBtn = document.getElementById('dm-reply-preview-close-btn');
    if (dmReplyCloseBtn) dmReplyCloseBtn.addEventListener('click', clearDMReplyTarget);

    // Suscribir al canal personal de notificaciones de DM
    // Esto permite recibir avisos aunque el panel DM no esté abierto
    const myEmail = getMyEmail();
    if (myEmail && supabase) {
        subscribeToNotifyChannel(myEmail);
    }
}

// --- CANAL DE NOTIFICACION PERSONAL ---
function subscribeToNotifyChannel(myEmail) {
    if (!supabase) return;
    // Limpiar canal previo si existe
    if (notifyChannel) {
        try { supabase.removeChannel(notifyChannel); } catch(e){}
        notifyChannel = null;
    }

    notifyChannel = supabase.channel(`dm-notify:${myEmail.toLowerCase()}`, {
        config: { broadcast: { self: false } }
    });

    notifyChannel
        .on('broadcast', { event: 'dm-ping' }, ({ payload }) => {
            // Alguien nos envió un DM y nosotros no estábamos en ese canal
            const { senderEmail, senderName, convId, text, ts } = payload;

            // Si ya tenemos ese conv activo y el panel abierto, ignorar (ya llegara por el canal DM)
            if (convId === activeDMConvId && isPanelOpen) return;

            // Si el panel está abierto en ESA conversación, ignorar
            if (convId === activeDMConvId) return;

            // Mostrar toast de notificación con botón para abrir
            showDMPingToast(senderEmail, senderName, text, ts);

            // Incrementar badge de no leídos
            unreadDMCount++;
            updateDMBadge();
        })
        .subscribe();

    console.log('[DM Notify] Suscrito al canal de notificaciones:', `dm-notify:${myEmail.toLowerCase()}`);
}

// --- ABRIR CONVERSACION ---
export function openDMWith(targetEmail, targetName) {
    const myEmail = getMyEmail();
    if (!myEmail) { console.warn('[DM] Sin sesion.'); return; }
    if (!targetEmail) { showNullEmailWarning(); return; }
    if (targetEmail.toLowerCase() === myEmail.toLowerCase()) return;

    const convId = getConvId(myEmail, targetEmail);
    if (convId === activeDMConvId && isPanelOpen) return;

    unsubscribeDMChannel();
    activeDMConvId  = convId;
    activeDMTarget  = { email: targetEmail, name: targetName || targetEmail };

    if (dmMessages) dmMessages.innerHTML = '';
    updateDMHeader(activeDMTarget.name);
    openPanel();
    showDMStatus('\u26a1 Chat efimero rotativo \u00b7 Ultimos mensajes guardados');

    // Cargar buffer rotativo local guardado (máximo 8 mensajes)
    const savedMessages = loadDMMessagesFromStorage(convId);
    savedMessages.forEach(msg => {
        const isOwn = (msg.senderEmail || '').toLowerCase() === myEmail.toLowerCase();
        renderDMMessage(msg, isOwn);
    });

    subscribeToDMChannel(convId);

    unreadDMCount = 0;
    updateDMBadge();
}

// --- PANEL VACIO ---
function showDMEmptyState() {
    if (!dmPanel) return;
    if (dmTargetName) dmTargetName.textContent = 'Mensajes Directos';
    if (dmAvatar) {
        dmAvatar.textContent = '\ud83d\udcac';
        dmAvatar.style.background = 'linear-gradient(135deg, #00d4ff, #a855f7)';
    }
    if (dmMessages) {
        dmMessages.innerHTML = `
            <div class="dm-empty-state">
                <div class="dm-empty-icon">\ud83d\udcac</div>
                <h3>Mensajes Directos</h3>
                <p>Haz clic en el icono <strong>\ud83d\udcac</strong> junto a un usuario en la lista de miembros para iniciar una conversacion privada.</p>
                <div class="dm-empty-note">\u26a1 Los mensajes son efimeros rotativos \u2014 Auto-limpieza activa</div>
            </div>
        `;
    }
    if (dmTextarea) { dmTextarea.disabled = true; dmTextarea.placeholder = 'Selecciona un usuario...'; }
    if (dmSendBtn) dmSendBtn.disabled = true;
    if (dmStatusEl) dmStatusEl.textContent = '';
    openPanel();
}

// --- SUSCRIPCION BROADCAST ---
function subscribeToDMChannel(convId) {
    if (!supabase) { showDMStatus('\u26a0\ufe0f Sin conexion a Supabase'); return; }

    activeDMChannel = supabase.channel(`dm-broadcast:${convId}`, {
        config: { broadcast: { self: false } }
    });

    activeDMChannel
        .on('broadcast', { event: 'dm' }, ({ payload }) => {
            if (payload.convId !== activeDMConvId) return;
            saveDMMessageToStorage(payload.convId, payload);
            renderDMMessage({ text: payload.text, senderName: payload.senderName, ts: payload.ts }, false);
            if (!isPanelOpen) {
                unreadDMCount++;
                updateDMBadge();
                showDMNotificationToast(payload.senderName, payload.text);
            }
        })
        .on('presence', { event: 'sync' }, () => {
            const st = activeDMChannel.presenceState();
            const otherOnline = Object.keys(st).some(k => k !== getMyEmail().toLowerCase());
            if (otherOnline) showDMStatus(`\u2705 ${activeDMTarget.name} esta en la conversacion`);
            else showDMStatus(`\u23f3 Esperando a que ${activeDMTarget.name} abra el chat...`);
        })
        .on('presence', { event: 'join' }, ({ key }) => {
            if (key !== getMyEmail().toLowerCase()) {
                showDMStatus(`\u2705 ${activeDMTarget.name} esta en la conversacion`);
                appendSystemMessage(`${activeDMTarget.name} se unio al chat`);
            }
        })
        .on('presence', { event: 'leave' }, ({ key }) => {
            if (key !== getMyEmail().toLowerCase()) {
                showDMStatus(`\u23f3 ${activeDMTarget.name} salio del chat`);
                appendSystemMessage(`${activeDMTarget.name} salio del chat`);
            }
        })
        .subscribe(async (status) => {
            if (status === 'SUBSCRIBED') {
                await activeDMChannel.track({ email: getMyEmail() });
                if (dmTextarea) {
                    dmTextarea.disabled = false;
                    dmTextarea.placeholder = `Mensaje privado a ${activeDMTarget.name}... (Enter para enviar)`;
                    dmTextarea.focus();
                }
                if (dmSendBtn) dmSendBtn.disabled = false;
            } else if (status === 'CHANNEL_ERROR') {
                showDMStatus('\u26a0\ufe0f Error en canal \u2014 reintentando...');
                setTimeout(() => subscribeToDMChannel(convId), 3000);
            }
        });
}

function unsubscribeDMChannel() {
    if (activeDMChannel && supabase) {
        supabase.removeChannel(activeDMChannel);
        activeDMChannel = null;
    }
    activeDMConvId = null;
}

let activeDMReplyTarget = null; // { author: string, text: string }

function setDMReplyTarget(author, text) {
    activeDMReplyTarget = { author, text };
    const bar = document.getElementById('dm-reply-preview-bar');
    const authorEl = document.getElementById('dm-reply-target-author');
    const textEl = document.getElementById('dm-reply-target-text');
    if (bar && authorEl && textEl) {
        authorEl.textContent = author;
        textEl.textContent = text.length > 50 ? text.slice(0, 50) + '…' : text;
        bar.classList.remove('hidden');
    }
    if (dmTextarea) dmTextarea.focus();
}

function clearDMReplyTarget() {
    activeDMReplyTarget = null;
    const bar = document.getElementById('dm-reply-preview-bar');
    if (bar) bar.classList.add('hidden');
}

// --- ENVIAR ---
function sendDM() {
    if (!dmTextarea || !activeDMChannel || !activeDMConvId) return;
    const text = dmTextarea.value.trim();
    if (!text) return;

    const payload = {
        convId: activeDMConvId,
        senderEmail: getMyEmail(),
        senderName: getMyName(),
        text,
        ts: Date.now(),
        replyTo: activeDMReplyTarget ? { author: activeDMReplyTarget.author, text: activeDMReplyTarget.text } : null
    };

    clearDMReplyTarget();

    saveDMMessageToStorage(activeDMConvId, payload);
    renderDMMessage(payload, true);
    activeDMChannel.send({ type: 'broadcast', event: 'dm', payload });

    // Enviar ping al canal de notificación del destinatario
    // Esto le avisa aunque no tenga el panel DM abierto con nosotros
    if (supabase && activeDMTarget.email) {
        const pingChannel = supabase.channel(`dm-notify:${activeDMTarget.email.toLowerCase()}`, {
            config: { broadcast: { self: false } }
        });
        pingChannel.subscribe(status => {
            if (status === 'SUBSCRIBED') {
                pingChannel.send({
                    type: 'broadcast',
                    event: 'dm-ping',
                    payload: {
                        convId: activeDMConvId,
                        senderEmail: getMyEmail(),
                        senderName: getMyName(),
                        text: payload.text,
                        ts: payload.ts
                    }
                });
                // Desuscribir después de enviar (canal de un solo uso)
                setTimeout(() => {
                    try { supabase.removeChannel(pingChannel); } catch(e){}
                }, 2000);
            }
        });
    }

    dmTextarea.value = '';
    dmTextarea.style.height = 'auto';
    dmTextarea.focus();
}

// --- GESTION DE ALMACENAMIENTO EFIMERO ROTATIVO (MAX 4 POR USUARIO / 8 TOTALES) ---
const MAX_MESSAGES_PER_CONV = 8; // Max 4 de cada persona

function loadDMMessagesFromStorage(convId) {
    try {
        const raw = localStorage.getItem(`nexus_dm_buffer_${convId}`);
        if (!raw) return [];
        return JSON.parse(raw) || [];
    } catch(e) {
        return [];
    }
}

function saveDMMessageToStorage(convId, msg) {
    try {
        let list = loadDMMessagesFromStorage(convId);
        list.push(msg);
        
        // Si excede el máximo rotativo (8 mensajes), eliminar los más antiguos
        if (list.length > MAX_MESSAGES_PER_CONV) {
            list = list.slice(list.length - MAX_MESSAGES_PER_CONV);
        }
        
        localStorage.setItem(`nexus_dm_buffer_${convId}`, JSON.stringify(list));
        return list;
    } catch(e) {
        return [];
    }
}

// --- RENDER ---
function renderDMMessage(msg, isOwn) {
    if (!dmMessages) return;
    const empty = dmMessages.querySelector('.dm-empty-state');
    if (empty) empty.remove();

    const { initial, color } = getAvatarData(msg.senderName);
    const myData = getAvatarData(getMyName());
    const timeStr = relTime(msg.ts || Date.now());

    const safeAuthor = (msg.senderName || '').replace(/'/g, "\\'");
    const safeText = (msg.text || '').replace(/'/g, "\\'").replace(/\n/g, ' ');

    let replyQuoteHtml = '';
    if (msg.replyTo) {
        replyQuoteHtml = `
            <div class="message-reply-quote" style="margin-bottom: 4px;">
                <span>↩️</span>
                <span class="reply-quote-author">${esc(msg.replyTo.author)}:</span>
                <span class="reply-quote-text">${esc(msg.replyTo.text.length > 40 ? msg.replyTo.text.slice(0, 40) + '…' : msg.replyTo.text)}</span>
            </div>
        `;
    }

    const replyBtnHtml = `<button class="reply-msg-btn" onclick="window.replyToDMMessage('${safeAuthor}', '${safeText}')" title="Responder">↩️</button>`;

    const bubble = document.createElement('div');
    bubble.className = `dm-message ${isOwn ? 'dm-message-own' : 'dm-message-other'}`;
    bubble.innerHTML = `
        ${!isOwn ? `<div class="dm-msg-avatar" style="background:${color}" title="${esc(msg.senderName)}">${initial}</div>` : ''}
        <div class="dm-bubble-wrapper">
            ${replyQuoteHtml}
            ${!isOwn ? `<div class="dm-msg-name" style="display:flex;align-items:center;justify-content:space-between;"><span>${esc(msg.senderName)}</span> ${replyBtnHtml}</div>` : ''}
            <div class="dm-bubble ${isOwn ? 'dm-bubble-own' : 'dm-bubble-other'}">
                ${esc(msg.text)}
                ${isOwn ? `<span style="float:right;margin-left:8px;">${replyBtnHtml}</span>` : ''}
            </div>
            <div class="dm-msg-time">${timeStr}</div>
        </div>
        ${isOwn ? `<div class="dm-msg-avatar dm-msg-avatar-own" style="background:${myData.color}" title="Tu">${myData.initial}</div>` : ''}
    `;
    dmMessages.appendChild(bubble);

    // Auto-limpieza en memoria del DOM: Mantener solo los últimos MAX_MESSAGES_PER_CONV mensajes visuales
    const currentMsgElements = dmMessages.querySelectorAll('.dm-message');
    if (currentMsgElements.length > MAX_MESSAGES_PER_CONV) {
        const toRemoveCount = currentMsgElements.length - MAX_MESSAGES_PER_CONV;
        for (let i = 0; i < toRemoveCount; i++) {
            currentMsgElements[i].remove();
        }
    }

    dmMessages.scrollTop = dmMessages.scrollHeight;
}

function appendSystemMessage(text) {
    if (!dmMessages) return;
    const div = document.createElement('div');
    div.className = 'dm-system-msg';
    div.textContent = text;
    dmMessages.appendChild(div);
    dmMessages.scrollTop = dmMessages.scrollHeight;
}

// --- CONTROL DEL PANEL ---
function openPanel() {
    if (!dmPanel) return;
    dmPanel.classList.remove('hidden', 'dm-panel-closing');
    dmPanel.classList.add('dm-panel-open');
    isPanelOpen = true;
    unreadDMCount = 0;
    updateDMBadge();
}

export function closeDMPanel() {
    if (!dmPanel) return;
    dmPanel.classList.add('dm-panel-closing');
    setTimeout(() => {
        dmPanel.classList.add('hidden');
        dmPanel.classList.remove('dm-panel-open', 'dm-panel-closing');
        isPanelOpen = false;
    }, 280);
    unsubscribeDMChannel();
    activeDMTarget = { email: null, name: null };
    if (dmTextarea) { dmTextarea.disabled = true; dmTextarea.value = ''; }
    if (dmSendBtn) dmSendBtn.disabled = true;
}

function updateDMHeader(name) {
    if (!dmTargetName || !dmAvatar) return;
    dmTargetName.textContent = name;
    const { initial, color } = getAvatarData(name);
    dmAvatar.textContent = initial;
    dmAvatar.style.background = color;
    dmAvatar.style.color = '#fff';
}

function showDMStatus(text) {
    if (dmStatusEl) dmStatusEl.textContent = text;
}

function updateDMBadge() {
    if (!dmUnreadBadge) return;
    if (unreadDMCount > 0) {
        dmUnreadBadge.textContent = unreadDMCount > 9 ? '9+' : unreadDMCount;
        dmUnreadBadge.classList.remove('hidden');
    } else {
        dmUnreadBadge.classList.add('hidden');
    }
}

function showNullEmailWarning() {
    if (!dmPanel) return;
    updateDMHeader('Usuario desconocido');
    if (dmMessages) {
        dmMessages.innerHTML = `
            <div class="dm-empty-state">
                <div class="dm-empty-icon">\u26a0\ufe0f</div>
                <h3>No se puede iniciar el chat</h3>
                <p>Este usuario no tiene un identificador seguro. Puede que use una version anterior de Nexus.</p>
            </div>
        `;
    }
    if (dmTextarea) dmTextarea.disabled = true;
    if (dmSendBtn) dmSendBtn.disabled = true;
    openPanel();
}

// --- TOAST DE NOTIFICACION ---
function showDMNotificationToast(senderName, text) {
    const toast = document.createElement('div');
    toast.className = 'dm-toast';
    toast.innerHTML = `
        <div class="dm-toast-header">
            <span class="dm-toast-icon">\ud83d\udcac</span>
            <span class="dm-toast-from">${esc(senderName)}</span>
            <span class="dm-toast-tag">Privado</span>
        </div>
        <div class="dm-toast-text">${esc(text.length > 60 ? text.slice(0,60) + '\u2026' : text)}</div>
    `;
    toast.style.cursor = 'pointer';
    toast.addEventListener('click', () => toast.remove());
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('dm-toast-hide');
        setTimeout(() => toast.remove(), 400);
    }, 5000);
}

// Toast especial con boton "Abrir" para DMs recibidos via canal de notificacion
function showDMPingToast(senderEmail, senderName, text, ts) {
    // Evitar toasts duplicados del mismo remitente
    const existing = document.querySelector(`.dm-toast[data-sender="${senderEmail}"]`);
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'dm-toast dm-toast-ping';
    toast.dataset.sender = senderEmail;
    toast.innerHTML = `
        <div class="dm-toast-header">
            <span class="dm-toast-icon">&#128172;</span>
            <span class="dm-toast-from">${esc(senderName)}</span>
            <span class="dm-toast-tag">Mensaje privado</span>
        </div>
        <div class="dm-toast-text">${esc((text || '').length > 55 ? (text || '').slice(0, 55) + '\u2026' : (text || ''))}</div>
        <button class="dm-toast-open-btn">Abrir chat &#8594;</button>
    `;

    // Clic en el boton "Abrir" — abre directamente la conversacion
    const openBtn = toast.querySelector('.dm-toast-open-btn');
    if (openBtn) {
        openBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toast.remove();
            openDMWith(senderEmail, senderName);
        });
    }

    // Clic en el toast (fuera del boton) lo descarta
    toast.addEventListener('click', (e) => {
        if (!e.target.closest('.dm-toast-open-btn')) toast.remove();
    });

    document.body.appendChild(toast);

    // Auto-dismiss en 8 segundos (mas tiempo porque tiene boton de accion)
    setTimeout(() => {
        toast.classList.add('dm-toast-hide');
        setTimeout(() => toast.remove(), 400);
    }, 8000);
}
