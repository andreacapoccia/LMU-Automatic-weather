'use strict';
const duckdb = require('duckdb');

const dbPath = process.argv[2];
if (!dbPath) { console.error('Usage: node diagnose4.js <file.duckdb>'); process.exit(1); }

const db = new duckdb.Database(':memory:');
const con = db.connect();
const fwd = dbPath.split('\\').join('/');

con.run(`ATTACH '${fwd.replace(/'/g, "''")}' AS src (READ_ONLY)`, () => {
  con.run('USE src', () => {

    con.all('SELECT * FROM channelsList ORDER BY channelName', (e1, r1) => {
      console.log('=== channelsList ===');
      console.log(JSON.stringify(r1, null, 2));

      con.all('SELECT * FROM eventsList ORDER BY eventName', (e2, r2) => {
        console.log('\n=== eventsList ===');
        console.log(JSON.stringify(r2, null, 2));

        // Check columns of the Lap table
        con.all("DESCRIBE \"Lap\"", (e3, r3) => {
          console.log('\n=== Lap table schema ===');
          console.log(JSON.stringify(r3, null, 2));

          con.all('SELECT * FROM "Lap" LIMIT 10', (e4, r4) => {
            console.log('\n=== Lap table data ===');
            console.log(JSON.stringify(r4, null, 2));

            db.close(() => process.exit(0));
          });
        });
      });
    });
  });
});
