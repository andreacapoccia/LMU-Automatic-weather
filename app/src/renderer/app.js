// ───────── State ─────────
// GO Setups standard rules — applied as defaults when picking Dry/Rain preset.
const GO_SETUPS_DEFAULTS = {
    timeScale: 0,           // Normal (real time)
    flagRules: 2,           // Full w/o DQ
    trackLimitsRules: 1,    // Default
    trackLimitsPoints: 5,
    mechanicalFailures: 1,  // Normal
};

const state = {
    install: null,
    liveTracksFetched: false,
    liveCarsFetched: false,
    cars: [],
    overrides: {
        weatherPreset: 'dry',
        practiceLength: 360,
        practiceStartingTime: 720,
        privatePractice: true,
        startingGrip: 'preset:SATURATED.RRBIN',
        waterDepth: -0.01,
        realRoadTimeScale: 0,
        tireWarmers: true,
        ...GO_SETUPS_DEFAULTS,
        vehicleString: null,
        customWeather: {
            sky: 0,
            rainChance: 0,
            temperature: 22,
            humidity: 50,
            windSpeed: 0,
            windDirection: 0,
        },
    },
};

// ───────── Helpers ─────────
const $ = (id) => document.getElementById(id);

function logLine(line, kind = '') {
    const log = $('log');
    const ts = new Date().toLocaleTimeString([], { hour12: false });
    const div = document.createElement('div');
    if (kind) div.className = kind;
    div.textContent = `[${ts}] ${line}`;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
}

function setStatus(alive) {
    const el = $('lmuStatus');
    const dot = el.querySelector('.dot');
    const text = el.querySelector('.status-text');
    dot.classList.toggle('dot-on', alive);
    dot.classList.toggle('dot-off', !alive);
    text.textContent = alive ? 'LMU running' : 'LMU not detected';
}

function formatTime(minutes) {
    const m = ((minutes % 1440) + 1440) % 1440;
    const h = Math.floor(m / 60);
    const mm = String(m % 60).padStart(2, '0');
    return `${String(h).padStart(2, '0')}:${mm}`;
}

// ───────── Data load ─────────
function applyScanResult(result) {
    state.install = result;
    state.liveTracksFetched = false; // re-merge live tracks against the new list
    const trackSelect = $('trackSelect');
    const installPath = $('installPath');

    if (!result?.found) {
        trackSelect.innerHTML = '<option value="">Le Mans Ultimate not found</option>';
        installPath.textContent =
            'Could not locate LMU. Use "Change folder…" to point at it manually.';
        return;
    }

    const tag = result.source === 'manual' ? '(manual)' : '(auto-detected)';
    installPath.textContent = `Found ${tag}: ${result.installRoot}`;
    populateTracks(result.tracks);
}

async function loadInstall() {
    const result = await window.go.scanInstall();
    applyScanResult(result);
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

function populateTracks(tracks) {
    const trackSelect = $('trackSelect');
    const prev = trackSelect.value;
    trackSelect.innerHTML = '';
    for (const t of tracks) {
        const opt = document.createElement('option');
        opt.value = `${t.folder}::${t.layoutStem || ''}`;
        if (t.id != null) opt.dataset.id = String(t.id);
        if (t.sceneDesc) opt.dataset.sceneDesc = t.sceneDesc;
        opt.dataset.locationToken = t.locationToken || '';
        opt.dataset.layoutToken = t.layoutToken || '';
        opt.textContent = t.label;
        trackSelect.appendChild(opt);
    }
    if (prev) trackSelect.value = prev;
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
            const candidates = [...seen.values()].filter((live) => {
                const sd = String(live.sceneDesc || '')
                    .toUpperCase()
                    .replace(/[^A-Z0-9]/g, '');
                return sd.includes(loc) && (!lay || sd.includes(lay));
            });
            const live = candidates[0];
            if (live) {
                merged.push({ ...t, id: live.id, sceneDesc: live.sceneDesc });
                seen.delete(live.sceneDesc);
            } else {
                merged.push(t);
            }
        }
    }
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
    populateTracks(merged.sort((a, b) => a.label.localeCompare(b.label)));
    state.liveTracksFetched = true;
}

// ───────── Weather preset cards ─────────
function selectPreset(name) {
    state.overrides.weatherPreset = name;
    document.querySelectorAll('.preset').forEach((b) => {
        b.classList.toggle('active', b.dataset.preset === name);
    });
    $('customWeather').classList.toggle('hidden', name !== 'custom');

    // For the two GO Setups standard presets, snap rule-related session
    // settings back to the GO Setups defaults. Custom keeps whatever the
    // user has dialled in.
    if (name === 'dry' || name === 'overcast_rain') {
        applyGoSetupsDefaults();
    }
}

function applyGoSetupsDefaults() {
    Object.assign(state.overrides, GO_SETUPS_DEFAULTS);
    $('timeScale').value = String(GO_SETUPS_DEFAULTS.timeScale);
    $('timeScaleVal').textContent = formatTimeScale(GO_SETUPS_DEFAULTS.timeScale);
    $('flagRules').value = String(GO_SETUPS_DEFAULTS.flagRules);
    $('trackLimitsRules').value = String(GO_SETUPS_DEFAULTS.trackLimitsRules);
    $('trackLimitsPoints').value = String(GO_SETUPS_DEFAULTS.trackLimitsPoints);
    $('trackLimitsPointsVal').textContent = String(GO_SETUPS_DEFAULTS.trackLimitsPoints);
    $('mechanicalFailures').value = String(GO_SETUPS_DEFAULTS.mechanicalFailures);
}

function formatTimeScale(v) {
    return Number(v) === 0 ? 'Normal' : `×${v}`;
}

// ───────── Car picker (Class → Model → Livery) ─────────
function stripVersion(name) {
    // "Team 2025 #36:LM 1.21" → "Team 2025 #36:LM"
    return String(name || '').replace(/\s+\d+\.\d+\s*$/, '').trim();
}

function parseCarPath(tree) {
    // "WEC 2025, Hypercar, Alpine A424" → ["WEC 2025","Hypercar","Alpine A424"]
    return String(tree || '').split(',').map((s) => s.trim()).filter(Boolean);
}

async function refreshLiveCars() {
    if (state.liveCarsFetched) return;
    const result = await window.go.fetchLiveCars();
    if (!result?.ok || !Array.isArray(result.cars)) return;

    const cars = [];
    for (const c of result.cars) {
        if (c.owned === false) continue;
        const parts = parseCarPath(c.fullPathTree);
        if (parts.length < 3) continue;
        cars.push({
            id: c.id,
            class: parts[1],          // Hypercar / GT3 / LMP2 / LMP3 / GTE …
            model: parts[2],          // Alpine A424 / BMW M4 LMGT3 …
            series: parts[0],         // WEC 2025 / ELMS 2025 …
            name: stripVersion(c.name),
            displayName: c.displayProperties?.displayName || stripVersion(c.name),
        });
    }
    state.cars = cars;
    state.liveCarsFetched = true;
    populateClassDropdown();
    $('carHint').textContent = `${cars.length} owned liveries loaded.`;
}

function populateClassDropdown() {
    const sel = $('carClassSelect');
    const classes = [...new Set(state.cars.map((c) => c.class))].sort();
    const prev = sel.value;
    sel.innerHTML = '<option value="">— Class —</option>';
    for (const c of classes) {
        const opt = document.createElement('option');
        opt.value = c;
        opt.textContent = c;
        sel.appendChild(opt);
    }
    sel.disabled = false;
    if (prev) sel.value = prev;
    populateModelDropdown();
}

function populateModelDropdown() {
    const sel = $('carModelSelect');
    const cls = $('carClassSelect').value;
    const prev = sel.value;
    sel.innerHTML = '<option value="">— Car model —</option>';
    if (!cls) {
        sel.disabled = true;
        $('carLiverySelect').innerHTML = '<option value="">— Livery —</option>';
        $('carLiverySelect').disabled = true;
        state.overrides.vehicleString = null;
        return;
    }
    const models = [...new Set(state.cars.filter((c) => c.class === cls).map((c) => c.model))].sort();
    for (const m of models) {
        const count = state.cars.filter((c) => c.class === cls && c.model === m).length;
        const opt = document.createElement('option');
        opt.value = m;
        opt.textContent = count > 1 ? `${m}  (${count} liveries)` : m;
        sel.appendChild(opt);
    }
    sel.disabled = false;
    if (prev && [...sel.options].some((o) => o.value === prev)) sel.value = prev;
    populateLiveryDropdown();
}

function setAutoDetect(enabled) {
    const btn = $('autoDetectCar');
    const label = $('autoDetectLabel');
    if (enabled) {
        state.overrides.vehicleString = null;
        $('carClassSelect').value = '';
        $('carModelSelect').innerHTML = '<option value="">— Car model —</option>';
        $('carModelSelect').disabled = true;
        $('carLiverySelect').innerHTML = '<option value="">— Livery —</option>';
        $('carLiverySelect').disabled = true;
        btn.classList.add('active');
        label.textContent = 'Will use whatever car is selected in LMU when launching.';
    } else {
        btn.classList.remove('active');
        label.textContent = '';
    }
}

function populateLiveryDropdown() {
    const sel = $('carLiverySelect');
    const cls = $('carClassSelect').value;
    const model = $('carModelSelect').value;
    sel.innerHTML = '<option value="">— Livery —</option>';
    if (!cls || !model) {
        sel.disabled = true;
        state.overrides.vehicleString = null;
        return;
    }
    const liveries = state.cars
        .filter((c) => c.class === cls && c.model === model)
        .sort((a, b) => a.displayName.localeCompare(b.displayName));
    for (const l of liveries) {
        const opt = document.createElement('option');
        opt.value = l.name;
        opt.textContent = l.displayName;
        sel.appendChild(opt);
    }
    sel.disabled = false;
    // Auto-pick if only one livery for this model.
    if (liveries.length === 1) {
        sel.value = liveries[0].name;
        state.overrides.vehicleString = liveries[0].name;
    } else {
        state.overrides.vehicleString = null;
    }
}

// ───────── Override bindings ─────────
function bindRange(id, key, fmt) {
    const el = $(id);
    const out = $(`${id}Val`);
    const update = () => {
        const v = Number(el.value);
        state.overrides[key] = v;
        if (out) out.textContent = fmt(v);
    };
    el.addEventListener('input', update);
    update();
}

function bindCheckbox(id, key) {
    const el = $(id);
    const update = () => {
        state.overrides[key] = el.checked;
    };
    el.addEventListener('change', update);
    update();
}

function bindSelect(id, key) {
    const el = $(id);
    const update = () => {
        state.overrides[key] = el.value;
    };
    el.addEventListener('change', update);
    update();
}

// ───────── Launch ─────────
async function onLaunch() {
    const trackSelect = $('trackSelect');
    if (!trackSelect.value) {
        logLine('Select a track first.', 'err');
        return;
    }

    const trackOpt = trackSelect.selectedOptions[0];
    const payload = {
        track: {
            id: trackOpt.dataset.id || null,
            folder: trackOpt.value.split('::')[0] || null,
            sceneDesc: trackOpt.dataset.sceneDesc || null,
            locationToken: trackOpt.dataset.locationToken || null,
            layoutToken: trackOpt.dataset.layoutToken || null,
            label: trackOpt.textContent,
        },
        overrides: { ...state.overrides },
    };

    $('launchBtn').disabled = true;
    $('log').innerHTML = '';
    logLine(`Launching with "${payload.overrides.weatherPreset}" preset…`, 'ok');

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
        const alive = await window.go.isLmuAlive();
        setStatus(alive);
        if (alive) {
            refreshLiveTracks();
            refreshLiveCars();
        }
    } catch (_) {
        setStatus(false);
    }
}

// ───────── Boot ─────────
document.addEventListener('DOMContentLoaded', () => {
    bindRange('practiceLength', 'practiceLength', (v) => `${v} min`);
    bindRange('startTime', 'practiceStartingTime', (v) => formatTime(v));
    bindRange('realRoadTimeScale', 'realRoadTimeScale', (v) => `${v}×`);
    bindRange('timeScale', 'timeScale', formatTimeScale);
    bindRange('trackLimitsPoints', 'trackLimitsPoints', (v) => String(v));
    // waterDepth is baked at the GO Setups default (-0.01) — not user-tunable.
    bindSelect('startingGrip', 'startingGrip');
    bindSelect('flagRules', 'flagRules');
    bindSelect('trackLimitsRules', 'trackLimitsRules');
    bindSelect('mechanicalFailures', 'mechanicalFailures');
    bindCheckbox('tireWarmers', 'tireWarmers');
    bindCheckbox('privatePractice', 'privatePractice');

    // Custom weather sliders → state.overrides.customWeather
    function bindCustomRange(id, key, fmt) {
        const el = $(id);
        const out = $(`${id}Val`);
        const update = () => {
            const v = Number(el.value);
            state.overrides.customWeather[key] = v;
            if (out) out.textContent = fmt(v);
        };
        el.addEventListener('input', update);
        update();
    }
    bindCustomRange('cwTemp', 'temperature', (v) => `${v} °C`);
    bindCustomRange('cwRain', 'rainChance', (v) => `${v} %`);
    bindCustomRange('cwHum', 'humidity', (v) => `${v} %`);
    bindCustomRange('cwWind', 'windSpeed', (v) => `${v} km/h`);
    bindCustomRange('cwWindDir', 'windDirection', (v) => `${v}°`);
    $('cwSky').addEventListener('change', (e) => {
        state.overrides.customWeather.sky = Number(e.target.value);
    });

    document.querySelectorAll('.preset').forEach((b) => {
        b.addEventListener('click', () => selectPreset(b.dataset.preset));
    });
    selectPreset('dry'); // default

    $('carClassSelect').addEventListener('change', () => {
        setAutoDetect(false);
        populateModelDropdown();
    });
    $('carModelSelect').addEventListener('change', () => {
        setAutoDetect(false);
        populateLiveryDropdown();
    });
    $('carLiverySelect').addEventListener('change', () => {
        setAutoDetect(false);
        state.overrides.vehicleString = $('carLiverySelect').value || null;
    });
    $('autoDetectCar').addEventListener('click', () => setAutoDetect(true));
    setAutoDetect(true); // start in auto-detect mode

    $('launchBtn').addEventListener('click', onLaunch);
    $('changeInstallPath').addEventListener('click', pickInstallPath);

    window.go.onLog((line) => {
        const isErr = /^ERROR/i.test(line);
        logLine(line, isErr ? 'err' : '');
    });

    loadInstall();
    pollStatus();
    setInterval(pollStatus, 5000);
});
