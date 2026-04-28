// Cross-platform dev launcher that ensures ELECTRON_RUN_AS_NODE is unset
// before invoking Electron (some shells / parent processes set it to 1).
const { spawn } = require('child_process');
const path = require('path');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_NO_ATTACH_CONSOLE;

const electronBin = require('electron');
const child = spawn(electronBin, [path.resolve(__dirname, '..')], {
    env,
    stdio: 'inherit',
});

child.on('close', (code) => process.exit(code ?? 0));
