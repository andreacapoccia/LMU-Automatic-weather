// LMU launch flow — reverse-engineered from the LFM App.
// LMU exposes a local REST API on http://localhost:6397 while the game is running.

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// LMU's save.Weather field is an array of 3 zlib+base64-encoded weather node
// blobs (one per session: Practice/Qualifying/Race). We can't synthesize them
// without reverse-engineering rFactor's binary format, so we ship a library of
// captured baselines that drivers pick from as a "weather preset".
const WEATHER_BLOBS = require('./data/weather-blobs.json'); // { dry, overcast_rain, storm }
const TEMPLATE = require('./data/gosetups-template.json'); // GO Setups Dry SessionPreset

const WEATHER_PRESETS = ['dry', 'overcast_rain', 'storm'];

// Slice values stamped into SessionPreset.Weather[*].Weather[i] for each preset.
// 'dry' / 'overcast_rain' use the same fixed values across all 5 slots; 'custom'
// uses the per-slot user input (handled inline in composeSession).
const PRESET_SLICE_VALUES = {
    dry:           { Sky: 0, RainChance: 0,   Temperature: 20 },
    overcast_rain: { Sky: 8, RainChance: 100, Temperature: 20 },
};

// Defaults pulled from GO Setups Dry. These are the fallbacks used when the
// renderer doesn't pass an override.
const DEFAULT_OVERRIDES = {
    weatherPreset: 'dry',           // 'dry' | 'overcast_rain' | 'storm' | 'custom'
    practiceLength: 360,
    practiceStartingTime: 720,      // minutes-from-midnight (720 = 12:00)
    privatePractice: true,
    startingGrip: 'preset:SATURATED.RRBIN',
    waterDepth: -0.009999999776482582,
    realRoadTimeScale: 0,
    tireWarmers: true,

    // GO Setups standard session rules (overridable from UI):
    timeScale: 1,                   // 1 = Normal real time (was 0=None pre-v3.0.4)
    flagRules: 3,                   // 0=None 1=Penalties 2=Penalties+FCY 3=Full w/o DQ (per LMU's settings.json comment)
    trackLimitsRules: 1,            // 0=None 1=Default 2=Strict 3=Relaxed
    trackLimitsPoints: 5,           // 0..63
    mechanicalFailures: 1,          // 0=Off 1=Normal 2=Time Scaled

    vehicleString: null,            // override the live LMU selection if set
    customWeather: null,            // { sky, rainChance, temperature, humidity, windSpeed, windDirection }
};

// Map a custom rain percentage to the closest captured baseline blob.
function pickBlobForCustomRain(rainChance) {
    if (rainChance >= 75) return 'storm';
    if (rainChance >= 30) return 'overcast_rain';
    return 'dry';
}

const API = 'http://localhost:6397';
const LMU_STEAM_APPID = '2399420';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Where to drop debug dumps on each loadGame attempt.
const DEBUG_DIR = path.join(os.homedir(), 'Desktop', 'GO-LMU-debug');

function writeDebug(name, content) {
    try {
        fs.mkdirSync(DEBUG_DIR, { recursive: true });
        fs.writeFileSync(path.join(DEBUG_DIR, name), content);
    } catch (_) {}
}

function isLmuApiAlive() {
    return fetch(`${API}/navigation/state`, { method: 'GET' })
        .then((r) => r.ok)
        .catch(() => false);
}

async function getLmuNavState() {
    try {
        const r = await fetch(`${API}/navigation/state`);
        if (!r.ok) return { alive: false };
        const j = await r.json();
        return { alive: true, navigationState: j?.state?.navigationState || 'UNKNOWN' };
    } catch {
        return { alive: false };
    }
}

function startLmuViaSteam() {
    // `start` resolves the steam:// protocol via the registered handler.
    execSync(`start "" "steam://run/${LMU_STEAM_APPID}"`, { shell: true });
}

async function waitForMainMenu(emit, { maxAttempts = 120 } = {}) {
    for (let i = 0; i < maxAttempts; i++) {
        try {
            const r = await fetch(`${API}/navigation/state`);
            if (!r.ok) {
                emit?.('Waiting for LMU to respond…');
                await sleep(1500);
                continue;
            }
            const nav = await r.json();
            const state = nav?.state?.navigationState;
            if (state === 'NAV_MAIN_MENU') {
                if (nav?.loadingStatus?.loading) {
                    emit?.('LMU is loading…');
                } else {
                    emit?.('Game is on the main menu.');
                    return true;
                }
            } else {
                emit?.(`LMU is on ${state} — backing out…`);
                await fetch(`${API}/navigation/action/NAV_BACK_TO_EVENT`, { method: 'POST' }).catch(() => {});
                await sleep(1500);
                await fetch(`${API}/navigation/action/NAV_TO_MAIN_MENU`, { method: 'POST' }).catch(() => {});
                await sleep(3000);
            }
        } catch (_) {
            emit?.('Waiting for LMU…');
        }
        await sleep(1000);
    }
    return false;
}

async function fetchTrackList() {
    const r = await fetch(`${API}/rest/race/track`);
    if (!r.ok) throw new Error(`Track list HTTP ${r.status}`);
    return r.json(); // [{ id, sceneDesc, ... }]
}

// Best-effort match of a user-picked track against LMU's live list.
// Strategy: prefer exact id, then exact sceneDesc, then fuzzy contains
// using uppercased alphanumeric tokens.
function matchTrack(liveList, picked) {
    if (!Array.isArray(liveList) || !picked) return null;
    const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

    if (picked.id != null) {
        const byId = liveList.find((t) => String(t.id) === String(picked.id));
        if (byId) return byId;
    }

    if (picked.sceneDesc) {
        const target = norm(picked.sceneDesc);
        const exact = liveList.find((t) => norm(t.sceneDesc) === target);
        if (exact) return exact;
    }

    const loc = norm(picked.locationToken);
    const layout = norm(picked.layoutToken);

    if (loc) {
        // Filter to entries that contain the location token.
        const candidates = liveList.filter((t) => norm(t.sceneDesc).includes(loc));

        if (candidates.length === 1) return candidates[0];

        if (layout && candidates.length > 0) {
            // Score by how many characters of the layout token are present.
            let best = null;
            let bestScore = -1;
            for (const c of candidates) {
                const sd = norm(c.sceneDesc);
                let score = 0;
                if (sd.includes(layout)) score += 100;
                // Per-character bonus for partial matches.
                for (let i = 0; i < layout.length; i++) {
                    if (sd.includes(layout.slice(i))) {
                        score += layout.length - i;
                        break;
                    }
                }
                if (score > bestScore) {
                    bestScore = score;
                    best = c;
                }
            }
            if (best) return best;
        }

        if (candidates.length > 0) return candidates[0];
    }

    return null;
}

async function setTrack(trackId) {
    const r = await fetch(`${API}/rest/race/track`, { method: 'POST', body: String(trackId) });
    if (!r.ok) throw new Error(`Set track HTTP ${r.status}`);
}

async function requestPreset() {
    const r = await fetch(`${API}/rest/sessions/SessionPresets/requestPreset`, { method: 'POST' });
    if (!r.ok) throw new Error(`requestPreset HTTP ${r.status}`);
    return r.json();
}

// /navigation/state returns the user's CURRENTLY-SELECTED car/track in the
// LMU UI (loadingData.selectedCar). requestPreset, by contrast, returns the
// last-loaded session (which may be stale after the user changes their car
// in-game). Use this to override Player.DRIVER.Vehicle.
async function getCurrentSelection() {
    try {
        const r = await fetch(`${API}/navigation/state`);
        if (!r.ok) return null;
        const j = await r.json();
        const ld = j?.loadingStatus?.loadingData;
        if (!ld) return null;
        const data = typeof ld === 'string' ? JSON.parse(ld) : ld;
        return {
            vehicle: data?.selectedCar?.desc || data?.selectedCar?.vehicle || null,
            classes: data?.selectedCar?.classes || [],
            sceneDesc: data?.trackInfo?.sceneDesc || null,
            sceneSig: data?.trackInfo?.sceneSig || null,
        };
    } catch {
        return null;
    }
}

async function loadGame(saveJson) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reqBody = JSON.stringify(saveJson, null, 2);
    writeDebug(`${stamp}_request.json`, reqBody);

    // Also dump LMU's own current save JSON for side-by-side diff.
    try {
        const live = await fetch(`${API}/rest/sessions/SaveLoad/getSaveJSON`);
        if (live.ok) {
            const liveText = await live.text();
            try {
                writeDebug(`${stamp}_live.json`, JSON.stringify(JSON.parse(liveText), null, 2));
            } catch {
                writeDebug(`${stamp}_live.json`, liveText);
            }
        }
    } catch (_) {}

    const r = await fetch(`${API}/rest/sessions/SaveLoad/loadGame`, {
        method: 'POST',
        body: JSON.stringify(saveJson),
    });
    if (!r.ok) {
        const body = await r.text().catch(() => '');
        writeDebug(`${stamp}_response.txt`, `HTTP ${r.status}\n\n${body}`);
        throw new Error(`loadGame HTTP ${r.status} — ${body}`);
    }
    writeDebug(`${stamp}_response.txt`, `HTTP ${r.status} OK`);
    return true;
}

// Composes the loadGame body. Strategy: clone the GO Setups Dry template
// (which captures all the session settings LFM/LMU expect — practice length,
// race conditions, scripted weather mode etc.), apply the user's overrides,
// stamp in their currently-selected car/track, and swap in the chosen
// weather blob. SessionPreset.Weather slices are aesthetic; the binary
// save.Weather array is what LMU actually plays.
function composeSession({ presetJson, liveSelection, overrides }) {
    const o = { ...DEFAULT_OVERRIDES, ...(overrides || {}) };

    // Deep-clone so we don't mutate the on-disk template.
    const sp = JSON.parse(JSON.stringify(TEMPLATE.SessionPreset));

    // Override SCENE with the player's currently-loaded track.
    const scene = presetJson?.Player?.SCENE || presetJson?.SessionPreset?.Player?.SCENE;
    if (scene) sp.Player.SCENE = scene;

    // Vehicle override priority: explicit pick from our app > live LMU selection
    // > preset > template default.
    const vehicleStr =
        o.vehicleString ||
        liveSelection?.vehicle ||
        presetJson?.Player?.DRIVER?.Vehicle ||
        sp.Player.DRIVER.Vehicle;
    sp.Player.DRIVER.Vehicle = vehicleStr;

    // Apply user overrides to Game Options + Race Conditions.
    //
    // Per-session writes (D3). Field names verified against gosetups-template.json:
    //   - 'practice length', 'qualifying length' verified (lowercase with space).
    //   - 'Race Time' used for race duration (minutes); template has no 'race length' key.
    //   - Practice1StartingTime verified; QualifyingStartingTime verified (NOT Qualify1StartingTime).
    //   - RaceStartingTime verified. PrivateQualifying verified (template uses integer 1/0).
    //   - RealRoadTimeScalePractice/Qualifying/Race all verified.
    //   - RaceStartType is INFERRED (not present in template; written speculatively).
    const sessions = o.sessions || {};

    // Resolve which captured blob to send per session. "custom" picks based on
    // average rain across all 5 slots. weatherBlob is the 3-element array LMU
    // expects: [Practice, Qualifying, Race].
    function pickBlobForSession(sess) {
        const wp = sess.weatherPreset ?? 'dry';
        if (wp === 'dry') return 'dry';
        if (wp === 'overcast_rain') return 'overcast_rain';
        // custom — pick by avg rain across the 5 slots
        const slots = sess.customWeather || [];
        if (!slots.length) return 'dry';
        const avgRain = slots.reduce((a, s) => a + Number(s.rainChance ?? 0), 0) / slots.length;
        if (avgRain >= 75) return 'storm';
        if (avgRain >= 30) return 'overcast_rain';
        return 'dry';
    }

    const weatherBlob = [
        WEATHER_BLOBS[pickBlobForSession(sessions.practice   || {})][0],
        WEATHER_BLOBS[pickBlobForSession(sessions.qualifying || {})][1],
        WEATHER_BLOBS[pickBlobForSession(sessions.race       || {})][2],
    ];

    const SESSION_MAP = [
        // [stateKey, Game Options length field,  startTimeField,           privateField,        realRoadField]
        ['practice',   'practice length',           'Practice1StartingTime',   'PrivatePractice',   'RealRoadTimeScalePractice'],
        ['qualifying', 'qualifying length',          'QualifyingStartingTime',  'PrivateQualifying', 'RealRoadTimeScaleQualifying'],
        ['race',       'Race Time',                  'RaceStartingTime',         null,                'RealRoadTimeScaleRace'],
    ];

    for (const [sKey, lenField, startField, privField, rrField] of SESSION_MAP) {
        const ss = sessions[sKey] || {};
        const enabled = ss.enabled !== false; // undefined → treat as enabled
        const length = enabled ? Number(ss.length ?? 60) : 1;  // 1-min for disabled (LMU still shows it; see scope note)
        sp.Player['Game Options'][lenField] = length;
        sp.Player['Race Conditions'][startField] = Number(ss.startTime ?? 720);
        if (privField) {
            sp.Player['Race Conditions'][privField] = !!(ss.privateSession ?? true);
        }
        sp.Player['Race Conditions'][rrField] = Number(ss.realRoadTimeScale ?? 0);
    }

    // Race start type — Race only.
    // LMU enum (INFERRED — not present in template): 0=Standing, 1=Rolling, 2=FastRolling.
    // We only ship 'rolling' and 'fast_rolling' from the renderer (no Standing UI).
    const raceStartType = sessions.race?.startType ?? 'rolling';
    sp.Player['Race Conditions'].RaceStartType = raceStartType === 'fast_rolling' ? 2 : 1;

    // Tire warmers stays shared (top-level, written once).
    sp.Player['Game Options']['Tire Warmers'] = !!o.tireWarmers;
    sp.Player['Race Conditions'].Weather = 4;          // scripted
    sp.Player['Race Conditions'].TimeScaledWeather = true;
    sp.Player['Race Conditions'].RaceTimeScale = Number(o.timeScale);
    sp.Player['Race Conditions']['Flag Rules'] = Number(o.flagRules);
    sp.Player['Race Conditions']['Track Limits Rules'] = Number(o.trackLimitsRules);
    sp.Player['Race Conditions']['Track Limits Points Allowed'] = Number(o.trackLimitsPoints);
    if (sp.Player['Mechanical Failures']) {
        sp.Player['Mechanical Failures']['Failure Rate'] = Number(o.mechanicalFailures);
    }

    // Apply RealRoad / wet to all 3 sessions inside SessionPreset.Weather.
    for (const session of ['Practice', 'Qualifying', 'Race']) {
        const block = sp.Weather?.[session];
        if (!block) continue;
        block.Road = block.Road || {};
        const sessKey = session.toLowerCase();
        const ss = sessions[sessKey] || {};
        block.Road.RealRoad = String(ss.startingGrip ?? 'preset:SATURATED.RRBIN');
        block.Road.WaterDepth = Number(o.waterDepth ?? -0.01);
        block.Road.LoadTemperaturesFromRealRoadFile = false;

        // Slice stamping (B8 + C4): write Sky/RainChance/Temperature on every slot
        // for every preset. Other slice fields (Humidity, Wind*) keep template defaults.
        const wp = ss.weatherPreset ?? 'dry';
        if (Array.isArray(block.Weather)) {
            for (let i = 0; i < block.Weather.length; i++) {
                let slotVals;
                if (wp === 'custom') {
                    const customSlot = ss.customWeather?.[i];
                    if (!customSlot) continue;
                    slotVals = {
                        sky:         customSlot.sky,
                        rainChance:  customSlot.rainChance,
                        temperature: customSlot.temperature,
                    };
                } else {
                    const preset = PRESET_SLICE_VALUES[wp];
                    if (!preset) continue;
                    slotVals = {
                        sky:         preset.Sky,
                        rainChance:  preset.RainChance,
                        temperature: preset.Temperature,
                    };
                }
                if (slotVals.sky != null)         block.Weather[i].Sky         = Number(slotVals.sky);
                if (slotVals.rainChance != null)  block.Weather[i].RainChance  = Number(slotVals.rainChance);
                if (slotVals.temperature != null) block.Weather[i].Temperature = Number(slotVals.temperature);
            }
        }
    }

    // endET: end time of the longest enabled session. For multi-session weekends
    // LMU computes its own session boundaries; this value is mostly informational
    // for our save payload.
    const practiceLength = Number(sessions.practice?.length ?? 60);
    const practiceStartingTime = Number(sessions.practice?.startTime ?? 720);
    const endET = practiceLength * 60 + 5;

    return {
        save: {
            RealRoad: null,
            SessionPreset: sp,
            VehicleSetup: '',
            Weather: weatherBlob,

            // Top-level session-state fields LMU requires (otherwise HTTP 400).
            aiVehicles: [],
            allowedVehiclesFilter: { Optional: ['*'], Required: [] },
            cloudCoverage: 0,
            coop: null,
            coopGameID: '',
            currentSession: 1,
            currentTemp: 0,
            endET,
            gamePhase: 0,
            greenET: 5,
            maxLaps: 2147483647,
            pitExitLight: 2,
            playerVehicle: { slotID: -2 },
            rainIntensity: 0,
            raining: 0,
            redLightET: 0,
            saveVersion: 16,
            sessionET: 0,
            sessionFinished: false,
            sessionState: 8,
            sessionTimescale: 0,
            startET: 5,
            startTime: practiceStartingTime * 60,
            timeOfDay: practiceStartingTime * 60,
            uniqueSessionID: Math.floor(Math.random() * 0x7fffffff),
        },
    };
}

async function launchSession({ track, overrides, emit }) {
    const log = emit || (() => {});

    log('Checking if Le Mans Ultimate is running…');
    const alive = await isLmuApiAlive();
    if (!alive) {
        log('LMU is not running — launching via Steam…');
        try {
            startLmuViaSteam();
        } catch (e) {
            throw new Error(`Failed to launch LMU via Steam: ${e.message}`);
        }
    }

    log('Waiting for LMU main menu…');
    const reachedMenu = await waitForMainMenu(log);
    if (!reachedMenu) {
        throw new Error("Couldn't reach LMU main menu within timeout.");
    }

    log('Fetching track list from LMU…');
    const tracks = await fetchTrackList();
    const match = matchTrack(tracks, track);
    if (!match) {
        throw new Error(
            `Couldn't find a matching track for "${track.label || track.locationToken}/${track.layoutToken || ''}" in LMU's list.`,
        );
    }

    log(`Selecting track: ${match.sceneDesc}`);
    await setTrack(match.id);
    await sleep(500);

    log('Reading current session preset…');
    const preset = await requestPreset();
    const live = await getCurrentSelection();
    if (live?.vehicle) log(`Using player-selected car: ${live.vehicle}`);

    log(`Composing session with weather preset "${overrides?.sessions?.practice?.weatherPreset ?? overrides?.weatherPreset ?? 'dry'}"…`);
    const body = composeSession({ presetJson: preset, liveSelection: live, overrides });

    log('Loading session into LMU…');
    await loadGame(body);

    log('Done — your practice session is loading in LMU.');
    return true;
}

module.exports = {
    isLmuApiAlive,
    getLmuNavState,
    waitForMainMenu,
    fetchTrackList,
    matchTrack,
    requestPreset,
    composeSession,
    launchSession,
};
