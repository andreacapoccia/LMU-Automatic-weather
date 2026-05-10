# Design hand-off — GO LMU Launcher v3.0.4

A designer (or design-focused Claude agent) can polish the UI by editing the files in this doc. The app is a vanilla-JS Electron renderer — there's no build step for HTML/CSS, so changes show up as soon as the .exe reloads.

## Files to edit

All paths relative to repo root `C:\Users\andre\Desktop\LMU-Automatic weather\` (or the worktree at `.worktrees\duckdb-motec\` if work is happening on the feature branch).

| File | Lines | What it is |
|------|------:|------------|
| `app/src/renderer/index.html` | 819 | The whole UI markup. Two top-level tabs: Launcher (default) and Telemetry. Drawer-style Settings panel slides in from the right. |
| `app/src/renderer/styles.css` | 2278 | All styling. CSS custom-properties at the top define the design system (colors, typography). |
| `app/src/renderer/app.js` | ~960 | DO NOT REDESIGN — JS-only behavior. But you'll need to read it to understand which IDs and `data-*` attributes it depends on. |

There's an existing `app/design-playground.html` (single-file design sandbox) used for early v2 design work — outdated but shows the colour palette and component vocabulary the launcher uses.

## What's new and needs polish (Bucket B/C/D, just shipped in v3.0.4)

The big new addition is the **Sessions panel** (replaces the old Card 03 Weather Preset and Card 04 Practice settings). It contains 3 collapsible sub-cards stacked vertically:

```
┌─ Sessions ─────────────────────────────────────────────┐
│                                                        │
│ ┌─ Practice ──────────────────────  [Enabled ●] ──┐   │
│ │ Weather:   [Dry] [Wet] [Custom]                  │   │
│ │  ↳ 5-slot grid appears when Custom selected      │   │
│ │ Length:    ─────●────── 6h 0m                    │   │
│ │ Start:     ──●────────  12:00                    │   │
│ │ Privacy:   [● Private]                           │   │
│ │ Grip:      [Saturated ▾]                         │   │
│ │ RealRoad:  ────●──     0× scale                  │   │
│ └──────────────────────────────────────────────────┘   │
│                                                        │
│ ┌─ Qualifying ────────────────────  [Disabled ○] ─┐   │
│ │ (collapsed when disabled)                        │   │
│ └──────────────────────────────────────────────────┘   │
│                                                        │
│ ┌─ Race ──────────────────────────  [Disabled ○] ─┐   │
│ │ ... + Start type: [Rolling ▾]                    │   │
│ └──────────────────────────────────────────────────┘   │
│                                                        │
└────────────────────────────────────────────────────────┘
```

The Custom 5-slot grid (visible when Custom is selected) is `repeat(5, 1fr)` cells, each with a sky `<select>` + rain% number input + temp °C number input. Save/Load preset buttons sit at the bottom.

**These are the areas that need design love** — they were built functional-first, follow existing patterns, but haven't been polished:

1. The **session sub-cards** — currently functional but the visual hierarchy could be stronger (right now everything is roughly the same weight).
2. The **5-slot weather grid** — looks like a basic 5-column form. LMU's own UI presents it more visually (sky icons rather than text in a select?).
3. The **enable toggle** on each session card — currently a small switch top-right; might benefit from being more prominent so users see at-a-glance what's active.
4. The **disabled state** of session cards — currently just collapses the body; the header stays the same. Could fade or visually demote.
5. The **Wet preset's `Sky` value 8 enum** — this is a string-based dropdown (Clear, Light clouds, Partially cloudy, …). Could use weather icons next to each option.

## Hard constraints (don't break)

These are the JS bindings — if you rename them, the UI silently stops responding to user input.

- **IDs:** Keep `aboutVersion`, `aboutUpdated`, `openLogsFolder`, `resetSettings`, `sessPractice_enabled`, `sessQualifying_enabled`, `sessRace_enabled`. Same for everything currently with `id=`.
- **`data-input` attributes** on the per-session controls — format is `<sessionKey>_<fieldKey>`, e.g. `data-input="practice_length"`. The renderer reads these to write to `state.overrides.sessions[sessionKey][fieldKey]`. If you rename, the binding breaks.
- **`data-out` attributes** on the value labels (e.g. `data-out="practice_length"`) — used to update the displayed value.
- **`data-session`, `data-preset`, `data-action`, `data-custom-for`** — used by the JS to identify which session a click targets.
- **`<option value="...">`** values on dropdowns — these are sent to LMU verbatim (e.g. `value="preset:SATURATED.RRBIN"`). Don't change them. The display text inside the option is yours to change.
- **CSS classes the JS toggles**: `.active` (preset pills), `.hidden` (custom-weather panel), `data-enabled` attribute on `.session-card`. If you change these, fix the JS too — but it's safer to leave them.

Soft constraint: there are TWO `.s-switch`-family classes — `.s-switch` (Bucket A's watcher card toggle, div-with-`::after`) and `.sess-switch` (Sessions card per-session enable toggle, label-wrapping-checkbox). They look similar but are structured differently and shouldn't be merged in this iteration.

## Design system (already in place)

Picked from `styles.css` — feel free to extend, but try to use existing tokens where they fit.

```css
:root {
    --bg: #0a0a0a;          /* page background */
    --panel: #141414;       /* card background (panels) */
    --panel-2: #1c1c1c;     /* nested surfaces (e.g. session sub-cards) */
    --line: #262626;        /* default borders */
    --text: #f4f4f4;        /* primary text */
    --text-dim: #9a9a9a;    /* secondary text, hints */
    --accent: #ff3b1f;      /* GO Setups red — use sparingly */
    --accent-2: #ff5a40;    /* hover/active variants */
    --accent-shadow: rgba(255, 59, 31, 0.35);
    --green: #2bd66a;       /* "alive"/positive states (LMU running, watcher on) */
    --red: #ff3b1f;         /* errors, destructive actions */
}
```

Typography: `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, …` for everything. JetBrains Mono for code/file paths. Body is 14px.

Radii: cards use 8px, inputs use 6px, buttons use 6px.

## What to test changes against

1. **The current build** is at `app/dist/GO LMU Launcher-win32-x64\GO LMU Launcher.exe`. Open it, make changes to the source `index.html` / `styles.css`, then **Ctrl+R inside the running app** to hot-reload the renderer.
2. **All 4 cards on the Launcher tab** matter — Track, Car, Sessions, Launch summary. Don't break the others while polishing Sessions.
3. **The Telemetry tab** has its own structure (`.panel-sessions` is used there for the converted-sessions list — note this conflicts namespace-wise with our new Sessions panel which uses `.panel-sessions-config` to avoid collision). Keep the Telemetry tab visually consistent.
4. **Settings drawer** (gear icon top-right) has its own card-like sections — About & logs, Auto-converter, MoTeC i2 paths. Keep the drawer styling cohesive.

## What NOT to add (out of scope)

- Per-session rules group (flag rules, track limits, mechanical failures) — deliberately removed in v3.0.4. Defaults come from the main process. A future bucket may re-add it.
- AI grid configuration / multiplayer — solo only.
- Actual icons/images (the 11 sky options are text strings today). If you want icons, propose specific SVGs and we'll add them as separate assets.

## Hand-off summary

If you're handing this to a designer: **the spec they should target is the **`docs/superpowers/specs/2026-05-10-bucket-b-launcher-features.md`** in this branch.** The plan we executed is `docs/superpowers/plans/2026-05-10-bucket-b-launcher-features.md`. Both describe the data model, the constraints, and the user-facing behavior. The HTML they receive (this v3.0.4 build) is the working baseline — they polish, return revised HTML/CSS, we port back into `index.html` + `styles.css`.

For an external Claude design agent: it can edit `index.html` + `styles.css` directly in the worktree and we'll review their work the same way we reviewed implementer subagents (spec-compliance pass, then code-quality pass).
