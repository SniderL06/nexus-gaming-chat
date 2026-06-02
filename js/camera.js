/* NEXUS CAMERA MODULE — WebRTC Webcam Capture & PiP Preview */

import { state } from './app.js';
import { peer, activePeers, isMultiplayerMode, presenceChannel } from './voice.js';

// ─── State ───────────────────────────────────────────
let cameraStream = null;        // MediaStream from getUserMedia (video)
let isCameraOn   = false;
let pipContainer = null;
let pipVideo     = null;

// ─── Init ─────────────────────────────────────────────
export function initCamera() {
    const btn = document.getElementById('camera-btn');
    if (btn) {
        btn.addEventListener('click', toggleCamera);
    }

    // Create PiP container once
    pipContainer = document.createElement('div');
    pipContainer.id = 'local-camera-pip';
    pipContainer.innerHTML = `
        <video id="local-camera-video" autoplay playsinline muted></video>
        <div class="pip-label">📷 Tú</div>
    `;
    document.body.appendChild(pipContainer);
    pipVideo = pipContainer.querySelector('video');

    // Make PiP draggable
    makeDraggable(pipContainer);
}

// ─── Toggle ──────────────────────────────────────────
export async function toggleCamera() {
    if (isCameraOn) {
        stopCamera();
    } else {
        await startCamera();
    }
}

// ─── Start ───────────────────────────────────────────
async function startCamera() {
    if (!state.activeVoiceChannel) {
        showToast('⚠️ Únete a un canal de voz primero para activar la cámara.');
        return;
    }

    try {
        cameraStream = await navigator.mediaDevices.getUserMedia({
            video: {
                width:  { ideal: 1280 },
                height: { ideal: 720 },
                facingMode: 'user'
            },
            audio: false   // audio already handled by voice.js
        });

        isCameraOn = true;

        // Show PiP preview
        if (pipVideo) {
            pipVideo.srcObject = cameraStream;
        }
        pipContainer.classList.add('active');

        // Update button
        const btn = document.getElementById('camera-btn');
        if (btn) {
            btn.classList.add('camera-active');
            btn.title = 'Desactivar Cámara';
            btn.querySelector('span').textContent = 'Cámara ON';
        }

        // Show local user's own card with the camera stream
        attachLocalCameraToCard();

        // Send to all peers in room
        if (isMultiplayerMode && peer && activePeers.size > 0) {
            activePeers.forEach(({ name }, remotePeerId) => {
                try {
                    const videoCall = peer.call(remotePeerId, cameraStream, {
                        metadata: { type: 'camera' }
                    });
                    const peerObj = activePeers.get(remotePeerId);
                    if (peerObj) peerObj.cameraCall = videoCall;
                    console.log(`[Camera] Enviando cámara a ${name}`);
                } catch (e) {
                    console.warn('[Camera] Error llamando con cámara a peer:', e);
                }
            });
        }

        // Broadcast presence update
        broadcastCameraState(true);

        // Handle user stopping camera via browser's native controls
        cameraStream.getVideoTracks()[0].addEventListener('ended', () => {
            stopCamera();
        });

        console.log('[Camera] Cámara activada.');
    } catch (err) {
        console.warn('[Camera] Acceso a cámara denegado o error:', err);
        showToast('❌ No se pudo acceder a la cámara. Comprueba los permisos del navegador.');
    }
}

// ─── Stop ────────────────────────────────────────────
export function stopCamera() {
    if (!isCameraOn) return;

    isCameraOn = false;

    // Stop all tracks
    if (cameraStream) {
        cameraStream.getTracks().forEach(t => t.stop());
        cameraStream = null;
    }

    // Hide PiP
    if (pipVideo) pipVideo.srcObject = null;
    if (pipContainer) pipContainer.classList.remove('active');

    // Update button
    const btn = document.getElementById('camera-btn');
    if (btn) {
        btn.classList.remove('camera-active');
        btn.title = 'Activar / Desactivar Cámara';
        btn.querySelector('span').textContent = 'Cámara';
    }

    // Detach from local card
    detachLocalCameraFromCard();

    // Close peer camera calls
    if (isMultiplayerMode) {
        activePeers.forEach((peerObj) => {
            if (peerObj.cameraCall) {
                peerObj.cameraCall.close();
                delete peerObj.cameraCall;
            }
        });
    }

    broadcastCameraState(false);
    console.log('[Camera] Cámara desactivada.');
}

// ─── Attach camera video to local user's voice card ──
function attachLocalCameraToCard() {
    const myEmail = localStorage.getItem('nexus_user_email') || '';
    let myName = 'Usuario Nexus';
    if (myEmail) {
        const base = myEmail.split('@')[0];
        myName = base.charAt(0).toUpperCase() + base.slice(1);
    }
    const cardId = `voice-member-${myName.replace(/\s+/g, '-')}`;
    const card = document.getElementById(cardId);
    if (!card || !cameraStream) return;

    card.classList.add('has-camera');

    let videoEl = card.querySelector('.voice-member-video');
    if (!videoEl) {
        videoEl = document.createElement('video');
        videoEl.className = 'voice-member-video';
        videoEl.autoplay = true;
        videoEl.playsInline = true;
        videoEl.muted = true;
        videoEl.style.transform = 'scaleX(-1)'; // mirror self-view
        card.insertBefore(videoEl, card.firstChild);
    }
    videoEl.srcObject = cameraStream;
    videoEl.classList.add('active');

    // Badge
    if (!card.querySelector('.voice-camera-badge')) {
        const badge = document.createElement('span');
        badge.className = 'voice-camera-badge';
        badge.textContent = '📷';
        card.appendChild(badge);
    }
}

function detachLocalCameraFromCard() {
    const myEmail = localStorage.getItem('nexus_user_email') || '';
    let myName = 'Usuario Nexus';
    if (myEmail) {
        const base = myEmail.split('@')[0];
        myName = base.charAt(0).toUpperCase() + base.slice(1);
    }
    const cardId = `voice-member-${myName.replace(/\s+/g, '-')}`;
    const card = document.getElementById(cardId);
    if (!card) return;

    card.classList.remove('has-camera');
    const videoEl = card.querySelector('.voice-member-video');
    if (videoEl) {
        videoEl.srcObject = null;
        videoEl.classList.remove('active');
    }
    const badge = card.querySelector('.voice-camera-badge');
    if (badge) badge.remove();
}

// ─── Attach a remote camera stream to a peer's card ──
export function attachRemoteCameraToCard(peerId, stream, remoteName) {
    const cardId = `voice-member-${remoteName.replace(/\s+/g, '-')}`;
    const card = document.getElementById(cardId);
    if (!card) {
        console.warn(`[Camera] Tarjeta no encontrada para ${remoteName}, reintentando en 500ms...`);
        setTimeout(() => attachRemoteCameraToCard(peerId, stream, remoteName), 500);
        return;
    }

    card.classList.add('has-camera');

    let videoEl = card.querySelector('.voice-member-video');
    if (!videoEl) {
        videoEl = document.createElement('video');
        videoEl.className = 'voice-member-video';
        videoEl.autoplay = true;
        videoEl.playsInline = true;
        videoEl.muted = false;
        card.insertBefore(videoEl, card.firstChild);
    }
    videoEl.srcObject = stream;
    videoEl.classList.add('active');

    if (!card.querySelector('.voice-camera-badge')) {
        const badge = document.createElement('span');
        badge.className = 'voice-camera-badge';
        badge.textContent = '📷';
        card.appendChild(badge);
    }

    // Clean up when the remote track ends
    stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        detachRemoteCameraFromCard(remoteName);
    });
}

export function detachRemoteCameraFromCard(remoteName) {
    const cardId = `voice-member-${remoteName.replace(/\s+/g, '-')}`;
    const card = document.getElementById(cardId);
    if (!card) return;
    card.classList.remove('has-camera');
    const videoEl = card.querySelector('.voice-member-video');
    if (videoEl) { videoEl.srcObject = null; videoEl.classList.remove('active'); }
    const badge = card.querySelector('.voice-camera-badge');
    if (badge) badge.remove();
}

// ─── Helpers ─────────────────────────────────────────
function broadcastCameraState(on) {
    if (!presenceChannel || !peer) return;
    const myEmail = localStorage.getItem('nexus_user_email') || '';
    let myName = 'Usuario Nexus';
    if (myEmail) {
        const base = myEmail.split('@')[0];
        myName = base.charAt(0).toUpperCase() + base.slice(1);
    }
    presenceChannel.track({
        name: myName,
        peerId: peer.id,
        isCameraOn: on
    }).catch(() => {});
}

function showToast(msg) {
    // Reuse the app's toast if available, otherwise fallback
    if (typeof window.showNexusToast === 'function') {
        window.showNexusToast(msg);
        return;
    }
    const el = document.createElement('div');
    el.textContent = msg;
    el.style.cssText = `
        position:fixed;bottom:80px;left:50%;transform:translateX(-50%);
        background:rgba(30,30,46,0.96);color:#fff;padding:10px 18px;
        border-radius:8px;font-size:0.85rem;z-index:99999;
        box-shadow:0 4px 20px rgba(0,0,0,0.5);pointer-events:none;
        animation:pipAppear 0.25s ease;
    `;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3500);
}

function makeDraggable(el) {
    let isDragging = false, startX = 0, startY = 0, origLeft = 0, origBottom = 0;

    el.addEventListener('mousedown', (e) => {
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        const rect = el.getBoundingClientRect();
        origLeft   = rect.left;
        origBottom = window.innerHeight - rect.bottom;
        el.style.cursor = 'grabbing';
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        el.style.left   = `${origLeft + dx}px`;
        el.style.bottom = `${origBottom - dy}px`;
        el.style.right  = 'auto';
    });

    document.addEventListener('mouseup', () => {
        isDragging = false;
        el.style.cursor = 'grab';
    });
}

// ─── Getters ─────────────────────────────────────────
export function getCameraStream() { return cameraStream; }
export function isCameraActive()  { return isCameraOn; }
