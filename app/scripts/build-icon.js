// Converts the GO Setups PNG logo into a multi-resolution Windows .ico
// for use as the app icon. Run via `npm run icon`. Output: assets/icon.ico
//
// png-to-ico picks the source PNG sizes you give it and packs them into
// the .ico container. Windows uses the appropriate size depending on
// where it's displayed (taskbar, alt-tab, properties dialog).

const path = require('path');
const fs = require('fs');
const pngToIco = require('png-to-ico');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'assets', 'icon.png');
const OUT = path.join(ROOT, 'assets', 'icon.ico');

if (!fs.existsSync(SRC)) {
    console.error('Source PNG not found at', SRC);
    process.exit(1);
}

pngToIco([SRC])
    .then((buf) => {
        fs.writeFileSync(OUT, buf);
        console.log('Wrote', OUT, '(' + buf.length + ' bytes)');
    })
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
