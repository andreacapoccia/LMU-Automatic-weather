// ───────── State ─────────
function defaultSlots() {
    return Array.from({ length: 5 }, () => ({ sky: 0, rainChance: 0, temperature: 22 }));
}

function defaultSession(overrides) {
    return {
        enabled: false,
        length: 60,
        startTime: 720,
        privateSession: true,
        startingGrip: 'preset:SATURATED.RRBIN',
        realRoadTimeScale: 0,
        weatherPreset: 'dry',
        customWeather: defaultSlots(),
        ...overrides,
    };
}

const state = {
    install: null,
    liveTracksFetched: false,
    liveCarsFetched: false,
    cars: [],
    selectedClass: '',
    // folder → { locationName, layouts: Array<track> }
    trackGroups: {},
    overrides: {
        // Shared (non-session) values — main process DEFAULT_OVERRIDES handles
        // the rest; UI for these is removed in Task 7.
        waterDepth: -0.01,
        tireWarmers: true,
        timeScale: 0,                   // None
        flagRules: 3,                   // Full w/o DQ
        trackLimitsRules: 1,            // Default
        trackLimitsPoints: 5,
        mechanicalFailures: 1,          // Normal
        vehicleString: null,
        // Per-session config — Practice enabled by default for back-compat
        sessions: {
            practice:   defaultSession({ enabled: true,  length: 360, startTime: 720, startingGrip: 'preset:SATURATED.RRBIN' }),
            qualifying: defaultSession({ enabled: false, length: 20,  startTime: 900, startingGrip: 'preset:HEAVY.RRBIN' }),
            race:       defaultSession({ enabled: false, length: 240, startTime: 780, startingGrip: 'preset:SATURATED.RRBIN', startType: 'rolling', privateSession: false }),
        },
    },
};

// ───────── Helpers ─────────
const $ = (id) => document.getElementById(id);

let liveryNames = {}; // { [carId]: customDisplayName } — persisted in settings

function logLine(line, kind = '') {
    const log = $('log');
    if (!log) { console[kind === 'err' ? 'error' : 'log']('[GO]', line); return; }
    const ts = new Date().toLocaleTimeString([], { hour12: false });
    const div = document.createElement('div');
    if (kind) div.className = kind;
    div.innerHTML = `<span class="ts">[${ts}]</span> ${line.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))}`;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
    // Auto-open the log on first error
    const logToggle = $('logToggle');
    if (kind === 'err' && log.classList.contains('hidden')) {
        log.classList.remove('hidden');
        if (logToggle) logToggle.classList.add('open');
    }
}

function setStatus(state) {
    const pill = $('lmuStatusPill');
    if (!pill) return;
    const text = $('lmuStatusText');
    const alive = !!state?.alive;
    pill.classList.toggle('offline', !alive);
    const live = document.querySelector('.live');
    if (live) live.style.color = alive ? 'var(--green)' : 'var(--text-faint)';
    if (!text) return;
    if (!alive) { text.textContent = 'LMU offline'; return; }
    const nav = state.navigationState || 'UNKNOWN';
    text.textContent = `LMU running · ${navStateLabel(nav)}`;
}

function navStateLabel(nav) {
    const map = {
        NAV_MAIN_MENU: 'main menu',
        NAV_GARAGE: 'garage',
        NAV_DRIVING: 'in session',
        NAV_LOADING: 'loading',
        NAV_REPLAYS: 'replay',
    };
    if (map[nav]) return map[nav];
    if (typeof nav !== 'string') return 'unknown';
    return nav.replace(/^NAV_/, '').toLowerCase().replace(/_/g, ' ');
}

function formatTimeScale(v) {
    const n = Number(v);
    if (n === 0) return 'None';
    if (n === 1) return 'Normal';
    return `×${n}`;
}

// Make range sliders show a coloured fill up to the thumb.
function updateRangeFill(input) {
    const min = +input.min || 0;
    const max = +input.max || 100;
    const val = +input.value;
    const pct = ((val - min) / (max - min)) * 100;
    input.style.setProperty('--val', pct + '%');
}

// ───────── Tracks ─────────
async function loadInstall() {
    const result = await window.go.scanInstall();
    applyScanResult(result);
}

function applyScanResult(result) {
    state.install = result;
    state.liveTracksFetched = false;

    const trackSelect = $('trackSelect');
    const installPathEl = document.querySelector('.install-pill-path');

    if (!result?.found) {
        trackSelect.innerHTML = '<option value="">Le Mans Ultimate not found</option>';
        if (installPathEl) installPathEl.textContent = 'not detected';
        $('installPill').title = 'Le Mans Ultimate install not found — click Change to set the path manually.';
        return;
    }

    populateTracks(result.tracks);
    const tag = result.source === 'manual' ? '(manual)' : '(auto)';
    if (installPathEl) installPathEl.textContent = `${tag} ${result.installRoot.split(/[/\\]/).slice(-2).join('/')}`;
    $('installPill').title = result.installRoot;
}

function populateTracks(tracks) {
    // Group by folder (location)
    const groups = {};
    for (const t of tracks) {
        const folder = t.folder || t.label;
        if (!groups[folder]) {
            groups[folder] = {
                folder,
                locationName: t.locationName || t.label.split(' — ')[0],
                layouts: [],
            };
        }
        groups[folder].layouts.push(t);
    }
    state.trackGroups = groups;

    const trackSelect = $('trackSelect');
    const prevFolder = trackSelect.value;
    trackSelect.innerHTML = '';

    const folders = Object.keys(groups).sort((a, b) =>
        groups[a].locationName.localeCompare(groups[b].locationName),
    );

    for (const folder of folders) {
        const opt = document.createElement('option');
        opt.value = folder;
        opt.textContent = groups[folder].locationName;
        trackSelect.appendChild(opt);
    }

    if (prevFolder && groups[prevFolder]) trackSelect.value = prevFolder;
    rebuildCdd(trackSelect);
    populateLayoutSelect();
}

function populateLayoutSelect() {
    const trackSelect = $('trackSelect');
    const layoutSelect = $('layoutSelect');
    if (!layoutSelect) return;

    const folder = trackSelect.value;
    const group = state.trackGroups[folder];
    const layouts = group ? group.layouts : [];
    const onlyOne = layouts.length <= 1;

    layoutSelect.innerHTML = '';
    for (const t of layouts) {
        const opt = document.createElement('option');
        opt.value = `${t.folder}::${t.layoutStem || ''}`;
        if (t.id != null) opt.dataset.id = String(t.id);
        if (t.sceneDesc) opt.dataset.sceneDesc = t.sceneDesc;
        opt.dataset.locationToken = t.locationToken || '';
        opt.dataset.layoutToken = t.layoutToken || '';
        opt.textContent = t.layoutName || t.layoutStem || 'Default';
        layoutSelect.appendChild(opt);
    }
    layoutSelect.disabled = onlyOne;

    const countEl = $('layoutCountVal');
    if (countEl) countEl.textContent = onlyOne ? '' : `${layouts.length} options`;

    rebuildCdd(layoutSelect);
    updateSummary();
}

async function refreshLiveTracks() {
    if (state.liveTracksFetched) return;
    const result = await window.go.fetchLiveTracks();
    if (!result?.ok || !Array.isArray(result.tracks) || result.tracks.length === 0) return;

    const seen = new Map();
    for (const live of result.tracks) {
        if (live.sceneDesc) seen.set(live.sceneDesc, live);
    }

    const merged = [];
    if (state.install?.tracks?.length) {
        for (const t of state.install.tracks) {
            const loc = (t.locationToken || '').toUpperCase();
            const lay = (t.layoutToken || '').toUpperCase();
            const normSd = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
            const candidates = [...seen.values()].filter((live) => {
                const sd = normSd(live.sceneDesc);
                return sd.includes(loc);
            });
            // Pick best candidate using suffix scoring so e.g. COTAWEC (GP, empty suffix)
            // beats COTAWEC_NATIONAL when matching the COTA layout token.
            let live = null;
            if (candidates.length === 1) {
                live = candidates[0];
            } else if (candidates.length > 1) {
                let best = null, bestScore = -1;
                for (const c of candidates) {
                    const sd = normSd(c.sceneDesc);
                    const locIdx = sd.indexOf(loc);
                    const suffix = locIdx >= 0 ? sd.slice(locIdx + loc.length) : sd;
                    let score = 0;
                    if (suffix === lay) score += 300;
                    else if (suffix.includes(lay)) score += 200;
                    else if (sd.includes(lay)) score += 50;
                    if (suffix === '' && loc.includes(lay)) score += 10;
                    for (let i = 0; i < lay.length; i++) {
                        if (suffix.includes(lay.slice(i))) { score += lay.length - i; break; }
                    }
                    if (loc === lay) score -= suffix.length;
                    if (score > bestScore) { bestScore = score; best = c; }
                }
                live = best;
            }
            if (live) {
                merged.push({ ...t, id: live.id, sceneDesc: live.sceneDesc });
                seen.delete(live.sceneDesc);
            } else {
                merged.push(t);
            }
        }
    }
    // Only fall back to raw sceneDesc entries when we have no installed track list at all.
    if (!state.install?.tracks?.length) {
        for (const live of seen.values()) {
            merged.push({
                folder: '',
                layoutStem: null,
                label: live.sceneDesc,
                locationToken: '',
                layoutToken: '',
                id: live.id,
                sceneDesc: live.sceneDesc,
            });
        }
    }
    populateTracks(merged.sort((a, b) => a.label.localeCompare(b.label)));
    state.liveTracksFetched = true;
}

async function pickInstallPath() {
    const result = await window.go.pickInstallPath();
    if (result?.canceled) return;
    if (!result?.ok) {
        logLine(result?.error || 'Failed to set LMU folder.', 'err');
        return;
    }
    applyScanResult(result.scan);
    logLine(`LMU folder set to: ${result.scan.installRoot}`, 'ok');
}

// ───────── Cars (live from LMU) ─────────
function stripVersion(name) {
    return String(name || '').replace(/\s+\d+\.\d+\s*$/, '').trim();
}

function parseCarPath(tree) {
    return String(tree || '').split(',').map((s) => s.trim()).filter(Boolean);
}

const CLASS_LABELS = {
    LMP2_ELMS: 'LMP2 ELMS',
    GT3: 'LMGT3',
    LMGT3: 'LMGT3',
    LMP2: 'LMP2',
    LMP3: 'LMP3',
    GTE: 'GTE',
    Hypercar: 'Hypercar',
};
function normalizeClass(cls) {
    return CLASS_LABELS[cls] || cls;
}

// Virtual sub-model splits: one LMU model folder that ships multiple spec variants
// distinguished by livery displayName keywords (e.g. winged vs wingless 9X8).
const VIRTUAL_SPLITS = [
    {
        modelMatch: /9.?x.?8/i,
        variants: [
            { key: 'evo', label: '9X8 EVO (Winged)',  test: (dn) => /evo/i.test(dn) },
            { key: 'std', label: '9X8 (Wingless)',     test: () => true },
        ],
    },
];

function getVirtualModel(modelFolder, displayName) {
    for (const rule of VIRTUAL_SPLITS) {
        if (!rule.modelMatch.test(modelFolder)) continue;
        for (const v of rule.variants) {
            if (v.test(displayName)) {
                return { modelKey: `${modelFolder}__${v.key}`, modelLabel: v.label };
            }
        }
    }
    return { modelKey: modelFolder, modelLabel: null };
}

async function refreshLiveCars(force = false) {
    if (state.liveCarsFetched && !force) return;
    const result = await window.go.fetchLiveCars();
    if (!result?.ok || !Array.isArray(result.cars)) return;

    const cars = [];
    for (const c of result.cars) {
        if (c.owned === false && !c.locallyInstalled) continue;
        const parts = parseCarPath(c.fullPathTree);
        if (parts.length < 3) continue;
        const baseDn = c.displayProperties?.displayName || stripVersion(c.name);
        const dn = (c.locallyInstalled && liveryNames[c.id]) ? liveryNames[c.id] : baseDn;
        const vm = getVirtualModel(parts[2], baseDn);
        cars.push({
            id: c.id,
            class: normalizeClass(parts[1]),
            model: parts[2],
            modelKey: vm.modelKey,
            modelLabel: vm.modelLabel,
            series: parts[0],
            name: stripVersion(c.name),
            displayName: dn,
            locallyInstalled: !!c.locallyInstalled,
        });
    }
    state.cars = cars;
    state.liveCarsFetched = true;
    populateClassChips();
}

function populateClassChips() {
    const container = $('classChips');
    const classes = [...new Set(state.cars.map((c) => c.class))].sort();
    container.innerHTML = '';
    if (classes.length === 0) {
        container.innerHTML = '<span class="muted small">Open LMU to load car list…</span>';
        return;
    }
    for (const cls of classes) {
        const count = state.cars.filter((c) => c.class === cls).length;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'class-chip' + (cls === state.selectedClass ? ' active' : '');
        btn.dataset.class = cls;
        btn.innerHTML = `<span>${cls}</span><span class="count">${count}</span>`;
        btn.addEventListener('click', () => {
            state.selectedClass = cls;
            setAutoDetect(false);
            populateClassChips();           // re-render to update active state
            populateModelDropdown();
        });
        container.appendChild(btn);
    }
}

function populateModelDropdown() {
    const sel = $('carModelSelect');
    const cls = state.selectedClass;
    const prev = sel.value;
    sel.innerHTML = '<option value="">— Car model —</option>';
    if (!cls) {
        sel.disabled = true;
        const liverySel = $('carLiverySelect');
        liverySel.innerHTML = '<option value="">— Livery —</option>';
        liverySel.disabled = true;
        rebuildCdd(sel);
        rebuildCdd(liverySel);
        state.overrides.vehicleString = null;
        updateSummary();
        return;
    }
    const carsInClass = state.cars.filter((c) => c.class === cls);
    const modelKeys = [...new Set(carsInClass.map((c) => c.modelKey))].sort();
    for (const mk of modelKeys) {
        const group = carsInClass.filter((c) => c.modelKey === mk);
        const count = group.length;
        const label = group[0].modelLabel || mk;
        const opt = document.createElement('option');
        opt.value = mk;
        opt.textContent = count > 1 ? `${label}  (${count} liveries)` : label;
        sel.appendChild(opt);
    }
    sel.disabled = false;
    if (prev && [...sel.options].some((o) => o.value === prev)) sel.value = prev;
    rebuildCdd(sel);
    populateLiveryDropdown();
}

function populateLiveryDropdown() {
    const sel = $('carLiverySelect');
    const cls = state.selectedClass;
    const modelKey = $('carModelSelect').value;
    sel.innerHTML = '<option value="">— Livery —</option>';
    if (!cls || !modelKey) {
        sel.disabled = true;
        state.overrides.vehicleString = null;
        updateSummary();
        return;
    }
    const liveries = state.cars
        .filter((c) => c.class === cls && c.modelKey === modelKey)
        .sort((a, b) => a.displayName.localeCompare(b.displayName));
    for (const l of liveries) {
        const opt = document.createElement('option');
        opt.value = l.name;
        opt.textContent = l.displayName;
        sel.appendChild(opt);
    }
    sel.disabled = false;
    if (liveries.length === 1) {
        sel.value = liveries[0].name;
        state.overrides.vehicleString = liveries[0].name;
    } else {
        state.overrides.vehicleString = null;
    }
    rebuildCdd(sel);
    syncRenameLiveryBtn();
    updateSummary();
}

function syncRenameLiveryBtn() {
    const btn = $('renameLivery');
    if (!btn) return;
    const sel = $('carLiverySelect');
    btn.style.display = sel?.value ? '' : 'none';
}

function setAutoDetect(enabled) {
    const btn = $('autoDetectCar');
    const label = $('autoDetectLabel');
    if (enabled) {
        state.overrides.vehicleString = null;
        state.selectedClass = '';
        const modelSel = $('carModelSelect');
        modelSel.innerHTML = '<option value="">— Car model —</option>';
        modelSel.disabled = true;
        const liverySel = $('carLiverySelect');
        liverySel.innerHTML = '<option value="">— Livery —</option>';
        liverySel.disabled = true;
        rebuildCdd(modelSel);
        rebuildCdd(liverySel);
        document.querySelectorAll('.class-chip').forEach((c) => c.classList.remove('active'));
        btn.classList.add('active');
        label.textContent = 'Inherits whatever LMU has loaded.';
    } else {
        btn.classList.remove('active');
        label.textContent = '';
    }
    updateSummary();
}

// ───────── Launch summary ─────────
function updateSummary() {
    const trackOpt = $('trackSelect').selectedOptions[0];
    const layoutSelect = $('layoutSelect');
    const layoutOpt = layoutSelect && layoutSelect.selectedOptions[0];
    let trackSummary = '—';
    if (trackOpt && trackOpt.value) {
        trackSummary = trackOpt.textContent;
        if (layoutOpt && !layoutSelect.disabled) {
            trackSummary += ' · ' + layoutOpt.textContent;
        }
    }
    const sumTrack = $('sumTrack');
    if (sumTrack) sumTrack.textContent = trackSummary;

    const sumCar = $('sumCar');
    if (sumCar) {
        sumCar.textContent = state.overrides.vehicleString ? state.overrides.vehicleString : 'Auto-detect from LMU';
    }

    // Sessions summary: list enabled session abbreviations
    const sumSessions = $('sumSessions');
    if (sumSessions) {
        const abbr = { practice: 'Practice', qualifying: 'Qualifying', race: 'Race' };
        const enabled = Object.keys(state.overrides.sessions).filter((sk) => state.overrides.sessions[sk].enabled);
        sumSessions.textContent = enabled.length > 0 ? enabled.map((sk) => abbr[sk] || sk).join(' · ') : 'None enabled';
    }

    // Length tile: total enabled session minutes
    const sumLen = $('sumLen');
    if (sumLen) {
        const enabledSessions = Object.values(state.overrides.sessions).filter((s) => s.enabled);
        if (enabledSessions.length === 0) {
            sumLen.textContent = '—';
        } else {
            const total = enabledSessions.reduce((acc, s) => acc + s.length, 0);
            const h = Math.floor(total / 60), m = total % 60;
            sumLen.textContent = h > 0 ? `${h}h ${m > 0 ? m + 'm' : ''} total`.trim() : `${m} min total`;
        }
    }
}

// ───────── Bindings ─────────
function bindRange(id, key, fmt) {
    const el = $(id);
    const out = $(`${id}Val`);
    const update = () => {
        const v = Number(el.value);
        state.overrides[key] = v;
        if (out) out.textContent = fmt(v);
        updateRangeFill(el);
        updateSummary();
    };
    el.addEventListener('input', update);
    update();
}


function bindCheckbox(id, key) {
    const el = $(id);
    el.addEventListener('change', () => {
        state.overrides[key] = el.checked;
    });
    state.overrides[key] = el.checked;
}

function bindSelect(id, key, parser) {
    const el = $(id);
    el.addEventListener('change', () => {
        state.overrides[key] = parser ? parser(el.value) : el.value;
        updateSummary();
    });
    state.overrides[key] = parser ? parser(el.value) : el.value;
}

function bindToSession(id, sessionKey, fieldKey, parser) {
    const el = $(id);
    if (!el) return;
    const out = $(`${id}Val`);
    const update = () => {
        const raw = el.type === 'checkbox' ? el.checked : el.value;
        const v = parser ? parser(raw) : raw;
        state.overrides.sessions[sessionKey][fieldKey] = v;
        if (out && el.type === 'range') out.textContent = (typeof parser === 'function' && parser !== Number) ? parser(raw) : String(raw);
        if (el.type === 'range') updateRangeFill(el);
        updateSummary();
    };
    el.addEventListener(el.type === 'checkbox' || el.type === 'range' ? 'input' : 'change', update);
    update();
}

// ───────── Sessions v3 render ─────────
const SKY_OPTS = [
    'Clear','Light clouds','Partially cloudy','Mostly cloudy','Overcast',
    'Cloudy & drizzle','Cloudy & light rain','Overcast & light rain',
    'Overcast & rain','Overcast & heavy rain','Overcast & storm'
];

const SKY_ICONS = [
    '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="4.5"/><g stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"><path d="M12 2v2.4"/><path d="M12 19.6V22"/><path d="M2 12h2.4"/><path d="M19.6 12H22"/><path d="M4.9 4.9l1.7 1.7"/><path d="M17.4 17.4l1.7 1.7"/><path d="M4.9 19.1l1.7-1.7"/><path d="M17.4 6.6l1.7-1.7"/></g></svg>',
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="8.5" cy="8.5" r="3"/><g stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"><path d="M8.5 2.2v1.4"/><path d="M2.2 8.5h1.4"/><path d="M3.8 3.8l1 1"/><path d="M14.2 14.2l-1-1"/><path d="M3.8 13.2l1-1"/></g><path d="M21 16a3.2 3.2 0 0 0-6-1.4 2.6 2.6 0 1 0-1.2 5h6.4A2.6 2.6 0 0 0 21 16z"/></svg>',
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="7.5" cy="7.5" r="2.8"/><g stroke="currentColor" stroke-width="1.5" stroke-linecap="round" fill="none"><path d="M7.5 1.8v1.2"/><path d="M1.8 7.5H3"/><path d="M3.4 3.4l.9.9"/><path d="M11.6 3.4l-.9.9"/></g><path d="M22 14.5a4 4 0 0 0-7.6-1.7 3 3 0 1 0-1.4 5.7h7.4a3 3 0 0 0 1.6-4z"/></svg>',
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="5.5" cy="6" r="2.2" opacity=".95"/><path d="M22 14a4.5 4.5 0 0 0-8.6-1.9A3.5 3.5 0 1 0 12 19.5h7.5A3.5 3.5 0 0 0 22 14z"/></svg>',
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M20 13.5A4.8 4.8 0 0 0 11 11a4.2 4.2 0 1 0-1.5 8.2H19a3 3 0 0 0 1-5.7z"/></svg>',
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19.5 11A4.5 4.5 0 0 0 11 8.5a4 4 0 1 0-1.5 7.8h9.5a3 3 0 0 0 .5-5.3z"/><circle cx="9.5" cy="20" r="1"/><circle cx="14.5" cy="20" r="1"/></svg>',
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="5.5" cy="6" r="2" opacity=".95"/><path d="M20 12.5A4.2 4.2 0 0 0 11.6 10.2 3.6 3.6 0 1 0 10 17.4h8.5a2.8 2.8 0 0 0 1.5-4.9z"/><g stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"><path d="M11 19.5l-1 2.5"/><path d="M16 19.5l-1 2.5"/></g></svg>',
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M20 11A4.8 4.8 0 0 0 11 8.5a4.2 4.2 0 1 0-1.5 8H19a3 3 0 0 0 1-5.5z"/><g stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"><path d="M9 18.5l-1 3"/><path d="M15 18.5l-1 3"/></g></svg>',
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M20 10A4.8 4.8 0 0 0 11 7.5a4.2 4.2 0 1 0-1.5 8H19a3 3 0 0 0 1-5.5z"/><g stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"><path d="M8 17.5l-1.5 4"/><path d="M12 17.5l-1.5 4"/><path d="M16 17.5l-1.5 4"/></g></svg>',
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M20 9.5A4.8 4.8 0 0 0 11 7a4.2 4.2 0 1 0-1.5 8H19a3 3 0 0 0 1-5.5z"/><g stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"><path d="M7 16.5L5 22"/><path d="M11 16.5L9 22"/><path d="M15 16.5L13 22"/><path d="M19 16.5L17 22"/></g></svg>',
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M20 9.5A4.8 4.8 0 0 0 11 7a4.2 4.2 0 1 0-1.5 8H19a3 3 0 0 0 1-5.5z"/><path d="M12 14.5l-3.2 5.5h3l-1.4 4.2 5.4-6.4h-3.2l2-3.3z" fill="#ffe082" stroke="#1a1f50" stroke-width=".7" stroke-linejoin="round"/></svg>',
];

function skyIcon(idx) { return SKY_ICONS[idx] || ''; }

const GRIP_OPTS = [
    ['preset:SATURATED.RRBIN','Saturated'],['preset:HEAVY.RRBIN','Heavy'],
    ['preset:MEDIUM.RRBIN','Medium'],['preset:LIGHT.RRBIN','Light'],['preset:GREEN.RRBIN','Green'],
];

const SESSION_META = {
    practice:   { label: 'Practice',   eyebrow: '01' },
    qualifying: { label: 'Qualifying', eyebrow: '02' },
    race:       { label: 'Race',        eyebrow: '03' },
};

function fmtLength(min) { const h = Math.floor(min / 60), m = min % 60; return h > 0 ? `${h}h ${m}m` : `${m} min`; }
function fmtTime(m) { m = ((m % 1440) + 1440) % 1440; const h = Math.floor(m / 60), mm = String(m % 60).padStart(2, '0'); return `${String(h).padStart(2, '0')}:${mm}`; }

function renderSlot(slot, idx, editable) {
    return `<div class="wx-slot ${editable ? '' : 'disabled'}" data-sky="${slot.sky}" data-slot="${idx}">
    <div class="wx-slot-idx">${idx + 1}</div>
    <div class="wx-slot-icon">${skyIcon(slot.sky)}</div>
    <div class="wx-slot-temp">${slot.temperature}°</div>
    <div class="wx-slot-rain">${slot.rainChance}%</div>
  </div>`;
}

// Effective slot values shown in the timeline. For 'dry' / 'overcast_rain'
// presets the timeline displays the preset's fixed values for all 5 slots,
// matching what the launch payload sends. The user's customWeather array
// stays in state so they can switch back to Custom and recover their config.
function effectiveSlotsFor(session) {
    if (session.weatherPreset === 'overcast_rain') {
        return Array.from({ length: 5 }, () => ({ sky: 8, rainChance: 100, temperature: 20 }));
    }
    if (session.weatherPreset === 'custom') {
        return session.customWeather;
    }
    return Array.from({ length: 5 }, () => ({ sky: 0, rainChance: 0, temperature: 20 }));
}

// Length cap per session: Practice 6h, Qualifying 1h, Race 24h.
function lengthMaxFor(sessionKey) {
    if (sessionKey === 'race') return 1440;
    if (sessionKey === 'qualifying') return 60;
    return 360;
}

function buildSession(sk) {
    const s = state.overrides.sessions[sk];
    const meta = SESSION_META[sk];
    const isRace = sk === 'race';
    const isCustom = s.weatherPreset === 'custom';
    const grip = s.startingGrip;
    const realRoad = s.realRoadTimeScale;
    return `<div class="session-card" data-session="${sk}" data-enabled="${s.enabled}">
    <div class="session-head">
      <span class="session-name"><span class="sn-eyebrow">${meta.eyebrow}</span>${meta.label}</span>
      <label class="sess-switch">
        <input type="checkbox" ${s.enabled ? 'checked' : ''} data-session="${sk}" data-toggle />
        <span class="sess-switch-track"><span class="sess-switch-thumb"></span></span>
      </label>
    </div>
    <div class="session-body">
      <div class="wx-block">
        <div class="sg-title">Weather</div>
        <div class="wx-preset-row">
          <button class="wx-pill ${s.weatherPreset === 'dry' ? 'active' : ''}" data-preset="dry">${skyIcon(0)}Dry</button>
          <button class="wx-pill ${s.weatherPreset === 'overcast_rain' ? 'active' : ''}" data-preset="overcast_rain">${skyIcon(8)}Wet</button>
          <button class="wx-pill ${s.weatherPreset === 'custom' ? 'active' : ''}" data-preset="custom"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20v-8"/><path d="M9 15l3-3 3 3"/><path d="M5 4h14"/><path d="M5 8h14"/></svg>Custom</button>
        </div>
        <div class="wx-timeline">
          ${effectiveSlotsFor(s).map((slot, i) => renderSlot(slot, i, isCustom)).join('')}
        </div>
        <div class="wx-editor" data-editor>
          <div class="wxe-head">
            <div class="wxe-title">
              <span class="eyebrow">Slot <span data-slot-num>1</span> / 5 · <span data-slot-time>00:00 → 01:00</span></span>
              <h4 data-slot-skyname>Clear</h4>
            </div>
            <button class="wxe-close" data-close>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          </div>
          <div>
            <div class="sg-title" style="margin-bottom:6px">Sky condition</div>
            <div class="wxe-sky-grid">
              ${SKY_OPTS.map((label, i) => `<button class="wxe-sky" data-sky-idx="${i}" title="${label}"><span class="wxe-sky-icon" data-sky-icon-idx="${i}">${skyIcon(i)}</span><span class="wxe-sky-num">${i}</span></button>`).join('')}
            </div>
          </div>
          <div class="wxe-grid">
            <div class="wxe-num">
              <div class="wxe-num-head"><span class="lbl">Air temperature</span><span class="val" data-temp-val>22<span class="unit">°C</span></span></div>
              <input type="range" min="-5" max="45" value="22" data-edit="temp" />
            </div>
            <div class="wxe-num">
              <div class="wxe-num-head"><span class="lbl">Rain chance</span><span class="val" data-rain-val>0<span class="unit">%</span></span></div>
              <input type="range" min="0" max="100" value="0" data-edit="rain" />
            </div>
          </div>
          <div class="wxe-actions">
            <button class="wxe-action" data-action="apply-forward">Apply to next slots<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg></button>
            <button class="wxe-action" data-action="apply-all">Apply to all slots</button>
            <button class="wxe-action primary" data-action="apply-all-sessions"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>Apply to all sessions</button>
          </div>
        </div>
      </div>

      <div class="sg-title">Length &amp; timing</div>
      ${isRace ? `<label class="field"><span class="field-label">Start type</span>
        <select class="select" data-field="startType"><option value="rolling" ${(s.startType || 'rolling') === 'rolling' ? 'selected' : ''}>Rolling</option><option value="fast_rolling" ${(s.startType || '') === 'fast_rolling' ? 'selected' : ''}>Fast Rolling</option></select></label>` : ''}
      <div class="slider-row">
        <div class="slider-label"><span class="lbl">Length</span><span class="val">${fmtLength(s.length)}</span></div>
        <input type="range" min="1" max="${lengthMaxFor(sk)}" value="${s.length}" data-field="length" />
      </div>
      <div class="slider-row">
        <div class="slider-label"><span class="lbl">Start time</span><span class="val">${fmtTime(s.startTime)}</span></div>
        <input type="range" min="0" max="1439" value="${s.startTime}" data-field="startTime" />
      </div>

      <div class="sg-title">Track conditions</div>
      <div class="sess-2col">
        <label class="field">
          <span class="field-label">Grip</span>
          <select class="select" data-field="startingGrip">${GRIP_OPTS.map(([v, l]) => `<option value="${v}" ${v === grip ? 'selected' : ''}>${l}</option>`).join('')}</select>
        </label>
        <div class="slider-row">
          <div class="slider-label"><span class="lbl">RealRoad</span><span class="val">${realRoad}×</span></div>
          <input type="range" min="0" max="15" value="${realRoad}" data-field="realRoadTimeScale" />
        </div>
      </div>

      ${!isRace ? `<label class="field-toggle">
        <span class="field-label">Private session</span>
        <label class="sess-switch"><input type="checkbox" ${s.privateSession ? 'checked' : ''} data-field="privateSession" /><span class="sess-switch-track"><span class="sess-switch-thumb"></span></span></label>
      </label>` : ''}
    </div>
  </div>`;
}

function renderAllSessions() {
    const list = $('sessionsList');
    if (!list) return;
    list.innerHTML = Object.keys(state.overrides.sessions).map(buildSession).join('');
    bindSessionCards();
    enhanceSelects(list);
}

function bindSessionCards() {
    // Enable toggles
    document.querySelectorAll('input[data-toggle]').forEach((cb) => {
        cb.addEventListener('change', () => {
            const card = cb.closest('.session-card');
            const sk = card.dataset.session;
            state.overrides.sessions[sk].enabled = cb.checked;
            if (card) card.dataset.enabled = String(cb.checked);
            updateSummary();
        });
    });

    // Preset pills
    document.querySelectorAll('.wx-pill').forEach((p) => {
        p.addEventListener('click', () => {
            const row = p.parentElement;
            row.querySelectorAll('.wx-pill').forEach((x) => x.classList.remove('active'));
            p.classList.add('active');
            const card = p.closest('.session-card');
            const sk = card.dataset.session;
            const preset = p.dataset.preset;
            state.overrides.sessions[sk].weatherPreset = preset;
            // Re-render timeline so Dry/Wet show their fixed values, Custom shows user's slots.
            const isCustom = preset === 'custom';
            const tl = card.querySelector('.wx-timeline');
            const slots = effectiveSlotsFor(state.overrides.sessions[sk]);
            tl.innerHTML = slots.map((slot, i) => renderSlot(slot, i, isCustom)).join('');
            // Close any open editor in this card (slots got replaced).
            const ed = card.querySelector('.wx-editor');
            if (ed) ed.classList.remove('open');
            // Re-bind slot click handlers since we replaced the DOM.
            tl.querySelectorAll('.wx-slot').forEach((slotEl) => {
                slotEl.addEventListener('click', () => {
                    if (slotEl.classList.contains('disabled')) return;
                    openEditor(slotEl);
                });
            });
            setDirty(true);
            updateSummary();
        });
    });

    // Slot click → open editor
    document.querySelectorAll('.wx-slot').forEach((slotEl) => {
        slotEl.addEventListener('click', () => {
            if (slotEl.classList.contains('disabled')) return;
            openEditor(slotEl);
        });
    });

    // Editor interactions (per-card)
    document.querySelectorAll('.wx-editor').forEach((ed) => {
        ed.querySelector('[data-close]').addEventListener('click', () => {
            ed.classList.remove('open');
            ed.closest('.session-card').querySelectorAll('.wx-slot.active').forEach((x) => x.classList.remove('active'));
        });

        // Sky picker
        ed.querySelectorAll('.wxe-sky').forEach((b) => {
            b.addEventListener('click', () => {
                ed.querySelectorAll('.wxe-sky').forEach((x) => x.classList.remove('active'));
                b.classList.add('active');
                const idx = +b.dataset.skyIdx;
                const card = ed.closest('.session-card');
                const activeSlot = card.querySelector('.wx-slot.active');
                if (activeSlot) {
                    activeSlot.dataset.sky = idx;
                    activeSlot.querySelector('.wx-slot-icon').innerHTML = skyIcon(idx);
                    ed.querySelector('[data-slot-skyname]').textContent = SKY_OPTS[idx];
                    const sk = card.dataset.session;
                    const slotIdx = +activeSlot.dataset.slot;
                    state.overrides.sessions[sk].customWeather[slotIdx].sky = idx;
                    applyRainAvailability(ed, idx, sk, slotIdx);
                    setDirty(true);
                    updateSummary();
                }
            });
        });

        // Temp slider
        ed.querySelector('[data-edit="temp"]').addEventListener('input', (e) => {
            ed.querySelector('[data-temp-val]').innerHTML = e.target.value + '<span class="unit">°C</span>';
            updateRangeFill(e.target);
            const card = ed.closest('.session-card');
            const activeSlot = card.querySelector('.wx-slot.active');
            if (activeSlot) {
                activeSlot.querySelector('.wx-slot-temp').textContent = e.target.value + '°';
                const sk = card.dataset.session;
                state.overrides.sessions[sk].customWeather[+activeSlot.dataset.slot].temperature = +e.target.value;
                setDirty(true);
                updateSummary();
            }
        });

        // Rain slider
        ed.querySelector('[data-edit="rain"]').addEventListener('input', (e) => {
            ed.querySelector('[data-rain-val]').innerHTML = e.target.value + '<span class="unit">%</span>';
            updateRangeFill(e.target);
            const card = ed.closest('.session-card');
            const activeSlot = card.querySelector('.wx-slot.active');
            if (activeSlot) {
                activeSlot.querySelector('.wx-slot-rain').textContent = e.target.value + '%';
                const sk = card.dataset.session;
                state.overrides.sessions[sk].customWeather[+activeSlot.dataset.slot].rainChance = +e.target.value;
                setDirty(true);
                updateSummary();
            }
        });

        // Action buttons (apply-forward, apply-all, apply-all-sessions)
        ed.querySelectorAll('.wxe-action').forEach((btn) => {
            btn.addEventListener('click', () => {
                const card = ed.closest('.session-card');
                const sk = card.dataset.session;
                const sess = state.overrides.sessions[sk];
                const activeSlot = card.querySelector('.wx-slot.active');
                if (!activeSlot) return;
                const idx = +activeSlot.dataset.slot;
                const src = { ...sess.customWeather[idx] };
                const action = btn.dataset.action;

                function applySlotEl(targetSk, i) {
                    state.overrides.sessions[targetSk].customWeather[i] = { ...src };
                    const c = document.querySelector(`.session-card[data-session="${targetSk}"]`);
                    const sl = c && c.querySelector(`.wx-slot[data-slot="${i}"]`);
                    if (sl) {
                        sl.dataset.sky = src.sky;
                        sl.querySelector('.wx-slot-icon').innerHTML = skyIcon(src.sky);
                        sl.querySelector('.wx-slot-temp').textContent = src.temperature + '°';
                        sl.querySelector('.wx-slot-rain').textContent = src.rainChance + '%';
                    }
                }

                if (action === 'apply-forward') {
                    for (let i = idx + 1; i < 5; i++) applySlotEl(sk, i);
                } else if (action === 'apply-all') {
                    for (let i = 0; i < 5; i++) if (i !== idx) applySlotEl(sk, i);
                } else if (action === 'apply-all-sessions') {
                    Object.keys(state.overrides.sessions).forEach((tsk) => {
                        for (let i = 0; i < 5; i++) {
                            if (!(tsk === sk && i === idx)) applySlotEl(tsk, i);
                        }
                    });
                }
                setDirty(true);
                updateSummary();
            });
        });
    });

    // Session field inputs (ranges, selects, checkboxes)
    document.querySelectorAll('.session-card input[data-field], .session-card select[data-field]').forEach((el) => {
        const field = el.dataset.field;
        if (!field) return;
        const card = el.closest('.session-card');
        const sk = card.dataset.session;
        const sliderRow = el.closest('.slider-row');
        const valEl = sliderRow && sliderRow.querySelector('.val');

        const update = () => {
            const raw = el.type === 'checkbox' ? el.checked : el.value;
            let v = (el.type === 'range' || field === 'realRoadTimeScale') ? Number(raw) : raw;
            state.overrides.sessions[sk][field] = v;
            if (valEl) {
                if (field === 'length') valEl.textContent = fmtLength(Number(raw));
                else if (field === 'startTime') valEl.textContent = fmtTime(Number(raw));
                else if (field === 'realRoadTimeScale') valEl.textContent = raw + '×';
            }
            if (el.type === 'range') updateRangeFill(el);
            setDirty(true);
            updateSummary();
        };

        el.addEventListener(el.type === 'checkbox' ? 'change' : (el.type === 'range' ? 'input' : 'change'), update);
        if (el.type === 'range') updateRangeFill(el);
    });
}

function openEditor(slotEl) {
    const card = slotEl.closest('.session-card');
    const editor = card.querySelector('[data-editor]');
    const tl = slotEl.parentElement;
    card.querySelectorAll('.wx-slot.active').forEach((x) => x.classList.remove('active'));
    slotEl.classList.add('active');

    // arrow position: align under the clicked slot
    const slotRect = slotEl.getBoundingClientRect();
    const tlRect = tl.getBoundingClientRect();
    const arrowLeft = slotRect.left - tlRect.left + slotRect.width / 2 - 4;
    editor.style.setProperty('--arrow-left', arrowLeft + 'px');

    const idx = +slotEl.dataset.slot;
    const sk = card.dataset.session;
    const sess = state.overrides.sessions[sk];
    const slotData = sess.customWeather[idx];

    editor.querySelector('[data-slot-num]').textContent = idx + 1;
    editor.querySelector('[data-slot-skyname]').textContent = SKY_OPTS[slotData.sky];

    const segLen = sess.length / 5;
    const segStart = sess.startTime + Math.round(segLen * idx);
    const segEnd = sess.startTime + Math.round(segLen * (idx + 1));
    editor.querySelector('[data-slot-time]').textContent = `${fmtTime(segStart)} → ${fmtTime(segEnd)}`;

    editor.querySelectorAll('.wxe-sky').forEach((b) => {
        b.classList.toggle('active', +b.dataset.skyIdx === slotData.sky);
    });
    const tempIn = editor.querySelector('[data-edit="temp"]');
    tempIn.value = slotData.temperature;
    editor.querySelector('[data-temp-val]').innerHTML = slotData.temperature + '<span class="unit">°C</span>';
    updateRangeFill(tempIn);
    const rainIn = editor.querySelector('[data-edit="rain"]');
    rainIn.value = slotData.rainChance;
    editor.querySelector('[data-rain-val]').innerHTML = slotData.rainChance + '<span class="unit">%</span>';
    updateRangeFill(rainIn);

    applyRainAvailability(editor, slotData.sky, sk, idx);

    editor.classList.add('open');
}

// Sky values 0..4 (Clear → Overcast) are dry by definition — disable
// the rain-chance slider and force the slot to 0% rain. Slider becomes
// editable again from value 5 (Cloudy & drizzle) onwards.
function applyRainAvailability(editor, sky, sessKey, slotIdx) {
    const rainIn = editor.querySelector('[data-edit="rain"]');
    if (!rainIn) return;
    const rainNum = rainIn.closest('.wxe-num');
    const allowed = Number(sky) >= 5;
    rainIn.disabled = !allowed;
    if (rainNum) rainNum.classList.toggle('is-disabled', !allowed);
    if (!allowed) {
        rainIn.value = 0;
        editor.querySelector('[data-rain-val]').innerHTML = '0<span class="unit">%</span>';
        updateRangeFill(rainIn);
        if (sessKey != null && slotIdx != null) {
            const slot = state.overrides.sessions[sessKey]?.customWeather?.[slotIdx];
            if (slot && slot.rainChance !== 0) {
                slot.rainChance = 0;
                const card = editor.closest('.session-card');
                const slotEl = card?.querySelector(`.wx-slot[data-slot="${slotIdx}"]`);
                if (slotEl) slotEl.querySelector('.wx-slot-rain').textContent = '0%';
                updateSummary();
            }
        }
    }
}

// ───────── Preset Management (file-based IPC) ─────────

function snapshotCurrentSessions() {
    // Deep-clone the full sessions config so loading restores everything.
    return JSON.parse(JSON.stringify(state.overrides.sessions));
}

function applyPresetConfig(config) {
    // config is state.overrides.sessions shape: { practice: {...}, qualifying: {...}, race: {...} }
    Object.keys(config).forEach((sk) => {
        if (state.overrides.sessions[sk]) {
            state.overrides.sessions[sk] = JSON.parse(JSON.stringify(config[sk]));
        }
    });
    renderAllSessions();
    updateSummary();
}

let activePresetFile = null;
let isDirty = false;

function setDirty(d) {
    isDirty = d;
    const bar = document.querySelector('.preset-bar');
    if (bar) bar.classList.toggle('is-dirty', d);
}

function setActivePreset(p) {
    activePresetFile = p ? (p.file || null) : null;
    const nameEl = $('presetName');
    if (nameEl) nameEl.textContent = p ? p.name : 'Custom';
    setDirty(false);
}

async function buildPresetMenu() {
    const presetMenu = $('presetMenu');
    if (!presetMenu) return;
    const list = await window.go.presetsList();
    let html = '';
    if (list.length) {
        html += list.map((p) => presetItemHtml(p)).join('');
    } else {
        html += '<div class="preset-menu-empty">No saved presets</div>';
    }
    presetMenu.innerHTML = html;

    presetMenu.querySelectorAll('.preset-item').forEach((el) => {
        el.addEventListener('click', async (e) => {
            if (e.target.closest('.pi-del')) return;
            const file = el.dataset.file;
            const r = await window.go.presetsLoad(file);
            if (r.ok && r.data && r.data.config) {
                applyPresetConfig(r.data.config);
                setActivePreset({ file, name: r.data.name, createdAt: r.data.createdAt });
            }
            closePresetMenu();
        });
        const delBtn = el.querySelector('.pi-del');
        if (delBtn) {
            delBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const file = el.dataset.file;
                const r = await window.go.presetsDelete(file);
                if (r.ok) buildPresetMenu();
            });
        }
    });
}

function presetItemHtml(p) {
    const active = p.file === activePresetFile ? 'active' : '';
    const del = `<button class="pi-del" title="Delete"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="m19 6-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></button>`;
    return `<div class="preset-item ${active}" data-file="${p.file}"><span class="pi-name">${p.name}</span>${del}</div>`;
}

function openPresetMenu() {
    const presetSelect = $('presetSelect');
    const presetMenu = $('presetMenu');
    if (!presetSelect || !presetMenu) return;
    buildPresetMenu();
    const r = presetSelect.getBoundingClientRect();
    presetMenu.style.left = r.left + 'px';
    presetMenu.style.top = (r.bottom + 6) + 'px';
    presetMenu.classList.add('open');
    presetSelect.classList.add('open');
}

function closePresetMenu() {
    const presetMenu = $('presetMenu');
    const presetSelect = $('presetSelect');
    if (presetMenu) presetMenu.classList.remove('open');
    if (presetSelect) presetSelect.classList.remove('open');
}

function initPresetBar() {
    const presetSelect = $('presetSelect');
    const presetMenu = $('presetMenu');
    const saveModal = $('savePresetModal');
    const saveInput = $('savePresetInput');

    if (presetSelect) {
        presetSelect.addEventListener('click', () => {
            presetMenu && presetMenu.classList.contains('open') ? closePresetMenu() : openPresetMenu();
        });
    }

    document.addEventListener('click', (e) => {
        const bar = e.target.closest('.preset-bar');
        const menu = e.target.closest('.preset-menu');
        if (!bar && !menu) closePresetMenu();
    });

    // Save preset modal
    const presetSaveBtn = $('presetSave');
    if (presetSaveBtn) {
        presetSaveBtn.addEventListener('click', () => {
            if (saveInput) saveInput.value = '';
            if (saveModal) {
                saveModal.classList.add('open');
                setTimeout(() => saveInput && saveInput.focus(), 50);
            }
        });
    }

    if (saveModal) {
        saveModal.addEventListener('click', async (e) => {
            if (e.target === saveModal || e.target.dataset.action === 'cancel') {
                saveModal.classList.remove('open');
            }
            if (e.target.dataset.action === 'save') {
                const name = saveInput ? saveInput.value.trim() : '';
                if (!name) return;
                const r = await window.go.presetsSave(name, snapshotCurrentSessions());
                if (r.ok) {
                    setActivePreset({ file: r.file, name, createdAt: Date.now() });
                    saveModal.classList.remove('open');
                    // Refresh menu if open
                    if (presetMenu && presetMenu.classList.contains('open')) buildPresetMenu();
                } else {
                    alert('Failed to save preset: ' + r.error);
                }
            }
        });
    }

    if (saveInput) {
        saveInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const saveBtn = saveModal && saveModal.querySelector('[data-action="save"]');
                if (saveBtn) saveBtn.click();
            }
        });
    }

    // Export (download current config as .json — kept for quick sharing)
    const presetExport = $('presetExport');
    if (presetExport) {
        presetExport.addEventListener('click', () => {
            const nameEl = $('presetName');
            const name = (nameEl && nameEl.textContent) || 'Custom';
            const data = { name, config: snapshotCurrentSessions() };
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = name.replace(/[^a-z0-9\-_ ]/gi, '_') + '.json';
            a.click();
        });
    }

    // Open presets folder
    const openFolderBtn = $('presetOpenFolder');
    if (openFolderBtn) {
        openFolderBtn.addEventListener('click', () => window.go.presetsOpenFolder());
    }

    // Load preset (formerly Import) — uses native file picker defaulting to presets folder
    const presetImport = $('presetImport');
    if (presetImport) {
        presetImport.addEventListener('click', async () => {
            const picked = await window.go.presetsPickFile();
            if (picked.canceled) return;
            const loaded = await window.go.presetsLoadFromPath(picked.path);
            if (loaded.ok && loaded.data && loaded.data.config) {
                applyPresetConfig(loaded.data.config);
                setActivePreset({ file: null, name: loaded.data.name || 'Loaded', createdAt: loaded.data.createdAt || Date.now() });
            } else {
                alert('Invalid preset file');
            }
        });
    }

    setActivePreset(null);
}

// ───────── Rules modal ─────────
const RULES_DEFAULTS = { timeScale: 0, flagRules: '3', trackLimitsRules: '1', trackLimitsPoints: 5, mechanicalFailures: '1', tireWarmers: true };
const TIME_SCALE_LABELS = ['None', 'Normal', '×2'];

function initRulesModal() {
    const rulesOverlay = $('rulesOverlay');
    const rulesBtn = $('rulesBtn');
    const rulesBtnDot = $('rulesBtnDot');
    const rulesClose = $('rulesClose');
    const rulesDone = $('rulesDone');
    const rulesReset = $('rulesReset');
    const elTimeScale = $('timeScale');
    const elTimeScaleVal = $('timeScaleVal');
    const elFlagRules = $('flagRules');
    const elTrackLimitsRules = $('trackLimitsRules');
    const elTrackLimitsPoints = $('trackLimitsPoints');
    const elTrackLimitsPointsVal = $('trackLimitsPointsVal');
    const elMechFail = $('mechanicalFailures');
    const elTireWarmers = $('tireWarmers');
    const incidentField = $('incidentField');

    if (!rulesOverlay || !rulesBtn) return;

    function readRules() {
        return {
            timeScale: +elTimeScale.value,
            flagRules: elFlagRules.value,
            trackLimitsRules: elTrackLimitsRules.value,
            trackLimitsPoints: +elTrackLimitsPoints.value,
            mechanicalFailures: elMechFail.value,
            tireWarmers: elTireWarmers.checked,
        };
    }

    function writeRules(r) {
        elTimeScale.value = r.timeScale;
        elFlagRules.value = r.flagRules;
        elTrackLimitsRules.value = r.trackLimitsRules;
        elTrackLimitsPoints.value = r.trackLimitsPoints;
        elMechFail.value = r.mechanicalFailures;
        elTireWarmers.checked = r.tireWarmers;
        syncRulesUI();
    }

    function isModified() {
        const r = readRules();
        return Object.keys(RULES_DEFAULTS).some((k) => String(r[k]) !== String(RULES_DEFAULTS[k]));
    }

    function syncRulesUI() {
        [elTimeScale, elTrackLimitsPoints].forEach((s) => {
            if (!s) return;
            const min = +s.min, max = +s.max, v = +s.value;
            s.style.setProperty('--fill', ((v - min) / (max - min) * 100) + '%');
            updateRangeFill(s);
        });
        if (elTimeScaleVal) elTimeScaleVal.textContent = TIME_SCALE_LABELS[+elTimeScale.value] || formatTimeScale(+elTimeScale.value);
        if (elTrackLimitsPointsVal) elTrackLimitsPointsVal.textContent = elTrackLimitsPoints.value;
        if (incidentField) incidentField.classList.toggle('is-disabled', elTrackLimitsRules.value === '0');
        if (rulesBtnDot) rulesBtnDot.hidden = !isModified();

        // Sync to state
        const r = readRules();
        state.overrides.timeScale = r.timeScale;
        state.overrides.flagRules = Number(r.flagRules);
        state.overrides.trackLimitsRules = Number(r.trackLimitsRules);
        state.overrides.trackLimitsPoints = r.trackLimitsPoints;
        state.overrides.mechanicalFailures = Number(r.mechanicalFailures);
        state.overrides.tireWarmers = r.tireWarmers;
        updateSummary();
    }

    [elTimeScale, elFlagRules, elTrackLimitsRules, elTrackLimitsPoints, elMechFail, elTireWarmers].forEach((el) => {
        if (el) {
            el.addEventListener('input', syncRulesUI);
            el.addEventListener('change', syncRulesUI);
        }
    });

    rulesBtn.addEventListener('click', () => { rulesOverlay.hidden = false; syncRulesUI(); });

    function closeRules() { rulesOverlay.hidden = true; }
    if (rulesClose) rulesClose.addEventListener('click', closeRules);
    if (rulesDone) rulesDone.addEventListener('click', closeRules);
    rulesOverlay.addEventListener('click', (e) => { if (e.target === rulesOverlay) closeRules(); });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !rulesOverlay.hidden) closeRules();
    });
    if (rulesReset) rulesReset.addEventListener('click', () => writeRules(RULES_DEFAULTS));

    syncRulesUI();
}

// ───────── Launch ─────────
async function onLaunch() {
    const trackSelect = $('trackSelect');
    if (!trackSelect.value) {
        logLine('Select a track first.', 'err');
        return;
    }

    const layoutSelect = $('layoutSelect');
    const layoutOpt = layoutSelect && layoutSelect.selectedOptions[0];
    const trackOpt = trackSelect.selectedOptions[0];

    const payload = {
        track: {
            id: layoutOpt ? layoutOpt.dataset.id || null : null,
            folder: layoutOpt ? layoutOpt.value.split('::')[0] || null : trackSelect.value,
            sceneDesc: layoutOpt ? layoutOpt.dataset.sceneDesc || null : null,
            locationToken: layoutOpt ? layoutOpt.dataset.locationToken || null : null,
            layoutToken: layoutOpt ? layoutOpt.dataset.layoutToken || null : null,
            label: trackOpt ? trackOpt.textContent : '',
        },
        overrides: {
            ...state.overrides,
            mechanicalFailures: Number($('mechanicalFailures')?.value ?? state.overrides.mechanicalFailures),
        },
    };
    $('launchBtn').disabled = true;
    const log = $('log');
    if (log) { log.innerHTML = ''; log.classList.remove('hidden'); }
    const logToggle = $('logToggle');
    if (logToggle) logToggle.classList.add('open');
    logLine(`Launching with "${payload.overrides.sessions?.practice?.weatherPreset ?? 'dry'}" preset…`, 'ok');

    try {
        const result = await window.go.launch(payload);
        if (result?.ok) {
            logLine('Session loaded. Switch to LMU.', 'ok');
        } else {
            logLine(result?.error || 'Launch failed.', 'err');
        }
    } catch (e) {
        logLine(e.message || String(e), 'err');
    } finally {
        $('launchBtn').disabled = false;
        await pollStatus();
    }
}

// ───────── Status polling ─────────
async function pollStatus() {
    try {
        const state = await window.go.getLmuNavState();
        setStatus(state);
        if (state?.alive) refreshLiveTracks();
    } catch {
        setStatus({ alive: false });
    }
}

// ───────── Custom dropdown enhancer ─────────
function enhanceSelects(root = document) {
    const selects = root.querySelectorAll('select.select:not([data-cdd-enhanced]), select.s-select:not([data-cdd-enhanced])');
    selects.forEach((sel) => {
        sel.setAttribute('data-cdd-enhanced', '1');
        const wrapper = document.createElement('div');
        wrapper.className = 'cdd';
        if (sel.style.flex) wrapper.style.flex = sel.style.flex;
        sel.classList.add('cdd-native');

        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'cdd-trigger';
        trigger.setAttribute('aria-haspopup', 'listbox');
        trigger.setAttribute('aria-expanded', 'false');
        trigger.innerHTML = `<span class="cdd-value"></span><svg class="cdd-chev" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4.75l3 3 3-3"/></svg>`;
        const valueEl = trigger.querySelector('.cdd-value');

        const menu = document.createElement('div');
        menu.className = 'cdd-menu';
        menu.setAttribute('role', 'listbox');

        const optionEls = [];
        Array.from(sel.options).forEach((opt, i) => {
            const o = document.createElement('div');
            o.className = 'cdd-option';
            o.setAttribute('role', 'option');
            o.dataset.index = String(i);
            o.innerHTML = `<span>${opt.textContent}</span><svg class="cdd-tick" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
            o.addEventListener('click', (e) => { e.stopPropagation(); selectIdx(i); close(); });
            menu.appendChild(o);
            optionEls.push(o);
        });

        function syncFromNative() {
            const i = sel.selectedIndex;
            valueEl.textContent = sel.options[i] ? sel.options[i].textContent : '';
            optionEls.forEach((el, idx) => el.classList.toggle('selected', idx === i));
            trigger.disabled = sel.disabled;
            trigger.classList.toggle('is-disabled', sel.disabled);
        }
        function selectIdx(i) {
            sel.selectedIndex = i;
            sel.dispatchEvent(new Event('change', { bubbles: true }));
            syncFromNative();
        }
        function positionMenu() {
            const rect = trigger.getBoundingClientRect();
            const menuH = menu.offsetHeight || 280;
            const spaceBelow = window.innerHeight - rect.bottom;
            const flip = spaceBelow < Math.min(menuH + 12, 200) && rect.top > spaceBelow;
            menu.style.left = rect.left + 'px';
            menu.style.width = '';
            menu.style.minWidth = rect.width + 'px';
            if (flip) {
                menu.style.top = '';
                menu.style.bottom = (window.innerHeight - rect.top + 6) + 'px';
            } else {
                menu.style.bottom = '';
                menu.style.top = (rect.bottom + 6) + 'px';
            }
        }
        function open() {
            if (sel.disabled) return;
            document.querySelectorAll('.cdd.open').forEach((c) => {
                if (c !== wrapper) { c.classList.remove('open'); if (c._cddMenu) c._cddMenu.classList.remove('open'); }
            });
            wrapper.classList.add('open');
            menu.classList.add('open');
            trigger.setAttribute('aria-expanded', 'true');
            positionMenu();
            const sel2 = menu.querySelector('.cdd-option.selected');
            if (sel2) sel2.scrollIntoView({ block: 'nearest' });
            window.addEventListener('scroll', positionMenu, true);
            window.addEventListener('resize', positionMenu);
        }
        function close() {
            wrapper.classList.remove('open');
            menu.classList.remove('open');
            trigger.setAttribute('aria-expanded', 'false');
            activeIdx = -1;
            optionEls.forEach((el) => el.classList.remove('active'));
            window.removeEventListener('scroll', positionMenu, true);
            window.removeEventListener('resize', positionMenu);
        }
        let activeIdx = -1;
        function moveActive(delta) {
            const n = optionEls.length;
            activeIdx = activeIdx === -1 ? sel.selectedIndex : activeIdx;
            activeIdx = (activeIdx + delta + n) % n;
            optionEls.forEach((el, i) => el.classList.toggle('active', i === activeIdx));
            optionEls[activeIdx].scrollIntoView({ block: 'nearest' });
        }
        trigger.addEventListener('click', (e) => { e.stopPropagation(); wrapper.classList.contains('open') ? close() : open(); });
        trigger.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                if (!wrapper.classList.contains('open')) open();
                moveActive(e.key === 'ArrowDown' ? 1 : -1);
            } else if ((e.key === 'Enter' || e.key === ' ') && wrapper.classList.contains('open') && activeIdx !== -1) {
                e.preventDefault(); selectIdx(activeIdx); close();
            } else if (e.key === 'Escape') { close(); }
        });
        sel.parentNode.insertBefore(wrapper, sel);
        wrapper.appendChild(sel);
        wrapper.appendChild(trigger);
        document.body.appendChild(menu);
        wrapper._cddMenu = menu;
        syncFromNative();
        sel.addEventListener('change', syncFromNative);
    });
}

// Destroy and re-create the cdd wrapper for a select (call after options change)
function rebuildCdd(sel) {
    const cdd = sel.closest('.cdd');
    if (!cdd) return;
    const oldMenu = cdd._cddMenu;
    if (oldMenu && oldMenu.parentNode) oldMenu.parentNode.removeChild(oldMenu);
    cdd.parentNode.insertBefore(sel, cdd);
    cdd.parentNode.removeChild(cdd);
    sel.removeAttribute('data-cdd-enhanced');
    sel.classList.remove('cdd-native');
    enhanceSelects(sel.parentNode);
}

document.addEventListener('click', (e) => {
    document.querySelectorAll('.cdd.open').forEach((c) => {
        const m = c._cddMenu;
        if (!c.contains(e.target) && (!m || !m.contains(e.target))) {
            c.classList.remove('open');
            if (m) m.classList.remove('open');
            const trig = c.querySelector('.cdd-trigger');
            if (trig) trig.setAttribute('aria-expanded', 'false');
        }
    });
});

// ───────── Boot ─────────
document.addEventListener('DOMContentLoaded', () => {
    // Populate About & Logs version row
    (async () => {
        try {
            const v = await window.go.getVersion();
            const ver = $('aboutVersion');
            const upd = $('aboutUpdated');
            if (ver) ver.textContent = v.version;
            if (upd) upd.textContent = v.buildDate;
        } catch {}
    })();

    // Load persisted livery name overrides
    (async () => {
        const saved = await window.go.getSetting('liveryNames');
        if (saved && typeof saved === 'object') liveryNames = saved;
    })();

    // Sessions v3 — render cards and bind all interactions
    renderAllSessions();
    initPresetBar();
    initRulesModal();

    // Track → layout cascade
    $('trackSelect').addEventListener('change', populateLayoutSelect);
    const layoutSel = $('layoutSelect');
    if (layoutSel) layoutSel.addEventListener('change', updateSummary);

    // Car panel
    $('carModelSelect').addEventListener('change', () => {
        setAutoDetect(false);
        populateLiveryDropdown();
    });
    $('carLiverySelect').addEventListener('change', () => {
        setAutoDetect(false);
        state.overrides.vehicleString = $('carLiverySelect').value || null;
        $('renameLiveryInline').style.display = 'none';
        syncRenameLiveryBtn();
        updateSummary();
    });
    $('autoDetectCar').addEventListener('click', () => setAutoDetect(true));
    $('renameLivery').addEventListener('click', () => {
        const sel = $('carLiverySelect');
        const car = state.cars.find((c) => c.name === sel?.value);
        if (!car) return;
        $('renameLiveryInput').value = liveryNames[car.id] || car.displayName;
        $('renameLivery').style.display = 'none';
        const inline = $('renameLiveryInline');
        inline.style.display = 'inline-flex';
        $('renameLiveryInput').focus();
        $('renameLiveryInput').select();
    });

    async function applyLiveryRename() {
        const sel = $('carLiverySelect');
        const car = state.cars.find((c) => c.name === sel?.value);
        const inline = $('renameLiveryInline');
        inline.style.display = 'none';
        if (!car) return;
        const newName = $('renameLiveryInput').value.trim();
        if (newName) {
            liveryNames[car.id] = newName;
        } else {
            delete liveryNames[car.id];
        }
        await window.go.setSetting('liveryNames', liveryNames);
        const carInState = state.cars.find((c) => c.id === car.id);
        if (carInState) carInState.displayName = liveryNames[car.id] || carInState.displayName;
        const prevVal = sel.value;
        populateLiveryDropdown();
        sel.value = prevVal;
        state.overrides.vehicleString = prevVal || null;
        rebuildCdd(sel);
        syncRenameLiveryBtn();
        updateSummary();
    }

    $('renameLiverySave').addEventListener('click', applyLiveryRename);
    $('renameLiveryCancel').addEventListener('click', () => {
        $('renameLiveryInline').style.display = 'none';
        syncRenameLiveryBtn();
    });
    $('renameLiveryInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') applyLiveryRename();
        if (e.key === 'Escape') { $('renameLiveryInline').style.display = 'none'; syncRenameLiveryBtn(); }
    });
    $('refreshCars').addEventListener('click', async () => {
        $('autoDetectLabel').textContent = 'Refreshing…';
        await refreshLiveCars(true);
        $('autoDetectLabel').textContent = `${state.cars.length} owned liveries.`;
    });
    setAutoDetect(true);

    // Re-fetch cars when our window regains focus.
    window.addEventListener('focus', () => refreshLiveCars(true));

    // Install pill
    $('installPillChange').addEventListener('click', pickInstallPath);

    // Open logs folder button
    const openLogsBtn = $('openLogsFolder');
    if (openLogsBtn) openLogsBtn.addEventListener('click', async () => {
        try { await window.go.openLogsFolder(); } catch (e) { logLine(`Open logs failed: ${e.message}`, 'err'); }
    });

    // Reset settings button
    const resetBtn = $('resetSettings');
    if (resetBtn) resetBtn.addEventListener('click', async () => {
        if (!confirm('Reset all settings? This will not delete telemetry files.')) return;
        try {
            const r = await window.go.resetAllSettings();
            if (r?.ok === false) { logLine(`Reset failed: ${r.error}`, 'err'); return; }
            window.location.reload();
        } catch (e) {
            logLine(`Reset failed: ${e.message}`, 'err');
        }
    });

    // Launch button
    $('launchBtn').addEventListener('click', onLaunch);
    // Log toggle (optional — may not be in v3 layout)
    const logToggleBtn = $('logToggle');
    if (logToggleBtn) {
        logToggleBtn.addEventListener('click', () => {
            const log = $('log');
            if (!log) return;
            const open = !log.classList.contains('hidden');
            log.classList.toggle('hidden', open);
            logToggleBtn.classList.toggle('open', !open);
        });
    }

    // Live log feed from main process.
    window.go.onLog((line) => {
        const isErr = /^ERROR/i.test(line);
        logLine(line, isErr ? 'err' : '');
    });

    // Enhance native selects with custom dropdowns
    enhanceSelects();

    loadInstall();
    pollStatus();
    setInterval(pollStatus, 5000);

    // Telemetry + drawer boot
    initTelemetry();
    initDrawer();
});

// ───────── Tab switching ─────────
function switchView(name) {
    const launcher = $('viewLauncher');
    const telemetry = $('viewTelemetry');
    document.querySelectorAll('.tab').forEach((t) => {
        const active = t.dataset.view === name;
        t.classList.toggle('active', active);
        t.setAttribute('aria-selected', String(active));
    });
    if (name === 'launcher') {
        launcher.style.display = 'grid';
        telemetry.style.display = 'none';
    } else {
        launcher.style.display = 'none';
        telemetry.style.display = 'grid';
    }
}

// ───────── Settings drawer ─────────
async function initDrawer() {
    const drawer = $('settingsDrawer');
    const backdrop = $('drawerBackdrop');
    const navBtns = document.querySelectorAll('#drawerNav button[data-sec]');
    const sections = document.querySelectorAll('.drawer-section[data-sec]');
    const toast = $('savedToast');
    let toastTimer;

    function openDrawer(secId) {
        drawer.classList.add('open');
        backdrop.classList.add('open');
        if (secId) selectSection(secId);
    }
    function closeDrawer() {
        drawer.classList.remove('open');
        backdrop.classList.remove('open');
    }
    function selectSection(id) {
        navBtns.forEach((b) => b.classList.toggle('active', b.dataset.sec === id));
        sections.forEach((s) => s.classList.toggle('active', s.dataset.sec === id));
        const content = $('drawerContent');
        if (content) content.scrollTop = 0;
    }

    window._openDrawer = openDrawer;

    function flashSaved() {
        toast.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toast.classList.remove('show'), 1100);
    }

    $('settingsBtn').addEventListener('click', () => openDrawer('auto'));
    $('drawerClose').addEventListener('click', closeDrawer);
    backdrop.addEventListener('click', closeDrawer);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && drawer.classList.contains('open')) closeDrawer();
    });

    navBtns.forEach((b) => b.addEventListener('click', () => selectSection(b.dataset.sec)));

    // Switches
    document.querySelectorAll('.s-switch').forEach((sw) => {
        sw.addEventListener('click', async () => {
            sw.classList.toggle('on');
            sw.setAttribute('aria-checked', sw.classList.contains('on'));
            flashSaved();
            // Auto-enable switch triggers watcher
            if (sw.id === 'setAutoEnable') {
                const on = sw.classList.contains('on');
                await window.go.setSetting('watcherEnabled', on);
                if (on) {
                    await startWatcher();
                } else {
                    await stopWatcher();
                }
            }
        });
    });

    // Segmented controls (output mode)
    const outMode = $('setOutMode');
    if (outMode) {
        outMode.querySelectorAll('button').forEach((b) => {
            b.addEventListener('click', async () => {
                outMode.querySelectorAll('button').forEach((x) => x.classList.remove('active'));
                b.classList.add('active');
                const custom = b.dataset.v === 'custom';
                $('setOutCustomRow').style.display = custom ? '' : 'none';
                await window.go.setSetting('outputMode', b.dataset.v);
                flashSaved();
            });
        });
    }

    // Browse buttons
    const browseWatchPath = $('browseWatchPath');
    if (browseWatchPath) {
        browseWatchPath.addEventListener('click', async () => {
            const result = await window.go.pickFolder({ title: 'Select watch folder' });
            if (result.canceled) return;
            $('setWatchPath').value = result.path;
            await window.go.setSetting('watchDir', result.path);
            updateWatcherCard();
            flashSaved();
            await refreshFirstRunCard();
        });
    }

    const detectBtn = $('detectWatchPath');
    if (detectBtn) {
        detectBtn.addEventListener('click', async () => {
            try {
                const defaultPath = await window.go.getDefaultWatchPath();
                $('setWatchPath').value = defaultPath;
                await window.go.setSetting('watchDir', defaultPath);
                flashSaved();
                await refreshFirstRunCard();
            } catch (err) {
                console.error('Failed to detect watch path:', err);
            }
        });
    }

    const browseOutPath = $('browseOutPath');
    if (browseOutPath) {
        browseOutPath.addEventListener('click', async () => {
            const result = await window.go.pickFolder({ title: 'Select output folder' });
            if (result.canceled) return;
            $('setOutPath').value = result.path;
            await window.go.setSetting('outputDir', result.path);
            flashSaved();
        });
    }

    const browseMotecExe = $('browseMotecExe');
    if (browseMotecExe) {
        browseMotecExe.addEventListener('click', async () => {
            const result = await window.go.pickFile({
                title: 'Select MoTeC i2 executable',
                filters: [{ name: 'Executables', extensions: ['exe'] }],
            });
            if (result.canceled) return;
            $('setMotecExe').value = result.path;
            await window.go.setSetting('motecExe', result.path);
            flashSaved();
        });
    }
    const browseWs = $('browseMotecWorkspace');
    if (browseWs) {
        browseWs.addEventListener('click', async () => {
            try {
                const result = await window.go.pickFile({
                    title: 'Select MoTeC workspace',
                    filters: [{ name: 'MoTeC workspace', extensions: ['w2k', 'i2wsp'] }],
                });
                if (result.canceled) return;
                $('setMotecWorkspace').value = result.path;
                await window.go.setSetting('motecWorkspace', result.path);
                flashSaved();
            } catch (err) {
                console.error('Failed to pick MoTeC workspace:', err);
            }
        });
    }
    const savedWorkspace = await window.go.getSetting('motecWorkspace');
    const wsInput = $('setMotecWorkspace');
    if (savedWorkspace && wsInput) wsInput.value = savedWorkspace;

    // Output naming tokens
    const namingInput = $('setNaming');
    const namingPreview = $('setNamingPreview');
    function updateNamingPreview() {
        if (!namingInput || !namingPreview) return;
        const sample = {
            '{date}': '2025-05-01', '{time}': '14-22', '{track}': 'Spa-Francorchamps',
            '{layout}': 'GP', '{car}': 'Ferrari-296-LMGT3', '{class}': 'LMGT3',
            '{driver}': 'Mateo-R', '{session}': 'Practice',
        };
        let out = namingInput.value;
        Object.entries(sample).forEach(([k, v]) => { out = out.replaceAll(k, v); });
        namingPreview.innerHTML = 'Preview · <b>' + (out || 'session') + '.ld</b>';
    }
    if (namingInput) {
        let namingSaveTimer;
        namingInput.addEventListener('input', () => {
            updateNamingPreview();
            clearTimeout(namingSaveTimer);
            namingSaveTimer = setTimeout(() => {
                window.go.setSetting('outputNamingTemplate', namingInput.value)
                    .catch(err => console.error('Failed to save naming template:', err));
            }, 300);
            flashSaved();
        });
    }
    document.querySelectorAll('.token-chip').forEach((chip) => {
        chip.addEventListener('click', () => {
            if (!namingInput) return;
            const pos = namingInput.selectionStart != null ? namingInput.selectionStart : namingInput.value.length;
            namingInput.value = namingInput.value.slice(0, pos) + (chip.dataset.tok || '') + namingInput.value.slice(pos);
            updateNamingPreview();
            window.go.setSetting('outputNamingTemplate', namingInput.value)
                .catch(err => console.error('Failed to save naming template:', err));
            flashSaved();
            namingInput.focus();
        });
    });
    const savedTemplate = await window.go.getSetting('outputNamingTemplate');
    if (savedTemplate && namingInput) namingInput.value = savedTemplate;
    updateNamingPreview();
}

// ───────── Telemetry state ─────────
const tlmState = {
    sessions: [],      // { ldPath, ldxPath, track, car, cls, fastest, laps, convertedAt, date, status }
    watcherRunning: false,
    filterMode: 'all', // 'all' | 'today' | 'week'
    searchQuery: '',
};

// True if `convertedAt` (epoch ms) falls between midnight today and now.
function isToday(t) {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    return t >= start.getTime();
}

// True if `convertedAt` falls within the last 7 days.
function isThisWeek(t) {
    return t >= Date.now() - 7 * 24 * 60 * 60 * 1000;
}

async function refreshFirstRunCard() {
    const card = document.getElementById('firstRunCard');
    if (!card) return;
    const watchDir = await window.go.getSetting('watchDir') || '';
    const dismissed = await window.go.getSetting('firstRunDismissed') || false;
    const show = !watchDir && !dismissed;
    card.style.display = show ? '' : 'none';
    // Toggle the grid template so the firstrun row isn't reserved when hidden.
    const tlm = document.getElementById('viewTelemetry');
    if (tlm) tlm.classList.toggle('show-firstrun', show);
}

// ───────── Telemetry boot ─────────
async function initTelemetry() {
    // Restore sessions from persistent storage
    const stored = await window.go.getSetting('convertedSessions');
    if (Array.isArray(stored)) tlmState.sessions = stored;

    // Tab switching
    document.querySelectorAll('.tab').forEach((t) => {
        t.addEventListener('click', () => switchView(t.dataset.view));
    });

    // Load saved settings into drawer
    const watchDir = await window.go.getSetting('watchDir') || '';
    const outputMode = await window.go.getSetting('outputMode') || 'same';
    const outputDir = await window.go.getSetting('outputDir') || '';
    const motecExe = await window.go.getSetting('motecExe') || '';
    const watcherEnabled = await window.go.getSetting('watcherEnabled') || false;

    const setWatchPath = $('setWatchPath');
    if (setWatchPath) setWatchPath.value = watchDir;
    const setOutPath = $('setOutPath');
    if (setOutPath) setOutPath.value = outputDir;
    const setMotecExe = $('setMotecExe');
    if (setMotecExe) setMotecExe.value = motecExe;

    // Output mode segmented control
    const outMode = $('setOutMode');
    if (outMode) {
        outMode.querySelectorAll('button').forEach((b) => {
            b.classList.toggle('active', b.dataset.v === outputMode);
        });
        $('setOutCustomRow').style.display = outputMode === 'custom' ? '' : 'none';
    }

    // Enable switch
    const enableSwitch = $('setAutoEnable');
    if (enableSwitch && watcherEnabled) {
        enableSwitch.classList.add('on');
        enableSwitch.setAttribute('aria-checked', 'true');
    }

    updateWatcherCard();

    // First-run card: show if no watch folder configured
    await refreshFirstRunCard();

    $('firstRunCta').addEventListener('click', () => { if (window._openDrawer) window._openDrawer('auto'); });
    $('firstRunDismiss').addEventListener('click', async () => {
        $('firstRunCard').style.display = 'none';
        await window.go.setSetting('firstRunDismissed', true);
    });

    // Dropzone
    const dz = $('tlmDrop');
    if (dz) {
        ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => {
            e.preventDefault();
            dz.classList.add('is-drag');
        }));
        ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => {
            e.preventDefault();
            dz.classList.remove('is-drag');
            if (ev === 'drop' && e.dataTransfer.files.length) {
                const file = e.dataTransfer.files[0];
                const filePath = window.go.getPathForFile(file);
                if (filePath && filePath.endsWith('.duckdb')) {
                    runConversion(filePath);
                } else {
                    logLine(`Dropped file isn't a .duckdb: ${file.name}`, 'err');
                }
            }
        }));
    }

    $('tlmPickFile').addEventListener('click', async () => {
        const result = await window.go.pickFile({
            title: 'Select DuckDB session file',
            filters: [{ name: 'DuckDB files', extensions: ['duckdb'] }],
        });
        if (!result.canceled) runConversion(result.path);
    });

    // Watcher card toggle
    $('watcherToggle').addEventListener('click', async () => {
        const on = !tlmState.watcherRunning;
        if (on) {
            await startWatcher();
        } else {
            await stopWatcher();
        }
        await window.go.setSetting('watcherEnabled', tlmState.watcherRunning);
        const enableSwitch = $('setAutoEnable');
        if (enableSwitch) {
            enableSwitch.classList.toggle('on', tlmState.watcherRunning);
            enableSwitch.setAttribute('aria-checked', String(tlmState.watcherRunning));
        }
    });
    // Keyboard activation for the role=button card (Space/Enter)
    $('watcherToggle').addEventListener('keydown', (e) => {
        if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            $('watcherToggle').click();
        }
    });

    $('wcConfigure').addEventListener('click', (e) => {
        e.stopPropagation();
        if (window._openDrawer) window._openDrawer('auto');
    });

    // Empty-state CTAs
    const emptyConfigure = $('emptyConfigure');
    if (emptyConfigure) {
        emptyConfigure.addEventListener('click', () => {
            if (window._openDrawer) window._openDrawer('auto');
        });
    }
    const emptyPickFile = $('emptyPickFile');
    if (emptyPickFile) {
        emptyPickFile.addEventListener('click', async () => {
            const result = await window.go.pickFile({
                title: 'Select DuckDB session file',
                filters: [{ name: 'DuckDB files', extensions: ['duckdb'] }],
            });
            if (!result.canceled) runConversion(result.path);
        });
    }

    // Search + filter
    $('tlmSearch').addEventListener('input', (e) => {
        tlmState.searchQuery = e.target.value;
        renderSessionsGrid();
    });
    document.querySelectorAll('.filter-chip').forEach((c) => {
        c.addEventListener('click', () => {
            document.querySelectorAll('.filter-chip').forEach((x) => x.classList.remove('active'));
            c.classList.add('active');
            tlmState.filterMode = c.dataset.filter;
            renderSessionsGrid();
        });
    });

    // Convert log feed
    window.go.onConvertLog((line) => {
        try {
            const msg = JSON.parse(line);
            if (msg.type === 'done') {
                if (msg.ld) addSession(msg.ld, 'ok', msg.meta);
                showActiveConv(false);
            } else if (msg.type === 'start') {
                updateActiveConv(0, 'Reading DuckDB');
                showActiveConv(true);
            } else if (msg.type === 'progress') {
                const step = msg.step;
                const pct = step === 'read' ? 33 : step === 'ld' ? 66 : 90;
                const stage = step === 'read' ? 'Mapping channels' : step === 'ld' ? 'Writing .ld' : 'Writing .ldx';
                updateActiveConv(pct, stage);
            } else if (msg.type === 'error') {
                if (msg.file) addSession(msg.file, 'err');
                logLine(`Conversion failed: ${msg.message || 'unknown error'}`, 'err');
                showActiveConv(false);
            }
        } catch (_) {
            // non-JSON line — ignored
        }
    });

    // Auto-start watcher if enabled
    if (watcherEnabled && watchDir) {
        await startWatcher();
    }

    renderSessionsGrid();
    updateTlmSummary();
}

// ───────── Watcher helpers ─────────
async function startWatcher() {
    const watchDir = await window.go.getSetting('watchDir') || '';
    if (!watchDir) {
        if (window._openDrawer) window._openDrawer('auto');
        return;
    }
    const outputMode = await window.go.getSetting('outputMode') || 'same';
    const outputDir = outputMode === 'custom' ? (await window.go.getSetting('outputDir') || watchDir) : watchDir;
    const result = await window.go.startWatch(watchDir, outputDir);
    if (result?.ok !== false) {
        tlmState.watcherRunning = true;
        updateWatcherToggle(true);
        updateWatcherPill(true, watchDir);
    }
}

async function stopWatcher() {
    await window.go.stopWatch();
    tlmState.watcherRunning = false;
    updateWatcherToggle(false);
    updateWatcherPill(false, '');
}

function updateWatcherToggle(on) {
    const btn = $('watcherToggle');
    if (!btn) return;
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-pressed', String(on));
    const txt = $('watcherStateText');
    if (txt) txt.textContent = on ? 'WATCHING' : 'OFF';
    const sw = $('watcherSwitch');
    if (sw) {
        sw.classList.toggle('on', on);
        sw.setAttribute('aria-checked', String(on));
    }
}

function updateWatcherPill(on, watchDir) {
    const pill = $('watcherStatusPill');
    if (!pill) return;
    if (on) {
        pill.style.display = '';
        pill.classList.remove('offline');
        const txt = pill.querySelector('.status-text');
        if (txt) txt.textContent = 'Watcher · watching';
    } else {
        pill.style.display = 'none';
    }
}

function updateWatcherCard() {
    window.go.getSetting('watchDir').then((watchDir) => {
        const pathEl = $('watcherPath');
        if (pathEl) pathEl.textContent = watchDir || 'No folder configured';
    });
}

// ───────── Conversion runner ─────────
async function runConversion(inputPath) {
    const outputMode = await window.go.getSetting('outputMode') || 'same';
    let outputDir;
    if (outputMode === 'custom') {
        outputDir = await window.go.getSetting('outputDir') || '';
        if (!outputDir) {
            outputDir = inputPath.substring(0, inputPath.lastIndexOf('\\')) ||
                        inputPath.substring(0, inputPath.lastIndexOf('/'));
        }
    } else {
        outputDir = inputPath.substring(0, inputPath.lastIndexOf('\\')) ||
                    inputPath.substring(0, inputPath.lastIndexOf('/'));
    }

    try {
        await window.go.convertRun(inputPath, outputDir);
    } catch (e) {
        // onConvertLog handles all state mutations via 'error' event
    }
}

function showActiveConv(show) {
    const panel = $('activeConv');
    if (panel) panel.style.display = show ? '' : 'none';
    const idle = $('convIdle');
    if (idle) idle.style.display = show ? 'none' : '';
}

function updateActiveConv(pct, stage) {
    const fill = $('activeFill');
    const pctEl = $('activePct');
    const stageEl = $('activeStage');
    if (fill) fill.style.width = pct + '%';
    if (pctEl) pctEl.textContent = pct + '%';
    if (stageEl) stageEl.textContent = stage;
}

// ───────── Sessions list ─────────
async function persistSessions() {
    // Cap at 200 to bound settings file growth. New sessions unshift to
    // position 0, so slice(0, 200) keeps the newest 200.
    // Callers fire-and-forget — swallow IPC failures so the unhandled
    // rejection doesn't pollute the renderer console.
    try {
        await window.go.setSetting('convertedSessions', tlmState.sessions.slice(0, 200));
    } catch {}
}

function addSession(ldPath, status, meta) {
    const existing = tlmState.sessions.findIndex((s) => s.ldPath === ldPath);
    const baseName = ldPath.replace(/\\/g, '/').split('/').pop().replace(/\.ld$/i, '');
    const now = new Date();
    const m = meta || {};
    const trackLabel = [m.track, m.layout].filter(Boolean).join(' · ') || baseName;
    const session = {
        ldPath,
        ldxPath: ldPath.replace(/\.ld$/i, '.ldx'),
        baseName,
        track: trackLabel,
        driver: m.driver || '',
        car: m.car || '',
        cls: m.carClass || '',
        fastest: m.fastest || '—',
        laps: Number(m.laps ?? 0),
        convertedAt: now.getTime(),  // epoch ms — used by today/week filters
        date: now.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
        status,
    };
    if (existing >= 0) {
        tlmState.sessions[existing] = session;
    } else {
        tlmState.sessions.unshift(session);
    }
    persistSessions();   // fire-and-forget; cap-trim happens inside
    renderSessionsGrid();
    updateTlmSummary();
}

function tagFor(status) {
    if (status === 'ok')  return '<span class="t-tag ok">.LD · .LDX</span>';
    if (status === 'err') return '<span class="t-tag err">FAILED</span>';
    if (status === 'run') return '<span class="t-tag run">CONVERTING</span>';
    return '';
}

function renderSessionsGrid() {
    const grid = $('sessionsGrid');
    if (!grid) return;
    // Remove existing rows (keep grid-head)
    [...grid.querySelectorAll('.session-row, .row-progress')].forEach((n) => n.remove());

    const q = tlmState.searchQuery.trim().toLowerCase();
    let list = tlmState.sessions;
    if (tlmState.filterMode === 'today') list = list.filter((s) => isToday(s.convertedAt));
    else if (tlmState.filterMode === 'week') list = list.filter((s) => isThisWeek(s.convertedAt));
    if (q) list = list.filter((s) => (s.baseName + ' ' + s.track + ' ' + s.car).toLowerCase().includes(q));

    const emptyEl = $('sessionsEmpty');
    if (list.length === 0) {
        if (emptyEl) emptyEl.style.display = '';
        return;
    }
    if (emptyEl) emptyEl.style.display = 'none';

    for (const s of list) {
        const row = document.createElement('div');
        row.className = 'session-row';
        row.dataset.ldPath = s.ldPath;
        const title = (s.track && s.track !== s.baseName) ? s.track : s.baseName;
        const sub = s.driver || s.baseName;
        row.innerHTML = `
            <div class="cell">
                <div class="cell-track">
                    <div class="t-name">${title.replace(/</g,'&lt;')} ${tagFor(s.status)}</div>
                    <div class="t-sub"><span class="driver">${sub.replace(/</g,'&lt;') || '—'}</span></div>
                </div>
            </div>
            <div class="cell">
                <div class="cell-car">
                    <div class="car-name">${s.car.replace(/</g,'&lt;') || '—'}</div>
                    <div class="car-class">${s.cls.replace(/</g,'&lt;') || ''}</div>
                </div>
            </div>
            <div class="cell cell-fastest">${s.fastest.replace(/</g,'&lt;')}</div>
            <div class="cell cell-laps">${s.laps}</div>
            <div class="cell">
                <div class="cell-date">
                    <span class="d-day">${s.date}</span>
                </div>
            </div>
            <div class="cell cell-actions">
                <button class="act-btn primary" data-action="open" title="Open in MoTeC i2">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                </button>
                <button class="act-btn" data-action="reveal" title="Reveal in folder">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>
                </button>
                <button class="act-btn danger" data-action="delete" title="Delete output">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="m19 6-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
                </button>
            </div>
        `;
        row.querySelectorAll('[data-action]').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                handleSessionAction(btn.dataset.action, s);
            });
        });
        grid.appendChild(row);
    }
}

async function handleSessionAction(action, session) {
    if (action === 'open') {
        const result = await window.go.motecOpen(session.ldPath);
        if (!result?.ok) {
            alert(result?.error || 'Failed to open MoTeC i2');
        }
    } else if (action === 'reveal') {
        await window.go.revealInFolder(session.ldPath);
    } else if (action === 'delete') {
        if (!confirm(`Delete ${session.baseName}.ld and .ldx?`)) return;
        const result = await window.go.deleteConversion(session.ldPath);
        if (result.ok) {
            tlmState.sessions = tlmState.sessions.filter((s) => s.ldPath !== session.ldPath);
            persistSessions();
            renderSessionsGrid();
            updateTlmSummary();
        }
    }
}

function updateTlmSummary() {
    const all = tlmState.sessions.length;
    const today = tlmState.sessions.filter((s) => isToday(s.convertedAt)).length;
    const week = tlmState.sessions.filter((s) => isThisWeek(s.convertedAt)).length;
    const badge = $('tabBadgeTlm');
    if (badge) {
        badge.textContent = all;
        badge.style.display = all > 0 ? '' : 'none';
    }
    const fcAll = $('fcAll'); if (fcAll) fcAll.textContent = all;
    const fcToday = $('fcToday'); if (fcToday) fcToday.textContent = today;
    const fcWeek = $('fcWeek'); if (fcWeek) fcWeek.textContent = week;
}
