# DuckDB → MoTeC Converter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone Node.js package that converts LMU DuckDB telemetry files to MoTeC i2 `.ld` + `.ldx` files with correct lap division and full channel data, then wire it into the Electron app via IPC.

**Architecture:** Standalone `converter/` package (no Electron dependency) with a one-shot CLI and a persistent folder watcher. Electron spawns child processes and streams progress back to the renderer via IPC. Binary `.ld` format is written using Node.js `Buffer`; `.ldx` is plain XML.

**Tech Stack:** Node.js 24, `duckdb` npm package, `chokidar`, `node:test` for tests.

---

## File Map

| File | What it does |
|---|---|
| `DuckDBtoMoTeC/converter/package.json` | Package manifest, deps, test script |
| `DuckDBtoMoTeC/converter/lib/channel-map.js` | Defines every channel: DuckDB table → MoTeC name, unit, scale, type |
| `DuckDBtoMoTeC/converter/lib/duckdb-reader.js` | Opens DuckDB, reconstructs timestamps, returns session object |
| `DuckDBtoMoTeC/converter/lib/ld-writer.js` | Writes binary `.ld` file |
| `DuckDBtoMoTeC/converter/lib/ldx-writer.js` | Writes XML `.ldx` file |
| `DuckDBtoMoTeC/converter/convert.js` | CLI entry point and orchestrator |
| `DuckDBtoMoTeC/converter/watcher.js` | Folder watcher, triggers convert on new `.duckdb` files |
| `DuckDBtoMoTeC/converter/test/test-channel-map.js` | Channel map tests |
| `DuckDBtoMoTeC/converter/test/test-ld-writer.js` | Binary writer tests |
| `DuckDBtoMoTeC/converter/test/test-ldx-writer.js` | XML writer tests |
| `DuckDBtoMoTeC/converter/test/test-duckdb-reader.js` | Integration tests against real DuckDB file |
| `DuckDBtoMoTeC/converter/test/test-convert.js` | End-to-end test |
| `app/src/main/main.js` | Add IPC handlers for convert:run, convert:startWatch, convert:stopWatch |
| `app/src/main/preload.js` | Expose converter IPC to renderer |

---

## Task 1: Project Scaffold

**Files:**
- Create: `DuckDBtoMoTeC/converter/package.json`
- Create: `DuckDBtoMoTeC/converter/lib/` (empty dir)
- Create: `DuckDBtoMoTeC/converter/test/` (empty dir)

- [ ] **Step 1: Create package.json**

```json
{
  "name": "lmu-motec-converter",
  "version": "1.0.0",
  "description": "Convert LMU DuckDB telemetry to MoTeC .ld/.ldx",
  "main": "convert.js",
  "scripts": {
    "test": "node --test test/"
  },
  "dependencies": {
    "chokidar": "^3.6.0",
    "duckdb": "^1.1.0"
  }
}
```

Save to `DuckDBtoMoTeC/converter/package.json`.

- [ ] **Step 2: Install dependencies**

```bash
cd DuckDBtoMoTeC/converter
npm install
```

Expected: `node_modules/` created with `duckdb` and `chokidar`.

- [ ] **Step 3: Create directories**

```bash
mkdir -p DuckDBtoMoTeC/converter/lib
mkdir -p DuckDBtoMoTeC/converter/test
```

- [ ] **Step 4: Commit**

```bash
git add DuckDBtoMoTeC/converter/package.json DuckDBtoMoTeC/converter/package-lock.json
git commit -m "feat: scaffold converter package"
```

---

## Task 2: Channel Map

**Files:**
- Create: `DuckDBtoMoTeC/converter/lib/channel-map.js`
- Create: `DuckDBtoMoTeC/converter/test/test-channel-map.js`

Every channel is described by one object. `wheels: true` means the DuckDB table has `value1`–`value4` columns (FL/FR/RL/RR). `isEvent: true` means the table has a `ts` column and is listed in `eventsList`. `scale` multiplies the raw DuckDB value (e.g. 1000 converts metres → mm).

- [ ] **Step 1: Write the failing test**

`DuckDBtoMoTeC/converter/test/test-channel-map.js`:
```js
const { test } = require('node:test');
const assert = require('node:assert');
const { CHANNELS } = require('../lib/channel-map');

test('CHANNELS is a non-empty array', () => {
  assert.ok(Array.isArray(CHANNELS));
  assert.ok(CHANNELS.length > 10);
});

test('every channel has required fields', () => {
  for (const ch of CHANNELS) {
    assert.ok(typeof ch.motecName === 'string' && ch.motecName.length > 0, `motecName missing on ${JSON.stringify(ch)}`);
    assert.ok(typeof ch.duckdbTable === 'string' && ch.duckdbTable.length > 0, `duckdbTable missing on ${ch.motecName}`);
    assert.ok(typeof ch.unit === 'string', `unit missing on ${ch.motecName}`);
    assert.ok(typeof ch.scale === 'number', `scale missing on ${ch.motecName}`);
    assert.ok(typeof ch.isEvent === 'boolean', `isEvent missing on ${ch.motecName}`);
    assert.ok(typeof ch.wheels === 'boolean', `wheels missing on ${ch.motecName}`);
  }
});

test('Susp Pos has scale 1000 (m to mm)', () => {
  const ch = CHANNELS.find(c => c.duckdbTable === 'Susp Pos');
  assert.ok(ch, 'Susp Pos not found');
  assert.strictEqual(ch.scale, 1000);
});

test('Gear is event-driven', () => {
  const ch = CHANNELS.find(c => c.duckdbTable === 'Gear');
  assert.ok(ch, 'Gear not found');
  assert.strictEqual(ch.isEvent, true);
});
```

- [ ] **Step 2: Run test — expect FAIL (module not found)**

```bash
cd DuckDBtoMoTeC/converter
node --test test/test-channel-map.js
```

Expected: Error — `Cannot find module '../lib/channel-map'`

- [ ] **Step 3: Write channel-map.js**

`DuckDBtoMoTeC/converter/lib/channel-map.js`:
```js
// { motecName, shortName, duckdbTable, unit, scale, isEvent, wheels }
// scale: multiply DuckDB value by this to convert units
// wheels: table has value1-4 (FL/FR/RL/RR), expanded to 4 MoTeC channels
// isEvent: table is in eventsList (has ts column), step-hold interpolated to 10 Hz
const CHANNELS = [
  { motecName: 'Engine RPM',       shortName: 'RPM',  duckdbTable: 'Engine RPM',        unit: 'rpm',  scale: 1,    isEvent: false, wheels: false },
  { motecName: 'Throttle Pos',     shortName: 'Thr',  duckdbTable: 'Throttle Pos',      unit: '%',    scale: 1,    isEvent: false, wheels: false },
  { motecName: 'Brake Pos',        shortName: 'Brk',  duckdbTable: 'Brake Pos',         unit: '%',    scale: 1,    isEvent: false, wheels: false },
  { motecName: 'Steering Pos',     shortName: 'Str',  duckdbTable: 'Steering Pos',      unit: '%',    scale: 1,    isEvent: false, wheels: false },
  { motecName: 'Ground Speed',     shortName: 'Spd',  duckdbTable: 'Ground Speed',      unit: 'km/h', scale: 1,    isEvent: false, wheels: false },
  { motecName: 'G Force Lat',      shortName: 'GLat', duckdbTable: 'G Force Lat',       unit: 'G',    scale: 1,    isEvent: false, wheels: false },
  { motecName: 'G Force Long',     shortName: 'GLng', duckdbTable: 'G Force Long',      unit: 'G',    scale: 1,    isEvent: false, wheels: false },
  { motecName: 'G Force Vert',     shortName: 'GVrt', duckdbTable: 'G Force Vert',      unit: 'G',    scale: 1,    isEvent: false, wheels: false },
  { motecName: 'Fuel Level',       shortName: 'Fuel', duckdbTable: 'Fuel Level',        unit: 'l',    scale: 1,    isEvent: false, wheels: false },
  { motecName: 'Water Temp',       shortName: 'WTmp', duckdbTable: 'Engine Water Temp', unit: 'C',    scale: 1,    isEvent: false, wheels: false },
  { motecName: 'Oil Temp',         shortName: 'OTmp', duckdbTable: 'Engine Oil Temp',   unit: 'C',    scale: 1,    isEvent: false, wheels: false },
  { motecName: 'GPS Lat',          shortName: 'Lat',  duckdbTable: 'GPS Latitude',      unit: 'deg',  scale: 1,    isEvent: false, wheels: false },
  { motecName: 'GPS Lon',          shortName: 'Lon',  duckdbTable: 'GPS Longitude',     unit: 'deg',  scale: 1,    isEvent: false, wheels: false },
  { motecName: 'Susp Pos',         shortName: 'SPos', duckdbTable: 'Susp Pos',          unit: 'mm',   scale: 1000, isEvent: false, wheels: true  },
  { motecName: 'Ride Height',      shortName: 'RHgt', duckdbTable: 'RideHeights',       unit: 'mm',   scale: 1000, isEvent: false, wheels: true  },
  { motecName: 'Wheel Speed',      shortName: 'WSpd', duckdbTable: 'Wheel Speed',       unit: 'km/h', scale: 3.6,  isEvent: false, wheels: true  },
  { motecName: 'Brake Temp',       shortName: 'BrkT', duckdbTable: 'Brakes Temp',       unit: 'C',    scale: 1,    isEvent: false, wheels: true  },
  { motecName: 'Tyre Temp Inner',  shortName: 'TTIn', duckdbTable: 'TyresTempLeft',     unit: 'C',    scale: 1,    isEvent: false, wheels: true  },
  { motecName: 'Tyre Temp Mid',    shortName: 'TTMd', duckdbTable: 'TyresTempCentre',   unit: 'C',    scale: 1,    isEvent: false, wheels: true  },
  { motecName: 'Tyre Temp Outer',  shortName: 'TTOt', duckdbTable: 'TyresTempRight',    unit: 'C',    scale: 1,    isEvent: false, wheels: true  },
  { motecName: 'Tyre Pressure',    shortName: 'TyrP', duckdbTable: 'TyresPressure',     unit: 'kPa',  scale: 1,    isEvent: false, wheels: true  },
  { motecName: 'Tyre Wear',        shortName: 'TWr',  duckdbTable: 'Tyres Wear',        unit: '%',    scale: 1,    isEvent: false, wheels: true  },
  { motecName: 'Gear',             shortName: 'Gear', duckdbTable: 'Gear',              unit: '',     scale: 1,    isEvent: true,  wheels: false },
  { motecName: 'TC',               shortName: 'TC',   duckdbTable: 'TC',                unit: '',     scale: 1,    isEvent: true,  wheels: false },
  { motecName: 'ABS',              shortName: 'ABS',  duckdbTable: 'ABS',               unit: '',     scale: 1,    isEvent: true,  wheels: false },
  { motecName: 'In Pits',          shortName: 'Pits', duckdbTable: 'In Pits',           unit: '',     scale: 1,    isEvent: true,  wheels: false },
  { motecName: 'Speed Limiter',    shortName: 'SpdL', duckdbTable: 'Speed Limiter',     unit: '',     scale: 1,    isEvent: true,  wheels: false },
];

module.exports = { CHANNELS };
```

- [ ] **Step 4: Run test — expect PASS**

```bash
node --test test/test-channel-map.js
```

Expected: `✓ CHANNELS is a non-empty array`, `✓ every channel has required fields`, etc.

- [ ] **Step 5: Commit**

```bash
git add DuckDBtoMoTeC/converter/lib/channel-map.js DuckDBtoMoTeC/converter/test/test-channel-map.js
git commit -m "feat: add channel map"
```

---

## Task 3: DuckDB Reader

**Files:**
- Create: `DuckDBtoMoTeC/converter/lib/duckdb-reader.js`
- Create: `DuckDBtoMoTeC/converter/test/test-duckdb-reader.js`

These tests read the real DuckDB example file. Path: `DuckDBtoMoTeC/examples/GO4 296 LMGT3 MON E Q04 DUCKDB.duckdb`

- [ ] **Step 1: Write the failing tests**

`DuckDBtoMoTeC/converter/test/test-duckdb-reader.js`:
```js
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { readSession } = require('../lib/duckdb-reader');

const DB = path.resolve(__dirname, '../../examples/GO4 296 LMGT3 MON E Q04 DUCKDB.duckdb');

test('sessionStart is ~668.985', async () => {
  const s = await readSession(DB);
  assert.ok(Math.abs(s.sessionStart - 668.985) < 0.01, `sessionStart=${s.sessionStart}`);
});

test('5 lap boundaries found', async () => {
  const s = await readSession(DB);
  assert.strictEqual(s.laps.length, 5);
});

test('Engine RPM channel has >1000 samples and values >1000', async () => {
  const s = await readSession(DB);
  const ch = s.channels.find(c => c.name === 'Engine RPM');
  assert.ok(ch, 'Engine RPM missing');
  assert.ok(ch.data.length > 1000);
  assert.ok(ch.data.some(v => v > 1000), 'RPM values too low');
});

test('Susp Pos FL values are in mm (>10)', async () => {
  const s = await readSession(DB);
  const ch = s.channels.find(c => c.name === 'Susp Pos FL');
  assert.ok(ch, 'Susp Pos FL missing');
  assert.ok(ch.data.some(v => v > 10), `max Susp Pos FL=${Math.max(...ch.data.slice(0,100))}`);
});

test('Gear channel is step-hold interpolated at 10 Hz', async () => {
  const s = await readSession(DB);
  const ch = s.channels.find(c => c.name === 'Gear');
  assert.ok(ch, 'Gear missing');
  assert.strictEqual(ch.freq, 10);
  assert.ok(ch.data.length > 100);
});

test('Beacon channel has 32 at first lap start', async () => {
  const s = await readSession(DB);
  const beacon = s.channels.find(c => c.name === 'Beacon');
  assert.ok(beacon, 'Beacon missing');
  const firstLapIdx = Math.round((s.laps[0].ts - s.sessionStart) * 100);
  assert.strictEqual(beacon.data[firstLapIdx], 32);
});

test('metadata has DriverName and TrackName', async () => {
  const s = await readSession(DB);
  assert.ok(s.meta.DriverName, 'DriverName missing');
  assert.ok(s.meta.TrackName, 'TrackName missing');
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
node --test test/test-duckdb-reader.js
```

Expected: `Cannot find module '../lib/duckdb-reader'`

- [ ] **Step 3: Write duckdb-reader.js**

`DuckDBtoMoTeC/converter/lib/duckdb-reader.js`:
```js
'use strict';
const duckdb = require('duckdb');
const { CHANNELS } = require('./channel-map');

const WHEEL_SUFFIX = ['FL', 'FR', 'RL', 'RR'];
const EVENT_STEP_FREQ = 10;

function query(con, sql) {
  return new Promise((resolve, reject) =>
    con.all(sql, (err, rows) => (err ? reject(err) : resolve(rows)))
  );
}

async function readSession(dbPath) {
  const db = new duckdb.Database(dbPath);
  const con = db.connect();

  try {
    // Session clock anchor
    const gpsRows = await query(con, 'SELECT value FROM "GPS Time" LIMIT 1');
    if (!gpsRows.length) throw new Error('GPS Time table is empty');
    const sessionStart = gpsRows[0].value;

    // Lap boundaries
    const lapRows = await query(con, 'SELECT ts, value FROM "Lap" ORDER BY ts');
    const laps = lapRows.map(r => ({ ts: r.ts, lapNum: r.value }));

    // Session length in samples at 100 Hz
    const [{ n: totalSamples100Hz }] = await query(con, 'SELECT COUNT(*) as n FROM "GPS Time"');
    const sessionDuration = totalSamples100Hz / 100;

    // Metadata key-value
    const metaRows = await query(con, 'SELECT key, value FROM metadata');
    const meta = Object.fromEntries(metaRows.map(r => [r.key, r.value]));

    // Frequency map from channelsList
    const clRows = await query(con, 'SELECT channelName, frequency FROM channelsList');
    const freqMap = Object.fromEntries(clRows.map(r => [r.channelName, r.frequency]));

    // Build channels
    const channels = [];
    for (const ch of CHANNELS) {
      const table = ch.duckdbTable;

      // Skip table if not found in the DB
      const [{ n: exists }] = await query(
        con,
        `SELECT COUNT(*) as n FROM information_schema.tables WHERE table_name = '${table.replace(/'/g, "''")}'`
      );
      if (!exists) continue;

      const freq = ch.isEvent ? EVENT_STEP_FREQ : (freqMap[table] ?? 100);

      if (ch.wheels) {
        const rows = await query(con, `SELECT value1, value2, value3, value4 FROM "${table}"`);
        for (let w = 0; w < 4; w++) {
          const key = `value${w + 1}`;
          const raw = rows.map(r => (r[key] ?? 0) * ch.scale);
          channels.push({
            name: `${ch.motecName} ${WHEEL_SUFFIX[w]}`,
            shortName: `${ch.shortName}${WHEEL_SUFFIX[w]}`,
            unit: ch.unit,
            freq,
            data: raw,
          });
        }
      } else if (ch.isEvent) {
        const rows = await query(con, `SELECT ts, value FROM "${table}" ORDER BY ts`);
        const times = rows.map(r => r.ts - sessionStart);
        const values = rows.map(r => (r.value ?? 0) * ch.scale);
        channels.push({
          name: ch.motecName,
          shortName: ch.shortName,
          unit: ch.unit,
          freq,
          data: stepHold(times, values, EVENT_STEP_FREQ, sessionDuration),
        });
      } else {
        const rows = await query(con, `SELECT value FROM "${table}"`);
        channels.push({
          name: ch.motecName,
          shortName: ch.shortName,
          unit: ch.unit,
          freq,
          data: rows.map(r => (r.value ?? 0) * ch.scale),
        });
      }
    }

    // Synthetic Beacon channel at 100 Hz
    const beacon = new Array(totalSamples100Hz).fill(0);
    for (const lap of laps) {
      const idx = Math.round((lap.ts - sessionStart) * 100);
      if (idx >= 0 && idx < beacon.length) beacon[idx] = 32;
    }
    channels.push({ name: 'Beacon', shortName: 'Bcn', unit: '', freq: 100, data: beacon, dtype: 'int16' });

    return { sessionStart, sessionDuration, laps, meta, channels, totalSamples100Hz };
  } finally {
    db.close();
  }
}

function stepHold(eventTimes, eventValues, freq, duration) {
  const nSamples = Math.round(duration * freq);
  const out = new Array(nSamples).fill(0);
  let ei = 0;
  let lastVal = eventValues.length > 0 ? eventValues[0] : 0;
  for (let i = 0; i < nSamples; i++) {
    const t = i / freq;
    while (ei < eventTimes.length && eventTimes[ei] <= t) {
      lastVal = eventValues[ei];
      ei++;
    }
    out[i] = lastVal;
  }
  return out;
}

module.exports = { readSession };
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
node --test test/test-duckdb-reader.js
```

Expected: All 7 tests pass. Note: this test takes ~10–30 s because it reads the real DuckDB file.

- [ ] **Step 5: Commit**

```bash
git add DuckDBtoMoTeC/converter/lib/duckdb-reader.js DuckDBtoMoTeC/converter/test/test-duckdb-reader.js
git commit -m "feat: add DuckDB reader with timestamp reconstruction and beacon"
```

---

## Task 4: Binary .ld Writer

**Files:**
- Create: `DuckDBtoMoTeC/converter/lib/ld-writer.js`
- Create: `DuckDBtoMoTeC/converter/test/test-ld-writer.js`

**Key binary layout constants** (derived from ldparser.py reverse engineering):
- `VEHICLE_PTR = 1762` — ldVehicle struct offset
- `VENUE_PTR = 5078` — ldVenue struct offset
- `EVENT_PTR = 8180` — ldEvent struct offset
- `CHAN_META_START = 11336` — first channel header offset
- `CHAN_HEAD_SIZE = 124` — bytes per channel header
- Channel data starts at: `CHAN_META_START + N * CHAN_HEAD_SIZE`

**ldHead fields at known byte offsets** (from Python struct format `<I4xII20xI24xHHHI8sHHI4x16s16x16s16x64s64s64x64s64x1024xI66x64s126x64s64s`):

| Field | Offset | Type | Value |
|---|---|---|---|
| ldmarker | 0 | uint32 | 0x40 |
| chann_meta_ptr | 8 | uint32 | CHAN_META_START |
| chann_data_ptr | 12 | uint32 | CHAN_META_START + N×124 |
| event_ptr | 36 | uint32 | EVENT_PTR |
| static | 64 | uint16 | 1 |
| static | 66 | uint16 | 0x4240 |
| static | 68 | uint16 | 0xf |
| device_serial | 70 | uint32 | 0x1f44 |
| device_type | 74 | 8 bytes | "ADL\0\0\0\0\0" |
| device_version | 82 | uint16 | 420 |
| static | 84 | uint16 | 0xadb0 |
| num_channs | 86 | uint32 | N |
| date | 94 | 16 bytes | "DD/MM/YYYY\0..." |
| time | 126 | 16 bytes | "HH:MM:SS\0..." |
| driver | 158 | 64 bytes | driver name |
| vehicleid | 222 | 64 bytes | car name |
| venue | 350 | 64 bytes | track name |
| pro_logging | 1502 | uint32 | 0xc81a4 |
| event | 1762 | 64 bytes | overwritten by ldVehicle |
| session | 1826 | 64 bytes | overwritten by ldVehicle |

**ldVehicle at VEHICLE_PTR (1762)** — format `<64s128xI32s32s` (260 bytes):

| Field | Rel. offset | Type |
|---|---|---|
| id | 0 | 64 bytes |
| padding | 64 | 128 bytes |
| weight | 192 | uint32 |
| type | 196 | 32 bytes |
| comment | 228 | 32 bytes |

**ldVenue at VENUE_PTR (5078)** — format `<64s1034xH` (1100 bytes):

| Field | Rel. offset | Type |
|---|---|---|
| name | 0 | 64 bytes |
| padding | 64 | 1034 bytes |
| vehicle_ptr | 1098 | uint16 |

**ldEvent at EVENT_PTR (8180)** — format `<64s64s1024sH` (1154 bytes):

| Field | Rel. offset | Type |
|---|---|---|
| name | 0 | 64 bytes |
| session | 64 | 64 bytes |
| comment | 128 | 1024 bytes |
| venue_ptr | 1152 | uint16 |

**Channel header at CHAN_META_START + i×124** — format `<IIII H HHH HHHh 32s 8s 12s 40x`:

| Field | Rel. offset | Type | Value |
|---|---|---|---|
| prev_meta_ptr | 0 | uint32 | 0 if first, else CHAN_META_START+(i-1)×124 |
| next_meta_ptr | 4 | uint32 | 0 if last, else CHAN_META_START+(i+1)×124 |
| data_ptr | 8 | uint32 | computed per channel |
| n_data | 12 | uint32 | sample count |
| counter | 16 | uint16 | 0x2ee1+i |
| dtype_a | 18 | uint16 | 0x07=float, 0x03=int |
| dtype | 20 | uint16 | 4=float32, 2=int16 |
| freq | 22 | uint16 | Hz |
| shift | 24 | uint16 | 0 |
| mul | 26 | uint16 | 1 |
| scale | 28 | uint16 | 1 |
| dec | 30 | int16 | 0 |
| name | 32 | 32 bytes | channel name |
| short_name | 64 | 8 bytes | short name |
| unit | 72 | 12 bytes | unit string |
| padding | 84 | 40 bytes | zeros |

- [ ] **Step 1: Write the failing tests**

`DuckDBtoMoTeC/converter/test/test-ld-writer.js`:
```js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { writeLD } = require('../lib/ld-writer');

const CHAN_META_START = 11336;
const CHAN_HEAD_SIZE = 124;

function makeSession(overrides = {}) {
  const nSamples = 1000;
  return {
    channels: [
      { name: 'Engine RPM', shortName: 'RPM', unit: 'rpm', freq: 100, data: Array.from({ length: nSamples }, (_, i) => 5000 + i * 0.5) },
      { name: 'Throttle Pos', shortName: 'Thr', unit: '%', freq: 50, data: Array.from({ length: 500 }, () => 75.0) },
      { name: 'Beacon', shortName: 'Bcn', unit: '', freq: 100, data: Array.from({ length: nSamples }, (_, i) => (i === 0 ? 32 : 0)), dtype: 'int16' },
    ],
    meta: { DriverName: 'Test Driver', CarName: 'Test Car', TrackName: 'Test Track', CarClass: 'GT3', SessionType: 'Qualify', RecordingTime: '2026-05-01T12_00_00Z', SessionTime: '12:00:00' },
    laps: [{ ts: 668.985, lapNum: 6 }, { ts: 802.74, lapNum: 7 }],
    sessionDuration: 464,
    totalSamples100Hz: nSamples,
    ...overrides,
  };
}

test('file starts with ldmarker 0x40', () => {
  const f = path.join(os.tmpdir(), 'test1.ld');
  writeLD(f, makeSession());
  const buf = fs.readFileSync(f);
  assert.strictEqual(buf.readUInt32LE(0), 0x40);
  fs.unlinkSync(f);
});

test('channel count written at offset 86', () => {
  const session = makeSession();
  const f = path.join(os.tmpdir(), 'test2.ld');
  writeLD(f, session);
  const buf = fs.readFileSync(f);
  assert.strictEqual(buf.readUInt32LE(86), session.channels.length);
  fs.unlinkSync(f);
});

test('first channel name is Engine RPM', () => {
  const f = path.join(os.tmpdir(), 'test3.ld');
  writeLD(f, makeSession());
  const buf = fs.readFileSync(f);
  const nameBytes = buf.slice(CHAN_META_START + 32, CHAN_META_START + 64);
  assert.ok(nameBytes.toString('ascii').replace(/\0/g, '').startsWith('Engine RPM'));
  fs.unlinkSync(f);
});

test('float32 RPM data round-trips to within 0.01', () => {
  const session = makeSession();
  const f = path.join(os.tmpdir(), 'test4.ld');
  writeLD(f, session);
  const buf = fs.readFileSync(f);
  const dataStart = CHAN_META_START + session.channels.length * CHAN_HEAD_SIZE;
  const rpm = session.channels[0].data;
  for (let i = 0; i < 5; i++) {
    const val = buf.readFloatLE(dataStart + i * 4);
    assert.ok(Math.abs(val - rpm[i]) < 0.01, `RPM[${i}]: got ${val}, expected ${rpm[i]}`);
  }
  fs.unlinkSync(f);
});

test('Beacon channel data is int16 with 32 at index 0', () => {
  const session = makeSession();
  const f = path.join(os.tmpdir(), 'test5.ld');
  writeLD(f, session);
  const buf = fs.readFileSync(f);
  // Beacon data starts after RPM (1000 × 4 bytes) and Throttle (500 × 4 bytes)
  const dataStart = CHAN_META_START + session.channels.length * CHAN_HEAD_SIZE;
  const beaconDataStart = dataStart + 1000 * 4 + 500 * 4;
  assert.strictEqual(buf.readInt16LE(beaconDataStart), 32);
  assert.strictEqual(buf.readInt16LE(beaconDataStart + 2), 0);
  fs.unlinkSync(f);
});

test('event_ptr in header points to EVENT_PTR (8180)', () => {
  const f = path.join(os.tmpdir(), 'test6.ld');
  writeLD(f, makeSession());
  const buf = fs.readFileSync(f);
  assert.strictEqual(buf.readUInt32LE(36), 8180);
  fs.unlinkSync(f);
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
node --test test/test-ld-writer.js
```

Expected: `Cannot find module '../lib/ld-writer'`

- [ ] **Step 3: Write ld-writer.js**

`DuckDBtoMoTeC/converter/lib/ld-writer.js`:
```js
'use strict';
const fs = require('fs');

const VEHICLE_PTR = 1762;
const VENUE_PTR = 5078;
const EVENT_PTR = 8180;
const CHAN_META_START = 11336;
const CHAN_HEAD_SIZE = 124;

function wstr(buf, str, offset, maxLen) {
  const bytes = Buffer.from((str || '').substring(0, maxLen), 'ascii');
  bytes.copy(buf, offset);
}

function parseDateTime(meta) {
  const pad = n => String(n).padStart(2, '0');
  let date = '', time = '';
  if (meta.RecordingTime) {
    const [dp, tp = ''] = meta.RecordingTime.replace('Z', '').split('T');
    const [y, m, d] = dp.split('-');
    date = `${d}/${m}/${y}`;
    time = tp.replace(/_/g, ':').substring(0, 8);
  }
  if (meta.SessionTime) time = meta.SessionTime.substring(0, 8);
  if (!date) { const d = new Date(); date = `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()}`; }
  if (!time) { const d = new Date(); time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; }
  return { date, time };
}

function writeLD(outPath, session) {
  const { channels, meta, laps, sessionDuration } = session;
  const N = channels.length;

  const bytesPerSample = ch => ch.dtype === 'int16' ? 2 : 4;
  const dataSizes = channels.map(ch => ch.data.length * bytesPerSample(ch));
  const totalData = dataSizes.reduce((a, b) => a + b, 0);
  const fileSize = CHAN_META_START + N * CHAN_HEAD_SIZE + totalData;
  const buf = Buffer.alloc(fileSize, 0);

  const metaPtr = CHAN_META_START;
  const dataPtr = CHAN_META_START + N * CHAN_HEAD_SIZE;
  const dt = parseDateTime(meta);

  // --- ldHead ---
  buf.writeUInt32LE(0x40, 0);
  buf.writeUInt32LE(metaPtr, 8);
  buf.writeUInt32LE(dataPtr, 12);
  buf.writeUInt32LE(EVENT_PTR, 36);
  buf.writeUInt16LE(1, 64);
  buf.writeUInt16LE(0x4240, 66);
  buf.writeUInt16LE(0xf, 68);
  buf.writeUInt32LE(0x1f44, 70);
  wstr(buf, 'ADL', 74, 8);
  buf.writeUInt16LE(420, 82);
  buf.writeUInt16LE(0xadb0, 84);
  buf.writeUInt32LE(N, 86);
  wstr(buf, dt.date, 94, 16);
  wstr(buf, dt.time, 126, 16);
  wstr(buf, meta.DriverName || '', 158, 64);
  wstr(buf, meta.CarName || '', 222, 64);
  wstr(buf, meta.TrackName || '', 350, 64);
  buf.writeUInt32LE(0xc81a4, 1502);

  // --- ldVehicle at VEHICLE_PTR ---
  wstr(buf, meta.CarName || '', VEHICLE_PTR, 64);
  buf.writeUInt32LE(0, VEHICLE_PTR + 192);
  wstr(buf, meta.CarClass || '', VEHICLE_PTR + 196, 32);

  // --- ldVenue at VENUE_PTR ---
  wstr(buf, meta.TrackName || '', VENUE_PTR, 64);
  buf.writeUInt16LE(VEHICLE_PTR, VENUE_PTR + 1098);

  // --- ldEvent at EVENT_PTR ---
  wstr(buf, 'LMU', EVENT_PTR, 64);
  wstr(buf, meta.SessionType || '', EVENT_PTR + 64, 64);
  buf.writeUInt16LE(VENUE_PTR, EVENT_PTR + 1152);

  // --- Channel headers ---
  let curDataPtr = dataPtr;
  for (let i = 0; i < N; i++) {
    const ch = channels[i];
    const off = CHAN_META_START + i * CHAN_HEAD_SIZE;
    const bps = bytesPerSample(ch);
    const dtypeA = ch.dtype === 'int16' ? 0x03 : 0x07;
    const dtypeBytes = bps;
    const prevMeta = i === 0 ? 0 : CHAN_META_START + (i - 1) * CHAN_HEAD_SIZE;
    const nextMeta = i === N - 1 ? 0 : CHAN_META_START + (i + 1) * CHAN_HEAD_SIZE;

    buf.writeUInt32LE(prevMeta, off);
    buf.writeUInt32LE(nextMeta, off + 4);
    buf.writeUInt32LE(curDataPtr, off + 8);
    buf.writeUInt32LE(ch.data.length, off + 12);
    buf.writeUInt16LE(0x2ee1 + i, off + 16);
    buf.writeUInt16LE(dtypeA, off + 18);
    buf.writeUInt16LE(dtypeBytes, off + 20);
    buf.writeUInt16LE(ch.freq, off + 22);
    buf.writeUInt16LE(0, off + 24); // shift
    buf.writeUInt16LE(1, off + 26); // mul
    buf.writeUInt16LE(1, off + 28); // scale
    buf.writeInt16LE(0, off + 30);  // dec
    wstr(buf, ch.name, off + 32, 32);
    wstr(buf, ch.shortName || '', off + 64, 8);
    wstr(buf, ch.unit || '', off + 72, 12);

    curDataPtr += dataSizes[i];
  }

  // --- Channel data ---
  let doff = dataPtr;
  for (let i = 0; i < N; i++) {
    const ch = channels[i];
    if (ch.dtype === 'int16') {
      for (let j = 0; j < ch.data.length; j++) {
        buf.writeInt16LE(ch.data[j], doff + j * 2);
      }
      doff += ch.data.length * 2;
    } else {
      for (let j = 0; j < ch.data.length; j++) {
        buf.writeFloatLE(ch.data[j], doff + j * 4);
      }
      doff += ch.data.length * 4;
    }
  }

  fs.writeFileSync(outPath, buf);
}

module.exports = { writeLD };
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
node --test test/test-ld-writer.js
```

Expected: All 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add DuckDBtoMoTeC/converter/lib/ld-writer.js DuckDBtoMoTeC/converter/test/test-ld-writer.js
git commit -m "feat: add binary .ld writer"
```

---

## Task 5: XML .ldx Writer

**Files:**
- Create: `DuckDBtoMoTeC/converter/lib/ldx-writer.js`
- Create: `DuckDBtoMoTeC/converter/test/test-ldx-writer.js`

The `.ldx` format is plain XML. Structure matches the reference file: `LDXFile > Layers > Details > String` elements for lap stats.

- [ ] **Step 1: Write the failing tests**

`DuckDBtoMoTeC/converter/test/test-ldx-writer.js`:
```js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { writeLDX } = require('../lib/ldx-writer');

test('writes valid XML header', () => {
  const f = path.join(os.tmpdir(), 'test.ldx');
  writeLDX(f, { laps: [{ ts: 0, lapNum: 1 }, { ts: 99, lapNum: 2 }], sessionDuration: 200 });
  const xml = fs.readFileSync(f, 'utf8');
  assert.ok(xml.startsWith('<?xml version="1.0"?>'));
  assert.ok(xml.includes('<LDXFile'));
  fs.unlinkSync(f);
});

test('Total Laps equals laps.length', () => {
  const f = path.join(os.tmpdir(), 'test2.ldx');
  writeLDX(f, { laps: [{ ts: 0 }, { ts: 100 }, { ts: 190 }], sessionDuration: 290 });
  const xml = fs.readFileSync(f, 'utf8');
  assert.ok(xml.includes('Total Laps" Value="3"'));
  fs.unlinkSync(f);
});

test('Fastest Lap identifies minimum lap time', () => {
  // Lap 1: 0→100=100s. Lap 2: 100→190=90s. Lap 3: 190→(190+95)=95s. Fastest=Lap 2
  const f = path.join(os.tmpdir(), 'test3.ldx');
  writeLDX(f, { laps: [{ ts: 0 }, { ts: 100 }, { ts: 190 }], sessionDuration: 285 });
  const xml = fs.readFileSync(f, 'utf8');
  assert.ok(xml.includes('Fastest Lap" Value="2"'), xml);
  fs.unlinkSync(f);
});

test('Fastest Time formatted as M:SS.mmm', () => {
  const f = path.join(os.tmpdir(), 'test4.ldx');
  // Only lap: 0→99.206s
  writeLDX(f, { laps: [{ ts: 0 }], sessionDuration: 99.206 });
  const xml = fs.readFileSync(f, 'utf8');
  assert.ok(xml.includes('Fastest Time" Value="1:39.206"'), xml);
  fs.unlinkSync(f);
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
node --test test/test-ldx-writer.js
```

Expected: `Cannot find module '../lib/ldx-writer'`

- [ ] **Step 3: Write ldx-writer.js**

`DuckDBtoMoTeC/converter/lib/ldx-writer.js`:
```js
'use strict';
const fs = require('fs');

function writeLDX(outPath, session) {
  const { laps, sessionDuration } = session;

  // Lap times: duration from start of lap[i] to start of lap[i+1]
  // Last lap: from lap[N-1].ts to estimated session end
  const lapTimes = laps.map((lap, i) => {
    if (i + 1 < laps.length) return laps[i + 1].ts - lap.ts;
    // Last lap: session end estimated from duration and first lap start
    const sessionEnd = laps[0].ts + sessionDuration;
    return sessionEnd - lap.ts;
  });

  const fastestIdx = lapTimes.indexOf(Math.min(...lapTimes));
  const fastestSecs = lapTimes[fastestIdx];

  const xml = [
    '<?xml version="1.0"?>',
    '<LDXFile Locale="English_US.1252" DefaultLocale="C" Version="1.6">',
    ' <Layers>',
    '  <Details>',
    `   <String Id="Total Laps" Value="${laps.length}"/>`,
    `   <String Id="Fastest Time" Value="${formatLapTime(fastestSecs)}"/>`,
    `   <String Id="Fastest Lap" Value="${fastestIdx + 1}"/>`,
    '  </Details>',
    ' </Layers>',
    '</LDXFile>',
  ].join('\n');

  fs.writeFileSync(outPath, xml, 'utf8');
}

function formatLapTime(seconds) {
  const m = Math.floor(seconds / 60);
  const rem = seconds - m * 60;
  const s = Math.floor(rem);
  const ms = Math.round((rem - s) * 1000);
  return `${m}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

module.exports = { writeLDX };
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
node --test test/test-ldx-writer.js
```

Expected: All 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add DuckDBtoMoTeC/converter/lib/ldx-writer.js DuckDBtoMoTeC/converter/test/test-ldx-writer.js
git commit -m "feat: add XML .ldx writer"
```

---

## Task 6: CLI Entry Point, Watcher, and End-to-End Test

**Files:**
- Create: `DuckDBtoMoTeC/converter/convert.js`
- Create: `DuckDBtoMoTeC/converter/watcher.js`
- Create: `DuckDBtoMoTeC/converter/test/test-convert.js`

- [ ] **Step 1: Write the failing end-to-end test**

`DuckDBtoMoTeC/converter/test/test-convert.js`:
```js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { convert } = require('../convert');

const DB = path.resolve(__dirname, '../../examples/GO4 296 LMGT3 MON E Q04 DUCKDB.duckdb');
const OUT = os.tmpdir();

test('convert produces .ld and .ldx files', async () => {
  const baseName = path.basename(DB, '.duckdb');
  const ldPath = path.join(OUT, baseName + '.ld');
  const ldxPath = path.join(OUT, baseName + '.ldx');

  // Clean up before test
  for (const f of [ldPath, ldxPath]) if (fs.existsSync(f)) fs.unlinkSync(f);

  await convert(DB, OUT);

  assert.ok(fs.existsSync(ldPath), '.ld file not created');
  assert.ok(fs.existsSync(ldxPath), '.ldx file not created');

  // .ld starts with ldmarker
  const ldBuf = fs.readFileSync(ldPath);
  assert.strictEqual(ldBuf.readUInt32LE(0), 0x40, '.ld ldmarker wrong');

  // .ldx contains Total Laps
  const ldx = fs.readFileSync(ldxPath, 'utf8');
  assert.ok(ldx.includes('Total Laps'), '.ldx missing Total Laps');

  // Clean up
  fs.unlinkSync(ldPath);
  fs.unlinkSync(ldxPath);
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
node --test test/test-convert.js
```

Expected: `Cannot find module '../convert'`

- [ ] **Step 3: Write convert.js**

`DuckDBtoMoTeC/converter/convert.js`:
```js
'use strict';
const path = require('path');
const { readSession } = require('./lib/duckdb-reader');
const { writeLD } = require('./lib/ld-writer');
const { writeLDX } = require('./lib/ldx-writer');

function log(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

async function convert(inputPath, outputDir) {
  const baseName = path.basename(inputPath, '.duckdb');
  const ldPath = path.join(outputDir, baseName + '.ld');
  const ldxPath = path.join(outputDir, baseName + '.ldx');

  log({ type: 'start', file: inputPath });

  const session = await readSession(inputPath);
  log({ type: 'progress', step: 'read', channels: session.channels.length, laps: session.laps.length });

  writeLD(ldPath, session);
  log({ type: 'progress', step: 'ld', path: ldPath });

  writeLDX(ldxPath, session);
  log({ type: 'done', ld: ldPath, ldx: ldxPath });
}

if (require.main === module) {
  const [,, inputPath, outputDir] = process.argv;
  if (!inputPath || !outputDir) {
    process.stderr.write('Usage: node convert.js <input.duckdb> <outputDir>\n');
    process.exit(1);
  }
  convert(inputPath, outputDir).catch(err => {
    process.stderr.write(JSON.stringify({ type: 'error', message: err.message }) + '\n');
    process.exit(1);
  });
}

module.exports = { convert };
```

- [ ] **Step 4: Run end-to-end test — expect PASS**

```bash
node --test test/test-convert.js
```

Expected: PASS. Also try the CLI manually:

```bash
node convert.js "../../examples/GO4 296 LMGT3 MON E Q04 DUCKDB.duckdb" "../../examples/"
```

Expected: Two JSON progress lines + done line. `.ld` and `.ldx` files created in `examples/`. Open the `.ld` in MoTeC i2 to verify laps appear and channels have data.

- [ ] **Step 5: Write watcher.js**

`DuckDBtoMoTeC/converter/watcher.js`:
```js
'use strict';
const chokidar = require('chokidar');
const fs = require('fs');
const path = require('path');
const { convert } = require('./convert');

const [,, watchDir, outputDir] = process.argv;
if (!watchDir || !outputDir) {
  process.stderr.write('Usage: node watcher.js <watchDir> <outputDir>\n');
  process.exit(1);
}

const pending = new Map();

const watcher = chokidar.watch(watchDir, { persistent: true, ignoreInitial: true });
watcher.on('add', f => onFile(f));
watcher.on('change', f => onFile(f));

function onFile(filePath) {
  if (!filePath.endsWith('.duckdb')) return;
  if (pending.has(filePath)) clearTimeout(pending.get(filePath).timer);
  scheduleStabilize(filePath, -1, 0);
}

function scheduleStabilize(filePath, lastSize, stableCount) {
  const timer = setTimeout(() => {
    try {
      const { size } = fs.statSync(filePath);
      if (size === lastSize) {
        if (stableCount >= 1) {
          pending.delete(filePath);
          triggerConvert(filePath);
          return;
        }
        scheduleStabilize(filePath, size, stableCount + 1);
      } else {
        scheduleStabilize(filePath, size, 0);
      }
    } catch {
      pending.delete(filePath);
    }
  }, 500);
  pending.set(filePath, { timer });
}

function triggerConvert(filePath) {
  process.stdout.write(JSON.stringify({ type: 'detected', file: filePath }) + '\n');
  const outDir = outputDir || path.dirname(filePath);
  convert(filePath, outDir).catch(err =>
    process.stderr.write(JSON.stringify({ type: 'error', file: filePath, message: err.message }) + '\n')
  );
}

process.stdout.write(JSON.stringify({ type: 'watching', dir: watchDir }) + '\n');
```

- [ ] **Step 6: Smoke-test watcher manually**

```bash
node watcher.js "C:/path/to/watch" "C:/path/to/output"
```

Expected: `{"type":"watching","dir":"..."}` printed. When a `.duckdb` file is copied into the watch folder, conversion starts automatically within ~1–2 seconds of file stabilization.

- [ ] **Step 7: Run full test suite**

```bash
node --test test/
```

Expected: All tests pass.

- [ ] **Step 8: Commit**

```bash
git add DuckDBtoMoTeC/converter/convert.js DuckDBtoMoTeC/converter/watcher.js DuckDBtoMoTeC/converter/test/test-convert.js
git commit -m "feat: add convert CLI, watcher, and end-to-end test"
```

---

## Task 7: Electron IPC Integration

**Files:**
- Modify: `app/src/main/main.js`
- Modify: `app/src/main/preload.js`

- [ ] **Step 1: Add IPC handlers to main.js**

Open `app/src/main/main.js`. Find the section with existing `ipcMain.handle` calls (after `const { ipcMain } = require('electron')` imports).

Add at the top of the file, after existing `require` lines:
```js
const { spawn } = require('child_process');
```

Then after `const INSTALL_CACHE_KEY = ...` (or near the other constants), add:
```js
const CONVERTER_DIR = require('path').join(__dirname, '../../../DuckDBtoMoTeC/converter');
let watcherProcess = null;
```

Then add these three handlers alongside the existing `ipcMain.handle` blocks:
```js
ipcMain.handle('convert:run', (_e, { inputPath, outputDir }) => {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [require('path').join(CONVERTER_DIR, 'convert.js'), inputPath, outputDir]);
    const results = [];
    child.stdout.on('data', chunk => {
      for (const line of chunk.toString().split('\n').filter(Boolean)) {
        try { results.push(JSON.parse(line)); } catch {}
        if (win) win.webContents.send('convert:log', line);
      }
    });
    child.stderr.on('data', chunk => {
      if (win) win.webContents.send('convert:log', chunk.toString());
    });
    child.on('close', code =>
      code === 0 ? resolve(results) : reject(new Error(`converter exited with code ${code}`))
    );
  });
});

ipcMain.handle('convert:startWatch', (_e, { watchDir, outputDir }) => {
  if (watcherProcess) return { already: true };
  watcherProcess = spawn('node', [require('path').join(CONVERTER_DIR, 'watcher.js'), watchDir, outputDir]);
  watcherProcess.stdout.on('data', chunk => {
    for (const line of chunk.toString().split('\n').filter(Boolean))
      if (win) win.webContents.send('convert:log', line);
  });
  watcherProcess.stderr.on('data', chunk => {
    if (win) win.webContents.send('convert:log', chunk.toString());
  });
  watcherProcess.on('close', () => { watcherProcess = null; });
  return { started: true };
});

ipcMain.handle('convert:stopWatch', () => {
  if (watcherProcess) { watcherProcess.kill(); watcherProcess = null; }
  return { stopped: true };
});
```

Also find the `app.on('before-quit', ...)` handler (or add one if absent) and add watcher cleanup:
```js
app.on('before-quit', () => {
  if (watcherProcess) { watcherProcess.kill(); watcherProcess = null; }
});
```

- [ ] **Step 2: Update preload.js**

Open `app/src/main/preload.js`. Inside the `contextBridge.exposeInMainWorld('go', { ... })` object, add these entries:

```js
convertRun: (inputPath, outputDir) => ipcRenderer.invoke('convert:run', { inputPath, outputDir }),
startWatch: (watchDir, outputDir) => ipcRenderer.invoke('convert:startWatch', { watchDir, outputDir }),
stopWatch: () => ipcRenderer.invoke('convert:stopWatch'),
onConvertLog: (cb) => {
  const listener = (_e, line) => cb(line);
  ipcRenderer.on('convert:log', listener);
  return () => ipcRenderer.removeListener('convert:log', listener);
},
```

- [ ] **Step 3: Smoke-test IPC from DevTools**

Start the app:
```bash
cd app && npm start
```

Open DevTools (Ctrl+Shift+I). In the Console, run:
```js
await window.go.convertRun(
  'C:/Users/andre/Desktop/LMU-Automatic weather/DuckDBtoMoTeC/examples/GO4 296 LMGT3 MON E Q04 DUCKDB.duckdb',
  'C:/Users/andre/Desktop/LMU-Automatic weather/DuckDBtoMoTeC/examples/'
)
```

Expected: Array of JSON progress objects returned. `.ld` and `.ldx` files created in `examples/`.

- [ ] **Step 4: Commit**

```bash
git add app/src/main/main.js app/src/main/preload.js
git commit -m "feat: wire converter IPC handlers into Electron app"
```

---

## Verification Checklist

After Task 6, before Task 7:
- [ ] Open generated `.ld` in MoTeC i2 Pro
- [ ] Verify laps appear in the lap bar (beacon working)
- [ ] Verify Engine RPM, Throttle, Brake Pos have data traces
- [ ] Verify Susp Pos FL/FR/RL/RR show values in mm range (~50–80 mm)
- [ ] Verify Tyre Temp channels have data
- [ ] Verify Gear channel shows integer values that step correctly

If Beacon value 32 doesn't create lap markers, try value `1` in `duckdb-reader.js` line `beacon[idx] = 32` and reconvert.
