const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { readSession, stepHold } = require('../lib/duckdb-reader');

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

test('stepHold: holds 0 before first event, step-holds values, ends with last value', () => {
  // 2 events: value=5 at t=0.2, value=9 at t=0.7
  // at 10 Hz over 1 second: 10 samples, indices 0..9 = t=0.0..0.9
  const times = [0.2, 0.7];
  const values = [5, 9];
  const result = stepHold(times, values, 10, 1.0);
  assert.strictEqual(result.length, 10);
  assert.strictEqual(result[0], 0);   // t=0.0, before first event
  assert.strictEqual(result[1], 0);   // t=0.1, before first event
  assert.strictEqual(result[2], 5);   // t=0.2, first event fires
  assert.strictEqual(result[6], 5);   // t=0.6, still holding 5
  assert.strictEqual(result[7], 9);   // t=0.7, second event fires
  assert.strictEqual(result[9], 9);   // t=0.9, still holding 9
});
