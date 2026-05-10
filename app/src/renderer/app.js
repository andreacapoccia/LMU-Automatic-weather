// ───────── State ─────────
const GO_SETUPS_DEFAULTS = {
    timeScale: 1,           // Normal (real time) — LMU enum: 0=None, 1=Normal, 2=×2
    flagRules: 3,           // Full w/o DQ
    trackLimitsRules: 1,    // Default
    trackLimitsPoints: 5,
    mechanicalFailures: 1,  // Normal
};

const state = {
    install: null,
    liveTracksFetched: false,
    liveCarsFetched: false,
    cars: [],
    selectedClass: '',
    // folder → { locationName, layouts: Array<track> }
    trackGroups: {},
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
    div.innerHTML = `<span class="ts">[${ts}]</span> ${line.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))}`;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
    // Auto-open the log on first error
    if (kind === 'err' && log.classList.contains('hidden')) {
        log.classList.remove('hidden');
        $('logToggle').classList.add('open');
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

function formatTime(minutes) {
    const m = ((minutes % 1440) + 1440) % 1440;
    const h = Math.floor(m / 60);
    const mm = String(m % 60).padStart(2, '0');
    return `${String(h).padStart(2, '0')}:${mm}`;
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
        if (c.owned === false) continue;
        const parts = parseCarPath(c.fullPathTree);
        if (parts.length < 3) continue;
        const dn = c.displayProperties?.displayName || stripVersion(c.name);
        const vm = getVirtualModel(parts[2], dn);
        cars.push({
            id: c.id,
            class: normalizeClass(parts[1]),
            model: parts[2],
            modelKey: vm.modelKey,
            modelLabel: vm.modelLabel,
            series: parts[0],
            name: stripVersion(c.name),
            displayName: dn,
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
    updateSummary();
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

// ───────── Weather presets ─────────
function selectPreset(name) {
    state.overrides.weatherPreset = name;
    document.querySelectorAll('[data-preset]').forEach((c) => {
        c.classList.toggle('active', c.dataset.preset === name);
    });
    const dryDetails = $('wxDetailsDry');
    const rainDetails = $('wxDetailsRain');
    const customWx = $('customWeather');
    if (dryDetails) dryDetails.classList.toggle('hidden', name !== 'dry');
    if (rainDetails) rainDetails.classList.toggle('hidden', name !== 'overcast_rain');
    if (customWx) customWx.classList.toggle('hidden', name !== 'custom');

    if (name === 'dry' || name === 'overcast_rain') {
        applyGoSetupsDefaults();
    }
    updateSummary();
}

function applyGoSetupsDefaults() {
    Object.assign(state.overrides, GO_SETUPS_DEFAULTS);
    $('timeScale').value = String(GO_SETUPS_DEFAULTS.timeScale);
    $('timeScaleVal').textContent = formatTimeScale(GO_SETUPS_DEFAULTS.timeScale);
    updateRangeFill($('timeScale'));
    $('flagRules').value = String(GO_SETUPS_DEFAULTS.flagRules);
    $('trackLimitsRules').value = String(GO_SETUPS_DEFAULTS.trackLimitsRules);
    $('trackLimitsPoints').value = String(GO_SETUPS_DEFAULTS.trackLimitsPoints);
    $('trackLimitsPointsVal').textContent = String(GO_SETUPS_DEFAULTS.trackLimitsPoints);
    updateRangeFill($('trackLimitsPoints'));
    $('mechanicalFailures').value = String(GO_SETUPS_DEFAULTS.mechanicalFailures);
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
    $('sumTrack').textContent = trackSummary;

    if (state.overrides.vehicleString) {
        $('sumCar').textContent = state.overrides.vehicleString;
    } else {
        $('sumCar').textContent = 'Auto-detect from LMU';
    }

    const wp = state.overrides.weatherPreset;
    if (wp === 'dry') {
        $('sumWx').textContent = 'GO Setups Dry · 20°C · Saturated';
    } else if (wp === 'overcast_rain') {
        $('sumWx').textContent = 'GO Setups Rain · 75% · 20°C';
    } else {
        const cw = state.overrides.customWeather;
        $('sumWx').textContent = `Custom · ${cw.temperature}°C · ${cw.rainChance}% rain`;
    }

    $('sumLen').textContent = `${state.overrides.practiceLength} min @ ${formatTime(state.overrides.practiceStartingTime)}`;
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

function bindCustomRange(id, key, fmt) {
    const el = $(id);
    if (!el) return;
    const out = $(`${id}Val`);
    const update = () => {
        const v = Number(el.value);
        state.overrides.customWeather[key] = v;
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
        overrides: { ...state.overrides },
    };

    $('launchBtn').disabled = true;
    $('log').innerHTML = '';
    $('log').classList.remove('hidden');
    $('logToggle').classList.add('open');
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

// ───────── Practice status tracking ─────────
const PRACTICE_FIELD_IDS = [
    'practiceLength', 'startTime', 'timeScale',
    'startingGrip', 'realRoadTimeScale',
    'flagRules', 'trackLimitsRules', 'trackLimitsPoints', 'mechanicalFailures',
    'tireWarmers', 'privatePractice',
];
let practiceDefaults = {};

function capturePracticeDefaults() {
    PRACTICE_FIELD_IDS.forEach((id) => {
        const el = $(id);
        if (!el) return;
        practiceDefaults[id] = el.type === 'checkbox' ? el.checked : el.value;
    });
}

function isPracticeModified() {
    return PRACTICE_FIELD_IDS.some((id) => {
        const el = $(id);
        if (!el) return false;
        const v = el.type === 'checkbox' ? el.checked : el.value;
        return v !== practiceDefaults[id];
    });
}

function refreshPracticeStatus() {
    const pill = $('practiceStatus');
    if (!pill) return;
    const modified = isPracticeModified();
    pill.dataset.modified = String(modified);
    const lbl = $('practiceStatusLabel');
    if (lbl) lbl.textContent = modified ? 'Modified' : 'GO Setups defaults';
    const rst = $('practiceReset');
    if (rst) rst.hidden = !modified;
}

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

    // Session settings — bind ranges
    bindRange('practiceLength', 'practiceLength', (v) => `${v} min`);
    bindRange('startTime', 'practiceStartingTime', formatTime);
    bindRange('realRoadTimeScale', 'realRoadTimeScale', (v) => `${v}×`);
    bindRange('timeScale', 'timeScale', formatTimeScale);
    bindRange('trackLimitsPoints', 'trackLimitsPoints', (v) => String(v));

    // Session settings — bind selects (numeric)
    bindSelect('startingGrip', 'startingGrip');
    bindSelect('flagRules', 'flagRules', Number);
    bindSelect('trackLimitsRules', 'trackLimitsRules', Number);
    bindSelect('mechanicalFailures', 'mechanicalFailures', Number);

    // Toggles (hidden checkboxes driven by rule pills)
    bindCheckbox('tireWarmers', 'tireWarmers');
    bindCheckbox('privatePractice', 'privatePractice');

    // Custom weather sliders
    bindCustomRange('cwTemp', 'temperature', (v) => `${v}°C`);
    bindCustomRange('cwRain', 'rainChance', (v) => `${v}%`);
    const cwSkyEl = $('cwSky');
    if (cwSkyEl) cwSkyEl.addEventListener('change', (e) => {
        state.overrides.customWeather.sky = Number(e.target.value);
        updateSummary();
    });

    // Weather preset buttons (wx-pills + weather-card)
    document.querySelectorAll('[data-preset]').forEach((card) => {
        card.addEventListener('click', () => selectPreset(card.dataset.preset));
    });

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
        updateSummary();
    });
    $('autoDetectCar').addEventListener('click', () => setAutoDetect(true));
    $('refreshCars').addEventListener('click', async () => {
        $('autoDetectLabel').textContent = 'Refreshing…';
        await refreshLiveCars(true);
        $('autoDetectLabel').textContent = `${state.cars.length} owned liveries.`;
    });
    setAutoDetect(true);

    // Rule pills — toggle tyre warmers & private practice
    document.querySelectorAll('.rule-pill').forEach((pill) => {
        pill.addEventListener('click', () => {
            const cb = pill.dataset.target ? $(pill.dataset.target) : null;
            const on = !pill.classList.contains('is-on');
            pill.classList.toggle('is-on', on);
            pill.setAttribute('aria-pressed', String(on));
            const state_ = pill.querySelector('.rp-state');
            if (state_) state_.textContent = on ? 'ON' : 'OFF';
            if (cb) { cb.checked = on; cb.dispatchEvent(new Event('change', { bubbles: true })); }
            refreshPracticeStatus();
        });
    });

    // Practice reset button
    const practiceReset = $('practiceReset');
    if (practiceReset) {
        practiceReset.addEventListener('click', () => {
            PRACTICE_FIELD_IDS.forEach((id) => {
                const el = $(id);
                if (!el) return;
                if (el.type === 'checkbox') {
                    el.checked = practiceDefaults[id];
                } else {
                    el.value = practiceDefaults[id];
                }
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
            });
            // Sync rule pills to their checkboxes
            document.querySelectorAll('.rule-pill').forEach((pill) => {
                const cb = pill.dataset.target ? $(pill.dataset.target) : null;
                if (!cb) return;
                const on = cb.checked;
                pill.classList.toggle('is-on', on);
                pill.setAttribute('aria-pressed', String(on));
                const st = pill.querySelector('.rp-state');
                if (st) st.textContent = on ? 'ON' : 'OFF';
            });
            refreshPracticeStatus();
        });
    }

    // Watch practice fields for modifications
    PRACTICE_FIELD_IDS.forEach((id) => {
        const el = $(id);
        if (!el) return;
        el.addEventListener('input', refreshPracticeStatus);
        el.addEventListener('change', refreshPracticeStatus);
    });

    // Re-fetch cars when our window regains focus.
    window.addEventListener('focus', () => refreshLiveCars(true));

    // Install pill
    $('installPillChange').addEventListener('click', pickInstallPath);

    // Launch + log toggle
    $('launchBtn').addEventListener('click', onLaunch);
    $('logToggle').addEventListener('click', () => {
        const log = $('log');
        const open = !log.classList.contains('hidden');
        log.classList.toggle('hidden', open);
        $('logToggle').classList.toggle('open', !open);
    });

    // Live log feed from main process.
    window.go.onLog((line) => {
        const isErr = /^ERROR/i.test(line);
        logLine(line, isErr ? 'err' : '');
    });

    // Enhance native selects with custom dropdowns
    enhanceSelects();

    // Capture defaults after all binds have run
    capturePracticeDefaults();
    refreshPracticeStatus();

    selectPreset('dry');
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
                    title: 'Select MoTeC workspace (.w2k)',
                    filters: [{ name: 'MoTeC workspace', extensions: ['w2k'] }],
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
    card.style.display = (!watchDir && !dismissed) ? '' : 'none';
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
                if (file.path && file.path.endsWith('.duckdb')) {
                    runConversion(file.path);
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
                if (msg.ld) addSession(msg.ld, 'ok');
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

function addSession(ldPath, status) {
    const existing = tlmState.sessions.findIndex((s) => s.ldPath === ldPath);
    const baseName = ldPath.replace(/\\/g, '/').split('/').pop().replace(/\.ld$/i, '');
    const now = new Date();
    const session = {
        ldPath,
        ldxPath: ldPath.replace(/\.ld$/i, '.ldx'),
        baseName,
        track: baseName,
        car: '',
        cls: '',
        fastest: '—',
        laps: 0,
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
        row.innerHTML = `
            <div class="cell">
                <div class="cell-track">
                    <div class="t-name">${s.baseName.replace(/</g,'&lt;')} ${tagFor(s.status)}</div>
                    <div class="t-sub"><span class="driver">${s.track.replace(/</g,'&lt;') || '—'}</span></div>
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
