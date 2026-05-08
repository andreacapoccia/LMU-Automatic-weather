'use strict';
const path = require('path');
const { readSession } = require('./lib/duckdb-reader');
const { writeLD } = require('./lib/ld-writer');
const { writeLDX } = require('./lib/ldx-writer');

function log(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

// Strip filesystem-unsafe characters and collapse whitespace to single dashes.
function sanitize(s) {
  return String(s || '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// Substitute {token} placeholders with values from session metadata.
// Returns null if the result is empty/whitespace (caller falls back to inputPath basename).
function applyNamingTemplate(template, inputPath, meta) {
  if (!template) return null;
  const rt = meta.RecordingTime || '';
  const [datePart = '', timePart = ''] = rt.replace('Z', '').split('T');
  const date = datePart;                                // YYYY-MM-DD
  const time = (meta.SessionTime || timePart).substring(0, 8).replace(/:/g, '-');  // HH-mm-ss with dashes (no colons in filenames)
  const tokens = {
    '{date}': date,
    '{time}': time,
    '{track}': sanitize(meta.TrackName),
    '{layout}': sanitize(meta.SessionConfig || meta.Layout || ''),
    '{car}': sanitize(meta.CarName),
    '{class}': sanitize(meta.CarClass),
    '{driver}': sanitize(meta.DriverName),
    '{session}': sanitize(meta.SessionType),
  };
  let out = template;
  for (const [k, v] of Object.entries(tokens)) out = out.split(k).join(v);
  out = out.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim();
  return out || null;
}

async function convert(inputPath, outputDir, namingTemplate) {
  log({ type: 'start', file: inputPath });

  const session = await readSession(inputPath);
  log({ type: 'progress', step: 'read', channels: session.channels.length, laps: session.laps.length });

  const fallback = path.basename(inputPath, '.duckdb');
  const baseName = applyNamingTemplate(namingTemplate, inputPath, session.meta || {}) || fallback;
  const ldPath = path.join(outputDir, baseName + '.ld');
  const ldxPath = path.join(outputDir, baseName + '.ldx');

  writeLD(ldPath, session);
  log({ type: 'progress', step: 'ld', path: ldPath });

  writeLDX(ldxPath, session);
  log({ type: 'done', ld: ldPath, ldx: ldxPath });
}

if (require.main === module) {
  const [,, inputPath, outputDir, namingTemplate] = process.argv;
  if (!inputPath || !outputDir) {
    process.stderr.write('Usage: node convert.js <input.duckdb> <outputDir> [namingTemplate]\n');
    process.exit(1);
  }
  convert(inputPath, outputDir, namingTemplate).catch(err => {
    process.stderr.write(JSON.stringify({ type: 'error', message: err.message }) + '\n');
    process.exit(1);
  });
}

module.exports = { convert, applyNamingTemplate };
