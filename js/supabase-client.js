/* NEXUS FIREBASE CLIENT MODULE (ES MODULE) */
/* Reemplazo de Supabase con Firebase — misma interfaz pública para toda la app */

// ─── Firebase Config ───────────────────────────────────────────────────────
const FIREBASE_CONFIG = {
    apiKey:            'AIzaSyDD7efmFKTreslwqu3pjDKClZ98DQAjao4',
    authDomain:        'nexus-916b0.firebaseapp.com',
    databaseURL:       'https://nexus-916b0-default-rtdb.firebaseio.com',
    projectId:         'nexus-916b0',
    storageBucket:     'nexus-916b0.firebasestorage.app',
    messagingSenderId: '816556998793',
    appId:             '1:816556998793:web:bb2f63407014d0c7a5c658',
    measurementId:     'G-PJHEPN41VR'
};

// ─── Referencias internas ──────────────────────────────────────────────────
let _db      = null;   // Firestore
let _rtdb    = null;   // Realtime Database (presencia)
let _storage = null;   // Storage (imágenes/banners)
const _storageUrlCache = new Map();

// ─── Exports públicos (compatibles con el resto de la app) ─────────────────
export let supabase      = null;
export let supabaseUrl   = 'firebase://nexus-916b0';
export let supabaseKey   = FIREBASE_CONFIG.apiKey;
export let supabaseReady = false;

// ─── Estado de presencia ───────────────────────────────────────────────────
let _localVoiceChannel    = null;
let _globalPresChannel    = null;  // FirebaseChannel activo
let _globalPresHeartbeat  = null;

// ══════════════════════════════════════════════════════════════════════════
// INICIALIZACIÓN
// ══════════════════════════════════════════════════════════════════════════
function initFirebase() {
    if (!window.firebase) return false;
    try {
        // Reutilizar app si ya fue inicializada (hot-reload, etc.)
        let app;
        try { app = firebase.app(); } catch (_) { app = firebase.initializeApp(FIREBASE_CONFIG); }

        _db      = firebase.firestore();
        _rtdb    = firebase.database();
        _storage = firebase.storage();

        // Opcional: habilitar persistencia offline de Firestore
        _db.enablePersistence({ synchronizeTabs: true }).catch(() => {});

        supabase      = _createShim();
        supabaseReady = true;
        console.log('[Nexus] Firebase inicializado correctamente.');
        _seedDefaultData();
        setTimeout(updateStatusIndicator, 300);
        return true;
    } catch (e) {
        console.error('[Nexus] Error al inicializar Firebase:', e);
        return false;
    }
}

// Datos iniciales por defecto (servidor y canales si no existen)
async function _seedDefaultData() {
    try {
        const serverDoc = _db.collection('servers').doc('nexus-default');
        const snap = await serverDoc.get();
        if (!snap.exists) {
            const now = new Date().toISOString();
            await serverDoc.set({ id: 'nexus-default', name: 'Nexus Global', icon: '🌌', created_at: now });

            const channels = _db.collection('channels');
            const defaultChannels = [
                { id: 'general',        name: 'general',        type: 'text',  server_id: 'nexus-default' },
                { id: 'lounge',         name: 'lounge',         type: 'text',  server_id: 'nexus-default' },
                { id: 'clips-and-memes',name: 'clips-and-memes',type: 'text',  server_id: 'nexus-default' },
                { id: 'estrategia',     name: 'estrategia',     type: 'text',  server_id: 'nexus-default' },
                { id: 'general-voice',  name: 'General Voice',  type: 'voice', server_id: 'nexus-default' },
                { id: 'squad-1',        name: 'Squad Alpha',    type: 'voice', server_id: 'nexus-default' },
            ];
            await Promise.all(defaultChannels.map(ch => channels.doc(ch.id).set({ ...ch, created_at: now })));
            console.log('[Nexus] Datos por defecto sembrados en Firebase.');
        }
    } catch (e) {
        // Sin conexión o ya existían — ignorar
    }
}

// Intentar inicializar; el SDK de Firebase puede no haber cargado aún
if (!initFirebase()) {
    const _initInterval = setInterval(() => {
        if (initFirebase()) clearInterval(_initInterval);
    }, 80);
}

function _sanitizeForFirestore(obj) {
    if (obj === null || obj === undefined) return null;
    if (typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(_sanitizeForFirestore);
    const clean = {};
    for (const [k, v] of Object.entries(obj)) {
        if (v !== undefined) {
            clean[k] = (typeof v === 'object' && v !== null && !(v instanceof Date))
                ? _sanitizeForFirestore(v)
                : v;
        }
    }
    return clean;
}

// ══════════════════════════════════════════════════════════════════════════
// QUERY BUILDER — imita la API fluente de Supabase (.from().select()...)
// ══════════════════════════════════════════════════════════════════════════
class _Query {
    constructor(table) {
        this._t    = table;
        this._cond = [];
        this._ord  = null;
        this._lim  = null;
        this._op   = 'select';
        this._payload = null;
        this._upsertOpts = null;
        this._isSingle = false;
        this._selectFields = '*';
    }

    // ── Operaciones ───────────────────────────────────────────────────────
    select(fields = '*') {
        this._selectFields = fields;
        if (this._op !== 'insert' && this._op !== 'upsert') {
            this._op = 'select';
        }
        return this;
    }
    insert(data)      { this._op = 'insert'; this._payload = data; return this; }
    upsert(data, opt) { this._op = 'upsert'; this._payload = data; this._upsertOpts = opt; return this; }
    delete()          { this._op = 'delete'; return this; }

    // ── Filtros ───────────────────────────────────────────────────────────
    eq(col, val) { this._cond.push({ op: '==', col, val }); return this; }
    lt(col, val) { this._cond.push({ op: '<',  col, val }); return this; }

    // ── Modificadores ─────────────────────────────────────────────────────
    order(col, { ascending = true } = {}) { this._ord = { col, dir: ascending ? 'asc' : 'desc' }; return this; }
    limit(n)  { this._lim = n; return this._exec(); }
    single()  { this._isSingle = true; return this._exec(); }

    // ── Thenable: permite usar `await supabase.from(...).select()...` ─────
    then(res, rej) { return this._exec().then(res, rej); }

    // ── Ejecución ─────────────────────────────────────────────────────────
    _exec() {
        if (this._op === 'select') return this._select();
        if (this._op === 'insert') return this._insert();
        if (this._op === 'upsert') return this._upsert();
        if (this._op === 'delete') return this._delete();
        return Promise.resolve({ data: null, error: { message: 'op desconocida' } });
    }

    async _select() {
        try {
            let q = _db.collection(this._t);
            this._cond.forEach(c => { q = q.where(c.col, c.op, c.val); });
            
            let snap;
            try {
                let qOrdered = q;
                if (this._ord) qOrdered = qOrdered.orderBy(this._ord.col, this._ord.dir);
                if (this._lim) qOrdered = qOrdered.limit(this._lim);
                snap = await qOrdered.get();
            } catch (queryErr) {
                // Fallback automático si Firestore pide índice compuesto (ej: channel_id + created_at)
                console.warn(`[FB] Consulta sin índice compuesta en ${this._t}, ordenando localmente en memoria:`, queryErr.message);
                snap = await q.get();
            }

            let data = snap.docs.map(d => ({ id: d.id, ...d.data() }));

            // Si ordenamos en memoria por fallback:
            if (this._ord && data.length > 0) {
                const col = this._ord.col;
                const isAsc = this._ord.dir === 'asc';
                data.sort((a, b) => {
                    const valA = a[col] || '';
                    const valB = b[col] || '';
                    if (valA < valB) return isAsc ? -1 : 1;
                    if (valA > valB) return isAsc ? 1 : -1;
                    return 0;
                });
                if (this._lim && data.length > this._lim) {
                    data = data.slice(0, this._lim);
                }
            }

            if (this._isSingle) {
                return data[0]
                    ? { data: data[0], error: null }
                    : { data: null, error: { message: 'Not found', code: 'PGRST116' } };
            }
            return { data, error: null };
        } catch (e) {
            console.error(`[FB] select(${this._t}):`, e.message);
            return { data: null, error: { message: e.message } };
        }
    }

    async _insert() {
        try {
            const now = new Date().toISOString();
            const col = _db.collection(this._t);
            const items = Array.isArray(this._payload) ? this._payload : [this._payload];
            const results = [];

            for (const item of items) {
                const rec = _sanitizeForFirestore({ ...item, created_at: item.created_at || now });
                // Servidores y canales tienen ID propio (text)
                if (rec.id && (this._t === 'servers' || this._t === 'channels')) {
                    await col.doc(String(rec.id)).set(rec, { merge: true });
                    results.push({ id: rec.id, ...rec });
                } else {
                    const ref = await col.add(rec);
                    results.push({ id: ref.id, ...rec });
                }
            }
            const out = Array.isArray(this._payload) ? results : [results[0]];
            return { data: out, error: null };
        } catch (e) {
            console.error(`[FB] insert(${this._t}):`, e.message);
            return { data: null, error: { message: e.message } };
        }
    }

    async _upsert() {
        try {
            const now = new Date().toISOString();
            const col = _db.collection(this._t);
            const data = _sanitizeForFirestore(this._payload);
            const conflict = this._upsertOpts?.onConflict;

            // Perfiles usan email como document ID (sanitizado)
            if (this._t === 'profiles' && data.email) {
                const docId = data.email.replace(/[^a-zA-Z0-9]/g, '_');
                await col.doc(docId).set(
                    { ...data, _email: data.email, updated_at: data.updated_at || now },
                    { merge: true }
                );
                return { data: { id: docId }, error: null };
            }

            // Buscar documento existente por campo de conflicto
            if (conflict && data[conflict]) {
                const snap = await col.where(conflict, '==', data[conflict]).limit(1).get();
                if (!snap.empty) {
                    await snap.docs[0].ref.update({ ...data, updated_at: now });
                    return { data: { id: snap.docs[0].id }, error: null };
                }
            }

            // No existe → crear
            const ref = await col.add({ ...data, created_at: now });
            return { data: { id: ref.id }, error: null };
        } catch (e) {
            console.error(`[FB] upsert(${this._t}):`, e.message);
            return { data: null, error: { message: e.message } };
        }
    }

    async _delete() {
        try {
            const idCond = this._cond.find(c => c.col === 'id' && c.op === '==');
            if (idCond && idCond.val) {
                await _db.collection(this._t).doc(String(idCond.val)).delete();
                return { data: null, error: null };
            }

            let q = _db.collection(this._t);
            this._cond.forEach(c => { q = q.where(c.col, c.op, c.val); });

            const snap = await q.get();
            if (snap.empty) return { data: null, error: null };

            const batch = _db.batch();
            snap.docs.forEach(d => batch.delete(d.ref));
            await batch.commit();
            return { data: null, error: null };
        } catch (e) {
            console.error(`[FB] delete(${this._t}):`, e.message);
            return { data: null, error: { message: e.message } };
        }
    }
}

// ══════════════════════════════════════════════════════════════════════════
// CHANNEL — imita canales Realtime de Supabase (postgres_changes + presence + broadcast)
// ══════════════════════════════════════════════════════════════════════════
class _Channel {
    constructor(name, options) {
        this.name          = name;
        this._opts         = options || {};
        this._pgHandlers   = [];   // { filter, cb }
        this._presHandlers = {};   // { sync:[], join:[], leave:[] }
        this._bcHandlers   = {};   // { event: [cb] }
        this._unsubs       = [];   // funciones de cleanup
        this._presKey      = options?.config?.presence?.key || ('u_' + Math.random().toString(36).slice(2, 8));
        this._presState    = {};
        this._rtdbRef      = null;
        this._bcRef        = null;
    }

    on(type, filterOrOpts, cb) {
        if (type === 'postgres_changes') {
            this._pgHandlers.push({ filter: filterOrOpts, cb });
        } else if (type === 'presence') {
            const ev = filterOrOpts?.event || 'sync';
            if (!this._presHandlers[ev]) this._presHandlers[ev] = [];
            this._presHandlers[ev].push(cb);
        } else if (type === 'broadcast') {
            const ev = filterOrOpts?.event || 'message';
            if (!this._bcHandlers[ev]) this._bcHandlers[ev] = [];
            this._bcHandlers[ev].push(cb);
        }
        return this;
    }

    subscribe(statusCb) {
        // ── Firestore realtime (postgres_changes) ─────────────────────────
        this._pgHandlers.forEach(({ filter, cb }) => {
            const table = filter?.table;
            if (!table) return;

            let q = _db.collection(table);

            const fs = filter.filter || '';
            const m = fs.match(/^(\w+)=eq\.(.+)$/);
            if (m) q = q.where(m[1], '==', m[2]);

            let firstSnap = true;
            const unsub = q.onSnapshot({ includeMetadataChanges: false }, snap => {
                if (firstSnap) { firstSnap = false; return; }
                snap.docChanges().forEach(change => {
                    const rowData = { id: change.doc.id, ...change.doc.data() };
                    if (change.type === 'added') {
                        cb({ eventType: 'INSERT', new: rowData, old: null });
                    } else if (change.type === 'modified') {
                        cb({ eventType: 'UPDATE', new: rowData, old: rowData });
                    } else if (change.type === 'removed') {
                        cb({ eventType: 'DELETE', new: null, old: { id: change.doc.id, ...change.doc.data() } });
                    }
                });
            }, err => console.warn(`[FB] onSnapshot(${table}):`, err.message));

            this._unsubs.push(unsub);
        });

        // ── RTDB presencia ────────────────────────────────────────────────
        if (Object.keys(this._presHandlers).length > 0) {
            this._startPresence();
        }

        // ── RTDB Broadcast (DMs y notificaciones efímeras) ────────────────
        if (Object.keys(this._bcHandlers).length > 0 || this._opts?.config?.broadcast) {
            this._startBroadcast();
        }

        if (statusCb) setTimeout(() => statusCb('SUBSCRIBED'), 100);
        return this;
    }

    _startBroadcast() {
        if (!_rtdb) return;
        const safeName = this.name.replace(/[^a-zA-Z0-9_-]/g, '_');
        this._bcRef = _rtdb.ref(`broadcast/${safeName}`);
        
        const handler = this._bcRef.limitToLast(1).on('child_added', snap => {
            const val = snap.val();
            if (!val || !val.event) return;
            // No procesar mensajes viejos (> 15 segundos)
            if (Date.now() - (val._sentAt || 0) > 15000) return;
            const cbs = this._bcHandlers[val.event] || [];
            cbs.forEach(cb => {
                try { cb({ payload: val.payload }); } catch (err) { console.error('[Broadcast CB]', err); }
            });
        });

        this._unsubs.push(() => {
            if (this._bcRef) this._bcRef.off('child_added', handler);
        });
    }

    /** Envío de eventos broadcast (Supabase Realtime Broadcast) */
    send({ type, event, payload }) {
        if (type === 'broadcast' && _rtdb) {
            const safeName = this.name.replace(/[^a-zA-Z0-9_-]/g, '_');
            const ref = _rtdb.ref(`broadcast/${safeName}`);
            const itemRef = ref.push();
            itemRef.set({
                event: event || 'message',
                payload,
                _sentAt: Date.now()
            }).then(() => {
                // Auto-borrar broadcast tras 30 segundos
                setTimeout(() => itemRef.remove().catch(() => {}), 30000);
            }).catch(e => console.warn('[FB Broadcast send]', e));
        }
        return Promise.resolve();
    }

    _startPresence() {
        const safeName = this.name.replace(/[^a-zA-Z0-9_-]/g, '_');
        this._rtdbRef = _rtdb.ref(`presence/${safeName}`);

        const handler = this._rtdbRef.on('value', snap => {
            const newState = {};
            snap.forEach(child => {
                const v = child.val();
                if (v) newState[child.key] = [v];
            });

            // Detectar joins/leaves
            const oldKeys = Object.keys(this._presState);
            const newKeys = Object.keys(newState);
            newKeys.forEach(k => {
                if (!this._presState[k])
                    this._presHandlers['join']?.forEach(cb => cb({ key: k, newPresences: newState[k] }));
            });
            oldKeys.forEach(k => {
                if (!newState[k])
                    this._presHandlers['leave']?.forEach(cb => cb({ key: k, leftPresences: this._presState[k] }));
            });

            this._presState = newState;
            this._presHandlers['sync']?.forEach(cb => cb());
        });

        this._unsubs.push(() => this._rtdbRef.off('value', handler));
    }

    /** Equivalente a supabaseChannel.track(data) */
    track(data) {
        if (!_rtdb) return Promise.resolve({ error: null });
        const safeName = this.name.replace(/[^a-zA-Z0-9_-]/g, '_');
        const ref = _rtdb.ref(`presence/${safeName}/${this._presKey}`);
        ref.onDisconnect().remove();
        return ref.set(data)
            .then(() => ({ error: null }))
            .catch(e => ({ error: e }));
    }

    /** Equivalente a supabaseChannel.presenceState() */
    presenceState() { return this._presState; }

    /** Limpiar listeners */
    unsubscribe() {
        this._unsubs.forEach(fn => typeof fn === 'function' && fn());
        this._unsubs = [];
        // Eliminar presencia del RTDB al salir
        if (_rtdb && this._presKey) {
            const safeName = this.name.replace(/[^a-zA-Z0-9_-]/g, '_');
            _rtdb.ref(`presence/${safeName}/${this._presKey}`).remove().catch(() => {});
        }
        return Promise.resolve({ error: null });
    }
}

// ══════════════════════════════════════════════════════════════════════════
// SHIM PRINCIPAL — objeto que sustituye al cliente de Supabase
// ══════════════════════════════════════════════════════════════════════════
function _createShim() {
    return {
        from: (table) => new _Query(table),

        channel: (name, options) => new _Channel(name, options),

        removeChannel: async (ch) => {
            if (ch) await ch.unsubscribe();
            return [];
        },

        storage: {
            from: (_bucket) => ({
                upload: async (path, file, opts) => {
                    try {
                        const ref = _storage.ref(path);
                        const snap = await ref.put(file, opts || {});
                        let downloadUrl = null;
                        try {
                            downloadUrl = await snap.ref.getDownloadURL();
                            if (downloadUrl) _storageUrlCache.set(path, downloadUrl);
                        } catch (_) {}
                        return { data: { path, downloadUrl }, error: null };
                    } catch (e) {
                        return { data: null, error: e };
                    }
                },
                getPublicUrl: (path) => {
                    const url = _storageUrlCache.get(path) || path;
                    return { data: { publicUrl: url } };
                }
            })
        }
    };
}

// ══════════════════════════════════════════════════════════════════════════
// PRESENCIA GLOBAL — quién está en línea (reemplaza el canal de Supabase)
// ══════════════════════════════════════════════════════════════════════════
export function startGlobalPresence(userName) {
    if (!supabase || !userName) return;

    const email      = (localStorage.getItem('nexus_user_email') || '').trim().toLowerCase();
    const presKey    = email
        ? `user_${email.replace(/[^a-zA-Z0-9]/g, '_')}`
        : `user_${userName.replace(/[^a-zA-Z0-9]/g, '_')}`;

    // Reutilizar canal existente — solo re-trackear
    if (_globalPresChannel && _globalPresHeartbeat) {
        console.log('[Presencia] Canal activo — actualizando track.');
        _globalPresChannel.track({
            name: userName, email,
            voiceChannel: _localVoiceChannel,
            online_at: new Date().toISOString()
        }).catch(e => console.warn('[Presencia] Re-track error:', e));
        return;
    }

    // Limpiar estado anterior
    if (_globalPresHeartbeat) { clearInterval(_globalPresHeartbeat); _globalPresHeartbeat = null; }
    if (_globalPresChannel)   { _globalPresChannel.unsubscribe().catch(() => {}); _globalPresChannel = null; }

    _globalPresChannel = supabase.channel('nexus:online-users', {
        config: { presence: { key: presKey } }
    });

    const track = async () => {
        if (!_globalPresChannel) return;
        try {
            await _globalPresChannel.track({
                name: userName, email,
                voiceChannel: _localVoiceChannel,
                online_at: new Date().toISOString()
            });
        } catch (e) { console.warn('[Presencia] track error:', e); }
    };

    _globalPresChannel
        .on('presence', { event: 'sync' }, () => {
            const state = _globalPresChannel.presenceState();
            updateOnlineMembersSidebar(state);
            // Mapa nombre→email para el modal de perfil
            window._nexusEmailByName = window._nexusEmailByName || {};
            Object.values(state).forEach(arr => arr.forEach(p => {
                if (p.name && p.email) window._nexusEmailByName[p.name] = p.email;
            }));
        })
        .on('presence', { event: 'join' },  ({ key }) => console.log(`[Presencia] ${key} conectado.`))
        .on('presence', { event: 'leave' }, ({ key }) => console.log(`[Presencia] ${key} desconectado.`))
        .subscribe(async (status) => {
            if (status === 'SUBSCRIBED') {
                await track();
                console.log(`[Presencia] ${userName} marcado en línea.`);
                if (_globalPresHeartbeat) clearInterval(_globalPresHeartbeat);
                _globalPresHeartbeat = setInterval(track, 25_000);
            } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                console.warn(`[Presencia] ${status}. Reintentando en 5s...`);
                setTimeout(() => { if (localStorage.getItem('nexus_user_email')) track(); }, 5000);
            } else if (status === 'CLOSED') {
                if (_globalPresHeartbeat) { clearInterval(_globalPresHeartbeat); _globalPresHeartbeat = null; }
            }
        });
}

export function stopGlobalPresence() {
    if (_globalPresHeartbeat) { clearInterval(_globalPresHeartbeat); _globalPresHeartbeat = null; }
    if (_globalPresChannel)   { _globalPresChannel.unsubscribe().catch(() => {}); _globalPresChannel = null; }
}

export function updateGlobalPresenceVoiceChannel(channelId) {
    _localVoiceChannel = channelId || null;
    if (!_globalPresChannel) return;
    const email   = (localStorage.getItem('nexus_user_email') || '').trim().toLowerCase();
    const rawName = email ? (localStorage.getItem('nexus_username_' + email) || email.split('@')[0]) : '';
    const name    = rawName ? rawName.charAt(0).toUpperCase() + rawName.slice(1) : 'Usuario';
    _globalPresChannel.track({
        name, email, voiceChannel: _localVoiceChannel, online_at: new Date().toISOString()
    }).catch(e => console.warn('[Presencia] updateVoiceChannel error:', e));
}

// ══════════════════════════════════════════════════════════════════════════
// SIDEBAR DE MIEMBROS EN LÍNEA
// ══════════════════════════════════════════════════════════════════════════
function updateOnlineMembersSidebar(presenceState) {
    const membersList  = document.querySelector('.members-list');
    const onlineCountEl = document.getElementById('online-count');
    if (!membersList) return;

    const rawEmail  = localStorage.getItem('nexus_user_email') || '';
    const myEmail   = rawEmail.trim().toLowerCase();
    const myName    = (() => {
        if (!myEmail) return null;
        const n = localStorage.getItem('nexus_username_' + myEmail) || localStorage.getItem('nexus_username_' + rawEmail);
        if (n) return n;
        const b = myEmail.split('@')[0];
        return b.charAt(0).toUpperCase() + b.slice(1);
    })();
    const myAvatar      = myEmail ? localStorage.getItem('nexus_user_avatar_' + myEmail) : null;
    const myAvatarStyle = myEmail ? (localStorage.getItem('nexus_user_avatar_style_' + myEmail) || 'circle') : 'circle';

    const onlineUsers = [];
    const seenEmails  = new Set();
    const seenNames   = new Set();

    Object.values(presenceState).forEach(presences => {
        presences.forEach(p => {
            if (!p || !p.name) return;
            const pEmail  = (p.email || '').trim().toLowerCase();
            const pName   = p.name.trim();
            const isLocal = (myEmail && pEmail && pEmail === myEmail) || (myName && pName.toLowerCase() === myName?.toLowerCase());

            const effEmail  = isLocal && myEmail  ? myEmail  : pEmail;
            const effName   = isLocal && myName   ? myName   : pName;
            const effAvatar = isLocal && myAvatar ? myAvatar : (p.avatar || '');
            const effStyle  = isLocal ? myAvatarStyle : (p.avatarStyle || 'circle');

            if (effEmail && seenEmails.has(effEmail)) return;
            if (effName  && seenNames.has(effName.toLowerCase())) return;
            if (effEmail) seenEmails.add(effEmail);
            seenNames.add(effName.toLowerCase());

            onlineUsers.push({ name: effName, email: effEmail, online_at: p.online_at || new Date().toISOString(), avatar: effAvatar, avatarStyle: effStyle });
        });
    });

    // Asegurar que el usuario local esté visible aunque la presencia aún no sincronice
    if (myName && !onlineUsers.some(u => (myEmail && u.email === myEmail) || u.name.toLowerCase() === myName.toLowerCase())) {
        onlineUsers.unshift({ name: myName, email: myEmail, online_at: new Date().toISOString(), avatar: myAvatar || '', avatarStyle: myAvatarStyle });
    }

    if (onlineCountEl) onlineCountEl.textContent = onlineUsers.length;
    window.nexusOnlineUsers = onlineUsers;

    membersList.innerHTML = '';
    onlineUsers.forEach(user => {
        const isMe    = user.name === myName;
        const initial = user.name.charAt(0).toUpperCase();
        const colors  = ['bg-blue','bg-purple','bg-green','bg-orange','bg-cyan'];
        const bg      = colors[user.name.charCodeAt(0) % colors.length];
        const radius  = user.avatarStyle === 'circle' ? '50%' : '8px';

        const avatarHtml = (user.avatar && user.avatar.startsWith('data:image/'))
            ? `<div class="avatar ${bg}" style="background-image:url(${user.avatar});background-size:cover;background-position:center;border-radius:${radius};text-indent:-9999px;"></div>`
            : `<div class="avatar ${bg}">${initial}</div>`;

        const dmBtn = !isMe
            ? `<button class="member-dm-btn" title="Mensaje directo a ${_escHtml(user.name)}" onclick="(function(e){e.stopPropagation();if(window.openDMWith)window.openDMWith('${user.email.replace(/'/g,"\\'")}','${_escHtml(user.name).replace(/'/g,"\\'")}');})(event)">💬</button>`
            : '';

        const li = document.createElement('li');
        li.className = 'member-item';
        if (isMe) li.id = 'local-user-sidebar-item';
        li.innerHTML = `
            <div class="avatar-container small">${avatarHtml}<span class="user-status online"></span></div>
            <div class="member-info">
                <span class="member-name">${_escHtml(user.name)}</span>
                <span class="member-game">${isMe ? 'Tú · En línea' : 'En línea'}</span>
            </div>${dmBtn}`;
        membersList.appendChild(li);
    });

    // Actualizar canales de voz en sidebar
    const voiceByChannel = {};
    Object.values(presenceState).forEach(presences => {
        presences.forEach(p => {
            if (p && p.voiceChannel && p.name) {
                if (!voiceByChannel[p.voiceChannel]) voiceByChannel[p.voiceChannel] = [];
                const key = (p.email || p.name).toLowerCase();
                if (!voiceByChannel[p.voiceChannel].some(x => (x.email || x.name).toLowerCase() === key))
                    voiceByChannel[p.voiceChannel].push({ name: p.name, email: p.email || '' });
            }
        });
    });

    document.querySelectorAll('[id^="voice-users-"]').forEach(container => {
        const chId    = container.id.replace('voice-users-', '');
        const members = voiceByChannel[chId] || [];
        const badge   = document.getElementById('voice-count-' + chId);
        if (badge) badge.textContent = members.length;
        const insideVoice = document.getElementById('voice-status-panel')?.classList.contains('hidden') === false;
        if (!insideVoice) {
            container.innerHTML = members.map(m => `
                <div class="sidebar-voice-user" title="${_escHtml(m.name)}">
                    <div class="sidebar-user-avatar bg-blue">${m.name.charAt(0).toUpperCase()}</div>
                    <span class="sidebar-user-name">${_escHtml(m.name)}</span>
                </div>`).join('');
        }
    });
}

function _escHtml(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/[&<>'"]/g, t => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[t] || t));
}

// ══════════════════════════════════════════════════════════════════════════
// INICIALIZACIÓN PÚBLICA — app.js llama a esta función tras el login
// ══════════════════════════════════════════════════════════════════════════
export function initSupabaseSetup() {
    window.dispatchEvent(new CustomEvent('supabase-ready', { detail: { client: supabase } }));
    updateStatusIndicator();
}

function updateStatusIndicator() {
    const dot  = document.getElementById('supabase-status-dot');
    const text = document.getElementById('supabase-status-text');
    if (!dot || !text) return;
    if (supabaseReady && supabase) {
        dot.style.background  = '#22c55e';
        dot.style.boxShadow   = '0 0 6px rgba(34,197,94,0.6)';
        text.textContent      = 'Firebase conectado – tiempo real activo';
        text.style.color      = '#22c55e';
    } else {
        dot.style.background  = '#ef4444';
        dot.style.boxShadow   = 'none';
        text.textContent      = 'Sin conexión a base de datos';
        text.style.color      = '';
    }
}

// ══════════════════════════════════════════════════════════════════════════
// PERFILES DE USUARIO
// ══════════════════════════════════════════════════════════════════════════
export async function fetchUserProfile(email) {
    if (!_db || !email) return null;
    try {
        // Buscar por document ID (email sanitizado) primero
        const docId = email.trim().toLowerCase().replace(/[^a-zA-Z0-9]/g, '_');
        const snap  = await _db.collection('profiles').doc(docId).get();
        if (snap.exists) return snap.data();

        // Fallback: buscar por campo email
        const q = await _db.collection('profiles').where('email', '==', email.trim().toLowerCase()).limit(1).get();
        return q.empty ? null : q.docs[0].data();
    } catch (e) {
        console.error('[Profile] fetchUserProfile error:', e);
        return null;
    }
}

export async function saveUserProfile(profileData) {
    if (!_db || !profileData?.email) return false;
    try {
        const docId = profileData.email.trim().toLowerCase().replace(/[^a-zA-Z0-9]/g, '_');
        await _db.collection('profiles').doc(docId).set({
            email:           profileData.email.trim().toLowerCase(),
            username:        profileData.username        || '',
            bio:             profileData.bio             || '',
            status:          profileData.status          || '',
            banner_url:      profileData.banner_url      || '',
            banner_gradient: profileData.banner_gradient || 'linear-gradient(135deg,#8b5cf6,#00d4ff)',
            social_twitch:   profileData.social_twitch   || '',
            social_steam:    profileData.social_steam    || '',
            social_twitter:  profileData.social_twitter  || '',
            updated_at:      new Date().toISOString()
        }, { merge: true });
        return true;
    } catch (e) {
        console.error('[Profile] saveUserProfile error:', e);
        return false;
    }
}

// ══════════════════════════════════════════════════════════════════════════
// STORAGE — subir banner de perfil
// ══════════════════════════════════════════════════════════════════════════
export async function uploadBannerImage(fileOrBlob, email) {
    if (!_storage || !fileOrBlob || !email) return null;
    try {
        const ext  = fileOrBlob.name ? (fileOrBlob.name.split('.').pop().toLowerCase() || 'jpg') : 'jpg';
        const path = `banners/${email.replace(/[@.]/g, '_')}_${Date.now()}.${ext}`;
        const ref  = _storage.ref(path);
        await ref.put(fileOrBlob, { contentType: fileOrBlob.type || 'image/jpeg' });
        const url = await ref.getDownloadURL();
        console.log('[Banner] Subido a Firebase Storage:', url);
        return url;
    } catch (e) {
        console.error('[Banner] uploadBannerImage error:', e);
        return null;
    }
}
