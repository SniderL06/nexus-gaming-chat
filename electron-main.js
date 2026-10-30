const { app, BrowserWindow, shell, session } = require('electron');
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
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const { desktopCapturer } = require('electron');
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
      // Seleccionar la pantalla principal o la primera fuente disponible
      if (sources.length > 0) {
        callback({ video: sources[0] });
      } else {
        callback({});
      }
    } catch (err) {
      console.warn('[Electron] Error capturando fuentes de pantalla:', err);
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
