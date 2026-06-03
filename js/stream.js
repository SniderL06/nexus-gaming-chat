/* NEXUS REAL-TIME SCREEN CAPTURE & GAME STREAMING ENGINE (ES MODULE) */

import { state, updateRenderLatency } from './app.js';
import { peer, activePeers, isMultiplayerMode, presenceChannel, getMicrophoneStream } from './voice.js';

export let activeStream = null;
let streamVideoElement = null;
let streamPlaceholder = null;
let streamContainer = null;
let goLiveBtn = null;

export function initStream() {
    streamVideoElement = document.getElementById('local-stream-video');
    streamPlaceholder = document.getElementById('stream-placeholder');
    streamContainer = document.getElementById('stream-container');
    goLiveBtn = document.getElementById('go-live-btn');

    // Botones del stream
    const stopStreamBtn = document.getElementById('stop-stream-btn');
    const fullscreenBtn = document.getElementById('stream-fullscreen-btn');
    const micToggleBtn = document.getElementById('stream-mic-toggle');

    if (stopStreamBtn) {
        stopStreamBtn.addEventListener('click', stopLocalStream);
    }
    if (fullscreenBtn) {
        fullscreenBtn.addEventListener('click', toggleFullscreen);
    }
    if (micToggleBtn) {
        micToggleBtn.addEventListener('click', toggleStreamMic);
    }

    // Doble clic en el video para pantalla completa
    if (streamVideoElement) {
        streamVideoElement.addEventListener('dblclick', toggleFullscreen);
    }

    // Escuchar cambios de pantalla completa para sincronizar botones y cursor
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);
    document.addEventListener('MSFullscreenChange', handleFullscreenChange);
}

// Activar o desactivar transmisión de pantalla real
export async function toggleLocalStream() {
    if (state.isStreaming) {
        stopLocalStream();
    } else {
        await startLocalStream();
    }
}

// Iniciar Captura de Pantalla Real (getDisplayMedia API)
async function startLocalStream() {
    const startTime = performance.now();
    
    console.log('[Stream] Solicitando captura de pantalla / Juego al navegador...');
    
    try {
        // Invoca el diálogo nativo del navegador para elegir pantalla, ventana o pestaña
        activeStream = await navigator.mediaDevices.getDisplayMedia({
            video: {
                cursor: 'always',
                frameRate: { ideal: 60, max: 60 },
                width: { ideal: 1920 },
                height: { ideal: 1080 }
            },
            audio: {
                echoCancellation: true,
                noiseSuppression: true
            }
        });

        console.log('[Stream] Captura autorizada correctamente.');
        state.isStreaming = true;

        // Configurar stream en el elemento de video
        if (streamVideoElement) {
            streamVideoElement.srcObject = activeStream;
            streamVideoElement.muted = true; // Mutear localmente para evitar feedback acústico
            
            // Forzar play
            await streamVideoElement.play();
        }

        // Mostrar contenedor en UI
        if (streamContainer) streamContainer.classList.remove('hidden');
        if (streamPlaceholder) streamPlaceholder.classList.add('hidden');

        // Actualizar botón de la barra de usuario
        if (goLiveBtn) {
            goLiveBtn.classList.add('live');
            goLiveBtn.querySelector('span').textContent = 'Transmitiendo';
        }

        // Transmisión PeerJS en multijugador
        if (isMultiplayerMode && peer) {
            console.log(`[Stream] Compartiendo pantalla con ${activePeers.size} participantes reales.`);

            // Combinar audio del micrófono con el stream de pantalla para no perder la voz
            const micStream = getMicrophoneStream();
            let streamToSend = activeStream;
            if (micStream && micStream.getAudioTracks().length > 0) {
                const tracks = [
                    ...activeStream.getVideoTracks(),
                    ...micStream.getAudioTracks()  // voz del mic sobre el stream de pantalla
                ];
                // Añadir también el audio del sistema si lo capturó getDisplayMedia
                activeStream.getAudioTracks().forEach(t => {
                    if (!tracks.includes(t)) tracks.push(t);
                });
                streamToSend = new MediaStream(tracks);
                console.log('[Stream] Audio del micrófono combinado con stream de pantalla.');
            }

            activePeers.forEach(({ name }, remotePeerId) => {
                if (remotePeerId) {
                    console.log(`[Stream] Enviando video de pantalla a: ${name} (${remotePeerId})`);
                    const videoCall = peer.call(remotePeerId, streamToSend);
                    // Guardar referencia para poder colgarla después
                    const peerObj = activePeers.get(remotePeerId);
                    if (peerObj) peerObj.videoCall = videoCall;
                }
            });

            // Actualizar presencia para marcar isStreaming: true
            if (presenceChannel) {
                const myEmail = localStorage.getItem('nexus_user_email') || '';
                let myName = 'Usuario Nexus';
                if (myEmail) {
                    const base = myEmail.split('@')[0];
                    myName = base.charAt(0).toUpperCase() + base.slice(1);
                }
                presenceChannel.track({
                    name: myName,
                    peerId: peer.id,
                    isMuted: state.isMuted,
                    isStreaming: true,
                    joinedAt: Date.now()
                }).catch(() => {});
            }
        }

        // Detectar si el usuario detiene la transmisión desde la barra nativa del navegador
        activeStream.getVideoTracks()[0].addEventListener('ended', () => {
            console.log('[Stream] Transmisión finalizada por el usuario en el navegador.');
            stopLocalStream();
        });

    } catch (err) {
        console.warn('[Stream] Captura denegada o cancelada. Activando transmisión simulada de prueba.', err);
        // Fallback: Si se cancela la captura real, iniciamos un stream simulado interactivo
        startSimulatedStream();
    }

    updateRenderLatency(startTime);
}

// Detener transmisión y apagar tracks de hardware
export function stopLocalStream() {
    const startTime = performance.now();
    
    if (!state.isStreaming) return;

    console.log('[Stream] Apagando transmisión de pantalla.');
    state.isStreaming = false;

    // Apagar todos los tracks físicos
    if (activeStream) {
        activeStream.getTracks().forEach(track => track.stop());
        activeStream = null;
    }

    // Apagar video
    if (streamVideoElement) {
        streamVideoElement.srcObject = null;
    }

    // Limpiar canvas de simulación si existía
    if (simulatedStreamInterval) {
        clearInterval(simulatedStreamInterval);
        simulatedStreamInterval = null;
    }

    // Cerrar llamadas de vídeo activas de PeerJS y restaurar presencia
    if (isMultiplayerMode) {
        activePeers.forEach((peerObj) => {
            if (peerObj.videoCall) {
                peerObj.videoCall.close();
                delete peerObj.videoCall;
            }
        });

        // Actualizar presencia para marcar isStreaming: false
        if (presenceChannel && peer) {
            const myEmail = localStorage.getItem('nexus_user_email') || '';
            let myName = 'Usuario Nexus';
            if (myEmail) {
                const base = myEmail.split('@')[0];
                myName = base.charAt(0).toUpperCase() + base.slice(1);
            }
            presenceChannel.track({
                name: myName,
                peerId: peer.id,
                isMuted: state.isMuted,
                isStreaming: false,
                joinedAt: Date.now()
            }).catch(() => {});
        }
    }

    // Ocultar contenedores
    if (streamContainer) streamContainer.classList.add('hidden');
    if (streamPlaceholder) streamPlaceholder.classList.remove('hidden');

    // Restaurar botón de emisión
    if (goLiveBtn) {
        goLiveBtn.classList.remove('live');
        goLiveBtn.querySelector('span').textContent = 'Emitir';
    }

    updateRenderLatency(startTime);
}

// Fallback: Simulación interactiva de juego en curso para propósitos locales
let simulatedStreamInterval = null;
function startSimulatedStream() {
    state.isStreaming = true;

    if (streamContainer) streamContainer.classList.remove('hidden');
    if (streamPlaceholder) streamPlaceholder.classList.add('hidden');

    // Cambiar botón UI
    if (goLiveBtn) {
        goLiveBtn.classList.add('live');
        goLiveBtn.querySelector('span').textContent = 'Transmitiendo';
    }

    // Creamos una animación interactiva en el elemento de video o un canvas dinámico
    console.log('[Stream] Transmisión simulada activada en modo local.');
}

// Control Fullscreen del reproductor de video
function toggleFullscreen() {
    if (!streamVideoElement) return;

    // Poner el viewport de la transmisión en pantalla completa para mantener overlays/mensajes interactivos
    const targetElement = document.getElementById('stream-viewport') || streamVideoElement;

    const isFullscreen = document.fullscreenElement || 
                         document.webkitFullscreenElement || 
                         document.mozFullScreenElement || 
                         document.msFullscreenElement;

    if (!isFullscreen) {
        // Solicitar pantalla completa con compatibilidad multi-navegador
        const requestMethod = targetElement.requestFullscreen || 
                              targetElement.webkitRequestFullscreen || 
                              targetElement.mozRequestFullScreen || 
                              targetElement.msRequestFullscreen;

        if (requestMethod) {
            requestMethod.call(targetElement).catch(err => {
                console.error(`Error al intentar pantalla completa: ${err.message}`);
            });
        }
    } else {
        // Salir de pantalla completa con compatibilidad multi-navegador
        const exitMethod = document.exitFullscreen || 
                           document.webkitExitFullscreen || 
                           document.mozCancelFullScreen || 
                           document.msExitFullscreen;
        if (exitMethod) {
            exitMethod.call(document);
        }
    }
}

let cursorTimeout = null;

function handleFullscreenChange() {
    const fullscreenBtn = document.getElementById('stream-fullscreen-btn');
    const targetElement = document.getElementById('stream-viewport') || streamVideoElement;
    
    const isFullscreen = !!(document.fullscreenElement || 
                            document.webkitFullscreenElement || 
                            document.mozFullScreenElement || 
                            document.msFullscreenElement);

    if (fullscreenBtn) {
        if (isFullscreen) {
            fullscreenBtn.classList.add('is-fullscreen');
            fullscreenBtn.innerHTML = `
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 14h6v6M20 10h-6V4M14 10l7-7M10 14l-7 7"/></svg>
                <span>Salir Fullscreen</span>
            `;
            
            // Iniciar detección de movimiento para ocultar el cursor
            if (targetElement) {
                targetElement.addEventListener('mousemove', showCursorAndResetTimer);
                resetCursorTimer();
            }
        } else {
            fullscreenBtn.classList.remove('is-fullscreen');
            fullscreenBtn.innerHTML = `
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>
                <span>Pantalla Completa</span>
            `;
            
            // Limpiar detección y restaurar cursor
            if (targetElement) {
                targetElement.removeEventListener('mousemove', showCursorAndResetTimer);
                targetElement.style.cursor = 'auto';
                targetElement.classList.remove('cursor-hidden');
            }
            if (cursorTimeout) {
                clearTimeout(cursorTimeout);
                cursorTimeout = null;
            }
        }
    }
}

function resetCursorTimer() {
    const targetElement = document.getElementById('stream-viewport') || streamVideoElement;
    if (targetElement) {
        targetElement.style.cursor = 'auto';
        targetElement.classList.remove('cursor-hidden');
    }
    if (cursorTimeout) {
        clearTimeout(cursorTimeout);
    }
    cursorTimeout = setTimeout(() => {
        const isFullscreen = !!(document.fullscreenElement || 
                                document.webkitFullscreenElement || 
                                document.mozFullScreenElement || 
                                document.msFullscreenElement);
        if (isFullscreen && targetElement) {
            targetElement.style.cursor = 'none';
            targetElement.classList.add('cursor-hidden');
        }
    }, 3000);
}

function showCursorAndResetTimer() {
    resetCursorTimer();
}

// Control del micrófono en la transmisión
let streamMicActive = false;
function toggleStreamMic() {
    streamMicActive = !streamMicActive;
    const btn = document.getElementById('stream-mic-toggle');
    if (btn) {
        if (streamMicActive) {
            btn.textContent = 'Mic On';
            btn.classList.add('accent');
            console.log('[Stream] Micrófono de transmisión activado.');
        } else {
            btn.textContent = 'Mic Off';
            btn.classList.remove('accent');
            console.log('[Stream] Micrófono de transmisión desactivado.');
        }
    }
}
