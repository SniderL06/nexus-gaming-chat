/* NEXUS Electron Preload — IPC Bridge (contextIsolation: true) */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // El main process nos manda la lista de fuentes de pantalla disponibles
    onDisplaySources: (callback) => {
        ipcRenderer.on('display-sources', (_event, sources) => callback(sources));
    },
    // El usuario elige una fuente → notificar al main process
    chooseDisplaySource: (sourceId) => {
        ipcRenderer.send('display-source-chosen', sourceId);
    },
    // El usuario cancela → notificar al main process
    cancelDisplaySource: () => {
        ipcRenderer.send('display-source-cancelled');
    },
    // Detectar si estamos en Electron (para activar flujos específicos de la app)
    isElectron: true,
    platform: process.platform  // 'linux', 'win32', 'darwin'
});
