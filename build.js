const fs = require('fs');
const path = require('path');

const DIST_DIR = path.join(__dirname, 'dist');

// Define files and folders to explicitly ignore
const IGNORE_LIST = [
  '.git',
  '.github',
  '.agents',
  'node_modules',
  'dist',
  'test-runner.html',
  'build.js',
  'server.js',
  'start.bat',
  'bump.js',
  'bump2.js',
  'package.json',
  'package-lock.json',
  '.gitignore',
  'changes.patch'
];

function isIgnored(itemName, fullPath) {
  if (IGNORE_LIST.includes(itemName)) return true;
  if (fullPath.endsWith('.sql')) return true;
  // Exclude the test suite file specifically
  if (fullPath.endsWith(path.join('js', 'tests.js'))) return true;
  return false;
}

function copyRecursiveSync(src, dest) {
  const exists = fs.existsSync(src);
  const stats = exists && fs.statSync(src);
  const isDirectory = exists && stats.isDirectory();

  if (isDirectory) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    fs.readdirSync(src).forEach((childItemName) => {
      const childSrc = path.join(src, childItemName);
      const childDest = path.join(dest, childItemName);
      if (!isIgnored(childItemName, childSrc)) {
        copyRecursiveSync(childSrc, childDest);
      }
    });
  } else {
    fs.copyFileSync(src, dest);
  }
}

// Clean dist directory if it exists
if (fs.existsSync(DIST_DIR)) {
  fs.rmSync(DIST_DIR, { recursive: true, force: true });
}

// Create fresh dist directory
fs.mkdirSync(DIST_DIR);

console.log('Starting production build...');
// Copy root contents
fs.readdirSync(__dirname).forEach(item => {
  const fullPath = path.join(__dirname, item);
  if (!isIgnored(item, fullPath)) {
    console.log(`Copying ${item}...`);
    copyRecursiveSync(fullPath, path.join(DIST_DIR, item));
  }
});

console.log('Build completed successfully.');
