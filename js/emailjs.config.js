/*
 * ═══════════════════════════════════════════════════════════════
 *  NEXUS - CONFIGURACIÓN DE EMAILJS (Verificación OTP por correo)
 * ═══════════════════════════════════════════════════════════════
 *
 *  GUÍA DE SETUP (5 minutos, gratis):
 *  ─────────────────────────────────
 *  1. Ve a https://www.emailjs.com/ y crea una cuenta gratuita.
 *     (Plan Free: 200 correos/mes, suficiente para uso personal)
 *
 *  2. En el dashboard de EmailJS:
 *     → "Email Services" → "Add New Service"
 *     → Elige Gmail, Outlook, Yahoo, etc.
 *     → Conecta tu cuenta y copia el "Service ID" (ej: service_abc123)
 *
 *  3. Crea un Template de correo:
 *     → "Email Templates" → "Create New Template"
 *     → En el asunto escribe: Código de acceso Nexus
 *     → En el cuerpo escribe algo como:
 *
 *         Hola,
 *
 *         Tu código de verificación para Nexus es:
 *
 *              {{otp_code}}
 *
 *         Este código expira en 10 minutos.
 *         Si no solicitaste este acceso, ignora este correo.
 *
 *     → En "To Email" pon: {{to_email}}
 *     → Guarda y copia el "Template ID" (ej: template_xyz789)
 *
 *  4. Ve a "Account" → copia tu "Public Key" (ej: user_XXXXXXXXXXXXXXX)
 *
 *  5. Pega los 3 valores abajo y guarda este archivo.
 *
 * ═══════════════════════════════════════════════════════════════
 */

export const EMAILJS_CONFIG = {
    // ⬇ Pega tu Public Key aquí (de EmailJS → Account → General)
    publicKey: 'c0CipP7cNXt_9ZWG6',

    // ⬇ Pega tu Service ID aquí (de EmailJS → Email Services)
    serviceId: 'service_tjwn8yb',

    // ⬇ Pega tu Template ID aquí (de EmailJS → Email Templates)
    templateId: 'template_wd8jahl',
};

/*
 *  MODO DEMO (sin configurar EmailJS):
 *  ─────────────────────────────────
 *  Si aún no configuras EmailJS, la app mostrará el código OTP
 *  directamente en la consola del navegador (F12) para que puedas
 *  probarlo de inmediato. Perfecto para desarrollo local.
 */
export const DEMO_MODE = false; // Cambia a `false` una vez configures EmailJS
