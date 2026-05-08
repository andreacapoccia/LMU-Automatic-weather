// Builds a portable Windows distribution using @electron/packager,
// then zips it for distribution to GO Setups drivers.
//
// Output: dist/GO-LMU-Launcher-<version>-win-x64.zip
//         dist/GO LMU Launcher-win32-x64/  (unpacked)

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const packager = require('@electron/packager');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const PKG = require('../package.json');
const APP_NAME = PKG.build.productName;

async function main() {
    if (fs.existsSync(DIST)) {
        console.log('Cleaning dist/…');
        fs.rmSync(DIST, { recursive: true, force: true });
    }

    // Build a clean staging dir with ONLY the files we need, then point
    // packager at it. This avoids any pruning/devDep issues — what's in
    // staging is exactly what ships.
    const STAGE = path.join(DIST, '_stage');
    fs.mkdirSync(STAGE, { recursive: true });

    const stagePackage = {
        name: PKG.name,
        version: PKG.version,
        description: PKG.description,
        main: PKG.main,
        author: PKG.author,
        license: PKG.license,
        private: true,
    };
    fs.writeFileSync(
        path.join(STAGE, 'package.json'),
        JSON.stringify(stagePackage, null, 2),
    );
    copyDirSync(path.join(ROOT, 'src'), path.join(STAGE, 'src'));
    copyDirSync(path.join(ROOT, 'assets'), path.join(STAGE, 'assets'));

    // Stage the DuckDB→MoTeC converter as an extra resource.
    // Main process spawns Node scripts from this directory at runtime, so it
    // must ship as plain files (not packed in app.asar). Includes node_modules
    // so chokidar/duckdb (the latter has a native binary) work without the
    // user having Node.js installed.
    const CONVERTER_SRC = path.resolve(ROOT, '..', 'DuckDBtoMoTeC', 'converter');
    const CONVERTER_STAGE = path.join(DIST, 'converter');  // basename = "converter" → lands at resources/converter/
    if (!fs.existsSync(CONVERTER_SRC)) {
        throw new Error('Converter not found at ' + CONVERTER_SRC);
    }
    console.log('Staging converter (with node_modules)…');
    copyDirSync(CONVERTER_SRC, CONVERTER_STAGE);

    console.log('Packaging Electron app…');
    const appPaths = await packager({
        dir: STAGE,
        name: APP_NAME,
        platform: 'win32',
        arch: 'x64',
        out: DIST,
        overwrite: true,
        asar: true,
        icon: path.join(ROOT, 'assets', 'icon.ico'),
        appCopyright: PKG.build.copyright,
        appVersion: PKG.version,
        // Lands at <packaged>/resources/converter/ — main.js reads CONVERTER_DIR
        // from process.resourcesPath when app.isPackaged.
        extraResource: [CONVERTER_STAGE],
        win32metadata: {
            CompanyName: 'GO Setups',
            FileDescription: APP_NAME,
            ProductName: APP_NAME,
            OriginalFilename: `${APP_NAME}.exe`,
        },
    });

    // Clean up the staged converter copy (the packager already grabbed it).
    fs.rmSync(CONVERTER_STAGE, { recursive: true, force: true });

    fs.rmSync(STAGE, { recursive: true, force: true });

    const outDir = appPaths[0];
    console.log(`Packaged → ${outDir}`);

    const zipName = `GO-LMU-Launcher-${PKG.version}-win-x64.zip`;
    const zipPath = path.join(DIST, zipName);
    console.log(`Zipping → ${zipName}`);

    // Use 7za from electron-builder if available, otherwise PowerShell.
    const sevenZa = path.join(
        ROOT,
        'node_modules',
        '7zip-bin',
        'win',
        'x64',
        '7za.exe',
    );
    if (fs.existsSync(sevenZa)) {
        execSync(`"${sevenZa}" a -tzip -mx=5 "${zipPath}" "${outDir}"`, { stdio: 'inherit' });
    } else {
        execSync(
            `powershell -NoProfile -Command "Compress-Archive -Path '${outDir}\\*' -DestinationPath '${zipPath}' -CompressionLevel Optimal"`,
            { stdio: 'inherit' },
        );
    }

    const sizeMB = (fs.statSync(zipPath).size / 1024 / 1024).toFixed(1);
    console.log(`\nDone. ${zipName} (${sizeMB} MB)`);
    console.log(`Path: ${zipPath}`);
}

function copyDirSync(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const s = path.join(src, entry.name);
        const d = path.join(dest, entry.name);
        if (entry.isDirectory()) copyDirSync(s, d);
        else if (entry.isFile()) fs.copyFileSync(s, d);
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
