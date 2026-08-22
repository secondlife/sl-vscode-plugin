#!/usr/bin/env node
const AdmZip = require("adm-zip");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const repoRoot = path.join(__dirname, "..");
const resourcesDir = path.join(repoRoot, ".resources");
const packageJson = require(path.join(repoRoot, "package.json"));

async function download(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`HTTP ${response.status} fetching ${url}`);
    }
    return Buffer.from(await response.arrayBuffer());
}

function hashBuffer(buffer, algorithm) {
    return crypto.createHash(algorithm).update(buffer).digest("hex");
}

function verifyHash(buffer, expectedHash, algorithm) {
    const actual = hashBuffer(buffer, algorithm);
    if (actual.toLowerCase() !== expectedHash.toLowerCase()) {
        throw new Error(
            `Hash mismatch (${algorithm}): expected ${expectedHash}, got ${actual}`
        );
    }
    return actual;
}

function localHashMatches(filePath, expectedHash, algorithm) {
    if (!fs.existsSync(filePath)) {
        return false;
    }
    const actual = hashBuffer(fs.readFileSync(filePath), algorithm);
    return actual.toLowerCase() === expectedHash.toLowerCase();
}

function extractZip(zipPath, destDir) {
    if (fs.existsSync(destDir)) {
        console.log(`  removing existing: ${destDir}`);
    }
    fs.rmSync(destDir, { recursive: true, force: true });
    fs.mkdirSync(destDir, { recursive: true });
    new AdmZip(zipPath).extractAllTo(destDir, true);
}

async function fetchResources() {
    const resources = packageJson.linden_resources;
    if (!resources || typeof resources !== "object") {
        throw new Error("package.json has no linden_resources");
    }

    fs.mkdirSync(resourcesDir, { recursive: true });

    const downloaded = [];

    for (const [name, entry] of Object.entries(resources)) {
        const source = entry && entry.source;
        if (!source || !source.url || !source.hash || !source.hash_algorithm) {
            throw new Error(`Invalid linden_resources entry: ${name}`);
        }

        const fileName = path.basename(new URL(source.url).pathname);
        const destPath = path.join(resourcesDir, fileName);

        console.log(`Fetching ${name}...`);
        console.log(`  url: ${source.url}`);

        if (localHashMatches(destPath, source.hash, source.hash_algorithm)) {
            console.log(`  skip: ${destPath} already matches hash`);
        } else {
            if (fs.existsSync(destPath)) {
                console.log(`  stale: removing ${destPath}`);
                fs.unlinkSync(destPath);
            }

            const data = await download(source.url);
            verifyHash(data, source.hash, source.hash_algorithm);
            fs.writeFileSync(destPath, data);

            console.log(`  hash: ${source.hash} (${source.hash_algorithm}) OK`);
            console.log(`  saved: ${destPath}`);
        }

        downloaded.push({ name, destPath });
    }

    for (const { name, destPath } of downloaded) {
        if (!destPath.toLowerCase().endsWith(".zip")) {
            continue;
        }
        const extractDir = path.join(resourcesDir, name);
        console.log(`Extracting ${name}...`);
        extractZip(destPath, extractDir);
        console.log(`  extracted: ${extractDir}`);
    }

    console.log("Resource fetch complete.");
}

fetchResources().catch((error) => {
    const message = error && error.message ? error.message : String(error);
    console.error(`Failed to fetch resources: ${message}`);
    process.exit(1);
});
