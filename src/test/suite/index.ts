import * as path from "path";
import Mocha from "mocha";
import { glob } from "glob";

export function run(): Promise<void> {
    // Create the mocha test
    const mocha = new Mocha({
        ui: "tdd",
        color: true,
        timeout: 10000,
    });

    const testsRoot = path.resolve(__dirname, "..");

    return new Promise((c, e) => {
        const pattern = "**/**.test.js";
        glob(pattern, { cwd: testsRoot })
            .then((files: string[]) => {
                // Sort files to ensure correct test execution order
                const sortedFiles = files.sort((a, b) => {
                    // directive-parser.test.js should run first
                    if (a.includes("directive-parser.test.js")) {
                        return -1;
                    }
                    if (b.includes("directive-parser.test.js")) {
                        return 1;
                    }
                    // include-processor.test.js should run after directive-parser
                    if (
                        a.includes("include-processor.test.js") &&
            !b.includes("directive-parser.test.js")
                    ) {
                        return -1;
                    }
                    if (
                        b.includes("include-processor.test.js") &&
            !a.includes("directive-parser.test.js")
                    ) {
                        return 1;
                    }
                    // macro-processor.test.js should run after include-processor
                    if (
                        a.includes("macro-processor.test.js") &&
            !b.includes("directive-parser.test.js") &&
            !b.includes("include-processor.test.js")
                    ) {
                        return -1;
                    }
                    if (
                        b.includes("macro-processor.test.js") &&
            !a.includes("directive-parser.test.js") &&
            !a.includes("include-processor.test.js")
                    ) {
                        return 1;
                    }
                    // conditional-processor.test.js should run after macro-processor but before preprocessor
                    if (
                        a.includes("conditional-processor.test.js") &&
            !b.includes("directive-parser.test.js") &&
            !b.includes("include-processor.test.js") &&
            !b.includes("macro-processor.test.js")
                    ) {
                        return -1;
                    }
                    if (
                        b.includes("conditional-processor.test.js") &&
            !a.includes("directive-parser.test.js") &&
            !a.includes("include-processor.test.js") &&
            !a.includes("macro-processor.test.js")
                    ) {
                        return 1;
                    }
                    // preprocessor.test.js should run after conditional-processor but before filemapping
                    if (
                        a.includes("preprocessor.test.js") &&
            !b.includes("directive-parser.test.js") &&
            !b.includes("include-processor.test.js") &&
            !b.includes("macro-processor.test.js") &&
            !b.includes("conditional-processor.test.js")
                    ) {
                        return -1;
                    }
                    if (
                        b.includes("preprocessor.test.js") &&
            !a.includes("directive-parser.test.js") &&
            !a.includes("include-processor.test.js") &&
            !a.includes("macro-processor.test.js") &&
            !a.includes("conditional-processor.test.js")
                    ) {
                        return 1;
                    }
                    // function-macro-integration.test.js should run after preprocessor
                    if (
                        a.includes("function-macro-integration.test.js") &&
            !b.includes("directive-parser.test.js") &&
            !b.includes("include-processor.test.js") &&
            !b.includes("macro-processor.test.js") &&
            !b.includes("conditional-processor.test.js") &&
            !b.includes("preprocessor.test.js")
                    ) {
                        return 1;
                    }
                    if (
                        b.includes("function-macro-integration.test.js") &&
            !a.includes("directive-parser.test.js") &&
            !a.includes("include-processor.test.js") &&
            !a.includes("macro-processor.test.js") &&
            !a.includes("conditional-processor.test.js") &&
            !a.includes("preprocessor.test.js")
                    ) {
                        return -1;
                    }
                    // Default alphabetical sort for other files
                    return a.localeCompare(b);
                });

                // Add files to the test suite in sorted order
                sortedFiles.forEach((f: string) =>
                    mocha.addFile(path.resolve(testsRoot, f)),
                );

                try {
                    // Run the mocha test
                    mocha.run((failures: number) => {
                        if (failures > 0) {
                            e(new Error(`${failures} tests failed.`));
                        } else {
                            c();
                        }
                    });
                } catch (err) {
                    console.error(err);
                    e(err);
                }
            })
            .catch(e);
    });
}
