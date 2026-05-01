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

test('empty laps does not crash and writes Total Laps = 1', () => {
  const f = path.join(os.tmpdir(), 'test5.ldx');
  writeLDX(f, { laps: [], sessionDuration: 100 });
  const xml = fs.readFileSync(f, 'utf8');
  assert.ok(xml.includes('Total Laps" Value="1"'));
  fs.unlinkSync(f);
});

test('last lap duration accounts for session start, not lap 0 ts', () => {
  // sessionStart = 668.985 (GPS anchor)
  // lap 0 at ts=700 (out-lap), lap 1 at ts=800
  // sessionDuration = 200 → sessionEnd = 668.985 + 200 = 868.985
  // lap 0 time = 800 - 700 = 100s (not used for last lap)
  // lap 1 time = 868.985 - 800 = 68.985s
  // fastest = lap 2 (68.985 < 100)
  const f = path.join(os.tmpdir(), 'test6.ldx');
  writeLDX(f, { laps: [{ ts: 700 }, { ts: 800 }], sessionDuration: 200, sessionStart: 668.985 });
  const xml = fs.readFileSync(f, 'utf8');
  assert.ok(xml.includes('Fastest Lap" Value="2"'), `expected lap 2 fastest: ${xml}`);
  fs.unlinkSync(f);
});
