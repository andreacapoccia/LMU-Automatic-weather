const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('go', {
    scanInstall: () => ipcRenderer.invoke('install:scan'),
    pickInstallPath: () => ipcRenderer.invoke('install:pickPath'),
    resetInstallPath: () => ipcRenderer.invoke('install:resetPath'),
    isLmuAlive: () => ipcRenderer.invoke('lmu:isAlive'),
    isGoFastAlive: () => ipcRenderer.invoke('gofast:isAlive'),
    fetchLiveTracks: () => ipcRenderer.invoke('lmu:fetchTracks'),
    fetchLiveCars: () => ipcRenderer.invoke('lmu:fetchCars'),
    launch: (payload) => ipcRenderer.invoke('lmu:launch', payload),
    openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
    onLog: (cb) => {
        const listener = (_e, line) => cb(line);
        ipcRenderer.on('lmu:log', listener);
        return () => ipcRenderer.removeListener('lmu:log', listener);
    },
});
