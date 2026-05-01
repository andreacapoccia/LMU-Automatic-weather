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
