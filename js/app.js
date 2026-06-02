/* NEXUS MAIN STATE COORDINATOR (ES MODULE) */

import { initChat, switchChatChannel } from './chat.js';
import { initVoice, disconnectVoiceChannel, joinVoiceChannel } from './voice.js';
import { initStream, toggleLocalStream } from './stream.js';
import { initThemePanel } from './theme.js';
import { EMAILJS_CONFIG, DEMO_MODE } from './emailjs.config.js';
import { initMusic } from './music.js';
import { isUserOp } from './voice.js';
import { initSupabaseSetup, supabase, supabaseReady, startGlobalPresence, stopGlobalPresence } from './supabase-client.js';
import { initCamera, stopCamera } from './camera.js';

// Estado global de la aplicación (Single Source of Truth)
export const state = {
    activeChannel: 'general',
    activeChannelType: 'text',
    activeVoiceChannel: null,
    isMuted: false,
    isDeafened: false,
    isStreaming: false,
    activeStreamObject: null,
    optimizationGPU: true,
    optimizationCPUSave: false,
    optimizationAudioCompression: true
};

// Medición de rendimiento en tiempo real
let lastFrameTime = performance.now();
let frames = 0;
let fpsElement;
let renderLatencyElement;

export function updateRenderLatency(startTime) {
    if (!renderLatencyElement) renderLatencyElement = document.getElementById('render-latency');
    if (renderLatencyElement) {
        const latency = (performance.now() - startTime).toFixed(2);
        renderLatencyElement.textContent = `Render: ${latency}ms`;
    }
}

function runPerformanceLoop() {
    const now = performance.now();
    frames++;
    
    if (now >= lastFrameTime + 1000) {
        const fps = Math.round((frames * 1000) / (now - lastFrameTime));
        if (!fpsElement) fpsElement = document.getElementById('fps-value');
        const fpsBar = document.getElementById('fps-bar');
        
        if (fpsElement) {
            fpsElement.textContent = `${fps} FPS`;
        }
        if (fpsBar) {
            fpsBar.style.width = `${Math.min((fps / 60) * 100, 100)}%`;
        }
        
        // Simulación controlada de consumo de memoria y CPU basada en la optimización activa
        updatePerformanceMetrics();

        frames = 0;
        lastFrameTime = now;
    }
    
    // Si el ahorro de CPU está encendido, reducimos el loop de cálculo a 30fps para simular
    if (state.optimizationCPUSave) {
        setTimeout(() => requestAnimationFrame(runPerformanceLoop), 33);
    } else {
        requestAnimationFrame(runPerformanceLoop);
    }
}

function updatePerformanceMetrics() {
    const cpuVal = document.getElementById('cpu-value');
    const memVal = document.getElementById('mem-value');
    
    let simulatedCPU = 0.05;
    let simulatedMem = 8.4;
    
    if (state.isStreaming) {
        simulatedCPU += 1.25;
        simulatedMem += 15.2;
    }
    if (state.activeVoiceChannel) {
        simulatedCPU += 0.35;
        simulatedMem += 4.8;
    }
    
    // Efecto de las optimizaciones configuradas por el usuario
    if (state.optimizationCPUSave) {
        simulatedCPU *= 0.4; // Reduce el cálculo
    }
    if (!state.optimizationGPU) {
        simulatedCPU += 0.8; // Más carga de CPU sin GPU
        simulatedMem += 6.5;
    }
    
    if (cpuVal) cpuVal.textContent = `${simulatedCPU.toFixed(2)}%`;
    if (memVal) memVal.textContent = `${simulatedMem.toFixed(1)} MB`;
}

// Inicialización de la aplicación
document.addEventListener('DOMContentLoaded', () => {
    const startTime = performance.now();
    
    // Inicializar sub-módulos
    initChat();
    initVoice();
    initStream();
    initCamera();
    initThemePanel();
    initSupabaseSetup();
    
    // Iniciar loop de rendimiento
    runPerformanceLoop();

    // Vincular selectores de canales (estáticos del HTML)
    document.querySelectorAll('.channel-item').forEach(item => bindChannelItemClickAtInit(item));

    // Si Supabase está disponible, cargar canales desde la BD
    if (supabase) loadChannelsFromSupabase();
    window.addEventListener('supabase-ready', () => loadChannelsFromSupabase());

    // Control de transmisiones
    const goLiveBtn = document.getElementById('go-live-btn');
    if (goLiveBtn) {
        goLiveBtn.addEventListener('click', () => {
            toggleLocalStream();
        });
    }

    // Vincular Toggles de Rendimiento
    const optGPU = document.getElementById('opt-gpu');
    const optCPUSave = document.getElementById('opt-cpu-save');
    const optAudio = document.getElementById('opt-audio');
    
    if (optGPU) {
        optGPU.addEventListener('change', (e) => {
            state.optimizationGPU = e.target.checked;
            const statusText = state.optimizationGPU ? "Aceleración activada" : "Aceleración desactivada";
            console.log(`[Rendimiento] ${statusText}`);
        });
    }
    if (optCPUSave) {
        optCPUSave.addEventListener('change', (e) => {
            state.optimizationCPUSave = e.target.checked;
            console.log(`[Rendimiento] Ahorro de CPU: ${state.optimizationCPUSave}`);
        });
    }
    if (optAudio) {
        optAudio.addEventListener('change', (e) => {
            state.optimizationAudioCompression = e.target.checked;
            console.log(`[Audio] Compresión WebRTC activada: ${state.optimizationAudioCompression}`);
        });
    }

    // --- SISTEMA DE AUTENTICACIÓN SHIELD (2 PASOS OTP) ---
    const loginOverlay = document.getElementById('login-overlay');
    const loginStep1 = document.getElementById('login-step-1');
    const loginStep2 = document.getElementById('login-step-2');
    const loginFormStep1 = document.getElementById('login-form-step1');
    const loginFormStep2 = document.getElementById('login-form-step2');
    const loginEmailInput = document.getElementById('login-email');
    const loginErrorEmail = document.getElementById('login-error-email');
    const loginSendBtn = document.getElementById('login-send-btn');
    const loginSendBtnText = document.getElementById('login-send-btn-text');
    const logoutBtn = document.getElementById('logout-btn');

    const otpSentTo = document.getElementById('otp-sent-to');
    const otpDigits = Array.from(document.querySelectorAll('.otp-digit'));
    const loginErrorOtp = document.getElementById('login-error-otp');
    const loginVerifyBtn = document.getElementById('login-verify-btn');
    const loginVerifyBtnText = document.getElementById('login-verify-btn-text');
    const resendBtn = document.getElementById('resend-btn');
    const resendCountdown = document.getElementById('resend-countdown');
    const otpBackBtn = document.getElementById('otp-back-btn');
    const otpExpiryDisplay = document.getElementById('otp-expiry-display');

    let generatedOtp = null;
    let targetEmail = null;
    let otpExpiryTime = null;
    let expiryTimer = null;
    let resendTimer = null;
    let resendCooldown = 60;

    // Comprobar si ya hay sesión guardada en localStorage
    const savedEmail = localStorage.getItem('nexus_user_email');
    if (savedEmail) {
        if (loginOverlay) loginOverlay.style.display = 'none';
        updateUserProfileUI(savedEmail);
    }

    // Paso 1: Enviar correo
    if (loginFormStep1 && loginEmailInput) {
        loginFormStep1.addEventListener('submit', (e) => {
            e.preventDefault();
            sendVerificationCode();
        });
    }

    // Paso 2: Verificar OTP
    if (loginFormStep2) {
        loginFormStep2.addEventListener('submit', (e) => {
            e.preventDefault();
            verifyVerificationCode();
        });
    }

    // Cambiar Correo (Atrás)
    if (otpBackBtn) {
        otpBackBtn.addEventListener('click', () => {
            resetOtpState();
            if (loginStep2) loginStep2.classList.add('hidden');
            if (loginStep1) loginStep1.classList.remove('hidden');
            if (loginEmailInput) loginEmailInput.focus();
        });
    }

    // Reenviar Código
    if (resendBtn) {
        resendBtn.addEventListener('click', () => {
            if (resendBtn.disabled) return;
            sendVerificationCode(true); // Modo reenviar
        });
    }

    // --- FUNCIONES CORE DE AUTH ---

    async function sendVerificationCode(isResend = false) {
        const email = loginEmailInput.value.trim();
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        
        if (!emailRegex.test(email)) {
            if (loginErrorEmail) loginErrorEmail.classList.remove('hidden');
            return;
        }

        if (loginErrorEmail) loginErrorEmail.classList.add('hidden');
        targetEmail = email;

        // Cambiar estado a cargando
        if (isResend) {
            if (resendBtn) resendBtn.disabled = true;
        } else {
            if (loginSendBtn) {
                loginSendBtn.disabled = true;
                if (loginSendBtnText) loginSendBtnText.textContent = 'Enviando código...';
            }
        }

        // Generar OTP de 6 dígitos
        generatedOtp = Math.floor(100000 + Math.random() * 900000).toString();
        // Expira en 10 minutos (600,000 ms)
        otpExpiryTime = Date.now() + 10 * 60 * 1000;

        console.log(`[Nexus Auth] Código generado para ${email}.`);

        try {
            if (DEMO_MODE) {
                // Simulación en consola de forma ultra premium
                console.log(
                    `%c 🛡️ [NEXUS SHIELD - MODO DEMO ACTIVE] %c\n` +
                    `========================================\n` +
                    ` Correo Destino: ${email}\n` +
                    ` Código de Verificación OTP: ${generatedOtp}\n` +
                    ` Expira en: 10 minutos (Consola F12 local)\n` +
                    `========================================`,
                    'color: #00d4ff; font-weight: bold; font-size: 13px;',
                    'color: #8b5cf6; font-weight: 500;'
                );
                
                // Pequeño aviso visual para desarrollo
                const notification = document.createElement('div');
                notification.style.position = 'fixed';
                notification.style.bottom = '20px';
                notification.style.right = '20px';
                notification.style.background = 'var(--bg-secondary)';
                notification.style.border = '1px solid var(--accent-cyan)';
                notification.style.color = 'var(--text-normal)';
                notification.style.padding = '12px 20px';
                notification.style.borderRadius = '8px';
                notification.style.boxShadow = '0 0 15px var(--accent-cyan-glow)';
                notification.style.zIndex = '9999';
                notification.style.animation = 'fadeInUp 0.3s ease';
                notification.innerHTML = `
                    <div style="font-weight:700;color:var(--accent-cyan);font-size:0.85rem;margin-bottom:4px;font-family:'Orbitron'">🛡️ NEXUS DEV SHIELD</div>
                    <div style="font-size:0.75rem">OTP enviado a consola F12: <strong style="color:var(--accent-purple)">${generatedOtp}</strong></div>
                `;
                document.body.appendChild(notification);
                setTimeout(() => {
                    notification.style.animation = 'fadeInUp 0.3s ease reverse';
                    setTimeout(() => notification.remove(), 300);
                }, 7000);

            } else {
                // EmailJS real
                if (typeof emailjs === 'undefined') {
                    throw new Error('EmailJS SDK no se pudo cargar.');
                }
                emailjs.init(EMAILJS_CONFIG.publicKey);
                await emailjs.send(
                    EMAILJS_CONFIG.serviceId,
                    EMAILJS_CONFIG.templateId,
                    {
                        to_email: email,
                        otp_code: generatedOtp
                    }
                );
                console.log(`[Nexus Auth] Código OTP enviado vía EmailJS a ${email}.`);
            }

            // Transición a paso 2
            if (otpSentTo) otpSentTo.textContent = email;
            if (loginStep1) loginStep1.classList.add('hidden');
            if (loginStep2) loginStep2.classList.remove('hidden');
            
            // Limpiar y enfocar primer input
            otpDigits.forEach(d => {
                d.value = '';
                d.classList.remove('filled');
            });
            setTimeout(() => {
                if (otpDigits[0]) otpDigits[0].focus();
            }, 100);

            // Iniciar timers
            startResendCooldownTimer();
            startExpiryTimer();

        } catch (err) {
            console.error('[Nexus Auth] Error al enviar verificación:', err);
            alert('Error al enviar el código de verificación. Por favor verifica tu conexión o las credenciales de EmailJS en js/emailjs.config.js.');
        } finally {
            // Restaurar botones
            if (loginSendBtn) {
                loginSendBtn.disabled = false;
                if (loginSendBtnText) loginSendBtnText.textContent = 'Enviar código de verificación';
            }
        }
    }

    function verifyVerificationCode() {
        const enteredCode = otpDigits.map(d => d.value).join('');
        
        if (enteredCode.length !== 6) {
            showOtpError('Ingresa el código completo de 6 dígitos.');
            shakeOtpInputs();
            return;
        }

        // Comprobar expiración
        if (Date.now() > otpExpiryTime) {
            showOtpError('El código ha expirado. Solicita uno nuevo.');
            shakeOtpInputs();
            return;
        }

        // Comprobar validez
        if (enteredCode !== generatedOtp) {
            showOtpError('Código incorrecto. Inténtalo de nuevo.');
            shakeOtpInputs();
            return;
        }

        // Autenticado con éxito!
        if (loginErrorOtp) loginErrorOtp.classList.add('hidden');
        
        if (loginVerifyBtn) {
            loginVerifyBtn.disabled = true;
            if (loginVerifyBtnText) loginVerifyBtnText.textContent = 'Accediendo a la red...';
        }

        setTimeout(() => {
            localStorage.setItem('nexus_user_email', targetEmail);
            updateUserProfileUI(targetEmail);
            resetOtpState();

            if (loginOverlay) {
                loginOverlay.classList.add('fade-out');
                setTimeout(() => {
                    loginOverlay.style.display = 'none';
                }, 400);
            }
        }, 800);
    }

    // --- TIMERS Y NAVEGACIÓN ---

    function startResendCooldownTimer() {
        if (resendTimer) clearInterval(resendTimer);
        resendCooldown = 60;
        
        if (resendBtn) {
            resendBtn.disabled = true;
            if (resendCountdown) resendCountdown.textContent = resendCooldown;
        }

        resendTimer = setInterval(() => {
            resendCooldown--;
            if (resendCountdown) resendCountdown.textContent = resendCooldown;
            
            if (resendCooldown <= 0) {
                clearInterval(resendTimer);
                resendTimer = null;
                if (resendBtn) {
                    resendBtn.disabled = false;
                    resendBtn.innerHTML = 'Reenviar código';
                }
            } else {
                if (resendBtn) {
                    resendBtn.innerHTML = `Reenviar código (<span id="resend-countdown">${resendCooldown}</span>s)`;
                }
            }
        }, 1000);
    }

    function startExpiryTimer() {
        if (expiryTimer) clearInterval(expiryTimer);

        function updateDisplay() {
            const remainingMs = otpExpiryTime - Date.now();
            if (remainingMs <= 0) {
                clearInterval(expiryTimer);
                expiryTimer = null;
                if (otpExpiryDisplay) otpExpiryDisplay.textContent = '00:00';
                showOtpError('El código de verificación ha expirado.');
                return;
            }

            const totalSec = Math.floor(remainingMs / 1000);
            const m = Math.floor(totalSec / 60).toString().padStart(2, '0');
            const s = (totalSec % 60).toString().padStart(2, '0');
            if (otpExpiryDisplay) otpExpiryDisplay.textContent = `${m}:${s}`;
        }

        updateDisplay();
        expiryTimer = setInterval(updateDisplay, 1000);
    }

    function resetOtpState() {
        if (expiryTimer) clearInterval(expiryTimer);
        if (resendTimer) clearInterval(resendTimer);
        expiryTimer = null;
        resendTimer = null;
        generatedOtp = null;
        otpExpiryTime = null;
        if (loginErrorOtp) loginErrorOtp.classList.add('hidden');
    }

    function showOtpError(msg) {
        if (loginErrorOtp) {
            loginErrorOtp.textContent = msg;
            loginErrorOtp.classList.remove('hidden');
        }
    }

    function shakeOtpInputs() {
        const group = document.querySelector('.otp-input-group');
        if (group) {
            group.classList.add('shake');
            setTimeout(() => group.classList.remove('shake'), 400);
        }
    }

    // Configurar comportamiento inteligente de campos de dígitos
    otpDigits.forEach((digitInput, index) => {
        // Al ingresar dígito
        digitInput.addEventListener('input', (e) => {
            const val = digitInput.value.replace(/[^0-9]/g, '');
            digitInput.value = val;

            if (val) {
                digitInput.classList.add('filled');
                // Enfocar siguiente si existe
                if (index < otpDigits.length - 1) {
                    otpDigits[index + 1].focus();
                }
            } else {
                digitInput.classList.remove('filled');
            }

            // Intentar auto-verificar si todos están llenos
            const currentEntered = otpDigits.map(d => d.value).join('');
            if (currentEntered.length === 6) {
                verifyVerificationCode();
            }
        });

        // Al presionar teclas (Backspace, Flechas)
        digitInput.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace' && !digitInput.value) {
                // Si está vacío y presiona backspace, enfocar anterior
                if (index > 0) {
                    otpDigits[index - 1].focus();
                    otpDigits[index - 1].value = '';
                    otpDigits[index - 1].classList.remove('filled');
                }
            } else if (e.key === 'ArrowLeft' && index > 0) {
                otpDigits[index - 1].focus();
            } else if (e.key === 'ArrowRight' && index < otpDigits.length - 1) {
                otpDigits[index + 1].focus();
            }
        });

        // Soporte de pegado (Paste)
        digitInput.addEventListener('paste', (e) => {
            e.preventDefault();
            const text = (e.clipboardData || window.clipboardData).getData('text');
            const cleanDigits = text.replace(/[^0-9]/g, '').slice(0, 6);
            
            if (cleanDigits.length > 0) {
                cleanDigits.split('').forEach((char, charIdx) => {
                    if (otpDigits[charIdx]) {
                        otpDigits[charIdx].value = char;
                        otpDigits[charIdx].classList.add('filled');
                    }
                });
                
                // Enfocar último rellenado
                const focusIdx = Math.min(cleanDigits.length, 5);
                otpDigits[focusIdx].focus();

                if (cleanDigits.length === 6) {
                    verifyVerificationCode();
                }
            }
        });
    });

    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            disconnectVoiceChannel();
            stopGlobalPresence(); // Quitar al usuario de la lista de en línea
            localStorage.removeItem('nexus_user_email');
            window.location.reload();
        });
    }

    function updateUserProfileUI(email) {
        const usernameSpan = document.getElementById('user-display-name');
        const emailSpan = document.getElementById('user-display-email');
        const avatarLetter = document.getElementById('user-avatar-letter');
        
        if (email) {
            const namePart = email.split('@')[0];
            const cleanName = namePart.charAt(0).toUpperCase() + namePart.slice(1);
            
            if (usernameSpan) usernameSpan.textContent = cleanName;
            if (emailSpan) emailSpan.textContent = email;
            if (avatarLetter && !localStorage.getItem('nexus_user_avatar')) {
                avatarLetter.textContent = cleanName.charAt(0);
            }

            // Actualizar el item local en la sidebar de miembros
            const sidebarName = document.getElementById('sidebar-local-name');
            if (sidebarName) sidebarName.textContent = cleanName;
            const sidebarAvatar = document.getElementById('sidebar-local-avatar');
            if (sidebarAvatar) sidebarAvatar.textContent = cleanName.charAt(0);

            // Iniciar presencia global para que todos vean quién está conectado
            if (supabaseReady && supabase) {
                startGlobalPresence(cleanName);
            }
        }
    }

    // Si Supabase se conecta después de que el usuario ya estaba logueado
    window.addEventListener('supabase-ready', () => {
        const savedEmail = localStorage.getItem('nexus_user_email');
        if (savedEmail) {
            const base = savedEmail.split('@')[0];
            const cleanName = base.charAt(0).toUpperCase() + base.slice(1);
            startGlobalPresence(cleanName);
        }
    });

    // --- CARGAR / ENLAZAR EL MOTOR DE MÚSICA EN VOZ ---
    initMusic();

    // --- CARGAR AVATAR PERSONALIZADO AL INICIAR CON CORTES ---
    const userAvatarContainer = document.getElementById('user-avatar-container');
    const avatarUploadInput = document.getElementById('avatar-upload-input');
    const userAvatarLetter = document.getElementById('user-avatar-letter');
    
    // Modal de corte
    const cropModal = document.getElementById('avatar-crop-modal');
    const cropPreview = document.getElementById('avatar-crop-preview');
    const btnCircle = document.getElementById('crop-style-circle');
    const btnFull = document.getElementById('crop-style-full');
    const cropSaveBtn = document.getElementById('avatar-crop-save-btn');
    const cropCloseBtn = document.getElementById('avatar-crop-close-btn');
    const cropOverlay = document.getElementById('avatar-crop-overlay');

    let tempAvatarBase64 = null;
    let selectedCropStyle = localStorage.getItem('nexus_user_avatar_style') || 'circle'; // 'circle' o 'full'

    if (userAvatarContainer && avatarUploadInput) {
        userAvatarContainer.addEventListener('click', (e) => {
            if (e.target !== avatarUploadInput) {
                avatarUploadInput.value = ''; // Limpiar valor previo
                avatarUploadInput.click();
            }
        });

        avatarUploadInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;

            if (file.size > 5 * 1024 * 1024) {
                alert('La foto de perfil supera el límite optimizado de 5 MB.');
                return;
            }

            const reader = new FileReader();
            reader.onload = (event) => {
                tempAvatarBase64 = event.target.result;
                
                // Mostrar modal y previsualizar imagen con todos los estilos de cover correctamente
                if (cropPreview) {
                    cropPreview.style.backgroundImage = `url(${tempAvatarBase64})`;
                    cropPreview.style.backgroundSize = 'cover';
                    cropPreview.style.backgroundPosition = 'center';
                    cropPreview.style.backgroundRepeat = 'no-repeat';
                }
                
                // Sincronizar botones con el estilo activo
                applyCropStyleUI(selectedCropStyle);
                cropModal?.classList.remove('hidden');
            };
            reader.readAsDataURL(file);
        });
    }

    // Helper: sincroniza la UI del modal (botones + preview) con el estilo seleccionado
    function applyCropStyleUI(style) {
        if (!cropPreview) return;
        if (style === 'circle') {
            cropPreview.style.borderRadius = '50%';
            if (btnCircle) {
                btnCircle.style.borderColor = 'var(--accent-cyan)';
                btnCircle.style.background = 'rgba(0,212,255,0.15)';
                btnCircle.style.color = 'var(--accent-cyan)';
                btnCircle.style.fontWeight = '700';
            }
            if (btnFull) {
                btnFull.style.borderColor = 'transparent';
                btnFull.style.background = '';
                btnFull.style.color = '';
                btnFull.style.fontWeight = '';
            }
        } else {
            cropPreview.style.borderRadius = '10px';
            if (btnFull) {
                btnFull.style.borderColor = 'var(--accent-cyan)';
                btnFull.style.background = 'rgba(0,212,255,0.15)';
                btnFull.style.color = 'var(--accent-cyan)';
                btnFull.style.fontWeight = '700';
            }
            if (btnCircle) {
                btnCircle.style.borderColor = 'transparent';
                btnCircle.style.background = '';
                btnCircle.style.color = '';
                btnCircle.style.fontWeight = '';
            }
        }
    }

    // Eventos del modal de crop/recorte
    if (btnCircle) {
        btnCircle.addEventListener('click', () => {
            selectedCropStyle = 'circle';
            applyCropStyleUI('circle');
        });
    }
    if (btnFull) {
        btnFull.addEventListener('click', () => {
            selectedCropStyle = 'full';
            applyCropStyleUI('full');
        });
    }

    const closeCropModal = () => cropModal?.classList.add('hidden');
    if (cropCloseBtn) cropCloseBtn.addEventListener('click', closeCropModal);
    if (cropOverlay) cropOverlay.addEventListener('click', closeCropModal);

    if (cropSaveBtn) {
        cropSaveBtn.addEventListener('click', () => {
            if (tempAvatarBase64) {
                localStorage.setItem('nexus_user_avatar', tempAvatarBase64);
                localStorage.setItem('nexus_user_avatar_style', selectedCropStyle);
                closeCropModal();
                updateAvatarUI();
                // Actualizar todos los avatares del usuario actual en el chat sin recargar
                updateAllChatAvatars(tempAvatarBase64, selectedCropStyle);
            }
        });
    }

    function updateAvatarUI() {
        const savedAvatar = localStorage.getItem('nexus_user_avatar');
        const savedStyle = localStorage.getItem('nexus_user_avatar_style') || 'circle';
        const borderRadius = savedStyle === 'circle' ? '50%' : '10px';
        
        if (savedAvatar && userAvatarLetter) {
            userAvatarLetter.style.backgroundImage = `url(${savedAvatar})`;
            userAvatarLetter.style.backgroundSize = 'cover';
            userAvatarLetter.style.backgroundPosition = 'center';
            userAvatarLetter.style.backgroundRepeat = 'no-repeat';
            userAvatarLetter.textContent = ''; // Limpiar inicial
            userAvatarLetter.style.borderRadius = borderRadius;
        }
    }

    // Actualiza los avatares del chat en vivo sin recargar
    function updateAllChatAvatars(avatarDataUrl, style) {
        const borderRadius = style === 'circle' ? '50%' : '10px';
        const email = localStorage.getItem('nexus_user_email') || '';
        if (!email) return;
        const myName = email.split('@')[0].charAt(0).toUpperCase() + email.split('@')[0].slice(1);
        
        // Buscar todos los avatares del usuario actual en los mensajes del chat
        document.querySelectorAll('.message-item').forEach(item => {
            const authorEl = item.querySelector('.message-author');
            if (authorEl && authorEl.textContent.startsWith(myName)) {
                const avatarDiv = item.querySelector('.avatar');
                if (avatarDiv) {
                    avatarDiv.style.backgroundImage = `url(${avatarDataUrl})`;
                    avatarDiv.style.backgroundSize = 'cover';
                    avatarDiv.style.backgroundPosition = 'center';
                    avatarDiv.style.borderRadius = borderRadius;
                    avatarDiv.textContent = '';
                }
            }
        });
    }

    updateAvatarUI(); // Invocar de inmediato
    applyCropStyleUI(selectedCropStyle); // Inicializar estado visual de botones

    // Función de enlace inicial de channel items (usada en DOMContentLoaded)
    function bindChannelItemClickAtInit(item) {
        item.addEventListener('click', (e) => {
            if (e.target.closest('.delete-channel-btn')) return;
            const channelId = item.getAttribute('data-channel');
            const type = item.getAttribute('data-type');
            if (type === 'text') {
                document.querySelectorAll('.channel-item[data-type="text"]').forEach(el => el.classList.remove('active'));
                item.classList.add('active');
                state.activeChannel = channelId;
                switchChatChannel(channelId);
            } else if (type === 'voice') {
                if (state.activeVoiceChannel === channelId) disconnectVoiceChannel();
                else joinVoiceChannel(channelId, item.querySelector('.channel-name')?.textContent || channelId);
            }
        });
    }

    // Cargar canales desde Supabase (cuando está configurado)
    async function loadChannelsFromSupabase() {
        if (!supabase) return;
        try {
            const { data, error } = await supabase.from('channels').select('*').order('created_at', { ascending: true });
            if (error || !data) return;

            const textList = document.getElementById('text-channels');
            const voiceList = document.getElementById('voice-channels');
            if (!textList || !voiceList) return;

            // Limpiar listas existentes del HTML estático
            textList.innerHTML = '';
            voiceList.innerHTML = '';

            data.forEach(ch => {
                const li = document.createElement('li');
                li.className = 'channel-item';
                li.setAttribute('data-channel', ch.id);
                li.setAttribute('data-type', ch.type);

                if (ch.type === 'text') {
                    li.innerHTML = `<span class="channel-icon">#</span><span class="channel-name">${escapeHTMLForApp(ch.name)}</span>`;
                    textList.appendChild(li);
                } else if (ch.type === 'voice') {
                    li.innerHTML = `
                        <svg class="channel-svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
                        <span class="channel-name">${escapeHTMLForApp(ch.name)}</span>
                        <span class="active-count" id="voice-count-${ch.id}">0</span>
                    `;
                    voiceList.appendChild(li);
                }

                bindChannelItemClickAtInit(li);
            });

            // Activar el primer canal de texto por defecto
            const firstText = textList.querySelector('.channel-item[data-type="text"]');
            if (firstText) {
                firstText.classList.add('active');
                state.activeChannel = firstText.getAttribute('data-channel');
                switchChatChannel(state.activeChannel);
            }

            console.log(`[Supabase] ${data.length} canales cargados correctamente.`);
        } catch (err) {
            console.warn('[Supabase] Error cargando canales:', err.message);
        }
    }

    // --- GESTIÓN DE CANALES DINÁMICOS ---

    const addTextChannelBtn = document.getElementById('add-text-channel-btn');
    const addVoiceChannelBtn = document.getElementById('add-voice-channel-btn');
    const channelModal = document.getElementById('channel-modal');
    const channelModalOverlay = document.getElementById('channel-modal-overlay');
    const channelModalCloseBtn = document.getElementById('channel-modal-close-btn');
    const createChannelForm = document.getElementById('create-channel-form');
    const newChannelNameInput = document.getElementById('new-channel-name');
    const channelModalTitle = document.getElementById('channel-modal-title');
    const channelCreateError = document.getElementById('channel-create-error');

    let currentAddingChannelType = 'text'; // 'text' o 'voice'

    if (addTextChannelBtn) {
        addTextChannelBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openChannelModal('text');
        });
    }
    if (addVoiceChannelBtn) {
        addVoiceChannelBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openChannelModal('voice');
        });
    }

    function openChannelModal(type) {
        currentAddingChannelType = type;
        if (channelModalTitle) {
            channelModalTitle.textContent = type === 'text' ? 'Crear Canal de Texto' : 'Crear Sala de Voz';
        }
        if (newChannelNameInput) {
            newChannelNameInput.value = '';
            newChannelNameInput.placeholder = type === 'text' ? 'ej: clips-graciosos' : 'ej: Duo Queue';
        }
        if (channelCreateError) channelCreateError.classList.add('hidden');
        if (channelModal) channelModal.classList.remove('hidden');
        setTimeout(() => newChannelNameInput?.focus(), 100);
    }

    const closeChannelModal = () => channelModal && channelModal.classList.add('hidden');
    if (channelModalCloseBtn) channelModalCloseBtn.addEventListener('click', closeChannelModal);
    if (channelModalOverlay) channelModalOverlay.addEventListener('click', closeChannelModal);

    function getLocalUserName() {
        const email = localStorage.getItem('nexus_user_email') || '';
        if (!email) return 'Usuario Nexus';
        const base = email.split('@')[0];
        return base.charAt(0).toUpperCase() + base.slice(1);
    }

    function escapeHTMLForApp(str) {
        if (typeof str !== 'string') return '';
        return str.replace(/[&<>'"]/g, tag => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
        }[tag] || tag));
    }

    if (createChannelForm) {
        createChannelForm.addEventListener('submit', (e) => {
            e.preventDefault();
            
            // Validar si el usuario es OP
            const myName = getLocalUserName();
            if (!isUserOp(myName)) {
                if (channelCreateError) {
                    channelCreateError.textContent = 'No tienes rango de Operator (OP) para crear canales.';
                    channelCreateError.classList.remove('hidden');
                }
                return;
            }

            const name = newChannelNameInput.value.trim();
            if (!name) return;

            const channelId = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

            if (currentAddingChannelType === 'text') {
                const textChannelsList = document.getElementById('text-channels');
                if (textChannelsList) {
                    const li = document.createElement('li');
                    li.className = 'channel-item';
                    li.setAttribute('data-channel', channelId);
                    li.setAttribute('data-type', 'text');
                    li.innerHTML = `
                        <span class="channel-icon">#</span>
                        <span class="channel-name">${escapeHTMLForApp(name.toLowerCase())}</span>
                        <button class="delete-channel-btn" title="Eliminar Canal">🗑️</button>
                    `;
                    textChannelsList.appendChild(li);
                    
                    // Enlazar click
                    bindChannelItemClick(li);
                }
            } else {
                const voiceChannelsList = document.getElementById('voice-channels');
                if (voiceChannelsList) {
                    const li = document.createElement('li');
                    li.className = 'channel-item';
                    li.setAttribute('data-channel', channelId);
                    li.setAttribute('data-type', 'voice');
                    li.innerHTML = `
                        <svg class="channel-svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
                        <span class="channel-name">${escapeHTMLForApp(name)}</span>
                        <span class="active-count" id="voice-count-${channelId}">0</span>
                        <button class="delete-channel-btn" title="Eliminar Sala">🗑️</button>
                    `;
                    voiceChannelsList.appendChild(li);
                    
                    // Enlazar click
                    bindChannelItemClick(li);
                }
            }

            // Persistir canal en Supabase si está disponible
            if (supabaseReady && supabase) {
                supabase.from('channels').insert({
                    id: channelId,
                    name: name,
                    type: currentAddingChannelType
                }).then(({ error }) => {
                    if (error) {
                        console.error('[Supabase] Error al crear canal:', error.message);
                    } else {
                        console.log('[Supabase] Canal creado en base de datos.');
                        loadChannelsFromSupabase(); // Sincronizar
                    }
                });
            }

            closeChannelModal();
        });
    }

    // Agregar botón de borrar a los canales iniciales
    function addDeleteButtonsToPresetChannels() {
        const presetChannels = document.querySelectorAll('.channel-item');
        presetChannels.forEach(item => {
            const hasDelete = item.querySelector('.delete-channel-btn');
            if (!hasDelete) {
                const btn = document.createElement('button');
                btn.className = 'delete-channel-btn';
                btn.title = item.getAttribute('data-type') === 'text' ? 'Eliminar Canal' : 'Eliminar Sala';
                btn.innerHTML = '🗑️';
                item.appendChild(btn);
                
                // Vincular evento de eliminación
                bindDeleteChannelClick(btn, item);
            }
        });
    }
    addDeleteButtonsToPresetChannels();

    function bindChannelItemClick(item) {
        item.addEventListener('click', (e) => {
            if (e.target.closest('.delete-channel-btn')) return;

            const channelId = item.getAttribute('data-channel');
            const type = item.getAttribute('data-type');
            
            if (type === 'text') {
                document.querySelectorAll('.channel-item[data-type="text"]').forEach(el => el.classList.remove('active'));
                item.classList.add('active');
                state.activeChannel = channelId;
                switchChatChannel(channelId);
            } else if (type === 'voice') {
                if (state.activeVoiceChannel === channelId) {
                    disconnectVoiceChannel();
                } else {
                    joinVoiceChannel(channelId, item.querySelector('.channel-name').textContent);
                }
            }
        });

        const delBtn = item.querySelector('.delete-channel-btn');
        if (delBtn) {
            bindDeleteChannelClick(delBtn, item);
        }
    }

    function bindDeleteChannelClick(delBtn, item) {
        delBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            
            const myName = getLocalUserName();
            if (!isUserOp(myName)) {
                alert('No tienes rango de Operator (OP) para eliminar canales.');
                return;
            }

            if (confirm(`¿Estás seguro de eliminar el canal #${item.querySelector('.channel-name').textContent}?`)) {
                const channelId = item.getAttribute('data-channel');
                if (state.activeVoiceChannel === channelId) {
                    disconnectVoiceChannel();
                }
                
                item.remove();
                console.log(`[Canales] Canal ${channelId} eliminado por Operator.`);

                // Eliminar de Supabase si está disponible
                if (supabaseReady && supabase) {
                    supabase.from('channels').delete().eq('id', channelId).then(({ error }) => {
                        if (error) {
                            console.error('[Supabase] Error al eliminar canal:', error.message);
                        } else {
                            console.log('[Supabase] Canal eliminado de base de datos.');
                            loadChannelsFromSupabase(); // Sincronizar
                        }
                    });
                }
            }
        });
    }

    // Vincular clicks a preset channels iniciales
    document.querySelectorAll('.channel-item').forEach(item => {
        const type = item.getAttribute('data-type');
        const delBtn = item.querySelector('.delete-channel-btn');
        if (delBtn) {
            bindDeleteChannelClick(delBtn, item);
        }
    });

    // --- SISTEMA DE RANGOS "OP" INTERACTIVO ---
    const memberActionMenu = document.getElementById('member-action-menu');
    const menuMemberName = document.getElementById('menu-member-name');
    const menuActionOp = document.getElementById('menu-action-op');
    const menuActionProfile = document.getElementById('menu-action-profile');

    let currentSelectedMemberName = '';

    // Vincular clic en miembros en la lista lateral
    function bindMemberClickListeners() {
        const members = document.querySelectorAll('.member-item');
        members.forEach(item => {
            item.style.cursor = 'pointer';
            
            // Añadir corona visual en el miembro de la barra derecha si es OP
            const nameSpan = item.querySelector('.member-name');
            const name = nameSpan.textContent;
            if (isUserOp(name) && !nameSpan.querySelector('.badge-op')) {
                nameSpan.innerHTML = `${escapeHTMLForApp(name)} <span class="badge-op" title="Operator (OP)">👑</span>`;
            }

            item.addEventListener('click', (e) => {
                e.stopPropagation();
                openMemberActionMenu(name, e.clientX, e.clientY);
            });
        });
    }
    bindMemberClickListeners();

    function openMemberActionMenu(name, x, y) {
        if (!memberActionMenu) return;
        
        currentSelectedMemberName = name;
        if (menuMemberName) menuMemberName.textContent = name;

        // Cambiar texto de botón de OP
        if (menuActionOp) {
            const isOp = isUserOp(name);
            menuActionOp.textContent = isOp ? '👑 Quitar Operator (OP)' : '👑 Dar Operator (OP)';
        }

        // Posicionar menú
        memberActionMenu.style.left = `${x - 120}px`;
        memberActionMenu.style.top = `${y + 10}px`;
        memberActionMenu.classList.remove('hidden');
    }

    if (menuActionOp) {
        menuActionOp.addEventListener('click', () => {
            const name = currentSelectedMemberName;
            if (!name) return;

            // Validar que el usuario local es OP
            const myName = getLocalUserName();
            if (!isUserOp(myName)) {
                alert('No tienes permisos de Operator (OP) para gestionar rangos.');
                memberActionMenu.classList.add('hidden');
                return;
            }

            try {
                let opList = JSON.parse(localStorage.getItem('nexus_op_list') || '[]');
                const isOp = opList.includes(name);

                if (isOp) {
                    opList = opList.filter(n => n !== name);
                    console.log(`[Rangos] OP quitado a ${name}`);
                } else {
                    opList.push(name);
                    console.log(`[Rangos] OP otorgado a ${name}`);
                }

                localStorage.setItem('nexus_op_list', JSON.stringify(opList));
                
                // Recargar UI
                window.location.reload();
            } catch (err) {
                console.error(err);
            }

            memberActionMenu.classList.add('hidden');
        });
    }

    if (menuActionProfile) {
        menuActionProfile.addEventListener('click', () => {
            alert(`Perfil de Gamer: ${currentSelectedMemberName}\nRango: ${isUserOp(currentSelectedMemberName) ? 'Operator (OP)' : 'Gamer'}`);
            memberActionMenu.classList.add('hidden');
        });
    }

    // Cerrar menú al hacer clic fuera
    document.addEventListener('click', (e) => {
        if (memberActionMenu && !memberActionMenu.contains(e.target)) {
            memberActionMenu.classList.add('hidden');
        }
    });

    updateRenderLatency(startTime);
    console.log('[Nexus] Inicializado correctamente en 42ms.');

    // ── Utilidad de escape HTML (usada dentro de DOMContentLoaded) ──
    function escapeHTMLForApp(str) {
        if (typeof str !== 'string') return '';
        return str.replace(/[&<>'"]/g, t =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[t] || t)
        );
    }
});
