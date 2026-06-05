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
let isTestingMic = false;
let micTestAnalyser = null;
let micTestStream = null;
let micTestAnimationId = null;

export function initVoice() {
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
        await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => {});
        const devices = await navigator.mediaDevices.enumerateDevices();

        inputSelect.innerHTML = '';
        outputSelect.innerHTML = '';

        let audioInputsCount = 0;
        let audioOutputsCount = 0;

        devices.forEach(device => {
            const opt = document.createElement('option');
            opt.value = device.deviceId;
            opt.textContent = device.label || `${device.kind === 'audioinput' ? 'Micrófono' : 'Altavoz'} (${device.deviceId.slice(0, 5)})`;

            if (device.kind === 'audioinput') {
                inputSelect.appendChild(opt);
                audioInputsCount++;
            } else if (device.kind === 'audiooutput') {
                outputSelect.appendChild(opt);
                audioOutputsCount++;
            }
        });

        if (audioInputsCount === 0) {
            inputSelect.innerHTML = '<option value="default">Ningún micrófono detectado</option>';
        }
        if (audioOutputsCount === 0) {
            outputSelect.innerHTML = '<option value="default">Ningún auricular/altavoz detectado</option>';
        }

    } catch (err) {
        console.warn('[Audio Devices] Error enumerando hardware:', err);
    }
}

// Aplica el sink de salida (altavoces/auriculares) si la API setSinkId está disponible
function applyOutputDeviceSink() {
    const video = document.getElementById('local-stream-video');
    if (video && typeof video.setSinkId === 'function') {
        video.setSinkId(selectedOutputDeviceId).then(() => {
            console.log(`[Audio Config] Salida de vídeo acoplada a deviceId: ${selectedOutputDeviceId}`);
        }).catch(err => console.warn('[Audio Config] Fallo al establecer sink en reproductor:', err));
    }
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

// Lógica para encender/apagar el testador LED de micrófono
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
                    echoCancellation: true
                }
            });

            const testAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
            micTestAnalyser = testAudioCtx.createAnalyser();
            micTestAnalyser.fftSize = 32;

            const source = testAudioCtx.createMediaStreamSource(micTestStream);
            source.connect(micTestAnalyser);

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

    // 1. Crear instancia PeerJS con servidor público
    peer = new Peer(undefined, {
        host: '0.peerjs.com',
        port: 443,
        secure: true,
        debug: 1,
        config: {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:global.stun.twilio.com:3478' }
            ]
        }
    });

    peer.on('open', async (id) => {
        localPeerId = id;
        console.log(`[PeerJS] Mi Peer ID: ${id}`);

        // Agregar usuario local a la sala
        addMemberToRoom({ name: myName, isLocalUser: true, isMuted: state.isMuted, activeSpeaker: false, peerId: id });

        // 2. Registrar presencia en Supabase
        await joinSupabasePresence(channelId, myName, id);
    });

    // 3. Atender llamadas entrantes de PeerJS
    peer.on('call', async (call) => {
        const callType = call.metadata?.type || 'audio'; // 'audio' | 'camera' | 'screen'
        console.log(`[PeerJS] Llamada entrante de: ${call.peer} (tipo: ${callType})`);

        // Answer with the appropriate local stream
        if (callType === 'camera') {
            // Dynamically import camera module to avoid circular deps
            const { getCameraStream } = await import('./camera.js');
            const camStream = getCameraStream();
            call.answer(camStream || undefined);
        } else if (callType === 'screen') {
            call.answer(); // screen share: no need to send anything back
        } else {
            // Audio call
            if (microphoneStream) {
                call.answer(microphoneStream);
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
    });
}

async function joinSupabasePresence(channelId, myName, peerId) {
    if (!supabase) return;

    const roomChannel = `voice:${channelId}`;
    const userKey = `user_${peerId.replace(/[^a-zA-Z0-9]/g, '_')}`;

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
            await presenceChannel.track({
                name: myName,
                peerId: localPeerId,
                isMuted: state.isMuted,
                joinedAt: Date.now()
            });
            console.log(`[Presence] Presencia publicada en ${roomChannel}`);
        }
    });
}

function syncVoiceRoomFromPresence(presenceState, myName) {
    const realMembers = [];
    const seenPeers = new Set();
    Object.values(presenceState).forEach(presenceList => {
        // En Supabase, a veces el state guarda la misma presencia si se re-conecta rápido
        presenceList.forEach(presence => {
            if (!seenPeers.has(presence.peerId)) {
                seenPeers.add(presence.peerId);
                realMembers.push({
                    name: presence.name,
                    avatar: presence.name.charAt(0).toUpperCase(),
                    avatarBg: 'bg-blue',
                    isMuted: presence.isMuted || false,
                    activeSpeaker: false,
                    isLocalUser: presence.peerId === localPeerId,
                    peerId: presence.peerId
                });
            }
        });
    });

    activeMembersInRoom = realMembers;
    renderVoiceMembers();

    const countBadge = document.getElementById(`voice-count-${state.activeVoiceChannel}`);
    if (countBadge) countBadge.textContent = activeMembersInRoom.length;
}

function callPeer(remotePeerId, remoteName) {
    if (!peer || !microphoneStream) return;
    if (activePeers.has(remotePeerId)) return;

    console.log(`[PeerJS] Llamando a ${remoteName} (${remotePeerId})`);
    const call = peer.call(remotePeerId, microphoneStream, {
        metadata: { type: 'audio' }
    });

    call.on('stream', (remoteStream) => {
        playRemoteStream(remotePeerId, remoteStream);
    });

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
            const videoCall = peer.call(remotePeerId, streamToSend);
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
            const peerInfo = activeMembersInRoom.find(m => m.peerId === peerId);
            titleEl.textContent = `Directo de ${peerInfo ? peerInfo.name : 'Usuario Remoto'}`;
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
        localPeerId = null;

        // Desregistrar presencia
        if (presenceChannel && supabase) {
            supabase.removeChannel(presenceChannel);
            presenceChannel = null;
        }

        // Destruir instancia PeerJS
        if (peer) {
            peer.destroy();
            peer = null;
        }
        isMultiplayerMode = false;
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
        // Solo detener el stream anterior si NO hay peers activos.
        // Si hay peers conectados, reutilizamos el stream existente para no
        // romper las llamadas WebRTC activas (evita el bug de "micrófono mudo al activar cámara/stream").
        const hasPeers = activePeers.size > 0;
        if (microphoneStream && !hasPeers) {
            microphoneStream.getTracks().forEach(track => track.stop());
            microphoneStream = null;
        } else if (microphoneStream && hasPeers) {
            // Ya tenemos un stream de mic activo con peers — solo reiniciar el analizador y salir
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

        // Encadenar: source -> volumen -> analyser
        sourceNode.connect(inputVolumeNode);
        inputVolumeNode.connect(analyser);

        // Si el usuario está muteado inicialmente, apagamos las pistas
        if (state.isMuted) {
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
export function isUserOp(name) {
    const myName = getLocalUserName();
    // El usuario local es OP por defecto para facilitar pruebas
    if (name === myName) return true;

    try {
        const ops = JSON.parse(localStorage.getItem('nexus_op_list') || '[]');
        return ops.includes(name);
    } catch {
        return false;
    }
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

        // Cargar avatar personalizado si existe
        let avatarHtml = '';
        const savedAvatar = localStorage.getItem('nexus_user_avatar');
        const savedStyle = localStorage.getItem('nexus_user_avatar_style') || 'circle';
        const borderRadiusStyle = savedStyle === 'circle' ? '50%' : '6px';
        if (isUser && savedAvatar) {
            avatarHtml = `<div class="voice-member-avatar" style="background-image: url(${savedAvatar}); background-size: cover; background-position: center; border: 1px solid rgba(255,255,255,0.1); border-radius: ${borderRadiusStyle};"></div>`;
        } else if (member.isMusicBot) {
            avatarHtml = `<div class="voice-member-avatar" style="background: linear-gradient(135deg, #db2777 0%, #ec4899 100%); border-radius: 50%;">🎵</div>`;
        } else {
            avatarHtml = `<div class="voice-member-avatar ${member.avatarBg || 'bg-blue'}">${member.avatar}</div>`;
        }

        // Renderizar corona dorada si tiene rango OP
        const isOp = isUserOp(member.name);
        const opCrown = isOp ? '<span class="badge-op" title="Operator (OP)">👑</span>' : '';

        card.innerHTML = `
            ${speakingWave}
            ${avatarHtml}
            <span class="voice-member-name">${member.name}${opCrown}</span>
            <div class="voice-member-icons">${statusIcons}</div>
        `;

        grid.appendChild(card);
    });
}

// Activar/desactivar pistas del micrófono físico
function toggleMicStreamTracks(enabled) {
    if (microphoneStream) {
        microphoneStream.getTracks().forEach(track => {
            track.enabled = enabled;
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
        presenceChannel.track({ name: myName, peerId: localPeerId, isMuted: state.isMuted, joinedAt: Date.now() }).catch(() => {});
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
}

// Obtener el nombre de display del usuario autenticado
function getLocalUserName() {
    const email = localStorage.getItem('nexus_user_email') || '';
    if (!email) return 'Usuario Nexus';
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
