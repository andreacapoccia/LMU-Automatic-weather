# Bucket A — UI / Settings Polish (v3.0.1)

## Goal

Address every UI complaint from the v3.0.0 driver test pass in a single follow-up release. Eleven discrete fixes touching renderer (markup, CSS, JS), settings persistence, MoTeC handoff, and LMU game-state polling. No converter changes.

## Out of scope

- Converter accuracy bugs (in/outlap leakage, lap timing, swapped G-force channels) — bucket D, separate spec.
- Game-state launch behavior (starting grip ignored, wet preset wrong, weather slot count, `loadGame HTTP 400`) — bucket C, separate spec.
- Realroad Wet and AI Aggression session controls — driver explicitly called them irrelevant; deferred.
- Multi-session presets, weather-slot editor, setup wizard — bucket E, future feature work.
- Track data additions (Le Mans Bugatti, Monza Grande Anello) — bucket B, trivial data, separate small commit.

## Items

### 1. Watch-folder default → `Telemetry`, not `Replays`

LMU writes telemetry `.duckdb` files into `<Documents>\Le Mans Ultimate\UserData\Telemetry`. Our install-scanner currently defaults the watcher folder to `…\UserData\Replays`.

- **File:** `app/src/main/install-scanner.js`
- **Change:** Replace any `'Replays'` default path segment with `'Telemetry'`.
- **Also:** the "Detect" button in Settings → Auto-converter must call the same updated default.

### 2. First-run banner doesn't dismiss after watch folder is configured

Current behavior: `firstRunCard` visibility is computed once in `initTelemetry()` from `(!watchDir && !dismissed)`. If the user later sets `watchDir` via the Settings drawer, the card stays visible until next app launch.

- **File:** `app/src/renderer/app.js`
- **Change:** Extract a `refreshFirstRunCard()` helper that re-reads `watchDir` and `firstRunDismissed` and updates `firstRunCard.style.display`. Call it from:
  - `initTelemetry()` initial mount (current site)
  - The drawer's Browse-watch-path success callback (after `setSetting('watchDir', …)`)
  - The watcher card's Configure click after dialog success (if it pickFolder-saves)

### 3. MoTeC `.w2k` workspace picker — wire fully

The "Choose .w2k…" button in Settings → MoTeC is currently a bare `<button class="s-btn">` with no ID, no handler. The driver wants it to actually pick a workspace and have MoTeC open that workspace alongside the `.ld`.

- **HTML:** Add `id="browseMotecWorkspace"` to the button. Add a sibling `<span class="s-path">` (or `<input class="s-input" readonly id="setMotecWorkspace">`) showing the picked path.
- **app.js:** In `initDrawer`, bind the button to:
  ```js
  const result = await window.go.pickFile({ filters: [{ name: 'MoTeC workspace', extensions: ['w2k'] }] });
  if (result.canceled) return;
  await window.go.setSetting('motecWorkspace', result.path);
  $('setMotecWorkspace').value = result.path;
  flashSaved();
  ```
- **app.js init:** Restore from `getSetting('motecWorkspace')` on drawer init.
- **main.js `motec:open`:** Update behavior:
  - If `motecExe` AND `motecWorkspace` both set → spawn `cmd /c start "" "<motecExe>" "<workspace>" "<ldPath>"` (verify MoTeC's argv order — workspace before ld is the convention; if wrong, swap during driver test)
  - If only `motecExe` set → existing fallback
  - Else → `shell.openPath(ldPath)` (existing default)

### 4. Channel mapping row — remove

Inert UI with no real behavior. Remove the entire `.setting-row` containing "Channel mapping" from the Settings → MoTeC section in `index.html`. No CSS or JS changes; the row's elements have no IDs in the current code.

### 5. Time scale wording

Slider currently outputs `Normal` for value 0, `×N` for N>0. LMU's actual options are `None / Normal / ×2`. The slider has only 3 useful positions — switch from a continuous range to a 3-step segmented control or keep the slider with 3 stops (0/1/2). Either way the labels become:

- 0 → `None`
- 1 → `Normal`
- 2 → `×2`

- **HTML:** `#timeScale` slider stays `min=0 max=2 step=1`.
- **app.js:** Update `bind('timeScale', 'timeScaleVal', …)` formatter to return `'None' / 'Normal' / '×2'`.
- **Launch payload mapping:** Verify `state.overrides.timeScale` value is sent through correctly (LMU expects 0/1/2). Adjust if a different mapping is needed.

### 6. Remove Wind from weather UI

LMU does not simulate wind; showing it is misleading. Remove all wind-related UI:

- **HTML:** Delete the `cwWind` field from Custom weather.
- **HTML:** Delete the `Wind` row from `#wxDetailsDry` and `#wxDetailsRain`.
- **app.js:** Remove `bind('cwWind', 'cwWindVal', …)` and `bindCustomRange('cwWind', 'wind', …)` if present.
- **State:** Leave `state.overrides.customWeather.wind = 0` in defaults; the launch payload still sends 0; LMU ignores. Don't refactor the payload schema — out of scope.

### 7. Remove Humidity from weather UI

Same logic as wind — LMU does not simulate humidity.

- **HTML:** Delete the `Humidity` rows from `#wxDetailsDry` and `#wxDetailsRain`.
- No JS changes (no Custom slider exists for humidity in current UI).

### 8. Sky enum — full LMU set

Current `#cwSky` has 4 options. LMU supports 11. Replace:

- clear
- light clouds
- partially cloudy
- mostly cloudy
- overcast
- cloudy & drizzle
- cloudy & light rain
- overcast & light rain
- overcast & rain
- overcast & heavy rain
- overcast & storm

- **HTML:** Replace the `<option>`s in `#cwSky` with the 11 above (display capitalized: "Clear", "Light clouds", etc.).
- **app.js:** Update the sky-name → integer mapper used when composing the launch payload. Find it via `grep -nE "cwSky|sky.*payload|customWeather\\.sky" app.js`. Map name → LMU enum index (verify exact integer values during driver test; if wrong, fix mapping with no schema change).

### 9. Watch-folder toggle clarity

Driver was confused that the watcher card is the toggle. Add an explicit on/off switch on the right side of the card, before the existing Configure button, using the same `.s-switch` style as the drawer.

- **HTML:** Inside `<div class="watcher-card" id="watcherToggle">`, before `<button id="wcConfigure">`, insert:
  ```html
  <div class="s-switch wc-switch" role="switch" aria-checked="false" tabindex="-1"></div>
  ```
- **CSS:** `styles.css` — adjust `.watcher-card`'s `grid-template-columns` from `28px 1fr auto` to `28px 1fr auto auto` so the switch + Configure both fit. Sync the switch's `.on` class from `tlmState.watcherRunning`.
- **app.js:** In the existing `watcherToggle` click handler, after the `tlmState.watcherRunning` toggles, also toggle the new switch's `.on` class and `aria-checked`. The new switch has no separate event listener — it's purely visual. Clicks on it bubble up to the card and the card's existing handler fires once.

### 10. LMU game-state detection

Currently the topbar pill always shows "running · main menu" because `isLmuApiAlive` only returns boolean. We have richer info available at `/navigation/state`.

- **lmu-launcher.js:** Add an exported helper:
  ```js
  async function getLmuNavState() {
      try {
          const r = await fetch(`${API}/navigation/state`);
          if (!r.ok) return { alive: false };
          const j = await r.json();
          return { alive: true, navigationState: j?.state?.navigationState || 'UNKNOWN' };
      } catch { return { alive: false }; }
  }
  ```
- **main.js:** Add IPC handler `lmu:getNavState` that returns the above.
- **preload.js:** Expose `getLmuNavState: () => ipcRenderer.invoke('lmu:getNavState')`.
- **app.js `pollStatus()`:** Replace the `isLmuAlive` call with `getLmuNavState`. Update `setStatus(state)` to take `{alive, navigationState}` and render labels:
  - `!alive` → `LMU offline`
  - `NAV_MAIN_MENU` → `LMU running · main menu`
  - `NAV_GARAGE` → `LMU running · garage`
  - `NAV_DRIVING` (or whatever in-session value LMU returns) → `LMU running · in session`
  - Other → `LMU running · ${state}` lowercased without `NAV_` prefix

State labels are guesses; verify exact values during driver test by logging the response and adjusting the mapping. Polling stays at the existing 5s interval.

### 11. Session persistence across app restart

Currently `tlmState.sessions` is in-memory only.

- **app.js `addSession()`:** After mutating `tlmState.sessions`, call `await window.go.setSetting('convertedSessions', tlmState.sessions.slice(0, 200))`. The slice keeps the most recent 200 to bound settings file growth.
- **app.js `handleSessionAction('delete')`:** After splicing the session out, persist the same way.
- **app.js `initTelemetry()`:** Before the first `renderSessionsGrid()`, restore:
  ```js
  const stored = await window.go.getSetting('convertedSessions');
  if (Array.isArray(stored)) tlmState.sessions = stored;
  ```
- **Persistence cap:** 200 entries. Older entries silently dropped on save. Sessions that no longer exist on disk (file deleted manually) still show in the grid; clicking Open/Reveal on those will surface the error via existing IPC error paths. Pruning stale entries on boot is out of scope.

## Files touched

| File | Items |
|---|---|
| `app/src/main/install-scanner.js` | 1 |
| `app/src/main/lmu-launcher.js` | 10 |
| `app/src/main/main.js` | 3 (motec:open update), 10 (new IPC) |
| `app/src/main/preload.js` | 10 (expose getLmuNavState) |
| `app/src/renderer/index.html` | 3, 4, 6, 7, 8, 9 |
| `app/src/renderer/styles.css` | 9 |
| `app/src/renderer/app.js` | 2, 3 (binding), 5, 6, 8, 9 (binding), 10 (display), 11 |
| `app/package.json` | version bump 3.0.0 → 3.0.1 |

## Verification

Manual smoke test on the packaged build:

1. Fresh install → Detect button finds the `Telemetry` folder, not `Replays`.
2. Configure a watch folder via Settings → close + reopen the app → first-run banner is gone.
3. Pick a `.w2k` workspace in Settings → click Open in MoTeC on a session → MoTeC opens with that workspace loaded.
4. Settings drawer's MoTeC section has no Channel mapping row.
5. Time scale slider shows `None / Normal / ×2`.
6. Custom weather has no Wind slider; Dry and Wet detail panels show no Wind or Humidity rows.
7. Custom weather sky dropdown has all 11 options; selecting each launches a session with the correct LMU sky.
8. Watcher card has a clearly-visible on/off switch on the right; clicking it (or anywhere on the card except Configure) toggles the watcher.
9. Launch a session in LMU; topbar pill text changes from "main menu" to a session-state label within ~5s. Exit to menu; returns to "main menu".
10. Drop a `.duckdb`, wait for conversion, close the app, reopen → the session row is still in the grid.

No automated tests — renderer is vanilla JS with no test harness.

## Risks

- The exact LMU navigationState enum values for non-menu states are unknown to us. The mapping in item 10 is a best guess; some labels may need correction after the first driver test of v3.0.1.
- The `.w2k` argv order for MoTeC i2 is also a guess (workspace before ld). Verify during driver test; swap if needed.
- The sky-name → LMU integer mapping in item 8 needs the existing parser inspected; if a value index changed because we added options before existing ones, the launch payload could pick the wrong sky. Mitigate by using a NAME → integer dict instead of relying on `<option>` index.
