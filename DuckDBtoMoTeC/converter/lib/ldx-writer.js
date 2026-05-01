'use strict';
const fs = require('fs');

function writeLDX(outPath, session) {
  const { laps, sessionDuration, sessionStart } = session;

  if (laps.length === 0) {
    const xml = [
      '<?xml version="1.0"?>',
      '<LDXFile Locale="English_US.1252" DefaultLocale="C" Version="1.6">',
      ' <Layers>',
      '  <Details>',
      '   <String Id="Total Laps" Value="1"/>',
      '   <String Id="Fastest Time" Value=""/>',
      '   <String Id="Fastest Lap" Value="1"/>',
      '  </Details>',
      ' </Layers>',
      '</LDXFile>',
    ].join('\n');
    fs.writeFileSync(outPath, xml, 'utf8');
    return;
  }

  // Lap times: duration from start of lap[i] to start of lap[i+1].
  // Exclude the last lap (always incomplete) and laps[0] if it's an init
  // event at ts==sessionStart (partial lap started before recording).
  const lapTimes = laps.map((lap, i) => {
    if (i + 1 < laps.length) return laps[i + 1].ts - lap.ts;
    const sessionEnd = (sessionStart ?? laps[0].ts) + sessionDuration;
    return sessionEnd - lap.ts;
  });

  // Only consider laps that are (a) not the last incomplete segment and
  // (b) not the initial partial lap (first event at session start).
  const isInitLap = laps.length > 0 && Math.abs(laps[0].ts - sessionStart) < 0.05;
  const firstValid = isInitLap ? 1 : 0;
  const validTimes = lapTimes.slice(firstValid, -1);  // exclude last incomplete lap

  let fastestIdx, fastestSecs;
  if (validTimes.length > 0) {
    const localIdx = validTimes.indexOf(Math.min(...validTimes));
    fastestIdx = localIdx + firstValid;
    fastestSecs = validTimes[localIdx];
  } else {
    fastestIdx = 0;
    fastestSecs = lapTimes[0] ?? 0;
  }

  const xml = [
    '<?xml version="1.0"?>',
    '<LDXFile Locale="English_US.1252" DefaultLocale="C" Version="1.6">',
    ' <Layers>',
    '  <Details>',
    `   <String Id="Total Laps" Value="${laps.length}"/>`,
    `   <String Id="Fastest Time" Value="${formatLapTime(fastestSecs)}"/>`,
    `   <String Id="Fastest Lap" Value="${fastestIdx + 1}"/>`,
    '  </Details>',
    ' </Layers>',
    '</LDXFile>',
  ].join('\n');

  fs.writeFileSync(outPath, xml, 'utf8');
}

function formatLapTime(seconds) {
  const m = Math.floor(seconds / 60);
  const rem = seconds - m * 60;
  let s = Math.floor(rem);
  let ms = Math.round((rem - s) * 1000);
  if (ms === 1000) { ms = 0; s += 1; }
  return `${m}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

module.exports = { writeLDX };
