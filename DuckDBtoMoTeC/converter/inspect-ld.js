'use strict';
// Inspector for produced .ld files. Reads channel headers and dumps the
// Beacon (chanId=110), Lap Number (chanId=2101), and Marker (chanId=310)
// channels so we can verify what MoTeC i2 will see for lap detection.
//
// Auto-detects the channel meta start offset from the file header (we use
// 11336; other LMU→MoTeC tools and MoTeC i2 re-saves use different offsets).
//
// Usage: node inspect-ld.js path/to/file.ld [more.ld ...]
//        LIST_ALL=1 node inspect-ld.js file.ld   (also prints every channel name)
const fs = require('fs');

const CHAN_HEAD_SIZE = 124;

function readStr(buf, off, len) {
  return buf.slice(off, off + len).toString('ascii').replace(/\0.*$/, '');
}

function inspect(path) {
  const buf = fs.readFileSync(path);
  const N = buf.readUInt32LE(86);
  const META_START = buf.readUInt32LE(8);
  console.log(`\n=== ${path}`);
  console.log(`channels: ${N}, metaStart: ${META_START}`);

  const channels = [];
  for (let i = 0; i < N; i++) {
    const off = META_START + i * CHAN_HEAD_SIZE;
    channels.push({
      idx: i,
      dataPtr: buf.readUInt32LE(off + 8),
      nSamples: buf.readUInt32LE(off + 12),
      chanId: buf.readUInt16LE(off + 16),
      dtypeA: buf.readUInt16LE(off + 18),
      bps: buf.readUInt16LE(off + 20),
      freq: buf.readUInt16LE(off + 22),
      shift: buf.readUInt16LE(off + 24),
      name: readStr(buf, off + 32, 32),
      shortName: readStr(buf, off + 64, 8),
      unit: readStr(buf, off + 72, 12),
      flag100: buf.readUInt16LE(off + 100),
    });
  }

  for (const ch of channels) {
    if (ch.chanId === 110 || ch.chanId === 2101 || ch.chanId === 310 || /Beacon|Lap Number|Marker|Lap$/i.test(ch.name)) {
      console.log(`  ch[${ch.idx}] id=${ch.chanId} name="${ch.name}" freq=${ch.freq}Hz n=${ch.nSamples} dtype=${ch.dtypeA === 3 ? 'int16' : 'float32'} shift=${ch.shift} flag100=0x${ch.flag100.toString(16)}`);
    }
  }
  if (process.env.LIST_ALL) {
    console.log('\n--- all channels ---');
    for (const ch of channels) {
      console.log(`  ch[${ch.idx}] id=${ch.chanId} "${ch.name}" ${ch.freq}Hz n=${ch.nSamples}`);
    }
  }

  const beacon = channels.find(c => c.chanId === 110) || channels.find(c => /Beacon/i.test(c.name));
  if (beacon) {
    console.log(`\n--- Beacon (id=${beacon.chanId} "${beacon.name}") crossings ---`);
    const data = [];
    for (let i = 0; i < beacon.nSamples; i++) data.push(buf.readInt16LE(beacon.dataPtr + i * 2));
    let crossings = 0;
    for (let i = 0; i < data.length; i++) {
      if (data[i] === -8192) {
        const sub = i + 2 < data.length ? data[i + 2] : null;
        const fraction = sub != null ? (sub - 16388) / 978 : null;
        const id = i + 1 < data.length ? data[i + 1] : null;
        const idDecoded = id != null ? id - (-32754) : null;
        console.log(`  crossing #${crossings}: sample=${i} (t≈${i}s) sub=${sub} (fraction≈${fraction?.toFixed(3)}) crossingId=${id} (count=${idDecoded})`);
        crossings++;
      }
    }
    console.log(`  total crossings: ${crossings}`);
    console.log(`  data length (= sessionDuration in s at ${beacon.freq}Hz): ${data.length}`);
    console.log(`  first 12 samples: ${data.slice(0, 12).join(',')}`);
    console.log(`  last 12 samples:  ${data.slice(-12).join(',')}`);
  }

  const lapNum = channels.find(c => c.chanId === 2101) || channels.find(c => /Lap Number/i.test(c.name));
  if (lapNum) {
    console.log(`\n--- Lap Number (id=${lapNum.chanId} "${lapNum.name}") ---`);
    const data = [];
    for (let i = 0; i < lapNum.nSamples; i++) data.push(buf.readInt16LE(lapNum.dataPtr + i * 2));
    const transitions = [];
    for (let i = 1; i < data.length; i++) {
      if (data[i] !== data[i - 1]) {
        const t = i / lapNum.freq;
        transitions.push({ t, from: data[i - 1] + lapNum.shift, to: data[i] + lapNum.shift, sample: i });
      }
    }
    console.log(`  shift=${lapNum.shift}, so actual_lap = raw + ${lapNum.shift}`);
    console.log(`  initial value (raw): ${data[0]} → actual lap ${data[0] + lapNum.shift}`);
    console.log(`  final value (raw):   ${data[data.length-1]} → actual lap ${data[data.length-1] + lapNum.shift}`);
    console.log(`  ${transitions.length} transitions:`);
    for (const t of transitions.slice(0, 50)) {
      console.log(`    t=${t.t.toFixed(2)}s  lap ${t.from} → ${t.to}  (sample ${t.sample})`);
    }
    if (transitions.length > 50) console.log(`    ... (+${transitions.length - 50} more)`);
  }
}

for (const p of process.argv.slice(2)) inspect(p);
