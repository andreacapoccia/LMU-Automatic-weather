# GO LMU Launcher v2 — Renderer Redesign

## Goal

Replace the current Electron renderer (`app/src/renderer/{index.html, styles.css, app.js}`) with the visual design from `GO LMU Launcher v2.html`, preserving all existing functionality (LMU launch, telemetry watcher, DuckDB→MoTeC conversion, settings).

The current app works end-to-end with the new converter; this redesign is purely the front-end. No new IPC handlers, no schema changes, no main-process work.

## Source files

- **Design source:** `C:\Users\andre\Downloads\GO LMU Launcher v2.html` (3808 lines, self-contained HTML+CSS+JS prototype, no IPC)
- **Current renderer:** `app/src/renderer/index.html` (834), `styles.css` (1915), `app.js` (1456)
- **IPC bridge:** `app/src/main/preload.js` exposes `window.go` with ~25 methods (unchanged)

## Out of scope

- React `Tweaks` panel (`tweaks-panel.jsx`) and `<script type="text/babel">` blocks at the bottom of the design — design-time controls only, removed.
- Cosmetic mock features in the design that need new IPC/state to be meaningful: tab badge counts, active-conversion progress bar, first-run setup card, demo "Preview empty" toggle. Markup stays so styling is intact, but they remain static placeholders this round.
- Any main-process changes. Preload API surface is frozen.
- The DuckDB→MoTeC converter (separate work, already done).

## Architecture

Three files, same locations as today:

```
app/src/renderer/
├── index.html      ← from new design's <body>, asset paths corrected
├── styles.css      ← from new design's <style> block
└── app.js          ← merged: new design's plain <script> blocks
                       + all existing window.go.* IPC integration,
                       re-bound to new element IDs
```

**Why merge `app.js` rather than replace?** The current `app.js` is the only place that knows how to talk to LMU's REST API, the file watcher, the converter, and the settings store. The new design's scripts only handle pure-UI concerns (tab switching, drawer open/close, sessions DOM rendering). Merging means we keep ~1000+ lines of working IPC code and only swap the UI binding layer.

## Asset mapping

| Design references | Resolution |
|---|---|
| `assets/logo.png` | Use existing `app/assets/GO Setups logo.png`; update `src` |
| `ref/icon.png` (weather pill brand mark) | Substitute with `assets/GO Setups logo.png` or remove the `<img>` if it doesn't render well at small size |

No new asset files needed.

## ID compatibility

Most element IDs already match between current and new design (`trackSelect`, `layoutSelect`, `classChips`, `launchBtn`, `settingsBtn`, `tlmDrop`, `watcherToggle`, `sessionsGrid`, etc.). Three categories during implementation:

1. **Both have it** — re-bind handler to new ID, no other change.
2. **Current handler, no element in new design** — check if the new design has the same control under a different ID/structure (e.g. weather presets moved from cards to pills); if truly removed, drop the handler.
3. **New element, no current handler** — leave static for now (the cosmetic mocks above).

A full ID diff is built during implementation as task output, not pre-computed in this spec.

## IPC integration map (current `window.go.*` → new view)

| Method | Where in new design |
|---|---|
| `scanInstall`, `pickInstallPath`, `resetInstallPath` | `installPill` in topbar; settings drawer install section |
| `isLmuAlive`, `isGoFastAlive` | `lmuStatusPill` (`#lmuStatusPill`, `#lmuStatusText`) in topbar |
| `fetchLiveTracks`, `fetchLiveCars` | Track/Car panels (`trackSelect`, `layoutSelect`, `classChips`, car selects) |
| `launch(payload)` | `launchBtn`; status logged into `#log` panel |
| `onLog` | `#log` div in launch panel |
| `convertRun`, `startWatch`, `stopWatch`, `onConvertLog` | Telemetry view: `tlmDrop`, `tlmPickFile`, `watcherToggle`, sessions grid |
| `pickFolder`, `pickFile` | Settings drawer (auto-watch path), telemetry view |
| `motecOpen`, `revealInFolder`, `deleteConversion` | Per-row actions in `sessionsGrid` |
| `getSetting`, `setSetting` | Settings drawer fields |
| `openExternal` | Footer/help links if present |

## Order of work (implementation will sequence as)

1. Drop in new `index.html` + `styles.css` with corrected asset paths. App launches, mostly non-functional.
2. Migrate UI-only scripts from new design (tab switching, settings drawer open/close/section nav, switch toggles, range fill helpers, demo-empty toggle).
3. Wire **Launcher view** end-to-end: install detection → track/car/weather/session bindings → launch → log streaming.
4. Wire **Telemetry view** end-to-end: file dropzone, watcher toggle (calling existing `startWatch`/`stopWatch`), sessions grid render from existing convert logs, per-row actions.
5. Wire **Settings drawer** sections to `getSetting`/`setSetting` and the install-path methods.
6. Smoke test: launch a session, drop a `.duckdb`, toggle the watcher, change a setting, restart app — all paths green.

## Verification

This is UI work; success is functional, not test-suite-driven. Manual verification per step:

- Launch view: press Launch, LMU enters garage with the configured session.
- Telemetry: dropping a `.duckdb` produces a working `.ld` (already known good from converter work).
- Watcher: toggling on starts watching, file drops trigger conversion, conversion appears in grid.
- Settings: changes persist across app restart.

## Files touched

- `app/src/renderer/index.html` — rewritten
- `app/src/renderer/styles.css` — rewritten
- `app/src/renderer/app.js` — substantially modified (UI binding layer rewrite, IPC integration preserved)
- `app/assets/` — possibly add a small `icon.png` if weather pill design needs one (or substitute existing logo)

No changes to `app/src/main/`, no `package.json` dependencies, no preload changes.
