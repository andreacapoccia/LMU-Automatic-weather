'use strict';
const fs = require('fs');

// Reads .ld channel headers and dumps key channels
const ldPath = process.argv[2];
if (!ldPath) { console.error('Usage: node diagnose3.js <file.ld>'); process.exit(1); }

const buf = fs.readFileSync(ldPath);

const metaPtr = buf.readUInt32LE(8);
const dataPtr = buf.readUInt32LE(12);
const nChans  = buf.readUInt32LE(86);

console.log('File size:', buf.length, 'bytes');
console.log('metaPtr:', metaPtr, 'dataPtr:', dataPtr, 'nChans:', nChans);
console.log('Chan head size implied:', nChans ? (dataPtr - metaPtr) / nChans : 'N/A');

const CHAN_HEAD = 124;
const WATCH = ['beacon', 'lap number', 'lap'];

for (let i = 0; i < nChans; i++) {
  const off = metaPtr + i * CHAN_HEAD;
  const prev     = buf.readUInt32LE(off);
  const next     = buf.readUInt32LE(off + 4);
  const chDataPtr= buf.readUInt32LE(off + 8);
  const nSamples = buf.readUInt32LE(off + 12);
  const dtypeA   = buf.readUInt16LE(off + 18);
  const dtype    = buf.readUInt16LE(off + 20);
  const freq     = buf.readUInt16LE(off + 22);
  const shift    = buf.readUInt16LE(off + 24);
  const mul      = buf.readUInt16LE(off + 26);
  const scale    = buf.readUInt16LE(off + 28);
  const dec      = buf.readInt16LE(off + 30);
  const name     = buf.slice(off + 32, off + 64).toString('ascii').replace(/\0/g, '');
  const shortName= buf.slice(off + 64, off + 72).toString('ascii').replace(/\0/g, '');
  const unit     = buf.slice(off + 72, off + 84).toString('ascii').replace(/\0/g, '');

  if (!WATCH.includes(name.toLowerCase())) continue;

  const bps = dtype;  // 2=int16, 4=float32
  const isInt16 = dtypeA === 0x03 && bps === 2;

  console.log('\n===', name, '===');
  console.log('  shortName:', shortName, '  unit:', unit);
  console.log('  dtypeA:', '0x' + dtypeA.toString(16), ' dtype:', dtype, ' freq:', freq, 'Hz');
  console.log('  shift:', shift, ' mul:', mul, ' scale:', scale, ' dec:', dec);
  console.log('  nSamples:', nSamples, '  dataPtr:', chDataPtr, '  isInt16:', isInt16);
  console.log('  prev:', prev, '  next:', next);

  // Sample first and last 5 values
  if (isInt16 && nSamples > 0) {
    const show = Math.min(10, nSamples);
    const vals = [];
    for (let j = 0; j < show; j++) {
      vals.push(buf.readInt16LE(chDataPtr + j * 2));
    }
    console.log('  First', show, 'raw int16 values:', vals);

    if (nSamples > 10) {
      const last = [];
      for (let j = Math.max(0, nSamples - 5); j < nSamples; j++) {
        last.push(buf.readInt16LE(chDataPtr + j * 2));
      }
      console.log('  Last 5 raw int16 values:', last);
    }

    // Find all transitions for Lap Number
    if (name.toLowerCase() === 'lap number') {
      let prev_val = buf.readInt16LE(chDataPtr);
      const transitions = [];
      for (let j = 1; j < nSamples; j++) {
        const v = buf.readInt16LE(chDataPtr + j * 2);
        if (v !== prev_val) {
          transitions.push({ sample: j, t: (j / freq).toFixed(3) + 's', from: prev_val, to: v });
          prev_val = v;
        }
      }
      console.log('  Lap Number transitions:', transitions.length);
      transitions.slice(0, 10).forEach(t => console.log('   ', t));
    }

    // Find beacon crossings (-8192 markers)
    if (name.toLowerCase().includes('beacon')) {
      const crossings = [];
      for (let j = 0; j < nSamples; j++) {
        const v = buf.readInt16LE(chDataPtr + j * 2);
        if (v === -8192) {
          crossings.push({ sample: j, t: (j / freq).toFixed(3) + 's' });
        }
      }
      console.log('  Beacon -8192 crossings:', crossings.length, crossings);
    }
  }
}
