# Design hand-off — Defaults card (Card 04)

A single panel added in v3.0.5 to restore weekend-wide rules controls that were missing in v3.0.4. This brief is for a design agent that will polish just this card. Pair with `docs/design-handoff.md` for the broader app context (colors, typography, JS rules).

## Where it lives

Between Card 03 (Sessions) and Card 05 (Launch summary) on the Launcher tab. Same `.panel` styling as the other cards. Inside the `<main class="cards">` container.

## What it does

Six controls that apply to the **whole race weekend** (not per-session — LMU writes them once at the global Race Conditions level). The user sets them once and they govern Practice + Qualifying + Race together.

The card is grouped into 3 visual sections (currently using the existing `.session-group` pattern):

```
┌─ 04 — Defaults ─────────────────────────────────────┐
│  Rules & tyres                                      │
│                                                     │
│  TIMING                                             │
│  ─────                                              │
│  Time scale     [────●──] Normal                    │
│                                                     │
│  RULES                                              │
│  ─────                                              │
│  Flag rules         [Full w/o DQ ▾]                 │
│  Track limits       [Default ▾]                     │
│  Incident points    [────●─────] 5                  │
│  Mechanical fails   [Normal ▾]                      │
│                                                     │
│  TYRES                                              │
│  ─────                                              │
│  Tyre warmers       [● ON]                          │
│                                                     │
└─────────────────────────────────────────────────────┘
```

## Current implementation (the baseline)

Everything below already exists in `app/src/renderer/index.html` (lines ~336-396). The design agent edits this markup + the matching CSS. JS bindings already exist and work.

```html
<!-- DEFAULTS / RULES -->
<section class="panel panel-defaults">
  <div class="panel-header">
    <div>
      <div class="panel-eyebrow"><span class="num">04</span> Defaults</div>
      <h2 class="panel-title">Rules &amp; tyres</h2>
    </div>
  </div>

  <div class="session-body">
    <div class="session-group">
      <div class="session-group-title">Timing</div>
      <label class="field">
        <span class="field-label">Time scale <em id="timeScaleVal">Normal</em></span>
        <input id="timeScale" type="range" min="0" max="2" step="1" value="1" />
      </label>
    </div>

    <div class="session-group">
      <div class="session-group-title">Rules</div>
      <label class="field">
        <span class="field-label">Flag rules</span>
        <select id="flagRules" class="select">
          <option value="3">Full w/o DQ</option>
          <option value="2">Penalties &amp; FCY</option>
          <option value="1">Penalties only</option>
          <option value="0">None</option>
        </select>
      </label>
      <label class="field">
        <span class="field-label">Track limits</span>
        <select id="trackLimitsRules" class="select">
          <option value="1">Default</option>
          <option value="2">Strict</option>
          <option value="3">Relaxed</option>
          <option value="0">None</option>
        </select>
      </label>
      <label class="field">
        <span class="field-label">Incident points <em id="trackLimitsPointsVal">5</em></span>
        <input id="trackLimitsPoints" type="range" min="0" max="63" step="1" value="5" />
      </label>
      <label class="field">
        <span class="field-label">Mechanical failures</span>
        <select id="mechanicalFailures" class="select">
          <option value="1">Normal</option>
          <option value="0">Off</option>
          <option value="2">Time scaled</option>
        </select>
      </label>
    </div>

    <div class="session-group">
      <div class="session-group-title">Tyres</div>
      <label class="field-toggle">
        <span class="field-label">Tyre warmers</span>
        <input id="tireWarmers" type="checkbox" checked />
      </label>
    </div>
  </div>
</section>
```

## What each control does (for the designer's mental model)

| Control | What it does | Default | Range / options |
|---|---|---|---|
| **Time scale** | How fast in-game time passes vs real time. `0`=None (paused), `1`=Normal (real time), `2`=×2 (twice as fast) | `1` Normal | 0..2 |
| **Flag rules** | How strict the AI/race director is on penalties. `3`=full FIA-style without disqualifications, descending to `0`=no enforcement | `3` Full w/o DQ | 4 options |
| **Track limits** | Whether off-track laps are policed. `1`=default sim setting, `2`=strict (warnings → black flag), `3`=relaxed, `0`=none | `1` Default | 4 options |
| **Incident points** | How many infractions allowed before a penalty kicks in (only meaningful when Track limits ≠ None) | `5` | 0..63, integer |
| **Mechanical failures** | Whether the car can break (engine, suspension, etc.) | `1` Normal | 3 options |
| **Tyre warmers** | Tyres start at operating temperature when leaving pits | `ON` | bool |

## Hard constraints (don't break)

These are JS bindings — the renderer's `app.js` reads from these IDs and `<option value=>` integers:

- Element IDs: `timeScale`, `timeScaleVal`, `flagRules`, `trackLimitsRules`, `trackLimitsPoints`, `trackLimitsPointsVal`, `mechanicalFailures`, `tireWarmers` — keep verbatim.
- `<option value=>` strings on the 3 selects — these are sent to LMU as integers (`Number()` coerced). Don't change them. The display text is yours.
- Slider attrs (`min`/`max`/`step`/`value`) — keep them; users expect the same value ranges.
- The `<em>` tags inside slider field labels (with IDs `…Val`) — JS writes formatted text into them as the slider moves. Keep them.

What you CAN change freely:
- Group titles ("Timing" / "Rules" / "Tyres")
- Section header eyebrow + title text
- Layout (single column, two columns, accordion, etc.)
- Visual treatment (cards within cards, dividers, icons next to options, etc.)
- Sliders → number-spinner inputs if you prefer (as long as the `id` and `min`/`max` stay)

## Visual notes / suggestions

- The Sessions card above this one uses dashed-border sub-cards for each session. The Defaults card currently mirrors that with `.session-group` dividers. Consider whether keeping that visual rhyme helps cohesion or whether Defaults should look distinct (since it's not session-based).
- "Incident points" only really matters when Track limits ≠ None. The current design doesn't reflect that conditional relationship — could be greyed out or hidden when Track limits = None (designer's call; if implemented, ping the dev to add the JS guard).
- Tyre warmers as a single toggle in its own group looks lonely. Consider folding it into the Rules group, or pairing with another tyre setting (we don't currently have one).
- The 3 selects use the default browser dropdown (`.select` class). Could become custom-styled dropdowns if Sessions card gets the same treatment.

## Existing design tokens to reuse

```css
--bg: #0a0a0a;
--panel: #141414;       /* the .panel background */
--panel-2: #1c1c1c;     /* nested surfaces */
--line: #262626;        /* borders */
--text: #f4f4f4;
--text-dim: #9a9a9a;    /* labels, hints */
--accent: #ff3b1f;      /* GO Setups red */
--accent-2: #ff5a40;
--green: #2bd66a;       /* "ON" / positive */
```

## Out of scope

- Adding more rules controls (DRS, fuel multiplier, etc.) — not in v3.0.5
- Per-session rules (those would need a state-model refactor)
- Conditional disabling logic (e.g. greying Incident points when Track limits=None) — flag if you want it, dev adds the JS

## How to test changes

Edit the HTML/CSS directly. Open `app/dist/GO LMU Launcher-win32-x64\GO LMU Launcher.exe`, then **Ctrl+R inside the running app** to hot-reload the renderer. No rebuild needed for HTML/CSS-only changes.
