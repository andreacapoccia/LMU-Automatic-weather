// Tiny JSON settings store at %APPDATA%/GO LMU Launcher/settings.json.
// Persists user-chosen LMU install path and any future preferences.

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

function settingsPath() {
    return path.join(app.getPath('userData'), 'settings.json');
}

function read() {
    try {
        const raw = fs.readFileSync(settingsPath(), 'utf8');
        return JSON.parse(raw);
    } catch {
        return {};
    }
}

function write(obj) {
    try {
        fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
        fs.writeFileSync(settingsPath(), JSON.stringify(obj, null, 2));
        return true;
    } catch {
        return false;
    }
}

function get(key, fallback) {
    const v = read()[key];
    return v === undefined ? fallback : v;
}

function set(key, value) {
    const all = read();
    all[key] = value;
    return write(all);
}

function resetAll() {
    try {
        fs.unlinkSync(settingsPath());
        return true;
    } catch (e) {
        if (e.code === 'ENOENT') return true;  // already clean
        return false;
    }
}

module.exports = { read, write, get, set, resetAll };
