const fs = require("fs");
const path = require("path");

const outputDirectory = path.resolve(__dirname, "..", "out");

if (fs.existsSync(outputDirectory)) {
    fs.rmSync(outputDirectory, { recursive: true, force: true });
}

console.log(`Cleaned ${outputDirectory}`);
