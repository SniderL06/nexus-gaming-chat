/* NEXUS RETRO AUDIO SYNTH & MUSIC BOT MODULE (ES MODULE) */

import { state } from './app.js';
import { getVoiceAnalyser, triggerMusicBotVoiceConnection, getOutputVolume, getVoiceAudioContext } from './voice.js';

// Lista de pistas sintetizables disponibles
export const PRESETS = [
    {
        id: 'synthwave',
        title: 'Neon Gaming Beats (Synthwave Retro)',
        duration: 120, // 2 minutos
        tempo: 135,
        // Secuencia de notas del arpegiador (frecuencias en Hz)
        bassArp: [110, 110, 165, 165, 220, 220, 165, 165, 146.83, 146.83, 220, 220, 293.66, 293.66, 220, 220],
        melody: [440, 0, 493.88, 523.25, 0, 587.33, 0, 659.25, 587.33, 0, 523.25, 0, 493.88, 0, 440, 0]
    },
    {
        id: 'lofi',
        title: 'Chill Lofi Sine (Ambient Relax)',
        duration: 180, // 3 minutos
        tempo: 80,
        // Acordes suaves lofi (Frecuencias de raíz)
        chords: [
            [130.81, 164.81, 196.00, 261.63], // Cmaj7
            [146.83, 174.61, 220.00, 293.66], // Dm7
            [164.81, 196.00, 246.94, 329.63], // Em7
            [174.61, 220.00, 261.63, 349.23]  // Fmaj7
        ],
        melody: [523.25, 587.33, 659.25, 783.99, 880.00, 987.77, 1046.50, 0]
    },
    {
        id: 'rickroll',
        title: 'Retro Rick Roll (Astley Cyberpunk Edition) 👑',
        duration: 140, // 2:20 minutos
        tempo: 120,
        melody: [
            392, 440, 523, 440, 659, 659, 587, 0, // Never gonna give you up
            392, 440, 523, 440, 587, 587, 523, 494, 440, 0, // Never gonna let you down
            392, 440, 523, 440, 523, 587, 494, 440, 392, 0, // Never gonna run around...
            392, 440, 523, 440, 587, 523, 440, 392 // and desert you!
        ]
    }
];

// Estado del Bot de Música
export const musicState = {
    isPlaying: false,
    currentTrack: null,
    queue: [],
    currentTime: 0,
    activeSongIndex: -1
};

// Nodos de Audio
let audioCtx = null;
let synthGain = null;
let schedulerInterval = null;
let timeProgressInterval = null;
let currentStep = 0;

// Variables de YouTube
let ytPlayer = null;
let ytPlayerReady = false;

export function initMusic() {
    // Vincular controles del reproductor en UI
    const playBtn = document.getElementById('music-play-btn');
    const skipBtn = document.getElementById('music-skip-btn');
    const stopBtn = document.getElementById('music-stop-btn');

    if (playBtn) {
        playBtn.addEventListener('click', togglePlayback);
    }
    if (skipBtn) {
        skipBtn.addEventListener('click', skipTrack);
    }
    if (stopBtn) {
        stopBtn.addEventListener('click', stopMusic);
    }

    // Cargar la API de Iframe de YouTube de forma asíncrona
    if (!window.YT) {
        const tag = document.createElement('script');
        tag.src = "https://www.youtube.com/iframe_api";
        const firstScriptTag = document.getElementsByTagName('script')[0];
        firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);

        window.onYouTubeIframeAPIReady = () => {
            initializeYoutubePlayer();
        };
    } else {
        initializeYoutubePlayer();
    }
}

function initializeYoutubePlayer() {
    // El contenedor ya debe existir en el DOM (añadido en index.html)
    try {
        ytPlayer = new window.YT.Player('youtube-player-container', {
            height: '1',
            width: '1',
            videoId: '',
            playerVars: {
                'autoplay': 0,
                'controls': 0,
                'disablekb': 1,
                'fs': 0,
                'rel': 0,
                'showinfo': 0
            },
            events: {
                'onReady': (event) => {
                    ytPlayerReady = true;
                    const globalOutVol = getOutputVolume();
                    ytPlayer.setVolume(globalOutVol * 100);
                },
                'onStateChange': (event) => {
                    // Si el video termina (ENDED === 0)
                    if (event.data === 0) {
                        skipTrack();
                    }
                }
            }
        });
    } catch (e) {
        console.warn('[Music Bot] Error al instanciar YT Player:', e);
    }
}

// Ejecuta comando /play desde el chat
export function playMusicCommand(query) {
    // Si no hay canal de voz activo, intentar auto-unirse al primero disponible
    if (!state.activeVoiceChannel) {
        // Buscar el primer canal de voz disponible en el DOM y unirse automáticamente
        const firstVoiceChannel = document.querySelector('.channel-item[data-type="voice"]');
        if (firstVoiceChannel) {
            firstVoiceChannel.click(); // Activa la lógica de unión del canal
            // Dar un pequeño delay para que el estado se actualice
            setTimeout(() => playMusicCommand(query), 300);
            return { success: false, msg: 'Uniéndose al canal de voz automáticamente...' };
        } else {
            alert('¡Crea o únete a un canal de voz primero para usar el Bot de Música!');
            return { success: false, msg: 'No hay canales de voz disponibles.' };
        }
    }

    let selectedPreset = PRESETS[0]; // Por defecto, synthwave
    const lowerQuery = query.toLowerCase().trim();
    const isUrl = lowerQuery.startsWith('http://') || lowerQuery.startsWith('https://');

    if (isUrl) {
        // Siempre que sea un enlace, crear un preset clonado con título descriptivo
        let basePreset;
        // Rick Roll URL especial
        if (lowerQuery.includes('dqw4w9wgxcq')) {
            basePreset = PRESETS[2];
        } else {
            basePreset = PRESETS[Math.floor(Math.random() * PRESETS.length)];
        }
        selectedPreset = { ...basePreset };

        let urlTitle = '🔗 Enlace de Audio';
        try {
            const urlObj = new URL(query.trim());
            if (urlObj.hostname.includes('youtube.com') || urlObj.hostname.includes('youtu.be')) {
                // youtube.com/watch?v=VIDEO_ID&list=... → tomar sólo el parámetro v
                let videoId = urlObj.searchParams.get('v');
                // youtu.be/VIDEO_ID → tomar sólo el primer segmento del pathname
                if (!videoId) {
                    videoId = urlObj.pathname.replace(/^\//, '').split('?')[0].split('/')[0];
                }
                if (videoId && videoId.length > 0) {
                    urlTitle = `▶ YouTube • ${videoId}`;
                    selectedPreset.youtubeId = videoId;
                    selectedPreset.duration = 180; // duración por defecto (se actualizará dinámicamente)
                } else {
                    urlTitle = `▶ YouTube Stream`;
                }
            } else if (urlObj.hostname.includes('soundcloud.com')) {
                const parts = urlObj.pathname.split('/').filter(Boolean);
                urlTitle = `🎵 SoundCloud • ${parts.slice(0, 2).join(' / ')}`;
            } else if (urlObj.hostname.includes('spotify.com')) {
                urlTitle = `🎧 Spotify Link (Synth Remix)`;
            } else {
                urlTitle = `🔗 ${urlObj.hostname} Stream`;
            }
        } catch {
            urlTitle = '🔗 Enlace de Audio Externo';
        }
        selectedPreset.title = urlTitle;
    } else if (lowerQuery.includes('lofi') || lowerQuery.includes('chill') || lowerQuery.includes('relax') || lowerQuery.includes('ambient') || lowerQuery.includes('sleep')) {
        selectedPreset = PRESETS[1]; // Lofi Preset
    } else if (lowerQuery.includes('rick') || lowerQuery.includes('astley') || lowerQuery.includes('never') || lowerQuery.includes('roll')) {
        selectedPreset = PRESETS[2]; // Rick Roll
    } else if (lowerQuery.includes('synth') || lowerQuery.includes('beats') || lowerQuery.includes('neon') || lowerQuery.includes('cyber') || lowerQuery.includes('gaming')) {
        selectedPreset = PRESETS[0]; // Synthwave
    } else {
        // Búsqueda de texto general: elegir preset con búsqueda parcial, o aleatorio
        selectedPreset = PRESETS[Math.floor(Math.random() * PRESETS.length)];
        selectedPreset = { ...selectedPreset, title: `🔍 "${query.slice(0, 30)}" → ${selectedPreset.title}` };
    }

    // Agregar a la cola
    musicState.queue.push(selectedPreset);
    console.log(`[Music Bot] Encolada: ${selectedPreset.title}`);

    // Conectar bot visualmente en la sala de voz
    triggerMusicBotVoiceConnection(true);

    // Mostrar widget de música en UI
    const widget = document.getElementById('music-player-widget');
    if (widget) widget.classList.remove('hidden');

    if (!musicState.isPlaying) {
        musicState.activeSongIndex = musicState.queue.length - 1;
        startTrack(selectedPreset);
    }

    return {
        success: true,
        title: selectedPreset.title,
        presetId: selectedPreset.id,
        isFirst: musicState.queue.length === 1
    };
}

// Inicia la reproducción física de un preset
function startTrack(preset) {
    stopSynthesizer();
    
    // Asegurar que detenemos el reproductor de YouTube si está activo
    if (ytPlayer && ytPlayerReady) {
        try {
            ytPlayer.stopVideo();
        } catch (e) {}
    }

    musicState.currentTrack = preset;
    musicState.isPlaying = true;
    musicState.currentTime = 0;
    currentStep = 0;

    // Inicializar AudioContext si no existe, intentando usar el compartido de la voz
    const sharedCtx = getVoiceAudioContext();
    if (sharedCtx) {
        audioCtx = sharedCtx;
    } else if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }

    // Nodo de ganancia master del sintetizador
    synthGain = audioCtx.createGain();
    const globalOutVol = getOutputVolume(); // Escala dinámica de salida (0.0 a 1.0)
    
    // Conectar directamente al analizador de voz de voice.js para que el visualizador canvas baile
    const voiceAnalyser = getVoiceAnalyser();
    if (voiceAnalyser) {
        synthGain.connect(voiceAnalyser);
        console.log('[Music Bot] Audio sintetizado acoplado físicamente al analizador espectral WebRTC.');
    }

    if (preset.youtubeId) {
        // En pista de YouTube silenciamos el sintetizador (para que no suene beeps encima), pero lo mantenemos conectado al visualizador
        synthGain.gain.setValueAtTime(0.001, audioCtx.currentTime);
        
        if (ytPlayer && ytPlayerReady) {
            try {
                ytPlayer.loadVideoById(preset.youtubeId);
                ytPlayer.setVolume(globalOutVol * 100);
                ytPlayer.playVideo();
                
                // Consultar metadatos y duración una vez que empiece a cargar el video
                setTimeout(() => {
                    if (ytPlayer && typeof ytPlayer.getVideoData === 'function') {
                        const videoData = ytPlayer.getVideoData();
                        if (videoData && videoData.title) {
                            preset.title = `▶ ${videoData.title}`;
                            const titleEl = document.getElementById('music-track-title');
                            if (titleEl) titleEl.textContent = preset.title;
                        }
                        const dur = ytPlayer.getDuration();
                        if (dur && dur > 0) {
                            preset.duration = Math.floor(dur);
                        }
                    }
                }, 1200);
            } catch (e) {
                console.warn('[Music Bot] Fallo al cargar video de YouTube:', e);
                // Fallback: usar sintetizador sonoro si falla la API
                synthGain.connect(audioCtx.destination);
                synthGain.gain.setValueAtTime(0.08 * globalOutVol, audioCtx.currentTime);
            }
        } else {
            console.warn('[Music Bot] YT Player no listo, reproduciendo cover sintetizado.');
            synthGain.connect(audioCtx.destination);
            synthGain.gain.setValueAtTime(0.08 * globalOutVol, audioCtx.currentTime);
        }
    } else {
        // Conectar al destino físico (altavoces) para presets incorporados
        synthGain.connect(audioCtx.destination);
        synthGain.gain.setValueAtTime(0.08 * globalOutVol, audioCtx.currentTime);
    }

    // Iniciar secuenciador del sintetizador (siempre corre para alimentar al visualizador)
    const intervalMs = (60 / preset.tempo) * 1000 / 2; // Corcheas
    schedulerInterval = setInterval(() => {
        playSynthStep(preset);
    }, intervalMs);

    // Iniciar temporizador de la barra de progreso
    if (timeProgressInterval) clearInterval(timeProgressInterval);
    timeProgressInterval = setInterval(updateProgressBar, 1000);

    // Actualizar UI
    updateWidgetUI();
}

// Secuenciador Físico: reproduce una nota/acorde en cada paso
function playSynthStep(preset) {
    if (!audioCtx || !synthGain || !musicState.isPlaying) return;

    const time = audioCtx.currentTime;

    if (preset.id === 'synthwave') {
        // --- SECUENCIADOR RETRO SYNTHWAVE ---
        // 1. Sintetizar bajo Arpegiador (Onda de Diente de Sierra robusta)
        const bassFreq = preset.bassArp[currentStep % preset.bassArp.length];
        const oscBass = audioCtx.createOscillator();
        const gainBass = audioCtx.createGain();

        oscBass.type = 'sawtooth';
        oscBass.frequency.setValueAtTime(bassFreq, time);
        
        gainBass.gain.setValueAtTime(0.04, time);
        gainBass.gain.exponentialRampToValueAtTime(0.001, time + 0.3);

        oscBass.connect(gainBass);
        gainBass.connect(synthGain);
        oscBass.start(time);
        oscBass.stop(time + 0.3);

        // 2. Sintetizar melodía solista (Onda cuadrada estilo NES)
        const melFreq = preset.melody[currentStep % preset.melody.length];
        if (melFreq > 0 && currentStep % 2 === 0) {
            const oscMel = audioCtx.createOscillator();
            const gainMel = audioCtx.createGain();

            oscMel.type = 'square';
            oscMel.frequency.setValueAtTime(melFreq, time);

            gainMel.gain.setValueAtTime(0.03, time);
            gainMel.gain.exponentialRampToValueAtTime(0.001, time + 0.4);

            oscMel.connect(gainMel);
            gainMel.connect(synthGain);
            oscMel.start(time);
            oscMel.stop(time + 0.4);
        }

    } else if (preset.id === 'lofi') {
        // --- CHILL LOFI SEQUENCER ---
        // 1. Tocar acorde relajante cada 8 pasos (Ondas Triangulares suaves)
        if (currentStep % 8 === 0) {
            const chordIndex = Math.floor(currentStep / 8) % preset.chords.length;
            const frequencies = preset.chords[chordIndex];

            frequencies.forEach(freq => {
                const osc = audioCtx.createOscillator();
                const gainNode = audioCtx.createGain();

                osc.type = 'triangle';
                osc.frequency.setValueAtTime(freq, time);

                gainNode.gain.setValueAtTime(0.025, time);
                gainNode.gain.exponentialRampToValueAtTime(0.001, time + 1.8);

                osc.connect(gainNode);
                gainNode.connect(synthGain);
                osc.start(time);
                osc.stop(time + 1.8);
            });
        }

        // 2. Notas pentatónicas de fondo suaves y aleatorias
        if (currentStep % 2 === 0 && Math.random() > 0.6) {
            const randomMelIdx = Math.floor(Math.random() * preset.melody.length);
            const freq = preset.melody[randomMelIdx];
            if (freq > 0) {
                const osc = audioCtx.createOscillator();
                const gainNode = audioCtx.createGain();

                osc.type = 'sine'; // Onda senoidal pura
                osc.frequency.setValueAtTime(freq, time);

                gainNode.gain.setValueAtTime(0.02, time);
                gainNode.gain.exponentialRampToValueAtTime(0.001, time + 0.8);

                osc.connect(gainNode);
                gainNode.connect(synthGain);
                osc.start(time);
                osc.stop(time + 0.8);
            }
        }

    } else if (preset.id === 'rickroll') {
        // --- RICK ROLL SEQUENCER MELODÍA ---
        const freq = preset.melody[currentStep % preset.melody.length];
        if (freq > 0) {
            const osc = audioCtx.createOscillator();
            const gainNode = audioCtx.createGain();

            // Alternar timbres para simular banda de chiptune de 8 bits
            osc.type = (currentStep % 4 === 0) ? 'sawtooth' : 'triangle';
            osc.frequency.setValueAtTime(freq, time);

            gainNode.gain.setValueAtTime(0.05, time);
            gainNode.gain.exponentialRampToValueAtTime(0.001, time + 0.35);

            osc.connect(gainNode);
            gainNode.connect(synthGain);
            osc.start(time);
            osc.stop(time + 0.35);
        }
    }

    currentStep++;
}

// Pausar o reanudar música
function togglePlayback() {
    if (!musicState.currentTrack) return;

    const playBtn = document.getElementById('music-play-btn');

    if (musicState.isPlaying) {
        // Pausar
        musicState.isPlaying = false;
        if (audioCtx) audioCtx.suspend();
        
        if (musicState.currentTrack.youtubeId && ytPlayer && ytPlayerReady) {
            try {
                ytPlayer.pauseVideo();
            } catch (e) {}
        }

        if (playBtn) {
            playBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
        }
        document.getElementById('music-status-text').textContent = 'Pausado';
    } else {
        // Reanudar
        musicState.isPlaying = true;
        if (audioCtx) audioCtx.resume();
        
        if (musicState.currentTrack.youtubeId && ytPlayer && ytPlayerReady) {
            try {
                ytPlayer.playVideo();
            } catch (e) {}
        }

        if (playBtn) {
            playBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`;
        }
        document.getElementById('music-status-text').textContent = 'Reproduciendo';
    }
}

// Avanza a la siguiente canción en la cola
function skipTrack() {
    if (musicState.queue.length === 0) return;

    musicState.activeSongIndex++;
    if (musicState.activeSongIndex < musicState.queue.length) {
        const nextPreset = musicState.queue[musicState.activeSongIndex];
        startTrack(nextPreset);
    } else {
        // Cola terminada
        stopMusic();
    }
}

// Salta a la siguiente canción (público)
export function skipMusicCommand() {
    skipTrack();
}

// Detiene la reproducción y desconecta el bot físicamente
export function stopMusic() {
    stopSynthesizer();
    
    musicState.isPlaying = false;
    musicState.currentTrack = null;
    musicState.queue = [];
    musicState.activeSongIndex = -1;
    musicState.currentTime = 0;

    // Ocultar widget
    const widget = document.getElementById('music-player-widget');
    if (widget) widget.classList.add('hidden');

    // Desconectar visualmente de la voz
    triggerMusicBotVoiceConnection(false);
}

// Apagar temporizadores y osciladores del sintetizador
function stopSynthesizer() {
    if (schedulerInterval) {
        clearInterval(schedulerInterval);
        schedulerInterval = null;
    }
    if (timeProgressInterval) {
        clearInterval(timeProgressInterval);
        timeProgressInterval = null;
    }
    if (synthGain) {
        synthGain.disconnect();
        synthGain = null;
    }
    if (ytPlayer && ytPlayerReady) {
        try {
            ytPlayer.stopVideo();
        } catch (e) {}
    }
}

// Ajusta el volumen del bot en tiempo real desde el slider de salida
export function updateMusicVolume(vol) {
    if (synthGain && audioCtx) {
        const isYoutube = musicState.currentTrack && musicState.currentTrack.youtubeId;
        const targetVol = isYoutube ? 0.001 : 0.08 * vol;
        synthGain.gain.setValueAtTime(targetVol, audioCtx.currentTime);
    }
    if (ytPlayer && ytPlayerReady) {
        try {
            ytPlayer.setVolume(vol * 100);
        } catch (e) {}
    }
}

// Actualiza el progreso de reproducción cada segundo
function updateProgressBar() {
    if (!musicState.isPlaying || !musicState.currentTrack) return;

    if (musicState.currentTrack.youtubeId && ytPlayer && ytPlayerReady) {
        try {
            const curTime = ytPlayer.getCurrentTime();
            const dur = ytPlayer.getDuration();
            if (dur && dur > 0) {
                musicState.currentTime = Math.floor(curTime);
                musicState.currentTrack.duration = Math.floor(dur);
            } else {
                musicState.currentTime++;
            }
        } catch (e) {
            musicState.currentTime++;
        }
    } else {
        musicState.currentTime++;
    }
    
    if (musicState.currentTime >= musicState.currentTrack.duration) {
        // Canción terminada
        skipTrack();
        return;
    }

    // Actualizar barra e indicador de tiempo
    const fill = document.getElementById('music-progress-fill');
    const timeDisplay = document.getElementById('music-time-display');

    if (fill) {
        const pct = (musicState.currentTime / musicState.currentTrack.duration) * 100;
        fill.style.width = `${pct}%`;
    }

    if (timeDisplay) {
        timeDisplay.textContent = `${formatTime(musicState.currentTime)} / ${formatTime(musicState.currentTrack.duration)}`;
    }
}

// Actualiza la información inicial del Widget
function updateWidgetUI() {
    const titleEl = document.getElementById('music-track-title');
    const statusEl = document.getElementById('music-status-text');
    const playBtn = document.getElementById('music-play-btn');
    const fill = document.getElementById('music-progress-fill');
    const timeDisplay = document.getElementById('music-time-display');

    if (titleEl && musicState.currentTrack) {
        titleEl.textContent = musicState.currentTrack.title;
    }
    if (statusEl) {
        statusEl.textContent = 'Reproduciendo';
    }
    if (playBtn) {
        playBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`;
    }
    if (fill) fill.style.width = '0%';
    if (timeDisplay && musicState.currentTrack) {
        timeDisplay.textContent = `00:00 / ${formatTime(musicState.currentTrack.duration)}`;
    }
}

// Helper: Convierte segundos en formato MM:SS
function formatTime(sec) {
    const m = Math.floor(sec / 60).toString().padStart(2, '0');
    const s = Math.floor(sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}
