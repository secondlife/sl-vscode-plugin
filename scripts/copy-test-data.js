#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const sourceDataDir = path.join(__dirname, '..', 'src', 'test', 'suite', 'data');
const targetDataDir = path.join(__dirname, '..', 'out', 'test', 'suite', 'data');
const sourceWorkspaceDir = path.join(__dirname, '..', 'src', 'test', 'workspace');
const targetWorkspaceDir = path.join(__dirname, '..', 'out', 'test', 'workspace');

function copyRecursive(src, dest) {
    if (!fs.existsSync(src)) {
        console.log(`Source directory ${src} does not exist, skipping copy.`);
        return;
    }

    // Create target directory if it doesn't exist
    fs.mkdirSync(path.dirname(dest), { recursive: true });

    const stats = fs.statSync(src);
    if (stats.isDirectory()) {
        fs.mkdirSync(dest, { recursive: true });
        const files = fs.readdirSync(src);
        files.forEach(file => {
            copyRecursive(path.join(src, file), path.join(dest, file));
        });
    } else {
        fs.copyFileSync(src, dest);
    }
}

try {
    copyRecursive(sourceDataDir, targetDataDir);
    console.log('Test data copied successfully.');
    copyRecursive(sourceWorkspaceDir, targetWorkspaceDir);
    console.log('Test workspace copied successfully.');
} catch (error) {
    console.log('Copy operation completed with warnings:', error.message);
}
