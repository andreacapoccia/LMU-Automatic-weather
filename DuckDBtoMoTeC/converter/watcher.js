'use strict';
const chokidar = require('chokidar');
const fs = require('fs');
const path = require('path');
const { convert } = require('./convert');

const [,, watchDir, outputDir] = process.argv;
if (!watchDir || !outputDir) {
  process.stderr.write('Usage: node watcher.js <watchDir> <outputDir>\n');
  process.exit(1);
}

const pending = new Map();

const watcher = chokidar.watch(watchDir, { persistent: true, ignoreInitial: true });
watcher.on('add', f => onFile(f));
watcher.on('change', f => onFile(f));

function onFile(filePath) {
  if (!filePath.endsWith('.duckdb')) return;
  if (pending.has(filePath)) clearTimeout(pending.get(filePath).timer);
  scheduleStabilize(filePath, -1, 0);
}

function scheduleStabilize(filePath, lastSize, stableCount) {
  const timer = setTimeout(() => {
    try {
      const { size } = fs.statSync(filePath);
      if (size === lastSize) {
        if (stableCount >= 1) {
          pending.delete(filePath);
          triggerConvert(filePath);
          return;
        }
        scheduleStabilize(filePath, size, stableCount + 1);
      } else {
        scheduleStabilize(filePath, size, 0);
      }
    } catch {
      pending.delete(filePath);
    }
  }, 500);
  pending.set(filePath, { timer });
}

function triggerConvert(filePath) {
  process.stdout.write(JSON.stringify({ type: 'detected', file: filePath }) + '\n');
  const outDir = outputDir || path.dirname(filePath);
  convert(filePath, outDir).catch(err =>
    process.stderr.write(JSON.stringify({ type: 'error', file: filePath, message: err.message }) + '\n')
  );
}

process.stdout.write(JSON.stringify({ type: 'watching', dir: watchDir }) + '\n');
