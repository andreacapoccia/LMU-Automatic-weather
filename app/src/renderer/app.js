// ───────── State ─────────
const GO_SETUPS_DEFAULTS = {
    timeScale: 0,           // Normal (real time)
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

function setStatus(alive) {
    const pill = $('lmuStatus');
    const text = pill.querySelector('.status-text');
    pill.classList.toggle('offline', !alive);
    text.textContent = alive ? 'LMU running · main menu' : 'LMU offline';
    const live = $('footerLive');
    if (live) live.style.color = alive ? 'var(--green)' : 'var(--text-faint)';
}

function setGoFastStatus(alive) {
    const pill = $('goFastStatus');
    const text = pill.querySelector('.status-text');
    pill.classList.toggle('offline', !alive);
    text.textContent = alive ? 'GO Fast running' : 'GO Fast offline';
}

function formatTime(minutes) {
    const m = ((minutes % 1440) + 1440) % 1440;
    const h = Math.floor(m / 60);
    const mm = String(m % 60).padStart(2, '0');
    return `${String(h).padStart(2, '0')}:${mm}`;
}

function formatTimeScale(v) {
    return Number(v) === 0 ? 'Normal' : `×${v}`;
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
    const installPath = $('installPath');

    if (!result?.found) {
        trackSelect.innerHTML = '<option value="">Le Mans Ultimate not found</option>';
        installPath.textContent = 'not detected';
        $('installPill').title = 'Le Mans Ultimate install not found — click Change to set the path manually.';
        return;
    }

    populateTracks(result.tracks);
    const tag = result.source === 'manual' ? '(manual)' : '(auto)';
    installPath.textContent = `${tag} ${result.installRoot.split(/[/\\]/).slice(-2).join('/')}`;
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
    $('carAside').textContent = `${cars.length} owned`;
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
        const alive = await window.go.isLmuAlive();
        setStatus(alive);
        if (alive) refreshLiveTracks();
    } catch (_) {
        setStatus(false);
    }
    try {
        const alive = await window.go.isGoFastAlive();
        setGoFastStatus(alive);
    } catch (_) {
        setGoFastStatus(false);
    }
}

// ───────── Custom dropdown enhancer ─────────
function enhanceSelects(root = document) {
    const selects = root.querySelectorAll('select.select:not([data-cdd-enhanced])');
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
    bindCustomRange('cwHum', 'humidity', (v) => `${v}%`);
    bindCustomRange('cwWind', 'windSpeed', (v) => `${v} km/h`);
    bindCustomRange('cwWindDir', 'windDirection', (v) => `${v}°`);
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
    $('changeInstallPath').addEventListener('click', pickInstallPath);

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
});
