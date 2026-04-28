// Run while LMU is open and on the main menu.
// Tries multiple loadGame body shapes to find which one LMU accepts.
//
//   node scripts/probe-lmu.js
//
// Dumps everything to ~/Desktop/GO-LMU-debug/probe-*

const fs = require('fs');
const path = require('path');
const os = require('os');

const API = 'http://localhost:6397';
const OUT = path.join(os.homedir(), 'Desktop', 'GO-LMU-debug');
fs.mkdirSync(OUT, { recursive: true });

const dump = (name, content) => {
    const p = path.join(OUT, `probe_${name}`);
    fs.writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
    console.log('  → wrote', p);
};

async function tryLoad(label, body) {
    const t0 = Date.now();
    const r = await fetch(`${API}/rest/sessions/SaveLoad/loadGame`, {
        method: 'POST',
        body: typeof body === 'string' ? body : JSON.stringify(body),
    });
    const txt = await r.text();
    const ms = Date.now() - t0;
    console.log(`  loadGame[${label}] → HTTP ${r.status} (${ms}ms) body="${txt.slice(0, 200)}"`);
    dump(`${label}_request.json`, body);
    dump(`${label}_response.txt`, `HTTP ${r.status}\n${txt}`);
    return { ok: r.ok, status: r.status, body: txt };
}

async function go() {
    console.log('--- Step 1: probe /navigation/state ---');
    const ns = await fetch(`${API}/navigation/state`).catch((e) => ({ error: e.message }));
    if (ns.error) {
        console.log('  LMU not reachable:', ns.error);
        process.exit(1);
    }
    console.log('  alive, HTTP', ns.status);

    console.log('--- Step 2: requestPreset ---');
    const pr = await fetch(`${API}/rest/sessions/SessionPresets/requestPreset`, { method: 'POST' });
    console.log('  HTTP', pr.status);
    const preset = await pr.json();
    dump('preset.json', preset);

    console.log('--- Step 3: getSaveJSON (current session) ---');
    const gs = await fetch(`${API}/rest/sessions/SaveLoad/getSaveJSON`);
    console.log('  HTTP', gs.status);
    let savedJson = null;
    if (gs.ok) {
        const t = await gs.text();
        try { savedJson = JSON.parse(t); } catch { savedJson = t; }
        dump('getSaveJSON.json', savedJson);
    } else {
        const t = await gs.text();
        dump('getSaveJSON_error.txt', `HTTP ${gs.status}\n${t}`);
    }

    console.log('--- Step 4: try various loadGame shapes ---');

    // 4a: echo getSaveJSON back exactly (most likely to succeed if LMU has a session)
    if (savedJson && typeof savedJson === 'object') {
        await tryLoad('a_getSaveJSON_echo', savedJson);
    } else {
        console.log('  (skipping 4a — no getSaveJSON to echo)');
    }

    // 4b: wrap preset in {save: {SessionPreset: preset}}
    await tryLoad('b_wrap_preset', { save: { RealRoad: null, SessionPreset: preset } });

    // 4c: wrap preset directly under save (no SessionPreset key)
    await tryLoad('c_save_preset', { save: preset });

    // 4d: just the preset, no wrapper
    await tryLoad('d_raw_preset', preset);

    // 4e: wrap inside save.SessionPreset PLUS empty top-level Weather
    await tryLoad('e_with_weather_array', {
        save: {
            RealRoad: null,
            SessionPreset: preset,
            VehicleSetup: '',
            Weather: [],
        },
    });

    console.log('\nDone. Check the GO-LMU-debug/ folder for probe_* files.');
    console.log('Look for any "HTTP 200/204" — that body shape is the one we want.');
}

go().catch((e) => {
    console.error('FATAL:', e);
    process.exit(1);
});
