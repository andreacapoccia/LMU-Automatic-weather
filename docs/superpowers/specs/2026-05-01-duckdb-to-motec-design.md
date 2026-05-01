# DuckDB → MoTeC Converter — Design Spec
**Date:** 2026-05-01  
**Status:** Approved

---

## Goal

Convert LMU's native DuckDB telemetry files into MoTeC i2-compatible `.ld` + `.ldx` files, with correct lap division and full channel data. Runs as a standalone Node.js package spawned by the GO LMU Launcher Electron app — no Python dependency.

---

## Architecture

```
DuckDBtoMoTeC/
  converter/
    convert.js          ← one-shot CLI: node convert.js <input.duckdb> <outdir>
    watcher.js          ← persistent process: watches folder, auto-converts new files
    lib/
      duckdb-reader.js  ← reads DuckDB tables, reconstructs timestamps
      ld-writer.js      ← writes binary .ld file
      ldx-writer.js     ← writes .ldx XML file
      channel-map.js    ← maps DuckDB channel names → MoTeC names, units, scale factors
    package.json        ← deps: duckdb, chokidar

app/src/main/main.js    ← new IPC handlers: convert:run, convert:startWatch, convert:stopWatch
```

The Electron app spawns `node convert.js` for manual conversion and `node watcher.js <folder>` for watch mode. Progress is streamed via stdout → IPC → renderer. The converter package works standalone from the terminal too.

---

## Conversion Algorithm

### Step 1 — Read session anchors
- `channelsList` table → frequency (Hz) + unit per channel
- `GPS Time` table (100 Hz) → `session_start = first row value` (absolute LMU clock reference, e.g. 668.985 s)
- `Lap` table (event-driven) → array of `{ ts, lap_number }` = lap boundary timestamps

### Step 2 — Reconstruct timestamps per channel

All times in the .ld file are relative to session start (t=0 at first sample).

**Time-series channels** (no `ts` column — logged at fixed rate):
```
t[i] = i / frequency
```

**Event-driven channels** (`ts` column — logged on state change):
```
t[i] = ts[i] - session_start
```

**Multi-wheel channels** (`value1`–`value4`): expand into four separate channels using suffix FL/FR/RL/RR.

### Step 3 — Synthetic Beacon channel
A `Beacon` channel at 100 Hz (int16) holds value `32` at each lap-start sample, `0` elsewhere. MoTeC i2 reads this to draw lap dividers.

### Step 4 — Write .ld (binary)
One file containing the full session. Format:
- Fixed-size file header (magic, version, session metadata, channel count)
- Linked list of channel headers: name, unit, frequency, sample count, data block offset
- Data blocks: raw float32 per sample (int16 for Beacon)

### Step 5 — Write .ldx (XML)
Plain XML file (same name as .ld, different extension). Contains:
- Session info: driver, track, car, date/time, class
- `<Laps>` block: one entry per lap with start time and duration calculated from the `Lap` table

---

## Channel Map

| MoTeC Channel | DuckDB Table | Notes |
|---|---|---|
| Engine RPM | `Engine RPM` | rpm |
| Throttle Pos | `Throttle Pos` | % |
| Brake Pos | `Brake Pos` | % |
| Gear | `Gear` | event-driven |
| Ground Speed | `Speed` | km/h |
| G Force Lat | `Accel X` | G |
| G Force Long | `Accel Y` | G |
| G Force Vert | `Accel Z` | G |
| Susp Pos FL/FR/RL/RR | `Susp Pos` (value1–4) | mm |
| Damper Vel FL/FR/RL/RR | `Susp Vel` (value1–4) | mm/s |
| Brake Temp FL/FR/RL/RR | `Brake Temp` (value1–4) | °C |
| Tyre Temp FL/FR/RL/RR | `Tire Temp` (value1–4) | °C |
| Tyre Pressure FL/FR/RL/RR | `Tire Pres` (value1–4) | kPa |
| Fuel Level | `Fuel Level` | l |
| Water Temp | `Water Temp` | °C |
| Oil Temp | `Oil Temp` | °C |
| TC | `TC` | event-driven |
| ABS | `ABS` | event-driven |
| In Pits | `In Pits` | event-driven |
| GPS Lat | `GPS Lat` | deg |
| GPS Lon | `GPS Lon` | deg |
| Beacon | synthetic | 32 at lap start, 0 elsewhere |

---

## Triggering Modes

**Manual (user picks a file):**
- Electron renderer sends `convert:run` IPC with `{ inputPath, outputDir }`
- Main process spawns `node convert.js <input> <outdir>`
- Progress lines streamed back as `convert:log`

**Automatic (folder watch):**
- User configures a watch folder (LMU's telemetry output directory)
- Main process spawns `node watcher.js <folder> <outdir>` on startup
- Watcher uses `chokidar` to detect new `.duckdb` files, triggers conversion automatically
- Start/stop via `convert:startWatch` / `convert:stopWatch` IPC
- Main process kills watcher child on app exit

---

## Output Location

Output `.ld` + `.ldx` files are written to the same folder as the input `.duckdb` file by default, with the same base name. The output directory is configurable.

---

## Error Handling

- If a DuckDB table is missing or empty, the channel is skipped silently (not a fatal error)
- If the `Lap` table has no rows, the entire session is written as a single lap
- Conversion errors are written to stderr and surfaced in the renderer as an error log line
- The watcher ignores files still being written (waits for file size to stabilize before converting)

---

## Out of Scope

- UI panel design (user will build the UI themselves)
- Real-time telemetry streaming (converter works on completed session files only)
- Car setup parameters in .ldx (skipped for now, can be added later from `metadata.CarSetup`)
