// Patches LFM's app.asar to log every fetch() call to ~/Desktop/GO-LMU-debug/lfm-fetch.log.
// Run BEFORE launching LFM:   node scripts/patch-lfm.js install
// Restore the original after:  node scripts/patch-lfm.js restore

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawnSync } = require('child_process');

const LFM_RESOURCES = 'C:\\Users\\andre\\AppData\\Local\\Programs\\LFM App\\resources';
const ASAR = path.join(LFM_RESOURCES, 'app.asar');
const ASAR_BAK = path.join(LFM_RESOURCES, 'app.asar.bak');
const STAGING = path.join(__dirname, '..', '_lfm_patch_stage');
const LOG_DIR = path.join(os.homedir(), 'Desktop', 'GO-LMU-debug');
const LOG_FILE = path.join(LOG_DIR, 'lfm-fetch.log');

const PATCH = `
// ─── GO Setups fetch interceptor ────────────────────────────────────────
;(function(){
  const fs = require('fs');
  const LOG = ${JSON.stringify(LOG_FILE.replace(/\\/g, '\\\\'))};
  try { fs.mkdirSync(require('path').dirname(LOG), {recursive:true}); } catch {}
  fs.writeFileSync(LOG, '=== fetch log started ' + new Date().toISOString() + ' ===\\n');
  function append(line){ try { fs.appendFileSync(LOG, line + '\\n'); } catch{} }
  const origFetch = globalThis.fetch;
  globalThis.fetch = async function(input, init){
    const url = typeof input === 'string' ? input : input.url;
    const method = (init && init.method) || (typeof input === 'object' && input.method) || 'GET';
    const body = init && init.body;
    const ts = new Date().toISOString();
    append('--- REQUEST ' + ts + ' ---');
    append(method + ' ' + url);
    if (init && init.headers) append('headers=' + JSON.stringify(init.headers));
    if (body) append('body=' + (typeof body === 'string' ? body : JSON.stringify(body)));
    let resp;
    try {
      resp = await origFetch.call(this, input, init);
    } catch(e){
      append('NETWORK ERROR: ' + e.message);
      throw e;
    }
    append('  → HTTP ' + resp.status);
    // Tee body via clone
    try {
      const cloned = resp.clone();
      const txt = await cloned.text();
      append('  body=' + txt);
    } catch(e) {
      append('  (body read failed: ' + e.message + ')');
    }
    append('');
    return resp;
  };
})();
// ─── end interceptor ────────────────────────────────────────────────────

`;

const ASAR_BIN = path.join(__dirname, '..', 'node_modules', '@electron', 'asar', 'bin', 'asar.js');
function runAsar(args) {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const r = spawnSync(process.execPath, [ASAR_BIN, ...args], {
        stdio: 'inherit',
        env,
        shell: false,
    });
    if (r.status !== 0) throw new Error(`asar ${args[0]} failed (exit ${r.status})`);
}

function killLfm() {
    try {
        execSync('taskkill /IM "LFM App.exe" /F', { stdio: 'pipe' });
    } catch {}
}

async function install() {
    if (fs.existsSync(ASAR_BAK)) {
        console.log('Backup already exists at app.asar.bak — skipping backup step.');
    } else {
        console.log('Backing up app.asar → app.asar.bak');
        fs.copyFileSync(ASAR, ASAR_BAK);
    }

    console.log('Killing any running LFM…');
    killLfm();

    console.log('Cleaning staging dir');
    if (fs.existsSync(STAGING)) fs.rmSync(STAGING, { recursive: true, force: true });
    fs.mkdirSync(STAGING, { recursive: true });

    // Extract from the live asar (its sibling app.asar.unpacked is in place).
    // We restore later by copying .bak back over.
    console.log('Extracting app.asar → staging');
    runAsar(['extract', ASAR, STAGING]);

    const mainJs = path.join(STAGING, 'dist', 'main', 'main.js');
    console.log('Patching ' + mainJs);
    const orig = fs.readFileSync(mainJs, 'utf8');
    if (orig.includes('GO Setups fetch interceptor')) {
        console.log('Already patched — skipping.');
    } else {
        fs.writeFileSync(mainJs, PATCH + orig);
    }

    console.log('Re-packing → app.asar');
    fs.unlinkSync(ASAR);
    runAsar(['pack', STAGING, ASAR]);

    console.log('\n✅ Patched. Launch LFM normally — every fetch() will be logged to:');
    console.log('   ' + LOG_FILE);
    console.log('\nRun  node scripts/patch-lfm.js restore  to put the original back.');
}

function restore() {
    if (!fs.existsSync(ASAR_BAK)) {
        console.error('No app.asar.bak found — nothing to restore.');
        process.exit(1);
    }
    console.log('Killing any running LFM…');
    killLfm();
    console.log('Restoring app.asar from backup');
    fs.copyFileSync(ASAR_BAK, ASAR);
    if (fs.existsSync(STAGING)) fs.rmSync(STAGING, { recursive: true, force: true });
    console.log('✅ Restored.');
}

const cmd = process.argv[2];
if (cmd === 'install') install().catch((e) => { console.error(e); process.exit(1); });
else if (cmd === 'restore') restore();
else {
    console.log('Usage: node scripts/patch-lfm.js install|restore');
    process.exit(1);
}
