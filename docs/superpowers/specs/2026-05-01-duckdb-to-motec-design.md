# DuckDB → MoTeC Converter — Design Spec
**Date:** 2026-05-01  
**Status:** Approved (post-review)

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

### Step 1 — Read session catalogues
- `channelsList` table → fixed-rate channels: `(channelName, frequency, unit)`. Contains ~56 rows.
- `eventsList` table → event-driven channels: `(channelName, unit)`. Contains ~42 rows. No frequency column — these are logged on state change, not at a fixed rate.
- `GPS Time` table (100 Hz, fixed-rate) → `session_start = value of first row`. This is the absolute LMU clock anchor (e.g. 668.985 s). Note: `GPS Time` is a fixed-rate channel, so its `value` column contains the actual clock reading — do NOT compute it from row index.
- `Lap` table (event-driven) → array of `{ ts, value }` sorted by ts = lap boundary timestamps. Lap numbers start from wherever the session counter was (e.g. lap 6 in a qualifying segment) — normalize to 1-indexed for the output file.
- `metadata` table → `DriverName`, `TrackName`, `CarName`, `CarClass`, recording date/time — used to populate the `.ld` binary header.

### Step 2 — Reconstruct timestamps per channel

All times in the `.ld` file are relative to session start (t=0 at first sample).

**Fixed-rate channels** (in `channelsList`, no `ts` column):
```
t[i] = i / frequency
```

**Event-driven channels** (in `eventsList`, has `ts` column):
```
t[i] = ts[i] - session_start
```
Event-driven channels have sparse samples (e.g. Gear has ~325 rows over a 464-second session). For the `.ld` file, expand event-driven channels to a step-hold interpolation at the frequency of the nearest fixed-rate equivalent (10 Hz), holding the last value until the next event. This ensures MoTeC sees a continuous channel spanning the full session.

**Multi-wheel channels** (`value1`–`value4`, either type): expand into four separate channels with suffix `FL`, `FR`, `RL`, `RR`.

**Multi-wheel + multi-zone** (`TyresTempCentre`, `TyresTempLeft`, `TyresTempRight` — each has value1–4): expand to 12 channels: `Tyre Temp FL/FR/RL/RR` × Inner/Mid/Outer.

### Step 3 — Synthetic Beacon channel
A `Beacon` channel at 100 Hz (int16) holds value `32` at each lap-start sample (rounded to nearest sample index from the `Lap` ts), `0` elsewhere. The value `32` is the standard MoTeC community convention; if laps do not appear in i2, try `1` or `100`.

**Last lap duration**: since the `Lap` table only records lap starts, the final lap's duration is calculated as `(total_fixed_rate_samples / max_frequency) - (last_lap_ts - session_start)`.

### Step 4 — Write .ld (binary)

The binary `.ld` file carries **all session metadata** (driver, track, car, date, time) in a fixed-size header. The `.ldx` does NOT carry this — it is a setup overlay only. Structure:

- **File header** (~1024 bytes): magic `0x40`, version, channel count, offsets, and metadata strings (driver name, venue name, vehicle id, engine id, date `DD/MM/YYYY`, time `HH:MM:SS`, short comment, event name, session name)
- **Channel headers**: linked list (each ~548 bytes), fields: prev/next pointers, data start offset, data length, channel name (32 chars), short name (8 chars), unit (12 chars), frequency, sample count, datatype (float32=0x07 or int16=0x05)
- **Data blocks**: raw float32 per sample for data channels, raw int16 for Beacon

Binary format reference: the community-documented MoTeC `.ld` format used by `python-motec` and similar reverse-engineering projects (offsets derived from known working reference files).

### Step 5 — Write .ldx (XML)

The `.ldx` is a supplemental overlay read by i2 alongside the `.ld`. It stores lap summary stats and setup parameters — NOT session metadata (that is in the `.ld` header). Structure matches the reference `GO4 296 LMGT3 MONcg E Q03 MOTEC.ldx`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<LDXFile RRReplayFile="..." RRPlugin="..." ...>
  <Layers>
    <Details>
      <String Id="Total Laps" Value="N"/>
      <String Id="Fastest Time" Value="M:SS.mmm"/>
      <String Id="Fastest Lap" Value="K"/>
      <!-- car setup Numeric/String elements from metadata.CarSetup (future) -->
    </Details>
  </Layers>
</LDXFile>
```

---

## Channel Map

Exact DuckDB table names (case-sensitive) and confirmed units from `channelsList`:

| MoTeC Channel | DuckDB Table | DuckDB Unit | Conversion |
|---|---|---|---|
| Engine RPM | `Engine RPM` | rpm | ×1 |
| Throttle Pos | `Throttle Pos` | % | ×1 |
| Brake Pos | `Brake Pos` | % | ×1 |
| Gear | `Gear` | — | event-driven |
| Ground Speed | `Ground Speed` | km/h | ×1 |
| G Force Lat | `G Force Lat` | g | ×1 |
| G Force Long | `G Force Long` | g | ×1 |
| G Force Vert | `G Force Vert` | g | ×1 |
| Susp Pos FL/FR/RL/RR | `Susp Pos` (value1–4) | m | ×1000 → mm |
| Brake Temp FL/FR/RL/RR | `Brakes Temp` (value1–4) | °C | ×1 |
| Tyre Temp FL/FR/RL/RR Inner | `TyresTempLeft` (value1–4) | °C | ×1 |
| Tyre Temp FL/FR/RL/RR Mid | `TyresTempCentre` (value1–4) | °C | ×1 |
| Tyre Temp FL/FR/RL/RR Outer | `TyresTempRight` (value1–4) | °C | ×1 |
| Tyre Pressure FL/FR/RL/RR | `TyresPressure` (value1–4) | kPa | ×1 |
| Fuel Level | `Fuel Level` | l | ×1 |
| Water Temp | `Engine Water Temp` | °C | ×1 |
| Oil Temp | `Engine Oil Temp` | °C | ×1 |
| TC | `TC` | — | event-driven |
| ABS | `ABS` | — | event-driven |
| In Pits | `In Pits` | — | event-driven |
| GPS Lat | `GPS Latitude` | deg | ×1 |
| GPS Lon | `GPS Longitude` | deg | ×1 |
| Beacon | synthetic | — | int16, 32 at lap start |

**Note:** `Susp Vel` (Damper Velocity) does not appear in the sample `channelsList` — skip unless confirmed present in the target DuckDB file. If present, apply ×1000 (m/s → mm/s).

---

## Triggering Modes

**Manual (user picks a file):**
- Electron renderer sends `convert:run` IPC with `{ inputPath, outputDir }`
- Main process spawns `node convert.js <input> <outdir>`
- Progress lines streamed back as `convert:log`

**Automatic (folder watch):**
- User configures a watch folder (LMU's telemetry output directory)
- Main process spawns `node watcher.js <folder> <outdir>` on startup
- Watcher uses `chokidar` to detect new `.duckdb` files
- File size stabilization: after `add`/`change` event, poll `fs.stat` every 500 ms until size is unchanged for 2 consecutive checks, then trigger conversion
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
- The watcher ignores files still being written (file size stabilization check)

---

## Out of Scope

- UI panel design (user will build the UI themselves)
- Real-time telemetry streaming (converter works on completed session files only)
- Car setup parameters in .ldx (from `metadata.CarSetup` — deferred to later)
- `SurfaceTypes` multi-wheel event channel (edge case, deferred)
