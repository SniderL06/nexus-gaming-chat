/* NEXUS DIRECT MESSAGES MODULE — EFÍMERO VIA SUPABASE BROADCAST + DM HUB */

import { supabase, supabaseReady } from './supabase-client.js';

// Estado local del módulo DM
let dmPanel         = null;
let dmHubView       = null;
let dmChatView      = null;
let dmSearchInput   = null;
let dmSearchClearBtn= null;
let dmSearchResults = null;
let dmConvosList    = null;
let dmBackBtn       = null;

let dmMessages      = null;
let dmTextarea      = null;
let dmSendBtn       = null;
let dmCloseBtn      = null;
let dmCloseBtnChat  = null;
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

// Límite de mensajes por conversación (aumentado de 8 a 100)
const MAX_MESSAGES_PER_CONV = 100;

// --- UTILIDADES ---

function getConvId(emailA, emailB) {
    return [emailA.toLowerCase(), emailB.toLowerCase()].sort().join(':');
}

function getMyEmail() {
    return localStorage.getItem('nexus_user_email') || '';
}

function getMyName() {
    const email = getMyEmail();
    if (!email) return 'Tú';
    const customName = localStorage.getItem('nexus_username_' + email);
    if (customName) return customName;
    const base = email.split('@')[0];
    return base.charAt(0).toUpperCase() + base.slice(1);
}

function esc(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/[&<>'"]/g, t => (
        {'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[t] || t
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

// --- GESTIÓN DE CONVERSACIONES RECIENTES EN LOCALSTORAGE ---

function getRecentConversations() {
    try {
        const raw = localStorage.getItem('nexus_dm_conversations');
        return raw ? JSON.parse(raw) : [];
    } catch(e) {
        return [];
    }
}

function saveRecentConversation(targetEmail, targetName, lastText) {
    try {
        let convos = getRecentConversations();
        const existingIdx = convos.findIndex(c => c.email.toLowerCase() === targetEmail.toLowerCase());
        const entry = {
            email: targetEmail,
            name: targetName || targetEmail,
            lastText: lastText || 'Chat iniciado',
            ts: Date.now()
        };

        if (existingIdx >= 0) {
            convos[existingIdx] = entry;
        } else {
            convos.unshift(entry);
        }

        // Ordenar por más reciente primero
        convos.sort((a, b) => (b.ts || 0) - (a.ts || 0));
        // Guardar hasta 30 contactos recientes
        convos = convos.slice(0, 30);
        localStorage.setItem('nexus_dm_conversations', JSON.stringify(convos));
    } catch(e) {
        console.warn('[DM] Error al guardar conversación reciente:', e);
    }
}

// --- BUSCADOR DE PERSONAS ---

function getDiscoverableUsers() {
    const list = [];
    const seen = new Set();
    const myEmail = getMyEmail().toLowerCase();

    // 1. Usuarios en línea desde window.nexusOnlineUsers
    if (Array.isArray(window.nexusOnlineUsers)) {
        window.nexusOnlineUsers.forEach(u => {
            const email = (u.email || '').toLowerCase();
            if (email && email !== myEmail && !seen.has(email)) {
                seen.add(email);
                list.push({
                    name: u.name || email.split('@')[0],
                    email: u.email,
                    isOnline: true
                });
            }
        });
    }

    // 2. Usuarios de conversaciones previas
    const recent = getRecentConversations();
    recent.forEach(c => {
        const email = (c.email || '').toLowerCase();
        if (email && email !== myEmail && !seen.has(email)) {
            seen.add(email);
            list.push({
                name: c.name,
                email: c.email,
                isOnline: false
            });
        }
    });

    return list;
}

function handleSearch(query) {
    if (!dmSearchResults) return;
    const q = (query || '').trim().toLowerCase();

    if (!q) {
        dmSearchResults.classList.add('hidden');
        dmSearchResults.innerHTML = '';
        if (dmSearchClearBtn) dmSearchClearBtn.classList.add('hidden');
        return;
    }

    if (dmSearchClearBtn) dmSearchClearBtn.classList.remove('hidden');

    const users = getDiscoverableUsers().filter(u => 
        u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
    );

    dmSearchResults.innerHTML = '';
    dmSearchResults.classList.remove('hidden');

    if (users.length === 0) {
        // Permitir chatear con un email directo si tiene formato email
        const isEmailFormat = q.includes('@') && q.includes('.');
        dmSearchResults.innerHTML = `
            <div class="dm-user-result-item" style="cursor: ${isEmailFormat ? 'pointer' : 'default'};">
                <div class="dm-user-result-avatar">?</div>
                <div class="dm-user-result-info">
                    <div class="dm-user-result-name">${isEmailFormat ? 'Chatear con correo directo:' : 'No se encontraron usuarios'}</div>
                    <div class="dm-user-result-sub">${esc(q)}</div>
                </div>
                ${isEmailFormat ? '<span class="dm-user-result-badge">Iniciar</span>' : ''}
            </div>
        `;
        if (isEmailFormat) {
            const item = dmSearchResults.querySelector('.dm-user-result-item');
            item.addEventListener('click', () => {
                const name = q.split('@')[0];
                openDMWith(q, name.charAt(0).toUpperCase() + name.slice(1));
            });
        }
        return;
    }

    users.forEach(u => {
        const { initial, color } = getAvatarData(u.name);
        const item = document.createElement('div');
        item.className = 'dm-user-result-item';
        item.innerHTML = `
            <div class="dm-user-result-avatar" style="background: ${color}">${initial}</div>
            <div class="dm-user-result-info">
                <div class="dm-user-result-name">${esc(u.name)}</div>
                <div class="dm-user-result-sub">${esc(u.email)}</div>
            </div>
            ${u.isOnline ? '<span class="dm-user-result-badge">En línea</span>' : ''}
        `;
        item.addEventListener('click', () => {
            openDMWith(u.email, u.name);
        });
        dmSearchResults.appendChild(item);
    });
}

function renderConversationsList() {
    if (!dmConvosList) return;
    const convos = getRecentConversations();

    if (convos.length === 0) {
        dmConvosList.innerHTML = `
            <div class="dm-no-convos">
                <div class="dm-no-convos-icon">📭</div>
                <p>Ninguna conversación aún.<br>Busca a alguien arriba o usa 💬 en la lista de usuarios.</p>
            </div>
        `;
        return;
    }

    dmConvosList.innerHTML = '';
    convos.forEach(c => {
        const { initial, color } = getAvatarData(c.name);
        const isActive = activeDMTarget.email && activeDMTarget.email.toLowerCase() === c.email.toLowerCase();
        const item = document.createElement('div');
        item.className = `dm-convo-item ${isActive ? 'active' : ''}`;
        item.innerHTML = `
            <div class="dm-convo-avatar" style="background: ${color}">${initial}</div>
            <div class="dm-convo-info">
                <div class="dm-convo-name">${esc(c.name)}</div>
                <div class="dm-convo-snippet">${esc(c.lastText)}</div>
            </div>
        `;
        item.addEventListener('click', () => {
            openDMWith(c.email, c.name);
        });
        dmConvosList.appendChild(item);
    });
}

// --- VISTAS: HUB vs CHAT ---

function showHubView() {
    if (dmHubView) dmHubView.classList.remove('hidden');
    if (dmChatView) dmChatView.classList.add('hidden');
    renderConversationsList();
    if (dmSearchInput) {
        dmSearchInput.value = '';
        handleSearch('');
    }
}

function showChatView() {
    if (dmHubView) dmHubView.classList.add('hidden');
    if (dmChatView) dmChatView.classList.remove('hidden');
}

// --- INICIALIZACION ---

export function initDM() {
    dmPanel         = document.getElementById('dm-panel');
    dmHubView       = document.getElementById('dm-hub-view');
    dmChatView      = document.getElementById('dm-chat-view');
    dmSearchInput   = document.getElementById('dm-search-input');
    dmSearchClearBtn= document.getElementById('dm-search-clear-btn');
    dmSearchResults = document.getElementById('dm-search-results');
    dmConvosList    = document.getElementById('dm-conversations-list');
    dmBackBtn       = document.getElementById('dm-back-btn');

    dmMessages      = document.getElementById('dm-messages');
    dmTextarea      = document.getElementById('dm-textarea');
    dmSendBtn       = document.getElementById('dm-send-btn');
    dmCloseBtn      = document.getElementById('dm-close-btn');
    dmCloseBtnChat  = document.getElementById('dm-close-btn-chat');
    dmTargetName    = document.getElementById('dm-target-name');
    dmAvatar        = document.getElementById('dm-avatar');
    dmUnreadBadge   = document.getElementById('dm-unread-badge');
    dmSidebarBtn    = document.getElementById('dm-sidebar-btn');
    dmStatusEl      = document.getElementById('dm-status');

    // Botones de cierre
    if (dmCloseBtn) dmCloseBtn.addEventListener('click', closeDMPanel);
    if (dmCloseBtnChat) dmCloseBtnChat.addEventListener('click', closeDMPanel);

    // Botón volver al Hub desde el Chat
    if (dmBackBtn) {
        dmBackBtn.addEventListener('click', () => {
            showHubView();
        });
    }

    // Buscador
    if (dmSearchInput) {
        dmSearchInput.addEventListener('input', (e) => {
            handleSearch(e.target.value);
        });
        dmSearchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                dmSearchInput.value = '';
                handleSearch('');
            }
        });
    }

    if (dmSearchClearBtn) {
        dmSearchClearBtn.addEventListener('click', () => {
            if (dmSearchInput) {
                dmSearchInput.value = '';
                dmSearchInput.focus();
            }
            handleSearch('');
        });
    }

    // Botón de barra lateral DM
    if (dmSidebarBtn) {
        dmSidebarBtn.addEventListener('click', () => {
            if (isPanelOpen) {
                closeDMPanel();
            } else {
                showHubView();
                openPanel();
            }
        });
    }

    // Textarea y envío
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
    const myEmail = getMyEmail();
    if (myEmail && supabase) {
        subscribeToNotifyChannel(myEmail);
    }
}

// --- CANAL DE NOTIFICACION PERSONAL ---

function subscribeToNotifyChannel(myEmail) {
    if (!supabase) return;
    if (notifyChannel) {
        try { supabase.removeChannel(notifyChannel); } catch(e){}
        notifyChannel = null;
    }

    notifyChannel = supabase.channel(`dm-notify:${myEmail.toLowerCase()}`, {
        config: { broadcast: { self: false } }
    });

    notifyChannel
        .on('broadcast', { event: 'dm-ping' }, ({ payload }) => {
            const { senderEmail, senderName, convId, text, ts, replyTo } = payload;

            saveDMMessageToStorage(convId, { convId, senderEmail, senderName, text, ts, replyTo });
            saveRecentConversation(senderEmail, senderName, text);

            if (convId === activeDMConvId) {
                if (isPanelOpen) {
                    renderDMMessage({ text, senderName, ts, replyTo }, false);
                }
                return;
            }

            showDMPingToast(senderEmail, senderName, text, ts);
            unreadDMCount++;
            updateDMBadge();
            renderConversationsList();
        })
        .subscribe();
}

// --- ABRIR CONVERSACION ---

export function openDMWith(targetEmail, targetName) {
    const myEmail = getMyEmail();
    if (!myEmail) { console.warn('[DM] Sin sesión.'); return; }
    if (!targetEmail) { showNullEmailWarning(); return; }
    if (targetEmail.toLowerCase() === myEmail.toLowerCase()) return;

    const convId = getConvId(myEmail, targetEmail);
    activeDMConvId  = convId;
    activeDMTarget  = { email: targetEmail, name: targetName || targetEmail };

    saveRecentConversation(activeDMTarget.email, activeDMTarget.name, 'Conversación abierta');

    if (dmMessages) dmMessages.innerHTML = '';
    updateDMHeader(activeDMTarget.name);

    showChatView();
    openPanel();
    showDMStatus('⚡ Chat efímero · Mensajes sincronizados en tiempo real');

    // Cargar buffer rotativo local guardado (hasta 100 mensajes)
    const savedMessages = loadDMMessagesFromStorage(convId);
    savedMessages.forEach(msg => {
        const isOwn = (msg.senderEmail || '').toLowerCase() === myEmail.toLowerCase();
        renderDMMessage(msg, isOwn);
    });

    subscribeToDMChannel(convId);

    unreadDMCount = 0;
    updateDMBadge();
}

// --- SUSCRIPCION BROADCAST ---

function subscribeToDMChannel(convId) {
    if (!supabase) { showDMStatus('⚠️ Sin conexión a Supabase'); return; }

    const myKey = getMyEmail().toLowerCase().replace(/[^a-zA-Z0-9]/g, '_');

    if (activeDMChannel) {
        try { supabase.removeChannel(activeDMChannel); } catch(e){}
        activeDMChannel = null;
    }

    activeDMChannel = supabase.channel(`dm-broadcast:${convId}`, {
        config: {
            broadcast: { self: false },
            presence: { key: myKey }
        }
    });

    activeDMChannel
        .on('broadcast', { event: 'dm' }, ({ payload }) => {
            if (payload.convId !== activeDMConvId) return;
            saveDMMessageToStorage(payload.convId, payload);
            saveRecentConversation(activeDMTarget.email, activeDMTarget.name, payload.text);
            renderDMMessage({ text: payload.text, senderName: payload.senderName, ts: payload.ts, replyTo: payload.replyTo }, false);
            if (!isPanelOpen) {
                unreadDMCount++;
                updateDMBadge();
                showDMNotificationToast(payload.senderName, payload.text);
            }
        })
        .on('presence', { event: 'sync' }, () => {
            const st = activeDMChannel.presenceState();
            const otherOnline = Object.keys(st).some(k => k !== myKey);
            if (otherOnline) showDMStatus(`✅ ${activeDMTarget.name} está en el chat`);
            else showDMStatus(`⏳ Esperando a que ${activeDMTarget.name} abra el chat...`);
        })
        .on('presence', { event: 'join' }, ({ key }) => {
            if (key !== myKey) {
                showDMStatus(`✅ ${activeDMTarget.name} está en el chat`);
                appendSystemMessage(`${activeDMTarget.name} se unió al chat`);
            }
        })
        .on('presence', { event: 'leave' }, ({ key }) => {
            if (key !== myKey) {
                showDMStatus(`⏳ ${activeDMTarget.name} salió del chat`);
                appendSystemMessage(`${activeDMTarget.name} salió del chat`);
            }
        })
        .subscribe(async (status) => {
            if (status === 'SUBSCRIBED') {
                await activeDMChannel.track({ email: getMyEmail(), name: getMyName() });
                if (dmTextarea) {
                    dmTextarea.disabled = false;
                    dmTextarea.placeholder = `Mensaje privado a ${activeDMTarget.name}... (Enter para enviar)`;
                    dmTextarea.focus();
                }
                if (dmSendBtn) dmSendBtn.disabled = false;
            } else if (status === 'CHANNEL_ERROR') {
                showDMStatus('⚠️ Error en canal — reintentando...');
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
    saveRecentConversation(activeDMTarget.email, activeDMTarget.name, payload.text);
    renderDMMessage(payload, true);
    activeDMChannel.send({ type: 'broadcast', event: 'dm', payload });

    // Enviar ping al canal de notificación del destinatario
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
                        ts: payload.ts,
                        replyTo: payload.replyTo
                    }
                });
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

// --- ALMACENAMIENTO DE MENSAJES (HASTA 100) ---

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
        ${isOwn ? `<div class="dm-msg-avatar dm-msg-avatar-own" style="background:${myData.color}" title="Tú">${myData.initial}</div>` : ''}
    `;
    dmMessages.appendChild(bubble);

    // Mantener solo los últimos MAX_MESSAGES_PER_CONV en DOM
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
                <div class="dm-empty-icon">⚠️</div>
                <h3>No se puede iniciar el chat</h3>
                <p>Este usuario no tiene un identificador seguro disponible.</p>
            </div>
        `;
    }
    if (dmTextarea) dmTextarea.disabled = true;
    if (dmSendBtn) dmSendBtn.disabled = true;
    showChatView();
    openPanel();
}

// --- TOAST DE NOTIFICACION ---

function showDMNotificationToast(senderName, text) {
    const toast = document.createElement('div');
    toast.className = 'dm-toast';
    toast.innerHTML = `
        <div class="dm-toast-header">
            <span class="dm-toast-icon">💬</span>
            <span class="dm-toast-from">${esc(senderName)}</span>
            <span class="dm-toast-tag">Privado</span>
        </div>
        <div class="dm-toast-text">${esc(text.length > 60 ? text.slice(0,60) + '…' : text)}</div>
    `;
    toast.style.cursor = 'pointer';
    toast.addEventListener('click', () => toast.remove());
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('dm-toast-hide');
        setTimeout(() => toast.remove(), 400);
    }, 5000);
}

function showDMPingToast(senderEmail, senderName, text, ts) {
    const existing = document.querySelector(`.dm-toast[data-sender="${senderEmail}"]`);
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'dm-toast dm-toast-ping';
    toast.dataset.sender = senderEmail;
    toast.innerHTML = `
        <div class="dm-toast-header">
            <span class="dm-toast-icon">💬</span>
            <span class="dm-toast-from">${esc(senderName)}</span>
            <span class="dm-toast-tag">Mensaje privado</span>
        </div>
        <div class="dm-toast-text">${esc((text || '').length > 55 ? (text || '').slice(0, 55) + '…' : (text || ''))}</div>
        <button class="dm-toast-open-btn">Abrir chat →</button>
    `;

    const openBtn = toast.querySelector('.dm-toast-open-btn');
    if (openBtn) {
        openBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toast.remove();
            openDMWith(senderEmail, senderName);
        });
    }

    toast.addEventListener('click', (e) => {
        if (!e.target.closest('.dm-toast-open-btn')) toast.remove();
    });

    document.body.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('dm-toast-hide');
        setTimeout(() => toast.remove(), 400);
    }, 8000);
}
