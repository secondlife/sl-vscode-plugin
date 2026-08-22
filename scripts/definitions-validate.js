#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const repoRoot = path.join(__dirname, "..");
const dataDir = path.join(repoRoot, "data");

const requiredArtifacts = [
    "lsl_keywords.xml",
    "lua_keywords.xml",
    "secondlife.d.luau",
    "secondlife.docs.json",
    "secondlife_selene.yml",
];

function assertExistsAndNonEmpty(filePath) {
    if (!fs.existsSync(filePath)) {
        throw new Error(`Missing required file: ${filePath}`);
    }
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size === 0) {
        throw new Error(`Required file is empty or invalid: ${filePath}`);
    }
}

function assertJsonParsable(filePath) {
    const content = fs.readFileSync(filePath, "utf8");
    try {
        JSON.parse(content);
    } catch (err) {
        throw new Error(`Invalid JSON in ${filePath}: ${err.message}`);
    }
}

function validate() {
    if (!fs.existsSync(dataDir)) {
        throw new Error(`Missing data directory: ${dataDir}`);
    }

    for (const artifact of requiredArtifacts) {
        const filePath = path.join(dataDir, artifact);
        assertExistsAndNonEmpty(filePath);
        if (artifact.endsWith(".json")) {
            assertJsonParsable(filePath);
        }
    }
}

try {
    validate();
    console.log("Definition artifacts validation passed.");
} catch (err) {
    const message = err && err.message ? err.message : String(err);
    console.error(`Definition artifacts validation failed: ${message}`);
    console.error("Run: npm run definitions:sync");
    process.exit(1);
}
