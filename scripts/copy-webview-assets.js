#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '..', 'src', 'webview');
const outDir = path.join(__dirname, '..', 'out', 'webview');

function copyStaticAssets(src, dest) {
    if (!fs.existsSync(src)) {
        console.log(`Webview source directory ${src} does not exist, skipping.`);
        return;
    }
    const stats = fs.statSync(src);
    if (stats.isDirectory()) {
        fs.mkdirSync(dest, { recursive: true });
        for (const file of fs.readdirSync(src)) {
            copyStaticAssets(path.join(src, file), path.join(dest, file));
        }
    } else if (!src.endsWith('.ts')) {
        fs.copyFileSync(src, dest);
    }
}

try {
    copyStaticAssets(srcDir, outDir);
    console.log('Webview assets copied successfully.');
} catch (error) {
    console.error('Failed to copy webview assets:', error.message);
    process.exit(1);
}
