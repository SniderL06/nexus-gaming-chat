const { app, BrowserWindow, shell, session } = require('electron');
const path = require('path');

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
      autoplayPolicy: 'no-user-gesture-required'
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
