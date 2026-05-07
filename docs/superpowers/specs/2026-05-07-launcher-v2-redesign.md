# GO LMU Launcher v2 — Renderer Redesign

## Goal

Replace the current Electron renderer (`app/src/renderer/{index.html, styles.css, app.js}`) with the visual design from `GO LMU Launcher v2.html`, preserving all existing functionality (LMU launch, telemetry watcher, DuckDB→MoTeC conversion, settings).

The current app works end-to-end with the new converter; this redesign is purely the front-end. No new IPC handlers, no schema changes, no main-process work.

## Source files

- **Design source:** `C:\Users\andre\Downloads\GO LMU Launcher v2.html` (3808 lines, self-contained HTML+CSS+JS prototype, no IPC)
- **Current renderer:** `app/src/renderer/index.html` (834), `styles.css` (1915), `app.js` (1456)
- **IPC bridge:** `app/src/main/preload.js` exposes `window.go` with ~25 methods (unchanged)

## Out of scope

- React `Tweaks` panel (`tweaks-panel.jsx`) and `<script type="text/babel">` blocks at the bottom of the design — design-time controls, removed.
- The design's `demoEmptyToggle` (top-bar "Preview empty" button) — design-time preview only, no production purpose. **Remove from markup.**
- The design's `summaryStats` block in the telemetry view — needs new IPC/state, not in current app. **Keep markup, leave content static** until follow-up work.
- Any main-process changes. Preload API surface is frozen.
- The DuckDB→MoTeC converter (separate work, already done).

**Note on "cosmetic-looking" mocks that are actually live:** `tabBadgeTlm`, `activeFill`/`activePct`/`activeStage`/`activeConv`, `firstRunCard`/`firstRunCta`/`firstRunDismiss`, `practiceStatus`/`practiceReset` are all wired in current `app.js`. They look like prototype placeholders in the design but are real features and MUST be re-wired.

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
| `assets/logo.png` (top-bar brand) | Update `src` to `assets/GO Setups logo.png` (existing) |
| `ref/icon.png` (weather pill brand mark, 4 references) | **Remove the `<img class="wx-brand">` element entirely.** No appropriate small brand icon exists; the full GO Setups logo would render unreadably at that size. |

No new asset files needed.

## ID changes required in the design markup

Two places where the design lacks IDs we need:

1. The "Change" button inside `installPill`. Currently `<button type="button" class="install-pill-btn">Change</button>` — add `id="installPillChange"` so `pickInstallPath` can bind to it. (Pill itself stays click-inert.)
2. None other identified during spec review; full ID diff is built during implementation as task output.

## ID compatibility

Most element IDs already match (`trackSelect`, `layoutSelect`, `classChips`, `launchBtn`, `settingsBtn`, `tlmDrop`, `watcherToggle`, `sessionsGrid`, `tabBadgeTlm`, `firstRunCard`, etc.). Three categories during implementation:

1. **Both have it, same control type** — re-bind handler to new ID, no behavior change.
2. **Both have it, different control type** (e.g. weather went from radio cards to pills with different click semantics) — re-bind AND adapt the handler logic to the new control's interaction model.
3. **Current handler, no element in new design** — search the new design for an equivalent under a different ID; if there genuinely isn't one, remove the handler. Do not silently leave dead code.

## IPC integration map (current `window.go.*` → new view)

| Method | Where in new design |
|---|---|
| `scanInstall`, `pickInstallPath`, `resetInstallPath` | `installPill` shows path + state; new `#installPillChange` button triggers `pickInstallPath`; settings drawer install section for `resetInstallPath` |
| `isLmuAlive`, `isGoFastAlive` | `lmuStatusPill` (`#lmuStatusPill`, `#lmuStatusText`) in topbar |
| `fetchLiveTracks`, `fetchLiveCars` | Track/Car panels (`trackSelect`, `layoutSelect`, `classChips`, car selects in `.panel-car .row`) |
| `launch(payload)` | `launchBtn`; status streamed into `#log` |
| `onLog` | `#log` div in launch panel |
| `convertRun`, `startWatch`, `stopWatch`, `onConvertLog` | Telemetry view: `tlmDrop`, `tlmPickFile`, `watcherToggle`, sessions grid; updates `tabBadgeTlm`, `activeConv*`, `firstRunCard` visibility |
| `pickFolder`, `pickFile` | Settings drawer auto-watch path + telemetry-view file pickers |
| `motecOpen`, `revealInFolder`, `deleteConversion` | Per-row actions in `sessionsGrid` |
| `getSetting`, `setSetting` | Settings drawer fields; `firstRunDismissed` flag for the first-run card |

`openExternal` is exposed by preload but unused in current `app.js`; not bound this round.

## Order of work

Each numbered step is one commit. App should boot at every step.

1. **Drop in markup + styles.** Replace `index.html` and `styles.css` with the design's content (asset paths fixed, `installPillChange` ID added, `wx-brand` images and `demoEmptyToggle` removed). App launches but ~95% non-functional. Existing `app.js` still loaded so DOM-ready handlers fire and either bind successfully (matching IDs) or no-op.
2. **UI-only scripts from the design.** Add tab switching, settings drawer open/close/section nav, switch toggles, range-fill helpers, log toggle. No IPC, just visuals.
3. **Wire Launcher view.** Install detection → track/car/weather/session bindings → launch button → log streaming. Verify: pressing Launch enters LMU garage with the configured session.
4. **Wire Telemetry view.** Dropzone, file picker, watcher toggle, sessions grid render, per-row actions (open/reveal/delete), `firstRunCard` show/dismiss, `activeConv*` progress, `tabBadgeTlm` count. Verify: drop a `.duckdb`, get a `.ld`; toggle watcher; restart app and dismiss-state persists.
5. **Wire Settings drawer.** All sections to `getSetting`/`setSetting` and the install-path methods. Verify: change a setting, restart app, value persists.
6. **Smoke test + cleanup.** Walk every IPC method end-to-end. Remove any dead code from old `app.js`. Verify nothing in the browser console errors on app start.

## Verification

UI work; success is functional, not test-suite-driven. Manual verification per step is listed above. Final criteria:

- Launch view: press Launch → LMU enters garage with configured session.
- Telemetry: dropping a `.duckdb` produces a working `.ld` (already known good from converter work).
- Watcher: toggling on starts watching, file drops trigger conversion, conversion appears in grid, `tabBadgeTlm` increments, `firstRunCard` hides.
- Settings: changes persist across app restart.
- No console errors on startup or during any of the above flows.

## Files touched

- `app/src/renderer/index.html` — rewritten
- `app/src/renderer/styles.css` — rewritten
- `app/src/renderer/app.js` — substantially modified (UI binding layer rewrite, IPC integration preserved)

No changes to `app/src/main/`, no `package.json` dependencies, no preload changes, no new assets.
