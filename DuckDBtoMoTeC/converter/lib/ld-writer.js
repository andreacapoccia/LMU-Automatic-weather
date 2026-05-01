'use strict';
const fs = require('fs');

const VEHICLE_PTR = 1762;
const VENUE_PTR = 5078;
const EVENT_PTR = 8180;
const CHAN_META_START = 11336;
const CHAN_HEAD_SIZE = 124;

function wstr(buf, str, offset, maxLen) {
  const bytes = Buffer.from((str || '').substring(0, maxLen), 'ascii');
  bytes.copy(buf, offset);
}

function parseDateTime(meta) {
  const pad = n => String(n).padStart(2, '0');
  let date = '', time = '';
  if (meta.RecordingTime) {
    const [dp, tp = ''] = meta.RecordingTime.replace('Z', '').split('T');
    const [y, m, d] = dp.split('-');
    date = `${d}/${m}/${y}`;
    time = tp.replace(/_/g, ':').substring(0, 8);
  }
  if (meta.SessionTime) time = meta.SessionTime.substring(0, 8);
  if (!date) { const d = new Date(); date = `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()}`; }
  if (!time) { const d = new Date(); time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; }
  return { date, time };
}

function writeLD(outPath, session) {
  const { channels, laps, sessionDuration } = session;
  const meta = session.meta || {};
  const N = channels.length;

  const bytesPerSample = ch => ch.dtype === 'int16' ? 2 : 4;
  const dataSizes = channels.map(ch => ch.data.length * bytesPerSample(ch));
  const totalData = dataSizes.reduce((a, b) => a + b, 0);
  const fileSize = CHAN_META_START + N * CHAN_HEAD_SIZE + totalData;
  const buf = Buffer.alloc(fileSize, 0);

  const metaPtr = CHAN_META_START;
  const dataPtr = CHAN_META_START + N * CHAN_HEAD_SIZE;
  const dt = parseDateTime(meta);

  // --- ldHead ---
  buf.writeUInt32LE(0x40, 0);
  buf.writeUInt32LE(metaPtr, 8);
  buf.writeUInt32LE(dataPtr, 12);
  buf.writeUInt32LE(EVENT_PTR, 36);
  buf.writeUInt16LE(2, 64);              // matches MoTeC reference (was 1)
  buf.writeUInt16LE(0x4240, 66);
  buf.writeUInt16LE(0xf, 68);
  buf.writeUInt32LE(0x1f44, 70);
  wstr(buf, 'ADL', 74, 8);
  buf.writeUInt16LE(200, 82);            // matches MoTeC reference (was 420)
  buf.writeUInt16LE(0x80, 84);           // matches MoTeC reference (was 0xadb0)
  buf.writeUInt16LE(N, 86);              // n_channels stored as uint16 at offset 86
  buf.writeUInt16LE(N, 88);              // and ALSO at offset 88 (MoTeC reads from both)
  buf.writeUInt32LE(0x00010064, 90);     // unknown constant from reference
  wstr(buf, dt.date, 94, 16);
  wstr(buf, dt.time, 126, 16);
  wstr(buf, meta.DriverName || '', 158, 64);
  wstr(buf, meta.CarName || '', 222, 64);
  wstr(buf, meta.TrackName || '', 350, 64);
  buf.writeUInt32LE(0xc81a4, 1502);

  // --- ldVehicle at VEHICLE_PTR ---
  wstr(buf, meta.CarName || '', VEHICLE_PTR, 64);
  buf.writeUInt32LE(0, VEHICLE_PTR + 192);
  wstr(buf, meta.CarClass || '', VEHICLE_PTR + 196, 32);

  // --- ldVenue at VENUE_PTR ---
  wstr(buf, meta.TrackName || '', VENUE_PTR, 64);
  buf.writeUInt16LE(VEHICLE_PTR, VENUE_PTR + 1098);

  // --- ldEvent at EVENT_PTR ---
  wstr(buf, 'LMU', EVENT_PTR, 64);
  wstr(buf, meta.SessionType || '', EVENT_PTR + 64, 64);
  buf.writeUInt16LE(VENUE_PTR, EVENT_PTR + 1152);

  // --- Channel headers ---
  let curDataPtr = dataPtr;
  for (let i = 0; i < N; i++) {
    const ch = channels[i];
    const off = CHAN_META_START + i * CHAN_HEAD_SIZE;
    const bps = bytesPerSample(ch);
    const dtypeA = ch.dtype === 'int16' ? 0x03 : 0x07;
    const prevMeta = i === 0 ? 0 : CHAN_META_START + (i - 1) * CHAN_HEAD_SIZE;
    const nextMeta = i === N - 1 ? 0 : CHAN_META_START + (i + 1) * CHAN_HEAD_SIZE;

    buf.writeUInt32LE(prevMeta, off);
    buf.writeUInt32LE(nextMeta, off + 4);
    buf.writeUInt32LE(curDataPtr, off + 8);
    buf.writeUInt32LE(ch.data.length, off + 12);
    buf.writeUInt16LE(0x2ee1 + i, off + 16);
    buf.writeUInt16LE(dtypeA, off + 18);
    buf.writeUInt16LE(bps, off + 20);
    buf.writeUInt16LE(ch.freq, off + 22);
    buf.writeUInt16LE(ch.shift ?? 0, off + 24); // shift
    buf.writeUInt16LE(1, off + 26); // mul
    buf.writeUInt16LE(1, off + 28); // scale
    buf.writeInt16LE(0, off + 30);  // dec
    wstr(buf, ch.name, off + 32, 32);
    wstr(buf, ch.shortName || '', off + 64, 8);
    wstr(buf, ch.unit || '', off + 72, 12);

    // Bytes 84-91: channel data range [max, min] — required by MoTeC i2 for channel processing.
    // Int16 channels store as int32 LE; float32 channels store as float32 LE.
    {
      let maxV = -Infinity, minV = Infinity;
      for (const v of ch.data) {
        if (v > maxV) maxV = v;
        if (v < minV) minV = v;
      }
      if (ch.dtype === 'int16') {
        buf.writeInt32LE(maxV, off + 84);
        buf.writeInt32LE(minV, off + 88);
      } else {
        buf.writeFloatLE(maxV, off + 84);
        buf.writeFloatLE(minV, off + 88);
      }
    }

    // Bytes 100-101: channel-class flag. 0x0100 = lap-related channel
    // (required for MoTeC i2 to recognize Lap Number as the lap counter).
    if (ch.flag100) buf.writeUInt16LE(ch.flag100, off + 100);

    curDataPtr += dataSizes[i];
  }

  // --- Channel data ---
  let doff = dataPtr;
  for (let i = 0; i < N; i++) {
    const ch = channels[i];
    if (ch.dtype === 'int16') {
      for (let j = 0; j < ch.data.length; j++) {
        buf.writeInt16LE(ch.data[j], doff + j * 2);
      }
      doff += ch.data.length * 2;
    } else {
      for (let j = 0; j < ch.data.length; j++) {
        buf.writeFloatLE(ch.data[j], doff + j * 4);
      }
      doff += ch.data.length * 4;
    }
  }

  fs.writeFileSync(outPath, buf);
}

module.exports = { writeLD };
