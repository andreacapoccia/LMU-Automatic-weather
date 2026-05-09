# MoTeC lap-merge bug — investigation notes (RESOLVED 2026-05-10)

**Status:** Resolved. All four bugs identified and fixed. Shipped in v3.0.3.

## What the user reported

> Lateral and Longitudinal G Forces telemetry channels are swapped around.
> In the files we're converting from duckdb to motec, we're merging the first
> lap (coming out of the pits) with lap1.

## What turned out to be wrong

The bug was actually **four separate issues**, all in the duckdb→MoTeC converter:

### 1. G-force channels swapped — commit `12f32bc`

**Symptom:** Lateral G shows braking pulses, longitudinal G shows cornering pulses.

**Root cause:** LMU's `G Force Lat` table contains longitudinal accel; `G Force Long` contains lateral. Naming reversed vs MoTeC convention.

**Fix:** Swap the `duckdbTable` mapping for these two rows in `channel-map.js`.

### 2. Trailing beacon dropped — commit `61741e1`

**Symptom (caught via inspector, not user-reported):** Last hot lap merged with in-lap when the lap completes within the last second of recording.

**Root cause:** `nBeacon = round(duration)`, then bound check `if (si >= nBeacon) continue` silently dropped a crossing where `ceil(t) == nBeacon`.

**Fix:** Bumped buffer to make room; later refined.

### 3. Late beacons clipped by MoTeC — commit `450aabe`

**Symptom:** Even after fix #2 emitted the trailing beacon (verified by inspector), MoTeC still merged the last hot lap with the in-lap.

**Root cause:** Two related issues:
- MoTeC clips the beacon channel at the *highest-frequency channel's* effective duration. A marker at sample `ceil(duration)` lands AT or PAST that boundary and is silently dropped by MoTeC.
- MoTeC needs trailing "100" samples after the marker triple (marker / id / sub-second) to recognize the marker as a valid crossing.

**Fix:**
- Cap `si` at `floor(duration * freq)` so the marker stays inside the telemetry window.
- Bump buffer from +3 to +10 samples so trailing 100s always fit.

### 4. Formation-lap S/F missing from Lap table — commit `1732640`

**Symptom (the original user complaint):** In a race session, MoTeC's "Out Lap" was 4:19 (the entire formation period 0→259s) instead of being split into Out Lap (~2:29 = grid-to-S/F) + Lap 1 (~1:49 = S/F-to-S/F formation completion).

**Root cause:** LMU's `Lap` table only records POST-race-start S/F crossings. The formation-lap's S/F crossing at t≈149s isn't in there, so our converter had no source for that beacon.

**Fix:** Use the `Current Sector` event channel as the beacon source instead of `Lap`. Each `val=1` transition (entering sector 1 from any other sector) is a S/F crossing — including the formation lap. `Lap` table still drives the Lap Number channel for numerical labels. Falls back to Lap table if Current Sector isn't present.

## Diagnostic tools created during investigation

- **`DuckDBtoMoTeC/converter/inspect-ld.js`** — committed. Reads back Beacon, Lap Number, Marker channels from a .ld file. Auto-detects metaStart so it works on both our output (11336) and other tools' MoTeC-native output (13384).
- **`c:/tmp/inspect-ld-float-beacon.js`** — local-only. Same as above but handles float32 Beacon channels (used by MoTeC i2 native re-saves and some third-party converters).
- **`c:/tmp/dump-laps.js`** — local-only. Dumps the LMU `Lap` table + GPS Time bounds + metadata from a .duckdb file.

## Validation

| File | Source | Crossings | MoTeC structure |
|------|--------|----------:|-----------------|
| Paul Ricard race | user duckdb | 28 (was 27) | Out + 27 numbered + In Lap, fastest #11 ✓ matches reference |
| Monza practice | user duckdb | 3 | Out + 2 numbered + In Lap ✓ |
| Q04 example | bundled | 4 | no regression ✓ |

## Channels we still don't emit (potential future work)

The MoTeC-native reference files have several extra channels we don't generate. None are required for lap detection, but some would improve the analysis experience:

- `Session Elapsed Time` (id=2100, 50Hz) — continuous time channel
- `Delta Best` (id=5, 5Hz) — gap to best lap, computed
- `Realtime Loss` (id=200, 1Hz)
- `Max Straight Speed` / `Min Corner Speed` (per-lap aggregates, id=20/21)
- Sector markers via Beacon (the reference has ~2.5x more crossings than us, all sector S1/S2 entry markers — could be added by extending Current Sector to emit beacons for val=2 transitions too, with a different crossing-ID range)

## Files touched (committed)

- `DuckDBtoMoTeC/converter/lib/channel-map.js` — G-force swap
- `DuckDBtoMoTeC/converter/lib/duckdb-reader.js` — beacon emission (3 separate commits)
- `DuckDBtoMoTeC/converter/inspect-ld.js` — new diagnostic tool
- `app/package.json`, `app/src/renderer/index.html` — version bumps
- `docs/superpowers/notes/2026-05-09-motec-lap-merge-investigation.md` — this file
