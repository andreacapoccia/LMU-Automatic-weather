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
}, { timeout: 60000 });
