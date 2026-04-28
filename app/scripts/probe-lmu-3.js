// Round 3 — try preserving Grid, matching Allowed Vehicles to Vehicle's car class,
// and other shapes that more closely mirror what LMU returns.

const fs = require('fs');
const path = require('path');
const os = require('os');

const API = 'http://localhost:6397';
const OUT = path.join(os.homedir(), 'Desktop', 'GO-LMU-debug');
fs.mkdirSync(OUT, { recursive: true });

const dump = (n, c) =>
    fs.writeFileSync(path.join(OUT, `probe3_${n}`), typeof c === 'string' ? c : JSON.stringify(c, null, 2));

async function tryLoad(label, body, headers) {
    const r = await fetch(`${API}/rest/sessions/SaveLoad/loadGame`, {
        method: 'POST',
        headers: headers || { 'Content-Type': 'application/json' },
        body: typeof body === 'string' ? body : JSON.stringify(body),
    });
    const txt = await r.text();
    console.log(`  [${label}] HTTP ${r.status}  body="${txt.slice(0, 150)}"`);
    dump(`${label}_request.json`, body);
    dump(`${label}_response.txt`, `HTTP ${r.status}\n${txt}`);
    return r.ok;
}

async function go() {
    console.log('Probing /navigation/state…');
    const ns = await fetch(`${API}/navigation/state`).then((r) => r.json());
    const loadingData = JSON.parse(ns.loadingStatus?.loadingData || '{}');
    const selectedCar = loadingData?.selectedCar;
    console.log('Currently selected car:', selectedCar?.desc, '— classes:', selectedCar?.classes);
    console.log('Currently selected track:', loadingData?.trackInfo?.sceneDesc);

    console.log('requestPreset…');
    const preset = await fetch(`${API}/rest/sessions/SessionPresets/requestPreset`, { method: 'POST' }).then((r) => r.json());
    dump('preset.json', preset);

    // Pick the most-specific (likely first) class from selectedCar
    const carClass = selectedCar?.classes?.[0] || preset?.Player?.['Game Options']?.['Allowed Vehicles']?.Optional?.[0];
    console.log('Will use carClass:', carClass);

    // Build "minimum viable mod" of preset — keep almost everything, just ensure
    // AllowedVehicles + Vehicle agree.
    const presetCopy = JSON.parse(JSON.stringify(preset));
    if (presetCopy.Player?.['Game Options']?.['Allowed Vehicles']) {
        presetCopy.Player['Game Options']['Allowed Vehicles'] = {
            Optional: carClass ? [carClass] : [],
            Required: [],
        };
    }

    // VARIANT A: wrap exact preset (with Grid), {save: {RealRoad, SessionPreset: preset}}
    await tryLoad('a_wrap_with_grid', {
        save: { RealRoad: null, SessionPreset: preset },
    });

    // VARIANT B: wrap preset with Grid, plus VehicleSetup + Weather array siblings
    const slices = [];
    for (let i = 0; i < 6; i++)
        slices.push({
            Duration: 30, Humidity: 0, RainChance: 0, Sky: 0,
            StartTime: 540 + i * 30, Temperature: 20, WindDirection: 0, WindSpeed: 0,
        });
    await tryLoad('b_wrap_grid_extras', {
        save: { RealRoad: null, SessionPreset: preset, VehicleSetup: '', Weather: slices },
    });

    // VARIANT C: presetCopy with cleaned AllowedVehicles
    await tryLoad('c_cleaned_allowed', {
        save: { RealRoad: null, SessionPreset: presetCopy, VehicleSetup: '', Weather: slices },
    });

    // VARIANT D: Try the other endpoint — saveJSON (which might also be a write)
    const sv = await fetch(`${API}/rest/sessions/SaveLoad/saveJSON`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ save: { SessionPreset: preset } }),
    });
    console.log(`  [d_saveJSON] HTTP ${sv.status}`);

    // VARIANT E: List endpoints that exist — try GET each
    console.log('\n--- discovering endpoints (GET) ---');
    const eps = [
        '/rest/sessions',
        '/rest/sessions/SaveLoad',
        '/rest/sessions/weather',
        '/rest/sessions/SessionPresets',
        '/rest/race',
        '/rest/race/car',
        '/rest/race/cars',
        '/rest/race/championship',
        '/rest/race/garage',
        '/rest/race/lobby',
        '/rest/race/serverSettings',
    ];
    for (const ep of eps) {
        try {
            const r = await fetch(`${API}${ep}`);
            const t = await r.text();
            console.log(`  GET ${ep} → ${r.status}  (${t.length} bytes)  ${t.slice(0, 80).replace(/\n/g, ' ')}`);
        } catch (e) {
            console.log(`  GET ${ep} → ERR ${e.message}`);
        }
    }

    console.log('\nDone.');
}

go().catch((e) => console.error('FATAL:', e));
