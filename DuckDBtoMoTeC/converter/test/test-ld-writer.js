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
