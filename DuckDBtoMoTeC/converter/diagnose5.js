'use strict';
const duckdb = require('duckdb');
const fs = require('fs');

// Usage: node diagnose5.js <file.duckdb> [file.ld]
const dbPath = process.argv[2];
const ldPath = process.argv[3];

if (!dbPath) { console.error('Usage: node diagnose5.js <file.duckdb> [file.ld]'); process.exit(1); }

// === 1. Query Lap Time event ===
const db = new duckdb.Database(':memory:');
const con = db.connect();
const fwd = dbPath.split('\\').join('/');

con.run(`ATTACH '${fwd.replace(/'/g, "''")}' AS src (READ_ONLY)`, () => {
  con.run('USE src', () => {

    con.all('SELECT ts, value FROM "Lap Time" ORDER BY ts', (e1, r1) => {
      console.log('=== Lap Time events ===');
      if (e1) { console.log('ERROR:', e1.message); }
      else { console.log(JSON.stringify(r1, null, 2)); }

      con.all('SELECT ts, value FROM "Current LapTime" ORDER BY ts LIMIT 20', (e2, r2) => {
        console.log('\n=== Current LapTime (first 20) ===');
        if (e2) { console.log('ERROR:', e2.message); }
        else { console.log(JSON.stringify(r2, null, 2)); }

        con.all('SELECT value FROM "GPS Time" ORDER BY rowid LIMIT 1', (e3, r3) => {
          const sessionStart = r3 && r3[0] ? r3[0].value : null;
          console.log('\nsessionStart:', sessionStart);

          if (r1 && sessionStart) {
            console.log('\n=== Lap Time relative to session start ===');
            r1.forEach((row, i) => {
              console.log(`  LapTime event ${i}: ts=${row.ts}  rel=${(row.ts - sessionStart).toFixed(4)}s  laptime=${row.value}s`);
            });
          }

          db.close(() => {
            // === 2. Dump ALL channel names from .ld file ===
            if (ldPath && fs.existsSync(ldPath)) {
              console.log('\n=== .ld file channel list ===');
              const buf = fs.readFileSync(ldPath);
              const metaPtr = buf.readUInt32LE(8);
              const dataPtr = buf.readUInt32LE(12);
              const CHAN_HEAD = 124;
              const nByHeaders = (dataPtr - metaPtr) / CHAN_HEAD;
              console.log(`metaPtr=${metaPtr} dataPtr=${dataPtr} implied nChans=${nByHeaders}`);

              for (let i = 0; i < nByHeaders; i++) {
                const off = metaPtr + i * CHAN_HEAD;
                if (off + CHAN_HEAD > buf.length) break;
                const name = buf.slice(off + 32, off + 64).toString('ascii').replace(/\0/g, '');
                const freq = buf.readUInt16LE(off + 22);
                const dtypeA = buf.readUInt16LE(off + 18);
                const nSamples = buf.readUInt32LE(off + 12);
                const shift = buf.readUInt16LE(off + 24);
                console.log(`  [${i}] "${name}" freq=${freq}Hz dtype=0x${dtypeA.toString(16)} n=${nSamples} shift=${shift}`);
              }
            }
            process.exit(0);
          });
        });
      });
    });
  });
});
