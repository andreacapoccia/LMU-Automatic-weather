const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('go', {
    scanInstall: () => ipcRenderer.invoke('install:scan'),
    pickInstallPath: () => ipcRenderer.invoke('install:pickPath'),
    resetInstallPath: () => ipcRenderer.invoke('install:resetPath'),
    isLmuAlive: () => ipcRenderer.invoke('lmu:isAlive'),
    getLmuNavState: () => ipcRenderer.invoke('lmu:getNavState'),
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
    convertRun: (inputPath, outputDir) => ipcRenderer.invoke('convert:run', { inputPath, outputDir }),
    startWatch: (watchDir, outputDir) => ipcRenderer.invoke('convert:startWatch', { watchDir, outputDir }),
    stopWatch: () => ipcRenderer.invoke('convert:stopWatch'),
    onConvertLog: (cb) => {
        const listener = (_e, line) => cb(line);
        ipcRenderer.on('convert:log', listener);
        return () => ipcRenderer.removeListener('convert:log', listener);
    },
    pickFolder: (opts) => ipcRenderer.invoke('dialog:pickFolder', opts),
    pickFile: (opts) => ipcRenderer.invoke('dialog:pickFile', opts),
    motecOpen: (ldPath) => ipcRenderer.invoke('motec:open', ldPath),
    revealInFolder: (filePath) => ipcRenderer.invoke('shell:reveal', filePath),
    deleteConversion: (ldPath) => ipcRenderer.invoke('convert:delete', ldPath),
    getSetting: (key) => ipcRenderer.invoke('settings:get', key),
    setSetting: (key, value) => ipcRenderer.invoke('settings:set', key, value),
    getDefaultWatchPath: () => ipcRenderer.invoke('app:getDefaultWatchPath'),
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
    openLogsFolder: () => ipcRenderer.invoke('app:openLogsFolder'),
    resetAllSettings: () => ipcRenderer.invoke('settings:resetAll'),
});
