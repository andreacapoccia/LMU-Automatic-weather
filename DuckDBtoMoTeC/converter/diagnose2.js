'use strict';
const duckdb = require('duckdb');

const dbPath = process.argv[2];
if (!dbPath) { console.error('Usage: node diagnose2.js <file.duckdb>'); process.exit(1); }

const db = new duckdb.Database(':memory:');
const con = db.connect();
const fwd = dbPath.split('\\').join('/');

con.run(`ATTACH '${fwd.replace(/'/g, "''")}' AS src (READ_ONLY)`, () => {
  con.run('USE src', () => {
    con.all('SELECT value FROM "GPS Time" ORDER BY rowid LIMIT 3', (e1, r1) => {
      console.log('GPS Time first 3 values:', JSON.stringify(r1));

      con.all('SELECT value FROM "GPS Time" ORDER BY rowid DESC LIMIT 1', (e2, r2) => {
        console.log('GPS Time last value:    ', JSON.stringify(r2));

        con.all('SELECT COUNT(*) as n FROM "GPS Time"', (e3, r3) => {
          const n = Number(r3[0].n);
          console.log('GPS Time row count:     ', n, '→ duration:', (n / 100).toFixed(2), 's');

          con.all('SELECT ts, value FROM "Lap" ORDER BY ts', (e4, r4) => {
            console.log('\nLap rows:', JSON.stringify(r4, null, 2));

            if (r4 && r4.length && r1 && r1.length) {
              const sessionStart = r1[0].value;
              console.log('\nsessionStart (GPS Time[0]):', sessionStart);
              r4.forEach((row, i) => {
                console.log(`  Lap event ${i}: ts=${row.ts}  relativeTime=${(row.ts - sessionStart).toFixed(3)}s`);
              });
            }

            db.close(() => process.exit(0));
          });
        });
      });
    });
  });
});
