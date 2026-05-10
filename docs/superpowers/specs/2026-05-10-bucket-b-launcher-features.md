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

Add a custom `buildDate` field to `app/package.json` that gets bumped manually each release alongside `version` (same way as the visible `v3.0.X` in index.html). Reading file mtimes doesn't work — in packaged builds the mtime is the user's install time, not our release date.

```jsonc
// app/package.json
{
  "version": "3.0.4",
  "buildDate": "2026-05-10",   // ← new, updated each release
  ...
}
```

In `main.js`, add:
```js
const PKG = require(path.join(app.getAppPath(), 'package.json'));
ipcMain.handle('app:getVersion', () => ({
  version: PKG.version,
  buildDate: PKG.buildDate || 'unknown',
}));
```

Expose in preload as `getVersion`. In renderer: on init, fetch and populate the Version + Updated rows. Remove the hardcoded "2.0.4 (build 318)" and "2025-04-29".

Also delete the "Channel: stable" row — it's hardcoded and conveys nothing useful. (Implementation note: confirm with user; if they want to keep it, leave it for now.)

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

Per-session weather state lives inside each session in D1's `sessions` object:

```ts
state.overrides.sessions = {
  practice:   { …D1-fields…, weatherPreset: 'dry'|'overcast_rain'|'custom', customWeather: Slot[5] },
  qualifying: { …D1-fields…, weatherPreset: 'dry'|'overcast_rain'|'custom', customWeather: Slot[5] },
  race:       { …D1-fields…, weatherPreset: 'dry'|'overcast_rain'|'custom', customWeather: Slot[5] },
};
type Slot = { sky: 0..10, rainChance: 0..100, temperature: number };
```

`customWeather` is always a 5-slot array; only consulted when `weatherPreset === 'custom'`. Defaults on first init: every slot = `{ sky: 0, rainChance: 0, temperature: 22 }`.

### C2. UI placement

The Custom 5-slot grid lives **inside each session sub-card** (see D2 mockup) and is shown only when that session's `weatherPreset === 'custom'`. There is **no standalone Custom weather card** — the legacy Card 03 from the v3.0.3 launcher is removed entirely.

Each slot cell:
- Sky `<select>` with the 11 options from Bucket A's cwSky fix (`value="0..10"`)
- Rain chance number input (0..100, step 5)
- Temperature number input (-10..50, step 1)

Reuse `.field` and `.s-input` styling.

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

**Save flow.** Click "Save preset…" → `prompt('Name this preset:')` → on OK, snapshot `{ practice: sessions.practice.customWeather, qualifying: sessions.qualifying.customWeather, race: sessions.race.customWeather }` and push to settings.

**Load flow.** Click "Load…" → small dropdown listing presets by name + date → on select, write each session's `customWeather` from the preset's `config[session]` and re-render the visible slot grid (only the currently-displayed session needs immediate re-render; others just update state).

**Delete flow.** Each preset row in the dropdown has an X button. Confirm before delete.

For v1, no rename, no export/import. Names are unique-by-coincidence (we don't dedup).

### C4. Backend behavior — slice stamping (always runs)

In `lmu-launcher.composeSession`, for each session in [Practice, Qualifying, Race]:
- Look up the session's `weatherPreset`.
- For preset `'dry'`: stamp slices with all 5 slots = `{ sky: 0, rainChance: 0, temperature: 20 }` (matches "GO Setups Dry").
- For preset `'overcast_rain'`: stamp slices with all 5 slots = `{ sky: 8, rainChance: 100, temperature: 20 }` (matches B8 spec).
- For preset `'custom'`: stamp slices from `sessions[X].customWeather[i]` for i=0..4.

In all cases write Sky/RainChance/Temperature into `block.Weather[i]`; leave Humidity/WindSpeed/WindDirection at template defaults.

This is the always-on path. Whether actual game weather follows the slices is the §2 investigation question — see C5.

### C5. Backend behavior — binary blob (conditional on investigation)

**If §2 investigation shows slices drive weather:** Skip the binary blob. Set `Player['Race Conditions'].Weather` to whatever mode uses slices (likely 0=real-time). Set `save.Weather = []` (or whatever LMU accepts as "no scripted weather"). Custom weather is fully achievable.

**If §2 investigation shows blob drives weather:** Pick the closest static blob per session by averaging the 5 slots' RainChance.

```js
function pickBlobForSession(session) {
  const sw = session.weatherPreset;
  if (sw === 'dry') return 'dry';
  if (sw === 'overcast_rain') return 'overcast_rain';
  // custom
  const avgRain = session.customWeather.reduce((a, s) => a + s.rainChance, 0) / 5;
  if (avgRain >= 75) return 'storm';
  if (avgRain >= 30) return 'overcast_rain';
  return 'dry';
}
const weatherBlob = [
  WEATHER_BLOBS[pickBlobForSession(sessions.practice)][0],   // index 0 = practice
  WEATHER_BLOBS[pickBlobForSession(sessions.qualifying)][1], // index 1 = qual
  WEATHER_BLOBS[pickBlobForSession(sessions.race)][2],       // index 2 = race
];
```

Slice values still get stamped (per C4) so the forecast UI matches user intent. Document in the UI that actual weather is approximate when in this mode.

## Bucket D — Race weekend

### D1. Data model

```ts
type Slot = { sky: 0..10, rainChance: 0..100, temperature: number };
type SessionConfig = {
  enabled: boolean,
  length: number,           // minutes
  startTime: number,        // minutes from midnight (0..1439)
  privateSession?: boolean, // Practice + Qual only
  startType?: 'rolling' | 'fast_rolling',  // Race only
  startingGrip: string,     // 'preset:SATURATED.RRBIN' etc
  realRoadTimeScale: number,// 0..15
  weatherPreset: 'dry' | 'overcast_rain' | 'custom',
  customWeather: Slot[5],   // consulted only when weatherPreset === 'custom'
};

state.overrides.sessions = {
  practice:   SessionConfig,
  qualifying: SessionConfig,
  race:       SessionConfig,
};
```

Defaults on first init:
- practice:   `{ enabled: true,  length: 360, startTime: 720, privateSession: true, startingGrip: 'preset:SATURATED.RRBIN', realRoadTimeScale: 0, weatherPreset: 'dry', customWeather: <5 default slots> }`
- qualifying: `{ enabled: false, length: 20,  startTime: 900, privateSession: true, startingGrip: 'preset:HEAVY.RRBIN',     realRoadTimeScale: 0, weatherPreset: 'dry', customWeather: <5 default slots> }`
- race:       `{ enabled: false, length: 240, startTime: 780, startType: 'rolling',  startingGrip: 'preset:SATURATED.RRBIN', realRoadTimeScale: 0, weatherPreset: 'dry', customWeather: <5 default slots> }`

Length limits: practice 1..360 (6h), qualifying 1..60, race 1..1440 (24h). Enforced in renderer via slider `min`/`max`; main process doesn't re-validate.

The legacy flat fields `state.overrides.weatherPreset`, `state.overrides.customWeather`, `state.overrides.practiceLength`, etc. are removed in this refactor; everything routes through `sessions[X]`.

### D2. UI restructure

The existing Card 03 (Weather Preset) and Card 04 (Practice settings) merge into a single Card 03 ("Sessions"). Inside, three collapsible sub-cards in vertical stack: **Practice / Qualifying / Race**. Each sub-card is self-contained with its own weather AND rules:

```
┌─ Practice ────────────────────────────  [Enabled ●] ──┐
│                                                       │
│ Weather: [Dry] [Wet] [Custom]                         │
│   ↳ when Custom selected, inline 5-slot grid:         │
│     ┌──Slot 1──┬──Slot 2──┬──Slot 3──┬──Slot 4──┬──Slot 5──┐
│     │ Sky:▾    │ Sky:▾    │ Sky:▾    │ Sky:▾    │ Sky:▾    │
│     │ Rain: 0% │ Rain: 0% │ Rain: 0% │ Rain: 0% │ Rain: 0% │
│     │ Temp:22° │ Temp:22° │ Temp:22° │ Temp:22° │ Temp:22° │
│     └──────────┴──────────┴──────────┴──────────┴──────────┘
│     [Save preset…] [Load preset…]                     │
│                                                       │
│ Length:    [────●──────] 6h 0m                        │
│ Start:     [──●────────] 12:00                        │
│ Privacy:   [● Private]                                │
│ Grip:      [Saturated ▾]                              │
│ RealRoad:  [────●──] 0× scale                         │
└───────────────────────────────────────────────────────┘
```

Race sub-card additionally has a **Start type** select (Rolling / Fast Rolling) above Length. Race-only differences:
- No Privacy toggle (always solo per D4)
- Length slider goes 1m..24h (vs 6h for Practice, 60m for Qual)
- Adds Start type select

Disabled session cards collapse to header-only (no body).

Save/Load preset buttons (in the Custom inline grid) act on the **whole preset** (snapshot of all 3 sessions' customWeather arrays) per C3 — not just the displayed session. The button placement inside one session is for proximity to where the user just edited; the action is global.

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

**Disabled sessions.** LMU's settings.json has per-session enable booleans (visible as the `Practice`, `Qualifying`, `Race` toggles in LMU's own UI — see screenshots 4/5/6). Implementation step: dump LMU's settings.json after toggling each session off in LMU's UI to identify the exact field name (likely `Player['Game Options']['Run Practice']` or similar). Set the matching field to `false` for any session with `enabled === false`. Don't rely on `length = 0` alone — LMU may still show a 0-second session in the pre-race summary, which would confuse drivers.

If we can't find the toggle field quickly during implementation, fall back to: set `length = 1` (1-minute session) for disabled sessions and document the caveat in the UI.

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

Manual smoke test against a fresh `app/dist/GO-LMU-Launcher-3.0.4-win-x64.zip` install. Each bullet is a verifiable goal:

**Bucket B**
- B1: open Settings → About & logs. Expect: no "Check for updates" row exists.
- B2: same panel. Expect: no "License" row exists.
- B3: click "Open logs folder". Expect: Windows Explorer opens at `<userData>/logs/` (folder may be empty).
- B4: click "Reset…", confirm dialog, click OK. Expect: app reloads; any saved settings (e.g. watch path, motec exe) are gone.
- B5: same panel. Expect: Version row reads `3.0.4`, Updated row reads `2026-05-10`.
- B6: open Card 01 (Track), look at Le Mans / Monza / Paul Ricard layout dropdowns. Expect: no "Bugatti", "Grande Anello", or "Long (1A)" text — replaced per B6 list.
- B7: select Saturated grip → launch a session. In LMU's pre-session weather panel, expect: track surface shows wet/saturated. Repeat with Green → expect: dry track. (The pre-session weather panel labels the surface state.)
- B8: select Wet preset → launch. Expect: pre-session forecast shows rain icon in all 5 slots, temp 20°, no sun icons.

**Investigation (§2)**
- Outcome reported back: `actual_weather: rain | sun | mixed`. Implementation plan branches on this.

**Bucket C**
- C1+C2: select Custom on Practice card. Expect: 5-slot grid appears with sky/rain/temp inputs. Editing any cell updates state (verified by launching and seeing the change in LMU).
- C3 save: configure custom slots, click Save preset, name it "test1". Expect: preset saved to settings store (verifiable by reading `<userData>/settings.json`).
- C3 load: reload app. Custom slots reset to defaults. Click Load → "test1". Expect: slots populate with saved values.
- C3 delete: click X on "test1". Confirm. Expect: preset removed from list and settings store.
- C4 stamping: launch with each preset (dry/wet/custom). Expect: in-game weather panel matches the stamped slice values.
- C5 (only if blob fallback applies): edit Custom slots to all-rain (rainChance=100). Launch. Expect: storm blob is selected (verified via the saved request JSON in `~/Desktop/GO-LMU-debug/`).

**Bucket D**
- D2 enable: enable all 3 session sub-cards. Launch. Expect: LMU's session list shows Practice → Qualifying → Race in order with the configured lengths.
- D2 disable: disable Qualifying. Launch. Expect: LMU jumps Practice → Race, no Qualifying session shown.
- D2 race-only: enable Race, set start type = Fast Rolling. Launch. Expect: LMU race start screen confirms "Fast Rolling" start.
- D2 length limits: drag Practice slider to max. Expect: stops at 6h. Same for Qual at 60m, Race at 24h.

No automated tests added by this spec. Renderer has no test infrastructure today; fixing that is its own bucket of work.

## Open UX considerations (not blockers)

- **No "Apply weather to all sessions" shortcut.** With the per-session weather model, setting Wet across Practice + Qualifying + Race requires 3 clicks. If drivers find this annoying we can add a small "Copy weather to all enabled sessions" link inside each session card in v3.0.5.
- **No preset-rename or export.** Save/load presets are minimum-viable. If usage grows we'd add rename and JSON export/import in a later bucket.
- **Disabled-session field name is research-pending.** See D3 fallback.
