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
