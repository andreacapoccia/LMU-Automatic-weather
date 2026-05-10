const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile, spawn } = require('child_process');

const launcher = require('./lmu-launcher');
const scanner = require('./install-scanner');
const settings = require('./settings');

const PKG = require(path.join(app.getAppPath(), 'package.json'));

let mainWindow = null;

// In dev, the converter lives a few levels up alongside the app.
// In a packaged build it's copied into resources/converter/ via extraResource (see build.js).
const CONVERTER_DIR = app.isPackaged
    ? path.join(process.resourcesPath, 'converter')
    : path.join(__dirname, '../../../DuckDBtoMoTeC/converter');

// The packaged app doesn't ship Node.js. Use Electron's binary in node-mode
// via the ELECTRON_RUN_AS_NODE env var so spawn() works without a system Node install.
const NODE_BIN = process.execPath;
const NODE_ENV = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
let watcherProcess = null;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1500,
        height: 1024,
        minWidth: 1100,
        minHeight: 920,
        center: true,
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

app.on('before-quit', () => {
    if (watcherProcess) { watcherProcess.kill(); watcherProcess = null; }
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

ipcMain.handle('lmu:getNavState', async () => {
    return launcher.getLmuNavState();
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

ipcMain.handle('convert:run', (_e, { inputPath, outputDir }) => {
    const namingTemplate = settings.get('outputNamingTemplate', '');
    return new Promise((resolve, reject) => {
        const args = [path.join(CONVERTER_DIR, 'convert.js'), inputPath, outputDir];
        if (namingTemplate) args.push(namingTemplate);
        const child = spawn(NODE_BIN, args, { env: NODE_ENV });
        const results = [];
        const stderrLines = [];
        child.stdout.on('data', chunk => {
            for (const line of chunk.toString().split('\n').filter(Boolean)) {
                try { results.push(JSON.parse(line)); } catch {}
                try { if (mainWindow) mainWindow.webContents.send('convert:log', line); } catch (_) {}
            }
        });
        child.stderr.on('data', chunk => {
            const text = chunk.toString();
            stderrLines.push(text);
            try { if (mainWindow) mainWindow.webContents.send('convert:log', text); } catch (_) {}
        });
        child.on('close', code =>
            code === 0
                ? resolve(results)
                : reject(new Error(`converter exited ${code}: ${stderrLines.join('').trim()}`))
        );
    });
});

// Remember the last-used dirs so we can restart the watcher when settings
// (e.g. outputNamingTemplate) change while it's running.
let watcherDirs = null;

function spawnWatcher(watchDir, outputDir) {
    const namingTemplate = settings.get('outputNamingTemplate', '');
    const args = [path.join(CONVERTER_DIR, 'watcher.js'), watchDir, outputDir];
    if (namingTemplate) args.push(namingTemplate);
    const proc = spawn(NODE_BIN, args, { env: NODE_ENV });
    proc.stdout.on('data', chunk => {
        for (const line of chunk.toString().split('\n').filter(Boolean))
            try { if (mainWindow) mainWindow.webContents.send('convert:log', line); } catch (_) {}
    });
    proc.stderr.on('data', chunk => {
        try { if (mainWindow) mainWindow.webContents.send('convert:log', chunk.toString()); } catch (_) {}
    });
    proc.on('close', () => { if (watcherProcess === proc) { watcherProcess = null; watcherDirs = null; } });
    return proc;
}

ipcMain.handle('convert:startWatch', (_e, { watchDir, outputDir }) => {
    if (watcherProcess) return { ok: false, reason: 'already running' };
    watcherProcess = spawnWatcher(watchDir, outputDir);
    watcherDirs = { watchDir, outputDir };
    return { ok: true };
});

ipcMain.handle('convert:stopWatch', () => {
    if (watcherProcess) { watcherProcess.kill(); watcherProcess = null; watcherDirs = null; }
    return { stopped: true };
});

ipcMain.handle('dialog:pickFolder', async (_e, { title } = {}) => {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: title || 'Select folder',
        properties: ['openDirectory'],
    });
    if (result.canceled || !result.filePaths?.length) return { canceled: true };
    return { canceled: false, path: result.filePaths[0] };
});

ipcMain.handle('app:getDefaultWatchPath', () => {
    return path.join(app.getPath('documents'), 'Le Mans Ultimate', 'UserData', 'Telemetry');
});

ipcMain.handle('app:getVersion', () => ({
    version: PKG.version,
    buildDate: PKG.buildDate || 'unknown',
}));

ipcMain.handle('dialog:pickFile', async (_e, { title, filters } = {}) => {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: title || 'Select file',
        properties: ['openFile'],
        filters: filters || [],
    });
    if (result.canceled || !result.filePaths?.length) return { canceled: true };
    return { canceled: false, path: result.filePaths[0] };
});

ipcMain.handle('motec:open', async (_e, ldPath) => {
    const motecExe = settings.get('motecExe', '');
    const motecWorkspace = settings.get('motecWorkspace', '');

    // If user has both an exe AND a workspace configured, launch via shell
    // so the existing MoTeC instance receives both args. Workspace must come
    // first in MoTeC i2's argv.
    if (motecExe && motecWorkspace) {
        return new Promise((resolve) => {
            const child = spawn('cmd', ['/c', 'start', '""', motecExe, motecWorkspace, ldPath], { detached: true, stdio: 'ignore' });
            child.on('error', (err) => resolve({ ok: false, error: err.message }));
            child.unref();
            setTimeout(() => resolve({ ok: true }), 200);
        });
    }

    // Try Windows file association first — ShellExecute properly delegates
    // to MoTeC's existing instance if running.
    const shellError = await shell.openPath(ldPath);
    if (!shellError) return { ok: true };

    // Fallback: motecExe set but no workspace — launch via cmd start.
    if (motecExe) {
        return new Promise((resolve) => {
            const child = spawn('cmd', ['/c', 'start', '""', motecExe, ldPath], { detached: true, stdio: 'ignore' });
            child.on('error', (err) => resolve({ ok: false, error: err.message }));
            child.unref();
            setTimeout(() => resolve({ ok: true }), 200);
        });
    }
    return { ok: false, error: shellError || 'No file association for .ld and no MoTeC i2 path configured' };
});

ipcMain.handle('shell:reveal', async (_e, filePath) => {
    shell.showItemInFolder(filePath);
    return { ok: true };
});

ipcMain.handle('convert:delete', async (_e, ldPath) => {
    const ldx = ldPath.replace(/\.ld$/i, '.ldx');
    const errors = [];
    for (const f of [ldPath, ldx]) {
        try { fs.unlinkSync(f); } catch (e) { if (e.code !== 'ENOENT') errors.push(e.message); }
    }
    if (errors.length) return { ok: false, error: errors.join(', ') };
    return { ok: true };
});

ipcMain.handle('app:openLogsFolder', async () => {
    const dir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(dir, { recursive: true });
    const err = await shell.openPath(dir);
    return err ? { ok: false, error: err } : { ok: true };
});

ipcMain.handle('settings:resetAll', () => {
    return settings.resetAll() ? { ok: true } : { ok: false, error: 'Failed to delete settings file' };
});

ipcMain.handle('settings:get', (_e, key) => settings.get(key));
ipcMain.handle('settings:set', (_e, key, value) => {
    settings.set(key, value);
    // If the watcher is running and a setting that affects its spawn args
    // changed, restart it so the new value takes effect immediately.
    if (key === 'outputNamingTemplate' && watcherProcess && watcherDirs) {
        const dirs = watcherDirs;
        watcherProcess.kill();
        watcherProcess = spawnWatcher(dirs.watchDir, dirs.outputDir);
        watcherDirs = dirs;
    }
    return { ok: true };
});
