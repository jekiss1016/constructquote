const fs = require('fs');
const path = require('path');

function walkDir(dir, callback) {
    fs.readdirSync(dir).forEach(f => {
        const dirPath = path.join(dir, f);
        const isDirectory = fs.statSync(dirPath).isDirectory();
        if (isDirectory) {
            if (f !== '.git' && f !== 'node_modules' && f !== '.agents') {
                walkDir(dirPath, callback);
            }
        } else {
            if (f.endsWith('.html') || f.endsWith('.js') || f.endsWith('.json') || f.endsWith('.css')) {
                callback(dirPath);
            }
        }
    });
}

const targetVer = process.argv[2] || '3.0.68';

walkDir('.', (filePath) => {
    let content = fs.readFileSync(filePath, 'utf8');
    let newContent = content.replace(/\?v=[\d\.]+/g, `?v=${targetVer}`);
    if (filePath.endsWith('index.html')) {
        newContent = newContent.replace(/© 2026 MyBidBook \| v[\d\.]+/g, `© 2026 MyBidBook | v${targetVer}`);
    }
    if (content !== newContent) {
        fs.writeFileSync(filePath, newContent, 'utf8');
        console.log(`Updated ${filePath} to v${targetVer}`);
    }
});
