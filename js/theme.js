/* NEXUS THEME ENGINE - Gestión de temas y colores personalizados */

// ─────────────────────────────────────────────────────────────
// TEMAS PRESET
// Cada tema define las variables CSS que se inyectan en :root
// ─────────────────────────────────────────────────────────────
export const THEMES = {
    'nexus-dark': {
        name: 'Nexus Dark',
        icon: '🌑',
        vars: {
            '--bg-primary':          'hsl(230, 16%, 10%)',
            '--bg-secondary':        'hsl(230, 14%, 14%)',
            '--bg-tertiary':         'hsl(230, 15%, 8%)',
            '--bg-accent-glass':     'hsla(230, 14%, 16%, 0.6)',
            '--accent-purple':       'hsl(271, 91%, 65%)',
            '--accent-purple-glow':  'hsla(271, 91%, 65%, 0.35)',
            '--accent-cyan':         'hsl(186, 100%, 48%)',
            '--accent-cyan-glow':    'hsla(186, 100%, 48%, 0.35)',
            '--accent-green':        'hsl(142, 76%, 45%)',
            '--accent-orange':       'hsl(15, 95%, 55%)',
            '--accent-idle':         'hsl(38, 92%, 50%)',
            '--text-normal':         'hsl(220, 20%, 90%)',
            '--text-muted':          'hsl(220, 12%, 60%)',
            '--text-dark':           'hsl(220, 10%, 35%)',
            '--border-dark':         '1px solid hsl(230, 12%, 18%)',
        }
    },
    'nexus-light': {
        name: 'Nexus Light',
        icon: '☀️',
        vars: {
            '--bg-primary':          'hsl(220, 25%, 96%)',
            '--bg-secondary':        'hsl(220, 22%, 92%)',
            '--bg-tertiary':         'hsl(220, 20%, 88%)',
            '--bg-accent-glass':     'hsla(220, 22%, 90%, 0.8)',
            '--accent-purple':       'hsl(271, 70%, 50%)',
            '--accent-purple-glow':  'hsla(271, 70%, 50%, 0.25)',
            '--accent-cyan':         'hsl(200, 80%, 40%)',
            '--accent-cyan-glow':    'hsla(200, 80%, 40%, 0.25)',
            '--accent-green':        'hsl(142, 60%, 38%)',
            '--accent-orange':       'hsl(15, 85%, 48%)',
            '--accent-idle':         'hsl(38, 80%, 45%)',
            '--text-normal':         'hsl(220, 25%, 15%)',
            '--text-muted':          'hsl(220, 15%, 40%)',
            '--text-dark':           'hsl(220, 10%, 60%)',
            '--border-dark':         '1px solid hsl(220, 15%, 80%)',
        }
    },
    'ocean-blue': {
        name: 'Ocean Blue',
        icon: '🌊',
        vars: {
            '--bg-primary':          'hsl(210, 30%, 8%)',
            '--bg-secondary':        'hsl(210, 28%, 12%)',
            '--bg-tertiary':         'hsl(210, 30%, 6%)',
            '--bg-accent-glass':     'hsla(210, 28%, 14%, 0.7)',
            '--accent-purple':       'hsl(195, 95%, 55%)',
            '--accent-purple-glow':  'hsla(195, 95%, 55%, 0.35)',
            '--accent-cyan':         'hsl(170, 100%, 45%)',
            '--accent-cyan-glow':    'hsla(170, 100%, 45%, 0.35)',
            '--accent-green':        'hsl(150, 80%, 45%)',
            '--accent-orange':       'hsl(30, 90%, 55%)',
            '--accent-idle':         'hsl(45, 85%, 50%)',
            '--text-normal':         'hsl(200, 30%, 92%)',
            '--text-muted':          'hsl(200, 20%, 60%)',
            '--text-dark':           'hsl(200, 15%, 35%)',
            '--border-dark':         '1px solid hsl(210, 25%, 18%)',
        }
    },
    'sunset': {
        name: 'Sunset',
        icon: '🌅',
        vars: {
            '--bg-primary':          'hsl(15, 20%, 8%)',
            '--bg-secondary':        'hsl(15, 18%, 12%)',
            '--bg-tertiary':         'hsl(15, 20%, 6%)',
            '--bg-accent-glass':     'hsla(15, 18%, 14%, 0.7)',
            '--accent-purple':       'hsl(340, 85%, 60%)',
            '--accent-purple-glow':  'hsla(340, 85%, 60%, 0.35)',
            '--accent-cyan':         'hsl(30, 100%, 60%)',
            '--accent-cyan-glow':    'hsla(30, 100%, 60%, 0.35)',
            '--accent-green':        'hsl(45, 95%, 50%)',
            '--accent-orange':       'hsl(10, 95%, 58%)',
            '--accent-idle':         'hsl(50, 90%, 50%)',
            '--text-normal':         'hsl(30, 25%, 92%)',
            '--text-muted':          'hsl(20, 20%, 60%)',
            '--text-dark':           'hsl(15, 15%, 35%)',
            '--border-dark':         '1px solid hsl(20, 18%, 18%)',
        }
    },
    'forest': {
        name: 'Forest',
        icon: '🌿',
        vars: {
            '--bg-primary':          'hsl(130, 15%, 8%)',
            '--bg-secondary':        'hsl(130, 13%, 12%)',
            '--bg-tertiary':         'hsl(130, 15%, 6%)',
            '--bg-accent-glass':     'hsla(130, 13%, 14%, 0.7)',
            '--accent-purple':       'hsl(145, 70%, 48%)',
            '--accent-purple-glow':  'hsla(145, 70%, 48%, 0.35)',
            '--accent-cyan':         'hsl(90, 80%, 50%)',
            '--accent-cyan-glow':    'hsla(90, 80%, 50%, 0.35)',
            '--accent-green':        'hsl(145, 76%, 42%)',
            '--accent-orange':       'hsl(30, 85%, 50%)',
            '--accent-idle':         'hsl(60, 80%, 48%)',
            '--text-normal':         'hsl(120, 20%, 90%)',
            '--text-muted':          'hsl(120, 12%, 58%)',
            '--text-dark':           'hsl(120, 10%, 32%)',
            '--border-dark':         '1px solid hsl(130, 12%, 18%)',
        }
    }
};

const STORAGE_KEY = 'nexus_theme';
const CUSTOM_ACCENT1_KEY = 'nexus_custom_accent1';
const CUSTOM_ACCENT2_KEY = 'nexus_custom_accent2';

let currentThemeId = 'nexus-dark';

// ─────────────────────────────────────────────────────────────
// APLICAR TEMA AL DOM
// ─────────────────────────────────────────────────────────────
export function applyTheme(themeId, customAccent1 = null, customAccent2 = null) {
    const theme = THEMES[themeId];
    if (!theme) return;

    currentThemeId = themeId;
    const root = document.documentElement;

    // Aplicar todas las variables del tema
    Object.entries(theme.vars).forEach(([key, value]) => {
        root.style.setProperty(key, value);
    });

    // Aplicar colores personalizados si existen (sobreescriben el tema)
    if (customAccent1) {
        const { h, s, l } = hexToHSL(customAccent1);
        root.style.setProperty('--accent-purple', `hsl(${h}, ${s}%, ${l}%)`);
        root.style.setProperty('--accent-purple-glow', `hsla(${h}, ${s}%, ${l}%, 0.35)`);
    }
    if (customAccent2) {
        const { h, s, l } = hexToHSL(customAccent2);
        root.style.setProperty('--accent-cyan', `hsl(${h}, ${s}%, ${l}%)`);
        root.style.setProperty('--accent-cyan-glow', `hsla(${h}, ${s}%, ${l}%, 0.35)`);
    }

    // Clases especiales para tema claro
    if (themeId === 'nexus-light') {
        document.body.classList.add('theme-light');
    } else {
        document.body.classList.remove('theme-light');
    }

    // Persistir selección
    localStorage.setItem(STORAGE_KEY, themeId);
    if (customAccent1) localStorage.setItem(CUSTOM_ACCENT1_KEY, customAccent1);
    if (customAccent2) localStorage.setItem(CUSTOM_ACCENT2_KEY, customAccent2);

    // Actualizar estado activo en el panel
    updateThemeUIState(themeId);
}

// ─────────────────────────────────────────────────────────────
// RESTAURAR TEMA GUARDADO AL INICIAR
// ─────────────────────────────────────────────────────────────
export function restoreTheme() {
    const savedTheme   = localStorage.getItem(STORAGE_KEY) || 'nexus-dark';
    const savedAccent1 = localStorage.getItem(CUSTOM_ACCENT1_KEY);
    const savedAccent2 = localStorage.getItem(CUSTOM_ACCENT2_KEY);
    applyTheme(savedTheme, savedAccent1, savedAccent2);
    return { themeId: savedTheme, accent1: savedAccent1, accent2: savedAccent2 };
}

// ─────────────────────────────────────────────────────────────
// INICIALIZAR PANEL DE TEMAS
// ─────────────────────────────────────────────────────────────
export function initThemePanel() {
    const panel       = document.getElementById('theme-panel');
    const toggleBtn   = document.getElementById('theme-panel-toggle');
    const closeBtn    = document.getElementById('theme-panel-close');
    const themeCards  = document.querySelectorAll('.theme-preset-card');
    const accent1Picker = document.getElementById('custom-accent1');
    const accent2Picker = document.getElementById('custom-accent2');
    const resetBtn    = document.getElementById('theme-reset-btn');

    if (!panel) return;

    // Restaurar tema y actualizar pickers con los valores guardados
    const { themeId, accent1, accent2 } = restoreTheme();
    if (accent1Picker && accent1) accent1Picker.value = accent1;
    if (accent2Picker && accent2) accent2Picker.value = accent2;

    // Abrir / cerrar panel
    if (toggleBtn) {
        toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            panel.classList.toggle('open');
        });
    }
    if (closeBtn) {
        closeBtn.addEventListener('click', () => panel.classList.remove('open'));
    }

    // Cerrar al hacer clic afuera
    document.addEventListener('click', (e) => {
        if (panel && panel.classList.contains('open') && !panel.contains(e.target) && e.target.id !== 'theme-panel-toggle') {
            panel.classList.remove('open');
        }
    });

    // Tarjetas de preset
    themeCards.forEach(card => {
        card.addEventListener('click', () => {
            const tid = card.getAttribute('data-theme');
            const a1  = accent1Picker ? accent1Picker.value : null;
            const a2  = accent2Picker ? accent2Picker.value : null;
            applyTheme(tid, a1, a2);
        });
    });

    // Color pickers en tiempo real
    if (accent1Picker) {
        accent1Picker.addEventListener('input', () => {
            applyTheme(currentThemeId, accent1Picker.value, accent2Picker?.value);
        });
    }
    if (accent2Picker) {
        accent2Picker.addEventListener('input', () => {
            applyTheme(currentThemeId, accent1Picker?.value, accent2Picker.value);
        });
    }

    // Botón resetear colores personalizados
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            localStorage.removeItem(CUSTOM_ACCENT1_KEY);
            localStorage.removeItem(CUSTOM_ACCENT2_KEY);
            if (accent1Picker) accent1Picker.value = hslToHex(currentThemeId, 'purple');
            if (accent2Picker) accent2Picker.value = hslToHex(currentThemeId, 'cyan');
            applyTheme(currentThemeId, null, null);
        });
    }
}

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────
function updateThemeUIState(themeId) {
    document.querySelectorAll('.theme-preset-card').forEach(card => {
        if (card.getAttribute('data-theme') === themeId) {
            card.classList.add('active');
        } else {
            card.classList.remove('active');
        }
    });
}

// Convierte HEX a objeto HSL
function hexToHSL(hex) {
    let r = 0, g = 0, b = 0;
    if (hex.length === 4) {
        r = parseInt(hex[1] + hex[1], 16);
        g = parseInt(hex[2] + hex[2], 16);
        b = parseInt(hex[3] + hex[3], 16);
    } else if (hex.length === 7) {
        r = parseInt(hex.slice(1, 3), 16);
        g = parseInt(hex.slice(3, 5), 16);
        b = parseInt(hex.slice(5, 7), 16);
    }
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0, l = (max + min) / 2;
    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
            case g: h = ((b - r) / d + 2) / 6; break;
            case b: h = ((r - g) / d + 4) / 6; break;
        }
    }
    return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

// Retorna un hex de aproximación para pre-llenar el picker
function hslToHex(themeId, type) {
    const defaults = {
        'nexus-dark':  { purple: '#8b5cf6', cyan: '#00d4ff' },
        'nexus-light': { purple: '#7c3aed', cyan: '#0369a1' },
        'ocean-blue':  { purple: '#22d3ee', cyan: '#34d399' },
        'sunset':      { purple: '#f43f5e', cyan: '#fb923c' },
        'forest':      { purple: '#4ade80', cyan: '#a3e635' },
    };
    return defaults[themeId]?.[type] || '#8b5cf6';
}
