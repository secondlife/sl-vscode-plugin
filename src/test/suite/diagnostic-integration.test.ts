/**
 * @file diagnostic-integration.test.ts
 * Comprehensive diagnostic integration tests
 * Tests error propagation through the entire preprocessing stack:
 * Parser → LexingPreprocessor → Extension
 *
 * Note: PreprocessorError uses message/lineNumber/isWarning fields,
 * not the detailed diagnostic codes from the internal DiagnosticCollector.
 */

import * as assert from 'assert';
import { LexingPreprocessor, PreprocessorOptions, ScriptLanguage } from '#sl-script-preprocessor';
import { HostInterface, StringUri, filePathToStringUri } from '#sl-script-preprocessor';
import { getLanguageConfig } from '#sl-script-preprocessor';

/**
 * Create default preprocessor options for testing
 */
function createDefaultOptions(language: ScriptLanguage): PreprocessorOptions {
    return {
        enabled: true,
        flags: {
            generateWarnings: true,
            generateDecls: false,
            disableInclude: false,
            disableMacros: false,
            disableConditionals: false,
        },
        language: language,
    };
}

/**
 * Create a mock host with in-memory file system for testing
 */
function createMockHostWithFiles(files: Map<string, string>): HostInterface {
    const normalizedFiles = new Map<StringUri, string>();
    for (const [path, content] of files.entries()) {
        normalizedFiles.set(filePathToStringUri(path), content);
    }

    return {
        async readFile(path: StringUri): Promise<string | null> {
            return normalizedFiles.get(path) ?? null;
        },
        async exists(path: StringUri): Promise<boolean> {
            return normalizedFiles.has(path);
        },
        async resolveFile(
            filename: string,
            from: StringUri,
            extensions?: string[],
            includePaths?: string[]
        ): Promise<StringUri | null> {
            // Simple resolution: try exact path first
            const exactPath = filePathToStringUri(filename);
            if (normalizedFiles.has(exactPath)) {
                return exactPath;
            }

            // Try with extensions
            if (extensions) {
                for (const ext of extensions) {
                    const withExt = filePathToStringUri(filename + ext);
                    if (normalizedFiles.has(withExt)) {
                        return withExt;
                    }
                }
            }

            return null;
        },
        async writeFile(p: StringUri, content: string | Uint8Array): Promise<boolean> {
            return false;
        },
        async readJSON<T = any>(p: StringUri): Promise<T | null> {
            return null;
        },
        async readYAML<T = any>(p: StringUri): Promise<T | null> {
            return null;
        },
        async readTOML<T = any>(p: StringUri): Promise<T | null> {
            return null;
        },
        async writeJSON(p: StringUri, data: any, pretty?: boolean): Promise<boolean> {
            return false;
        },
        async writeYAML(p: StringUri, data: any): Promise<boolean> {
            return false;
        },
        async writeTOML(p: StringUri, data: Record<string, any>): Promise<boolean> {
            return false;
        },
        async existsInSameWorkspace(knownPath: string, desiredPath: string): Promise<boolean> {
            return false;
        }

    };
}

suite("Diagnostic Integration Test Suite", () => {

    const lslLanguageConfig = getLanguageConfig('lsl');

    suite("Error Propagation Through Stack", () => {

        test("should collect lexer errors and propagate to preprocessor result", async () => {
            const source = `string s = "unterminated string
default { state_entry() {} }`;

            const options = createDefaultOptions("lsl");
            const host = createMockHostWithFiles(new Map());
            const preprocessor = new LexingPreprocessor(host, options);

            const result = await preprocessor.process(
                source,
                filePathToStringUri('/test/main.lsl'),
                lslLanguageConfig
            );

            assert.strictEqual(result.success, false, "Should fail due to lexer error");
            assert.ok(result.issues.length > 0, "Should have diagnostics");

            const lexerError = result.issues.find(d => d.message.toLowerCase().includes('unterminated'));
            assert.ok(lexerError, "Should have unterminated string error");
            assert.strictEqual(lexerError?.isWarning, false, "Should be an error, not a warning");
        });

        test("should collect parser errors and propagate through preprocessor", async () => {
            const source = `#elif // elif without if
default { state_entry() {} }`;

            const options = createDefaultOptions("lsl");
            const host = createMockHostWithFiles(new Map());
            const preprocessor = new LexingPreprocessor(host, options);

            const result = await preprocessor.process(
                source,
                filePathToStringUri('/test/main.lsl'),
                lslLanguageConfig
            );

            assert.strictEqual(result.success, false, "Should fail due to parser error");

            const parserError = result.issues.find(d => d.message.toLowerCase().includes('elif'));
            assert.ok(parserError, "Should have elif without if error");
            assert.strictEqual(parserError?.isWarning, false);
        });

        test("should collect macro processor errors", async () => {
            const source = `#define FUNC(a,b,c) (a + b + c)
integer x = FUNC(1); // Too few arguments
default { state_entry() {} }`;

            const options = createDefaultOptions("lsl");
            const host = createMockHostWithFiles(new Map());
            const preprocessor = new LexingPreprocessor(host, options);

            const result = await preprocessor.process(
                source,
                filePathToStringUri('/test/main.lsl'),
                lslLanguageConfig
            );

            assert.strictEqual(result.success, false, "Should fail due to macro error");

            const macroError = result.issues.find(d =>
                d.message.toLowerCase().includes('argument') ||
                d.message.toLowerCase().includes('parameter')
            );
            assert.ok(macroError, "Should have argument count mismatch error");
        });

        test("should collect include processor errors", async () => {
            const source = `#include "nonexistent.lsl"
default { state_entry() {} }`;

            const options = createDefaultOptions("lsl");
            const host = createMockHostWithFiles(new Map());
            const preprocessor = new LexingPreprocessor(host, options);

            const result = await preprocessor.process(
                source,
                filePathToStringUri('/test/main.lsl'),
                lslLanguageConfig
            );

            assert.strictEqual(result.success, false, "Should fail due to include error");

            const includeError = result.issues.find(d =>
                d.message.toLowerCase().includes('nonexistent') ||
                d.message.toLowerCase().includes('not found') ||
                d.message.toLowerCase().includes('failed')
            );
            assert.ok(includeError, "Should have file not found error");
        });

        test("should collect conditional processor errors", async () => {
            const source = `#ifdef TEST
integer x = 1;
#else
integer y = 2;
#else // duplicate else
integer z = 3;
#endif
default { state_entry() {} }`;

            const options = createDefaultOptions("lsl");
            const host = createMockHostWithFiles(new Map());
            const preprocessor = new LexingPreprocessor(host, options);

            const result = await preprocessor.process(
                source,
                filePathToStringUri('/test/main.lsl'),
                lslLanguageConfig
            );

            assert.strictEqual(result.success, false, "Should fail due to conditional error");

            const condError = result.issues.find(d => d.message.toLowerCase().includes('else'));
            assert.ok(condError, "Should have multiple else error");
        });
    });

    suite("Diagnostic Source File Tracking", () => {

        test("should track diagnostics in main file", async () => {
            const source = `#elif
default { state_entry() {} }`;

            const options = createDefaultOptions("lsl");
            const host = createMockHostWithFiles(new Map());
            const preprocessor = new LexingPreprocessor(host, options);

            const result = await preprocessor.process(
                source,
                filePathToStringUri('/test/main.lsl'),
                lslLanguageConfig
            );

            const diagnostic = result.issues[0];
            assert.ok(diagnostic, "Should have diagnostic");
            assert.ok(diagnostic.file?.includes('main.lsl'), "Should reference main.lsl");
        });
    });

    suite("Early Termination on Errors", () => {

        test("should stop processing immediately on first error and return original source", async () => {
            const source = `#elif // Error
#define VALID 456
integer x = VALID;
default { state_entry() {} }`;

            const options = createDefaultOptions("lsl");
            const host = createMockHostWithFiles(new Map());
            const preprocessor = new LexingPreprocessor(host, options);

            const result = await preprocessor.process(
                source,
                filePathToStringUri('/test/main.lsl'),
                lslLanguageConfig
            );

            assert.strictEqual(result.success, false, "Should fail due to parser error");

            // Should return original source, not process subsequent directives
            assert.strictEqual(result.content, source, "Should return original source on error");
            // The '#define VALID 456' line is still in the original source, but VALID shouldn't be expanded
            assert.ok(result.content.includes('#define VALID 456'), "Should have original #define line");
            // Check that 'integer x = VALID;' wasn't expanded to 'integer x = 456;'
            assert.ok(result.content.includes('integer x = VALID;'), "VALID should not be expanded");
        });

        test("should stop on first error and not process remaining code", async () => {
            const source = `#define FUNC(a,b) (a+b)
#elif // Error - stops here
#define ANOTHER 789
integer y = ANOTHER;
default { state_entry() {} }`;

            const options = createDefaultOptions("lsl");
            const host = createMockHostWithFiles(new Map());
            const preprocessor = new LexingPreprocessor(host, options);

            const result = await preprocessor.process(
                source,
                filePathToStringUri('/test/main.lsl'),
                lslLanguageConfig
            );

            assert.strictEqual(result.success, false, "Should fail due to error");

            // Should return original source
            assert.strictEqual(result.content, source, "Should return original source on error");
        });
    });

    suite("Diagnostic Collector Operations", () => {

        test("should clear diagnostics between runs", async () => {
            const options = createDefaultOptions("lsl");
            const host = createMockHostWithFiles(new Map());
            const preprocessor = new LexingPreprocessor(host, options);

            // First run with error
            const errorResult = await preprocessor.process(
                `#elif`,
                filePathToStringUri('/test/first.lsl'),
                lslLanguageConfig
            );

            // Second run without error
            const successResult = await preprocessor.process(
                `default { state_entry() {} }`,
                filePathToStringUri('/test/second.lsl'),
                lslLanguageConfig
            );

            assert.ok(errorResult.issues.length > 0, "First run should have errors");
            assert.strictEqual(successResult.issues.length, 0, "Second run should not carry over errors from first run");
        });
    });
});
