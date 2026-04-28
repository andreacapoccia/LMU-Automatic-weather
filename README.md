# GO LMU Launcher

One-click launcher for [Le Mans Ultimate](https://store.steampowered.com/app/2399420/Le_Mans_Ultimate/) private-practice sessions. Pick a track, a car, and a weather preset (GO Setups Dry / Rain / fully custom) — the app drives LMU's local REST API to load you straight into the garage.

Built for [GO Setups](https://gosetups.gg) drivers.

## Features

- **Track picker** — every installed track with all layouts (Bahrain WEC has 4, Spa has 3, etc.)
- **Car picker** — progressive Class → Model → Livery selection, or auto-detect from LMU
- **Weather presets** — GO Setups Dry, GO Setups Rain (overcast + 75% precip + 20°C), and Custom (sky / rain% / temp / humidity / wind)
- **Session settings** — practice length, start time, starting grip, RealRoad time scale, tyre warmers, private practice, flag rules, track limits, mechanical failures
- **Live LMU integration** — auto-launches LMU via Steam if not running, navigates to main menu, sets the track, and loads the session
- **Manual install path picker** — for drivers with non-default Steam library locations
- **Portable** — single ZIP, no installer, no admin rights, no dependencies

## For drivers (install + use)

1. Download the latest release ZIP
2. Right-click → Extract All (anywhere — Desktop is fine)
3. Open the extracted folder and double-click `GO LMU Launcher.exe`
4. If Windows shows "unrecognized app", click "More info" → "Run anyway" (the app is unsigned but safe)

To use:

1. Open Le Mans Ultimate, get to the main menu
2. Pick a car/livery in LMU's UI (or just leave the launcher set to auto-detect)
3. In the launcher: choose track → weather preset → tweak any session settings → click **Launch Practice in LMU**

## For developers (build + run)

Requirements: Node 20+, Windows 10/11.

```bash
git clone <this-repo>
cd app
npm install
npm start         # dev mode
npm run build     # produces dist/GO-LMU-Launcher-<version>-win-x64.zip
```

## How it works

LMU exposes an undocumented local REST API on `http://localhost:6397` while the game is running. The app drives the entire launch flow through it — no DLL injection, no config-file editing.

The launch sequence:

1. Probe `/navigation/state` to check LMU is alive
2. Launch via `steam://run/2399420` if needed
3. Wait for `NAV_MAIN_MENU` (force-back from any active event)
4. `POST /rest/race/track` with the chosen track ID
5. `POST /rest/sessions/SessionPresets/requestPreset` to get the SCENE block
6. Build a full session save JSON (29 top-level fields, including 3 zlib-compressed weather blobs captured from GO Setups standard sessions)
7. `POST /rest/sessions/SaveLoad/loadGame` with the composed body

The weather blobs are the trick: LMU's top-level `save.Weather` field is an array of 3 binary weather node arrays (one per session: Practice / Qualifying / Race). They're not synthesizable without reverse-engineering rFactor's binary format, so the app ships a small library of pre-captured baselines (Dry / Overcast+Rain / Storm) and picks the closest one. The decorative `SessionPreset.Weather` slices reflect the user's tuning so they show correctly in LMU's pre-session weather summary.

## Project layout

```
app/
  src/
    main/                      Electron main process
      main.js                  entry, IPC handlers
      preload.js               renderer ↔ main bridge
      lmu-launcher.js          REST flow + composeSession
      install-scanner.js       finds LMU, lists tracks/cars
      settings.js              %APPDATA% JSON store
      data/
        weather-blobs.json     captured Dry/Rain/Storm baselines
        gosetups-template.json full SessionPreset baseline
    renderer/                  HTML/CSS/JS UI (no framework)
      index.html
      styles.css               dark theme, GO Setups red #FF3B1F
      app.js
  assets/
    icon.ico                   app icon
    logo-horizontal.png        GO Setups logo
  scripts/
    build.js                   @electron/packager + zip
    dev-start.js               dev launcher
    patch-lfm.js               LFM-fetch capture utility (dev only)
  package.json
```

## Acknowledgements

- LMU REST API surface area was discovered by inspecting the [LFM App](https://lowfuelmotorsport.com/) (whose source maps were shipped with the binary). The GO LMU Launcher is an independent project not affiliated with LFM or PitPath.
- Weather blob baselines were captured from real LMU sessions configured by GO Setups.

## License

UNLICENSED — internal GO Setups tooling. Not for redistribution.
