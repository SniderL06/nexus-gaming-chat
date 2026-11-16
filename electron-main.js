const { app, BrowserWindow, shell, session, desktopCapturer, ipcMain } = require('electron');
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

// ─── CAPTURA DE PANTALLA Y AUDIO DEL SISTEMA ────────────────────────────────
// Habilitar capturador PipeWire para Wayland (Linux moderno) y captura de audio del sistema
app.commandLine.appendSwitch('enable-features', 'WebRTCPipeWireCapturer,PulseaudioLoopbackAudioForScreenShare');
app.commandLine.appendSwitch('auto-select-desktop-capture-source', 'Entire screen');
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
      preload: path.join(__dirname, 'electron-preload.js'), // Bridge IPC seguro
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
  // useSystemPicker: true → Electron 28+ muestra el selector nativo del SO (Linux XDG, Windows SystemPickerDialog)
  // Si el SO no soporta el selector nativo, se muestra el picker propio de Electron con miniaturas
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 300, height: 180 }
      });

      if (!sources || sources.length === 0) {
        console.warn('[Electron] No se encontraron fuentes de pantalla.');
        callback({});
        return;
      }

      // Enviar la lista de fuentes al renderer para que el usuario elija en la UI de Nexus
      mainWindow.webContents.send('display-sources', sources.map(s => ({
        id:        s.id,
        name:      s.name,
        thumbnail: s.thumbnail.toDataURL()
      })));

      // Esperar la respuesta del renderer (el usuario elige la fuente en el modal)
      const chosenId = await new Promise((resolve, reject) => {
        const handler = (event, sourceId) => {
          ipcMain.removeListener('display-source-chosen', handler);
          ipcMain.removeListener('display-source-cancelled', cancelHandler);
          resolve(sourceId);
        };
        const cancelHandler = () => {
          ipcMain.removeListener('display-source-chosen', handler);
          ipcMain.removeListener('display-source-cancelled', cancelHandler);
          reject(new Error('cancelled'));
        };
        ipcMain.once('display-source-chosen', handler);
        ipcMain.once('display-source-cancelled', cancelHandler);
        // Timeout de seguridad: si el usuario no elige en 60 s → auto-seleccionar pantalla principal
        setTimeout(() => { ipcMain.removeAllListeners('display-source-chosen'); ipcMain.removeAllListeners('display-source-cancelled'); resolve(null); }, 60000);
      });

      if (chosenId === null) {
        // Timeout: seleccionar primera pantalla disponible como fallback
        const mainScreen = sources.find(s => s.id.startsWith('screen:')) || sources[0];
        callback({ video: mainScreen, audio: 'loopback' });
        return;
      }

      const chosen = sources.find(s => s.id === chosenId);
      if (chosen) {
        // audio: 'loopback' captura el audio del sistema (funciona en Windows; en Linux requiere PipeWire + loopback)
        callback({ video: chosen, audio: 'loopback' });
      } else {
        callback({});
      }
    } catch (err) {
      if (err.message !== 'cancelled') {
        console.warn('[Electron] Error en selector de pantalla:', err.message || err);
      }
      callback({});
    }
  }, { useSystemPicker: true });


  // Manejar pantalla completa HTML (element.requestFullscreen() en stream.js)
  mainWindow.webContents.on('enter-html-full-screen', () => {
    mainWindow.setFullScreen(true);
  });
  mainWindow.webContents.on('leave-html-full-screen', () => {
    mainWindow.setFullScreen(false);
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
