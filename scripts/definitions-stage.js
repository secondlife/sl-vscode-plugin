#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const repoRoot = path.join(__dirname, "..");
const resourcesRoot = path.join(repoRoot, ".resources");
const outputDir = path.join(repoRoot, "data");

const requiredArtifacts = [
    "lsl_keywords.xml",
    "lua_keywords.xml",
    "secondlife.d.luau",
    "secondlife.docs.json",
    "secondlife_selene.yml",
];

function walk(dir, out) {
    if (!fs.existsSync(dir)) {
        return;
    }
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            walk(fullPath, out);
            continue;
        }
        out.push(fullPath);
    }
}

function candidateNames(targetName) {
    const ext = path.extname(targetName);
    const base = path.basename(targetName, ext);
    const names = [targetName];
    if (!base.endsWith("_pretty")) {
        names.push(`${base}_pretty${ext}`);
    }
    return names;
}

function findArtifactByName(rootDir, targetName) {
    const files = [];
    walk(rootDir, files);
    for (const candidate of candidateNames(targetName)) {
        const matches = files
            .filter((filePath) => path.basename(filePath).toLowerCase() === candidate.toLowerCase())
            .sort((a, b) => a.localeCompare(b));
        if (matches.length > 0) {
            return matches[0];
        }
    }
    return null;
}

function copyFile(src, dest) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
}

function stageArtifacts() {
    if (!fs.existsSync(resourcesRoot)) {
        console.error(`Missing resources directory: ${resourcesRoot}`);
        console.error("Run: npm run definitions:fetch");
        process.exit(1);
    }

    const missing = [];
    const resolved = [];

    for (const artifactName of requiredArtifacts) {
        const sourcePath = findArtifactByName(resourcesRoot, artifactName);
        if (!sourcePath) {
            missing.push(artifactName);
            continue;
        }
        resolved.push([artifactName, sourcePath]);
    }

    if (missing.length > 0) {
        console.error("Missing required definition artifacts:");
        for (const name of missing) {
            console.error(`- ${name}`);
        }
        process.exit(1);
    }

    for (const [artifactName, sourcePath] of resolved) {
        const destPath = path.join(outputDir, artifactName);
        copyFile(sourcePath, destPath);
        console.log(`Staged ${artifactName}`);
        console.log(`  from: ${sourcePath}`);
        console.log(`    to: ${destPath}`);
    }

    console.log("Definition artifact staging complete.");
}

try {
    stageArtifacts();
} catch (error) {
    const message = error && error.message ? error.message : String(error);
    console.error(`Failed to stage definition artifacts: ${message}`);
    process.exit(1);
}
