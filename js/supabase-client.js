/* NEXUS SUPABASE CLIENT MODULE (ES MODULE) */

export let supabase = null;
export let supabaseUrl = localStorage.getItem('nexus_supabase_url') || '';
export let supabaseKey = localStorage.getItem('nexus_supabase_key') || '';
export let supabaseReady = false;

// Inicializar cliente si existen las credenciales
function tryInitClient(url, key) {
    if (url && key && window.supabase) {
        try {
            const client = window.supabase.createClient(url, key, {
                realtime: {
                    params: { eventsPerSecond: 10 }
                }
            });
            supabase = client;
            supabaseReady = true;
            console.log('[Supabase] Cliente inicializado correctamente.');
            // Actualizar indicador de estado en UI (si ya cargó el DOM)
            setTimeout(updateStatusIndicator, 500);
            return true;
        } catch (e) {
            console.error('[Supabase] Error al inicializar cliente:', e);
            return false;
        }
    }
    return false;
}

// Intentar inicialización al cargar
tryInitClient(supabaseUrl, supabaseKey);

export function initSupabaseSetup() {
    const modal = document.getElementById('database-setup-modal');
    const form = document.getElementById('database-setup-form');
    const urlInput = document.getElementById('db-supabase-url');
    const keyInput = document.getElementById('db-supabase-key');
    const openBtn = document.getElementById('open-db-config-btn');
    const overlay = document.getElementById('database-setup-overlay');
    const saveBtn = document.getElementById('db-setup-save-btn');

    // Botón de configuración en ajustes
    if (openBtn) {
        openBtn.addEventListener('click', () => {
            if (urlInput) urlInput.value = localStorage.getItem('nexus_supabase_url') || '';
            if (keyInput) keyInput.value = localStorage.getItem('nexus_supabase_key') || '';
            if (modal) modal.classList.remove('hidden');
        });
    }

    // Botón "Usar sin BD" – modo local
    const skipBtn = document.getElementById('db-skip-btn');
    if (skipBtn) {
        skipBtn.addEventListener('click', () => {
            if (modal) modal.classList.add('hidden');
            localStorage.setItem('nexus_supabase_skipped', '1');
        });
    }

    // Cerrar al hacer clic fuera (solo si ya está conectado o se saltó)
    if (overlay) {
        overlay.addEventListener('click', () => {
            if (supabaseReady || localStorage.getItem('nexus_supabase_skipped')) {
                if (modal) modal.classList.add('hidden');
            }
        });
    }

    // Formulario de configuración
    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const urlVal = urlInput?.value.trim();
            const keyVal = keyInput?.value.trim();

            if (!urlVal || !keyVal) {
                alert('Por favor introduce la URL y la Anon Key de tu proyecto Supabase.');
                return;
            }

            if (saveBtn) {
                saveBtn.disabled = true;
                saveBtn.textContent = 'Conectando...';
            }

            try {
                // Verificar conexión real haciendo una consulta sencilla
                const testClient = window.supabase.createClient(urlVal, keyVal);
                const { error } = await testClient.from('channels').select('id').limit(1);

                if (error && error.code !== 'PGRST116') {
                    // PGRST116 = tabla no existe aún, lo cual también es válido
                    throw new Error(error.message);
                }

                localStorage.setItem('nexus_supabase_url', urlVal);
                localStorage.setItem('nexus_supabase_key', keyVal);
                supabaseUrl = urlVal;
                supabaseKey = keyVal;
                supabase = testClient;
                supabaseReady = true;

                if (modal) modal.classList.add('hidden');
                showConnectionSuccess();

                // Disparar evento global para que los módulos se reconecten
                window.dispatchEvent(new CustomEvent('supabase-ready', { detail: { client: supabase } }));

            } catch (err) {
                console.error('[Supabase] Error al conectar:', err);
                alert(`Error al conectar con Supabase: ${err.message}\n\nVerifica que la URL y la Anon Key sean correctas.`);
            } finally {
                if (saveBtn) {
                    saveBtn.disabled = false;
                    saveBtn.textContent = '✅ Guardar y Conectar';
                }
            }
        });
    }

    // Mostrar el modal automáticamente si no está configurado ni se saltó
    if (!supabaseReady && !localStorage.getItem('nexus_supabase_skipped')) {
        setTimeout(() => {
            if (modal) modal.classList.remove('hidden');
        }, 1200);
    }
}

function showConnectionSuccess() {
    // Update status dot in settings panel
    updateStatusIndicator();

    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed; bottom: 24px; right: 24px; z-index: 100001;
        background: linear-gradient(135deg, #0a1628 0%, #0d1f3c 100%);
        border: 1px solid #00d4ff; border-radius: 12px;
        padding: 16px 24px; box-shadow: 0 0 30px rgba(0,212,255,0.3);
        animation: fadeInUp 0.4s ease; color: #c9d1d9; font-family: 'Inter', sans-serif;
    `;
    notification.innerHTML = `
        <div style="font-weight: 700; color: #00d4ff; font-size: 0.85rem; margin-bottom: 4px; font-family: 'Orbitron', monospace;">⚡ NEXUS CONECTADO</div>
        <div style="font-size: 0.78rem;">Supabase activo – mensajes en tiempo real habilitados</div>
    `;
    document.body.appendChild(notification);
    setTimeout(() => {
        notification.style.animation = 'fadeInUp 0.4s ease reverse';
        setTimeout(() => notification.remove(), 400);
    }, 4000);
}

function updateStatusIndicator() {
    const dot = document.getElementById('supabase-status-dot');
    const text = document.getElementById('supabase-status-text');
    if (dot && text) {
        if (supabaseReady && supabase) {
            dot.style.background = '#22c55e';
            dot.style.boxShadow = '0 0 6px rgba(34,197,94,0.6)';
            text.textContent = 'Supabase conectado – tiempo real activo';
            text.style.color = '#22c55e';
        } else {
            dot.style.background = '#ef4444';
            dot.style.boxShadow = 'none';
            text.textContent = 'Sin conexión a base de datos';
            text.style.color = '';
        }
    }
}
