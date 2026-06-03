const fs = require('fs');
const path = require('path');

const FILES_TO_SYNC = [
  'index.html',
  'style.css',
  'main.js',
  'player.js',
  'network.js',
  'world.js'
];

const DEST_DIR = path.join(__dirname, 'android-project', 'app', 'src', 'main', 'assets');

console.log('--- Syncing Web Assets to Android App Project ---');
console.log(`Target Directory: ${DEST_DIR}`);

// Ensure destination assets directory exists
if (!fs.existsSync(DEST_DIR)) {
  fs.mkdirSync(DEST_DIR, { recursive: true });
  console.log(`Created directory path: ${DEST_DIR}`);
}

let syncCount = 0;

FILES_TO_SYNC.forEach((fileName) => {
  const sourcePath = path.join(__dirname, fileName);
  const destPath = path.join(DEST_DIR, fileName);

  if (fs.existsSync(sourcePath)) {
    fs.copyFileSync(sourcePath, destPath);
    console.log(`✓ Synchronized file: ${fileName} -> app/src/main/assets/${fileName}`);
    syncCount++;
  } else {
    console.warn(`⚠ Source file not found: ${fileName}. Skipping.`);
  }
});

console.log(`--- Sync Complete. Successfully copied ${syncCount} files. ---`);
