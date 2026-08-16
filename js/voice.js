/* NEXUS REAL-TIME WEBRTC VOICE ENGINE & FREQUENCY ANALYSER (ES MODULE) */

import { state, updateRenderLatency } from './app.js';
import { supabase, supabaseReady } from './supabase-client.js';

// ─────────────────────────────────────────────────────────────
// PEERJS MULTIPLAYER VOICE STATE
// ─────────────────────────────────────────────────────────────
export let peer = null;                    // Local PeerJS instance
export let presenceChannel = null;         // Supabase Presence channel for the voice room
export let activePeers = new Map();        // peerId -> { name, call, audioEl }
let localPeerId = null;             // Our PeerJS ID
export let isMultiplayerMode = false;      // True when Supabase is configured

let audioCtx = null;
let analyser = null;
let microphoneStream = null;

// Getter exportado para que camera.js y stream.js puedan combinar el audio del mic
export function getMicrophoneStream() { return microphoneStream; }
let sourceNode = null;
let javascriptNode = null;
let visualizerAnimationId = null;
let localSpeakingVadId = null; // requestAnimationFrame ID para el VAD local
let isLocalUserSpeaking = false; // estado en tiempo real del hablante local

let canvas = null;
let canvasCtx = null;

// ─────────────────────────────────────────────────────────────
// SISTEMA DE FILTROS DE MICRÓFONO (Web Audio API)
// ─────────────────────────────────────────────────────────────
let processedStream   = null;  // Stream filtrado que se envía por WebRTC
let audioDestNode     = null;  // MediaStreamDestination que captura el audio filtrado
let filterOutputNode  = null;  // Nodo final de la cadena de filtros (antes de dest)
let filterCleanupFns  = [];    // Funciones de cleanup del filtro activo
export let currentFilter = 'noise'; // Por defecto: supresión activa

// Curva de distorsión para WaveShaperNode
function makeDistortionCurve(amount) {
    const n = 256;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; ++i) {
        const x = (i * 2) / n - 1;
        curve[i] = ((Math.PI + amount) * x) / (Math.PI + amount * Math.abs(x));
    }
    return curve;
}

// Construir cadena de filtros y retornar el nodo de salida
function buildFilterChain(filterName, inputNode) {
    // Limpiar filtro anterior
    filterCleanupFns.forEach(fn => fn());
    filterCleanupFns = [];

    if (!audioCtx) return inputNode;

    switch (filterName) {

        case 'noise': {
            // ─── CADENA DE SUPRESIÓN DE RUIDO MEJORADA (v2) ───────────────
            // 1. High-pass 100Hz: elimina zumbido eléctrico (60Hz/50Hz)
            const hp = audioCtx.createBiquadFilter();
            hp.type = 'highpass';
            hp.frequency.value = 100;
            hp.Q.value = 0.9;

            // 2. Notch 50Hz — zumbido de red eléctrica (Europa/Latinoamérica)
            const notch50 = audioCtx.createBiquadFilter();
            notch50.type = 'notch';
            notch50.frequency.value = 50;
            notch50.Q.value = 35;

            // 3. Notch 60Hz — red eléctrica norteamericana
            const notch60 = audioCtx.createBiquadFilter();
            notch60.type = 'notch';
            notch60.frequency.value = 60;
            notch60.Q.value = 35;

            // 4. Notch 120Hz — segundo armónico de la red (muy común en PCs con PSU baratas)
            const notch120 = audioCtx.createBiquadFilter();
            notch120.type = 'notch';
            notch120.frequency.value = 120;
            notch120.Q.value = 25;

            // 5. Boost de presencia vocal (300Hz–3500Hz) — mantiene claridad de voz
            const voiceBoost = audioCtx.createBiquadFilter();
            voiceBoost.type = 'peaking';
            voiceBoost.frequency.value = 1800;
            voiceBoost.Q.value = 0.6;
            voiceBoost.gain.value = 3; // +3dB en zona de inteligibilidad

            // 6. Low-pass 8000Hz: corta siseo de ventiladores y ruido de alta frecuencia
            const lp = audioCtx.createBiquadFilter();
            lp.type = 'lowpass';
            lp.frequency.value = 8000;
            lp.Q.value = 0.7;

            // 7. Compresor dinámico agresivo: aplasta ruido de fondo, preserva voz
            const comp = audioCtx.createDynamicsCompressor();
            comp.threshold.value = -55;  // dB — umbral más bajo: captura más ruido
            comp.knee.value = 8;         // rodilla suave
            comp.ratio.value = 14;       // 14:1 — compresión fuerte
            comp.attack.value = 0.001;   // 1ms — reacción casi instantánea
            comp.release.value = 0.08;   // 80ms — suelta rápido para no cortar consonantes

            // 8. Noise Gate via GainNode con ScriptProcessor (umbral de energía)
            // Silencia completamente cuando el nivel cae por debajo del floor de ruido
            const gateGain = audioCtx.createGain();
            gateGain.gain.value = 1.0;

            const gateAnalyser = audioCtx.createAnalyser();
            gateAnalyser.fftSize = 256;
            const gateBuffer = new Uint8Array(gateAnalyser.frequencyBinCount);
            // Threshold 32: más alto para cortar clicks de teclado (eran 20)
            // Los clicks de teclado suelen tener RMS ~18-28 en este rango
            const GATE_THRESHOLD = 32; // RMS umbral (0-255) — por debajo = silencio
            const GATE_HOLD_MS = 80;   // ms de hold más corto = corte más rápido post-click
            let gateOpen = false;
            let lastAboveThresholdTime = 0;

            const gateInterval = setInterval(() => {
                if (!audioCtx || audioCtx.state === 'closed') {
                    clearInterval(gateInterval);
                    return;
                }
                gateAnalyser.getByteTimeDomainData(gateBuffer);
                let sum = 0;
                for (let i = 0; i < gateBuffer.length; i++) {
                    const v = (gateBuffer[i] - 128) / 128;
                    sum += v * v;
                }
                const rms = Math.sqrt(sum / gateBuffer.length) * 255;
                const now = Date.now();
                if (rms > GATE_THRESHOLD) {
                    lastAboveThresholdTime = now;
                    if (!gateOpen) {
                        gateOpen = true;
                        try { gateGain.gain.setTargetAtTime(1.0, audioCtx.currentTime, 0.005); } catch(e){}
                    }
                } else if (gateOpen && (now - lastAboveThresholdTime) > GATE_HOLD_MS) {
                    gateOpen = false;
                    try { gateGain.gain.setTargetAtTime(0.0, audioCtx.currentTime, 0.015); } catch(e){}
                }
            }, 20); // 50 Hz de polling

            // 9. Makeup gain de compensación
            const makeup = audioCtx.createGain();
            makeup.gain.value = 1.6; // +4dB aprox para compensar gate + compresor

            // Encadenar: input → hp → notch50 → notch60 → notch120 → voiceBoost → lp
            //            → comp → gateAnalyser → gateGain → makeup
            inputNode.connect(hp);
            hp.connect(notch50);
            notch50.connect(notch60);
            notch60.connect(notch120);
            notch120.connect(voiceBoost);
            voiceBoost.connect(lp);
            lp.connect(comp);
            comp.connect(gateAnalyser);
            gateAnalyser.connect(gateGain);
            gateGain.connect(makeup);

            filterCleanupFns.push(() => {
                clearInterval(gateInterval);
                try {
                    hp.disconnect(); notch50.disconnect(); notch60.disconnect();
                    notch120.disconnect(); voiceBoost.disconnect(); lp.disconnect();
                    comp.disconnect(); gateAnalyser.disconnect(); gateGain.disconnect();
                    makeup.disconnect();
                } catch(e){}
            });
            return makeup;
        }

        case 'extreme': {
            // ─── FILTRO ANTI-RUIDO EXTREMO v5: AISLAMIENTO VOCAL DE TRÁFICO Y CALLE ───
            // 1. High-Pass 220Hz: Elimina el retumbe de motores diésel, rodamiento de neumáticos y viento
            const hp = audioCtx.createBiquadFilter();
            hp.type = 'highpass';
            hp.frequency.value = 220;
            hp.Q.value = 1.4;

            // 2. Low-Pass 3400Hz (Banda Telefónica Estándar): Corta los cláxones lejanos, viento agudo y siseos de asfalto mojado
            const lp = audioCtx.createBiquadFilter();
            lp.type = 'lowpass';
            lp.frequency.value = 3400;
            lp.Q.value = 1.0;

            // 3. Notch Filter en 500Hz: Frecuencia de resonancia metálica de carrocerías y tubos de escape
            const exhaustNotch = audioCtx.createBiquadFilter();
            exhaustNotch.type = 'notch';
            exhaustNotch.frequency.value = 500;
            exhaustNotch.Q.value = 2.5;

            // 4. Compresor Expansor Múltiple: Aumenta el contraste de la voz sobre el ruido continuo
            const comp = audioCtx.createDynamicsCompressor();
            comp.threshold.value = -28;
            comp.knee.value = 2;
            comp.ratio.value = 16;
            comp.attack.value = 0.001; // 1ms: suprime inmediatamente cláxones y ladridos
            comp.release.value = 0.04;

            // 5. Gate Gain (Silencio dinámico de fondo)
            const gateGain = audioCtx.createGain();
            gateGain.gain.value = 0.0; // Silencio total en pausas

            // 6. Analizador de Formantes Vocales
            const analyser = audioCtx.createAnalyser();
            analyser.fftSize = 256;
            analyser.smoothingTimeConstant = 0.05;
            const freqData = new Float32Array(analyser.frequencyBinCount);

            let lastVoiceTime = 0;
            const HOLD_MS = 350; // Aumentado a 350ms para evitar cortes entre sílabas y pausas cortas al hablar

            const gateInterval = setInterval(() => {
                if (!audioCtx || audioCtx.state === 'closed') {
                    clearInterval(gateInterval);
                    return;
                }

                analyser.getFloatFrequencyData(freqData);
                const sampleRate = audioCtx.sampleRate || 48000;

                // Banda Formante Vocal Humana (200Hz a 2800Hz)
                const bStart = Math.floor((200 * 256) / sampleRate);
                const bEnd   = Math.floor((2800 * 256) / sampleRate);
                let sum = -100;
                let count = 0;
                for (let i = bStart; i <= bEnd; i++) {
                    if (freqData[i] > -100) { sum += freqData[i]; count++; }
                }
                const avgVocalPower = count > 0 ? (sum / count) : -100;

                const now = Date.now();
                // Umbral más permisivo (-64 dBFS) para capturar voz suave o susurrada sin cortar la frase
                const isSpeaking = avgVocalPower > -64;

                if (isSpeaking) {
                    lastVoiceTime = now;
                    try { gateGain.gain.setTargetAtTime(1.1, audioCtx.currentTime, 0.008); } catch(e){}
                } else if ((now - lastVoiceTime) > HOLD_MS) {
                    // Desvanecimiento suave (fade out) de 40ms en lugar de corte seco
                    try { gateGain.gain.setTargetAtTime(0.0, audioCtx.currentTime, 0.04); } catch(e){}
                }
            }, 12);

            const makeup = audioCtx.createGain();
            makeup.gain.value = 1.3;

            inputNode.connect(hp);
            hp.connect(lp);
            lp.connect(exhaustNotch);
            exhaustNotch.connect(comp);
            comp.connect(analyser);
            analyser.connect(gateGain);
            gateGain.connect(makeup);

            filterCleanupFns.push(() => {
                clearInterval(gateInterval);
                try {
                    hp.disconnect(); lp.disconnect(); exhaustNotch.disconnect();
                    comp.disconnect(); analyser.disconnect(); gateGain.disconnect(); makeup.disconnect();
                } catch(e){}
            });
            return makeup;
        }

        case 'robot': {
            // Robot: ring modulation (multiplicar señal por oscilaación)
            const osc = audioCtx.createOscillator();
            osc.type = 'square';
            osc.frequency.value = 60;
            osc.start();

            const ringModGain = audioCtx.createGain();
            ringModGain.gain.value = 0; // modulado por el oscilador

            // AM: conectar osc al parámetro gain del nodo de ring mod
            osc.connect(ringModGain.gain);
            inputNode.connect(ringModGain);

            // Pasamos también la señal original mezclada para legibilidad
            const dryGain = audioCtx.createGain();
            dryGain.gain.value = 0.3;
            inputNode.connect(dryGain);

            const merger = audioCtx.createGain();
            merger.gain.value = 1;
            ringModGain.connect(merger);
            dryGain.connect(merger);

            filterCleanupFns.push(() => {
                try { osc.stop(); osc.disconnect(); ringModGain.disconnect(); dryGain.disconnect(); merger.disconnect(); } catch(e){}
            });
            return merger;
        }

        case 'radio': {
            // Radio: bandpass estrecho + distorsión ligera
            const bp = audioCtx.createBiquadFilter();
            bp.type = 'bandpass';
            bp.frequency.value = 1800;
            bp.Q.value = 0.7;

            const dist = audioCtx.createWaveShaper();
            dist.curve = makeDistortionCurve(60);
            dist.oversample = '4x';

            const hiss = audioCtx.createBiquadFilter();
            hiss.type = 'highshelf';
            hiss.frequency.value = 4000;
            hiss.gain.value = 6;

            inputNode.connect(bp);
            bp.connect(dist);
            dist.connect(hiss);

            filterCleanupFns.push(() => { try { bp.disconnect(); dist.disconnect(); hiss.disconnect(); } catch(e){} });
            return hiss;
        }

        case 'megaphone': {
            // Megáfono: bandpass angosto + distorsión fuerte
            const hp = audioCtx.createBiquadFilter();
            hp.type = 'highpass';
            hp.frequency.value = 700;

            const lp = audioCtx.createBiquadFilter();
            lp.type = 'lowpass';
            lp.frequency.value = 3500;

            const dist = audioCtx.createWaveShaper();
            dist.curve = makeDistortionCurve(200);
            dist.oversample = '2x';

            const boost = audioCtx.createGain();
            boost.gain.value = 1.5;

            inputNode.connect(hp);
            hp.connect(lp);
            lp.connect(dist);
            dist.connect(boost);

            filterCleanupFns.push(() => { try { hp.disconnect(); lp.disconnect(); dist.disconnect(); boost.disconnect(); } catch(e){} });
            return boost;
        }

        case 'echo': {
            // Eco/Reverb: delay con feedback
            const delay = audioCtx.createDelay(2.0);
            delay.delayTime.value = 0.25;

            const feedback = audioCtx.createGain();
            feedback.gain.value = 0.45;

            const wetGain = audioCtx.createGain();
            wetGain.gain.value = 0.6;

            const dryGain = audioCtx.createGain();
            dryGain.gain.value = 1.0;

            const merger = audioCtx.createGain();

            // Dry path
            inputNode.connect(dryGain);
            dryGain.connect(merger);

            // Wet path (con feedback loop)
            inputNode.connect(delay);
            delay.connect(feedback);
            feedback.connect(delay);  // loop
            delay.connect(wetGain);
            wetGain.connect(merger);

            filterCleanupFns.push(() => {
                try {
                    feedback.gain.value = 0; // romper el loop de feedback antes de desconectar
                    delay.disconnect(); feedback.disconnect(); wetGain.disconnect();
                    dryGain.disconnect(); merger.disconnect();
                } catch(e){}
            });
            return merger;
        }

        case 'bass': {
            // Voz grave: boost de bajas frecuencias
            const peak = audioCtx.createBiquadFilter();
            peak.type = 'peaking';
            peak.frequency.value = 150;
            peak.Q.value = 1;
            peak.gain.value = 12;

            const lowShelf = audioCtx.createBiquadFilter();
            lowShelf.type = 'lowshelf';
            lowShelf.frequency.value = 400;
            lowShelf.gain.value = 6;

            const comp = audioCtx.createDynamicsCompressor();
            comp.threshold.value = -12;
            comp.ratio.value = 3;

            inputNode.connect(peak);
            peak.connect(lowShelf);
            lowShelf.connect(comp);

            filterCleanupFns.push(() => { try { peak.disconnect(); lowShelf.disconnect(); comp.disconnect(); } catch(e){} });
            return comp;
        }

        case 'chipmunk': {
            // Voz aguda: treble boost + supresión de graves
            const hp = audioCtx.createBiquadFilter();
            hp.type = 'highpass';
            hp.frequency.value = 400;

            const highShelf = audioCtx.createBiquadFilter();
            highShelf.type = 'highshelf';
            highShelf.frequency.value = 2500;
            highShelf.gain.value = 14;

            const presence = audioCtx.createBiquadFilter();
            presence.type = 'peaking';
            presence.frequency.value = 3500;
            presence.Q.value = 0.8;
            presence.gain.value = 8;

            inputNode.connect(hp);
            hp.connect(highShelf);
            highShelf.connect(presence);

            filterCleanupFns.push(() => { try { hp.disconnect(); highShelf.disconnect(); presence.disconnect(); } catch(e){} });
            return presence;
        }

        default: // 'none' — sin filtro
            return inputNode;
    }
}

// Aplicar filtro: reconstruir la cadena y reemplazar la pista en peers activos
export function setVoiceFilter(filterName) {
    if (!audioCtx || !inputVolumeNode || !audioDestNode) {
        currentFilter = filterName; // guardar para aplicar cuando empiece el audio
        updateFilterUI(filterName);
        return;
    }

    currentFilter = filterName;

    // Desconectar cadena anterior del destino
    try { if (filterOutputNode) filterOutputNode.disconnect(audioDestNode); } catch(e){}
    try { if (filterOutputNode) filterOutputNode.disconnect(analyser); } catch(e){}
    try { inputVolumeNode.disconnect(); } catch(e){}

    // Reconstruir cadena de filtros
    filterOutputNode = buildFilterChain(filterName, inputVolumeNode);

    // Reconectar al analyser y al destino
    filterOutputNode.connect(analyser);
    filterOutputNode.connect(audioDestNode);

    // Reemplazar la pista de audio en todos los peers WebRTC activos
    if (processedStream) {
        const newTrack = processedStream.getAudioTracks()[0];
        if (newTrack) {
            activePeers.forEach((peerData, peerId) => {
                const pc = peerData.call?.peerConnection;
                if (pc) {
                    const sender = pc.getSenders().find(s => s.track?.kind === 'audio');
                    if (sender) {
                        sender.replaceTrack(newTrack).catch(err =>
                            console.warn(`[Filtro] No se pudo reemplazar pista en ${peerId}:`, err)
                        );
                    }
                }
            });
        }
    }

    updateFilterUI(filterName);
    console.log(`[Filtro] Filtro aplicado: ${filterName}`);
}

function updateFilterUI(filterName) {
    document.querySelectorAll('.mic-filter-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.filter === filterName);
    });
}

// Datos de miembros virtuales en la sala de voz
const voiceChannelMembers = {
    'general-voice': [],
    'squad-1': [],
    'squad-2': []
};

let activeMembersInRoom = [];
let voiceSpeakerLoopInterval = null;

// Variables del motor de volumen de Entrada/Salida
let inputVolumeNode = null;
let selectedInputDeviceId = 'default';
let selectedOutputDeviceId = 'default';
let audioInputVolume = 1.0;  // 0.0 a 1.5 (sensibilidad)
let audioOutputVolume = 1.0; // 0.0 a 1.0 (volumen global)

// Mapa de volumen personal por peerId (solo local, no afecta a otros)
const perUserVolume = new Map(); // peerId -> number (0.0 a 1.0, default 1.0)
let isTestingMic = false;
let micTestAnalyser = null;
let micTestStream = null;
let micTestAnimationId = null;

export function initVoice() {
    // Limpiar la lista OP de sesiones anteriores al iniciar.
    // Solo el email hardcodeado (OP_EMAIL) tiene OP permanente;
    // la lista dinámica solo sirve para grants temporales de esa sesión.
    localStorage.removeItem('nexus_op_list');

    canvas = document.getElementById('audio-canvas');
    if (canvas) {
        canvasCtx = canvas.getContext('2d');
        resizeCanvas();
        window.addEventListener('resize', resizeCanvas);
    }

    // Vincular controles de la barra de voz
    const muteBtn = document.getElementById('voice-mute-btn');
    const deafenBtn = document.getElementById('voice-deafen-btn');
    const disconnectBtn = document.getElementById('voice-disconnect-btn');

    if (muteBtn) {
        muteBtn.addEventListener('click', toggleMute);
    }
    if (deafenBtn) {
        deafenBtn.addEventListener('click', toggleDeafen);
    }
    if (disconnectBtn) {
        disconnectBtn.addEventListener('click', disconnectVoiceChannel);
    }

    // Botón OP "Silenciar Todos" — solo visible cuando el usuario es OP
    const muteAllOpBtn = document.getElementById('voice-mute-all-op-btn');
    if (muteAllOpBtn) {
        // Mostrar el botón solo si el usuario es OP
        if (isCurrentUserOp()) {
            muteAllOpBtn.classList.remove('hidden');
        }
        muteAllOpBtn.addEventListener('click', () => {
            if (!isCurrentUserOp()) return; // doble verificación
            const allMuted = [...activePeers.keys()].every(pid => locallyMutedPeers.get(pid));
            if (allMuted) {
                // Restaurar todos
                activePeers.forEach((_, pid) => {
                    locallyMutedPeers.set(pid, false);
                    const pd = activePeers.get(pid);
                    if (pd && pd.audioEl) {
                        pd.audioEl.volume = audioOutputVolume;
                        pd.audioEl.muted = false;
                    }
                });
                muteAllOpBtn.textContent = '🔇';
                muteAllOpBtn.title = 'Silenciar a todos los participantes';
                muteAllOpBtn.classList.remove('muted');
            } else {
                // Silenciar todos
                activePeers.forEach((pd, pid) => {
                    locallyMutedPeers.set(pid, true);
                    if (pd && pd.audioEl) {
                        pd.audioEl.volume = 0;
                        pd.audioEl.muted = true;
                    }
                });
                muteAllOpBtn.textContent = '🔊 Restaurar';
                muteAllOpBtn.title = 'Restaurar audio de todos los participantes';
                muteAllOpBtn.classList.add('muted');
            }
            renderVoiceMembers();
        });
    }

    // Aplicar filtro por defecto (noise) para que Sin Filtro arranque con supresión activa
    // (se aplica al conectar el micrófono en startAudioEngine, no aquí)
    // El data-filter="noise" en index.html ya marca el botón como activo visualmente.

    // Vincular botones del panel de filtros de micrófono
    document.querySelectorAll('.mic-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            setVoiceFilter(btn.dataset.filter);
        });
    });

    // Colapsar / expandir panel de filtros
    const filtersPanel = document.getElementById('mic-filters-panel');
    const filtersToggle = document.getElementById('filters-header-toggle');
    if (filtersPanel && filtersToggle) {
        // Restaurar estado guardado
        if (localStorage.getItem('nexus_filters_collapsed') === '1') {
            filtersPanel.classList.add('collapsed');
        }
        filtersToggle.addEventListener('click', (e) => {
            // Evitar que el click en los propios botones de filtro colapsen el panel
            if (e.target.closest('.mic-filter-btn')) return;
            filtersPanel.classList.toggle('collapsed');
            localStorage.setItem('nexus_filters_collapsed',
                filtersPanel.classList.contains('collapsed') ? '1' : '0');
        });
    }

    // Botón de acceso rápido a Ajustes de Micrófono / Audio
    const quickAudioSettingsBtn = document.getElementById('voice-settings-quick-btn');
    if (quickAudioSettingsBtn) {
        quickAudioSettingsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const themePanel = document.getElementById('theme-panel');
            if (themePanel) themePanel.classList.add('open');
        });
    }

    // --- ENLACE A AJUSTES DE AUDIO (ENTRADA Y SALIDA) ---
    initAudioDevicesConfig();
}

async function initAudioDevicesConfig() {
    const inputSelect = document.getElementById('audio-input-device');
    const outputSelect = document.getElementById('audio-output-device');
    const inputVolumeRange = document.getElementById('audio-input-volume');
    const inputVolLabel = document.getElementById('audio-input-vol-label');
    const outputVolumeRange = document.getElementById('audio-output-volume');
    const outputVolLabel = document.getElementById('audio-output-vol-label');
    const micTestBtn = document.getElementById('mic-test-btn');

    // Enumerar dispositivos reales
    await enumerateAudioDevices(inputSelect, outputSelect);
    
    // Escuchar adición/sustracción de hardware en vivo
    navigator.mediaDevices.addEventListener('devicechange', () => {
        enumerateAudioDevices(inputSelect, outputSelect);
    });

    // Eventos de dispositivo
    if (inputSelect) {
        inputSelect.addEventListener('change', async (e) => {
            selectedInputDeviceId = e.target.value;
            console.log(`[Audio Config] Micrófono cambiado a deviceId: ${selectedInputDeviceId}`);
            // Si estamos en un canal de voz activo, reconectar el micrófono en caliente
            if (state.activeVoiceChannel) {
                await startAudioEngine();
                // Actualizar el track enviando a los peers en caliente
                const newAudioTrack = microphoneStream ? microphoneStream.getAudioTracks()[0] : null;
                if (newAudioTrack && activePeers.size > 0) {
                    activePeers.forEach(({ call }) => {
                        if (call && call.peerConnection) {
                            const senders = call.peerConnection.getSenders();
                            const audioSender = senders.find(s => s.track && s.track.kind === 'audio');
                            if (audioSender) {
                                audioSender.replaceTrack(newAudioTrack).catch(err => {
                                    console.warn('[Audio Config] Error reemplazando track en llamada PeerJS:', err);
                                });
                            }
                        }
                    });
                }
            }
        });
    }

    if (outputSelect) {
        outputSelect.addEventListener('change', (e) => {
            selectedOutputDeviceId = e.target.value;
            console.log(`[Audio Config] Altavoz/Auricular cambiado a deviceId: ${selectedOutputDeviceId}`);
            applyOutputDeviceSink();
        });
    }

    // Eventos de Sliders de Volumen
    if (inputVolumeRange) {
        inputVolumeRange.addEventListener('input', (e) => {
            const val = e.target.value;
            audioInputVolume = val / 100;
            if (inputVolLabel) inputVolLabel.textContent = `${val}%`;
            
            // Aplicar ganancia en caliente
            if (inputVolumeNode && audioCtx) {
                inputVolumeNode.gain.setValueAtTime(audioInputVolume, audioCtx.currentTime);
            }
        });
    }

    if (outputVolumeRange) {
        outputVolumeRange.addEventListener('input', (e) => {
            const val = e.target.value;
            audioOutputVolume = val / 100;
            if (outputVolLabel) outputVolLabel.textContent = `${val}%`;
            
            // Aplicar volumen general a los elementos de audio del navegador (audio tags de salida, bot de música)
            applyOutputVolumeGlobal();
        });
    }

    // Evento de prueba de micrófono (Mic Test)
    if (micTestBtn) {
        micTestBtn.addEventListener('click', toggleMicTest);
    }
}

async function enumerateAudioDevices(inputSelect, outputSelect) {
    if (!inputSelect || !outputSelect) return;

    try {
        // Solicitar permisos rápidos para que se enlisten nombres reales y no vacíos
        try {
            await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (permissionErr) {
            console.warn('[Audio Devices] Permiso de micrófono denegado para enlistar nombres reales:', permissionErr);
        }
        
        const devices = await navigator.mediaDevices.enumerateDevices();

        inputSelect.innerHTML = '';
        outputSelect.innerHTML = '';

        // Añadir una opción por defecto para evitar listas vacías
        const defaultInputOpt = document.createElement('option');
        defaultInputOpt.value = 'default';
        defaultInputOpt.textContent = 'Micrófono por Defecto';
        inputSelect.appendChild(defaultInputOpt);
        
        const defaultOutputOpt = document.createElement('option');
        defaultOutputOpt.value = 'default';
        defaultOutputOpt.textContent = 'Altavoz por Defecto';
        outputSelect.appendChild(defaultOutputOpt);

        devices.forEach(device => {
            // Ignorar los dispositivos con ID 'default' si ya los pusimos manualmente, o agruparlos
            if (device.deviceId === 'default' || !device.deviceId) return;

            const opt = document.createElement('option');
            opt.value = device.deviceId;
            opt.textContent = device.label || `${device.kind === 'audioinput' ? 'Micrófono' : 'Altavoz/Auricular'} (${device.deviceId.slice(0, 5)})`;

            if (device.kind === 'audioinput') {
                inputSelect.appendChild(opt);
            } else if (device.kind === 'audiooutput') {
                outputSelect.appendChild(opt);
            }
        });

    } catch (err) {
        console.warn('[Audio Devices] Error enumerando hardware:', err);
    }
}

// Aplica el sink de salida (altavoces/auriculares) a todos los elementos de reproducción activos
function applyOutputDeviceSink() {
    // 1. Aplicar a reproductor de video local (si existe)
    const video = document.getElementById('local-stream-video');
    if (video && typeof video.setSinkId === 'function') {
        video.setSinkId(selectedOutputDeviceId).then(() => {
            console.log(`[Audio Config] Salida de vídeo acoplada a deviceId: ${selectedOutputDeviceId}`);
        }).catch(err => console.warn('[Audio Config] Fallo al establecer sink en reproductor de vídeo:', err));
    }

    // 2. Aplicar a todos los elementos de audio remoto de los peers activos
    activePeers.forEach((peer, peerId) => {
        if (peer.audioEl && typeof peer.audioEl.setSinkId === 'function') {
            peer.audioEl.setSinkId(selectedOutputDeviceId).then(() => {
                console.log(`[Audio Config] Salida de audio de peer ${peerId} acoplada a: ${selectedOutputDeviceId}`);
            }).catch(err => console.warn(`[Audio Config] Fallo al establecer sink para peer ${peerId}:`, err));
        }
    });
}

// Controla el volumen general del Bot de Música y de la reproducción
async function applyOutputVolumeGlobal() {
    // Intentar importar en caliente para evitar dependencias circulares directas en carga
    const { updateMusicVolume } = await import('./music.js');
    const targetVol = getOutputVolume();
    updateMusicVolume(targetVol);

    // Actualizar volumen de todos los peers activos
    activePeers.forEach(peer => {
        if (peer.audioEl) {
            peer.audioEl.volume = targetVol;
        }
    });

    // Silenciar/desilenciar video de directo
    const remoteVideo = document.getElementById('local-stream-video');
    if (remoteVideo) {
        remoteVideo.muted = state.isDeafened;
    }

    console.log(`[Audio Config] Salida global de audio ajustada al: ${Math.round(targetVol * 100)}%`);
}

// Obtener volumen general para el sintetizador de música (exportable)
export function getOutputVolume() {
    if (state.isDeafened) return 0;
    return audioOutputVolume;
}

// Lógica para encender/apagar el testador LED de micrófono y retorno
let micTestAudioCtx = null;
let micTestLocalAudioNode = null;

async function toggleMicTest() {
    const btn = document.getElementById('mic-test-btn');
    const fill = document.getElementById('mic-level-fill');

    if (isTestingMic) {
        // Apagar test
        isTestingMic = false;
        if (btn) btn.textContent = 'Probar';
        if (fill) fill.style.width = '0%';
        
        if (micTestAnimationId) {
            cancelAnimationFrame(micTestAnimationId);
            micTestAnimationId = null;
        }
        if (micTestStream) {
            micTestStream.getTracks().forEach(track => track.stop());
            micTestStream = null;
        }
        if (micTestAudioCtx) {
            if (micTestAudioCtx.state !== 'closed') {
                micTestAudioCtx.close();
            }
            micTestAudioCtx = null;
        }
        micTestLocalAudioNode = null;
        micTestAnalyser = null;
        console.log('[Audio Test] Prueba finalizada.');
    } else {
        // Iniciar test
        isTestingMic = true;
        if (btn) btn.textContent = 'Parar';
        console.log('[Audio Test] Iniciando prueba de micrófono...');

        try {
            micTestStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    deviceId: selectedInputDeviceId !== 'default' ? { exact: selectedInputDeviceId } : undefined,
                    echoCancellation: false,
                    noiseSuppression: false
                }
            });

            micTestAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
            
            // Si hay un dispositivo de salida específico y el navegador soporta setSinkId en AudioContext
            if (selectedOutputDeviceId !== 'default' && typeof micTestAudioCtx.setSinkId === 'function') {
                micTestAudioCtx.setSinkId(selectedOutputDeviceId).catch(err => 
                    console.warn('[Audio Test] No se pudo asignar el dispositivo de salida al context de test:', err)
                );
            }

            micTestAnalyser = micTestAudioCtx.createAnalyser();
            micTestAnalyser.fftSize = 32;

            const source = micTestAudioCtx.createMediaStreamSource(micTestStream);
            source.connect(micTestAnalyser);

            // Conectar retorno local para poder escucharse a sí mismo (con ganancia controlada)
            micTestLocalAudioNode = micTestAudioCtx.createGain();
            micTestLocalAudioNode.gain.setValueAtTime(0.8, micTestAudioCtx.currentTime);
            
            source.connect(micTestLocalAudioNode);
            micTestLocalAudioNode.connect(micTestAudioCtx.destination);

            // Bucle rápido para actualizar la barra LED
            runMicTestLoop();

        } catch (err) {
            console.error('[Audio Test] Error al capturar micrófono para prueba:', err);
            isTestingMic = false;
            if (btn) btn.textContent = 'Probar';
        }
    }
}

function runMicTestLoop() {
    if (!isTestingMic || !micTestAnalyser) return;

    micTestAnimationId = requestAnimationFrame(runMicTestLoop);

    const bufferLength = micTestAnalyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    micTestAnalyser.getByteFrequencyData(dataArray);

    // Calcular el nivel promedio del micrófono
    let sum = 0;
    for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i];
    }
    const average = sum / bufferLength;
    const pct = Math.min((average / 150) * 100, 100);

    const fill = document.getElementById('mic-level-fill');
    if (fill) {
        fill.style.width = `${pct}%`;
    }
}

function resizeCanvas() {
    if (canvas) {
        canvas.width = canvas.parentElement.clientWidth;
        canvas.height = canvas.parentElement.clientHeight;
    }
}

// Unirse a una sala de voz
export async function joinVoiceChannel(channelId, channelName) {
    const startTime = performance.now();

    // Si ya estamos en otra sala de voz, desconectar primero
    if (state.activeVoiceChannel) {
        disconnectVoiceChannel(false);
    }

    state.activeVoiceChannel = channelId;

    // Actualizar interfaz lateral
    const statusPanel = document.getElementById('voice-status-panel');
    const activeName = document.getElementById('current-voice-channel-name');
    
    if (statusPanel) statusPanel.classList.remove('hidden');
    if (activeName) activeName.textContent = channelName;

    // Colocar badge en el canal seleccionado
    document.querySelectorAll('#voice-channels li').forEach(item => {
        if (item.getAttribute('data-channel') === channelId) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    });

    // Mostrar el contenedor de la sala de voz en el panel central
    const voiceRoomContainer = document.getElementById('voice-room-container');
    if (voiceRoomContainer) voiceRoomContainer.classList.remove('hidden');

    // Iniciar motor de audio real (micrófono)
    await startAudioEngine();

    // Decidir modo: Multiplayer (Supabase+PeerJS) o Local simulado
    if (supabaseReady && supabase && window.Peer) {
        isMultiplayerMode = true;
        activeMembersInRoom = []; // Sólo miembros reales
        renderVoiceMembers();
        await joinMultiplayerVoice(channelId);
    } else {
        isMultiplayerMode = false;
        // Fallback: modo local con miembros virtuales
        activeMembersInRoom = JSON.parse(JSON.stringify(voiceChannelMembers[channelId] || []));
        renderVoiceMembers();
        const countBadge = document.getElementById(`voice-count-${channelId}`);
        if (countBadge) countBadge.textContent = activeMembersInRoom.length;
        startVoiceSimulatingSpeakers();
    }

    updateRenderLatency(startTime);
}

// ─────────────────────────────────────────────────────────────
// MULTIPLAYER VOICE: PeerJS + Supabase Presence
// ─────────────────────────────────────────────────────────────
async function joinMultiplayerVoice(channelId) {
    const myName = getLocalUserName();

    // ── PASO 1: Unirse a la presencia de Supabase INMEDIATAMENTE ──────────────
    // No esperamos a PeerJS. Generamos un ID temporal para que las tarjetas de
    // miembros aparezcan de inmediato, incluso si PeerJS tarda o falla.
    const tempId = 'nexus_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    localPeerId = tempId;

    // Añadir tarjeta del usuario local al grid
    addMemberToRoom({ name: myName, isLocalUser: true, isMuted: state.isMuted, activeSpeaker: false, peerId: tempId });

    // Publicar presencia con el ID temporal — ya aparecemos en la sala
    await joinSupabasePresence(channelId, myName, tempId);

    // ── PASO 2: Iniciar PeerJS en segundo plano ───────────────────────────────
    // Añadimos servidores TURN para superar NAT/firewalls (causa más común de fallos P2P)
    peer = new Peer(undefined, {
        host: '0.peerjs.com',
        port: 443,
        secure: true,
        debug: 1,
        config: {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:global.stun.twilio.com:3478' },
                // Servidores TURN gratuitos (relay para NAT simétrico)
                {
                    urls: 'turn:openrelay.metered.ca:80',
                    username: 'openrelayproject',
                    credential: 'openrelayproject'
                },
                {
                    urls: 'turn:openrelay.metered.ca:443',
                    username: 'openrelayproject',
                    credential: 'openrelayproject'
                },
                {
                    urls: 'turn:openrelay.metered.ca:443?transport=tcp',
                    username: 'openrelayproject',
                    credential: 'openrelayproject'
                }
            ]
        }
    });

    peer.on('open', async (realId) => {
        console.log(`[PeerJS] Conectado. ID real: ${realId} (reemplaza temporal: ${tempId})`);

        // Actualizar el ID real del peer local
        const prevTempId = localPeerId;
        localPeerId = realId;

        // Actualizar el miembro local en la sala con el ID real
        const localMember = activeMembersInRoom.find(m => m.isLocalUser);
        if (localMember) localMember.peerId = realId;

        // Actualizar presencia con el ID real de PeerJS
        if (presenceChannel) {
            const email = localStorage.getItem('nexus_user_email') || '';
            const myAvatar = email ? (localStorage.getItem('nexus_user_avatar_' + email) || '') : '';
            const myAvatarStyle = email ? (localStorage.getItem('nexus_user_avatar_style_' + email) || 'circle') : 'circle';
            await presenceChannel.track({
                name: myName,
                email: (localStorage.getItem('nexus_user_email') || '').toLowerCase(),
                peerId: realId,
                avatar: myAvatar,
                avatarStyle: myAvatarStyle,
                isMuted: state.isMuted || state.isDeafened,
                isOp: (localStorage.getItem('nexus_user_email') || '') === OP_EMAIL,
                joinedAt: Date.now()
            });
        }

        // Re-renderizar para reflejar el ID actualizado
        renderVoiceMembers();

        // Llamar a cualquier peer que ya esté en la sala con un ID real
        const currentState = presenceChannel ? presenceChannel.presenceState() : {};
        Object.values(currentState).forEach(presences => {
            presences.forEach(p => {
                if (p.peerId && p.peerId !== realId && !p.peerId.startsWith('nexus_') && !activePeers.has(p.peerId)) {
                    console.log(`[PeerJS] Llamando a peer con ID real: ${p.name} (${p.peerId})`);
                    setTimeout(() => callPeer(p.peerId, p.name), 300);
                }
            });
        });
    });

    // 3. Atender llamadas entrantes de PeerJS
    peer.on('call', async (call) => {
        const callType = call.metadata?.type || 'audio'; // 'audio' | 'camera' | 'screen'
        console.log(`[PeerJS] Llamada entrante de: ${call.peer} (tipo: ${callType})`);

        // Responder llamadas entrantes con el stream filtrado si está disponible
        const audioAnswerStream = processedStream || microphoneStream;
        if (callType === 'camera') {
            // Dynamically import camera module to avoid circular deps
            const { getCameraStream } = await import('./camera.js');
            const camStream = getCameraStream();
            call.answer(camStream || undefined);
        } else if (callType === 'screen') {
            call.answer(); // screen share: no need to send anything back
        } else {
            // Audio call — responder con stream filtrado
            if (audioAnswerStream) {
                call.answer(audioAnswerStream);
            } else {
                call.answer();
            }
        }

        call.on('stream', async (remoteStream) => {
            console.log(`[PeerJS] Stream remoto recibido de: ${call.peer} (tipo: ${callType})`);
            if (callType === 'camera') {
                // Find the name of this peer and route to camera card
                const peerInfo = activeMembersInRoom.find(m => m.peerId === call.peer);
                const remoteName = peerInfo?.name || call.peer;
                const { attachRemoteCameraToCard } = await import('./camera.js');
                attachRemoteCameraToCard(call.peer, remoteStream, remoteName);
            } else {
                // Si es 'screen' o si la pista incluye vídeo, reproducirlo en el reproductor de directo
                playRemoteStream(call.peer, remoteStream);
            }
        });

        call.on('close', async () => {
            if (callType === 'camera') {
                const peerInfo = activeMembersInRoom.find(m => m.peerId === call.peer);
                if (peerInfo) {
                    const { detachRemoteCameraFromCard } = await import('./camera.js');
                    detachRemoteCameraFromCard(peerInfo.name);
                }
            } else {
                removeRemoteAudio(call.peer);
            }
        });
    });

    peer.on('error', (err) => {
        console.error('[PeerJS] Error:', err.type, err.message);
        // Si PeerJS falla completamente, al menos el usuario ya está en la presencia
        // (tarjeta visible). El audio no funcionará pero la UI sí.
    });
}

async function joinSupabasePresence(channelId, myName, peerId) {
    if (!supabase) return;

    const roomChannel = `voice:${channelId}`;
    const userEmail = (localStorage.getItem('nexus_user_email') || myName).toLowerCase().replace(/[^a-zA-Z0-9]/g, '_');
    const userKey = `user_${userEmail}`;

    if (presenceChannel) {
        await supabase.removeChannel(presenceChannel);
        presenceChannel = null;
    }

    presenceChannel = supabase.channel(roomChannel, {
        config: { presence: { key: userKey } }
    });

    presenceChannel.on('presence', { event: 'sync' }, () => {
        const presenceState = presenceChannel.presenceState();
        syncVoiceRoomFromPresence(presenceState, myName);

        // ── FIX: llamar a peers que YA estaban en la sala al momento del sync ──
        // El evento 'join' solo dispara para nuevos ingresos DESPUÉS de suscribirse.
        // Los peers que ya estaban presentes cuando llegamos solo aparecen en 'sync'.
        // Sin esta lógica, si ambos usuarios se unen casi al mismo tiempo, ninguno llama al otro.
        Object.values(presenceState).forEach(presences => {
            presences.forEach(presence => {
                if (
                    presence.peerId &&
                    presence.peerId !== localPeerId &&
                    !activePeers.has(presence.peerId)
                ) {
                    console.log(`[Presence Sync] Peer existente detectado: ${presence.name} — iniciando llamada...`);
                    // Pequeño delay para evitar race condition cuando ambos publican al mismo tiempo
                    setTimeout(() => callPeer(presence.peerId, presence.name), 500);
                }
            });
        });
    });

    presenceChannel.on('presence', { event: 'join' }, ({ key, newPresences }) => {
        newPresences.forEach(presence => {
            if (presence.peerId !== localPeerId) {
                console.log(`[Presence] ${presence.name} se unió. Llamando...`);
                callPeer(presence.peerId, presence.name);
            }
        });
    });

    presenceChannel.on('presence', { event: 'leave' }, ({ key, leftPresences }) => {
        leftPresences.forEach(presence => {
            console.log(`[Presence] ${presence.name} salió del canal de voz.`);
            removeRemoteAudio(presence.peerId);
            removeMemberFromRoom(presence.name);
        });
    });

    await presenceChannel.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
            const email = localStorage.getItem('nexus_user_email') || '';
            const myAvatar = email ? (localStorage.getItem('nexus_user_avatar_' + email) || '') : '';
            const myAvatarStyle = email ? (localStorage.getItem('nexus_user_avatar_style_' + email) || 'circle') : 'circle';
            await presenceChannel.track({
                name: myName,
                email: email.toLowerCase(),
                peerId: localPeerId,
                avatar: myAvatar,
                avatarStyle: myAvatarStyle,
                isMuted: state.isMuted || state.isDeafened,
                isOp: email === OP_EMAIL,
                joinedAt: Date.now()
            });
            console.log(`[Presence] Presencia publicada en ${roomChannel}`);
        }
    });
}

function syncVoiceRoomFromPresence(presenceState, myName) {
    const realMembers = [];
    const seenUsers = new Set(); // deduplicar por email o nombre
    const localEmail = (localStorage.getItem('nexus_user_email') || '').toLowerCase();

    // Recopilar presencias y aplanar
    const rawList = [];
    Object.values(presenceState).forEach(list => {
        list.forEach(p => rawList.push(p));
    });

    // Ordenar para que el localUser actual o peers con realId tengan prioridad sobre entradas obsoletas
    rawList.sort((a, b) => {
        if (a.peerId === localPeerId) return -1;
        if (b.peerId === localPeerId) return 1;
        const aTemp = a.peerId && a.peerId.startsWith('nexus_');
        const bTemp = b.peerId && b.peerId.startsWith('nexus_');
        if (!aTemp && bTemp) return -1;
        if (aTemp && !bTemp) return 1;
        return (b.joinedAt || 0) - (a.joinedAt || 0);
    });

    rawList.forEach(presence => {
        const emailKey = presence.email ? presence.email.toLowerCase() : '';
        const nameKey  = presence.name ? presence.name.toLowerCase() : '';
        const userKey  = emailKey || nameKey;

        // Si ya procesamos esta cuenta (por email o por nombre), la ignoramos
        if (userKey && !seenUsers.has(userKey) && (!emailKey || !seenUsers.has(emailKey))) {
            if (emailKey) seenUsers.add(emailKey);
            if (nameKey)  seenUsers.add(nameKey);
            seenUsers.add(userKey);

            const isLocal = presence.peerId === localPeerId || (localEmail && presence.email === localEmail) || presence.name === myName;
            realMembers.push({
                name: presence.name,
                email: presence.email,
                avatar: presence.avatar || presence.name.charAt(0).toUpperCase(),
                avatarStyle: presence.avatarStyle || 'circle',
                avatarBg: 'bg-blue',
                isMuted: presence.isMuted || false,
                activeSpeaker: false,
                isLocalUser: isLocal,
                peerId: presence.peerId,
                isOp: presence.isOp || false
            });
        }
    });

    activeMembersInRoom = realMembers;
    renderVoiceMembers();

    const countBadge = document.getElementById(`voice-count-${state.activeVoiceChannel}`);
    if (countBadge) countBadge.textContent = activeMembersInRoom.length;

    const usersContainer = document.getElementById(`voice-users-${state.activeVoiceChannel}`);
    if (usersContainer) {
        usersContainer.innerHTML = activeMembersInRoom.map(m => `
            <div class="sidebar-voice-user" title="${m.name}">
                <div class="sidebar-user-avatar ${m.avatarBg || 'bg-blue'}">${m.name ? m.name.charAt(0).toUpperCase() : '?'}</div>
                <span class="sidebar-user-name">${m.name}</span>
            </div>
        `).join('');
    }
}

function callPeer(remotePeerId, remoteName) {
    // Usar stream procesado (filtrado) si está disponible, fallback al raw
    const streamToCall = processedStream || microphoneStream;
    if (!peer || !streamToCall) return;
    if (activePeers.has(remotePeerId)) return;

    console.log(`[PeerJS] Llamando a ${remoteName} (${remotePeerId})`);
    const call = peer.call(remotePeerId, streamToCall, {
        metadata: { type: 'audio' }
    });

    call.on('stream', (remoteStream) => {
        playRemoteStream(remotePeerId, remoteStream);
    });

    // Monitor de salud de la conexión WebRTC P2P (auto-recuperación si cae el audio)
    if (call.peerConnection) {
        call.peerConnection.oniceconnectionstatechange = () => {
            const iceState = call.peerConnection.iceConnectionState;
            console.log(`[WebRTC P2P] Estado de conexión ICE con ${remoteName}: ${iceState}`);
            if (iceState === 'disconnected' || iceState === 'failed') {
                console.warn(`[WebRTC P2P] Conexión caída con ${remoteName}. Reintentando reconexión...`);
                removeRemoteAudio(remotePeerId);
                setTimeout(() => {
                    if (state.activeVoiceChannel && isMultiplayerMode && !activePeers.has(remotePeerId)) {
                        callPeer(remotePeerId, remoteName);
                    }
                }, 1500);
            }
        };
    }

    call.on('close', () => removeRemoteAudio(remotePeerId));
    call.on('error', (err) => console.error(`[PeerJS] Error en llamada a ${remoteName}:`, err));

    activePeers.set(remotePeerId, { name: remoteName, call });

    // Si estamos transmitiendo pantalla localmente, llamar con el stream de vídeo también
    import('./stream.js').then(({ activeStream }) => {
        if (state.isStreaming && activeStream) {
            console.log(`[PeerJS] Enviando vídeo de pantalla a nuevo participante: ${remoteName}`);
            // Combinar con audio del mic para que la voz no se pierda
            let streamToSend = activeStream;
            if (microphoneStream && microphoneStream.getAudioTracks().length > 0) {
                const tracks = [
                    ...activeStream.getVideoTracks(),
                    ...microphoneStream.getAudioTracks()
                ];
                activeStream.getAudioTracks().forEach(t => {
                    if (!tracks.includes(t)) tracks.push(t);
                });
                streamToSend = new MediaStream(tracks);
            }
            const videoCall = peer.call(remotePeerId, streamToSend, {
                metadata: { type: 'screen' }
            });
            const peerObj = activePeers.get(remotePeerId);
            if (peerObj) peerObj.videoCall = videoCall;
        }
    }).catch(err => console.warn('[PeerJS] Fallo al importar stream de pantalla:', err));
}

function playRemoteStream(peerId, remoteStream) {
    if (!remoteStream) return;

    // Detectar si es un stream de vídeo (compartir pantalla)
    if (remoteStream.getVideoTracks().length > 0) {
        console.log(`[PeerJS] Stream de vídeo remoto detectado del peer: ${peerId}`);
        const remoteVideo = document.getElementById('local-stream-video');
        const streamContainer = document.getElementById('stream-container');
        const placeholder = document.getElementById('stream-placeholder');
        const titleEl = document.getElementById('stream-user-title');
        
        if (remoteVideo) {
            remoteVideo.srcObject = remoteStream;
            remoteVideo.muted = false; // Permitir audio remoto del juego o stream
            remoteVideo.play().catch(err => console.warn('[Stream] Fallo al reproducir vídeo remoto:', err));
        }
        if (streamContainer) streamContainer.classList.remove('hidden');
        if (placeholder) placeholder.classList.add('hidden');
        
        if (titleEl) {
            let peerInfo = activeMembersInRoom.find(m => m.peerId === peerId);
            let broadcasterName = peerInfo ? peerInfo.name : null;
            if (!broadcasterName && presenceChannel) {
                const state = presenceChannel.presenceState();
                Object.values(state).forEach(list => {
                    list.forEach(p => {
                        if (p.peerId === peerId && p.name) broadcasterName = p.name;
                    });
                });
            }
            titleEl.textContent = `Directo de ${broadcasterName || 'Usuario Remoto'}`;
        }

        // Registrar la llamada de video en activePeers
        const existing = activePeers.get(peerId);
        if (existing) {
            existing.videoStream = remoteStream;
        } else {
            activePeers.set(peerId, { name: '', videoStream: remoteStream });
        }
        return;
    }

    let audioEl = document.getElementById(`remote-audio-${peerId}`);
    if (!audioEl) {
        audioEl = document.createElement('audio');
        audioEl.id = `remote-audio-${peerId}`;
        audioEl.autoplay = true;
        audioEl.style.display = 'none';
        document.body.appendChild(audioEl);
    }
    
    audioEl.srcObject = remoteStream;
    audioEl.volume = state.isDeafened ? 0 : audioOutputVolume;

    // Asegurar reproducción fluida si el navegador pausa el audio por inactividad
    audioEl.play().catch(err => {
        console.warn(`[Audio WebRTC] Autoplay bloqueado para peer ${peerId}, reintentando en interacción:`, err);
        const resumeOnUserAction = () => {
            audioEl.play().catch(() => {});
            document.removeEventListener('click', resumeOnUserAction);
            document.removeEventListener('keydown', resumeOnUserAction);
        };
        document.addEventListener('click', resumeOnUserAction);
        document.addEventListener('keydown', resumeOnUserAction);
    });

    if (selectedOutputDeviceId !== 'default' && typeof audioEl.setSinkId === 'function') {
        audioEl.setSinkId(selectedOutputDeviceId).catch(() => {});
    }

    const existing = activePeers.get(peerId);
    if (existing) existing.audioEl = audioEl;
    else activePeers.set(peerId, { name: '', audioEl });
}

function removeRemoteAudio(peerId) {
    const audioEl = document.getElementById(`remote-audio-${peerId}`);
    if (audioEl) { audioEl.srcObject = null; audioEl.remove(); }
    activePeers.delete(peerId);
}

function addMemberToRoom(member) {
    const exists = activeMembersInRoom.find(m => m.name === member.name);
    if (!exists) {
        activeMembersInRoom.push(member);
        renderVoiceMembers();
    }
}

function removeMemberFromRoom(name) {
    activeMembersInRoom = activeMembersInRoom.filter(m => m.name !== name);
    renderVoiceMembers();
    const countBadge = document.getElementById(`voice-count-${state.activeVoiceChannel}`);
    if (countBadge) countBadge.textContent = activeMembersInRoom.length;
}

// Desconectar de la sala de voz
export function disconnectVoiceChannel(triggerUI = true) {
    const startTime = performance.now();
    
    if (!state.activeVoiceChannel) return;
    
    const prevChannel = state.activeVoiceChannel;
    state.activeVoiceChannel = null;

    console.log('[Voz] Cerrando conexiones WebRTC.');

    // Apagar cámara si estaba activa
    import('./camera.js').then(({ stopCamera }) => stopCamera()).catch(() => {});

    // Desconectar PeerJS y Presence de Supabase
    if (isMultiplayerMode) {
        // Cerrar todas las llamadas P2P activas
        activePeers.forEach(({ call, audioEl }, peerId) => {
            if (call) call.close();
            if (audioEl) { audioEl.srcObject = null; audioEl.remove(); }
        });
        activePeers.clear();
        // Desregistrar presencia y desuscribirse limpiamente
        if (presenceChannel && supabase) {
            try {
                presenceChannel.untrack();
                supabase.removeChannel(presenceChannel);
            } catch(e){}
            presenceChannel = null;
        }

        // Destruir instancia PeerJS
        if (peer) {
            try { peer.destroy(); } catch(e){}
            peer = null;
        }
        isMultiplayerMode = false;
    }

    // Limpiar árbol de miembros en la barra lateral
    if (prevChannel) {
        const usersContainer = document.getElementById(`voice-users-${prevChannel}`);
        if (usersContainer) usersContainer.innerHTML = '';
    }

    // Detener analizador y streams reales
    stopAudioEngine();

    // Detener simulador de habla virtual (modo local)
    if (voiceSpeakerLoopInterval) {
        clearInterval(voiceSpeakerLoopInterval);
        voiceSpeakerLoopInterval = null;
    }

    activeMembersInRoom = [];

    if (triggerUI) {
        const statusPanel = document.getElementById('voice-status-panel');
        const voiceRoomContainer = document.getElementById('voice-room-container');
        
        if (statusPanel) statusPanel.classList.add('hidden');
        if (voiceRoomContainer) voiceRoomContainer.classList.add('hidden');

        document.querySelectorAll('#voice-channels li').forEach(item => item.classList.remove('active'));

        const countBadge = document.getElementById(`voice-count-${prevChannel}`);
        if (countBadge) countBadge.textContent = '0';
    }

    updateRenderLatency(startTime);
}

// Iniciar Captura de Audio Real (WebRTC Simulator)
async function startAudioEngine() {
    try {
        // Forzar captura si el usuario cambió el ID del micrófono
        const hasPeers = activePeers.size > 0;
        const currentTrack = microphoneStream ? microphoneStream.getAudioTracks()[0] : null;
        const currentSettings = currentTrack ? currentTrack.getSettings() : {};
        const deviceChanged = selectedInputDeviceId !== 'default' && currentSettings.deviceId !== selectedInputDeviceId;

        if (microphoneStream && (!hasPeers || deviceChanged)) {
            microphoneStream.getTracks().forEach(track => track.stop());
            microphoneStream = null;
        } else if (microphoneStream && hasPeers && !deviceChanged) {
            // Ya tenemos un stream de mic activo con peers y el id no ha cambiado — solo reiniciar analizador
            console.log('[Audio] Reutilizando microphoneStream existente (hay peers activos).');
            resizeCanvas();
            drawVisualizer();
            startLocalVAD();
            return;
        }

        // Constraints con id de dispositivo seleccionado
        const constraints = {
            audio: {
                deviceId: selectedInputDeviceId !== 'default' ? { exact: selectedInputDeviceId } : undefined,
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        };

        // Intentar capturar micrófono real
        microphoneStream = await navigator.mediaDevices.getUserMedia(constraints);
        
        console.log('[Audio] Micrófono capturado con éxito.');

        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 128; // Pequeño tamaño para optimización extrema de CPU

        sourceNode = audioCtx.createMediaStreamSource(microphoneStream);
        
        // Crear nodo de volumen de entrada (Ganancia)
        inputVolumeNode = audioCtx.createGain();
        inputVolumeNode.gain.setValueAtTime(audioInputVolume, audioCtx.currentTime);

        // Encadenar: source -> volumen -> [filtros] -> analyser + destino procesado
        sourceNode.connect(inputVolumeNode);

        // Crear nodo destino para capturar audio procesado (el que se envía por WebRTC)
        audioDestNode    = audioCtx.createMediaStreamDestination();
        filterOutputNode = buildFilterChain(currentFilter, inputVolumeNode);
        filterOutputNode.connect(analyser);
        filterOutputNode.connect(audioDestNode);

        // El stream procesado es el que sale por WebRTC
        processedStream = audioDestNode.stream;

        // Si el usuario está muteado o ensordecido inicialmente, apagamos las pistas
        if (state.isMuted || state.isDeafened) {
            toggleMicStreamTracks(false);
        }

    } catch (err) {
        console.warn('[Audio] No se detectó micrófono físico o acceso denegado. Iniciando simulador de audio integrado.', err);
        // Fallback: Generador de señal virtual para que la UI funcione perfectamente sin fallos
        startVirtualAudioEngine();
    }

    // Iniciar animación del analizador en canvas
    resizeCanvas();
    drawVisualizer();
    // Iniciar detección de actividad de voz local (VAD)
    startLocalVAD();
}

let virtualGainNode = null;
let virtualModulatorInterval = null;

// Fallback: Iniciar audio virtual sin hardware real
function startVirtualAudioEngine() {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 128;

    // Creamos un oscilador de ruido de fondo de muy baja ganancia
    const osc = audioCtx.createOscillator();
    virtualGainNode = audioCtx.createGain();
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(140, audioCtx.currentTime); // Tono de voz bajo
    
    virtualGainNode.gain.setValueAtTime(0.001, audioCtx.currentTime); // Casi inaudible
    
    osc.connect(virtualGainNode);
    virtualGainNode.connect(analyser);
    osc.start();

    // Modular la ganancia periódicamente para simular actividad de habla local si no está silenciado
    if (virtualModulatorInterval) clearInterval(virtualModulatorInterval);
    virtualModulatorInterval = setInterval(() => {
        if (audioCtx && virtualGainNode) {
            if (!state.isMuted && state.activeVoiceChannel) {
                // Alternar entre hablar y estar callado aleatoriamente para simular habla natural
                const speaking = Math.random() > 0.5; 
                const targetGain = speaking ? 0.08 : 0.001;
                try {
                    virtualGainNode.gain.setValueAtTime(targetGain, audioCtx.currentTime);
                } catch (e) {
                    console.warn('[VAD Virtual] Error al modular ganancia:', e);
                }
            } else {
                try {
                    virtualGainNode.gain.setValueAtTime(0.001, audioCtx.currentTime);
                } catch (e) {}
            }
        }
    }, 2000);
}

function stopAudioEngine() {
    if (visualizerAnimationId) {
        cancelAnimationFrame(visualizerAnimationId);
        visualizerAnimationId = null;
    }

    // Detener el loop de VAD local
    if (localSpeakingVadId) {
        cancelAnimationFrame(localSpeakingVadId);
        localSpeakingVadId = null;
    }
    isLocalUserSpeaking = false;

    // Detener el modulador virtual
    if (virtualModulatorInterval) {
        clearInterval(virtualModulatorInterval);
        virtualModulatorInterval = null;
    }
    virtualGainNode = null;

    if (microphoneStream) {
        microphoneStream.getTracks().forEach(track => track.stop());
        microphoneStream = null;
    }

    // Limpiar filtros y stream procesado
    filterCleanupFns.forEach(fn => fn());
    filterCleanupFns = [];
    filterOutputNode = null;
    audioDestNode    = null;
    processedStream  = null;

    if (audioCtx) {
        if (audioCtx.state !== 'closed') {
            audioCtx.close();
        }
        audioCtx = null;
    }
    
    analyser = null;
    sourceNode = null;

    // Limpiar canvas
    if (canvasCtx && canvas) {
        canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
    }
}

// Comprobar si un usuario tiene rango OP (Operator)
// ─── OP hardcodeado por email ─────────────────────────────────
// Solo sniderquiros5@gmail.com tiene OP permanente.
const OP_EMAIL = 'sniderquiros5@gmail.com';

// ─── Admins con poder de silenciar a otros ────────────────────
// IMPORTANTE: definir ANTES de renderVoiceMembers (const no se eleva)
const MUTE_ADMIN_EMAILS = [
    'sniderquiros5@gmail.com',
    'abayronchavez1@gmail.com'
];
// Mapa de peers muteados localmente por el admin (peerId → true)
const locallyMutedPeers = new Map();

/** ¿El usuario actual tiene poder de silenciar a otros? */
function isCurrentUserMuteAdmin() {
    const email = (localStorage.getItem('nexus_user_email') || '').trim().toLowerCase();
    return MUTE_ADMIN_EMAILS.includes(email);
}

/**
 * Comprueba si el USUARIO LOCAL ACTUAL tiene rango OP.
 * Usa el email guardado en localStorage — la forma más fiable.
 */
export function isCurrentUserOp() {
    const email = (localStorage.getItem('nexus_user_email') || '').trim().toLowerCase();
    return email === OP_EMAIL.toLowerCase();
}

/**
 * Comprueba si un usuario (por nombre) tiene rango OP.
 * Primero intenta la comparación directa por email del usuario local,
 * luego busca en la sala de voz activa.
 */
export function isUserOp(name) {
    if (!name) return false;

    // 1. Si el nombre coincide con el usuario local → comprobar email directamente
    const sessionEmail = (localStorage.getItem('nexus_user_email') || '').trim().toLowerCase();
    if (sessionEmail === OP_EMAIL.toLowerCase()) {
        // El usuario local ES el OP — comprobar si el nombre pedido es el suyo
        const customName = sessionEmail ? localStorage.getItem('nexus_username_' + sessionEmail) : null;
        const defaultName = sessionEmail
            ? (sessionEmail.split('@')[0].charAt(0).toUpperCase() + sessionEmail.split('@')[0].slice(1))
            : '';
        const displayName = customName || defaultName;

        // Comparar ignorando mayúsculas/minúsculas y espacios extra
        if (name.trim().toLowerCase() === displayName.trim().toLowerCase()) return true;

        // También aceptar si es el nombre base del email (ej: "sniderquiros5")
        const emailBase = sessionEmail.split('@')[0].toLowerCase();
        if (name.trim().toLowerCase() === emailBase) return true;
    }

    // 2. Buscar en la sala de voz activa (Supabase Presence marca isOp remotamente)
    const member = activeMembersInRoom.find(m => m.name === name);
    if (member && member.isOp) return true;

    return false;
}

// Retorna el AnalyserNode activo del motor WebRTC (para acoplar el bot de música)
export function getVoiceAnalyser() {
    return analyser;
}

// Retorna el AudioContext activo del motor de voz para reutilizarlo en la música
export function getVoiceAudioContext() {
    return audioCtx;
}

// Conectar / desconectar al Bot de Música virtualmente en la sala
export function triggerMusicBotVoiceConnection(enabled) {
    if (!state.activeVoiceChannel) return;

    const index = activeMembersInRoom.findIndex(m => m.isMusicBot);
    if (enabled) {
        if (index === -1) {
            activeMembersInRoom.push({
                name: 'Nexus Music Bot',
                avatar: '🎵',
                avatarBg: 'bg-purple',
                isMuted: false,
                activeSpeaker: true,
                isMusicBot: true
            });
        } else {
            activeMembersInRoom[index].activeSpeaker = true;
        }
    } else {
        if (index !== -1) {
            activeMembersInRoom.splice(index, 1);
        }
    }
    renderVoiceMembers();

    // Actualizar el contador del canal de voz
    const countBadge = document.getElementById(`voice-count-${state.activeVoiceChannel}`);
    if (countBadge) countBadge.textContent = activeMembersInRoom.length;
}

// Renderizar las tarjetas de los integrantes de voz
function renderVoiceMembers() {
    const grid = document.getElementById('voice-grid');
    if (!grid) return;

    grid.innerHTML = '';

    // Avatar del usuario local (email-specific)
    const localEmail = localStorage.getItem('nexus_user_email') || '';
    const localAvatar = localEmail ? (localStorage.getItem('nexus_user_avatar_' + localEmail) || '') : '';
    const localAvatarStyle = localEmail ? (localStorage.getItem('nexus_user_avatar_style_' + localEmail) || 'circle') : 'circle';

    activeMembersInRoom.forEach(member => {
        const isUser = !!member.isLocalUser;
        
        // Si el usuario local o un integrante virtual están silenciados, no pueden estar hablando
        if (member.isMuted || (isUser && state.isMuted)) {
            member.activeSpeaker = false;
        }

        const card = document.createElement('div');
        card.className = `voice-member-card ${member.activeSpeaker ? 'speaking' : ''}`;
        card.id = `voice-member-${member.name.replace(/\s+/g, '-')}`;

        let statusIcons = '';
        if (member.isMuted || (isUser && state.isMuted)) {
            statusIcons += `
                <svg class="voice-icon-micro-muted" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="1" y1="1" x2="23" y2="23"/>
                    <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/>
                    <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/>
                    <line x1="12" y1="19" x2="12" y2="23"/>
                    <line x1="8" y1="23" x2="16" y2="23"/>
                </svg>
            `;
        }

        let speakingWave = '';
        if (member.activeSpeaker && !(member.isMuted || (isUser && state.isMuted))) {
            speakingWave = `
                <div class="speaking-wave">
                    <span></span>
                    <span></span>
                    <span></span>
                </div>
            `;
        }

        // Determinar qué avatar usar para este miembro
        let avatarHtml = '';
        if (member.isMusicBot) {
            avatarHtml = `<div class="voice-member-avatar" style="background: linear-gradient(135deg, #db2777 0%, #ec4899 100%); border-radius: 50%;">&#127925;</div>`;
        } else if (isUser && localAvatar && localAvatar.startsWith('data:image/')) {
            // Usuario local: usar avatar guardado en localStorage con clave por email
            const bRadius = localAvatarStyle === 'circle' ? '50%' : '6px';
            avatarHtml = `<div class="voice-member-avatar" style="background-image: url(${localAvatar}); background-size: cover; background-position: center; border-radius: ${bRadius};"></div>`;
        } else if (!isUser && member.avatar && member.avatar.startsWith('data:image/')) {
            // Usuario remoto: usar avatar recibido por Supabase Presence
            const bRadius = (member.avatarStyle || 'circle') === 'circle' ? '50%' : '6px';
            avatarHtml = `<div class="voice-member-avatar" style="background-image: url(${member.avatar}); background-size: cover; background-position: center; border-radius: ${bRadius};"></div>`;
        } else {
            // Fallback: inicial del nombre
            const initial = member.name ? member.name.charAt(0).toUpperCase() : '?';
            avatarHtml = `<div class="voice-member-avatar ${member.avatarBg || 'bg-blue'}">${initial}</div>`;
        }

        // Renderizar corona dorada si tiene rango OP
        const isOp = isUserOp(member.name);
        const opCrown = isOp ? '<span class="badge-op" title="Operator (OP)">&#128081;</span>' : '';

        // Botón de mute individual (solo para admin, solo para remotos con peerId)
        const isMuteAdmin = isCurrentUserMuteAdmin();
        const locallyMuted = locallyMutedPeers.get(member.peerId) || false;
        const muteBtnHtml = (isMuteAdmin && !isUser && !member.isMusicBot && member.peerId)
            ? `<button class="admin-mute-btn ${locallyMuted ? 'admin-muted' : ''}" 
                title="${locallyMuted ? 'Desmutear' : 'Silenciar'} a ${member.name}"
                onclick="(function(){
                    import('./voice.js').then(m => m.toggleRemoteMute('${member.peerId}', '${member.name.replace(/'/g, "\\'")}')).catch(()=>{});
                })()"
              >${locallyMuted ? '🔊' : '🔇'}</button>`
            : '';

        const volumeSliderHtml = (!isUser && !member.isMusicBot && member.peerId)
            ? `<div class="user-volume-row">
                <span class="user-vol-icon">🔊</span>
                <input type="range" class="user-volume-slider" min="0" max="100" value="100"
                    title="Volumen de ${member.name}" aria-label="Volumen de ${member.name}">
               </div>`
            : '';

        card.innerHTML = `
            ${speakingWave}
            ${avatarHtml}
            <span class="voice-member-name">${member.name}${opCrown}</span>
            <div class="voice-member-icons">${statusIcons}${muteBtnHtml}</div>
            ${volumeSliderHtml}
        `;

        // Añadir tarjeta al grid
        grid.appendChild(card);

        // Enlazar slider de volumen personal (solo para usuarios remotos, no para el usuario local ni el bot)
        if (!isUser && !member.isMusicBot && member.peerId) {
            const slider = card.querySelector('.user-volume-slider');
            if (slider) {
                const savedVol = perUserVolume.get(member.peerId) ?? 1.0;
                slider.value = Math.round(savedVol * 100);
                slider.addEventListener('input', (e) => {
                    e.stopPropagation();
                    const newVol = e.target.value / 100;
                    perUserVolume.set(member.peerId, newVol);
                    const peerData = activePeers.get(member.peerId);
                    if (peerData && peerData.audioEl) {
                        // Respetar mute local del admin
                        const muted = locallyMutedPeers.get(member.peerId) || false;
                        peerData.audioEl.volume = (state.isDeafened || muted) ? 0 : newVol * audioOutputVolume;
                    }
                });
            }
        }
    });

    // Botón "Silenciar todos" — solo visible para admins con peers remotos
    if (isCurrentUserMuteAdmin() && activePeers.size > 0) {
        const allMuted = [...activePeers.keys()].every(pid => locallyMutedPeers.get(pid));
        const muteAllBtn = document.createElement('button');
        muteAllBtn.id = 'voice-mute-all-btn';
        muteAllBtn.className = `voice-mute-all-btn ${allMuted ? 'muted' : ''}`;
        muteAllBtn.textContent = allMuted ? '🔊 Restaurar todos' : '🔇 Silenciar todos';
        muteAllBtn.title = allMuted ? 'Restaurar audio de todos' : 'Silenciar a todos los participantes';
        muteAllBtn.addEventListener('click', () => {
            import('./voice.js').then(m => m.muteAllRemote()).catch(() => {});
        });
        grid.appendChild(muteAllBtn);
    }
} // fin de renderVoiceMembers

// ─── FUNCIONES EXPORTADAS DE ADMIN MUTE ──────────────────────────────────────
// Llamadas desde los botones inline de las tarjetas de voz via dynamic import

/** Alterna el mute local de un peer específico (admin) */
export function toggleRemoteMute(peerId, peerName) {
    const wasMuted = locallyMutedPeers.get(peerId) || false;
    locallyMutedPeers.set(peerId, !wasMuted);
    const pd = activePeers.get(peerId);
    if (pd && pd.audioEl) {
        pd.audioEl.volume = !wasMuted ? 0 : (perUserVolume.get(peerId) ?? 1.0) * audioOutputVolume;
        pd.audioEl.muted  = !wasMuted;
    }
    // Sincronizar estado del botón OP mute-all
    syncMuteAllOpBtn();
    renderVoiceMembers();
}

/** Silencia o restaura a TODOS los peers (solo OP) */
export function muteAllRemote() {
    if (!isCurrentUserOp()) return;
    const allMuted = [...activePeers.keys()].every(pid => locallyMutedPeers.get(pid));
    activePeers.forEach((pd, pid) => {
        locallyMutedPeers.set(pid, !allMuted);
        if (pd && pd.audioEl) {
            pd.audioEl.volume = allMuted ? (perUserVolume.get(pid) ?? 1.0) * audioOutputVolume : 0;
            pd.audioEl.muted  = !allMuted;
        }
    });
    syncMuteAllOpBtn();
    renderVoiceMembers();
}

/** Actualiza el texto y clase del botón OP mute-all según estado actual */
function syncMuteAllOpBtn() {
    const btn = document.getElementById('voice-mute-all-op-btn');
    if (!btn) return;
    const allMuted = activePeers.size > 0 && [...activePeers.keys()].every(pid => locallyMutedPeers.get(pid));
    if (allMuted) {
        btn.textContent = '🔊 Restaurar';
        btn.title = 'Restaurar audio de todos';
        btn.classList.add('muted');
    } else {
        btn.textContent = '🔇';
        btn.title = 'Silenciar a todos los participantes';
        btn.classList.remove('muted');
    }
}

// Activar/desactivar pistas del micrófono físico
function toggleMicStreamTracks(enabled) {
    const shouldEnable = enabled && !state.isMuted && !state.isDeafened;
    if (microphoneStream) {
        microphoneStream.getTracks().forEach(track => {
            track.enabled = shouldEnable;
        });
    }
}

// Control Mutear Micrófono
function toggleMute() {
    state.isMuted = !state.isMuted;
    
    const muteBtn = document.getElementById('voice-mute-btn');
    if (muteBtn) {
        if (state.isMuted) {
            muteBtn.classList.add('muted');
            muteBtn.classList.remove('active-btn');
            muteBtn.title = 'Desmutear Micrófono';
            muteBtn.innerHTML = `
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
            `;
            toggleMicStreamTracks(false);
        } else {
            muteBtn.classList.remove('muted');
            muteBtn.classList.add('active-btn');
            muteBtn.title = 'Mutear Micrófono';
            muteBtn.innerHTML = `
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1c-1.66 0-3 1.34-3 3v8c0 1.66 1.34 3 3 3s3-1.34 3-3V4c0-1.66-1.34-3-3-3z"/><path d="M19 10v1a7 7 0 0 1-14 0v-1"/></svg>
            `;
            toggleMicStreamTracks(true);
        }
    }

    // Actualizar presencia en Supabase si está en modo multiplayer
    if (isMultiplayerMode && presenceChannel && localPeerId) {
        const myName = getLocalUserName();
        const email = localStorage.getItem('nexus_user_email') || '';
        const myAvatar = email ? (localStorage.getItem('nexus_user_avatar_' + email) || '') : '';
        const myAvatarStyle = email ? (localStorage.getItem('nexus_user_avatar_style_' + email) || 'circle') : 'circle';
        presenceChannel.track({
            name: myName,
            peerId: localPeerId,
            avatar: myAvatar,
            avatarStyle: myAvatarStyle,
            isMuted: state.isMuted || state.isDeafened,
            isOp: email === OP_EMAIL,
            joinedAt: Date.now()
        }).catch(() => {});
    }

    // Refrescar tarjetas de la sala de voz
    updateUserInRoomState();
}

// Control Ensordecer Audio (Oír a otros)
function toggleDeafen() {
    state.isDeafened = !state.isDeafened;
    
    const deafenBtn = document.getElementById('voice-deafen-btn');
    if (deafenBtn) {
        if (state.isDeafened) {
            deafenBtn.classList.add('muted');
            deafenBtn.classList.remove('active-btn');
            deafenBtn.title = 'Activar Sonido';
            deafenBtn.innerHTML = `
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><line x1="1" y1="1" x2="23" y2="23"/><path d="M21 12v-1a9 9 0 0 0-9-9c-1.66 0-3 .75-4.22 1.94M3 6.66a9 9 0 0 0 0 11.34M12 21a9 9 0 0 0 9-9v-1"/></svg>
            `;
        } else {
            deafenBtn.classList.remove('muted');
            deafenBtn.classList.add('active-btn');
            deafenBtn.title = 'Ensordecer Audio';
            deafenBtn.innerHTML = `
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/></svg>
            `;
        }
    }

    // Actualizar volumen general (muteará la salida de audio/música en caliente)
    applyOutputVolumeGlobal();

    // Silenciar el propio micrófono si estamos ensordecidos
    toggleMicStreamTracks(!state.isMuted && !state.isDeafened);

    // CRÍTICO: aplicar el silenciado/desilenciado inmediatamente a todos los
    // elementos <audio> de los peers WebRTC que ya están reproduciéndose
    activePeers.forEach(peerData => {
        if (peerData.audioEl) {
            peerData.audioEl.volume = state.isDeafened ? 0 : audioOutputVolume;
            peerData.audioEl.muted  = state.isDeafened;
        }
    });

    // También silenciar/desilenciar el vídeo remoto de stream compartido
    const remoteVideo = document.getElementById('local-stream-video');
    if (remoteVideo) remoteVideo.muted = state.isDeafened;

    // Actualizar presencia en Supabase si está en modo multiplayer
    if (isMultiplayerMode && presenceChannel && localPeerId) {
        const myName = getLocalUserName();
        const email = localStorage.getItem('nexus_user_email') || '';
        const myAvatar = email ? (localStorage.getItem('nexus_user_avatar_' + email) || '') : '';
        const myAvatarStyle = email ? (localStorage.getItem('nexus_user_avatar_style_' + email) || 'circle') : 'circle';
        presenceChannel.track({
            name: myName,
            peerId: localPeerId,
            avatar: myAvatar,
            avatarStyle: myAvatarStyle,
            isMuted: state.isMuted || state.isDeafened,
            isOp: email === OP_EMAIL,
            joinedAt: Date.now()
        }).catch(() => {});
    }

    // Refrescar tarjetas de la sala de voz
    updateUserInRoomState();
}

// Obtener el nombre de display del usuario autenticado
function getLocalUserName() {
    const email = localStorage.getItem('nexus_user_email') || '';
    if (!email) return 'Usuario Nexus';
    const customName = localStorage.getItem('nexus_username_' + email);
    if (customName) return customName;
    const base = email.split('@')[0];
    return base.charAt(0).toUpperCase() + base.slice(1);
}

// Actualizar los datos locales del propio usuario dentro de la sala
function updateUserInRoomState() {
    const myName = getLocalUserName();
    // Buscar si el propio usuario ya está en la lista
    const index = activeMembersInRoom.findIndex(m => m.name === myName || m.isLocalUser);
    if (state.activeVoiceChannel) {
        if (index === -1) {
            activeMembersInRoom.push({
                name: myName,
                avatar: myName.charAt(0),
                avatarBg: 'bg-blue',
                isMuted: state.isMuted,
                activeSpeaker: false,
                isLocalUser: true
            });
        } else {
            activeMembersInRoom[index].name = myName;
            activeMembersInRoom[index].avatar = myName.charAt(0);
            activeMembersInRoom[index].isMuted = state.isMuted;
        }
    }
    renderVoiceMembers();
}

// Simular el comportamiento natural de los hablantes virtuales
function startVoiceSimulatingSpeakers() {
    // Primero, asegurar que el propio usuario esté en la sala
    updateUserInRoomState();

    voiceSpeakerLoopInterval = setInterval(() => {
        if (state.isDeafened) {
            // Si el usuario se ensordece, nadie habla para él
            activeMembersInRoom.forEach(m => m.activeSpeaker = false);
            renderVoiceMembers();
            return;
        }

        activeMembersInRoom.forEach(member => {
            if (member.isLocalUser) {
                // El usuario local usa el VAD real (startLocalVAD) — saltar la simulación aleatoria
                return;
            }

            if (member.isMuted) {
                member.activeSpeaker = false;
                return;
            }

            // Probabilidad aleatoria de que empiece/siga hablando
            if (member.activeSpeaker) {
                member.activeSpeaker = Math.random() > 0.35; // 65% probabilidad de seguir hablando
            } else {
                member.activeSpeaker = Math.random() > 0.85; // 15% probabilidad de empezar a hablar
            }
        });

        renderVoiceMembers();
    }, 1000);
}

// ─────────────────────────────────────────────────────────────
// LOCAL VAD (Voice Activity Detection) EN TIEMPO REAL
// Lee el AnalyserNode del micrófono cada frame y aplica el glow
// de "hablando" directamente al card del usuario local sin esperar
// al ciclo de 1 segundo del simulador de otros participantes.
// ─────────────────────────────────────────────────────────────
const VAD_THRESHOLD = 18;      // Nivel mínimo promedio (0-255) para considerarse "hablando"
const VAD_HOLD_FRAMES = 12;    // Mantener el estado activo este nº de frames antes de apagar
let vadHoldCounter = 0;

function startLocalVAD() {
    if (localSpeakingVadId) cancelAnimationFrame(localSpeakingVadId);

    function vadLoop() {
        localSpeakingVadId = requestAnimationFrame(vadLoop);

        if (!analyser || state.isMuted || !state.activeVoiceChannel) {
            // Silenciado o fuera de canal: apagar el indicador de inmediato
            if (isLocalUserSpeaking) {
                isLocalUserSpeaking = false;
                applyLocalSpeakingGlow(false);
            }
            vadHoldCounter = 0;
            return;
        }

        const bufLen = analyser.frequencyBinCount;
        const data = new Uint8Array(bufLen);
        analyser.getByteFrequencyData(data);

        // Calcular nivel RMS simplificado (promedio de bins medios: voz humana 200Hz-3kHz)
        const midStart = Math.floor(bufLen * 0.05);
        const midEnd   = Math.floor(bufLen * 0.65);
        let sum = 0;
        for (let i = midStart; i < midEnd; i++) sum += data[i];
        const avg = sum / (midEnd - midStart);

        if (avg > VAD_THRESHOLD) {
            vadHoldCounter = VAD_HOLD_FRAMES; // Reiniciar contador de hold
            if (!isLocalUserSpeaking) {
                isLocalUserSpeaking = true;
                applyLocalSpeakingGlow(true);
                // Actualizar estado en la lista de miembros para el render del card
                const myName = getLocalUserName();
                const idx = activeMembersInRoom.findIndex(m => m.isLocalUser || m.name === myName);
                if (idx !== -1) activeMembersInRoom[idx].activeSpeaker = true;
            }
        } else if (vadHoldCounter > 0) {
            vadHoldCounter--;
        } else if (isLocalUserSpeaking) {
            isLocalUserSpeaking = false;
            applyLocalSpeakingGlow(false);
            // Actualizar estado en la lista de miembros
            const myName = getLocalUserName();
            const idx = activeMembersInRoom.findIndex(m => m.isLocalUser || m.name === myName);
            if (idx !== -1) activeMembersInRoom[idx].activeSpeaker = false;
        }
    }

    vadLoop();
}

// Aplica o quita el glow de "hablando" directamente en el DOM del card local
// (sin re-renderizar todo el grid para máxima fluidez y 0 parpadeos)
function applyLocalSpeakingGlow(speaking) {
    const myName = getLocalUserName();
    // El card id usa el nombre con guiones
    const cardId = `voice-member-${myName.replace(/\s+/g, '-')}`;
    const card = document.getElementById(cardId);
    if (!card) return;

    if (speaking) {
        card.classList.add('speaking');
        // Animar también el avatar para el feedback inmediato
        const avatar = card.querySelector('.voice-member-avatar');
        if (avatar) {
            avatar.style.boxShadow = '0 0 0 3px var(--accent-green, #22c55e), 0 0 18px var(--accent-green-glow, rgba(34,197,94,0.5))';
            avatar.style.transition = 'box-shadow 0.1s ease';
        }
        // Añadir onda de habla si no existe
        if (!card.querySelector('.speaking-wave')) {
            const wave = document.createElement('div');
            wave.className = 'speaking-wave';
            wave.innerHTML = '<span></span><span></span><span></span>';
            card.prepend(wave);
        }
    } else {
        card.classList.remove('speaking');
        const avatar = card.querySelector('.voice-member-avatar');
        if (avatar) {
            avatar.style.boxShadow = '';
        }
        // Quitar onda de habla
        const wave = card.querySelector('.speaking-wave');
        if (wave) wave.remove();
    }
}

// Loop de dibujo del analizador de frecuencia WebRTC en Canvas
function drawVisualizer() {
    if (!analyser || !canvasCtx || !canvas) return;

    visualizerAnimationId = requestAnimationFrame(drawVisualizer);

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    if (state.isMuted) {
        // Si está silenciado, dibuja una línea plana hermosa con un micro-ruido para simular paz
        for (let i = 0; i < bufferLength; i++) {
            dataArray[i] = 0;
        }
    } else {
        analyser.getByteFrequencyData(dataArray);
        
        // Inyectamos frecuencias de hablantes virtuales si están activos para que el canvas reaccione
        if (!state.isDeafened) {
            const anyoneSpeaking = activeMembersInRoom.some(m => !m.isLocalUser && m.activeSpeaker);
            if (anyoneSpeaking) {
                for (let i = 0; i < bufferLength; i++) {
                    // Genera ondas oscilantes aleatorias
                    dataArray[i] = Math.max(dataArray[i], Math.sin(Date.now() * 0.005 + i * 0.3) * 35 + 40);
                }
            }
        }
    }

    // Dibujar el canvas con diseño Cyberpunk HSL
    const width = canvas.width;
    const height = canvas.height;
    
    // Fondo semitransparente para efecto barrido
    canvasCtx.fillStyle = 'rgba(8, 9, 12, 0.25)';
    canvasCtx.fillRect(0, 0, width, height);

    const barWidth = (width / bufferLength) * 1.6;
    let barHeight;
    let x = 0;

    // Crear un gradiente de neon fluido
    const gradient = canvasCtx.createLinearGradient(0, height, width, 0);
    gradient.addColorStop(0, 'hsl(271, 91%, 65%)'); // Eléctrico Púrpura
    gradient.addColorStop(0.5, 'hsl(186, 100%, 48%)'); // Cyber Cyan
    gradient.addColorStop(1, 'hsl(271, 91%, 65%)');

    canvasCtx.beginPath();
    
    for (let i = 0; i < bufferLength; i++) {
        // Normalización del tamaño
        barHeight = (dataArray[i] / 255) * height * 0.85;

        // Si hay silencio absoluto, dibujar una pequeña onda sinoidal base ultra optimizada
        if (barHeight < 2) {
            barHeight = Math.sin(Date.now() * 0.008 + i * 0.5) * 2 + 3;
        }

        // Renderizado del visualizador estilo espectrograma de barras redondeadas
        canvasCtx.fillStyle = gradient;
        
        // Dibujamos rectángulos estilizados con bordes curvos
        const roundedHeight = Math.max(barHeight, 4);
        const yPos = height - roundedHeight - 4;
        
        canvasCtx.fillRect(x, yPos, barWidth - 2, roundedHeight);
        
        // Brillo neon en los picos más altos
        if (dataArray[i] > 140) {
            canvasCtx.shadowBlur = 12;
            canvasCtx.shadowColor = 'rgba(186, 100, 48, 0.6)';
            canvasCtx.fillStyle = '#fff';
            canvasCtx.fillRect(x, yPos, barWidth - 2, 3);
            canvasCtx.shadowBlur = 0; // reset
        }

        x += barWidth;
    }
}

// ─────────────────────────────────────────────────────────────
// BOT DE MÚSICA — MEZCLA EN STREAM WEBRTC
// ─────────────────────────────────────────────────────────────
let musicMixDestNode = null;   // MediaStreamDestination exclusivo para el bot de música
let musicMixedTrack  = null;   // AudioTrack mezclado en el processedStream

/**
 * Conecta el nodo de ganancia del sintetizador al stream WebRTC para
 * que todos los peers en la sala puedan escuchar la música.
 * @param {GainNode} synthSourceNode - El nodo de salida del sintetizador (synthGain)
 */
export function mixMusicTrackIntoStream(synthSourceNode) {
    if (!audioCtx || !processedStream) {
        console.warn('[Music Bot] No hay audioCtx o processedStream activo para mezclar música.');
        return;
    }

    // Crear destino de mezcla si no existe
    if (!musicMixDestNode) {
        musicMixDestNode = audioCtx.createMediaStreamDestination();
    }

    // Conectar synth al destino de mezcla (además del destination local para que el host también escuche)
    try { synthSourceNode.connect(musicMixDestNode); } catch(e) {}

    // Obtener la pista de audio del sintetizador
    const musicTrack = musicMixDestNode.stream.getAudioTracks()[0];
    if (!musicTrack) return;

    musicMixedTrack = musicTrack;

    // Reemplazar / añadir la pista de audio en todos los RTCPeerConnections activos
    activePeers.forEach((peerData, peerId) => {
        const pc = peerData.call?.peerConnection;
        if (!pc) return;

        const senders = pc.getSenders();
        const audioSender = senders.find(s => s.track?.kind === 'audio');

        if (audioSender) {
            // Mezclar la pista del sintetizador con el stream del mic usando un merger
            const mergerDest = audioCtx.createMediaStreamDestination();
            const micTrack = processedStream.getAudioTracks()[0];

            if (micTrack) {
                // Crear un stream temporal que combina mic + bot
                const mergedStream = new MediaStream([micTrack, musicTrack]);
                // Solo podemos enviar una pista de audio por sender; usar la del bot
                // ya que el mic ya está en el sender. Mezclaremos con un AudioContext mixer.
                const micSource = audioCtx.createMediaStreamSource(new MediaStream([micTrack]));
                const botSource = audioCtx.createMediaStreamSource(new MediaStream([musicTrack]));
                const mixGain = audioCtx.createGain();
                micSource.connect(mixGain);
                botSource.connect(mixGain);
                mixGain.connect(mergerDest);

                const finalTrack = mergerDest.stream.getAudioTracks()[0];
                if (finalTrack) {
                    audioSender.replaceTrack(finalTrack).catch(err =>
                        console.warn(`[Music Bot] No se pudo reemplazar pista en peer ${peerId}:`, err)
                    );
                }
            }
        } else {
            // Si no hay sender de audio, añadir la pista del bot
            try {
                pc.addTrack(musicTrack, musicMixDestNode.stream);
            } catch(e) {
                console.warn('[Music Bot] No se pudo añadir pista al peer:', e);
            }
        }
    });

    console.log('[Music Bot] Audio mezclado en el stream WebRTC. Todos los peers escucharán la música.');
}

/**
 * Desconecta el audio del bot de música del stream WebRTC.
 * Se llama cuando el bot para de reproducir.
 */
export function unmixMusicTrack() {
    if (!musicMixDestNode) return;

    // Restaurar la pista original del micr\u00f3fono en todos los peers
    if (processedStream) {
        const micTrack = processedStream.getAudioTracks()[0];
        if (micTrack) {
            activePeers.forEach((peerData, peerId) => {
                const pc = peerData.call?.peerConnection;
                if (!pc) return;
                const audioSender = pc.getSenders().find(s => s.track?.kind === 'audio');
                if (audioSender) {
                    audioSender.replaceTrack(micTrack).catch(() => {});
                }
            });
        }
    }

    try { musicMixDestNode.disconnect(); } catch(e) {}
    musicMixDestNode = null;
    musicMixedTrack = null;
    console.log('[Music Bot] Pista de música desconectada del stream WebRTC.');
}
