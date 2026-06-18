/* NEXUS MAIN STATE COORDINATOR (ES MODULE) */

import { initChat, switchChatChannel } from './chat.js';
import { initVoice, disconnectVoiceChannel, joinVoiceChannel } from './voice.js';
import { initStream, toggleLocalStream } from './stream.js';
import { initThemePanel } from './theme.js';
import { EMAILJS_CONFIG, DEMO_MODE } from './emailjs.config.js';
import { initMusic } from './music.js';
import { isUserOp, isCurrentUserOp } from './voice.js';
import { initSupabaseSetup, supabase, supabaseReady, startGlobalPresence, stopGlobalPresence } from './supabase-client.js';
import { initCamera, stopCamera } from './camera.js';

// Estado global de la aplicación (Single Source of Truth)
export const state = {
    activeServer: 'nexus-default',
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
    
    // Elementos del panel de usuario y avatar (declarados al inicio para evitar Temporal Dead Zone)
    const userAvatarContainer = document.getElementById('user-avatar-container');
    const avatarUploadInput = document.getElementById('avatar-upload-input');
    const userAvatarLetter = document.getElementById('user-avatar-letter');

    // Inicializar sub-módulos
    initChat();
    initVoice();
    initStream();
    initCamera();
    initThemePanel();
    
    // Iniciar loop de rendimiento
    runPerformanceLoop();

    // Cargar servidores y canales iniciales
    loadAndRenderServers();
    loadAndRenderChannels();

    window.addEventListener('supabase-ready', () => {
        loadAndRenderServers();
        loadAndRenderChannels();
        subscribeToServersAndChannels();
    });

    // Abrir Ajustes & Temas al hacer clic en el nombre de usuario de la barra inferior
    const userInfo = document.querySelector('.user-panel .user-info');
    if (userInfo) {
        userInfo.addEventListener('click', () => {
            const panel = document.getElementById('theme-panel');
            const profileNameInput = document.getElementById('profile-display-name');
            if (panel) {
                panel.classList.add('open');
            }
            if (profileNameInput) {
                profileNameInput.focus();
                profileNameInput.select();
            }
        });
    }

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
        // Respaldo por si onsubmit="return false" bloquea el submit del formulario en algunos navegadores
        if (loginSendBtn) {
            loginSendBtn.addEventListener('click', (e) => {
                if (loginEmailInput.reportValidity()) {
                    e.preventDefault();
                    sendVerificationCode();
                }
            });
        }
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
        const profileNameInput = document.getElementById('profile-display-name');
        
        if (email) {
            const namePart = email.split('@')[0];
            const defaultName = namePart.charAt(0).toUpperCase() + namePart.slice(1);
            const savedName = localStorage.getItem('nexus_username_' + email) || defaultName;
            
            if (usernameSpan) usernameSpan.textContent = savedName;
            if (emailSpan) emailSpan.textContent = email;
            if (profileNameInput) profileNameInput.value = savedName;

            updateAvatarUI();

            // Actualizar el item local en la sidebar de miembros
            const sidebarName = document.getElementById('sidebar-local-name');
            if (sidebarName) sidebarName.textContent = savedName;

            // Iniciar presencia global para que todos vean quién está conectado
            if (supabaseReady && supabase) {
                startGlobalPresence(savedName);
            }
        }
    }

    // Si Supabase se conecta después de que el usuario ya estaba logueado
    window.addEventListener('supabase-ready', () => {
        const savedEmail = localStorage.getItem('nexus_user_email');
        if (savedEmail) {
            const namePart = savedEmail.split('@')[0];
            const defaultName = namePart.charAt(0).toUpperCase() + namePart.slice(1);
            const savedName = localStorage.getItem('nexus_username_' + savedEmail) || defaultName;
            startGlobalPresence(savedName);
        }
    });

    // --- CARGAR / ENLAZAR EL MOTOR DE MÚSICA EN VOZ ---
    initMusic();

    // --- CARGAR AVATAR PERSONALIZADO AL INICIAR CON CORTES ---
    
    // Modal de corte
    const cropModal = document.getElementById('avatar-crop-modal');
    const cropPreview = document.getElementById('avatar-crop-preview');
    const btnCircle = document.getElementById('crop-style-circle');
    const btnFull = document.getElementById('crop-style-full');
    const cropSaveBtn = document.getElementById('avatar-crop-save-btn');
    const cropCloseBtn = document.getElementById('avatar-crop-close-btn');
    const cropOverlay = document.getElementById('avatar-crop-overlay');

    let tempAvatarBase64 = null;
    const initialEmail = localStorage.getItem('nexus_user_email') || '';
    let selectedCropStyle = initialEmail ? (localStorage.getItem('nexus_user_avatar_style_' + initialEmail) || 'circle') : 'circle';

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

            const email = localStorage.getItem('nexus_user_email') || '';
            selectedCropStyle = email ? (localStorage.getItem('nexus_user_avatar_style_' + email) || 'circle') : 'circle';

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
                const email = localStorage.getItem('nexus_user_email') || '';
                if (email) {
                    localStorage.setItem('nexus_user_avatar_' + email, tempAvatarBase64);
                    localStorage.setItem('nexus_user_avatar_style_' + email, selectedCropStyle);
                }
                closeCropModal();
                updateAvatarUI();
                // Actualizar todos los avatares del usuario actual en el chat sin recargar
                updateAllChatAvatars(tempAvatarBase64, selectedCropStyle);

                // Volver a transmitir presencia global
                const savedName = email ? (localStorage.getItem('nexus_username_' + email) || email.split('@')[0].charAt(0).toUpperCase() + email.split('@')[0].slice(1)) : 'Usuario Nexus';
                if (supabaseReady && supabase) {
                    startGlobalPresence(savedName);
                }
                // Si está en sala de voz, actualizar la presencia en la sala de voz también
                if (state.activeVoiceChannel) {
                    import('./voice.js').then(({ presenceChannel, peer, getLocalUserName }) => {
                        if (presenceChannel && peer) {
                            const myName = getLocalUserName();
                            presenceChannel.track({
                                name: myName,
                                peerId: peer.id,
                                isMuted: state.isMuted,
                                avatar: tempAvatarBase64,
                                avatarStyle: selectedCropStyle,
                                joinedAt: Date.now()
                            }).catch(() => {});
                        }
                    });
                }
            }
        });
    }

    function updateAvatarUI() {
        const email = localStorage.getItem('nexus_user_email') || '';
        const savedAvatar = email ? localStorage.getItem('nexus_user_avatar_' + email) : null;
        const savedStyle = email ? (localStorage.getItem('nexus_user_avatar_style_' + email) || 'circle') : 'circle';
        const borderRadius = savedStyle === 'circle' ? '50%' : '10px';
        
        if (savedAvatar && userAvatarLetter) {
            userAvatarLetter.style.backgroundImage = `url(${savedAvatar})`;
            userAvatarLetter.style.backgroundSize = 'cover';
            userAvatarLetter.style.backgroundPosition = 'center';
            userAvatarLetter.style.backgroundRepeat = 'no-repeat';
            userAvatarLetter.textContent = ''; // Limpiar inicial
            userAvatarLetter.style.borderRadius = borderRadius;

            // Sincronizar el item local en la sidebar de miembros
            const sidebarAvatar = document.getElementById('sidebar-local-avatar');
            if (sidebarAvatar) {
                sidebarAvatar.style.backgroundImage = `url(${savedAvatar})`;
                sidebarAvatar.style.backgroundSize = 'cover';
                sidebarAvatar.style.backgroundPosition = 'center';
                sidebarAvatar.style.backgroundRepeat = 'no-repeat';
                sidebarAvatar.textContent = '';
                sidebarAvatar.style.borderRadius = borderRadius;
            }
        } else if (userAvatarLetter) {
            userAvatarLetter.style.backgroundImage = '';
            userAvatarLetter.style.borderRadius = '50%';
            const myName = email ? (localStorage.getItem('nexus_username_' + email) || email.split('@')[0].charAt(0).toUpperCase() + email.split('@')[0].slice(1)) : 'U';
            userAvatarLetter.textContent = myName.charAt(0).toUpperCase();

            const sidebarAvatar = document.getElementById('sidebar-local-avatar');
            if (sidebarAvatar) {
                sidebarAvatar.style.backgroundImage = '';
                sidebarAvatar.style.borderRadius = '50%';
                sidebarAvatar.textContent = myName.charAt(0).toUpperCase();
            }
        }
    }

    // Actualiza los avatares del chat en vivo sin recargar
    function updateAllChatAvatars(avatarDataUrl, style) {
        const borderRadius = style === 'circle' ? '50%' : '10px';
        const email = localStorage.getItem('nexus_user_email') || '';
        if (!email) return;
        const myName = localStorage.getItem('nexus_username_' + email) || (email.split('@')[0].charAt(0).toUpperCase() + email.split('@')[0].slice(1));
        
        // Buscar todos los avatares del usuario actual en los mensajes del chat
        document.querySelectorAll('.message-item').forEach(item => {
            const authorEl = item.querySelector('.message-author');
            if (authorEl && authorEl.textContent.trim().startsWith(myName)) {
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

    // Vincular botón para guardar perfil (nombre de usuario)
    const saveProfileBtn = document.getElementById('save-profile-btn');
    const profileNameInput = document.getElementById('profile-display-name');
    if (saveProfileBtn && profileNameInput) {
        saveProfileBtn.addEventListener('click', () => {
            const email = localStorage.getItem('nexus_user_email') || '';
            if (!email) {
                alert('Debes iniciar sesión para cambiar tu nombre.');
                return;
            }
            const newName = profileNameInput.value.trim();
            if (!newName) {
                alert('El nombre de usuario no puede estar vacío.');
                return;
            }
            if (newName.length > 25) {
                alert('El nombre de usuario no puede tener más de 25 caracteres.');
                return;
            }
            
            // Guardar
            localStorage.setItem('nexus_username_' + email, newName);
            
            // Actualizar interfaz local
            updateUserProfileUI(email);

            // Retransmitir presencia global con el nuevo nombre
            if (supabaseReady && supabase) {
                startGlobalPresence(newName);
            }

            // Si está en sala de voz, actualizar la presencia en la sala de voz también
            if (state.activeVoiceChannel) {
                import('./voice.js').then(({ presenceChannel, peer }) => {
                    if (presenceChannel && peer) {
                        const savedAvatar = localStorage.getItem('nexus_user_avatar_' + email) || '';
                        const savedStyle = localStorage.getItem('nexus_user_avatar_style_' + email) || 'circle';
                        
                        presenceChannel.track({
                            name: newName,
                            peerId: peer.id,
                            isMuted: state.isMuted,
                            avatar: savedAvatar,
                            avatarStyle: savedStyle,
                            joinedAt: Date.now()
                        }).catch(() => {});
                    }
                });
            }

            // Notificación visual de guardado exitoso
            saveProfileBtn.textContent = '✅ Perfil Guardado';
            saveProfileBtn.style.background = 'var(--accent-green)';
            setTimeout(() => {
                saveProfileBtn.textContent = '💾 Guardar Perfil';
                saveProfileBtn.style.background = '';
            }, 2000);
        });
    }

    updateAvatarUI(); // Invocar de inmediato
    applyCropStyleUI(selectedCropStyle); // Inicializar estado visual de botones

    // Cargar y Renderizar Servidores
    async function loadAndRenderServers() {
        const serversList = document.getElementById('servers-list');
        if (!serversList) return;

        let servers = [];
        let loadedFromSupabase = false;

        if (supabaseReady && supabase) {
            try {
                const { data, error } = await supabase.from('servers').select('*').order('created_at', { ascending: true });
                if (!error && data) {
                    servers = data;
                    loadedFromSupabase = true;

                    // Sincronizar servidores locales que falten en la base de datos (Auto-migración)
                    const localServers = JSON.parse(localStorage.getItem('nexus_servers') || '[]');
                    for (const localS of localServers) {
                        if (!servers.some(s => s.id === localS.id)) {
                            console.log(`[Auto-Sync] Sincronizando servidor local a Supabase: ${localS.name}`);
                            await supabase.from('servers').insert({ id: localS.id, name: localS.name, icon: localS.icon });
                            servers.push(localS);
                        }
                    }
                } else if (error) {
                    console.error('[Servidores] Error de Supabase:', error.message);
                }
            } catch (err) {
                console.warn('[Servidores] Error leyendo de Supabase, usando local:', err);
            }
        }

        // Si no hay Supabase o falló la consulta, usar localStorage
        if (!loadedFromSupabase) {
            try {
                servers = JSON.parse(localStorage.getItem('nexus_servers') || '[]');
            } catch {}
            
            // Si está vacío, inicializar con el servidor predeterminado
            if (servers.length === 0) {
                servers = [{ id: 'nexus-default', name: 'Nexus Global', icon: '🌌' }];
                localStorage.setItem('nexus_servers', JSON.stringify(servers));
            }
        }

        serversList.innerHTML = '';

        servers.forEach(server => {
            const isActive = state.activeServer === server.id;
            
            const wrapper = document.createElement('div');
            wrapper.className = `server-item-wrapper ${isActive ? 'active' : ''}`;
            wrapper.setAttribute('data-server-id', server.id);
            wrapper.id = `server-item-${server.id}`;

            const deleteBtnHtml = server.id !== 'nexus-default' ? `
                <button class="delete-server-btn" title="Eliminar Servidor" data-server-id="${server.id}">✕</button>
            ` : '';

            wrapper.innerHTML = `
                <div class="server-pill"></div>
                <button class="server-btn" title="${escapeHTMLForApp(server.name)}">${escapeHTMLForApp(server.icon)}</button>
                ${deleteBtnHtml}
            `;

            serversList.appendChild(wrapper);
        });

        bindServerItemClicks();
        bindDeleteServerClicks();
    }

    function bindServerItemClicks() {
        document.querySelectorAll('.server-item-wrapper').forEach(item => {
            item.addEventListener('click', (e) => {
                if (e.target.closest('.delete-server-btn')) return;

                const serverId = item.getAttribute('data-server-id');
                if (state.activeServer === serverId) return;

                document.querySelectorAll('.server-item-wrapper').forEach(el => el.classList.remove('active'));
                item.classList.add('active');

                state.activeServer = serverId;
                console.log(`[Servidores] Cambiado al servidor: ${serverId}`);

                // Desconectar voz del canal anterior al cambiar de servidor
                disconnectVoiceChannel();

                // Cargar canales del nuevo servidor
                loadAndRenderChannels();
            });
        });
    }

    function bindDeleteServerClicks() {
        document.querySelectorAll('.delete-server-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();

                if (!isCurrentUserOp()) {
                    alert('No tienes rango de Operator (OP) para eliminar servidores.');
                    return;
                }

                const serverId = btn.getAttribute('data-server-id');
                const serverWrapper = btn.closest('.server-item-wrapper');
                const serverNameBtn = serverWrapper.querySelector('.server-btn');
                const serverName = serverNameBtn.title;

                if (confirm(`¿Estás seguro de eliminar el servidor "${serverName}" y todos sus canales?`)) {
                    if (state.activeServer === serverId) {
                        state.activeServer = 'nexus-default';
                    }

                    // Eliminar localmente
                    const localServers = JSON.parse(localStorage.getItem('nexus_servers') || '[]');
                    const filteredServers = localServers.filter(s => s.id !== serverId);
                    localStorage.setItem('nexus_servers', JSON.stringify(filteredServers));

                    const localChannels = JSON.parse(localStorage.getItem('nexus_local_channels') || '[]');
                    const filteredChannels = localChannels.filter(ch => ch.server_id !== serverId);
                    localStorage.setItem('nexus_local_channels', JSON.stringify(filteredChannels));

                    // Eliminar de Supabase
                    if (supabaseReady && supabase) {
                        try {
                            await supabase.from('channels').delete().eq('server_id', serverId);
                            await supabase.from('servers').delete().eq('id', serverId);
                            console.log('[Supabase] Servidor eliminado.');
                        } catch (err) {
                            console.error('[Supabase] Error al eliminar servidor:', err.message);
                        }
                    }

                    await loadAndRenderServers();
                    await loadAndRenderChannels();
                }
            });
        });
    }

    // Cargar y Renderizar Canales (Supabase o Local)
    async function loadAndRenderChannels() {
        const textList = document.getElementById('text-channels');
        const voiceList = document.getElementById('voice-channels');
        if (!textList || !voiceList) return;

        let channels = [];
        let loadedFromSupabase = false;

        if (supabaseReady && supabase) {
            try {
                const { data, error } = await supabase.from('channels').select('*').order('created_at', { ascending: true });
                if (!error && data) {
                    let dbChannels = data;
                    loadedFromSupabase = true;

                    // Sincronizar canales locales que falten en la base de datos (Auto-migración)
                    const localChannels = JSON.parse(localStorage.getItem('nexus_local_channels') || '[]');
                    for (const localCh of localChannels) {
                        if (!dbChannels.some(ch => ch.id === localCh.id)) {
                            console.log(`[Auto-Sync] Sincronizando canal local a Supabase: ${localCh.name}`);
                            await supabase.from('channels').insert({
                                id: localCh.id,
                                name: localCh.name,
                                type: localCh.type,
                                server_id: localCh.server_id
                            });
                            dbChannels.push(localCh);
                        }
                    }

                    // Filtrar por servidor activo
                    channels = dbChannels.filter(ch => {
                        const sId = ch.server_id || 'nexus-default';
                        return sId === state.activeServer;
                    });
                } else if (error) {
                    console.error('[Canales] Error de Supabase:', error.message);
                }
            } catch (err) {
                console.warn('[Canales] Error leyendo de Supabase, usando local:', err);
            }
        }

        // Si no hay Supabase o falló la consulta, usar localStorage
        if (!loadedFromSupabase) {
            let localCh = [];
            try {
                localCh = JSON.parse(localStorage.getItem('nexus_local_channels') || '[]');
            } catch {}
            
            // Si está vacío, inicializar con los canales predeterminados
            if (localCh.length === 0) {
                localCh = [
                    { id: 'general', name: 'general', type: 'text', server_id: 'nexus-default' },
                    { id: 'lounge', name: 'lounge', type: 'text', server_id: 'nexus-default' },
                    { id: 'clips-and-memes', name: 'clips-and-memes', type: 'text', server_id: 'nexus-default' },
                    { id: 'estrategia', name: 'estrategia', type: 'text', server_id: 'nexus-default' },
                    { id: 'general-voice', name: 'General Voice', type: 'voice', server_id: 'nexus-default' },
                    { id: 'squad-1', name: 'Squad Alpha', type: 'voice', server_id: 'nexus-default' },
                    { id: 'squad-2', name: 'Duo Queue', type: 'voice', server_id: 'nexus-default' }
                ];
                localStorage.setItem('nexus_local_channels', JSON.stringify(localCh));
            }

            channels = localCh.filter(ch => {
                const sId = ch.server_id || 'nexus-default';
                return sId === state.activeServer;
            });
        }

        // Limpiar listas en la UI
        textList.innerHTML = '';
        voiceList.innerHTML = '';

        channels.forEach(ch => {
            const li = document.createElement('li');
            li.className = 'channel-item';
            li.setAttribute('data-channel', ch.id);
            li.setAttribute('data-type', ch.type);

            if (ch.type === 'text') {
                li.innerHTML = `
                    <span class="channel-icon">#</span>
                    <span class="channel-name">${escapeHTMLForApp(ch.name.toLowerCase())}</span>
                    <button class="delete-channel-btn" title="Eliminar Canal">🗑️</button>
                `;
            } else if (ch.type === 'voice') {
                li.innerHTML = `
                    <svg class="channel-svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
                    <span class="channel-name">${escapeHTMLForApp(ch.name)}</span>
                    <span class="active-count" id="voice-count-${ch.id}">0</span>
                    <button class="delete-channel-btn" title="Eliminar Sala">🗑️</button>
                `;
            }

            bindChannelItemClick(li);
            
            if (ch.type === 'text') {
                textList.appendChild(li);
            } else {
                voiceList.appendChild(li);
            }
        });

        // Seleccionar automáticamente el primer canal de texto del servidor si el canal activo no es del servidor o no existe
        const activeExists = channels.find(ch => ch.id === state.activeChannel && ch.type === 'text');
        if (!activeExists) {
            const firstText = channels.find(ch => ch.type === 'text');
            if (firstText) {
                const itemEl = textList.querySelector(`.channel-item[data-channel="${firstText.id}"]`);
                if (itemEl) {
                    itemEl.classList.add('active');
                    state.activeChannel = firstText.id;
                    switchChatChannel(firstText.id, firstText.name);
                }
            } else {
                state.activeChannel = '';
                const titleEl = document.getElementById('active-channel-title');
                if (titleEl) titleEl.textContent = 'Ninguno';
                const chatArea = document.getElementById('chat-messages-container');
                if (chatArea) chatArea.innerHTML = '';
            }
        } else {
            const itemEl = textList.querySelector(`.channel-item[data-channel="${state.activeChannel}"]`);
            if (itemEl) itemEl.classList.add('active');
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
        const customName = localStorage.getItem('nexus_username_' + email);
        if (customName) return customName;
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
            if (channelCreateError) channelCreateError.classList.add('hidden');
            
            // Validar si el usuario es OP
            if (!isCurrentUserOp()) {
                if (channelCreateError) {
                    channelCreateError.textContent = 'No tienes rango de Operator (OP) para crear canales.';
                    channelCreateError.classList.remove('hidden');
                }
                return;
            }

            const name = newChannelNameInput.value.trim();
            if (!name) return;

            const channelId = `${state.activeServer}-${name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')}`;

            // Guardar en localStorage
            const localChannels = JSON.parse(localStorage.getItem('nexus_local_channels') || '[]');
            if (!localChannels.some(ch => ch.id === channelId && ch.server_id === state.activeServer)) {
                localChannels.push({
                    id: channelId,
                    name: name,
                    type: currentAddingChannelType,
                    server_id: state.activeServer
                });
                localStorage.setItem('nexus_local_channels', JSON.stringify(localChannels));
            }

            // Persistir canal en Supabase si está disponible
            if (supabaseReady && supabase) {
                supabase.from('channels').insert({
                    id: channelId,
                    name: name,
                    type: currentAddingChannelType,
                    server_id: state.activeServer
                }).then(({ error }) => {
                    if (error) {
                        console.error('[Supabase] Error al crear canal:', error.message);
                        if (channelCreateError) {
                            channelCreateError.textContent = `Error en base de datos: ${error.message}`;
                            channelCreateError.classList.remove('hidden');
                        }
                    } else {
                        console.log('[Supabase] Canal creado en base de datos.');
                        loadAndRenderChannels(); // Sincronizar
                        closeChannelModal();
                    }
                });
            } else {
                loadAndRenderChannels(); // Sincronizar local
                closeChannelModal();
            }
        });
    }

    function bindChannelItemClick(item) {
        item.addEventListener('click', (e) => {
            if (e.target.closest('.delete-channel-btn')) return;

            const channelId = item.getAttribute('data-channel');
            const type = item.getAttribute('data-type');
            
            if (type === 'text') {
                document.querySelectorAll('.channel-item[data-type="text"]').forEach(el => el.classList.remove('active'));
                item.classList.add('active');
                state.activeChannel = channelId;
                const channelName = item.querySelector('.channel-name')?.textContent || channelId;
                switchChatChannel(channelId, channelName);
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
            
            if (!isCurrentUserOp()) {
                alert('No tienes rango de Operator (OP) para eliminar canales.');
                return;
            }

            const channelName = item.querySelector('.channel-name').textContent;
            if (confirm(`¿Estás seguro de eliminar el canal #${channelName}?`)) {
                const channelId = item.getAttribute('data-channel');
                if (state.activeVoiceChannel === channelId) {
                    disconnectVoiceChannel();
                }
                
                // Eliminar de localStorage
                const localChannels = JSON.parse(localStorage.getItem('nexus_local_channels') || '[]');
                const filteredChannels = localChannels.filter(ch => !(ch.id === channelId && ch.server_id === state.activeServer));
                localStorage.setItem('nexus_local_channels', JSON.stringify(filteredChannels));
                
                item.remove();
                console.log(`[Canales] Canal ${channelId} eliminado.`);

                // Eliminar de Supabase si está disponible
                if (supabaseReady && supabase) {
                    supabase.from('channels').delete().eq('id', channelId).then(({ error }) => {
                        if (error) {
                            console.error('[Supabase] Error al eliminar canal:', error.message);
                        } else {
                            console.log('[Supabase] Canal eliminado de base de datos.');
                            loadAndRenderChannels(); // Sincronizar
                        }
                    });
                } else {
                    loadAndRenderChannels();
                }
            }
        });
    }

    // --- GESTIÓN DE SERVIDORES ---
    const addServerBtn = document.getElementById('add-server-btn');
    const serverModal = document.getElementById('server-modal');
    const serverModalOverlay = document.getElementById('server-modal-overlay');
    const serverModalCloseBtn = document.getElementById('server-modal-close-btn');
    const createServerForm = document.getElementById('create-server-form');
    const newServerNameInput = document.getElementById('new-server-name');
    const newServerIconInput = document.getElementById('new-server-icon');

    if (addServerBtn) {
        addServerBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (newServerNameInput) newServerNameInput.value = '';
            if (newServerIconInput) newServerIconInput.value = '';
            if (serverModal) serverModal.classList.remove('hidden');
        });
    }

    const closeServerModal = () => serverModal && serverModal.classList.add('hidden');
    if (serverModalCloseBtn) serverModalCloseBtn.addEventListener('click', closeServerModal);
    if (serverModalOverlay) serverModalOverlay.addEventListener('click', closeServerModal);

    if (createServerForm) {
        createServerForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const serverError = document.getElementById('server-create-error');
            if (serverError) serverError.classList.add('hidden');

            if (!isCurrentUserOp()) {
                if (serverError) {
                    serverError.textContent = 'No tienes rango de Operator (OP) para crear servidores.';
                    serverError.classList.remove('hidden');
                }
                return;
            }

            const name = newServerNameInput.value.trim();
            if (!name) return;

            let icon = newServerIconInput.value.trim();
            if (!icon) {
                // Usar inicial
                icon = name.charAt(0).toUpperCase();
            }

            const serverId = 'server-' + Date.now();

            // Guardar en Supabase primero (para validar RLS y FK)
            if (supabaseReady && supabase) {
                try {
                    // Insertar servidor
                    const { error: serverErr } = await supabase.from('servers').insert({ id: serverId, name, icon });
                    if (serverErr) {
                        console.error('[Supabase] Error al crear nuevo servidor:', serverErr.message);
                        if (serverError) {
                            serverError.textContent = `Error al crear servidor: ${serverErr.message}`;
                            serverError.classList.remove('hidden');
                        }
                        return;
                    }

                    // Insertar canales por defecto en Supabase
                    const { error: channelsErr } = await supabase.from('channels').insert([
                        { id: `${serverId}-general`, name: 'general', type: 'text', server_id: serverId },
                        { id: `${serverId}-general-voice`, name: 'General Voice', type: 'voice', server_id: serverId }
                    ]);
                    if (channelsErr) {
                        console.error('[Supabase] Error al crear canales por defecto:', channelsErr.message);
                        if (serverError) {
                            serverError.textContent = `Error al crear canales: ${channelsErr.message}`;
                            serverError.classList.remove('hidden');
                        }
                        return;
                    }
                } catch (dbErr) {
                    console.error('[Supabase] Error de red al crear servidor/canales:', dbErr);
                    if (serverError) {
                        serverError.textContent = `Error de conexión con la base de datos (Failed to fetch). Revisa si el proyecto de Supabase está activo.`;
                        serverError.classList.remove('hidden');
                    }
                    return;
                }
            }

            // Guardar localmente tras éxito en DB
            const localServers = JSON.parse(localStorage.getItem('nexus_servers') || '[]');
            localServers.push({ id: serverId, name, icon });
            localStorage.setItem('nexus_servers', JSON.stringify(localServers));

            const localChannels = JSON.parse(localStorage.getItem('nexus_local_channels') || '[]');
            localChannels.push({ id: `${serverId}-general`, name: 'general', type: 'text', server_id: serverId });
            localChannels.push({ id: `${serverId}-general-voice`, name: 'General Voice', type: 'voice', server_id: serverId });
            localStorage.setItem('nexus_local_channels', JSON.stringify(localChannels));

            closeServerModal();

            // Renderizar servidores y activar el nuevo
            await loadAndRenderServers();
            
            // Activar el nuevo servidor
            const newServerItem = document.querySelector(`.server-item-wrapper[data-server-id="${serverId}"]`);
            if (newServerItem) {
                newServerItem.click();
            }
        });
    }

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
            if (!isCurrentUserOp()) {
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

    // Inicializar Supabase al final para que todos los listeners registrados reciban el evento 'supabase-ready'
    initSupabaseSetup();

    updateRenderLatency(startTime);
    console.log('[Nexus] Inicializado correctamente en 42ms.');

    let serversRealtimeChannel = null;
    let channelsRealtimeChannel = null;

    function subscribeToServersAndChannels() {
        if (!supabaseReady || !supabase) return;

        if (serversRealtimeChannel) {
            supabase.removeChannel(serversRealtimeChannel);
        }
        if (channelsRealtimeChannel) {
            supabase.removeChannel(channelsRealtimeChannel);
        }

        console.log('[Realtime] Suscribiéndose a cambios de servidores y canales...');

        serversRealtimeChannel = supabase
            .channel('realtime:servers')
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'servers'
            }, async (payload) => {
                console.log('[Realtime Servers] Cambio detectado:', payload.eventType);
                await loadAndRenderServers();
                // Si el servidor activo actual fue eliminado, volver al default
                if (payload.eventType === 'DELETE' && state.activeServer === payload.old.id) {
                    state.activeServer = 'nexus-default';
                    // Activar visualmente el servidor default
                    const defServerItem = document.querySelector(`.server-item-wrapper[data-server-id="nexus-default"]`);
                    if (defServerItem) {
                        document.querySelectorAll('.server-item-wrapper').forEach(el => el.classList.remove('active'));
                        defServerItem.classList.add('active');
                    }
                    loadAndRenderChannels();
                }
            })
            .subscribe();

        channelsRealtimeChannel = supabase
            .channel('realtime:channels')
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'channels'
            }, async (payload) => {
                console.log('[Realtime Channels] Cambio detectado:', payload.eventType);
                await loadAndRenderChannels();
            })
            .subscribe();
    }

    // ── Utilidad de escape HTML (usada dentro de DOMContentLoaded) ──
    function escapeHTMLForApp(str) {
        if (typeof str !== 'string') return '';
        return str.replace(/[&<>'"]/g, t =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[t] || t)
        );
    }
});
