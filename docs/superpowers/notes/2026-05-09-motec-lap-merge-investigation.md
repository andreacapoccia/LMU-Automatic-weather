# MoTeC lap-merge bug — investigation notes

**Status:** Investigation in progress. G-force fix shipped; lap fix not yet implemented.
**Resume from:** Step 5 below ("Inspect the reference .ld file's beacon channel").

## What the user reported

> Lateral and Longitudinal G Forces telemetry channels are swapped around.
> In the files we're converting from duckdb to motec, we're merging the first lap
> (coming out of the pits) with lap1, and the last lap (the last lap after crossing
> the line) with the last full lap.

Later clarified: "the inlap is absolutely fine, it's the outlap that's mixed up".

## What's been done

### G-force swap — FIXED (commit `12f32bc`)
LMU's `G Force Lat` table actually contains longitudinal accel and `G Force Long`
contains lateral accel. Naming is reversed vs MoTeC i2's convention.
Fix: swapped `duckdbTable` mapping in `DuckDBtoMoTeC/converter/lib/channel-map.js`.
User confirmed the bug is just channel-swap (not sign-flip).

### Lap merge — diagnostic data captured, fix NOT yet implemented

User dropped 4 .ld files in `C:/Users/andre/Desktop/GO-LMU-debug/`:

| File | Source | Size | LDX laps | Fastest |
|------|--------|------|---------:|--------:|
| `Autodromo Nazionale Monza_P_2026-05-08T03_07_43Z.ld` | **Ours** | 4 MB | (no .ldx?) | — |
| `2026-05-08 - 05-07-42 - Autodromo Nazionale Monza - P1.ld` | **Reference** (other tool) | 6 MB | — | — |
| `Paul Ricard Circuit_R_2026-05-07T18_55_27Z.ld` | **Ours** | 38 MB | 28 | 10 (1:41.844) |
| `2026-05-07 - 20-55-28 - Paul Ricard - 1A-V2 - R1.ld` | **Reference** (other tool) | 57 MB | 29 | 11 (1:41.835) |

Distinguishing trait: ours has `metaStart=11336` and 57 channels with chanId
starting at 12001; reference has `metaStart=13384` and 78 channels with MoTeC
standard chanIds (9, 301, 302, …). **The reference is from a different
LMU→MoTeC converter (probably what the user used before us).**

## Inspector script

Saved at `DuckDBtoMoTeC/converter/inspect-ld.js`. Auto-detects `metaStart`
from the file header; works on both our output and reference files.

```bash
node DuckDBtoMoTeC/converter/inspect-ld.js path/to/file.ld
```

Dumps Beacon (chanId=110), Lap Number (chanId=2101), Marker (chanId=310)
channels, including reconstructed crossing timestamps and lap-number
transitions.

## Findings so far

### Monza practice (ours)
- 312s recording, 3 lap-number transitions: t=114.57 (lap 4→5), t=214.01 (5→6), t=311.11 (6→7)
- Only **2 beacons** emitted: at sample 115 and sample 215
- The third transition at t=311.11 has NO beacon
- Why: `duckdb-reader.js:139` checks `si >= nBeacon` and skips. For t=311.11,
  `si = ceil(311.11) = 312`, `nBeacon = 312` → skipped.
- Effect: MoTeC merges the last hot lap (LMU lap 6) with the tiny in-lap (LMU lap 7).
  In this file the in-lap is only 0.89s so the user might not notice.

### Paul Ricard race (ours)
- 2938s recording, 27 lap-number transitions, 27 beacons (1:1 match)
- First beacon at sample 260 (t=259.41s, lap 0→1) — end of formation/warm-up lap
- LDX says 28 total laps; **reference says 29**

### Out-lap merge hypothesis (the user's actual complaint)
The user's reference `.ldx` shows 29 laps with fastest at lap 11.
Ours shows 28 laps with fastest at lap 10 — **off by exactly one lap, with
fastest one number earlier**.

This pattern is consistent with: the reference inserts a beacon BEFORE the
formation lap (at t≈0) so its "Lap 1 = formation, Lap 2 = race lap 1, …,
Lap 11 = race lap 10 (fastest)". Our output has no t=0 beacon, so MoTeC
treats the formation lap as just the pre-first-beacon segment — which it
labels "Lap 1" but the lap-number channel value during it is 0, possibly
confusing MoTeC's interpretation.

## Where to resume tomorrow

1. **Inspect the reference .ld file's beacon channel.** The reference uses a
   different `metaStart` (13384) and different chanId conventions, so confirm
   the inspector handles that correctly. Compare beacon count and timing to
   ours. Specifically: does the reference have an extra beacon at t=0 or
   somewhere we don't?

   ```bash
   node DuckDBtoMoTeC/converter/inspect-ld.js \
     "C:/Users/andre/Desktop/GO-LMU-debug/2026-05-07 - 20-55-28 - Paul Ricard - 1A-V2 - R1.ld"
   ```

   The chanId for Beacon may not be 110 in the reference's MoTeC-standard
   numbering. May need to extend the inspector to find by name pattern only.

2. **Fix the trailing beacon bug.** In `duckdb-reader.js:139`, change the
   bound check or rounding so a crossing in the last second of recording
   isn't dropped. Two candidate fixes:
   - Change `Math.ceil(t * beaconFreq)` → `Math.floor(t * beaconFreq)` (also
     fixes a potential 1-second offset; but may break MoTeC's existing
     interpretation — needs reverse-engineering).
   - Extend the beacon channel by 1 sample so the trailing crossing fits.

3. **Investigate the out-lap merge.** Need a sample `.duckdb` file (not just
   `.ld`) to see what the LMU `Lap` table actually contains for a session
   with formation lap. Ask user to drop one in `GO-LMU-debug/`, then:
   ```bash
   # Quick query to dump Lap table from a duckdb file
   node -e "const d=require('duckdb');const c=new d.Database(':memory:').connect();c.run(\"ATTACH 'PATH' AS s (READ_ONLY)\",()=>c.all('SELECT ts,value FROM s.\"Lap\" ORDER BY ts',(_,r)=>{console.log(r);process.exit()}))"
   ```

4. Once both bugs are understood, write spec → plan → fix.

## Files touched this session

- `DuckDBtoMoTeC/converter/lib/channel-map.js` — G-force swap (committed `12f32bc`)
- `DuckDBtoMoTeC/converter/inspect-ld.js` — new diagnostic tool (uncommitted)
- `docs/superpowers/notes/2026-05-09-motec-lap-merge-investigation.md` — this file (uncommitted)
