'use strict';
const fs = require('fs');

// Dump Beacon (Internal) raw values from a .ld file
const ldPath = process.argv[2];
if (!ldPath) { console.error('Usage: node diagnose6.js <file.ld>'); process.exit(1); }

const buf = fs.readFileSync(ldPath);
const metaPtr = buf.readUInt32LE(8);
const dataPtr = buf.readUInt32LE(12);
const CHAN_HEAD = 124;
const nChans = Math.round((dataPtr - metaPtr) / CHAN_HEAD);

console.log(`metaPtr=${metaPtr} dataPtr=${dataPtr} nChans=${nChans}`);

for (let i = 0; i < nChans; i++) {
  const off = metaPtr + i * CHAN_HEAD;
  if (off + CHAN_HEAD > buf.length) break;
  const name = buf.slice(off + 32, off + 64).toString('ascii').replace(/\0/g, '');
  const lname = name.toLowerCase();

  if (!lname.includes('beacon') && lname !== 'lap number') continue;

  const chDataPtr = buf.readUInt32LE(off + 8);
  const nSamples  = buf.readUInt32LE(off + 12);
  const dtypeA    = buf.readUInt16LE(off + 18);
  const dtype     = buf.readUInt16LE(off + 20);
  const freq      = buf.readUInt16LE(off + 22);
  const shift     = buf.readUInt16LE(off + 24);

  console.log(`\n=== [${i}] "${name}" freq=${freq}Hz dtype=0x${dtypeA.toString(16)}/${dtype} n=${nSamples} shift=${shift} dataPtr=${chDataPtr} ===`);

  if (dtypeA === 0x03 && dtype === 2) {
    // int16
    const allVals = [];
    for (let j = 0; j < nSamples; j++) {
      allVals.push(buf.readInt16LE(chDataPtr + j * 2));
    }

    console.log('  First 15:', allVals.slice(0, 15));
    console.log('  Last  10:', allVals.slice(-10));

    const unique = [...new Set(allVals)].sort((a, b) => a - b);
    console.log('  Unique values:', unique.length <= 20 ? unique : unique.slice(0, 10).concat(['...', ...unique.slice(-5)]));

    const crossings = allVals.reduce((acc, v, j) => {
      if (v === -8192) acc.push({ sample: j, t: (j / freq).toFixed(3) + 's' });
      return acc;
    }, []);
    console.log('  -8192 crossings:', crossings.length, crossings);

    if (lname === 'lap number') {
      let pv = allVals[0];
      const transitions = [];
      for (let j = 1; j < allVals.length; j++) {
        if (allVals[j] !== pv) {
          transitions.push({ sample: j, t: (j / freq).toFixed(3) + 's', from: pv, physical_from: pv + shift, to: allVals[j], physical_to: allVals[j] + shift });
          pv = allVals[j];
        }
      }
      console.log('  Lap Number transitions:', transitions);
    }
  }
}
