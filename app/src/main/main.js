const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const { execFile } = require('child_process');

const launcher = require('./lmu-launcher');
const scanner = require('./install-scanner');
const settings = require('./settings');

let mainWindow = null;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1422,
        height: 828,
        minWidth: 1100,
        minHeight: 780,
        backgroundColor: '#0a0a0a',
        autoHideMenuBar: true,
        title: 'GO LMU Launcher',
        icon: path.join(__dirname, '..', '..', 'assets', 'icon.png'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
        },
    });

    mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
    mainWindow.setMenuBarVisibility(false);

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });
}

app.whenReady().then(() => {
    createWindow();
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

// ───────── IPC ─────────

ipcMain.handle('install:scan', async () => {
    return scanner.scanInstall(settings.get('lmuPath'));
});

ipcMain.handle('install:pickPath', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Select your Le Mans Ultimate folder',
        properties: ['openDirectory'],
    });
    if (result.canceled || !result.filePaths?.length) {
        return { ok: false, canceled: true };
    }
    const picked = result.filePaths[0];
    if (!scanner.isValidLmuPath(picked)) {
        return {
            ok: false,
            error: `That folder doesn't look like an LMU install — expected to find Installed/Locations and Installed/Vehicles inside.`,
            picked,
        };
    }
    settings.set('lmuPath', picked);
    return { ok: true, scan: scanner.scanInstall(picked) };
});

ipcMain.handle('install:resetPath', async () => {
    settings.set('lmuPath', null);
    return { ok: true, scan: scanner.scanInstall() };
});

ipcMain.handle('lmu:isAlive', async () => {
    return launcher.isLmuApiAlive();
});

ipcMain.handle('lmu:fetchTracks', async () => {
    try {
        const list = await launcher.fetchTrackList();
        return { ok: true, tracks: list };
    } catch (e) {
        return { ok: false, error: e.message };
    }
});

ipcMain.handle('lmu:fetchCars', async () => {
    try {
        const r = await fetch('http://localhost:6397/rest/race/car');
        if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
        const list = await r.json();
        return { ok: true, cars: list };
    } catch (e) {
        return { ok: false, error: e.message };
    }
});

ipcMain.handle('lmu:launch', async (event, payload) => {
    const send = (line) => {
        try {
            event.sender.send('lmu:log', line);
        } catch (_) {}
    };
    try {
        await launcher.launchSession({ ...payload, emit: send });
        return { ok: true };
    } catch (e) {
        send(`ERROR: ${e.message}`);
        return { ok: false, error: e.message };
    }
});

ipcMain.handle('app:openExternal', async (_e, url) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
        shell.openExternal(url);
    }
});

ipcMain.handle('gofast:isAlive', () => {
    return new Promise((resolve) => {
        execFile('tasklist', ['/FI', 'IMAGENAME eq GOFast.App.exe', '/NH', '/FO', 'CSV'], (err, stdout) => {
            resolve(!err && stdout.toLowerCase().includes('gofast.app.exe'));
        });
    });
});
