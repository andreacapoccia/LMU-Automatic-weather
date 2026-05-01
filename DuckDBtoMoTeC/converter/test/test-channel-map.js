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
