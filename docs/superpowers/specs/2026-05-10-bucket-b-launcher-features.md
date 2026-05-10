# Bucket B/C/D — Settings cleanup + Custom weather + Race weekend

**Date:** 2026-05-10
**Branch:** `feature/duckdb-motec-converter`
**Target version:** v3.0.4
**Author:** Andre + Claude
**Source:** Driver feedback batch 2 (2026-05-10 morning)

## Summary

Three bundles of work in one spec, ordered by dependency:

1. **Bucket B** — Six small bug fixes / data corrections in Settings, the track-layout dictionary, the weather preset values, and the starting-grip dropdown. All have known root causes from this morning's reconnaissance; no investigation needed.
2. **Investigation task** — One manual test the user runs in LMU to determine whether the SessionPreset.Weather slice values can drive actual in-game weather, or whether the binary blob is authoritative. The result decides Bucket C's blob handling.
3. **Bucket C** — Custom weather card with full 5-slot control per session and save/load presets. Core data-model and UI work happens regardless of the investigation; only the "blob vs slices" backend behavior branches on the result.
4. **Bucket D** — Launcher restructure to support full race weekends (Practice + Qualifying + Race), each with its own length, start time, weather, and rules. Race adds Rolling/Fast Rolling start type. Solo-only (no AI grid).

Out of scope: AI-grid configuration, multiplayer hosting, championship mode, design-agent handoff (we do the HTML in-house).

## Bucket B — Settings, layouts, presets

### B1. Delete `Check for updates` row from About & Logs

`app/src/renderer/index.html` ~lines 813-818. Just remove the `<div class="setting-row">…</div>` block. No corresponding renderer logic to remove.

### B2. Delete `License` row from About & Logs

`app/src/renderer/index.html` line 795. Remove the `<div class="about-row">License…</div>`.

### B3. Wire `Open logs folder` button

Add IPC `app:openLogsFolder` in `app/src/main/main.js`:
```js
ipcMain.handle('app:openLogsFolder', async () => {
  const dir = path.join(app.getPath('userData'), 'logs');
  fs.mkdirSync(dir, { recursive: true });
  shell.openPath(dir);
  return { ok: true };
});
```
Expose in preload: `openLogsFolder: () => ipcRenderer.invoke('app:openLogsFolder')`.

In renderer, give the button `id="openLogsFolder"` and bind a click handler that calls `window.go.openLogsFolder()`. Note: we don't currently write log files to disk; this just opens an empty userData/logs folder. Future iteration can route the existing `convert:log` IPC stream to disk-rotated files.

### B4. Wire `Reset all settings` button

Add IPC `settings:resetAll` in `app/src/main/main.js`:
```js
ipcMain.handle('settings:resetAll', async () => {
  settings.resetAll();
  return { ok: true };
});
```
The `settings` module needs a `resetAll()` method that clears all keys (or deletes the underlying file). In renderer, give the button `id="resetSettings"` and bind a click handler that:
1. `confirm('Reset all settings? This will not delete telemetry files.')`
2. On OK: call `window.go.resetAllSettings()`
3. After success: `window.location.reload()` to re-init the renderer.

### B5. Read Version + build date from `package.json`

In `main.js`, add:
```js
ipcMain.handle('app:getVersion', () => ({
  version: app.getVersion(),
  buildDate: fs.statSync(app.getAppPath() + '/package.json').mtime.toISOString().slice(0, 10),
}));
```
Expose in preload as `getVersion`. In renderer: on init, fetch and populate the Version + Updated rows. Remove the hardcoded "2.0.4 (build 318)" and "2025-04-29".

### B6. Track layout naming overrides

`app/src/main/install-scanner.js` `LAYOUT_NAME_OVERRIDES` map:
- `mulsanne: 'Bugatti Circuit'` → `'Mulsanne'`
- `grande: 'Grande Anello'` → `'Curva Grande'`
- `'1a': 'Long (1A)'` → `'1A'`
- `'1av2': 'Long V2 (1A)'` → `'1AV2'`
- `'1av2short': 'Short V2'` → `'1AV2 Short'`
- `'3a': '3A Layout'` → `'3A'`

### B7. Saturated-grip dropdown — value attributes

`app/src/renderer/index.html` ~line 282-284. Current options have no `value=` attributes, so `bindSelect` reads the literal text ("Saturated"), which LMU doesn't recognize as a valid `Road.RealRoad` value and silently falls back to green. Same root cause as the Bucket A `cwSky` bug.

Fix:
```html
<select id="startingGrip" class="select">
  <option value="preset:SATURATED.RRBIN">Saturated</option>
  <option value="preset:HEAVY.RRBIN">Heavy</option>
  <option value="preset:MEDIUM.RRBIN">Medium</option>
  <option value="preset:LIGHT.RRBIN">Light</option>
  <option value="preset:GREEN.RRBIN">Green</option>
</select>
```

The exact file casing (`SATURATED.RRBIN` vs `Saturated.rrbin`) needs verification: the `gosetups-template.json` uses different casings for different sessions. During implementation, list the contents of `<lmu-install>/UserData/player/RealRoadFiles/` (or wherever LMU keeps them) to confirm the canonical filenames. Pick the casing LMU actually accepts.

### B8. Wet preset values — match user spec

`app/src/renderer/app.js` `selectPreset('overcast_rain')` branch and the static "GO Setups Rain" defaults.

Required values when user selects the Wet card:
- Sky: `8` (Overcast & rain)
- Rain chance: `100`
- Temperature: `20°C`
- Practice starting grip: `preset:SATURATED.RRBIN`
- RealRoad wet: `default` (currently `waterDepth: -0.01` — leave as-is)

These must propagate into all 5 slots of all 3 sessions in `SessionPreset.Weather[session].Weather[]` (currently only `weatherPreset === 'custom'` writes the slices; extending the same logic to the `'overcast_rain'` branch fixes the "forecast shows sun" bug at minimum). Whether the binary blob alone can be replaced is the investigation in §2.

The summary text in `updateSummary()` needs adjustment too: `'GO Setups Rain · 75% · 20°C'` → `'Wet · Overcast & rain · 100% · 20°C'`.

## Investigation task (manual; user-run)

**Goal.** Determine whether the SessionPreset.Weather slice values can drive actual in-game weather, or whether the binary `save.Weather` blob is authoritative.

**Why it matters.** If slices drive weather, Custom weather is fully achievable (we just edit JSON, no blob manipulation). If the blob drives weather, we're limited to the closest of our 3 captured static blobs.

**Test procedure.**

1. After Bucket B is implemented (so the slice override for Wet works), launch the app v3.0.4-rc1 build.
2. Select **Wet** preset. Launch a session.
3. Wait until the session loads (you're in the garage).
4. Check the in-game weather panel: is it actually raining?
5. Drive out and confirm the track surface state matches expectation.
6. Report back: `actual_weather: rain | sun | mixed`.

**Decision branch.**
- If actual weather is **rain**: blob *or* slices is driving it correctly. Run a second test using a one-off branch in the converter (added by the implementation plan): set blob to `dry` but slices to `rain`. Launch and check.
  - Still rains → slices win → Bucket C uses **slice path** (C4 only).
  - Sun → blob wins → Bucket C uses **blob fallback** (C5).
- If actual weather is **sun**: try `Player['Race Conditions'].Weather = 0` (real-time mode) instead of `4` (scripted). Launch with Wet preset again. If rains → use mode 0 + slice path. If still sun → escalate; current understanding is wrong, investigation continues outside this spec's scope.

The spec assumes one of these outcomes; both implementations are described in Bucket C below. We pick the one that matches reality post-investigation.

## Bucket C — Custom weather card

### C1. Data model

```ts
state.overrides.customWeather = {
  practice:   [Slot, Slot, Slot, Slot, Slot],
  qualifying: [Slot, Slot, Slot, Slot, Slot],
  race:       [Slot, Slot, Slot, Slot, Slot],
};
type Slot = { sky: 0..10, rainChance: 0..100, temperature: number };
```

Defaults on first init: every slot = `{ sky: 0, rainChance: 0, temperature: 22 }`.

### C2. UI structure (HTML in-house)

Replace the existing single Custom weather panel (sliders for sky/rain/temp) with a sub-tabbed panel:

```
┌─ Custom weather ─────────────────────────────────────────────┐
│ [Practice] [Qualifying] [Race]      [Save preset…] [Load…]   │
│                                                              │
│ ┌──Slot 1──┬──Slot 2──┬──Slot 3──┬──Slot 4──┬──Slot 5──┐   │
│ │ Sky:▾    │ Sky:▾    │ Sky:▾    │ Sky:▾    │ Sky:▾    │   │
│ │ Rain: 0% │ Rain: 0% │ Rain: 0% │ Rain: 0% │ Rain: 0% │   │
│ │ Temp:22° │ Temp:22° │ Temp:22° │ Temp:22° │ Temp:22° │   │
│ └──────────┴──────────┴──────────┴──────────┴──────────┘   │
└──────────────────────────────────────────────────────────────┘
```

The session sub-tabs (Practice/Qualifying/Race) switch which 5-column grid is shown. Each cell is a small card with a sky `<select>`, a rain-chance number input, and a temperature number input. Save/Load buttons in the header act on the currently-displayed session.

Slot column widths equal. Reuse the existing `.field` and `.s-input` styling. Sky `<select>` reuses the 11-option list from Bucket A's cwSky fix (with `value="0..10"` attributes).

The card visibility toggles with `weatherPreset === 'custom'` exactly as today.

### C3. Save/load presets

New settings store key:
```ts
customWeatherPresets: Array<{
  id: string,            // crypto.randomUUID()
  name: string,          // user-supplied
  createdAt: number,     // epoch ms
  config: {              // full per-session 5-slot config (same shape as state.overrides.customWeather)
    practice:   Slot[5],
    qualifying: Slot[5],
    race:       Slot[5],
  },
}>
```

Cap at 50 presets (FIFO trim on save).

**Save flow.** Click "Save preset…" → `prompt('Name this preset:')` → on OK, push to settings, refresh dropdown.

**Load flow.** Click "Load…" → modal/dropdown listing presets by name + date → on select, replace `state.overrides.customWeather` with the preset's config and re-render the slot grid.

**Delete flow.** Each preset row has an X button. Confirm before delete.

For v1, no rename, no export/import. Names are unique-by-coincidence (we don't dedup).

### C4. Backend behavior — slice path

In `lmu-launcher.composeSession`, when `weatherPreset === 'custom'`:
- For each session in [Practice, Qualifying, Race]:
  - For i in 0..4:
    - `block.Weather[i].Sky = customWeather[session][i].sky`
    - `block.Weather[i].RainChance = customWeather[session][i].rainChance`
    - `block.Weather[i].Temperature = customWeather[session][i].temperature`
    - Leave Humidity, WindSpeed, WindDirection at template defaults.

(This already happens partially today for the legacy single-set custom; we extend to per-session 5-slot.)

### C5. Backend behavior — blob path (conditional on investigation)

**If slices drive weather (preferred outcome):** No blob handling needed. Set `Player['Race Conditions'].Weather` to whatever mode the investigation determined uses slices (likely 0 or 1). Skip the binary blob entirely — write `save.Weather = []` or omit. Custom weather works fully.

**If blob drives weather (fallback):** Pick the closest static blob per session by averaging the 5 slots' RainChance:
```js
function pickBlobForSession(slots) {
  const avgRain = slots.reduce((a, s) => a + s.rainChance, 0) / 5;
  if (avgRain >= 75) return 'storm';
  if (avgRain >= 30) return 'overcast_rain';
  return 'dry';
}
const weatherBlob = [
  WEATHER_BLOBS[pickBlobForSession(customWeather.practice)][0],   // index 0 = practice
  WEATHER_BLOBS[pickBlobForSession(customWeather.qualifying)][1], // index 1 = qual
  WEATHER_BLOBS[pickBlobForSession(customWeather.race)][2],       // index 2 = race
];
```
Slice values still get stamped (per C4) so the forecast UI matches. Document in the UI that actual weather is approximate.

## Bucket D — Race weekend

### D1. Data model

```ts
state.overrides.sessions = {
  practice:   { enabled: true,  length: 360, startTime: 720,  privateSession: true,  startingGrip, realRoadTimeScale, weatherPreset, customWeatherIndex },
  qualifying: { enabled: false, length: 20,  startTime: 900,  privateSession: true,  startingGrip, realRoadTimeScale, weatherPreset, customWeatherIndex },
  race:       { enabled: false, length: 240, startTime: 780,  startType: 'rolling', startingGrip, realRoadTimeScale, weatherPreset },
};
```

`length` in minutes. `startTime` in minutes-from-midnight. `startType` ∈ `'rolling' | 'fast_rolling'`.

Limits: practice 1..360 (6h), qualifying 1..60, race 1..1440 (24h).

`weatherPreset` per session: `'dry' | 'overcast_rain' | 'custom'`. Custom uses the per-session slot array from C1.

### D2. UI restructure

The existing "Practice settings" card (Card 04) becomes "Sessions". Inside, three collapsible sub-cards in vertical stack: Practice / Qualifying / Race. Each has:
- Enable toggle (header right)
- Length slider with hr+min split
- Start time slider (24h clock)
- Privacy toggle (Practice + Qual only)
- Starting grip select
- RealRoad scale slider
- (Race only) Start type select with two options: Rolling, Fast Rolling

Disabled session cards collapse to header-only.

The Card 03 (Weather Preset) selection becomes per-session: a small "Apply to:" segmented control above the preset cards lets user choose Practice/Qualifying/Race/All. "All" applies the same preset to all enabled sessions.

For Custom: the C2 sub-tabs duplicate this — clicking "Practice" tab in Custom = editing practice-session weather slots.

### D3. Backend behavior

`lmu-launcher.composeSession` currently writes only Practice fields. Extend to write Qualifying + Race per template. Reference fields (verify during implementation):
- `Player['Race Conditions'].Practice1StartingTime` ✓ (existing)
- `Player['Race Conditions'].Qualify1StartingTime` (new)
- `Player['Race Conditions'].RaceStartingTime` (new)
- `Player['Race Conditions'].RealRoadTimeScalePractice` ✓
- `Player['Race Conditions'].RealRoadTimeScaleQualifying` (new)
- `Player['Race Conditions'].RealRoadTimeScaleRace` (new)
- `Player['Race Conditions'].PrivatePractice` ✓
- `Player['Race Conditions'].PrivateQualifying` (new)
- `Player['Game Options']['practice length']` ✓
- `Player['Game Options']['qualifying length']` (new)
- `Player['Game Options']['race length']` (new)
- `Player['Race Conditions'].RaceStartType` (new — `0=Standing, 1=Rolling, 2=FastRolling` to verify)

Disabled sessions: set their `length = 0` and `enabled` flags off (need to verify which LMU field controls "skip session entirely").

### D4. Solo-only

No grid configuration UI. We don't need to populate AI cars or grid positions. The existing "Grid" object in SessionPreset (with template defaults) is fine.

## File touch list

```
app/src/renderer/index.html       — settings cleanup, Custom card UI, Race weekend UI, grip values
app/src/renderer/app.js           — version+date IPC, reset+logs handlers, new state model, save/load presets
app/src/renderer/styles.css       — new sub-tab + 5-slot grid styling
app/src/main/main.js              — new IPCs (resetAll, openLogs, getVersion)
app/src/main/preload.js           — expose the new IPCs
app/src/main/settings.js          — resetAll() method
app/src/main/install-scanner.js   — track-layout overrides
app/src/main/lmu-launcher.js      — slice-stamping for wet+custom, per-session Race Conditions, blob path conditional
```

## Risks & mitigations

- **Investigation result unknown.** Both Bucket C backend paths (slice-driven vs blob fallback) are spec'd. The implementation plan picks one once the user reports the test result. Worst case: Custom weather ships as approximation in v3.0.4 and gets upgraded in v3.0.5.
- **Race weekend per-session field names.** LMU's settings.json field names for Qualify1StartingTime etc. are inferred from naming patterns. Implementation must verify against the actual LMU `<install>/UserData/player/settings.json` before merging.
- **Reset-all-settings UX.** `window.location.reload()` works in Electron renderer; this resets in-memory state too. Confirmed pattern.
- **Save/load presets cap.** 50 hard cap is generous. If exceeded, FIFO-drop oldest rather than refusing the save.

## Verification approach

Manual smoke test for each bucket. Reuses the v3.0.4 build the user already has installed:

- B: open Settings drawer, confirm Check-for-updates / License rows are gone, version reads "3.0.3", click Open logs (folder opens), click Reset (confirms then resets), check track names in Lemans/Monza/Paul Ricard groups.
- B7/B8: launch with Saturated grip → verify in LMU's weather/track display. Launch with Wet preset → verify forecast shows rain in all 5 slots.
- Investigation: per the procedure in §2.
- C: build a custom 5-slot weather pattern, save as preset, reload app, load preset, verify state restores. Launch and verify slices show in LMU.
- D: enable all 3 sessions, launch, verify LMU shows full race weekend in pre-session screen.

No automated tests added by this spec. Renderer has no test infrastructure today.
