/* NEXUS TEXT CHAT & IMAGE/MEME SHARING SYSTEM — SUPABASE REALTIME (ES MODULE) */

import { state, updateRenderLatency } from './app.js';
import { isUserOp } from './voice.js';
import { playMusicCommand, skipMusicCommand, stopMusic } from './music.js';
import { supabase, supabaseReady } from './supabase-client.js';

// ─────────────────────────────────────────────────────────────
// UTILIDAD DE TIMESTAMPS EN TIEMPO REAL
// ─────────────────────────────────────────────────────────────
export function relativeTime(ts) {
    const diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 5)  return 'Justo ahora';
    if (diff < 60) return `Hace ${diff} segundo${diff === 1 ? '' : 's'}`;
    const mins = Math.floor(diff / 60);
    if (mins < 60) return `Hace ${mins} minuto${mins === 1 ? '' : 's'}`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24)  return `Hace ${hrs} hora${hrs === 1 ? '' : 's'}`;
    const days = Math.floor(hrs / 24);
    if (days < 7)  return `Hace ${days} día${days === 1 ? '' : 's'}`;
    return new Date(ts).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
}

let timestampRefreshTimer = null;
function startTimestampRefreshLoop() {
    if (timestampRefreshTimer) return;
    timestampRefreshTimer = setInterval(() => {
        document.querySelectorAll('[data-ts]').forEach(node => {
            const ts = parseInt(node.getAttribute('data-ts'), 10);
            if (!isNaN(ts)) node.textContent = relativeTime(ts);
        });
    }, 30_000);
}

// ─────────────────────────────────────────────────────────────
// DATOS INICIALES (FALLBACK LOCAL)
// ─────────────────────────────────────────────────────────────
const NOW = Date.now();
const MIN = 60_000;
const initialChannelMessages = {
    general: [],
    lounge: [],
    'clips-and-memes': [],
    estrategia: []
};

const memeTemplates = [
    { id: 'nexus_opt',    name: 'Nexus vs Discord',        img: 'assets/nexus_optimized.png',   tags: 'nexus discord electron optimizacion robot neon' },
    { id: 'doge_gamer',   name: 'Doge Gaming Setup',       img: 'assets/doge_gaming.png',        tags: 'doge perro setup monitor rgb fps rapido' },
    { id: 'pikachu_surp', name: 'Surprised Pikachu Gamer', img: 'assets/pikachu_surprised.png',  tags: 'pikachu sorprendido victoria derrota mouse neon shock' }
];

// Estado local
let currentMessages = JSON.parse(JSON.stringify(initialChannelMessages));
let activeAttachment = null;

// Supabase Realtime subscription
let currentRealtimeChannel = null;
let isUsingSupabase = false;

// Referencias DOM
let chatContainer;
let chatTextarea;
let fileInput;
let attachmentPreviewBar;
let memesPopover;
let memesGrid;

// ─────────────────────────────────────────────────────────────
// INICIALIZACIÓN
// ─────────────────────────────────────────────────────────────
export function initChat() {
    chatContainer       = document.getElementById('chat-messages-container');
    chatTextarea        = document.getElementById('chat-textarea');
    fileInput           = document.getElementById('file-input');
    attachmentPreviewBar= document.getElementById('attachment-preview-bar');
    memesPopover        = document.getElementById('memes-popover');
    memesGrid           = document.getElementById('memes-grid-list');

    renderMessages();
    startTimestampRefreshLoop();

    // Conectar a Supabase si está disponible
    if (supabaseReady && supabase) {
        isUsingSupabase = true;
        loadMessagesFromSupabase(state.activeChannel);
        subscribeToChannel(state.activeChannel);
    }

    // Escuchar si Supabase se conecta después
    window.addEventListener('supabase-ready', (e) => {
        isUsingSupabase = true;
        loadMessagesFromSupabase(state.activeChannel);
        subscribeToChannel(state.activeChannel);
    });

    // Enviar con Enter
    if (chatTextarea) {
        chatTextarea.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
        chatTextarea.addEventListener('input', () => {
            chatTextarea.style.height = 'auto';
            chatTextarea.style.height = Math.min(chatTextarea.scrollHeight, 120) + 'px';
        });
    }

    // Adjunto
    const attachmentBtn = document.getElementById('attachment-btn');
    if (attachmentBtn && fileInput) {
        attachmentBtn.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            if (file.size > 15 * 1024 * 1024) { alert('El archivo supera el límite de 15 MB.'); return; }
            const isImage = file.type.startsWith('image/');
            const reader = new FileReader();
            reader.onload = (event) => {
                activeAttachment = { name: file.name, size: (file.size / 1024).toFixed(1) + ' KB', dataUrl: event.target.result, isImage, type: file.type };
                showAttachmentPreview();
            };
            reader.readAsDataURL(file);
        });
    }

    const previewRemoveBtn = document.getElementById('preview-remove-btn');
    if (previewRemoveBtn) previewRemoveBtn.addEventListener('click', clearAttachment);

    const memeBtn = document.getElementById('meme-btn');
    if (memeBtn && memesPopover) {
        memeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            memesPopover.classList.toggle('hidden');
            renderMemeTemplates(memeTemplates);
        });
    }

    const memesCloseBtn = document.getElementById('memes-popover-close');
    if (memesCloseBtn) memesCloseBtn.addEventListener('click', () => memesPopover?.classList.add('hidden'));

    const memeSearchInput = document.getElementById('meme-search-input');
    if (memeSearchInput) {
        memeSearchInput.addEventListener('input', (e) => {
            const q = e.target.value.toLowerCase();
            renderMemeTemplates(memeTemplates.filter(m => m.name.toLowerCase().includes(q) || m.tags.includes(q)));
        });
    }

    document.addEventListener('click', (e) => {
        if (memesPopover && !memesPopover.classList.contains('hidden') && !memesPopover.contains(e.target) && e.target.id !== 'meme-btn' && !e.target.closest('#meme-btn')) {
            memesPopover.classList.add('hidden');
        }
    });

    setupLightbox();
}

// ─────────────────────────────────────────────────────────────
// SUPABASE REALTIME
// ─────────────────────────────────────────────────────────────
async function loadMessagesFromSupabase(channelId) {
    if (!supabase) return;
    try {
        const { data, error } = await supabase
            .from('messages')
            .select('*')
            .eq('channel_id', channelId)
            .order('created_at', { ascending: true })
            .limit(100);

        if (error) throw error;

        if (data && data.length > 0) {
            // Convertir formato Supabase a formato interno
            currentMessages[channelId] = data.map(row => ({
                id: row.id,
                author: row.author,
                avatar: row.avatar || row.author.charAt(0).toUpperCase(),
                avatarBg: row.avatar_bg || 'bg-blue',
                ts: new Date(row.created_at).getTime(),
                text: row.text || '',
                image: row.image || null,
                file: row.file || null
            }));
            renderMessages();
        }
    } catch (err) {
        console.warn('[Chat] No se pudieron cargar mensajes de Supabase:', err.message);
    }
}

function subscribeToChannel(channelId) {
    if (!supabase) return;

    // Cancelar suscripción anterior
    if (currentRealtimeChannel) {
        supabase.removeChannel(currentRealtimeChannel);
        currentRealtimeChannel = null;
    }

    // Suscribirse a inserciones y borrados en tiempo real
    // NOTA: No usamos filter del lado del servidor porque requiere REPLICA IDENTITY FULL
    // en Supabase para funcionar con INSERT. Filtramos localmente para mayor compatibilidad.
    currentRealtimeChannel = supabase
        .channel(`chat:${channelId}`)
        .on('postgres_changes', {
            event: '*', // Escuchar INSERT, DELETE, UPDATE
            schema: 'public',
            table: 'messages'
        }, (payload) => {
            // Filtrar localmente por canal para no mezclar canales
            const rowChannelId = payload.new?.channel_id || payload.old?.channel_id;
            if (rowChannelId && rowChannelId !== channelId) return;

            if (payload.eventType === 'INSERT') {
                const row = payload.new;
                const myName = getLocalUserName();
                // No duplicar mensajes propios que ya renderizamos localmente
                if (row.author === myName) return;
                // Evitar duplicados si el mensaje ya existe en el estado local
                const existing = currentMessages[channelId]?.find(m => m.id === row.id);
                if (existing) return;

                const msg = {
                    id: row.id,
                    author: row.author,
                    avatar: row.avatar || row.author.charAt(0).toUpperCase(),
                    avatarBg: row.avatar_bg || 'bg-blue',
                    ts: new Date(row.created_at).getTime(),
                    text: row.text || '',
                    image: row.image || null,
                    file: row.file ? (typeof row.file === 'string' ? JSON.parse(row.file) : row.file) : null
                };

                if (!currentMessages[channelId]) currentMessages[channelId] = [];
                currentMessages[channelId].push(msg);

                if (state.activeChannel === channelId && chatContainer) {
                    chatContainer.appendChild(createMessageElement(msg));
                    scrollToBottom();
                    showIncomingMessageIndicator(msg.author);
                }
            } else if (payload.eventType === 'DELETE') {
                const deletedId = payload.old.id;
                if (currentMessages[channelId]) {
                    currentMessages[channelId] = currentMessages[channelId].filter(m => m.id !== deletedId);
                }
                const el = document.querySelector(`.message-item[data-id="${deletedId}"]`);
                if (el) el.remove();
            }
        })
        .subscribe((status) => {
            console.log(`[Chat] Supabase Realtime en #${channelId}: ${status}`);
            if (status === 'CHANNEL_ERROR') {
                console.warn('[Chat] Error en canal Realtime, reintentando en 3s...');
                setTimeout(() => subscribeToChannel(channelId), 3000);
            }
        });
}

function showIncomingMessageIndicator(author) {
    // Crear un breve destello visual en el canal activo
    const titleEl = document.getElementById('active-channel-title');
    if (titleEl) {
        titleEl.style.color = 'var(--accent-cyan)';
        setTimeout(() => titleEl.style.color = '', 600);
    }
}

// ─────────────────────────────────────────────────────────────
// CAMBIO DE CANAL
// ─────────────────────────────────────────────────────────────
export function switchChatChannel(channelId) {
    const startTime = performance.now();
    const titleEl = document.getElementById('active-channel-title');
    const descEl  = document.getElementById('active-channel-desc');

    if (titleEl) titleEl.textContent = channelId;
    if (descEl) {
        const descs = {
            'general':        'Canal general de chat y discusiones.',
            'lounge':         'Sala de estar para pasar el rato.',
            'clips-and-memes':'¡Comparte tus jugadas y memes más épicos!',
            'estrategia':     'Análisis táctico y guías de juego.'
        };
        descEl.textContent = descs[channelId] || '';
    }
    if (chatTextarea) chatTextarea.placeholder = `Enviar mensaje a #${channelId}... (Enter para enviar)`;

    // Si Supabase está activo, cargar mensajes reales y re-suscribir
    if (isUsingSupabase && supabase) {
        loadMessagesFromSupabase(channelId);
        subscribeToChannel(channelId);
    } else {
        renderMessages();
    }

    updateRenderLatency(startTime);
}

// ─────────────────────────────────────────────────────────────
// RENDER DE MENSAJES
// ─────────────────────────────────────────────────────────────
function renderMessages() {
    if (!chatContainer) return;
    chatContainer.innerHTML = '';
    const messages = currentMessages[state.activeChannel] || [];
    messages.forEach(msg => chatContainer.appendChild(createMessageElement(msg)));
    scrollToBottom();
}

function getLocalUserName() {
    const email = localStorage.getItem('nexus_user_email') || '';
    if (!email) return 'Usuario Nexus';
    const base = email.split('@')[0];
    return base.charAt(0).toUpperCase() + base.slice(1);
}

function createMessageElement(msg) {
    const item = document.createElement('div');
    item.className = 'message-item';
    item.setAttribute('data-id', msg.id);

    const ts = msg.ts || Date.now();
    const timeLabel = relativeTime(ts);

    let imageHtml = '';
    if (msg.image) {
        const safeImg    = msg.image.replace(/'/g, "\\'");
        const safeAuthor = msg.author.replace(/'/g, "\\'");
        imageHtml = `
            <div class="shared-image-container" onclick="window.openLightbox('${safeImg}', '${safeAuthor}')">
                <img src="${msg.image}" alt="Imagen compartida por ${escapeHTML(msg.author)}">
                <div class="shared-image-overlay">🔍 AMPLIAR</div>
            </div>
        `;
    }

    let fileHtml = '';
    if (msg.file) {
        const ext = msg.file.name.split('.').pop().toLowerCase();
        let fileClass = 'file-generic', fileEmoji = '📄';
        if (ext === 'pdf') { fileClass = 'file-pdf'; fileEmoji = '📕'; }
        else if (['zip','rar','7z','tar','gz'].includes(ext)) { fileClass = 'file-zip'; fileEmoji = '📦'; }
        else if (['doc','docx'].includes(ext)) { fileClass = 'file-doc'; fileEmoji = '📘'; }
        else if (['xls','xlsx'].includes(ext)) { fileClass = 'file-xls'; fileEmoji = '📗'; }
        else if (['mp3','wav','ogg','flac'].includes(ext)) { fileClass = 'file-audio'; fileEmoji = '🎵'; }
        fileHtml = `
            <div class="file-attachment-card ${fileClass}">
                <div class="file-icon">${fileEmoji}</div>
                <div class="file-info">
                    <span class="file-name" title="${escapeHTML(msg.file.name)}">${escapeHTML(msg.file.name)}</span>
                    <span class="file-size">${escapeHTML(msg.file.size)}</span>
                </div>
                <a href="${msg.file.dataUrl}" download="${escapeHTML(msg.file.name)}" class="file-download-btn">
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
                    <span>Descargar</span>
                </a>
            </div>
        `;
    }

    let avatarHtml = '';
    const myName = getLocalUserName();
    const savedAvatar = localStorage.getItem('nexus_user_avatar');
    const savedStyle = localStorage.getItem('nexus_user_avatar_style') || 'circle';
    const borderRadiusStyle = savedStyle === 'circle' ? '50%' : '6px';
    if (msg.author === myName && savedAvatar) {
        avatarHtml = `<div class="avatar" style="background-image: url(${savedAvatar}); background-size: cover; background-position: center; border-radius: ${borderRadiusStyle}; width: 100%; height: 100%;"></div>`;
    } else if (msg.author === 'Nexus Music Bot') {
        avatarHtml = `<div class="avatar" style="background: linear-gradient(135deg, #db2777 0%, #ec4899 100%); color:#fff; font-size: 0.8rem; display: flex; align-items: center; justify-content: center; border-radius: 50%;">🎵</div>`;
    } else {
        avatarHtml = `<div class="avatar ${msg.avatarBg || 'bg-blue'}">${escapeHTML(msg.avatar || msg.author.charAt(0))}</div>`;
    }

    const isOp = isUserOp(msg.author);
    const opCrown = isOp ? '<span class="badge-op" title="Operator (OP)">👑</span>' : '';
    const isMusicBot = msg.author === 'Nexus Music Bot';
    const botBadge = isMusicBot ? '<span style="background:#db2777;color:#fff;font-size:0.6rem;font-weight:800;padding:1px 4px;border-radius:4px;margin-left:6px;font-family:\'Orbitron\'">BOT</span>' : '';

    const amIOp = isUserOp(getLocalUserName());
    // Only OP can see delete button (and music bot messages can't be deleted as they are local)
    const deleteBtnHtml = (amIOp && !isMusicBot) ? `<button class="delete-msg-btn" onclick="deleteMessage(${msg.id})" title="Borrar mensaje">🗑️</button>` : '';

    item.innerHTML = `
        <div class="avatar-container small">${avatarHtml}</div>
        <div class="message-content-wrapper">
            <div class="message-meta">
                <span class="message-author">${escapeHTML(msg.author)}${botBadge}${opCrown}</span>
                <span class="message-time" data-ts="${ts}" title="${new Date(ts).toLocaleString('es-MX')}">${timeLabel}</span>
            </div>
            <div class="message-text">${escapeHTML(msg.text)}</div>
            ${imageHtml}
            ${fileHtml}
        </div>
        ${deleteBtnHtml}
    `;
    return item;
}

// ─────────────────────────────────────────────────────────────
// ADJUNTOS
// ─────────────────────────────────────────────────────────────
function showAttachmentPreview() {
    if (!attachmentPreviewBar || !activeAttachment) return;
    const nameEl = document.getElementById('preview-file-name');
    const sizeEl = document.getElementById('preview-file-size');
    const iconEl = document.getElementById('file-icon-placeholder');
    if (nameEl) nameEl.textContent = activeAttachment.name;
    if (sizeEl) sizeEl.textContent = activeAttachment.size;
    if (iconEl) {
        if (activeAttachment.isImage) { iconEl.textContent = '🖼️'; }
        else {
            const ext = activeAttachment.name.split('.').pop().toLowerCase();
            iconEl.textContent = ext === 'pdf' ? '📕' : ['zip','rar','7z'].includes(ext) ? '📦' : ['doc','docx'].includes(ext) ? '📘' : ['mp3','wav','ogg'].includes(ext) ? '🎵' : '📄';
        }
    }
    attachmentPreviewBar.classList.remove('hidden');
}

function clearAttachment() {
    activeAttachment = null;
    if (fileInput) fileInput.value = '';
    if (attachmentPreviewBar) attachmentPreviewBar.classList.add('hidden');
}

// ─────────────────────────────────────────────────────────────
// PANEL DE MEMES
// ─────────────────────────────────────────────────────────────
function renderMemeTemplates(list) {
    if (!memesGrid) return;
    memesGrid.innerHTML = '';
    if (list.length === 0) {
        memesGrid.innerHTML = `<div style="grid-column:span 2;text-align:center;color:var(--text-muted);font-size:.8rem;padding:20px;">No se encontraron plantillas</div>`;
        return;
    }
    list.forEach(meme => {
        const card = document.createElement('div');
        card.className = 'meme-card';
        card.innerHTML = `<img src="${meme.img}" alt="${escapeHTML(meme.name)}" loading="lazy"><span class="meme-name">${escapeHTML(meme.name)}</span>`;
        card.addEventListener('click', () => {
            sendMeme(meme.img, meme.name);
            if (memesPopover) memesPopover.classList.add('hidden');
        });
        memesGrid.appendChild(card);
    });
}

// ─────────────────────────────────────────────────────────────
// MENSAJE DEL MUSIC BOT
// ─────────────────────────────────────────────────────────────
function sendMusicBotSystemMessage(text) {
    const ts = Date.now();
    const botMsg = { id: ts, author: 'Nexus Music Bot', avatar: '🎵', avatarBg: 'bg-purple', ts, text };
    if (!currentMessages[state.activeChannel]) currentMessages[state.activeChannel] = [];
    currentMessages[state.activeChannel].push(botMsg);
    if (chatContainer) {
        chatContainer.appendChild(createMessageElement(botMsg));
        scrollToBottom();
    }
}

// ─────────────────────────────────────────────────────────────
// ENVIAR MENSAJE
// ─────────────────────────────────────────────────────────────
async function sendMessage() {
    if (!chatTextarea) return;
    const text = chatTextarea.value.trim();
    if (text === '' && !activeAttachment) return;

    // Comandos del Music Bot
    if (text.startsWith('/play ')) {
        const query = text.slice(6).trim();
        chatTextarea.value = '';
        chatTextarea.style.height = '24px';
        const res = playMusicCommand(query);
        if (res.success) sendMusicBotSystemMessage(`🎵 se ha unido al canal de voz y está reproduciendo: **${res.title}**`);
        return;
    } else if (text === '/skip') {
        chatTextarea.value = '';
        chatTextarea.style.height = '24px';
        skipMusicCommand();
        sendMusicBotSystemMessage(`⏭️ Pista saltada.`);
        return;
    } else if (text === '/stop') {
        chatTextarea.value = '';
        chatTextarea.style.height = '24px';
        stopMusic();
        sendMusicBotSystemMessage(`⏹️ Bot de música desconectado.`);
        return;
    }

    const startTime = performance.now();
    const ts = Date.now();
    const savedEmail = localStorage.getItem('nexus_user_email') || '';
    const displayName = savedEmail
        ? savedEmail.split('@')[0].charAt(0).toUpperCase() + savedEmail.split('@')[0].slice(1)
        : 'Usuario Nexus';
    const avatarLetter = displayName.charAt(0);
    const savedAvatar = localStorage.getItem('nexus_user_avatar');
    const savedAvatarBg = 'bg-blue';

    const newMsg = {
        id: ts,
        author: displayName,
        avatar: avatarLetter,
        avatarBg: savedAvatarBg,
        ts,
        text
    };

    if (activeAttachment) {
        if (activeAttachment.isImage) newMsg.image = activeAttachment.dataUrl;
        else newMsg.file = { name: activeAttachment.name, size: activeAttachment.size, dataUrl: activeAttachment.dataUrl };
        clearAttachment();
    }

    // Renderizar localmente de inmediato (UI optimística)
    if (!currentMessages[state.activeChannel]) currentMessages[state.activeChannel] = [];
    currentMessages[state.activeChannel].push(newMsg);
    chatTextarea.value = '';
    chatTextarea.style.height = '24px';
    if (chatContainer) {
        chatContainer.appendChild(createMessageElement(newMsg));
        scrollToBottom();
    }
    updateRenderLatency(startTime);

    // Persistir en Supabase si está disponible
    if (isUsingSupabase && supabase) {
        try {
            const payload = {
                channel_id: state.activeChannel,
                author: displayName,
                avatar: avatarLetter,
                avatar_bg: savedAvatarBg,
                text: text || null,
                image: newMsg.image || null,
                file: newMsg.file ? JSON.stringify(newMsg.file) : null
            };
            const { error } = await supabase.from('messages').insert(payload);
            if (error) console.error('[Chat] Error al guardar mensaje en Supabase:', error.message);
        } catch (err) {
            console.error('[Chat] Error en insert de Supabase:', err);
        }
    }

    // Reacción automática a links de YouTube (sólo local, no bot de texto)
    if (text.includes('youtube.com/watch') || text.includes('youtu.be/')) {
        setTimeout(() => {
            const res = playMusicCommand(text);
            if (res.success) sendMusicBotSystemMessage(`🎵 ha detectado un enlace de YouTube y está reproduciendo: **${res.title}**`);
        }, 1000);
    }
}

// ─────────────────────────────────────────────────────────────
// ENVIAR MEME
// ─────────────────────────────────────────────────────────────
async function sendMeme(memeImg, memeName) {
    const startTime = performance.now();
    const ts = Date.now();
    const savedEmail = localStorage.getItem('nexus_user_email') || '';
    const displayName = savedEmail
        ? savedEmail.split('@')[0].charAt(0).toUpperCase() + savedEmail.split('@')[0].slice(1)
        : 'Usuario Nexus';

    const newMsg = {
        id: ts,
        author: displayName,
        avatar: displayName.charAt(0),
        avatarBg: 'bg-blue',
        ts,
        text: `¡Meme enviado: ${memeName}! 😂`,
        image: memeImg
    };

    currentMessages[state.activeChannel].push(newMsg);
    if (chatContainer) {
        chatContainer.appendChild(createMessageElement(newMsg));
        scrollToBottom();
    }
    updateRenderLatency(startTime);

    // Persistir en Supabase
    if (isUsingSupabase && supabase) {
        try {
            await supabase.from('messages').insert({
                channel_id: state.activeChannel,
                author: displayName,
                avatar: displayName.charAt(0),
                avatar_bg: 'bg-blue',
                text: newMsg.text,
                image: memeImg
            });
        } catch (err) {
            console.error('[Chat] Error al guardar meme en Supabase:', err);
        }
    }
}

// ─────────────────────────────────────────────────────────────
// SCROLL
// ─────────────────────────────────────────────────────────────
function scrollToBottom() {
    if (chatContainer) chatContainer.scrollTop = chatContainer.scrollHeight;
}

// ─────────────────────────────────────────────────────────────
// LIGHTBOX
// ─────────────────────────────────────────────────────────────
function setupLightbox() {
    const modal    = document.getElementById('lightbox-modal');
    const modalImg = document.getElementById('lightbox-image');
    const caption  = document.getElementById('lightbox-caption');
    const closeBtn = document.getElementById('lightbox-close-btn');
    const overlay  = document.getElementById('lightbox-overlay');

    window.openLightbox = (imgSrc, authorName) => {
        if (!modal || !modalImg || !caption) return;
        modalImg.src = imgSrc;
        caption.textContent = `Compartido por ${authorName} en #${state.activeChannel}`;
        modal.classList.remove('hidden');
    };

    const close = () => modal && modal.classList.add('hidden');
    if (closeBtn) closeBtn.addEventListener('click', close);
    if (overlay)  overlay.addEventListener('click', close);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
}

// ─────────────────────────────────────────────────────────────
// ESCAPE HTML
// ─────────────────────────────────────────────────────────────
function escapeHTML(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/[&<>'"]/g, tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag));
}

// Global function to delete messages from UI
window.deleteMessage = async function(id) {
    if (!confirm('¿Estás seguro de que quieres borrar este mensaje?')) return;
    
    // Función auxiliar para borrarlo de la pantalla inmediatamente
    const removeLocally = () => {
        const channelId = state.activeChannel;
        if (currentMessages[channelId]) {
            currentMessages[channelId] = currentMessages[channelId].filter(m => m.id !== id);
        }
        const el = document.querySelector(`.message-item[data-id="${id}"]`);
        if (el) el.remove();
    };

    if (isUsingSupabase && supabase) {
        try {
            const { error } = await supabase.from('messages').delete().eq('id', id);
            if (error) throw error;
            // Lo borramos de la pantalla inmediatamente tras confirmar que se borró en DB
            removeLocally();
        } catch (e) {
            console.error('[Chat] Error borrando mensaje:', e);
            alert('Error al borrar el mensaje. Revisa si configuraste RLS en Supabase para permitir DELETE.');
        }
    } else {
        // Modo local
        removeLocally();
    }
};
