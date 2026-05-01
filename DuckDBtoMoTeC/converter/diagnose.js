'use strict';
const duckdb = require('duckdb');

const dbPath = process.argv[2];
if (!dbPath) { console.error('Usage: node diagnose.js <file.duckdb>'); process.exit(1); }

const db = new duckdb.Database(':memory:');
const con = db.connect();
const fwd = dbPath.split('\\').join('/');

con.run(`ATTACH '${fwd.replace(/'/g,"''")}' AS src (READ_ONLY)`, () => {
  con.run('USE src', () => {
    con.all("SELECT table_name FROM information_schema.tables ORDER BY table_name", (err, tbls) => {
      if (err) { console.log('tables error:', err.message); return; }
      console.log('=== Tables in DuckDB ===');
      tbls.forEach(t => console.log(' ', t.table_name));

      con.all('SELECT COUNT(*) as n FROM "Lap"', (err2, rows) => {
        if (err2) { console.log('\nLap table ERROR:', err2.message); }
        else {
          console.log('\n=== Lap table ===');
          console.log('Row count:', rows[0].n);
          if (Number(rows[0].n) > 0) {
            con.all('SELECT * FROM "Lap" LIMIT 10', (err3, r2) => {
              console.log('First 10 rows:', JSON.stringify(r2, null, 2));
              db.close(() => process.exit(0));
            });
          } else {
            db.close(() => process.exit(0));
          }
        }
      });
    });
  });
});
