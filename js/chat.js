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

// Emojis list with search keywords
const emojiData = [
    { char: '😀', tags: 'grinning smile happy face alegre' },
    { char: '😃', tags: 'smiley smile happy face feliz' },
    { char: '😄', tags: 'smile happy face risa jaja' },
    { char: '😁', tags: 'grin happy face teeth risa' },
    { char: '😆', tags: 'laugh happy face risa lol' },
    { char: '😅', tags: 'sweat smile happy face' },
    { char: '😂', tags: 'joy laugh tears happy risa jaja lol' },
    { char: '🤣', tags: 'rofl laugh tears happy risa lol' },
    { char: '😊', tags: 'blush happy face shy sonrojo' },
    { char: '😇', tags: 'halo angel innocent santo' },
    { char: '🙂', tags: 'slight smile happy' },
    { char: '😉', tags: 'wink face guino' },
    { char: '😌', tags: 'relieved face paz' },
    { char: '😍', tags: 'heart eyes love happy amor' },
    { char: '🥰', tags: 'smiling face hearts love amor' },
    { char: '😘', tags: 'kissing heart love beso' },
    { char: '😋', tags: 'yum delicious food face rico' },
    { char: '😛', tags: 'tongue face lengua' },
    { char: '😜', tags: 'wink tongue face lengua' },
    { char: '🤪', tags: 'crazy face loco' },
    { char: '😎', tags: 'sunglasses cool face style genial' },
    { char: '🥳', tags: 'party face celebrate fiesta' },
    { char: '😏', tags: 'smirk face' },
    { char: '😒', tags: 'unamused face' },
    { char: '😔', tags: 'pensive sad face triste' },
    { char: '🥺', tags: 'pleading eyes sad face begging porfi' },
    { char: '😢', tags: 'cry sad tears face llorar' },
    { char: '😭', tags: 'sob cry sad tears face llorar' },
    { char: '😤', tags: 'triumph angry face enojo' },
    { char: '😠', tags: 'angry face mad enojo' },
    { char: '😡', tags: 'rage angry face mad red rabia' },
    { char: '🤬', tags: 'cursing face angry' },
    { char: '🤯', tags: 'exploding head mind blown shock explosion' },
    { char: '😳', tags: 'flushed face shock sonrojo' },
    { char: '😱', tags: 'scream fear face shock miedo' },
    { char: '🤔', tags: 'thinking face pensar' },
    { char: '🤫', tags: 'shush quiet face silencio' },
    { char: '😬', tags: 'grimace face mueca' },
    { char: '😴', tags: 'sleeping sleep tired face dormir' },
    { char: '🤤', tags: 'drooling face' },
    { char: '🤢', tags: 'nauseated face sick asco' },
    { char: '🤮', tags: 'vomit face sick vomito' },
    { char: '💩', tags: 'poop caca' },
    { char: '👻', tags: 'ghost halloween fantasma' },
    { char: '💀', tags: 'skull dead skeleton muerte' },
    { char: '👽', tags: 'alien ufo marciano' },
    { char: '👾', tags: 'space invader monster game retro gamer' },
    { char: '🤖', tags: 'robot bot tech' },
    { char: '👍', tags: 'thumbs up like ok yes bien ok' },
    { char: '👎', tags: 'thumbs down dislike no mal' },
    { char: '👊', tags: 'fist punch hit golpe' },
    { char: '👏', tags: 'clap bravo aplauso' },
    { char: '🙏', tags: 'pray please thanks rezar porfavor gracias' },
    { char: '💪', tags: 'muscle flex strong fuerza' },
    { char: '❤️', tags: 'red heart love corazon' },
    { char: '💔', tags: 'broken heart sad corazon roto' },
    { char: '✨', tags: 'sparkles glow magic shiny brillo' },
    { char: '⚡', tags: 'zap lightning thunder energy power rayo' },
    { char: '🔥', tags: 'fire hot flame fuego' },
    { char: '🌟', tags: 'star glow estrella' },
    { char: '⭐', tags: 'star gold estrella' },
    { char: '🎮', tags: 'game controller play console mando' },
    { char: '🕹️', tags: 'joystick retro game' },
    { char: '🚀', tags: 'rocket space launch ship cohete' }
];

// Presets stickers
const defaultStickers = [
    { id: 'sticker_gg_ez', name: 'GG EZ', img: 'assets/sticker_gg_ez.png' },
    { id: 'sticker_nexus_shield', name: 'Nexus Shield', img: 'assets/sticker_nexus_shield.png' },
    { id: 'sticker_hype_cat', name: 'Hype Cat', img: 'assets/sticker_hype_cat.png' },
    { id: 'sticker_rage_quit', name: 'Rage Quit', img: 'assets/sticker_rage_quit.png' }
];

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

// Nuevas referencias DOM para Emojis y Stickers
let emojiPopover;
let emojisGrid;
let emojiSearchInput;
let stickerPopover;
let stickersGrid;
let stickerUploadInput;
let uploadStickerBtn;

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

    // Inicializar elementos de Emojis y Stickers
    emojiPopover        = document.getElementById('emoji-popover');
    emojisGrid          = document.getElementById('emojis-grid-list');
    emojiSearchInput    = document.getElementById('emoji-search-input');
    stickerPopover      = document.getElementById('sticker-popover');
    stickersGrid        = document.getElementById('stickers-grid-list');
    stickerUploadInput  = document.getElementById('sticker-upload-input');
    uploadStickerBtn    = document.getElementById('upload-sticker-btn');

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

    // --- EVENTOS DEL PANEL DE MEMES ---
    const memeBtn = document.getElementById('meme-btn');
    if (memeBtn && memesPopover) {
        memeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            emojiPopover?.classList.add('hidden');
            stickerPopover?.classList.add('hidden');
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

    // --- EVENTOS DEL PANEL DE EMOJIS ---
    const emojiBtn = document.getElementById('emoji-btn');
    if (emojiBtn && emojiPopover) {
        emojiBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            memesPopover?.classList.add('hidden');
            stickerPopover?.classList.add('hidden');
            emojiPopover.classList.toggle('hidden');
            renderEmojis(emojiData);
            if (emojiSearchInput) {
                emojiSearchInput.value = '';
                setTimeout(() => emojiSearchInput.focus(), 100);
            }
        });
    }

    const emojiCloseBtn = document.getElementById('emoji-popover-close');
    if (emojiCloseBtn) emojiCloseBtn.addEventListener('click', () => emojiPopover?.classList.add('hidden'));

    if (emojiSearchInput) {
        emojiSearchInput.addEventListener('input', (e) => {
            const q = e.target.value.toLowerCase().trim();
            if (!q) {
                renderEmojis(emojiData);
            } else {
                renderEmojis(emojiData.filter(emo => emo.tags.includes(q)));
            }
        });
    }

    // --- EVENTOS DEL PANEL DE STICKERS ---
    const stickerBtn = document.getElementById('sticker-btn');
    if (stickerBtn && stickerPopover) {
        stickerBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            memesPopover?.classList.add('hidden');
            emojiPopover?.classList.add('hidden');
            stickerPopover.classList.toggle('hidden');
            renderStickers();
        });
    }

    const stickerCloseBtn = document.getElementById('sticker-popover-close');
    if (stickerCloseBtn) stickerCloseBtn.addEventListener('click', () => stickerPopover?.classList.add('hidden'));

    // Subida de stickers personalizados
    if (uploadStickerBtn && stickerUploadInput) {
        uploadStickerBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            stickerUploadInput.click();
        });

        stickerUploadInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            if (file.size > 2 * 1024 * 1024) {
                alert('Los stickers deben pesar menos de 2 MB.');
                return;
            }

            const reader = new FileReader();
            reader.onload = (event) => {
                const name = file.name.split('.')[0];
                saveCustomSticker(name, event.target.result);
                renderStickers();
            };
            reader.readAsDataURL(file);
        });
    }

    // Cerrar popovers al hacer clic fuera
    document.addEventListener('click', (e) => {
        if (memesPopover && !memesPopover.classList.contains('hidden') && !memesPopover.contains(e.target) && e.target.id !== 'meme-btn' && !e.target.closest('#meme-btn')) {
            memesPopover.classList.add('hidden');
        }
        if (emojiPopover && !emojiPopover.classList.contains('hidden') && !emojiPopover.contains(e.target) && e.target.id !== 'emoji-btn' && !e.target.closest('#emoji-btn')) {
            emojiPopover.classList.add('hidden');
        }
        if (stickerPopover && !stickerPopover.classList.contains('hidden') && !stickerPopover.contains(e.target) && e.target.id !== 'sticker-btn' && !e.target.closest('#sticker-btn')) {
            stickerPopover.classList.add('hidden');
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

        // Convertir formato Supabase a formato interno (si está vacío, limpia la pantalla de mensajes anteriores)
        currentMessages[channelId] = (data || []).map(row => ({
            id: row.id,
            author: row.author,
            avatar: row.avatar || row.author.charAt(0).toUpperCase(),
            avatarBg: row.avatar_bg || 'bg-blue',
            ts: new Date(row.created_at).getTime(),
            text: row.text || '',
            image: row.image || null,
            file: row.file || null
        }));
        // Renderizar siempre con el channelId explícito para evitar mezclar mensajes de servidores distintos
        renderMessages(channelId);
    } catch (err) {
        console.warn('[Chat] No se pudieron cargar mensajes de Supabase:', err.message);
        // En caso de error, limpiar el canal para no mostrar mensajes obsoletos
        currentMessages[channelId] = [];
        renderMessages(channelId);
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

    // Actualizar el canal activo ANTES de cualquier operación asíncrona
    state.activeChannel = channelId;

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
function renderMessages(channelId) {
    if (!chatContainer) return;
    const targetChannel = channelId || state.activeChannel;
    // Solo renderizar si es el canal actualmente activo, para evitar mezclar canales
    if (targetChannel !== state.activeChannel) return;
    chatContainer.innerHTML = '';
    const messages = currentMessages[targetChannel] || [];
    messages.forEach(msg => chatContainer.appendChild(createMessageElement(msg)));
    scrollToBottom();
}

export function getLocalUserName() {
    const email = localStorage.getItem('nexus_user_email') || '';
    if (!email) return 'Usuario Nexus';
    const customName = localStorage.getItem('nexus_username_' + email);
    if (customName) return customName;
    const base = email.split('@')[0];
    return base.charAt(0).toUpperCase() + base.slice(1);
}

export function getLocalUserAvatar() {
    const email = localStorage.getItem('nexus_user_email') || '';
    if (!email) return null;
    return localStorage.getItem('nexus_user_avatar_' + email);
}

export function getLocalUserAvatarStyle() {
    const email = localStorage.getItem('nexus_user_email') || '';
    if (!email) return 'circle';
    return localStorage.getItem('nexus_user_avatar_style_' + email) || 'circle';
}

function createMessageElement(msg) {
    const item = document.createElement('div');
    const isSticker = msg.text && msg.text.startsWith('[Sticker]');
    item.className = `message-item ${isSticker ? 'sticker-msg' : ''}`;
    item.setAttribute('data-id', msg.id);

    const ts = msg.ts || Date.now();
    const timeLabel = relativeTime(ts);

    let imageHtml = '';
    if (msg.image) {
        if (isSticker) {
            imageHtml = `
                <img class="sticker-display" src="${msg.image}" alt="Sticker">
            `;
        } else {
            const safeImg    = msg.image.replace(/'/g, "\\'");
            const safeAuthor = msg.author.replace(/'/g, "\\'");
            imageHtml = `
                <div class="shared-image-container" onclick="window.openLightbox('${safeImg}', '${safeAuthor}')">
                    <img src="${msg.image}" alt="Imagen compartida por ${escapeHTML(msg.author)}">
                    <div class="shared-image-overlay">🔍 AMPLIAR</div>
                </div>
            `;
        }
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
    const savedAvatar = getLocalUserAvatar();
    const savedStyle = getLocalUserAvatarStyle();
    const borderRadiusStyle = savedStyle === 'circle' ? '50%' : '10px';
    if (msg.author === myName && savedAvatar) {
        avatarHtml = `<div class="avatar" style="background-image: url(${savedAvatar}); background-size: cover; background-position: center; border-radius: ${borderRadiusStyle}; width: 100%; height: 100%;"></div>`;
    } else if (msg.author === 'Nexus Music Bot') {
        avatarHtml = `<div class="avatar" style="background: linear-gradient(135deg, #db2777 0%, #ec4899 100%); color:#fff; font-size: 0.8rem; display: flex; align-items: center; justify-content: center; border-radius: 50%;">🎵</div>`;
    } else if (msg.avatar && msg.avatar.startsWith('data:image/')) {
        avatarHtml = `<div class="avatar" style="background-image: url(${msg.avatar}); background-size: cover; background-position: center; border-radius: 50%; width: 100%; height: 100%;"></div>`;
    } else {
        avatarHtml = `<div class="avatar ${msg.avatarBg || 'bg-blue'}">${escapeHTML(msg.avatar || msg.author.charAt(0))}</div>`;
    }

    const isOp = isUserOp(msg.author);
    const opCrown = isOp ? '<span class="badge-op" title="Operator (OP)">👑</span>' : '';
    const isMusicBot = msg.author === 'Nexus Music Bot';
    const botBadge = isMusicBot ? '<span style="background:#db2777;color:#fff;font-size:0.6rem;font-weight:800;padding:1px 4px;border-radius:4px;margin-left:6px;font-family:\'Orbitron\'">BOT</span>' : '';

    const amIOp = isUserOp(getLocalUserName());
    // Users can delete their own messages, and OPs can delete any messages (except local music bot messages)
    const deleteBtnHtml = ((amIOp || msg.author === myName) && !isMusicBot) ? `<button class="delete-msg-btn" onclick="deleteMessage(${msg.id})" title="Borrar mensaje">🗑️</button>` : '';

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
// EMOJIS Y STICKERS HELPER FUNCTIONS
// ─────────────────────────────────────────────────────────────

// Renderizar emojis en el popover
function renderEmojis(list) {
    if (!emojisGrid) return;
    emojisGrid.innerHTML = '';
    
    if (list.length === 0) {
        emojisGrid.innerHTML = `<div style="grid-column:span 6;text-align:center;color:var(--text-muted);font-size:.8rem;padding:20px;">No se encontraron emojis</div>`;
        return;
    }
    
    list.forEach(emoji => {
        const item = document.createElement('div');
        item.className = 'emoji-item';
        item.textContent = emoji.char;
        item.title = emoji.tags;
        
        item.addEventListener('click', () => {
            insertEmoji(emoji.char);
            if (emojiPopover) emojiPopover.classList.add('hidden');
        });
        
        emojisGrid.appendChild(item);
    });
}

// Insertar emoji en el cursor de chatTextarea
function insertEmoji(emoji) {
    if (!chatTextarea) return;
    const start = chatTextarea.selectionStart;
    const end = chatTextarea.selectionEnd;
    const text = chatTextarea.value;
    chatTextarea.value = text.substring(0, start) + emoji + text.substring(end);
    chatTextarea.selectionStart = chatTextarea.selectionEnd = start + emoji.length;
    chatTextarea.focus();
}

// Obtener stickers personalizados de localStorage
function getCustomStickers() {
    try {
        return JSON.parse(localStorage.getItem('nexus_custom_stickers') || '[]');
    } catch {
        return [];
    }
}

// Guardar sticker personalizado en localStorage
function saveCustomSticker(name, dataUrl) {
    const custom = getCustomStickers();
    const newSticker = {
        id: 'sticker_custom_' + Date.now(),
        name: name,
        img: dataUrl,
        isCustom: true
    };
    custom.push(newSticker);
    localStorage.setItem('nexus_custom_stickers', JSON.stringify(custom));
    return newSticker;
}

// Renderizar stickers (presets + personalizados)
function renderStickers() {
    if (!stickersGrid) return;
    stickersGrid.innerHTML = '';
    
    const presets = defaultStickers;
    const customs = getCustomStickers();
    const allStickers = [...presets, ...customs];
    
    allStickers.forEach(sticker => {
        const item = document.createElement('div');
        item.className = 'sticker-item';
        item.title = sticker.name;
        
        item.innerHTML = `
            <img src="${sticker.img}" alt="${escapeHTML(sticker.name)}" loading="lazy">
            <span>${escapeHTML(sticker.name)}</span>
        `;
        
        item.addEventListener('click', () => {
            sendSticker(sticker.img, sticker.name);
            if (stickerPopover) stickerPopover.classList.add('hidden');
        });
        
        stickersGrid.appendChild(item);
    });
}

// Enviar Sticker
async function sendSticker(stickerImg, stickerName) {
    const startTime = performance.now();
    const ts = Date.now();
    const displayName = getLocalUserName();
    const savedAvatar = getLocalUserAvatar();
    const avatarPayload = savedAvatar || displayName.charAt(0);

    const newMsg = {
        id: ts,
        author: displayName,
        avatar: avatarPayload,
        avatarBg: 'bg-blue',
        ts,
        text: `[Sticker]`,
        image: stickerImg
    };

    if (!currentMessages[state.activeChannel]) currentMessages[state.activeChannel] = [];
    currentMessages[state.activeChannel].push(newMsg);
    
    if (chatContainer) {
        chatContainer.appendChild(createMessageElement(newMsg));
        scrollToBottom();
    }
    updateRenderLatency(startTime);

    // Persistir en Supabase
    if (isUsingSupabase && supabase) {
        try {
            const { data: insertedRows, error } = await supabase.from('messages').insert({
                channel_id: state.activeChannel,
                author: displayName,
                avatar: avatarPayload,
                avatar_bg: 'bg-blue',
                text: `[Sticker]`,
                image: stickerImg
            }).select('id');
            if (!error && insertedRows && insertedRows[0]) {
                const realId = insertedRows[0].id;
                const oldId = newMsg.id;
                newMsg.id = realId;
                const arr = currentMessages[state.activeChannel];
                if (arr) { const idx = arr.findIndex(m => m.id === oldId); if (idx !== -1) arr[idx].id = realId; }
                const el = document.querySelector(`.message-item[data-id="${oldId}"]`);
                if (el) el.setAttribute('data-id', realId);
            }
        } catch (err) {
            console.error('[Chat] Error al guardar sticker en Supabase:', err);
        }
    }
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
    const displayName = getLocalUserName();
    const savedAvatar = getLocalUserAvatar();
    const avatarPayload = savedAvatar || displayName.charAt(0);
    const savedAvatarBg = 'bg-blue';

    const newMsg = {
        id: ts,
        author: displayName,
        avatar: avatarPayload,
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
                avatar: avatarPayload,
                avatar_bg: savedAvatarBg,
                text: text || null,
                image: newMsg.image || null,
                file: newMsg.file ? JSON.stringify(newMsg.file) : null
            };
            const { data: insertedRows, error } = await supabase.from('messages').insert(payload).select('id');
            if (error) {
                console.error('[Chat] Error al guardar mensaje en Supabase:', error.message);
            } else if (insertedRows && insertedRows[0]) {
                // Actualizar el ID local con el UUID real de Supabase para que el botón borrar funcione
                const realId = insertedRows[0].id;
                const oldId = newMsg.id;
                newMsg.id = realId;
                // Actualizar en el array de mensajes
                const arr = currentMessages[state.activeChannel];
                if (arr) {
                    const idx = arr.findIndex(m => m.id === oldId);
                    if (idx !== -1) arr[idx].id = realId;
                }
                // Actualizar el atributo data-id del elemento del DOM
                const el = document.querySelector(`.message-item[data-id="${oldId}"]`);
                if (el) el.setAttribute('data-id', realId);
            }
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
    const displayName = getLocalUserName();
    const savedAvatar = getLocalUserAvatar();
    const avatarPayload = savedAvatar || displayName.charAt(0);

    const newMsg = {
        id: ts,
        author: displayName,
        avatar: avatarPayload,
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
            const { data: insertedRows, error } = await supabase.from('messages').insert({
                channel_id: state.activeChannel,
                author: displayName,
                avatar: avatarPayload,
                avatar_bg: 'bg-blue',
                text: newMsg.text,
                image: memeImg
            }).select('id');
            if (!error && insertedRows && insertedRows[0]) {
                const realId = insertedRows[0].id;
                const oldId = newMsg.id;
                newMsg.id = realId;
                const arr = currentMessages[state.activeChannel];
                if (arr) { const idx = arr.findIndex(m => m.id === oldId); if (idx !== -1) arr[idx].id = realId; }
                const el = document.querySelector(`.message-item[data-id="${oldId}"]`);
                if (el) el.setAttribute('data-id', realId);
            }
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
// NOTE: id can be a UUID string (Supabase) or a numeric timestamp (local-only)
window.deleteMessage = async function(id) {
    if (!confirm('¿Estás seguro de que quieres borrar este mensaje?')) return;
    
    // Función auxiliar para borrarlo de la pantalla inmediatamente
    // Usa == (loose) para comparar por si hay mezcla de tipos string/number
    const removeLocally = () => {
        const channelId = state.activeChannel;
        if (currentMessages[channelId]) {
            // eslint-disable-next-line eqeqeq
            currentMessages[channelId] = currentMessages[channelId].filter(m => m.id != id);
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
            // Si falla en Supabase (RLS, o mensaje local sin UUID), borrarlo solo localmente
            const arr = currentMessages[state.activeChannel];
            // eslint-disable-next-line eqeqeq
            const isLocalOnly = arr && arr.some(m => m.id == id && typeof m.id === 'number');
            if (isLocalOnly) {
                removeLocally();
            } else {
                alert('Error al borrar el mensaje. Revisa si configuraste RLS en Supabase para permitir DELETE.');
            }
        }
    } else {
        // Modo local
        removeLocally();
    }
};
