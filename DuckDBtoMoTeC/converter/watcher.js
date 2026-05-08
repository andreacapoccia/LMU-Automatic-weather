'use strict';
const chokidar = require('chokidar');
const path = require('path');
const { convert } = require('./convert');

const [,, watchDir, outputDir] = process.argv;
if (!watchDir || !outputDir) {
  process.stderr.write('Usage: node watcher.js <watchDir> <outputDir>\n');
  process.exit(1);
}

const watcher = chokidar.watch(watchDir, {
  persistent: true,
  ignoreInitial: true,
  usePolling: true,       // more reliable on Windows network/desktop folders
  interval: 1000,         // poll every 1s
  awaitWriteFinish: {
    stabilityThreshold: 1000,
    pollInterval: 200,
  },
});

watcher.on('ready', () => {
  process.stdout.write(JSON.stringify({ type: 'ready', dir: watchDir }) + '\n');
});
watcher.on('error', err => {
  process.stdout.write(JSON.stringify({ type: 'error', file: '', message: 'Watcher error: ' + err.message }) + '\n');
});
watcher.on('add', f => onFile(f));
watcher.on('change', f => onFile(f));

function onFile(filePath) {
  if (!filePath.endsWith('.duckdb')) return;
  triggerConvert(filePath);
}

function triggerConvert(filePath) {
  process.stdout.write(JSON.stringify({ type: 'detected', file: filePath }) + '\n');
  const outDir = outputDir || path.dirname(filePath);
  convert(filePath, outDir).catch(err =>
    process.stdout.write(JSON.stringify({ type: 'error', file: filePath, message: err.message }) + '\n')
  );
}

process.stdout.write(JSON.stringify({ type: 'watching', dir: watchDir }) + '\n');
