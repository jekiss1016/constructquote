const fs = require('fs');
const path = require('path');

let minifyJS = null;
let cleanCss = null;

try {
  minifyJS = require('terser').minify;
} catch (e) {
  console.warn('terser module not found. Skipping JS minification and copying raw JS files.');
}

try {
  const CleanCSS = require('clean-css');
  cleanCss = new CleanCSS();
} catch (e) {
  console.warn('clean-css module not found. Skipping CSS minification and copying raw CSS files.');
}

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

async function copyRecursiveAsync(src, dest) {
  const exists = fs.existsSync(src);
  const stats = exists && fs.statSync(src);
  const isDirectory = exists && stats.isDirectory();

  if (isDirectory) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    const children = fs.readdirSync(src);
    for (const childItemName of children) {
      const childSrc = path.join(src, childItemName);
      const childDest = path.join(dest, childItemName);
      if (!isIgnored(childItemName, childSrc)) {
        await copyRecursiveAsync(childSrc, childDest);
      }
    }
  } else {
    const ext = path.extname(src).toLowerCase();
    if (ext === '.js' && minifyJS) {
      try {
        const code = fs.readFileSync(src, 'utf8');
        const minified = await minifyJS(code, { module: true });
        if (minified.code) {
          fs.writeFileSync(dest, minified.code, 'utf8');
          return;
        }
      } catch (err) {
        console.warn(`Minification failed for ${src}, copying raw file. Error:`, err.message);
      }
    } else if (ext === '.css' && cleanCss) {
      try {
        const css = fs.readFileSync(src, 'utf8');
        const minified = cleanCss.minify(css);
        if (minified.styles) {
          fs.writeFileSync(dest, minified.styles, 'utf8');
          return;
        }
      } catch (err) {
        console.warn(`CSS minification failed for ${src}, copying raw file. Error:`, err.message);
      }
    }
    fs.copyFileSync(src, dest);
  }
}

async function runBuild() {
  // Clean dist directory if it exists
  if (fs.existsSync(DIST_DIR)) {
    fs.rmSync(DIST_DIR, { recursive: true, force: true });
  }

  // Create fresh dist directory
  fs.mkdirSync(DIST_DIR);

  console.log('Starting production build...');
  const items = fs.readdirSync(__dirname);
  for (const item of items) {
    const fullPath = path.join(__dirname, item);
    if (!isIgnored(item, fullPath)) {
      console.log(`Processing ${item}...`);
      await copyRecursiveAsync(fullPath, path.join(DIST_DIR, item));
    }
  }

  console.log('Build completed successfully.');
}

runBuild().catch(err => {
  console.error('Build process encountered an error:', err);
  process.exit(1);
});
