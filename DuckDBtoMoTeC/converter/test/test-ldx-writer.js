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
