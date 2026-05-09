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

function run(con, sql) {
  return new Promise((resolve, reject) =>
    con.run(sql, (err) => (err ? reject(err) : resolve()))
  );
}

async function readSession(dbPath) {
  // Open in-memory DB and attach the real file READ_ONLY so multiple callers
  // can open the same DuckDB file concurrently (DuckDB does not allow two
  // writers but allows multiple read-only attachments).
  const db = new duckdb.Database(':memory:');
  const con = db.connect();

  try {
    const dbPathFwd = dbPath.split('\\').join('/');
    await run(con, `ATTACH '${dbPathFwd.replace(/'/g, "''")}' AS src (READ_ONLY)`);
    await run(con, 'USE src');

    // Session clock anchor
    const gpsRows = await query(con, 'SELECT value FROM "GPS Time" ORDER BY rowid LIMIT 1');
    if (!gpsRows.length) throw new Error('GPS Time table is empty');
    const sessionStart = gpsRows[0].value;

    // Lap boundaries
    const lapRows = await query(con, 'SELECT ts, value FROM "Lap" ORDER BY ts');
    const laps = lapRows.map(r => ({ ts: r.ts, lapNum: r.value }));

    // Session length in samples at 100 Hz
    const [{ n: totalSamples100HzRaw }] = await query(con, 'SELECT COUNT(*) as n FROM "GPS Time"');
    const totalSamples100Hz = Number(totalSamples100HzRaw);
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
      const [{ n: existsRaw }] = await query(
        con,
        `SELECT COUNT(*) as n FROM information_schema.tables WHERE table_name = '${table.replace(/'/g, "''")}'`
      );
      if (!Number(existsRaw)) continue;

      const freq = ch.isEvent ? EVENT_STEP_FREQ : (freqMap[table] ?? 100);

      if (ch.wheels) {
        const rows = await query(con, `SELECT value1, value2, value3, value4 FROM "${table}"`);
        for (let w = 0; w < 4; w++) {
          const key = `value${w + 1}`;
          const raw = rows.map(r => (r[key] ?? 0) * ch.scale);
          // motecName may contain '{}' as a placeholder for FL/FR/RL/RR (e.g. 'Tyre Temp {} Inner');
          // otherwise the corner is appended (e.g. 'Susp Pos' → 'Susp Pos FL').
          const name = ch.motecName.includes('{}')
            ? ch.motecName.replace('{}', WHEEL_SUFFIX[w])
            : `${ch.motecName} ${WHEEL_SUFFIX[w]}`;
          channels.push({
            name,
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

    // Lap Number channel — MoTeC i2 expects this at 100 Hz with raw encoding:
    // header shift=32760, raw value = actual_lap_number - 32760.
    // Derived from reverse-engineering working .ld files.
    const LAP_NUM_FREQ = 100;
    const lapTimes = laps.map(l => l.ts - sessionStart);
    const lapNums  = laps.map(l => l.lapNum);
    const lapNumRaw = stepHold(lapTimes, lapNums, LAP_NUM_FREQ, sessionDuration)
      .map(v => v - 32760);
    channels.push({
      name: 'Lap Number', shortName: '', unit: '',
      freq: LAP_NUM_FREQ,
      data: lapNumRaw,
      dtype: 'int16',
      shift: 32760,
      flag100: 0x0100, // "lap-related channel" flag at header byte 101 — required for MoTeC i2 lap detection
      chanId: 2101,    // MoTeC well-known ID for Lap Number channel
    });

    // Beacon (Internal) at 1 Hz. Starts at 0 before first crossing, then
    // holds 100 between crossings. Skip laps[0] if ts == sessionStart
    // (LMU init event, not a real crossing). Use Math.ceil so t=0.8s → sample 1.
    //
    // Buffer: Math.ceil(duration) gives room for any t in [0, duration); +3
    // additional samples leave room for the crossing's marker / id / sub-second
    // triple even when the lap completes within the last second of recording.
    // Without this, the trailing crossing was silently dropped, merging the
    // last hot lap with the in-lap.
    const beaconFreq = 1;
    const nBeacon = Math.max(1, Math.ceil(sessionDuration * beaconFreq) + 3);
    const beaconData = new Array(nBeacon).fill(0);
    let prevSi = -1;
    let crossingCount = 0;
    for (let i = 0; i < laps.length; i++) {
      const t = laps[i].ts - sessionStart;
      if (t < 0.01) continue;                                            // skip init event at t≈0
      const si = Math.ceil(t * beaconFreq);
      if (si <= 0 || si >= nBeacon) continue;
      // Fill 100 from end of previous crossing to just before this one
      if (prevSi >= 0) {
        for (let k = prevSi + 3; k < si; k++) beaconData[k] = 100;
      }
      beaconData[si] = -8192;                                            // 0xE000 marker
      if (si + 1 < nBeacon) beaconData[si + 1] = -32754 + crossingCount; // crossing ID (starts at -32754, matching reference format)
      // Sub-second precision: reverse-engineered formula from working .ld files: round(fraction * 978 + 16388)
      if (si + 2 < nBeacon) beaconData[si + 2] = Math.round((t - Math.floor(t)) * 978 + 16388);
      prevSi = si;
      crossingCount++;
    }
    // Fill 100 from after the last crossing to end
    if (prevSi >= 0) {
      for (let k = prevSi + 3; k < nBeacon; k++) beaconData[k] = 100;
    }
    channels.push({ name: 'Beacon (Internal)', shortName: '', unit: '', freq: beaconFreq, data: beaconData, dtype: 'int16', chanId: 110 });

    // Marker channel: 1 Hz int16 zeros. Required by MoTeC for lap-detection
    // alongside Beacon and Lap Number (chanId 310 in MoTeC's registry).
    const markerData = new Array(nBeacon).fill(0);
    channels.push({ name: 'Marker', shortName: '', unit: '', freq: 1, data: markerData, dtype: 'int16', chanId: 310, flag100: 0x0100 });

    return { sessionStart, sessionDuration, laps, meta, channels, totalSamples100Hz };
  } finally {
    await new Promise(resolve => db.close(resolve));
  }
}

function stepHold(eventTimes, eventValues, freq, duration) {
  const nSamples = Math.round(duration * freq);
  const out = new Array(nSamples).fill(0);
  let ei = 0;
  let lastVal = 0;
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

module.exports = { readSession, stepHold };
