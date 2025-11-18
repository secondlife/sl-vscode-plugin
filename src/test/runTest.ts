import * as path from "path";
import { runTests } from "@vscode/test-electron";
import * as fs from "fs";

async function main(): Promise<void> {
    try {
    // The folder containing the Extension Manifest package.json
        let extensionDevelopmentPath = path.resolve(__dirname, "../../");

        // The path to the test runner
        const extensionTestsPath = path.resolve(__dirname, "./suite/index");

        console.log("Extension Development Path:", extensionDevelopmentPath);
        console.log("Extension Tests Path:", extensionTestsPath);

        // Check if the path contains spaces and handle accordingly on Windows
        if (
            process.platform === "win32" &&
      extensionDevelopmentPath.includes(" ")
        ) {
            console.log("Path contains spaces, attempting to get short path...");

            try {
                const { execSync } = require("child_process");
                // Use PowerShell to get short path which should work better
                const shortPathCmd = `(Get-Item "${extensionDevelopmentPath}").FullName`;
                const result = execSync(`powershell -Command "${shortPathCmd}"`, {
                    encoding: "utf8",
                }).trim();

                if (result && fs.existsSync(result) && !result.includes(" ")) {
                    extensionDevelopmentPath = result;
                    console.log("Using resolved path:", extensionDevelopmentPath);
                } else {
                    // Try the DOS 8.3 name approach
                    const shortPath = execSync(
                        `for %I in ("${extensionDevelopmentPath}") do @echo %~sI`,
                        {
                            encoding: "utf8",
                            shell: "cmd.exe",
                        },
                    ).trim();

                    if (
                        shortPath &&
            fs.existsSync(shortPath) &&
            !shortPath.includes(" ")
                    ) {
                        extensionDevelopmentPath = shortPath;
                        console.log("Using short path:", extensionDevelopmentPath);
                    } else {
                        console.log("No space-free path available, using original");
                    }
                }
            } catch (error) {
                console.log(
                    "Failed to get alternative path, continuing with original path",
                );
            }
        }

        // Download VS Code, unzip it and run the integration test
        await runTests({
            extensionDevelopmentPath,
            extensionTestsPath,
            launchArgs: [
                "--skip-getting-started",
                "--skip-release-notes",
                "--no-sandbox",
                "--disable-dev-shm-usage",
                "--disable-background-timer-throttling",
                "--disable-backgrounding-occluded-windows",
                "--disable-renderer-backgrounding",
            ],
            version: "stable",
        });

        console.log("Tests completed successfully");
    } catch (err) {
        console.error("Failed to run tests:", err);
        process.exit(1);
    }
}

main();
