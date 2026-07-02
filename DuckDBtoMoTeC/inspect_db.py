import duckdb

conn = duckdb.connect('C:/Users/andre/Desktop/LMU-Automatic weather/DuckDBtoMoTeC/examples/GO4 296 LMGT3 MON E Q04 DUCKDB.duckdb', read_only=True)
tables = conn.execute('SHOW TABLES').fetchall()
print('=== TABLES ===')
for t in tables:
    print(t[0])
print()

for t in tables:
    name = t[0]
    count = conn.execute(f'SELECT COUNT(*) FROM "{name}"').fetchone()[0]
    cols = conn.execute(f'DESCRIBE "{name}"').fetchall()
    print(f'--- {name} ({count} rows) ---')
    for c in cols:
        print(f'  {c[0]}: {c[1]}')
    # Show sample values for small/important tables
    if count > 0 and count < 50:
        rows = conn.execute(f'SELECT * FROM "{name}"').fetchall()
        for r in rows:
            print(f'  ROW: {r}')
    elif count > 0:
        rows = conn.execute(f'SELECT * FROM "{name}" LIMIT 3').fetchall()
        for r in rows:
            print(f'  SAMPLE: {r}')
    print()

conn.close()
