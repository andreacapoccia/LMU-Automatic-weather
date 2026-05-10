// Locates the LMU install on disk and enumerates installed tracks + cars.

const fs = require('fs');
const path = require('path');
const os = require('os');

// Common Steam library locations to probe.
const DEFAULT_STEAM_PATHS = [
    'C:\\Program Files (x86)\\Steam',
    'C:\\Program Files\\Steam',
    'D:\\Steam',
    'D:\\SteamLibrary',
    'E:\\SteamLibrary',
    'F:\\SteamLibrary',
];

const LMU_RELATIVE = path.join('steamapps', 'common', 'Le Mans Ultimate');

function findLmuInstall() {
    // 1) Check the registry-known path first if we can read it (best-effort).
    // 2) Walk known Steam library candidates.
    const candidates = [...DEFAULT_STEAM_PATHS];

    // Also check any libraryfolders.vdf if Steam is in a default place.
    for (const steamRoot of [...DEFAULT_STEAM_PATHS]) {
        const vdf = path.join(steamRoot, 'steamapps', 'libraryfolders.vdf');
        if (fs.existsSync(vdf)) {
            try {
                const text = fs.readFileSync(vdf, 'utf8');
                const matches = [...text.matchAll(/"path"\s*"([^"]+)"/g)];
                for (const m of matches) {
                    const lib = m[1].replace(/\\\\/g, '\\');
                    if (!candidates.includes(lib)) candidates.push(lib);
                }
            } catch (_) {}
        }
    }

    for (const root of candidates) {
        const lmu = path.join(root, LMU_RELATIVE);
        if (fs.existsSync(path.join(lmu, 'Installed', 'Locations'))) {
            return lmu;
        }
    }
    return null;
}

// Pretty-print a folder name like "BahrainWEC_2023" → "Bahrain WEC (2023)"
function humanizeTrackFolder(folder) {
    const m = folder.match(/^(.+?)_(\d{4})$/);
    const stripped = m ? m[1] : folder;
    let name = stripped
        // CotAWEC → CotA WEC, BahrainWEC → Bahrain WEC
        .replace(/WEC/g, ' WEC')
        // generic camelCase split
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/_/g, ' ');
    name = name
        // CotA / Cota / COTA → COTA
        .replace(/\bCot\s*A\b/gi, 'COTA')
        .replace(/\bcota\b/gi, 'COTA')
        .replace(/\s+/g, ' ')
        .trim();
    return m ? `${name} (${m[2]})` : name;
}

// Returns the latest version subfolder (e.g. "1.25") for a location.
function latestVersionDir(locationDir) {
    try {
        const versions = fs
            .readdirSync(locationDir, { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .map((d) => d.name)
            .sort((a, b) =>
                a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }),
            );
        return versions.length ? path.join(locationDir, versions[versions.length - 1]) : null;
    } catch (_) {
        return null;
    }
}

// Per-layout overrides for friendlier naming. Keys are case-insensitive layout
// stems extracted from layoutXxx.mas filenames.
const LAYOUT_NAME_OVERRIDES = {
    bahrain: 'Grand Prix',
    endurance: 'Endurance',
    outer: 'Outer',
    paddock: 'Paddock',
    cota: 'Grand Prix',
    national: 'National',
    fuji: 'Grand Prix',
    fujicl: 'Classic',
    imola: 'Grand Prix',
    imolaelms: 'ELMS',
    interlagos: 'Grand Prix',
    lemans: '24h Circuit',
    mulsanne: 'Mulsanne',
    grande: 'Curva Grande',
    monza: 'Grand Prix',
    '1a': '1A',
    '1av2': '1AV2',
    '1av2short': '1AV2 Short',
    '3a': '3A',
    elms: 'ELMS',
    portimao: 'Grand Prix',
    portimaoelms: 'ELMS',
    qatar: 'Full Circuit',
    qatarshort: 'Short',
    school: 'School',
    sebring: 'International',
    international: 'International',
    wec: 'WEC',
    spa: 'Grand Prix',
    spaelms: 'ELMS',
    spaend: 'Endurance',
    show: 'Showroom',
};

function humanizeLayoutStem(stem) {
    const k = stem.toLowerCase();
    if (LAYOUT_NAME_OVERRIDES[k]) return LAYOUT_NAME_OVERRIDES[k];
    // Fallback: split CamelCase, prettify.
    return stem
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/_/g, ' ')
        .trim();
}

// List layouts inside a location's latest version folder by scanning
// `layout*.mas` filenames.
function listLayoutsForLocation(locationDir) {
    const versionDir = latestVersionDir(locationDir);
    if (!versionDir) return [];
    let entries = [];
    try {
        entries = fs.readdirSync(versionDir);
    } catch (_) {
        return [];
    }
    return entries
        .filter((f) => /^layout.*\.mas$/i.test(f))
        .map((f) => f.replace(/^layout/i, '').replace(/\.mas$/i, ''))
        .map((stem) => ({ stem, label: humanizeLayoutStem(stem) }));
}

// Token used for fuzzy-matching against the live sceneDesc returned by LMU.
function locationToken(folder) {
    return folder.replace(/_\d{4}$/, '').replace(/_/g, '').toUpperCase();
}

function listTracks(installRoot) {
    const dir = path.join(installRoot, 'Installed', 'Locations');
    if (!fs.existsSync(dir)) return [];
    const folders = fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .filter((n) => !/showroom/i.test(n));

    const tracks = [];
    for (const folder of folders) {
        const locDir = path.join(dir, folder);
        const layouts = listLayoutsForLocation(locDir);
        const baseLabel = humanizeTrackFolder(folder);
        const locToken = locationToken(folder);

        if (layouts.length === 0) {
            tracks.push({
                folder,
                layoutStem: null,
                locationName: baseLabel,
                layoutName: null,
                label: baseLabel,
                locationToken: locToken,
                layoutToken: null,
            });
            continue;
        }

        for (const lay of layouts) {
            tracks.push({
                folder,
                layoutStem: lay.stem,
                locationName: baseLabel,
                layoutName: lay.label,
                label:
                    layouts.length === 1
                        ? baseLabel
                        : `${baseLabel} — ${lay.label}`,
                locationToken: locToken,
                layoutToken: lay.stem.toUpperCase(),
            });
        }
    }
    return tracks.sort((a, b) => a.label.localeCompare(b.label));
}

// Map vehicle folder → display info + class bucket.
// Order matters — first match wins, so put the more-specific GTE patterns
// before the generic GT3 catch-all.
const VEHICLE_CLASS_RULES = [
    { test: /LMP3|JSP325|D09LMP3|G61Evo/i, cls: 'LMP3' },
    { test: /LMP2|Oreca_07/i, cls: 'LMP2' },
    {
        test: /Hybrid|Hypercar|499P|9x8|963|V-?lmdh|V-?LMDh|GMR001|Tipo6|Valkyrie|SC63|GR010|Toyota_GR|Alpine_A424|Vandervell_680/i,
        cls: 'Hypercar',
    },
    // GTE first — these are the legacy LMGTE Pro/Am cars.
    {
        test: /GTE|RSR|C8R_LM|Ferrari_488GTE|Aston_Martin_Vantage_AMR_2023/i,
        cls: 'GTE',
    },
    // Then GT3 (current LMGT3 class).
    {
        test: /LMGT3|GT3|GT_?R|RC ?F|RCF|Vantage|Mustang|Huracan|911GT3R|296GT3|Z06GT3R|AMGGT3|720sGT3/i,
        cls: 'GT3',
    },
    { test: /992S_PC|Carrera_?Cup/i, cls: 'Porsche Cup' },
];

function classifyVehicle(folder) {
    for (const r of VEHICLE_CLASS_RULES) if (r.test.test(folder)) return r.cls;
    return 'Other';
}

function humanizeVehicleFolder(folder) {
    const m = folder.match(/^(.+?)_(\d{4})$/);
    let base = (m ? m[1] : folder).replace(/_/g, ' ');
    base = base
        .replace(/\bGR10\b/g, 'GR010')
        .replace(/\bV-?lmdh\b/gi, 'V-LMDh')
        .replace(/\b9x8\b/g, '9X8')
        .replace(/\bLMGT3\b/g, 'LMGT3')
        .replace(/\bGT3R\b/g, 'GT3 R')
        .replace(/\bRCF\b/g, 'RC F')
        .replace(/\s+/g, ' ')
        .trim();
    return m ? `${base} (${m[2]})` : base;
}

function listVehicles(installRoot) {
    const dir = path.join(installRoot, 'Installed', 'Vehicles');
    if (!fs.existsSync(dir)) return [];
    const folders = fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);

    return folders
        .map((folder) => ({
            folder,
            label: humanizeVehicleFolder(folder),
            class: classifyVehicle(folder),
        }))
        .sort((a, b) => {
            if (a.class !== b.class) return a.class.localeCompare(b.class);
            return a.label.localeCompare(b.label);
        });
}

// True if the given path looks like an LMU install (has the expected
// Installed/Locations + Installed/Vehicles subtrees).
function isValidLmuPath(candidate) {
    if (!candidate || typeof candidate !== 'string') return false;
    return (
        fs.existsSync(path.join(candidate, 'Installed', 'Locations')) &&
        fs.existsSync(path.join(candidate, 'Installed', 'Vehicles'))
    );
}

// scanInstall(overridePath?) — if overridePath is supplied AND valid, use it.
// Otherwise auto-detect from default Steam paths + libraryfolders.vdf.
function scanInstall(overridePath) {
    const installRoot = isValidLmuPath(overridePath) ? overridePath : findLmuInstall();
    if (!installRoot) {
        return { found: false, installRoot: null, tracks: [], vehicles: [], source: 'none' };
    }
    return {
        found: true,
        installRoot,
        source: isValidLmuPath(overridePath) && overridePath === installRoot ? 'manual' : 'auto',
        tracks: listTracks(installRoot),
        vehicles: listVehicles(installRoot),
    };
}

module.exports = { findLmuInstall, listTracks, listVehicles, scanInstall, isValidLmuPath };
