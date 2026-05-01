'use strict';
const fs = require('fs');

function writeLDX(outPath, session) {
  const { laps, sessionDuration } = session;

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

  // Lap times: duration from start of lap[i] to start of lap[i+1]
  // Last lap: from lap[N-1].ts to estimated session end
  const lapTimes = laps.map((lap, i) => {
    if (i + 1 < laps.length) return laps[i + 1].ts - lap.ts;
    // Last lap: session end estimated from duration and first lap start
    const sessionEnd = laps[0].ts + sessionDuration;
    return sessionEnd - lap.ts;
  });

  const fastestIdx = lapTimes.indexOf(Math.min(...lapTimes));
  const fastestSecs = lapTimes[fastestIdx];

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
