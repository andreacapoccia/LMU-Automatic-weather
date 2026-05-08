# Bucket A — UI / Settings Polish (v3.0.1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Address all 12 driver-test UI complaints in a single v3.0.1 release.

**Architecture:** Renderer changes (vanilla JS, no framework) plus three new main-process surfaces: a `lmu:getNavState` IPC, an `app:getDefaultWatchPath` IPC, and a `motec:open` extension that passes the `.w2k` workspace through. Session persistence reuses the existing `settings.set` IPC.

**Tech Stack:** Electron renderer (vanilla JS / HTML / CSS) + Electron main + LMU REST API at `localhost:6397`. Settings store: `electron-settings`-style file at `userData/settings.json`.

**Spec:** `docs/superpowers/specs/2026-05-08-bucket-a-ui-polish.md`

**Verification approach:** Manual smoke test in the running Electron app between tasks. No automated tests for the renderer exist or will be added by this plan. Each task ends with a `node --check` syntax sanity pass and a commit.

---

## Task 1: Watch-folder default + first-run banner refresh (spec items 1, 2)

**Files:**
- Modify: `app/src/main/main.js` (add `app:getDefaultWatchPath` IPC)
- Modify: `app/src/main/preload.js` (expose `getDefaultWatchPath`)
- Modify: `app/src/renderer/index.html` (`Detect` button gets ID; placeholder text updated)
- Modify: `app/src/renderer/app.js` (Detect click handler; `refreshFirstRunCard` helper)

- [ ] **Step 1: Add `app:getDefaultWatchPath` IPC handler in main.js**

Add after the existing `dialog:pickFolder` handler in `app/src/main/main.js` (around line 200):

```js
ipcMain.handle('app:getDefaultWatchPath', () => {
    return path.join(app.getPath('documents'), 'Le Mans Ultimate', 'UserData', 'Telemetry');
});
```

- [ ] **Step 2: Expose it in preload.js**

In `app/src/main/preload.js`, inside the `contextBridge.exposeInMainWorld('go', { ... })` object, add:

```js
getDefaultWatchPath: () => ipcRenderer.invoke('app:getDefaultWatchPath'),
```

- [ ] **Step 3: Add an ID to the Detect button in index.html**

Find this line (around line 620):

```html
<button class="s-btn" title="Auto-detect">Detect</button>
```

Change to:

```html
<button class="s-btn" id="detectWatchPath" title="Auto-detect">Detect</button>
```

- [ ] **Step 4: Update placeholder paths in index.html that mention Replays**

Find and replace these three lines (around lines 442, 615, 618):

```html
<span class="wc-path" id="watcherPath">…\Documents\Le Mans Ultimate\UserData\Replays</span>
```
becomes
```html
<span class="wc-path" id="watcherPath">…\Documents\Le Mans Ultimate\UserData\Telemetry</span>
```

```html
<span class="hint">GO checks this folder for new sessions every 2 seconds. Defaults to LMU's <code style="font-family:'JetBrains Mono',monospace;">UserData\Replays</code>.</span>
```
becomes
```html
<span class="hint">GO checks this folder for new sessions every 2 seconds. Defaults to LMU's <code style="font-family:'JetBrains Mono',monospace;">UserData\Telemetry</code>.</span>
```

```html
<input class="s-input mono" id="setWatchPath" value="C:\Users\Mateo\Documents\Le Mans Ultimate\UserData\Replays" />
```
becomes
```html
<input class="s-input mono" id="setWatchPath" value="" />
```

(Empty default value — populated at runtime from saved setting or by clicking Detect.)

- [ ] **Step 5: Wire the Detect button in `initDrawer` of app.js**

Find `initDrawer` in `app/src/renderer/app.js`. Inside it, add this block alongside the existing `browseWatchPath` handler:

```js
const detectBtn = $('detectWatchPath');
if (detectBtn) {
    detectBtn.addEventListener('click', async () => {
        const defaultPath = await window.go.getDefaultWatchPath();
        $('setWatchPath').value = defaultPath;
        await window.go.setSetting('watchDir', defaultPath);
        flashSaved();
        refreshFirstRunCard();
    });
}
```

- [ ] **Step 6: Add `refreshFirstRunCard` helper near the existing first-run logic**

Find the existing first-run card block in `initTelemetry` (around line 1151). Replace the inline visibility logic with a call to a new helper. Add the helper as a top-level function near the bottom of `initTelemetry` or right after it:

```js
async function refreshFirstRunCard() {
    const card = document.getElementById('firstRunCard');
    if (!card) return;
    const watchDir = await window.go.getSetting('watchDir') || '';
    const dismissed = await window.go.getSetting('firstRunDismissed') || false;
    card.style.display = (!watchDir && !dismissed) ? '' : 'none';
}
```

Replace the existing inline computation (the `firstRunCard.style.display = (!watchDir && !dismissed) ? '' : 'none'` line) with:

```js
await refreshFirstRunCard();
```

- [ ] **Step 7: Call `refreshFirstRunCard()` from existing watchDir save sites**

Find the `browseWatchPath` handler in `initDrawer` (around line 1012-1020). After the existing `await window.go.setSetting('watchDir', result.path)` call, add:

```js
await refreshFirstRunCard();
```

- [ ] **Step 8: Verify**

```bash
cd "C:/Users/andre/Desktop/LMU-Automatic weather/.worktrees/duckdb-motec"
node --check app/src/main/main.js
node --check app/src/main/preload.js
node --check app/src/renderer/app.js
grep -c "Replays" app/src/renderer/index.html
# Expected: 0 (zero occurrences)
grep -n "id=\"detectWatchPath\"" app/src/renderer/index.html
# Expected: one match on the Detect button
grep -n "refreshFirstRunCard" app/src/renderer/app.js
# Expected: at least 3 matches (definition + 2 call sites)
```

- [ ] **Step 9: Commit**

```bash
cd "C:/Users/andre/Desktop/LMU-Automatic weather/.worktrees/duckdb-motec"
git add app/src/main/main.js app/src/main/preload.js app/src/renderer/index.html app/src/renderer/app.js
git commit -m "feat(ui): default watch folder to UserData/Telemetry + auto-dismiss first-run banner"
```

---

## Task 2: MoTeC workspace picker + remove channel mapping row (spec items 3, 4)

**Files:**
- Modify: `app/src/renderer/index.html` (reshape workspace row; delete channel-mapping row)
- Modify: `app/src/renderer/app.js` (wire workspace picker; restore on init)
- Modify: `app/src/main/main.js` (extend `motec:open` to pass workspace)

- [ ] **Step 1: Replace the workspace row in index.html**

Find this row in the Settings → MoTeC section (around line 715):

```html
<div class="setting-row">
    <div class="setting-label">
      <span class="lbl">Workspace file</span>
      <span class="hint">Optional <code style="font-family:'JetBrains Mono',monospace;">.w2k</code> workspace to load with each session.</span>
    </div>
    <button class="s-btn">Choose .w2k…</button>
  </div>
```

Replace with:

```html
<div class="setting-row">
    <div class="setting-label">
      <span class="lbl">Workspace file</span>
      <span class="hint">Optional <code style="font-family:'JetBrains Mono',monospace;">.w2k</code> workspace to load with each session.</span>
    </div>
    <div class="s-path-row">
      <input class="s-input mono" id="setMotecWorkspace" value="" readonly />
      <button class="s-btn" id="browseMotecWorkspace">Choose .w2k…</button>
    </div>
  </div>
```

- [ ] **Step 2: Delete the Channel mapping row**

Find and DELETE this entire block (around line 721-727):

```html
<div class="setting-row">
    <div class="setting-label">
      <span class="lbl">Channel mapping</span>
      <span class="hint">Default LMU → MoTeC channel map. Most users won't need to touch this.</span>
    </div>
    <button class="s-btn">View defaults</button>
  </div>
```

- [ ] **Step 3: Wire the workspace picker in `initDrawer`**

In `app/src/renderer/app.js`, find `initDrawer`. Add this block alongside the existing `browseMotecExe` handler:

```js
const browseWs = $('browseMotecWorkspace');
if (browseWs) {
    browseWs.addEventListener('click', async () => {
        const result = await window.go.pickFile({
            title: 'Select MoTeC workspace (.w2k)',
            filters: [{ name: 'MoTeC workspace', extensions: ['w2k'] }],
        });
        if (result.canceled) return;
        $('setMotecWorkspace').value = result.path;
        await window.go.setSetting('motecWorkspace', result.path);
        flashSaved();
    });
}
const savedWorkspace = await window.go.getSetting('motecWorkspace');
const wsInput = $('setMotecWorkspace');
if (savedWorkspace && wsInput) wsInput.value = savedWorkspace;
```

Place the restore lines near the other `getSetting` restore calls in `initDrawer` (next to where `motecExe` is restored). The handler binding goes alongside the other `browse*` bindings.

- [ ] **Step 4: Update `motec:open` IPC to pass workspace**

In `app/src/main/main.js`, find the `motec:open` handler. Replace it with:

```js
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
```

- [ ] **Step 5: Verify**

```bash
cd "C:/Users/andre/Desktop/LMU-Automatic weather/.worktrees/duckdb-motec"
node --check app/src/main/main.js
node --check app/src/renderer/app.js
grep -c "Channel mapping" app/src/renderer/index.html
# Expected: 0
grep -n "browseMotecWorkspace\|setMotecWorkspace" app/src/renderer/index.html
# Expected: 2 matches (input + button)
grep -n "motecWorkspace" app/src/main/main.js
# Expected: 2 matches (the two settings.get calls)
```

- [ ] **Step 6: Commit**

```bash
git add app/src/renderer/index.html app/src/renderer/app.js app/src/main/main.js
git commit -m "feat(ui): wire MoTeC .w2k workspace picker; remove inert Channel mapping row"
```

---

## Task 3: Time scale + sky enum + remove Wind/Humidity (spec items 5, 6, 7, 8)

**Files:**
- Modify: `app/src/renderer/index.html` (slider attrs; sky options; delete Wind + Humidity rows)
- Modify: `app/src/renderer/app.js` (formatTimeScale; default; remove cwWind binding)

- [ ] **Step 1: Update the timeScale slider in index.html**

Find (around line 332):

```html
<input id="timeScale" type="range" min="0" max="60" step="1" value="0" />
```

Change to:

```html
<input id="timeScale" type="range" min="0" max="2" step="1" value="1" />
```

- [ ] **Step 2: Update `formatTimeScale` in app.js**

Find this function (around line 81):

```js
function formatTimeScale(v) {
    return Number(v) === 0 ? 'Normal' : `×${v}`;
}
```

Replace with:

```js
function formatTimeScale(v) {
    const n = Number(v);
    if (n === 0) return 'None';
    if (n === 1) return 'Normal';
    return `×${n}`;
}
```

- [ ] **Step 3: Update default timeScale in GO_SETUPS_DEFAULTS**

Find the constant at the top of `app.js`:

```js
const GO_SETUPS_DEFAULTS = {
    timeScale: 0,           // Normal (real time)
    ...
};
```

Change `timeScale: 0` to `timeScale: 1` and update the comment:

```js
const GO_SETUPS_DEFAULTS = {
    timeScale: 1,           // Normal (real time) — LMU enum: 0=None, 1=Normal, 2=×2
    ...
};
```

- [ ] **Step 4: Replace the cwSky `<option>` block in index.html**

Find (around line 222):

```html
<select id="cwSky" class="select">
  <option>Clear</option><option>Partially cloudy</option><option>Overcast</option><option>Overcast &amp; rain</option>
</select>
```

Replace with:

```html
<select id="cwSky" class="select">
  <option value="0">Clear</option>
  <option value="1">Light clouds</option>
  <option value="2">Partially cloudy</option>
  <option value="3">Mostly cloudy</option>
  <option value="4">Overcast</option>
  <option value="5">Cloudy &amp; drizzle</option>
  <option value="6">Cloudy &amp; light rain</option>
  <option value="7">Overcast &amp; light rain</option>
  <option value="8">Overcast &amp; rain</option>
  <option value="9">Overcast &amp; heavy rain</option>
  <option value="10">Overcast &amp; storm</option>
</select>
```

- [ ] **Step 5: Remove the Wind slider from Custom weather in index.html**

Find this whole block (around lines 230-233):

```html
<label class="field">
        <span class="field-label">Wind <em id="cwWindVal">0 km/h</em></span>
        <input id="cwWind" type="range" min="0" max="50" step="1" value="0" />
      </label>
```

Delete it entirely.

- [ ] **Step 6: Remove the Wind row from `wxDetailsDry` and `wxDetailsRain`**

Find these two `<div class="wx-stat">` lines (one in each block, around lines 191 and 208):

```html
<div class="wx-stat"><span class="wx-stat-k">Wind</span><span class="wx-stat-v">2 km/h</span></div>
```
and
```html
<div class="wx-stat"><span class="wx-stat-k">Wind</span><span class="wx-stat-v">8 km/h</span></div>
```

Delete both.

- [ ] **Step 7: Remove the Humidity rows from `wxDetailsDry` and `wxDetailsRain`**

Find these two lines (around lines 192 and 209):

```html
<div class="wx-stat"><span class="wx-stat-k">Humidity</span><span class="wx-stat-v">55%</span></div>
```
and
```html
<div class="wx-stat"><span class="wx-stat-k">Humidity</span><span class="wx-stat-v">92%</span></div>
```

Delete both.

- [ ] **Step 8: Remove `cwWind` and `cwWindVal` bindings from app.js**

Find and DELETE these lines in `app.js`:

```js
bind('cwWind', 'cwWindVal', (v) => v + ' km/h');
```

(Also search for `bindCustomRange.*cwWind` and delete if present.)

```bash
grep -nE "cwWind|cwWindVal|cwHum|cwWindDir" app/src/renderer/app.js
```

Delete every line that references these IDs (they no longer exist in the HTML; the references would be dead code).

- [ ] **Step 9: Verify**

```bash
cd "C:/Users/andre/Desktop/LMU-Automatic weather/.worktrees/duckdb-motec"
node --check app/src/renderer/app.js
grep -cE "cwWind|cwHum" app/src/renderer/{app.js,index.html}
# Expected: 0 0 0 0 (zero on all four)
grep -c "Humidity" app/src/renderer/index.html
# Expected: 0
grep -c '<option value="' app/src/renderer/index.html | head -1
# Expected: at least 11 (the new sky options)
grep -n 'id="timeScale"' app/src/renderer/index.html
# Expected: one match with max="2" value="1"
```

- [ ] **Step 10: Commit**

```bash
git add app/src/renderer/index.html app/src/renderer/app.js
git commit -m "fix(ui): time scale enum (None/Normal/×2), full LMU sky enum, remove unsupported Wind+Humidity"
```

---

## Task 4: Watch-folder toggle clarity — explicit on/off switch (spec item 9)

**Files:**
- Modify: `app/src/renderer/index.html` (insert `.s-switch` into `.watcher-card`)
- Modify: `app/src/renderer/styles.css` (extend `.watcher-card` grid)
- Modify: `app/src/renderer/app.js` (sync switch class with watcher state)

- [ ] **Step 1: Insert the switch element in index.html**

Find the watcher card block (around line 437):

```html
<div class="watcher-card" id="watcherToggle" title="Toggle automatic folder watch" role="button" tabindex="0">
      <div class="wc-ico">…</div>
      <div class="wc-meta">…</div>
      <button type="button" class="wc-configure" id="wcConfigure" title="Open watcher settings">Configure</button>
    </div>
```

Add a new `<div class="s-switch wc-switch" ...>` element BEFORE the existing `<button id="wcConfigure">`:

```html
<div class="s-switch wc-switch" id="watcherSwitch" role="switch" aria-checked="false" tabindex="-1"></div>
      <button type="button" class="wc-configure" id="wcConfigure" title="Open watcher settings">Configure</button>
```

- [ ] **Step 2: Update the `.watcher-card` grid in styles.css**

Find this rule:

```css
.watcher-card {
  display: grid;
  grid-template-columns: 28px 1fr auto;
  gap: 10px; align-items: center;
  ...
}
```

Change `grid-template-columns` to `28px 1fr auto auto`:

```css
.watcher-card {
  display: grid;
  grid-template-columns: 28px 1fr auto auto;
  gap: 10px; align-items: center;
  ...
}
```

- [ ] **Step 3: Sync the switch class in `updateWatcherToggle` in app.js**

Find `updateWatcherToggle` (around line 1289):

```js
function updateWatcherToggle(on) {
    const btn = $('watcherToggle');
    if (!btn) return;
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-pressed', String(on));
    const txt = $('watcherStateText');
    if (txt) txt.textContent = on ? 'WATCHING' : 'OFF';
}
```

Replace with:

```js
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
```

- [ ] **Step 4: Verify**

```bash
cd "C:/Users/andre/Desktop/LMU-Automatic weather/.worktrees/duckdb-motec"
node --check app/src/renderer/app.js
grep -n 'id="watcherSwitch"' app/src/renderer/index.html
# Expected: one match
grep -n "watcherSwitch" app/src/renderer/app.js
# Expected: one or more matches (the sync code)
grep -n "grid-template-columns: 28px 1fr auto auto" app/src/renderer/styles.css
# Expected: one match
```

- [ ] **Step 5: Commit**

```bash
git add app/src/renderer/index.html app/src/renderer/styles.css app/src/renderer/app.js
git commit -m "fix(ui): explicit on/off switch on watcher card for clearer affordance"
```

---

## Task 5: LMU game-state detection (spec item 10)

**Files:**
- Modify: `app/src/main/lmu-launcher.js` (add `getLmuNavState` helper + export)
- Modify: `app/src/main/main.js` (add `lmu:getNavState` IPC)
- Modify: `app/src/main/preload.js` (expose `getLmuNavState`)
- Modify: `app/src/renderer/app.js` (`pollStatus` uses new IPC; richer label rendering)

- [ ] **Step 1: Add `getLmuNavState` helper in lmu-launcher.js**

In `app/src/main/lmu-launcher.js`, near the existing `isLmuApiAlive` function (around line 63), add:

```js
async function getLmuNavState() {
    try {
        const r = await fetch(`${API}/navigation/state`);
        if (!r.ok) return { alive: false };
        const j = await r.json();
        return { alive: true, navigationState: j?.state?.navigationState || 'UNKNOWN' };
    } catch {
        return { alive: false };
    }
}
```

- [ ] **Step 2: Export `getLmuNavState` from lmu-launcher.js**

Find the `module.exports` at the bottom of `lmu-launcher.js`:

```js
module.exports = {
    isLmuApiAlive,
    ...
};
```

Add `getLmuNavState` to the exports.

- [ ] **Step 3: Add `lmu:getNavState` IPC handler in main.js**

Find the existing `lmu:isAlive` handler (around line 98) in `app/src/main/main.js`:

```js
ipcMain.handle('lmu:isAlive', async () => {
    return launcher.isLmuApiAlive();
});
```

Add directly below:

```js
ipcMain.handle('lmu:getNavState', async () => {
    return launcher.getLmuNavState();
});
```

- [ ] **Step 4: Expose `getLmuNavState` in preload.js**

In `app/src/main/preload.js`, inside the `contextBridge.exposeInMainWorld('go', { ... })` object, add:

```js
getLmuNavState: () => ipcRenderer.invoke('lmu:getNavState'),
```

- [ ] **Step 5: Update `setStatus` and `pollStatus` in app.js**

Find `setStatus` (around line 58):

```js
function setStatus(alive) {
    const pill = $('lmuStatusPill');
    if (!pill) return;
    const text = $('lmuStatusText');
    if (text) text.textContent = alive ? 'LMU running' : 'LMU offline';
    pill.classList.toggle('offline', !alive);
}
```

Replace with:

```js
function setStatus(state) {
    const pill = $('lmuStatusPill');
    if (!pill) return;
    const text = $('lmuStatusText');
    const alive = !!state?.alive;
    pill.classList.toggle('offline', !alive);
    if (!text) return;
    if (!alive) { text.textContent = 'LMU offline'; return; }
    const nav = state.navigationState || 'UNKNOWN';
    const label = navStateLabel(nav);
    text.textContent = `LMU running · ${label}`;
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
    return nav.replace(/^NAV_/, '').toLowerCase().replace(/_/g, ' ');
}
```

Find `pollStatus` (around line 591):

```js
async function pollStatus() {
    try { setStatus(await window.go.isLmuAlive()); } catch { setStatus(false); }
    try { setGoFastStatus(await window.go.isGoFastAlive()); } catch { setGoFastStatus(false); }
}
```

Replace with:

```js
async function pollStatus() {
    try { setStatus(await window.go.getLmuNavState()); } catch { setStatus({ alive: false }); }
}
```

(`setGoFastStatus` was removed in Task 3 of the v2 redesign — no need to call it.)

- [ ] **Step 6: Verify**

```bash
cd "C:/Users/andre/Desktop/LMU-Automatic weather/.worktrees/duckdb-motec"
node --check app/src/main/main.js
node --check app/src/main/preload.js
node --check app/src/main/lmu-launcher.js
node --check app/src/renderer/app.js
grep -n "getLmuNavState" app/src/main/lmu-launcher.js app/src/main/main.js app/src/main/preload.js app/src/renderer/app.js
# Expected: at least 4 matches total (definition, export, IPC, preload, renderer)
grep -n "navStateLabel" app/src/renderer/app.js
# Expected: 2 matches (definition + use)
```

- [ ] **Step 7: Commit**

```bash
git add app/src/main/lmu-launcher.js app/src/main/main.js app/src/main/preload.js app/src/renderer/app.js
git commit -m "feat(ipc): poll LMU navigation state so status pill reflects in-session vs main-menu"
```

---

## Task 6: Session persistence across restart (spec item 11)

**Files:**
- Modify: `app/src/renderer/app.js` (persist on add/delete; restore on init)

- [ ] **Step 1: Restore `tlmState.sessions` in `initTelemetry`**

Find `initTelemetry` (around line 1093). Near the top of the function, BEFORE the first `renderSessionsGrid()` call, add:

```js
const stored = await window.go.getSetting('convertedSessions');
if (Array.isArray(stored)) tlmState.sessions = stored;
```

- [ ] **Step 2: Add a persist helper near `addSession`**

Find `addSession` (around line 1355). Add this helper directly above it:

```js
async function persistSessions() {
    // Cap at 200 to bound settings file growth. New sessions unshift to
    // position 0, so slice(0, 200) keeps the newest 200.
    await window.go.setSetting('convertedSessions', tlmState.sessions.slice(0, 200));
}
```

- [ ] **Step 3: Call `persistSessions()` from `addSession`**

Find `addSession` and add `await persistSessions()` after the `tlmState.sessions` mutation but before the `renderSessionsGrid()` call:

```js
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
        convertedAt: now.getTime(),
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
```

(Note: `addSession` was synchronous; `persistSessions` returns a promise but we don't await it. Settings store IPC is fast and an unhandled rejection would only affect persistence, not UI state.)

- [ ] **Step 4: Call `persistSessions()` from delete action**

Find `handleSessionAction` (around line 1450). The `'delete'` branch ends with:

```js
if (result.ok) {
    tlmState.sessions = tlmState.sessions.filter((s) => s.ldPath !== session.ldPath);
    renderSessionsGrid();
    updateTlmSummary();
}
```

Change to:

```js
if (result.ok) {
    tlmState.sessions = tlmState.sessions.filter((s) => s.ldPath !== session.ldPath);
    persistSessions();
    renderSessionsGrid();
    updateTlmSummary();
}
```

- [ ] **Step 5: Verify**

```bash
cd "C:/Users/andre/Desktop/LMU-Automatic weather/.worktrees/duckdb-motec"
node --check app/src/renderer/app.js
grep -nE "persistSessions|convertedSessions" app/src/renderer/app.js
# Expected: at least 4 matches (definition, 2 call sites, restore in initTelemetry)
```

- [ ] **Step 6: Commit**

```bash
git add app/src/renderer/app.js
git commit -m "feat(ui): persist converted sessions across app restart (cap 200 newest)"
```

---

## Task 7: Version bump + final smoke (spec item 12)

**Files:**
- Modify: `app/package.json` (version)
- Modify: `app/src/renderer/index.html` (visible version strings)

- [ ] **Step 1: Bump package.json version**

In `app/package.json`, change:

```json
"version": "3.0.0",
```

to:

```json
"version": "3.0.1",
```

- [ ] **Step 2: Bump visible version strings in index.html**

Search for `v3.0.0` in `app/src/renderer/index.html` (should be 2 occurrences: brand tag in topbar, footer). Change both to `v3.0.1`:

```bash
grep -n "v3.0.0" app/src/renderer/index.html
# Expected: 2 lines
```

Use Edit with `replace_all: true` to bump all `v3.0.0` → `v3.0.1`.

- [ ] **Step 3: Verify no stale 3.0.0 references**

```bash
grep -rn "3\\.0\\.0" app/src app/package.json 2>/dev/null
# Expected: 0 matches
```

- [ ] **Step 4: Run the build**

```bash
cd "C:/Users/andre/Desktop/LMU-Automatic weather/.worktrees/duckdb-motec/app"
npm run build 2>&1 | tail -5
# Expected: "Done. GO-LMU-Launcher-3.0.1-win-x64.zip (~135 MB)"
```

- [ ] **Step 5: Mirror build to main repo dist folder**

```bash
rm -rf "C:/Users/andre/Desktop/LMU-Automatic weather/app/dist"
cp -r "C:/Users/andre/Desktop/LMU-Automatic weather/.worktrees/duckdb-motec/app/dist" "C:/Users/andre/Desktop/LMU-Automatic weather/app/dist"
ls "C:/Users/andre/Desktop/LMU-Automatic weather/app/dist/"
# Expected: GO-LMU-Launcher-3.0.1-win-x64.zip + unpacked folder
```

- [ ] **Step 6: Commit version bump**

```bash
cd "C:/Users/andre/Desktop/LMU-Automatic weather/.worktrees/duckdb-motec"
git add app/package.json app/src/renderer/index.html
git commit -m "chore: bump version to 3.0.1"
```

---

## Manual smoke test (run after Task 7)

Open the unpacked exe at `C:\Users\andre\Desktop\LMU-Automatic weather\app\dist\GO LMU Launcher-win32-x64\GO LMU Launcher.exe`.

1. Open Settings → Auto-converter → click **Detect** → watch-path field fills with `…\Documents\Le Mans Ultimate\UserData\Telemetry`.
2. Configure a watch folder, restart app → first-run banner is gone.
3. Pick a `.w2k` workspace in Settings → Open in MoTeC on a session → MoTeC opens with that workspace loaded.
4. Settings drawer's MoTeC section has no Channel mapping row.
5. Time scale slider on Launcher page shows `None / Normal / ×2`.
6. Custom weather has no Wind slider; Dry and Wet detail panels show no Wind or Humidity rows.
7. Custom weather sky dropdown has all 11 options.
8. Watcher card has a clearly-visible on/off switch on the right; clicking it (or anywhere on the card except Configure) toggles the watcher.
9. Launch a session in LMU; topbar pill text changes from "main menu" to a session-state label within ~5s. Exit to menu; returns to "main menu".
10. Drop a `.duckdb`, wait for conversion, close the app, reopen → the session row is still in the grid.
11. Footer / brand tag shows `v3.0.1`.

Any failure → file an item in the next bucket.
