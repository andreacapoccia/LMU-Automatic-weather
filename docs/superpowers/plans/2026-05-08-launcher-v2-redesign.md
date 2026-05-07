# Launcher v2 Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Electron renderer with the visual design from `GO LMU Launcher v2.html`, preserving all existing functionality (LMU launch, telemetry watcher, DuckDB→MoTeC conversion, settings).

**Architecture:** Wholesale replace of `index.html` and `styles.css`. Current `app.js` already implements ~90% of what the design's plain `<script>` blocks do (tab switching, drawer, range fills, custom dropdown enhancer). Strategy: keep `app.js` as the source of truth for IPC + behavior, drop in the new visuals, then rebind any handlers whose IDs or DOM structure changed.

**Tech Stack:** Electron renderer (vanilla JS, no framework), `window.go.*` IPC bridge from `app/src/main/preload.js`.

**Spec:** `docs/superpowers/specs/2026-05-07-launcher-v2-redesign.md`

**Source files:**
- Design: `C:\Users\andre\Downloads\GO LMU Launcher v2.html` (3808 lines)
  - Style block A: lines 9–2080
  - Body: lines 2082–3807
  - Style block B: lines 3316–3377 (drawer styles, embedded mid-body)
  - Plain JS to skip: React/Babel `<script>` at 2646–2649 and `<script type="text/babel">` at 3251–3314
  - Plain JS already duplicated in current `app.js` (do NOT copy): 2651–3049, 3051–3249, 3704–3805
- Current renderer: `app/src/renderer/{index.html, styles.css, app.js}`
- IPC: `app/src/main/preload.js` (`window.go`)

**Verification approach:** Manual smoke testing in the running Electron app. No automated tests for the renderer exist or will be added by this plan.

---

## Task 1: Drop in new HTML markup

**Files:**
- Modify: `app/src/renderer/index.html` (rewritten)

**Goal:** Replace the renderer's index.html with the design's body markup, with all corrections applied so it loads without missing-asset 404s and without dead React/Babel script tags.

- [ ] **Step 1: Read current index.html to know what to preserve at the document level**

```bash
head -20 "C:/Users/andre/Desktop/LMU-Automatic weather/.worktrees/duckdb-motec/app/src/renderer/index.html"
```

Look at: doctype, html lang, head/title, links to `styles.css` and `app.js`. These need to stay; only the body content changes.

- [ ] **Step 2: Replace `app/src/renderer/index.html` with the new structure**

Write the new file with this skeleton:

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>GO LMU Launcher</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="styles.css" />
</head>
<body>
<!-- BODY CONTENT HERE — copied verbatim from design lines 2083 through 3805 (see Step 3) -->
<script src="app.js"></script>
</body>
</html>
```

- [ ] **Step 3: Copy body markup from design source into the new index.html**

Open `C:/Users/andre/Downloads/GO LMU Launcher v2.html`. Copy lines 2083–3702 (everything between `<body>` and the first `<script src="https://unpkg.com/react...">`) into the body of the new index.html.

This includes: the `<header class="topbar">`, both `<main>` blocks (Launcher and Telemetry views), the `<aside class="drawer">` (lines 3381–3702), and the embedded `<style>` block at 3316–3377 — leave that embedded `<style>` block in place for now; it gets extracted in Task 2.

- [ ] **Step 4: Fix the brand logo path**

Find the line:
```html
<img src="assets/logo.png" alt="GO Setups" class="brand-logo" />
```
Change `src` to:
```html
<img src="../../assets/GO Setups logo.png" alt="GO Setups" class="brand-logo" />
```
(Path is relative to `app/src/renderer/index.html`; assets live at `app/assets/`.)

- [ ] **Step 5: Remove all four `<img class="wx-brand">` elements**

Search the file for `<img class="wx-brand"`. Delete the entire `<img>` tag (one line each, four occurrences in the weather-pill buttons). Per spec, no small brand icon will be substituted.

- [ ] **Step 6: Remove the demo "Preview empty" toggle**

Find and delete this whole element from the topbar:
```html
<span class="demo-toggle" id="demoEmptyToggle" title="Preview empty / first-run state">
  <span style="font-size:8px;">◐</span> Preview empty
</span>
```

- [ ] **Step 7: Add `id="installPillChange"` to the install-pill Change button**

Find the line:
```html
<button type="button" class="install-pill-btn">Change</button>
```
Inside the `<div class="install-pill" id="installPill">`. Add the id:
```html
<button type="button" class="install-pill-btn" id="installPillChange">Change</button>
```

- [ ] **Step 8: Run the app and verify it boots**

```bash
cd "C:/Users/andre/Desktop/LMU-Automatic weather/.worktrees/duckdb-motec/app" && npm start
```

Expected: Window opens. Visual design is the new one. Many interactions broken (current `styles.css` is the old one; current `app.js` is binding by ID and most IDs match, some don't). No console errors about missing assets (logo loads).

If the logo doesn't render, the path in Step 4 is wrong — try alternatives like `../../assets/GO Setups logo.png` or `assets/GO Setups logo.png`. Verify with the Electron DevTools Network tab.

- [ ] **Step 9: Commit**

```bash
cd "C:/Users/andre/Desktop/LMU-Automatic weather/.worktrees/duckdb-motec"
git add app/src/renderer/index.html
git commit -m "feat(ui): drop in v2 design markup (no styles, no IPC rewire yet)"
```

---

## Task 2: Drop in new styles.css

**Files:**
- Modify: `app/src/renderer/styles.css` (rewritten)
- Modify: `app/src/renderer/index.html` (remove the embedded `<style>` block left at lines from Task 1 Step 3)

**Goal:** Replace the renderer's stylesheet with the design's two `<style>` blocks concatenated. App now looks like the design.

- [ ] **Step 1: Replace `app/src/renderer/styles.css` with the design's primary `<style>` block**

Open `C:/Users/andre/Downloads/GO LMU Launcher v2.html`. Copy lines 10–2079 (everything inside the first `<style>...</style>`, NOT including the tags themselves) into a fresh `app/src/renderer/styles.css`, replacing all current contents.

- [ ] **Step 2: Append the second `<style>` block (drawer styles)**

Append lines 3317–3376 from the design HTML to the end of `app/src/renderer/styles.css`. (These are the drawer-specific styles that the design embeds mid-body.)

- [ ] **Step 3: Remove the embedded `<style>` block from index.html**

In `app/src/renderer/index.html`, find the embedded `<style>` tags that came over in Task 1 Step 3 (the second style block was inside the body). Delete the entire `<style>...</style>` block — its contents now live in styles.css.

- [ ] **Step 4: Run the app and verify the design renders correctly**

```bash
cd "C:/Users/andre/Desktop/LMU-Automatic weather/.worktrees/duckdb-motec/app" && npm start
```

Expected: App now has the new dark theme with the orange accent. Topbar has the install pill, status pills, settings gear. Track/Car/Weather/Session/Launch panels visible in the launcher view. Tab switching may not work yet (Task 3).

If a font fails to load (Inter Tight, JetBrains Mono): network issue, not a code problem; system fonts will fall back. App should still be usable.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/andre/Desktop/LMU-Automatic weather/.worktrees/duckdb-motec"
git add app/src/renderer/styles.css app/src/renderer/index.html
git commit -m "feat(ui): apply v2 design styles"
```

---

## Task 3: Build the ID-change diff and fix Launcher-view bindings

**Files:**
- Modify: `app/src/renderer/app.js` (rebind handlers whose IDs or DOM structure changed)

**Goal:** App's Launcher view (track/car/weather/session/launch) is fully functional with the new design. Tab switching works.

- [ ] **Step 1: Open DevTools, capture console errors**

In the running Electron app, press F12 (or Ctrl+Shift+I) to open DevTools. Reload the renderer (Ctrl+R). Note every error in the Console tab — these are the broken bindings (typically `Cannot read properties of null (reading 'addEventListener')` from `getElementById` returning null).

- [ ] **Step 2: For each console error, find the line in `app.js` and identify the ID mismatch**

Walk every error. For each, open `app.js`, find the line, identify the ID it tried to look up. Then search the new `index.html` for an equivalent element. Two outcomes:
- Element exists with a different ID → update the `app.js` reference to the new ID
- Element exists with the same ID but different DOM children → update the handler to walk the new structure
- Element no longer exists → delete the handler block (per spec, no dead code)

For each fix, edit `app.js` directly. Save as you go.

- [ ] **Step 3: Verify tab switching works**

Click "Telemetry" tab in the topbar. The launcher view should hide and the telemetry view should show. The Telemetry tab should highlight with the orange underline. Click "Launcher" — reverse.

If broken: check `app.js` line ~931 (`switchView`) and line ~1075 (where `.tab` click handlers bind). The new design's tab buttons use `data-view="launcher"` and `data-view="telemetry"` — confirm `app.js` reads `t.dataset.view`.

- [ ] **Step 4: Verify track select populates from live LMU data**

With LMU running and on the main menu, the Track dropdown should populate (Bahrain, Monza, Spa, etc.) within ~2 seconds of app start. Layout dropdown should populate based on selected track.

If broken: the design's track-select script (lines 2904–2992 in design HTML) uses hardcoded `TRACK_LAYOUTS`. Current `app.js` does NOT rely on that — it has `populateTracks()` (line 120) and `populateLayoutSelect()` (line 156). Verify the design's hardcoded script is NOT loaded (we didn't copy it; only `app.js` is sourced from index.html).

- [ ] **Step 5: Verify class chips work**

In the Car panel, four class chips should appear (Hypercar, LMP2, LMGT3, GTE). Clicking one filters the car/livery dropdowns. The active chip has the orange accent.

If broken: current `app.js` has `populateClassChips()` (line 320). Inspect the new design's `.class-chip` button structure (around line 2169 of design HTML) and verify selectors in `populateClassChips` still match (e.g. it queries `.class-chip` and reads `data-class`).

- [ ] **Step 6: Verify weather pills work**

Three pills: Dry, Wet, Custom. Clicking one selects the preset and the right-hand details panel updates (locked stats for Dry/Wet, sliders for Custom). The active pill has an outline.

If broken: this is the most likely structural change — the OLD design had cards, the NEW design has pills. Current `app.js` has `selectPreset()` (line 434). The new design's HTML uses `data-preset="dry"` etc. on pill buttons. Make sure click handlers query the new selectors.

- [ ] **Step 7: Verify session sliders update labels**

Practice length slider should show "X min". Start time should show "HH:MM". Time scale should show "Normal" or "×N". RealRoad scale should show "N×". Limit points should show "N".

If broken: current `app.js` has `bindRange()` (line 499) and `bindCustomRange()` (line 513). Verify the IDs match between `app.js` and the design.

- [ ] **Step 8: Verify the Launch button works**

Click "Launch practice in LMU". Expected: button shows progress; LMU loads into the garage with the configured session.

If broken: current `app.js` has `onLaunch()` (line 546). The new launch button is `<button id="launchBtn" class="launch-btn">`. Check the click binding survived.

- [ ] **Step 9: Verify the Log toggle works**

Below the launch button, "Log" toggle button. Clicking it should reveal/hide the log area. The log streams text from `window.go.onLog`.

If broken: design's log toggle script is at lines 3041–3047. Current `app.js` may have its own — search for `logToggle`. Pick one source of truth.

- [ ] **Step 10: Verify install pill and the Change button**

Topbar install pill shows the LMU path. Hovering it shows full path in tooltip. Clicking the Change button (now `#installPillChange`) opens a folder picker via `pickInstallPath`.

If broken: current `app.js` has `pickInstallPath()` (line 234). Find where it binds — make sure the binding target is `#installPillChange` (newly added in Task 1 Step 7).

- [ ] **Step 11: Verify LMU status pill updates**

Topbar `#lmuStatusPill` shows "LMU running · main menu" or similar when LMU is alive. Switches to "LMU offline" when not.

If broken: current `app.js` has `setStatus()` (line 58) and `pollStatus()` (line 591). Confirm IDs match.

- [ ] **Step 12: Commit**

```bash
cd "C:/Users/andre/Desktop/LMU-Automatic weather/.worktrees/duckdb-motec"
git add app/src/renderer/app.js
git commit -m "feat(ui): wire v2 launcher view to existing IPC"
```

---

## Task 4: Wire the Telemetry view

**Files:**
- Modify: `app/src/renderer/app.js`

**Goal:** Telemetry view is fully functional: dropzone, file picker, watcher card, sessions grid (with per-row actions), first-run card, tab badge count, active conversion progress.

- [ ] **Step 1: Switch to Telemetry tab and capture console errors**

Click Telemetry tab. Open DevTools console. Note any null-reference errors from telemetry-view bindings.

- [ ] **Step 2: Verify the dropzone accepts a `.duckdb` file**

Drag a `.duckdb` file onto the dropzone area (`#tlmDrop`). Expected: file is queued, conversion starts, progress shows in the active-conversion panel.

If broken: current `app.js` should have a dragover/drop handler bound to `#tlmDrop`. Search `app.js` for `tlmDrop` and verify both `dragover` and `drop` are wired. The new design's dropzone class is `.dropzone`.

- [ ] **Step 3: Verify the "Pick file" button opens a file picker**

Click `#tlmPickFile`. Expected: native file dialog opens, filtered to `.duckdb`. Selecting one starts conversion.

If broken: search `app.js` for `tlmPickFile`. Wire to `window.go.pickFile({ filters: [{ name: 'DuckDB', extensions: ['duckdb'] }] })` then to `convertRun`.

- [ ] **Step 4: Verify the watcher card toggles**

The big `#watcherToggle` card (top of telemetry view). Clicking should:
- Toggle the watcher on/off via `window.go.startWatch` / `window.go.stopWatch`
- Update `#watcherStateText` to "ON" or "OFF"
- Show/hide the `#watcherStatusPill` in the topbar

If broken: search `app.js` for `watcherToggle`. The new design uses one big card; old may have used a switch.

- [ ] **Step 5: Verify "Configure" inside the watcher card opens settings drawer**

Click `#wcConfigure` button (right side of the watcher card). Expected: settings drawer opens, scrolled to the auto-watch section.

If broken: current `app.js` already has settings drawer logic (line 950+). Make sure `wcConfigure` click binds to drawer-open with section `"auto"` (the drawer section IDs in the new design are: `auto`, `motec`, `retention`, `defaults`, `about`).

- [ ] **Step 6: Verify the sessions grid renders past conversions**

The `#sessionsGrid` should render any past conversions stored by current app.js. The design has sample data hardcoded (`TLM_SESSIONS` at line 3074); we did NOT copy that script, so nothing should render from the design's mock.

The current `app.js` has its own session-rendering (search for `sessionsGrid`). Each row should show: track, car, driver, lap count, file size, conversion timestamp.

If empty when it shouldn't be: check that current `app.js` reads from its persisted store and re-renders into `#sessionsGrid` on app start.

- [ ] **Step 7: Verify per-row actions work**

For one session row, click each action button:
- Open in MoTeC (calls `window.go.motecOpen(ldPath)`)
- Reveal in Folder (calls `window.go.revealInFolder(ldPath)`)
- Delete (calls `window.go.deleteConversion(ldPath)`, removes the row)

If broken: search `app.js` for the action class names or icons; rebind to whatever the new design's row template uses.

- [ ] **Step 8: Verify the first-run card behavior**

If `firstRunDismissed` setting is false AND no watcher folder is configured, `#firstRunCard` should be visible at app start. Clicking `#firstRunCta` opens the settings drawer to the watcher section. Clicking `#firstRunDismiss` hides the card and persists the dismissed flag.

Test by setting `firstRunDismissed=false` via DevTools (`await window.go.setSetting('firstRunDismissed', false)`), then reloading.

If broken: current `app.js` has this at lines 1111–1114 — confirm element IDs match.

- [ ] **Step 9: Verify the tab badge increments**

Drop a `.duckdb` and let it convert. The `#tabBadgeTlm` count next to the Telemetry tab label should reflect the number of sessions. Switch to the Launcher tab — the badge stays visible.

If broken: search `app.js` line 1436 (`tabBadgeTlm`); verify the count source.

- [ ] **Step 10: Verify the active-conversion progress bar**

During a conversion, the `#activeConv` panel should show the file name, the stage (`#activeStage`), and the progress bar (`#activeFill`, `#activePct`). After completion, the panel hides and the row appears in the sessions grid.

If broken: search `app.js` lines 1306, 1313–1315 — confirm IDs match.

- [ ] **Step 11: Commit**

```bash
cd "C:/Users/andre/Desktop/LMU-Automatic weather/.worktrees/duckdb-motec"
git add app/src/renderer/app.js
git commit -m "feat(ui): wire v2 telemetry view to existing IPC"
```

---

## Task 5: Wire the Settings drawer

**Files:**
- Modify: `app/src/renderer/app.js`

**Goal:** Settings drawer (right-side slide-out) opens, navigates between sections, persists every setting via `window.go.setSetting`, restores on app start via `window.go.getSetting`.

- [ ] **Step 1: Open the settings drawer**

Click the gear icon (`#settingsBtn`) in the topbar. The drawer slides in from the right, the backdrop covers the rest of the UI. Click the backdrop or X (`#drawerClose`) — drawer closes.

If broken: current `app.js` lines 950+ have the drawer logic. Confirm `settingsDrawer`, `drawerBackdrop`, `drawerClose` IDs all exist in the new index.html (they do per the design source).

- [ ] **Step 2: Navigate between drawer sections**

Click each section button in the drawer's left nav (`#drawerNav button[data-sec]`). The right-side content scrolls or swaps to that section. The active button has the orange accent.

If broken: current `app.js` line 952 already does this. Verify the new design's `.drawer-section[data-sec]` elements exist.

- [ ] **Step 3: Verify install-path settings**

In the drawer's Install section: changing the path picker calls `pickInstallPath`. The reset button calls `resetInstallPath`. Both reflect immediately in the topbar `#installPill`.

If broken: search `app.js` for the install settings section bindings.

- [ ] **Step 4: Verify the auto-watch section**

Toggle "Enable folder watch" — should call `startWatch` or `stopWatch`. Picking a watch folder should call `window.go.pickFolder` and persist it via `setSetting('watcherDir', value)`. Picking an output folder same with `setSetting('outputDir', value)`.

If broken: walk the section's elements and bind each to the right `setSetting` key. Reload the app and confirm values persist.

- [ ] **Step 5: Verify the output-naming section**

The `#setNaming` text input shows a template. The token chips below (`.token-chip[data-tok]`) insert tokens at the cursor when clicked. The preview line (`#setNamingPreview`) updates live to show the resolved sample filename.

The design's token script is at lines 3781–3803. Current `app.js` may NOT have this — if the section is functionally inert, copy lines 3781–3803 from the design verbatim into `app.js` (as a function called from drawer-init), then bind the resulting `setNaming` value to `setSetting('outputNamingTemplate', value)` on change.

- [ ] **Step 6: Verify all switches and segmented controls**

Every `.s-switch` toggle and every `.s-seg` segmented control in the drawer. Clicking should toggle visual state AND call `setSetting('<id>', value)`.

The design's generic toggle handlers are at lines 3751–3767. Current `app.js` may already do this — search for `s-switch`. If not, copy lines 3751–3767 into `app.js` then add a `setSetting` call inside each handler.

- [ ] **Step 7: Verify the saved-toast appears**

When any setting changes, a small "Saved" toast (`#savedToast`) flashes for ~1 second. The design's toast logic is at lines 3727–3731 (`flashSaved()`).

Add a call to `flashSaved()` in every setting-change handler (or a single delegated handler at the drawer root).

- [ ] **Step 8: Restart the app and verify all settings persist**

Close the app entirely. Relaunch. Every setting changed in this task should restore to the value you set, not the default.

- [ ] **Step 9: Commit**

```bash
cd "C:/Users/andre/Desktop/LMU-Automatic weather/.worktrees/duckdb-motec"
git add app/src/renderer/app.js
git commit -m "feat(ui): wire v2 settings drawer to settings store"
```

---

## Task 6: Final smoke test and dead-code cleanup

**Files:**
- Modify: `app/src/renderer/app.js` (delete unused functions found during sweep)

**Goal:** Every IPC method documented in the spec works end-to-end. No console errors on app start or during any flow. No dead code from the old design.

- [ ] **Step 1: Restart the app fresh, observe console on load**

```bash
cd "C:/Users/andre/Desktop/LMU-Automatic weather/.worktrees/duckdb-motec/app" && npm start
```

DevTools open from start (F12). Reload. Console should be clean — no errors, no warnings about missing elements. If anything appears, fix the binding.

- [ ] **Step 2: Walk every IPC method end-to-end**

For each method in `app/src/main/preload.js` (`scanInstall`, `pickInstallPath`, `resetInstallPath`, `isLmuAlive`, `isGoFastAlive`, `fetchLiveTracks`, `fetchLiveCars`, `launch`, `onLog`, `convertRun`, `startWatch`, `stopWatch`, `onConvertLog`, `pickFolder`, `pickFile`, `motecOpen`, `revealInFolder`, `deleteConversion`, `getSetting`, `setSetting`), trigger the user action that calls it. Confirm visible UI feedback.

- [ ] **Step 3: Sweep `app.js` for orphaned functions**

```bash
grep -nE "^function |^const \w+ ?= ?\(|^async function" "C:/Users/andre/Desktop/LMU-Automatic weather/.worktrees/duckdb-motec/app/src/renderer/app.js"
```

For each defined function, search the file (and `index.html` for inline handlers) for callers. Any function with zero callers is dead — delete it.

- [ ] **Step 4: Sweep `app.js` for orphaned `getElementById` calls**

```bash
grep -nE "\\\$\('|getElementById\('" "C:/Users/andre/Desktop/LMU-Automatic weather/.worktrees/duckdb-motec/app/src/renderer/app.js"
```

For each ID looked up, confirm the element exists in `app/src/renderer/index.html` (`grep -n 'id="<name>"' app/src/renderer/index.html`). Any ID with no matching element means the lookup is dead — delete the surrounding handler block (per spec, no dead code).

- [ ] **Step 5: Final smoke test — full happy path**

In one session:
1. Launch the app fresh.
2. With LMU running on the main menu, see install pill, status pill, populated tracks/cars.
3. Pick a track, layout, car, livery, weather preset, session settings.
4. Press Launch — LMU enters garage with the configured session.
5. Switch to Telemetry tab, drop a `.duckdb`, watch it convert, click "Open in MoTeC" on the resulting row.
6. Open settings, change a value, see the Saved toast.
7. Close the app, reopen — all settings persisted.
8. No console errors at any step.

- [ ] **Step 6: Commit**

```bash
cd "C:/Users/andre/Desktop/LMU-Automatic weather/.worktrees/duckdb-motec"
git add app/src/renderer/app.js
git commit -m "chore(ui): remove dead handlers after v2 redesign"
```

---

## Done

Every spec requirement is now implemented across the six commits above. The renderer is the v2 design with full behavioral parity to the previous implementation. Hand off to manual driver testing.
