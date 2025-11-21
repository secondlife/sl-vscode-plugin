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
import { LexingPreprocessor, PreprocessorOptions } from '../../shared/lexingpreprocessor';
import { HostInterface, NormalizedPath, normalizePath } from '../../interfaces/hostinterface';
import { FullConfigInterface, ConfigKey } from '../../interfaces/configinterface';

/**
 * Mock configuration class for testing
 */
class MockConfig implements FullConfigInterface {
    private configValues: Map<ConfigKey, any> = new Map();

    constructor(initialValues?: Map<ConfigKey, any>) {
        if (initialValues) {
            this.configValues = new Map(initialValues);
        }
    }

    isEnabled(): boolean {
        return true;
    }

    getConfig<T>(key: ConfigKey): T | undefined {
        return this.configValues.get(key) as T | undefined;
    }

    async setConfig<T>(key: ConfigKey, value: T, scope?: any): Promise<void> {
        this.configValues.set(key, value);
    }

    async getWorkspaceConfigPath(): Promise<NormalizedPath> {
        return normalizePath("");
    }

    async getGlobalConfigPath(): Promise<NormalizedPath> {
        return normalizePath("");
    }

    async getExtensionInstallPath(): Promise<NormalizedPath> {
        return normalizePath("");
    }

    getSessionValue<T>(key: ConfigKey): T | undefined {
        return undefined;
    }

    setSessionValue<T>(key: ConfigKey, value: T): void {
        // No-op for tests
    }

    useLocalConfig(): boolean {
        return false;
    }
}

/**
 * Create default preprocessor options for testing
 */
function createDefaultOptions(): PreprocessorOptions {
    return {
        enable: true,
        flags: {
            generateWarnings: true,
            generateDecls: false,
            disableInclude: false,
            disableMacros: false,
            disableConditionals: false,
        },
    };
}

/**
 * Create a mock host with in-memory file system for testing
 */
function createMockHostWithFiles(files: Map<string, string>, options?: PreprocessorOptions): HostInterface {
    const normalizedFiles = new Map<NormalizedPath, string>();
    for (const [path, content] of files.entries()) {
        normalizedFiles.set(normalizePath(path), content);
    }

    // Set up default preprocessor options if not provided
    if (!options) {
        options = createDefaultOptions();
    }

    const configValues = new Map<ConfigKey, any>();
    // Set individual config keys instead of PreprocessorOptions object
    configValues.set(ConfigKey.PreprocessorEnable, options.enable);
    configValues.set(ConfigKey.PreprocessorIncludePaths, options.includePaths ?? ['.']);
    configValues.set(ConfigKey.PreprocessorMaxIncludeDepth, options.maxIncludeDepth ?? 5);
    const config = new MockConfig(configValues);

    return {
        config,
        async readFile(path: NormalizedPath): Promise<string | null> {
            return normalizedFiles.get(path) ?? null;
        },
        async exists(path: NormalizedPath): Promise<boolean> {
            return normalizedFiles.has(path);
        },
        async resolveFile(
            filename: string,
            from: NormalizedPath,
            extensions?: string[],
            includePaths?: string[]
        ): Promise<NormalizedPath | null> {
            // Simple resolution: try exact path first
            const exactPath = normalizePath(filename);
            if (normalizedFiles.has(exactPath)) {
                return exactPath;
            }

            // Try with extensions
            if (extensions) {
                for (const ext of extensions) {
                    const withExt = normalizePath(filename + ext);
                    if (normalizedFiles.has(withExt)) {
                        return withExt;
                    }
                }
            }

            return null;
        },
        async writeFile(p: NormalizedPath, content: string | Uint8Array): Promise<boolean> {
            return false;
        },
        async readJSON<T = any>(p: NormalizedPath): Promise<T | null> {
            return null;
        },
        async readYAML<T = any>(p: NormalizedPath): Promise<T | null> {
            return null;
        },
        async readTOML<T = any>(p: NormalizedPath): Promise<T | null> {
            return null;
        },
        async writeJSON(p: NormalizedPath, data: any, pretty?: boolean): Promise<boolean> {
            return false;
        },
        async writeYAML(p: NormalizedPath, data: any): Promise<boolean> {
            return false;
        },
        async writeTOML(p: NormalizedPath, data: Record<string, any>): Promise<boolean> {
            return false;
        },
        fileNameToUri(fileName: NormalizedPath): string {
            // Strip path to only include directories/filename after "test" directory
            const testIndex = fileName.indexOf('test');
            const relativePath = testIndex !== -1 ? fileName.substring(testIndex) : fileName;
            // Normalize backslashes to forward slashes
            const normalizedPath = relativePath.replace(/\\/g, '/');
            return "unittest:///" + normalizedPath;
        },
        uriToFileName(uri: string): NormalizedPath {
            return normalizePath(uri.replace("unittest:///", ""));
        }

    };
}

suite("Diagnostic Integration Test Suite", () => {

    suite("Error Propagation Through Stack", () => {

        test("should collect lexer errors and propagate to preprocessor result", async () => {
            const source = `string s = "unterminated string
default { state_entry() {} }`;

            const host = createMockHostWithFiles(new Map());
            const preprocessor = new LexingPreprocessor(host, host.config);

            const result = await preprocessor.process(
                source,
                normalizePath('/test/main.lsl'),
                'lsl'
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

            const host = createMockHostWithFiles(new Map());
            const preprocessor = new LexingPreprocessor(host, host.config);

            const result = await preprocessor.process(
                source,
                normalizePath('/test/main.lsl'),
                'lsl'
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

            const host = createMockHostWithFiles(new Map());
            const preprocessor = new LexingPreprocessor(host, host.config);

            const result = await preprocessor.process(
                source,
                normalizePath('/test/main.lsl'),
                'lsl'
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

            const host = createMockHostWithFiles(new Map());
            const preprocessor = new LexingPreprocessor(host, host.config);

            const result = await preprocessor.process(
                source,
                normalizePath('/test/main.lsl'),
                'lsl'
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

            const host = createMockHostWithFiles(new Map());
            const preprocessor = new LexingPreprocessor(host, host.config);

            const result = await preprocessor.process(
                source,
                normalizePath('/test/main.lsl'),
                'lsl'
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

            const host = createMockHostWithFiles(new Map());
            const preprocessor = new LexingPreprocessor(host, host.config);

            const result = await preprocessor.process(
                source,
                normalizePath('/test/main.lsl'),
                'lsl'
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

            const host = createMockHostWithFiles(new Map());
            const preprocessor = new LexingPreprocessor(host, host.config);

            const result = await preprocessor.process(
                source,
                normalizePath('/test/main.lsl'),
                'lsl'
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

            const host = createMockHostWithFiles(new Map());
            const preprocessor = new LexingPreprocessor(host, host.config);

            const result = await preprocessor.process(
                source,
                normalizePath('/test/main.lsl'),
                'lsl'
            );

            assert.strictEqual(result.success, false, "Should fail due to error");

            // Should return original source
            assert.strictEqual(result.content, source, "Should return original source on error");
        });
    });

    suite("Diagnostic Collector Operations", () => {

        test("should clear diagnostics between runs", async () => {
            const host = createMockHostWithFiles(new Map());
            const preprocessor = new LexingPreprocessor(host, host.config);

            // First run with error
            const errorResult = await preprocessor.process(
                `#elif`,
                normalizePath('/test/first.lsl'),
                'lsl'
            );

            // Second run without error
            const successResult = await preprocessor.process(
                `default { state_entry() {} }`,
                normalizePath('/test/second.lsl'),
                'lsl'
            );

            assert.ok(errorResult.issues.length > 0, "First run should have errors");
            assert.strictEqual(successResult.issues.length, 0, "Second run should not carry over errors from first run");
        });
    });
});
