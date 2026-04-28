// Round 2 probe — try Content-Type header, full lmuHotlap shape with track set first, etc.

const fs = require('fs');
const path = require('path');
const os = require('os');

const API = 'http://localhost:6397';
const OUT = path.join(os.homedir(), 'Desktop', 'GO-LMU-debug');
fs.mkdirSync(OUT, { recursive: true });

const dump = (n, c) =>
    fs.writeFileSync(path.join(OUT, `probe2_${n}`), typeof c === 'string' ? c : JSON.stringify(c, null, 2));

async function tryLoad(label, body, headers) {
    const r = await fetch(`${API}/rest/sessions/SaveLoad/loadGame`, {
        method: 'POST',
        headers: headers || {},
        body: typeof body === 'string' ? body : JSON.stringify(body),
    });
    const txt = await r.text();
    console.log(`  [${label}] HTTP ${r.status}  body="${txt.slice(0, 200)}"`);
    dump(`${label}_request.json`, body);
    dump(`${label}_response.txt`, `HTTP ${r.status}\n${txt}`);
    return r.ok;
}

async function go() {
    // 1. Set a track first.
    console.log('Fetching track list…');
    const tl = await fetch(`${API}/rest/race/track`).then((r) => r.json());
    console.log(`  ${tl.length} tracks`);

    // Pick something simple — first track
    const t = tl[0];
    console.log(`Setting track: ${t.sceneDesc} (id ${t.id})`);
    await fetch(`${API}/rest/race/track`, { method: 'POST', body: String(t.id) });
    await new Promise((r) => setTimeout(r, 1500));

    console.log('requestPreset…');
    const preset = await fetch(`${API}/rest/sessions/SessionPresets/requestPreset`, { method: 'POST' }).then((r) => r.json());
    dump('preset_after_track.json', preset);

    // 2. Build a full lmuHotlap-style template with SCENE replaced from preset.
    const slices = [];
    for (let i = 0; i < 6; i++) {
        slices.push({
            Duration: 30, Humidity: 0, RainChance: 0, Sky: 0,
            StartTime: 540 + i * 30, Temperature: 20, WindDirection: 0, WindSpeed: 0,
        });
    }
    const weatherBlock = {
        Practice: { Road: { LoadTemperaturesFromRealRoadFile: false, RealRoad: 'preset:SATURATED.RRBIN', WaterDepth: 0 }, Weather: slices },
        Qualify: { Road: { LoadTemperaturesFromRealRoadFile: false, RealRoad: 'preset:SATURATED.RRBIN', WaterDepth: 0 }, Weather: slices },
        Race: { Road: { LoadTemperaturesFromRealRoadFile: false, RealRoad: 'preset:SATURATED.RRBIN', WaterDepth: 0 }, Weather: slices },
    };

    const fullTemplate = {
        save: {
            RealRoad: null,
            SessionPreset: {
                Grid: [],
                Player: {
                    DRIVER: { Vehicle: preset.Player.DRIVER.Vehicle },
                    'Game Options': {
                        'Allowed Vehicles': { Optional: [], Required: [] },
                        CrashRecovery: 0,
                        'Damage Multiplier': 100,
                        'Drivers Per Vehicle AI': 1,
                        'Drivers Per Vehicle Player': 1,
                        'Equipped Scenario Plans': '',
                        FreeSettings: 11,
                        'Fuel Consumption Multiplier': 1,
                        'Limited Tire Rules Tires Available In Garage': 100,
                        'Min drive time allowed for 2 driver teams': -1,
                        'Min drive time allowed for 3 driver teams': -1,
                        'Multi-session Results': false,
                        Opponents: 0,
                        'Qualifying Laps': 255,
                        'Race Finish Criteria': 2,
                        'Race Laps': 0,
                        'Race Length': 0.5,
                        'Race Time': 60,
                        'Speed Compensation': 0,
                        'Starting Pos': 0,
                        'Stop go penalties': true,
                        'Tire Warmers': true,
                        'Tire Wear Multiplier': 1,
                        'Vehicle classes affected by drive time': '',
                        'practice length': 360,
                        'qualifying length': 20,
                        'warmup length': 0,
                    },
                    'Mechanical Failures': { 'Failure Rate': 0 },
                    'Race Conditions': {
                        BlueFlags: 1,
                        'Flag Rules': 2,
                        'Force Formation': 0,
                        'Formation Lap': 0,
                        'Grid Walkthrough': 0,
                        'Num Qual Sessions': 0,
                        'Num Race Sessions': 0,
                        ParcFerme: 3,
                        Practice1StartingTime: 690,
                        PrivatePractice: true,
                        PrivateQualifying: 1,
                        QualifyingStartingTime: -1,
                        'Race Timer': 3600,
                        RaceStartingTime: -1,
                        RaceTimeScale: 0,
                        RealRoadTimeScalePractice: 0.0,
                        RealRoadTimeScaleQualifying: 1.0,
                        RealRoadTimeScaleRace: 1.0,
                        'Recon Pit Closed': 150,
                        'Recon Pit Open': 300,
                        'Recon Timer': true,
                        Reconnaissance: 0,
                        'Run Practice1': true,
                        'Run Practice2': false,
                        'Run Practice3': false,
                        'Run Practice4': false,
                        'Run Warmup': false,
                        'Safety Car Collidable': false,
                        'Safety Car Thresh': 100.0,
                        TimeScaledWeather: true,
                        'Track Limits Points Allowed': 5,
                        'Track Limits Rules': 1,
                        'Unsportsmanlike Sensitivity': 1.5,
                        WarmupStartingTime: -1,
                        Weather: 4,
                    },
                    SCENE: preset.Player.SCENE,
                },
                Weather: weatherBlock,
            },
            VehicleSetup: '',
            Weather: slices,
        },
    };

    console.log('\n--- variant tests ---');
    await tryLoad('a_full_template_no_header', fullTemplate);
    await tryLoad('b_full_template_json_header', fullTemplate, { 'Content-Type': 'application/json' });
    await tryLoad('c_full_template_text_header', fullTemplate, { 'Content-Type': 'text/plain' });
    // Echo preset back wrapped in save+SessionPreset+VehicleSetup+Weather array
    await tryLoad('d_echo_preset_with_extras_header', {
        save: { RealRoad: null, SessionPreset: preset, VehicleSetup: '', Weather: slices },
    }, { 'Content-Type': 'application/json' });
    // Just `save: preset` directly with header
    await tryLoad('e_save_preset_header', { save: preset }, { 'Content-Type': 'application/json' });

    console.log('\nDone — look for any HTTP 200 result above.');
}

go().catch((e) => console.error('FATAL:', e));
