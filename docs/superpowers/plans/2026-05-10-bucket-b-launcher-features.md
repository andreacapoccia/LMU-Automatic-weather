# Bucket B/C/D — Launcher Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship v3.0.4 with: (B) settings/track-name/grip cleanups + 2 bug fixes, (C) per-session 5-slot custom weather with save/load presets, (D) full Practice + Qualifying + Race weekend launcher.

**Architecture:** Single-PR refactor of the launcher renderer state from flat top-level overrides to per-session `state.overrides.sessions[X]`. New HTML for the merged Sessions card. Backend in `lmu-launcher.composeSession` extends to write Qualifying + Race fields to the SessionPreset. Custom-weather blob handling has two implementation paths gated on a manual investigation (Task 12).

**Tech Stack:** Electron + vanilla JS renderer + IPC, JSON settings store, no test framework.

**Spec:** `docs/superpowers/specs/2026-05-10-bucket-b-launcher-features.md`

**Verification approach:** Per-task `node --check` + grep verifications (we have no renderer test infrastructure). Whole-flow manual smoke after Task 14, against the freshly-built v3.0.4 .exe.

---

## Task 1: Bucket B — Cleanup About & Logs section (B1, B2, plus Channel)

**Files:**
- Modify: `app/src/renderer/index.html` (lines ~791-820)

- [ ] **Step 1: Read current About & Logs block**

```bash
grep -n "About\|about-row\|Channel\|License\|Check for updates" "app/src/renderer/index.html" | head
```

- [ ] **Step 2: Edit `app/src/renderer/index.html`** — replace the `<div class="setting-group">` containing about-rows with the trimmed version (delete Channel + License rows; keep only Version + Updated):

Find:
```html
        <div class="setting-group">
          <div class="about-row"><span>Version</span><span>2.0.4 (build 318)</span></div>
          <div class="about-row"><span>Channel</span><span>stable</span></div>
          <div class="about-row"><span>Updated</span><span>2025-04-29</span></div>
          <div class="about-row"><span>License</span><span>GO Pro · seat #142</span></div>
        </div>
```

Replace with:
```html
        <div class="setting-group">
          <div class="about-row"><span>Version</span><span id="aboutVersion">—</span></div>
          <div class="about-row"><span>Updated</span><span id="aboutUpdated">—</span></div>
        </div>
```

(IDs are populated by Task 4.)

- [ ] **Step 3: Delete the "Check for updates" setting-row** in the same file, find:

```html
          <div class="setting-row">
            <div class="setting-label">
              <span class="lbl">Check for updates</span>
            </div>
            <button class="s-btn">Check now</button>
          </div>
```

Delete this entire block.

- [ ] **Step 4: Verify**

```bash
grep -c "License\|Check for updates\|Channel" app/src/renderer/index.html
# Expected: 0 0 0  (zero on all)
grep -n "aboutVersion\|aboutUpdated" app/src/renderer/index.html
# Expected: 2 matches
```

- [ ] **Step 5: Commit**

```bash
git add app/src/renderer/index.html
git commit -m "fix(ui): trim About & Logs to Version + Updated only (delete License/Channel/Check-for-updates)"
```

---

## Task 2: Bucket B — Track layout naming overrides (B6)

**Files:**
- Modify: `app/src/main/install-scanner.js:85-118` (LAYOUT_NAME_OVERRIDES map)

- [ ] **Step 1: Edit `app/src/main/install-scanner.js`** — replace the 6 entries listed below in the `LAYOUT_NAME_OVERRIDES` object:

Find lines:
```js
    lemans: '24h Circuit',
    mulsanne: 'Bugatti Circuit',
    grande: 'Grande Anello',
    monza: 'Grand Prix',
    '1a': 'Long (1A)',
    '1av2': 'Long V2 (1A)',
    '1av2short': 'Short V2',
    '3a': '3A Layout',
```

Replace with:
```js
    lemans: '24h Circuit',
    mulsanne: 'Mulsanne',
    grande: 'Curva Grande',
    monza: 'Grand Prix',
    '1a': '1A',
    '1av2': '1AV2',
    '1av2short': '1AV2 Short',
    '3a': '3A',
```

- [ ] **Step 2: Verify**

```bash
node --check app/src/main/install-scanner.js
grep -nE "Bugatti|Grande Anello|Long \(1A\)|Long V2|3A Layout|Short V2" app/src/main/install-scanner.js
# Expected: no matches
grep -nE "mulsanne: 'Mulsanne'|grande: 'Curva Grande'|'1a': '1A'|'1av2': '1AV2'|'1av2short': '1AV2 Short'|'3a': '3A'" app/src/main/install-scanner.js
# Expected: 6 matches
```

- [ ] **Step 3: Commit**

```bash
git add app/src/main/install-scanner.js
git commit -m "fix(launcher): correct Le Mans / Monza / Paul Ricard layout names"
```

---

## Task 3: Bucket B — Starting grip dropdown values (B7)

**Files:**
- Modify: `app/src/renderer/index.html` (~line 282-284)

- [ ] **Step 1: Edit `app/src/renderer/index.html`** — find the starting-grip select:

```html
          <select id="startingGrip" class="select">
            <option>Saturated</option><option>Heavy</option><option>Medium</option><option>Light</option><option>Green</option>
          </select>
```

Replace with:
```html
          <select id="startingGrip" class="select">
            <option value="preset:SATURATED.RRBIN">Saturated</option>
            <option value="preset:HEAVY.RRBIN">Heavy</option>
            <option value="preset:MEDIUM.RRBIN">Medium</option>
            <option value="preset:LIGHT.RRBIN">Light</option>
            <option value="preset:GREEN.RRBIN">Green</option>
          </select>
```

(File-name casing note: `gosetups-template.json` uses both `SATURATED.RRBIN` and `Saturated.rrbin` for different sessions, suggesting LMU is case-insensitive. We use uppercase for consistency. If the user reports this is still ignored after Task 14's smoke test, flip to mixed case.)

- [ ] **Step 2: Verify**

```bash
grep -c "preset:SATURATED.RRBIN\|preset:HEAVY.RRBIN\|preset:MEDIUM.RRBIN\|preset:LIGHT.RRBIN\|preset:GREEN.RRBIN" app/src/renderer/index.html
# Expected: 5
```

- [ ] **Step 3: Commit**

```bash
git add app/src/renderer/index.html
git commit -m "fix(launcher): add LMU-recognized values to Starting grip <option>s"
```

---

## Task 4: Bucket B — Version + build date display (B5)

**Files:**
- Modify: `app/package.json` (add `buildDate`)
- Modify: `app/src/main/main.js` (new IPC `app:getVersion`)
- Modify: `app/src/main/preload.js` (expose `getVersion`)
- Modify: `app/src/renderer/app.js` (populate aboutVersion + aboutUpdated on init)

- [ ] **Step 1: Add `buildDate` to `app/package.json`**

After the `version` line, insert:
```json
  "buildDate": "2026-05-10",
```

The full top of package.json should read:
```json
{
  "name": "go-lmu-launcher",
  "version": "3.0.3",
  "buildDate": "2026-05-10",
  "description": "GO Setups - Le Mans Ultimate session launcher with custom weather",
```

(Version bump to 3.0.4 happens in Task 14 — buildDate also gets bumped then.)

- [ ] **Step 2: Add IPC handler in `app/src/main/main.js`** — add this near the other `ipcMain.handle('app:…')` handlers:

```js
const PKG = require(path.join(app.getAppPath(), 'package.json'));
ipcMain.handle('app:getVersion', () => ({
  version: PKG.version,
  buildDate: PKG.buildDate || 'unknown',
}));
```

(`PKG` line goes near the top of the file, after the existing `require`s.)

- [ ] **Step 3: Expose in `app/src/main/preload.js`** — add inside the `contextBridge.exposeInMainWorld('go', { ... })` object:

```js
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
```

- [ ] **Step 4: Populate the about rows in `app/src/renderer/app.js`** — find `initDrawer` (or similar init function) and add this block. If no obvious init for the drawer exists, add it inside the `DOMContentLoaded` handler:

```js
    // Populate About & Logs version row
    (async () => {
        try {
            const v = await window.go.getVersion();
            const ver = $('aboutVersion');
            const upd = $('aboutUpdated');
            if (ver) ver.textContent = `${v.version}`;
            if (upd) upd.textContent = v.buildDate;
        } catch {}
    })();
```

- [ ] **Step 5: Verify**

```bash
node --check app/src/main/main.js
node --check app/src/main/preload.js
node --check app/src/renderer/app.js
grep -n '"buildDate"' app/package.json
# Expected: 1 match
grep -n "app:getVersion" app/src/main/main.js app/src/main/preload.js app/src/renderer/app.js
# Expected: 3 matches (handler + preload + renderer)
```

- [ ] **Step 6: Commit**

```bash
git add app/package.json app/src/main/main.js app/src/main/preload.js app/src/renderer/app.js
git commit -m "feat(ui): show real version + build date in About & Logs"
```

---

## Task 5: Bucket B — Open logs folder + Reset all settings (B3, B4)

**Files:**
- Modify: `app/src/main/settings.js` (add `resetAll()`)
- Modify: `app/src/main/main.js` (two new IPCs)
- Modify: `app/src/main/preload.js` (expose two new methods)
- Modify: `app/src/renderer/index.html` (give buttons IDs)
- Modify: `app/src/renderer/app.js` (wire button handlers)

- [ ] **Step 1: Add `resetAll()` to `app/src/main/settings.js`** — append this function before `module.exports`:

```js
function resetAll() {
    try {
        fs.unlinkSync(settingsPath());
        return true;
    } catch (e) {
        if (e.code === 'ENOENT') return true;  // already clean
        return false;
    }
}
```

And export it. Replace the existing module.exports line:
```js
module.exports = { read, write, get, set };
```
with:
```js
module.exports = { read, write, get, set, resetAll };
```

- [ ] **Step 2: Add two IPC handlers in `app/src/main/main.js`** — add near the other `ipcMain.handle('app:…')` handlers:

```js
ipcMain.handle('app:openLogsFolder', async () => {
    const dir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(dir, { recursive: true });
    const err = await shell.openPath(dir);
    return err ? { ok: false, error: err } : { ok: true };
});

ipcMain.handle('settings:resetAll', () => {
    settings.resetAll();
    return { ok: true };
});
```

- [ ] **Step 3: Expose in preload.js** — add inside the bridge object:

```js
    openLogsFolder: () => ipcRenderer.invoke('app:openLogsFolder'),
    resetAllSettings: () => ipcRenderer.invoke('settings:resetAll'),
```

- [ ] **Step 4: Add IDs to the buttons in `app/src/renderer/index.html`** — find:

```html
            <button class="s-btn">Open logs folder</button>
```
Replace with:
```html
            <button class="s-btn" id="openLogsFolder">Open logs folder</button>
```

And:
```html
            <button class="s-btn danger">Reset…</button>
```
Replace with:
```html
            <button class="s-btn danger" id="resetSettings">Reset…</button>
```

- [ ] **Step 5: Wire handlers in `app/src/renderer/app.js`** — add inside the `DOMContentLoaded` handler (or `initDrawer` if present):

```js
    const openLogs = $('openLogsFolder');
    if (openLogs) openLogs.addEventListener('click', async () => {
        try { await window.go.openLogsFolder(); } catch (e) { logLine(`Open logs failed: ${e.message}`, 'err'); }
    });

    const resetBtn = $('resetSettings');
    if (resetBtn) resetBtn.addEventListener('click', async () => {
        if (!confirm('Reset all settings? This will not delete telemetry files.')) return;
        try {
            await window.go.resetAllSettings();
            window.location.reload();
        } catch (e) {
            logLine(`Reset failed: ${e.message}`, 'err');
        }
    });
```

- [ ] **Step 6: Verify**

```bash
node --check app/src/main/settings.js
node --check app/src/main/main.js
node --check app/src/main/preload.js
node --check app/src/renderer/app.js
grep -n "resetAll\|openLogsFolder\|settings:resetAll\|app:openLogsFolder" app/src/main/main.js app/src/main/preload.js app/src/main/settings.js app/src/renderer/app.js
# Expected: at least 8 matches across these files
grep -n 'id="openLogsFolder"\|id="resetSettings"' app/src/renderer/index.html
# Expected: 2 matches
```

- [ ] **Step 7: Commit**

```bash
git add app/src/main/settings.js app/src/main/main.js app/src/main/preload.js app/src/renderer/index.html app/src/renderer/app.js
git commit -m "feat(ui): wire Open logs folder + Reset all settings buttons"
```

---

## Task 6: Per-session state model refactor (D1 backbone)

**Files:**
- Modify: `app/src/renderer/app.js` (state structure, all writers, all readers)

- [ ] **Step 1: Replace the `state.overrides` initializer in `app/src/renderer/app.js`** — find:

```js
const state = {
    install: null,
    liveTracksFetched: false,
    liveCarsFetched: false,
    cars: [],
    selectedClass: '',
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
```

Replace with:
```js
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
    trackGroups: {},
    overrides: {
        // Shared (non-session) values — main process DEFAULT_OVERRIDES handles
        // the rest; UI for these is removed in Task 7.
        waterDepth: -0.01,
        tireWarmers: true,
        timeScale: 1,                   // Normal real time
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
```

- [ ] **Step 2: Update all old-field readers/writers** — search for stale references:

```bash
grep -n "state.overrides.weatherPreset\|state.overrides.practiceLength\|state.overrides.practiceStartingTime\|state.overrides.privatePractice\|state.overrides.startingGrip\|state.overrides.realRoadTimeScale\|state.overrides.customWeather" app/src/renderer/app.js
```

For each match, route through `state.overrides.sessions.practice.*` (or appropriate session). The launcher UI in this PR still drives Practice only until Task 7 adds the new Sessions UI; Qualifying + Race remain at their defaults.

Specific known sites to fix:
1. `selectPreset(name)` — currently writes `state.overrides.weatherPreset = name`. Change to: `state.overrides.sessions.practice.weatherPreset = name;` (and propagate to qualifying/race once their UI exists in Task 7).
2. `bindRange('practiceLength', 'practiceLength', …)` — needs a custom path writer. Replace the `bindRange` call sites that write `practiceLength`, `practiceStartingTime`, `realRoadTimeScale`, `startingGrip` etc. with a new helper `bindToSession(id, sessionKey, fieldKey, parser)`:

Add this helper near `bindSelect`:
```js
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
```

Then replace the practice-binding lines in `DOMContentLoaded`:
```js
    bindRange('practiceLength', 'practiceLength', (v) => `${v} min`);
    bindRange('startTime', 'practiceStartingTime', formatTime);
    bindRange('realRoadTimeScale', 'realRoadTimeScale', (v) => `${v}×`);
    ...
    bindSelect('startingGrip', 'startingGrip');
    ...
    bindCheckbox('privatePractice', 'privatePractice');
```
with:
```js
    bindToSession('practiceLength', 'practice', 'length', Number);
    bindToSession('startTime', 'practice', 'startTime', Number);
    bindToSession('realRoadTimeScale', 'practice', 'realRoadTimeScale', Number);
    bindToSession('startingGrip', 'practice', 'startingGrip');
    bindToSession('privatePractice', 'practice', 'privateSession');
```

(The format-output side-effects from `bindRange` are preserved: the helper sets the Val element via the parser when it's a range. This may need polishing during implementation — verify the practiceLength/startTime/realRoadTimeScale labels still update as the slider moves.)

3. `updateSummary()` — references `state.overrides.weatherPreset`, `state.overrides.customWeather`, `state.overrides.practiceLength`, `state.overrides.practiceStartingTime`. Update to read from `state.overrides.sessions.practice.*`:

Find:
```js
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
```

Replace with:
```js
    const p = state.overrides.sessions.practice;
    if (p.weatherPreset === 'dry') {
        $('sumWx').textContent = 'Dry · 20°C · Saturated';
    } else if (p.weatherPreset === 'overcast_rain') {
        $('sumWx').textContent = 'Wet · Overcast & rain · 100% · 20°C';
    } else {
        const slot0 = p.customWeather[0];
        $('sumWx').textContent = `Custom · ${slot0.temperature}°C · ${slot0.rainChance}% rain`;
    }
    $('sumLen').textContent = `${p.length} min @ ${formatTime(p.startTime)}`;
```

4. `bindCustomRange` and the cwSky handler — currently write to `state.overrides.customWeather.sky / rainChance / temperature`. Reroute to `state.overrides.sessions.practice.customWeather[0].*` (slot 0 only — full 5-slot UI lands in Task 9 which deletes these old controls). For now this keeps the old single-slot Custom card functional during the transition; the controls are deleted in Task 7.

5. Same for `applyGoSetupsDefaults()` — it writes `state.overrides.timeScale`, `flagRules` etc. These are SHARED (not per-session) — they stay at top-level. No change.

- [ ] **Step 3: Update IPC payload in `lmu-launcher.js`** — but wait, the renderer ALSO sends `state.overrides` directly to main process via `window.go.launch(payload)`. Currently `lmu-launcher.composeSession` reads `o.weatherPreset, o.practiceLength, …`. We need to either (a) flatten the new sessions.practice fields back to the old keys before sending, or (b) update `composeSession` to read from `o.sessions.practice` etc.

Pick (b) — cleaner and Task 8 needs it anyway. For this task, just patch `composeSession` minimally so the existing launch flow still works:

In `app/src/main/lmu-launcher.js`, find the lines that read flat fields:
```js
    sp.Player['Game Options']['practice length'] = Number(o.practiceLength);
    sp.Player['Game Options']['Tire Warmers'] = !!o.tireWarmers;
    sp.Player['Race Conditions'].Practice1StartingTime = Number(o.practiceStartingTime);
    sp.Player['Race Conditions'].PrivatePractice = !!o.privatePractice;
    sp.Player['Race Conditions'].RealRoadTimeScalePractice = Number(o.realRoadTimeScale);
```

Replace with:
```js
    const practice = o.sessions?.practice || {};
    sp.Player['Game Options']['practice length'] = Number(practice.length ?? o.practiceLength ?? 60);
    sp.Player['Game Options']['Tire Warmers'] = !!o.tireWarmers;
    sp.Player['Race Conditions'].Practice1StartingTime = Number(practice.startTime ?? o.practiceStartingTime ?? 720);
    sp.Player['Race Conditions'].PrivatePractice = !!(practice.privateSession ?? o.privatePractice ?? true);
    sp.Player['Race Conditions'].RealRoadTimeScalePractice = Number(practice.realRoadTimeScale ?? o.realRoadTimeScale ?? 0);
```

(The fallbacks let the old payload format still work during the transition — removed in Task 8.)

Also the `block.Road.RealRoad = String(o.startingGrip);` line:
```js
        block.Road.RealRoad = String(o.startingGrip);
```
Replace with:
```js
        const sessKey = session.toLowerCase();  // 'practice' | 'qualifying' | 'race'
        const ss = o.sessions?.[sessKey] || {};
        block.Road.RealRoad = String(ss.startingGrip ?? o.startingGrip ?? 'preset:SATURATED.RRBIN');
```

And the `o.weatherPreset === 'custom'` slice-stamping block — change to:
```js
        const sessWeatherPreset = ss.weatherPreset ?? o.weatherPreset ?? 'dry';
        if (sessWeatherPreset === 'custom' && Array.isArray(ss.customWeather) && Array.isArray(block.Weather)) {
            for (let i = 0; i < block.Weather.length && i < ss.customWeather.length; i++) {
                const slot = ss.customWeather[i];
                if (slot.sky != null) block.Weather[i].Sky = Number(slot.sky);
                if (slot.rainChance != null) block.Weather[i].RainChance = Number(slot.rainChance);
                if (slot.temperature != null) block.Weather[i].Temperature = Number(slot.temperature);
            }
        }
```

And the `pickBlobForCustomRain(Number(o.customWeather?.rainChance) || 0)` line:
```js
    if (o.weatherPreset === 'custom') {
        blobName = pickBlobForCustomRain(Number(o.customWeather?.rainChance) || 0);
    } else {
        blobName = WEATHER_PRESETS.includes(o.weatherPreset) ? o.weatherPreset : 'dry';
    }
```
Replace with:
```js
    const practiceWp = o.sessions?.practice?.weatherPreset ?? o.weatherPreset ?? 'dry';
    if (practiceWp === 'custom') {
        const cw0 = o.sessions?.practice?.customWeather?.[0] || o.customWeather || {};
        blobName = pickBlobForCustomRain(Number(cw0.rainChance) || 0);
    } else {
        blobName = WEATHER_PRESETS.includes(practiceWp) ? practiceWp : 'dry';
    }
```

(Picks Practice's weatherPreset for the blob choice — Tasks 8/13 generalize this for per-session blobs.)

- [ ] **Step 4: Verify**

```bash
node --check app/src/renderer/app.js
node --check app/src/main/lmu-launcher.js
grep -nE "state\.overrides\.(weatherPreset|practiceLength|practiceStartingTime|privatePractice|startingGrip|realRoadTimeScale|customWeather)" app/src/renderer/app.js
# Expected: 0 (or only inside legacy bindCustomRange wrapping that's deleted in Task 7)
grep -n "sessions.practice" app/src/renderer/app.js
# Expected: at least 5 matches
grep -n "o.sessions" app/src/main/lmu-launcher.js
# Expected: at least 4 matches
```

- [ ] **Step 5: Commit**

```bash
git add app/src/renderer/app.js app/src/main/lmu-launcher.js
git commit -m "refactor(launcher): per-session state model (sessions.practice/qualifying/race)"
```

---

## Task 7: Sessions card HTML restructure (D2)

**Files:**
- Modify: `app/src/renderer/index.html` — replace Card 03 (Weather Preset) and Card 04 (Practice settings) with single Sessions card
- Modify: `app/src/renderer/styles.css` — add styles for sub-cards, slot grid, weather preset segmented control
- Modify: `app/src/renderer/app.js` — add UI bindings, remove deleted-control bindings

This is the largest task. Bite-sized steps:

- [ ] **Step 1: Confirm anchor lines in `app/src/renderer/index.html`**

```bash
grep -n "<!-- WEATHER -->\|<!-- SESSION -->\|panel-weather\|panel-session" app/src/renderer/index.html
```

Expected: `<!-- WEATHER -->` at ~line 134, `<!-- SESSION -->` at ~line 239. Their `</section>` closers are at ~lines 237 and 336 respectively. The replacement deletes lines 134-336 inclusive (both cards) and inserts the new Sessions panel in their place. Verify the line numbers in the current file before deleting — they may have shifted from earlier tasks.

- [ ] **Step 2: Build the replacement HTML** — delete lines 134-336 (the old `<!-- WEATHER -->` and `<!-- SESSION -->` sections) and insert this in their place:

```html
  <!-- SESSIONS -->
  <section class="panel panel-sessions">
    <div class="panel-header">
      <div>
        <div class="panel-eyebrow"><span class="num">03</span> Race Weekend</div>
        <h2 class="panel-title">Sessions</h2>
      </div>
    </div>

    <div class="sessions-list">

    <!-- Practice -->
    <div class="session-card" data-session="practice" data-enabled="true">
      <div class="session-head">
        <span class="session-name">Practice</span>
        <label class="s-switch">
          <input type="checkbox" id="sessPractice_enabled" checked />
          <span class="s-switch-track"><span class="s-switch-thumb"></span></span>
        </label>
      </div>
      <div class="session-body">

        <div class="session-group">
          <div class="session-group-title">Weather</div>
          <div class="weather-preset-row">
            <button class="wx-pill active" data-session="practice" data-preset="dry">Dry</button>
            <button class="wx-pill" data-session="practice" data-preset="overcast_rain">Wet</button>
            <button class="wx-pill" data-session="practice" data-preset="custom">Custom</button>
          </div>
          <div class="custom-weather hidden" data-custom-for="practice">
            <div class="slot-grid">
              <!-- 5 slots, generated by JS in Task 9. Placeholder structure below. -->
            </div>
            <div class="preset-actions">
              <button class="s-btn" data-action="save-preset" data-session="practice">Save preset…</button>
              <button class="s-btn" data-action="load-preset" data-session="practice">Load preset…</button>
            </div>
          </div>
        </div>

        <div class="session-group">
          <div class="session-group-title">Length & timing</div>
          <label class="field">
            <span class="field-label">Length <em data-out="practice_length">6h 0m</em></span>
            <input type="range" data-input="practice_length" min="1" max="360" step="1" value="360" />
          </label>
          <label class="field">
            <span class="field-label">Start time <em data-out="practice_startTime">12:00</em></span>
            <input type="range" data-input="practice_startTime" min="0" max="1439" step="1" value="720" />
          </label>
          <label class="field-toggle">
            <span class="field-label">Private session</span>
            <input type="checkbox" data-input="practice_privateSession" checked />
          </label>
        </div>

        <div class="session-group">
          <div class="session-group-title">Track conditions</div>
          <label class="field">
            <span class="field-label">Starting grip</span>
            <select class="select" data-input="practice_startingGrip">
              <option value="preset:SATURATED.RRBIN">Saturated</option>
              <option value="preset:HEAVY.RRBIN">Heavy</option>
              <option value="preset:MEDIUM.RRBIN">Medium</option>
              <option value="preset:LIGHT.RRBIN">Light</option>
              <option value="preset:GREEN.RRBIN">Green</option>
            </select>
          </label>
          <label class="field">
            <span class="field-label">RealRoad scale <em data-out="practice_realRoadTimeScale">0×</em></span>
            <input type="range" data-input="practice_realRoadTimeScale" min="0" max="15" step="1" value="0" />
          </label>
        </div>

      </div>
    </div>

    <!-- Qualifying -->
    <div class="session-card" data-session="qualifying">
      <div class="session-head">
        <span class="session-name">Qualifying</span>
        <label class="s-switch">
          <input type="checkbox" id="sessQualifying_enabled" />
          <span class="s-switch-track"><span class="s-switch-thumb"></span></span>
        </label>
      </div>
      <div class="session-body">
        <div class="session-group">
          <div class="session-group-title">Weather</div>
          <div class="weather-preset-row">
            <button class="wx-pill active" data-session="qualifying" data-preset="dry">Dry</button>
            <button class="wx-pill" data-session="qualifying" data-preset="overcast_rain">Wet</button>
            <button class="wx-pill" data-session="qualifying" data-preset="custom">Custom</button>
          </div>
          <div class="custom-weather hidden" data-custom-for="qualifying">
            <div class="slot-grid"></div>
            <div class="preset-actions">
              <button class="s-btn" data-action="save-preset" data-session="qualifying">Save preset…</button>
              <button class="s-btn" data-action="load-preset" data-session="qualifying">Load preset…</button>
            </div>
          </div>
        </div>
        <div class="session-group">
          <div class="session-group-title">Length & timing</div>
          <label class="field">
            <span class="field-label">Length <em data-out="qualifying_length">20 min</em></span>
            <input type="range" data-input="qualifying_length" min="1" max="60" step="1" value="20" />
          </label>
          <label class="field">
            <span class="field-label">Start time <em data-out="qualifying_startTime">15:00</em></span>
            <input type="range" data-input="qualifying_startTime" min="0" max="1439" step="1" value="900" />
          </label>
          <label class="field-toggle">
            <span class="field-label">Private session</span>
            <input type="checkbox" data-input="qualifying_privateSession" checked />
          </label>
        </div>
        <div class="session-group">
          <div class="session-group-title">Track conditions</div>
          <label class="field">
            <span class="field-label">Starting grip</span>
            <select class="select" data-input="qualifying_startingGrip">
              <option value="preset:SATURATED.RRBIN">Saturated</option>
              <option value="preset:HEAVY.RRBIN" selected>Heavy</option>
              <option value="preset:MEDIUM.RRBIN">Medium</option>
              <option value="preset:LIGHT.RRBIN">Light</option>
              <option value="preset:GREEN.RRBIN">Green</option>
            </select>
          </label>
          <label class="field">
            <span class="field-label">RealRoad scale <em data-out="qualifying_realRoadTimeScale">0×</em></span>
            <input type="range" data-input="qualifying_realRoadTimeScale" min="0" max="15" step="1" value="0" />
          </label>
        </div>
      </div>
    </div>

    <!-- Race -->
    <div class="session-card" data-session="race">
      <div class="session-head">
        <span class="session-name">Race</span>
        <label class="s-switch">
          <input type="checkbox" id="sessRace_enabled" />
          <span class="s-switch-track"><span class="s-switch-thumb"></span></span>
        </label>
      </div>
      <div class="session-body">
        <div class="session-group">
          <div class="session-group-title">Weather</div>
          <div class="weather-preset-row">
            <button class="wx-pill active" data-session="race" data-preset="dry">Dry</button>
            <button class="wx-pill" data-session="race" data-preset="overcast_rain">Wet</button>
            <button class="wx-pill" data-session="race" data-preset="custom">Custom</button>
          </div>
          <div class="custom-weather hidden" data-custom-for="race">
            <div class="slot-grid"></div>
            <div class="preset-actions">
              <button class="s-btn" data-action="save-preset" data-session="race">Save preset…</button>
              <button class="s-btn" data-action="load-preset" data-session="race">Load preset…</button>
            </div>
          </div>
        </div>
        <div class="session-group">
          <div class="session-group-title">Length & timing</div>
          <label class="field">
            <span class="field-label">Start type</span>
            <select class="select" data-input="race_startType">
              <option value="rolling">Rolling</option>
              <option value="fast_rolling">Fast Rolling</option>
            </select>
          </label>
          <label class="field">
            <span class="field-label">Length <em data-out="race_length">4h 0m</em></span>
            <input type="range" data-input="race_length" min="1" max="1440" step="1" value="240" />
          </label>
          <label class="field">
            <span class="field-label">Start time <em data-out="race_startTime">13:00</em></span>
            <input type="range" data-input="race_startTime" min="0" max="1439" step="1" value="780" />
          </label>
        </div>
        <div class="session-group">
          <div class="session-group-title">Track conditions</div>
          <label class="field">
            <span class="field-label">Starting grip</span>
            <select class="select" data-input="race_startingGrip">
              <option value="preset:SATURATED.RRBIN">Saturated</option>
              <option value="preset:HEAVY.RRBIN">Heavy</option>
              <option value="preset:MEDIUM.RRBIN">Medium</option>
              <option value="preset:LIGHT.RRBIN">Light</option>
              <option value="preset:GREEN.RRBIN">Green</option>
            </select>
          </label>
          <label class="field">
            <span class="field-label">RealRoad scale <em data-out="race_realRoadTimeScale">0×</em></span>
            <input type="range" data-input="race_realRoadTimeScale" min="0" max="15" step="1" value="0" />
          </label>
        </div>
      </div>
    </div>

    </div>
  </section>
```

- [ ] **Step 3: Add CSS to `app/src/renderer/styles.css`** — append at the end of the file:

```css
/* ── Sessions panel (D2) ─────────────────────────────────── */
.panel-sessions .sessions-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.session-card {
  border: 1px solid var(--border, #2a2a2a);
  border-radius: 8px;
  background: var(--surface-2, #161616);
  overflow: hidden;
}
.session-card .session-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: var(--surface-3, #1c1c1c);
  cursor: default;
}
.session-card .session-head .session-name {
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.02em;
}
.session-card .session-body {
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.session-card[data-enabled="false"] .session-body {
  display: none;
}
.session-group {
  border-top: 1px dashed var(--border-faint, #232323);
  padding-top: 10px;
}
.session-group:first-child {
  border-top: 0;
  padding-top: 0;
}
.session-group-title {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-faint, #777);
  margin-bottom: 8px;
}
.weather-preset-row {
  display: flex;
  gap: 6px;
  margin-bottom: 10px;
}
.weather-preset-row .wx-pill {
  flex: 1;
  padding: 8px 12px;
  border-radius: 6px;
  border: 1px solid var(--border, #2a2a2a);
  background: transparent;
  color: var(--text, #ddd);
  font-size: 12px;
  cursor: pointer;
}
.weather-preset-row .wx-pill.active {
  background: var(--accent, #ff4646);
  color: #fff;
  border-color: var(--accent, #ff4646);
}
.custom-weather {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.custom-weather.hidden {
  display: none;
}
.slot-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 8px;
}
.slot-cell {
  border: 1px solid var(--border, #2a2a2a);
  border-radius: 6px;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: var(--surface-3, #1c1c1c);
}
.slot-cell .slot-label {
  font-size: 10px;
  color: var(--text-faint, #777);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  text-align: center;
}
.slot-cell select,
.slot-cell input[type="number"] {
  width: 100%;
  background: var(--surface-2, #161616);
  border: 1px solid var(--border, #2a2a2a);
  color: var(--text, #ddd);
  padding: 4px;
  font-size: 11px;
  border-radius: 4px;
}
.preset-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
.field-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 0;
}
```

- [ ] **Step 4: Add data-input bindings in `app/src/renderer/app.js`** — add this generic binder near the other bind helpers, then call it inside `DOMContentLoaded`:

```js
function formatLengthLabel(min) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return h > 0 ? `${h}h ${m}m` : `${m} min`;
}

function bindDataInput(el) {
    const key = el.dataset.input;            // e.g. "practice_length"
    if (!key) return;
    const [sessKey, fieldKey] = key.split('_');
    const out = document.querySelector(`[data-out="${key}"]`);
    const update = () => {
        let raw = el.type === 'checkbox' ? el.checked : el.value;
        let v = el.type === 'range' ? Number(raw) : raw;
        // numeric coercion for selects with numeric values
        if (el.tagName === 'SELECT' && fieldKey === 'realRoadTimeScale') v = Number(raw);
        state.overrides.sessions[sessKey][fieldKey] = v;
        if (out) {
            if (fieldKey === 'length')      out.textContent = formatLengthLabel(Number(raw));
            else if (fieldKey === 'startTime') out.textContent = formatTime(Number(raw));
            else if (fieldKey === 'realRoadTimeScale') out.textContent = `${raw}×`;
            else out.textContent = String(raw);
        }
        if (el.type === 'range') updateRangeFill(el);
        updateSummary();
    };
    el.addEventListener(el.type === 'checkbox' ? 'change' : (el.type === 'range' ? 'input' : 'change'), update);
    update();
}

function bindAllSessionInputs() {
    document.querySelectorAll('[data-input]').forEach(bindDataInput);
}

function bindEnableToggles() {
    ['practice', 'qualifying', 'race'].forEach((sk) => {
        const cb = $(`sess${sk[0].toUpperCase() + sk.slice(1)}_enabled`);
        if (!cb) return;
        const card = document.querySelector(`.session-card[data-session="${sk}"]`);
        const apply = () => {
            state.overrides.sessions[sk].enabled = cb.checked;
            if (card) card.dataset.enabled = String(cb.checked);
        };
        cb.addEventListener('change', apply);
        apply();
    });
}

function bindWeatherPresetPills() {
    document.querySelectorAll('.weather-preset-row .wx-pill').forEach((btn) => {
        btn.addEventListener('click', () => {
            const sk = btn.dataset.session;
            const preset = btn.dataset.preset;
            state.overrides.sessions[sk].weatherPreset = preset;
            // toggle pill active state within this row
            btn.parentElement.querySelectorAll('.wx-pill').forEach(b => b.classList.toggle('active', b === btn));
            // toggle custom panel visibility for this session
            const customPanel = document.querySelector(`.custom-weather[data-custom-for="${sk}"]`);
            if (customPanel) customPanel.classList.toggle('hidden', preset !== 'custom');
            updateSummary();
        });
    });
}
```

Then add inside `DOMContentLoaded`:
```js
    bindAllSessionInputs();
    bindEnableToggles();
    bindWeatherPresetPills();
```

**Scope note: Rules group is removed.** The old Card 04 also contained a "Rules" group (Flag rules, Track limits, Track limit points, Mechanical failures, Tire warmers, Private practice). Those `<select>`s had the same no-value-attr bug as the grip dropdown (B7) and were silently broken — `Number("Full w/o DQ")` = NaN, so users were getting `lmu-launcher.js` `DEFAULT_OVERRIDES` values regardless of what they clicked. We delete the UI in this PR (matches the spec, which doesn't mention rules) and rely on `DEFAULT_OVERRIDES` to provide the GO Setups baseline. A follow-up bucket can re-introduce per-session rules with proper `value=` attributes.

To prevent regression in defaults:

In `app/src/main/lmu-launcher.js`, find:
```js
    timeScale: 0,                   // 0 = Normal real time, 1-60 = ×N
```
Change to:
```js
    timeScale: 1,                   // 1 = Normal real time (was 0=None pre-v3.0.4)
```

This matches the renderer's `GO_SETUPS_DEFAULTS.timeScale = 1` from Bucket A.

- [ ] **Step 5: Remove old launcher controls and bindings** — these reference DOM elements that no longer exist (the deleted Card 03/04 markup). Search and delete:

```bash
grep -n "bindRange('practiceLength'\|bindRange('startTime'\|bindRange('realRoadTimeScale'\|bindSelect('startingGrip'\|bindCheckbox('privatePractice'\|bindCustomRange\|cwSky\|cwTemp\|cwRain" app/src/renderer/app.js
```

Delete every matching line. Then delete these orphaned functions, constants, and call sites:
- `bindRange('practiceLength' …)`, `bindRange('startTime' …)`, `bindRange('realRoadTimeScale' …)`, `bindRange('timeScale' …)`, `bindRange('trackLimitsPoints' …)` calls
- `bindSelect('startingGrip' …)`, `bindSelect('flagRules' …)`, `bindSelect('trackLimitsRules' …)`, `bindSelect('mechanicalFailures' …)` calls
- `bindCheckbox('tireWarmers' …)`, `bindCheckbox('privatePractice' …)` calls
- `bindCustomRange()` function and its call sites
- The cwSky/cwTemp/cwRain blocks
- `selectPreset(name)` function — replaced by `bindWeatherPresetPills`
- `applyGoSetupsDefaults()` function — replaced by `bindAllSessionInputs`
- `GO_SETUPS_DEFAULTS` constant — no longer needed in renderer (defaults live in HTML `value=` attributes); the main process keeps its own `DEFAULT_OVERRIDES` for back-stop
- `PRACTICE_FIELD_IDS` constant + `practiceDefaults` variable
- `capturePracticeDefaults()`, `isPracticeModified()`, `refreshPracticeStatus()` functions
- Any call sites for the practice-status helpers (search for `refreshPracticeStatus(`)

Verify after deletion:

```bash
grep -n "PRACTICE_FIELD_IDS\|practiceDefaults\|capturePracticeDefaults\|isPracticeModified\|refreshPracticeStatus\|selectPreset\|applyGoSetupsDefaults\|GO_SETUPS_DEFAULTS\|bindCustomRange" app/src/renderer/app.js
# Expected: 0 matches
```

- [ ] **Step 6: Verify**

```bash
node --check app/src/renderer/app.js
grep -n "selectPreset\|applyGoSetupsDefaults\|bindCustomRange\|cwSky\|cwTemp\|cwRain" app/src/renderer/app.js
# Expected: 0 matches
grep -n "session-card\|sessions-list\|weather-preset-row" app/src/renderer/index.html
# Expected: at least 6 matches (3 session-cards + 3 preset-rows)
grep -n "data-input\|data-session" app/src/renderer/index.html | head -20
# Expected: many matches per session
```

- [ ] **Step 7: Commit**

```bash
git add app/src/renderer/index.html app/src/renderer/styles.css app/src/renderer/app.js
git commit -m "feat(launcher): merge Card 03 + 04 into per-session Sessions card with Practice/Qual/Race"
```

---

## Task 8: Backend per-session writes (D3)

**Files:**
- Modify: `app/src/main/lmu-launcher.js` — `composeSession()` function

- [ ] **Step 1: Reference LMU's settings.json field names** — before writing code, dump LMU's player settings to confirm exact field names used for Qualifying / Race timings and for session enable toggles:

```bash
ls "$USERPROFILE/Documents/Le Mans Ultimate/UserData/player/" 2>/dev/null
# Look for settings.json or similar
```

Open whatever player settings file exists (likely `settings.json` next to the player profile) and search for `Qualify1StartingTime`, `RaceStartingTime`, `RealRoadTimeScaleQualify`, `Run Practice`, `RaceStartType`, etc. Note the EXACT casing/spelling.

If you can't find a player settings file, check `<lmu-install>/UserData/player/settings.json`. Worst case: search for these symbols in any file under the LMU UserData root using:
```bash
grep -r "Qualify1StartingTime\|RaceStartingTime\|RaceStartType" "$USERPROFILE/Documents/Le Mans Ultimate/UserData/" 2>/dev/null | head
```

Record the exact field names in implementation notes; the rest of this task assumes the documented field names below but the implementer must verify.

- [ ] **Step 2: Update `composeSession` in `app/src/main/lmu-launcher.js`** — find and replace the per-session block.

Find the block that currently reads `o.practiceLength`, etc. (we partially patched it in Task 6). Replace the entire per-session read/write block with:

```js
    // Per-session writes (D3)
    const sessions = o.sessions || {};
    const SESSION_MAP = [
        // [stateKey, sessionPresetKey, lengthField, startTimeField, privateField, realRoadField]
        ['practice',   'Practice',   'practice length',   'Practice1StartingTime', 'PrivatePractice', 'RealRoadTimeScalePractice'],
        ['qualifying', 'Qualifying', 'qualifying length', 'Qualify1StartingTime',  'PrivateQualifying','RealRoadTimeScaleQualifying'],
        ['race',       'Race',       'race length',       'RaceStartingTime',      null,               'RealRoadTimeScaleRace'],
    ];

    for (const [sKey, presetSession, lenField, startField, privField, rrField] of SESSION_MAP) {
        const ss = sessions[sKey] || {};
        const enabled = ss.enabled !== false; // default true if undefined
        const length = enabled ? Number(ss.length ?? 60) : 1;  // 1-min sessions are skipped quickly by LMU
        sp.Player['Game Options'][lenField] = length;
        sp.Player['Race Conditions'][startField] = Number(ss.startTime ?? 720);
        if (privField) {
            sp.Player['Race Conditions'][privField] = !!(ss.privateSession ?? true);
        }
        sp.Player['Race Conditions'][rrField] = Number(ss.realRoadTimeScale ?? 0);
    }

    // Race start type — Race only.
    // LMU enum (verify against real settings.json): 0=Standing, 1=Rolling, 2=FastRolling
    const raceStartType = sessions.race?.startType ?? 'rolling';
    sp.Player['Race Conditions'].RaceStartType = raceStartType === 'fast_rolling' ? 2 : 1;

    // Tire warmers stays shared (top-level)
    sp.Player['Game Options']['Tire Warmers'] = !!o.tireWarmers;

    // Apply RealRoad starting grip per-session (replaces the old shared write)
    for (const session of ['Practice', 'Qualifying', 'Race']) {
        const block = sp.Weather?.[session];
        if (!block) continue;
        block.Road = block.Road || {};
        const sKey = session.toLowerCase();
        const ss = sessions[sKey] || {};
        block.Road.RealRoad = String(ss.startingGrip ?? 'preset:SATURATED.RRBIN');
        block.Road.WaterDepth = Number(o.waterDepth ?? -0.01);
        block.Road.LoadTemperaturesFromRealRoadFile = false;
    }

    // Compute end ET from PRACTICE length (this drives the watcher's session-end heuristic).
    // For a multi-session weekend, total length = sum of enabled sessions, but we keep the
    // legacy single-figure semantics for now. End ET is purely informational here.
    const practiceLength = Number(sessions.practice?.length ?? 60);
    const endET = practiceLength * 60 + 5;
```

- [ ] **Step 3: Remove the old single-session writes** — search for and delete the lines:
```bash
grep -n "o.practiceLength\|o.practiceStartingTime\|o.privatePractice\|o.realRoadTimeScale" app/src/main/lmu-launcher.js
```
Delete every line that references those fields directly (the `o.sessions.practice.*` reads above replace them).

- [ ] **Step 4: Update `endET` consumer** — search for `endET` references; the `composeSession` return object uses it. Just keep the practice-length-based computation for now.

- [ ] **Step 5: Verify**

```bash
node --check app/src/main/lmu-launcher.js
grep -n "Qualify1StartingTime\|RaceStartingTime\|RaceStartType\|RealRoadTimeScaleQualifying\|RealRoadTimeScaleRace\|qualifying length\|race length" app/src/main/lmu-launcher.js
# Expected: at least 6 matches
grep -n "o\.practiceLength\|o\.practiceStartingTime\|o\.privatePractice\|o\.realRoadTimeScale" app/src/main/lmu-launcher.js
# Expected: 0 matches
```

- [ ] **Step 6: Commit**

```bash
git add app/src/main/lmu-launcher.js
git commit -m "feat(launcher): write per-session Race Conditions + lengths for full race weekend"
```

---

## Task 9: Custom 5-slot grid generation (C2)

**Files:**
- Modify: `app/src/renderer/app.js` — generate slot cells per session, bind their inputs

- [ ] **Step 1: Add a slot-grid renderer in `app/src/renderer/app.js`** — add this near the other UI helpers:

```js
const SKY_OPTIONS = [
    [0, 'Clear'], [1, 'Light clouds'], [2, 'Partially cloudy'], [3, 'Mostly cloudy'],
    [4, 'Overcast'], [5, 'Cloudy & drizzle'], [6, 'Cloudy & light rain'],
    [7, 'Overcast & light rain'], [8, 'Overcast & rain'], [9, 'Overcast & heavy rain'],
    [10, 'Overcast & storm'],
];

function renderSlotGrid(sessKey) {
    const grid = document.querySelector(`.custom-weather[data-custom-for="${sessKey}"] .slot-grid`);
    if (!grid) return;
    const slots = state.overrides.sessions[sessKey].customWeather;
    grid.innerHTML = '';
    for (let i = 0; i < 5; i++) {
        const slot = slots[i];
        const cell = document.createElement('div');
        cell.className = 'slot-cell';
        cell.innerHTML = `
            <div class="slot-label">Slot ${i + 1}</div>
            <select data-slot-field="sky" data-slot-index="${i}">
                ${SKY_OPTIONS.map(([v, l]) => `<option value="${v}"${v === slot.sky ? ' selected' : ''}>${l}</option>`).join('')}
            </select>
            <input type="number" min="0" max="100" step="5" data-slot-field="rainChance" data-slot-index="${i}" value="${slot.rainChance}" placeholder="Rain %" />
            <input type="number" min="-10" max="50" step="1" data-slot-field="temperature" data-slot-index="${i}" value="${slot.temperature}" placeholder="Temp °C" />
        `;
        cell.querySelectorAll('select, input').forEach((inp) => {
            inp.addEventListener('change', () => {
                const idx = Number(inp.dataset.slotIndex);
                const field = inp.dataset.slotField;
                state.overrides.sessions[sessKey].customWeather[idx][field] = Number(inp.value);
                updateSummary();
            });
        });
        grid.appendChild(cell);
    }
}

function renderAllSlotGrids() {
    ['practice', 'qualifying', 'race'].forEach(renderSlotGrid);
}
```

- [ ] **Step 2: Call `renderAllSlotGrids()` after `bindAllSessionInputs()` in `DOMContentLoaded`**:

```js
    bindAllSessionInputs();
    bindEnableToggles();
    bindWeatherPresetPills();
    renderAllSlotGrids();
```

- [ ] **Step 3: Verify**

```bash
node --check app/src/renderer/app.js
grep -n "renderSlotGrid\|SKY_OPTIONS\|slot-cell" app/src/renderer/app.js
# Expected: at least 4 matches
```

- [ ] **Step 4: Commit**

```bash
git add app/src/renderer/app.js
git commit -m "feat(launcher): render 5-slot custom weather grid per session"
```

---

## Task 10: Save/load custom presets (C3)

**Files:**
- Modify: `app/src/renderer/app.js` — wire the save/load buttons + add preset-list management

- [ ] **Step 1: Add preset management to `app/src/renderer/app.js`** — add this near the other helpers:

```js
const PRESET_CAP = 50;

async function loadPresets() {
    const arr = await window.go.getSetting('customWeatherPresets');
    return Array.isArray(arr) ? arr : [];
}

async function savePresets(arr) {
    await window.go.setSetting('customWeatherPresets', arr.slice(-PRESET_CAP));
}

function snapshotCurrentCustom() {
    return {
        practice:   state.overrides.sessions.practice.customWeather.map(s => ({ ...s })),
        qualifying: state.overrides.sessions.qualifying.customWeather.map(s => ({ ...s })),
        race:       state.overrides.sessions.race.customWeather.map(s => ({ ...s })),
    };
}

async function onSavePreset() {
    const name = prompt('Name this preset:');
    if (!name) return;
    const arr = await loadPresets();
    arr.push({
        id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `p-${Date.now()}`,
        name,
        createdAt: Date.now(),
        config: snapshotCurrentCustom(),
    });
    await savePresets(arr);
    logLine(`Saved preset "${name}"`, 'ok');
}

async function onLoadPreset() {
    const arr = await loadPresets();
    if (!arr.length) { alert('No presets saved yet.'); return; }
    const labels = arr.map((p, i) => `${i + 1}. ${p.name} (${new Date(p.createdAt).toLocaleDateString()})`).join('\n');
    const choice = prompt(`Load which preset?\n${labels}\n\nEnter number or 'd<num>' to delete:`);
    if (!choice) return;
    if (/^d\d+$/i.test(choice)) {
        const i = Number(choice.slice(1)) - 1;
        if (i >= 0 && i < arr.length) {
            if (confirm(`Delete preset "${arr[i].name}"?`)) {
                arr.splice(i, 1);
                await savePresets(arr);
                logLine(`Deleted preset.`, 'ok');
            }
        }
        return;
    }
    const idx = Number(choice) - 1;
    if (idx < 0 || idx >= arr.length) return;
    const cfg = arr[idx].config;
    if (cfg.practice)   state.overrides.sessions.practice.customWeather   = cfg.practice;
    if (cfg.qualifying) state.overrides.sessions.qualifying.customWeather = cfg.qualifying;
    if (cfg.race)       state.overrides.sessions.race.customWeather       = cfg.race;
    renderAllSlotGrids();
    updateSummary();
    logLine(`Loaded preset "${arr[idx].name}"`, 'ok');
}

function bindPresetActions() {
    document.querySelectorAll('[data-action="save-preset"]').forEach((b) => b.addEventListener('click', onSavePreset));
    document.querySelectorAll('[data-action="load-preset"]').forEach((b) => b.addEventListener('click', onLoadPreset));
}
```

- [ ] **Step 2: Call `bindPresetActions()` in `DOMContentLoaded`** — add after `renderAllSlotGrids()`:

```js
    bindPresetActions();
```

- [ ] **Step 3: Verify**

```bash
node --check app/src/renderer/app.js
grep -n "snapshotCurrentCustom\|onSavePreset\|onLoadPreset\|customWeatherPresets" app/src/renderer/app.js
# Expected: at least 6 matches
```

- [ ] **Step 4: Commit**

```bash
git add app/src/renderer/app.js
git commit -m "feat(launcher): save/load custom weather presets via settings store"
```

---

## Task 11: Slice stamping for all weather presets (B8 + C4)

**Files:**
- Modify: `app/src/main/lmu-launcher.js` — extend slice writes to dry/wet/custom

- [ ] **Step 1: Define slice values per preset in `app/src/main/lmu-launcher.js`** — add near the top of the file:

```js
// Slice values stamped into SessionPreset.Weather[*].Weather[i] for each preset.
// 'dry' / 'overcast_rain' use the same fixed values across all 5 slots; 'custom'
// uses the per-slot user input (handled inline in composeSession).
const PRESET_SLICE_VALUES = {
    dry:           { Sky: 0, RainChance: 0,   Temperature: 20 },
    overcast_rain: { Sky: 8, RainChance: 100, Temperature: 20 },
};
```

- [ ] **Step 2: Replace the per-session slice-stamping block in `composeSession`** — find the existing per-session loop that writes Road + (when custom) slice values. Replace its inner slice-handling block with a unified version that handles all 3 presets:

```js
        // Slice stamping (B8 + C4): write Sky/RainChance/Temperature on every slot
        // for every preset. Other slice fields (Humidity, Wind*) keep template defaults.
        const sKey = session.toLowerCase();
        const ss = sessions[sKey] || {};
        const wp = ss.weatherPreset ?? 'dry';
        if (Array.isArray(block.Weather)) {
            for (let i = 0; i < block.Weather.length; i++) {
                let slotVals;
                if (wp === 'custom') {
                    slotVals = ss.customWeather?.[i];
                } else {
                    slotVals = {
                        sky:         PRESET_SLICE_VALUES[wp]?.Sky         ?? 0,
                        rainChance:  PRESET_SLICE_VALUES[wp]?.RainChance  ?? 0,
                        temperature: PRESET_SLICE_VALUES[wp]?.Temperature ?? 20,
                    };
                }
                if (!slotVals) continue;
                if (slotVals.sky != null)         block.Weather[i].Sky         = Number(slotVals.sky);
                if (slotVals.rainChance != null)  block.Weather[i].RainChance  = Number(slotVals.rainChance);
                if (slotVals.temperature != null) block.Weather[i].Temperature = Number(slotVals.temperature);
            }
        }
```

- [ ] **Step 3: Update the blob-picker to use per-session presets** — find:

```js
    const practiceWp = o.sessions?.practice?.weatherPreset ?? o.weatherPreset ?? 'dry';
    if (practiceWp === 'custom') {
        const cw0 = o.sessions?.practice?.customWeather?.[0] || o.customWeather || {};
        blobName = pickBlobForCustomRain(Number(cw0.rainChance) || 0);
    } else {
        blobName = WEATHER_PRESETS.includes(practiceWp) ? practiceWp : 'dry';
    }
    const weatherBlob = WEATHER_BLOBS[blobName];
```

Replace with per-session blob array:

```js
    function pickBlobForSession(sess) {
        const wp = sess.weatherPreset ?? 'dry';
        if (wp === 'dry') return 'dry';
        if (wp === 'overcast_rain') return 'overcast_rain';
        // custom — pick by avg rain across the 5 slots
        const slots = sess.customWeather || [];
        if (!slots.length) return 'dry';
        const avgRain = slots.reduce((a, s) => a + Number(s.rainChance ?? 0), 0) / slots.length;
        if (avgRain >= 75) return 'storm';
        if (avgRain >= 30) return 'overcast_rain';
        return 'dry';
    }

    // weatherBlob is the 3-element array LMU expects: [Practice, Qualifying, Race].
    const weatherBlob = [
        WEATHER_BLOBS[pickBlobForSession(sessions.practice   || {})][0],
        WEATHER_BLOBS[pickBlobForSession(sessions.qualifying || {})][1],
        WEATHER_BLOBS[pickBlobForSession(sessions.race       || {})][2],
    ];
```

- [ ] **Step 4: Verify**

```bash
node --check app/src/main/lmu-launcher.js
grep -n "PRESET_SLICE_VALUES\|pickBlobForSession" app/src/main/lmu-launcher.js
# Expected: at least 3 matches
grep -c "block.Weather\[i\].Sky\s*=" app/src/main/lmu-launcher.js
# Expected: 1 (single unified write site)
```

- [ ] **Step 5: Commit**

```bash
git add app/src/main/lmu-launcher.js
git commit -m "feat(launcher): stamp Sky/Rain/Temp slices for all weather presets, per-session blob picking"
```

---

## Task 12: Investigation gate (manual; user-run)

**Files:** none changed.

This task is a manual handoff. The implementer must STOP after Task 11 and ask the user to run the test described in §2 of the spec. Do not start Task 13 until the user reports back.

- [ ] **Step 1: Build a test build for the user**

```bash
cd "C:/Users/andre/Desktop/LMU-Automatic weather/.worktrees/duckdb-motec/app"
npm run build 2>&1 | tail -3
```

Output: zip at `app/dist/GO-LMU-Launcher-3.0.3-win-x64.zip` (still 3.0.3 — version bump is Task 14, after the investigation).

- [ ] **Step 2: Send the user this message verbatim**:

> Investigation build ready. Install `app/dist/GO-LMU-Launcher-3.0.3-win-x64.zip`, then:
> 1. In LMU, start the launcher and open the new Sessions card.
> 2. On the Practice sub-card, click the **Wet** preset.
> 3. Click LAUNCH SESSION. Wait for LMU to load you into the garage.
> 4. Open LMU's pre-session weather screen and check: is the actual weather rainy?
> 5. Drive out — track surface should be wet.
>
> Report back with one of: `rain`, `sun`, `mixed`.

- [ ] **Step 3: Wait for user response.**

Based on the user's report, branch into Task 13's path A or B (both are spec'd in C5).

---

## Task 13: C5 implementation (post-investigation)

**Files:**
- Modify: `app/src/main/lmu-launcher.js` — pick one path

This task has TWO branches. Pick the one that matches the user's investigation report from Task 12.

### Path A — slices win (rain reported in §12)

If wet preset showed actual rain in-game, slices already drive weather. Strip the binary-blob workaround so Custom weather is fully respected.

- [ ] **Step A1: Update `composeSession` in `app/src/main/lmu-launcher.js`**:

Find the `weatherBlob` array construction from Task 11. Replace the entire block + the line that writes `Weather: weatherBlob` in the returned save object with:

```js
    // Slices drive in-game weather — no binary blob needed.
    // Set Weather mode to 0 (real-time / use slice values) instead of 4 (scripted blob).
    sp.Player['Race Conditions'].Weather = 0;
    const weatherBlob = [];  // empty array; LMU ignores when mode=0
```

- [ ] **Step A2: Verify**

```bash
node --check app/src/main/lmu-launcher.js
grep -n "Player\['Race Conditions'\]\.Weather =" app/src/main/lmu-launcher.js
# Expected: 1 match (= 0)
```

- [ ] **Step A3: Commit**

```bash
git add app/src/main/lmu-launcher.js
git commit -m "feat(weather): switch to slice-driven weather (mode=0); custom is now full-fidelity"
```

### Path B — blob wins (sun reported in §12)

Blob is authoritative; we keep the closest-blob picker from Task 11. No code change needed — Task 11's implementation already does this correctly.

- [ ] **Step B1: Add a UI hint about approximation** — in `app/src/renderer/app.js`, inside `bindWeatherPresetPills()`, append after the `customPanel` toggle:

```js
            // If switching to custom and we're using approximate blob path, log a hint.
            if (preset === 'custom') {
                logLine('Custom weather is approximated (uses closest of 3 captured weather profiles). Slice values still affect the in-game forecast display.', '');
            }
```

- [ ] **Step B2: Verify**

```bash
node --check app/src/renderer/app.js
grep -n "approximated" app/src/renderer/app.js
# Expected: 1 match
```

- [ ] **Step B3: Commit**

```bash
git add app/src/renderer/app.js
git commit -m "feat(weather): add UX hint when selecting Custom (blob-fallback path)"
```

---

## Task 14: v3.0.4 version bump + build + mirror

**Files:**
- Modify: `app/package.json` (version + buildDate)
- Modify: `app/src/renderer/index.html` (visible version strings)

- [ ] **Step 1: Bump `app/package.json`**

Find:
```json
  "version": "3.0.3",
  "buildDate": "2026-05-10",
```
Change `version` to `"3.0.4"`. `buildDate` already 2026-05-10; keep as-is.

- [ ] **Step 2: Bump visible strings in `app/src/renderer/index.html`**

```bash
grep -n "v3.0.3" app/src/renderer/index.html
# Expected: 2 matches (brand-tag + footer)
```

Replace both with `v3.0.4`:
- Line ~18 (brand tag): `<span class="brand-tag">LMU Launcher · <em>v3.0.4</em></span>`
- Line ~554 (footer): `<span>v3.0.4</span>`

- [ ] **Step 3: Verify no stale 3.0.3**

```bash
grep -rn "3\.0\.3" app/src app/package.json 2>/dev/null
# Expected: 0 matches
```

- [ ] **Step 4: Run the build**

```bash
cd "C:/Users/andre/Desktop/LMU-Automatic weather/.worktrees/duckdb-motec/app"
npm run build 2>&1 | tail -3
# Expected: "Done. GO-LMU-Launcher-3.0.4-win-x64.zip (~135 MB)"
```

- [ ] **Step 5: Mirror to main repo**

```bash
powershell -Command "Remove-Item -Recurse -Force 'C:/Users/andre/Desktop/LMU-Automatic weather/app/dist'; Copy-Item -Recurse -Force 'C:/Users/andre/Desktop/LMU-Automatic weather/.worktrees/duckdb-motec/app/dist' 'C:/Users/andre/Desktop/LMU-Automatic weather/app/dist'"
ls "C:/Users/andre/Desktop/LMU-Automatic weather/app/dist/"
# Expected: GO-LMU-Launcher-3.0.4-win-x64.zip
```

- [ ] **Step 6: Commit version bump**

```bash
cd "C:/Users/andre/Desktop/LMU-Automatic weather/.worktrees/duckdb-motec"
git add app/package.json app/src/renderer/index.html
git commit -m "chore: bump version to 3.0.4 (Bucket B/C/D launcher features)"
```

---

## Manual smoke test (run after Task 14)

Open `C:\Users\andre\Desktop\LMU-Automatic weather\app\dist\GO LMU Launcher-win32-x64\GO LMU Launcher.exe`.

Per the spec's verification section:

1. **Settings → About & logs:** no Check-for-updates / License / Channel rows. Version reads `3.0.4`. Updated reads `2026-05-10`.
2. **Settings → Open logs folder:** Explorer opens at userData/logs.
3. **Settings → Reset…:** dialog confirms, app reloads, settings cleared.
4. **Card 01 (Track):** Le Mans dropdown shows "Mulsanne" not "Bugatti". Monza shows "Curva Grande" not "Grande Anello". Paul Ricard shows "1A", "1AV2", "1AV2 Short", "3A".
5. **Card 03 (Sessions, Practice):** select Saturated grip → launch → LMU pre-session weather panel shows wet/saturated track surface.
6. **Card 03 (Sessions, Practice):** select Wet preset → launch → LMU pre-session forecast shows rain icons in all 5 slots.
7. **Card 03 (Sessions, Practice):** select Custom → 5-slot grid appears → edit slot values → click Save preset, name "test" → reload app → click Load preset → "test" → values restore.
8. **Race weekend:** enable Practice + Qualifying + Race → launch → LMU shows full race weekend (3 sessions in pre-race summary).
9. **Race-only:** disable Practice + Qualifying, enable Race only → launch → LMU jumps straight to race.
10. **Race start type:** Race sub-card → set Start type = Fast Rolling → launch → LMU race start screen confirms Fast Rolling.

Any failure → triage to a follow-up bucket.
