const { app, BrowserWindow, shell, session, desktopCapturer } = require('electron');
const path = require('path');

// ═════════════════════════════════════════════════════════════════════════════
// OPTIMIZACIONES EXTREMAS DE MEMORIA RAM Y CPU PARA NEXUS GAMING CLIENT
// ═════════════════════════════════════════════════════════════════════════════
app.commandLine.appendSwitch('disable-renderer-backgrounding'); // Mantiene audio WebRTC fluido sin dormir hilos de voz
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=128'); // Limita el heap de JS a 128 MB (en vez de 4GB que usa Electron estándar)
app.commandLine.appendSwitch('disable-extensions'); // Sin extensiones pesadas de Chrome
app.commandLine.appendSwitch('disable-component-update');
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-breakpad'); // Sin telemetría ni crash reporter de Google
app.commandLine.appendSwitch('enable-gpu-rasterization'); // Rendimiento GPU fluido en juegos
app.commandLine.appendSwitch('enable-zero-copy');

// ─── CAPTURA DE PANTALLA (Screen Share) ──────────────────────────────────────
// Habilitar capturador PipeWire para Wayland (Linux moderno)
app.commandLine.appendSwitch('enable-features', 'WebRTCPipeWireCapturer');
// Permitir getDisplayMedia sin gesto de usuario (necesario para UI de Nexus)
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 780,
    minWidth: 800,
    minHeight: 600,
    title: 'Nexus',
    backgroundColor: '#0d0d1a',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false, // Permite cargar CDNs y anuncios sin bloqueo de CORS
      allowRunningInsecureContent: true,
      autoplayPolicy: 'no-user-gesture-required',
      backgroundThrottling: false // No congela canales de voz en segundo plano mientras juegas
    },
    icon: path.join(__dirname, 'assets/icons/icon-192.png')
  });

  // Simular cabeceras de navegador (Origin y Referer) para EmailJS, anuncios y APIs
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    details.requestHeaders['Origin'] = 'https://nexus-gaming-chat.vercel.app';
    details.requestHeaders['Referer'] = 'https://nexus-gaming-chat.vercel.app/';
    callback({ cancel: false, requestHeaders: details.requestHeaders });
  });

  // Conceder automáticamente permisos de micrófono, cámara, audio y notificaciones
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowedPermissions = ['media', 'notifications', 'audioCapture', 'videoCapture', 'screen', 'display-capture'];
    if (allowedPermissions.includes(permission)) {
      return callback(true);
    }
    callback(false);
  });

  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    const allowedPermissions = ['media', 'notifications', 'audioCapture', 'videoCapture', 'screen', 'display-capture'];
    return allowedPermissions.includes(permission);
  });

  // Permitir captura de pantalla en getDisplayMedia (Electron)
  // IMPORTANTE: El handler debe existir ANTES de que se llame getDisplayMedia desde el renderer.
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      // thumbnailSize: 0x0 = no genera thumbnails, ahorra RAM (no los necesitamos aquí)
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 0, height: 0 }
      });

      if (sources && sources.length > 0) {
        // Preferir la pantalla principal (id comienza con 'screen:0:') o la primera disponible
        const mainScreen = sources.find(s => s.id === 'screen:0:0' || s.id.startsWith('screen:0:')) || sources[0];
        console.log(`[Electron] Fuente de pantalla seleccionada: ${mainScreen.name} (${mainScreen.id})`);
        callback({ video: mainScreen, audio: 'loopback' });
      } else {
        console.warn('[Electron] No se encontraron fuentes de pantalla disponibles.');
        callback({});
      }
    } catch (err) {
      console.warn('[Electron] Error al capturar fuentes de pantalla:', err.message || err);
      callback({});
    }
  });

  // Abrir enlaces externos en el navegador predeterminado del sistema
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});
