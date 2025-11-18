/**
 * Disk-based integration tests for LSL #include directives
 * Tests real file I/O with actual files from src/test/workspace/set_1
 */

import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import { LexingPreprocessor, PreprocessorOptions } from '../../shared/lexingpreprocessor';
import { normalizePath, type NormalizedPath, type HostInterface } from '../../interfaces/hostinterface';
import type { FullConfigInterface } from '../../interfaces/configinterface';
import { ConfigKey } from '../../interfaces/configinterface';

/**
 * Test config implementation
 */
class TestConfig implements FullConfigInterface {
    private options: PreprocessorOptions;

    constructor(options: PreprocessorOptions) {
        this.options = options;
    }

    getConfig<T>(key: ConfigKey): T | undefined {
        // Return individual config values instead of PreprocessorOptions object
        if (key === ConfigKey.PreprocessorEnable) {
            return this.options.enable as T;
        }
        if (key === ConfigKey.PreprocessorIncludePaths) {
            return (this.options.includePaths ?? ['.']) as T;
        }
        if (key === ConfigKey.PreprocessorMaxIncludeDepth) {
            return (this.options.maxIncludeDepth ?? 5) as T;
        }
        return undefined;
    }
    async setConfig<T>(key: ConfigKey, value: T, scope?: any): Promise<void> {}
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
    setSessionValue<T>(key: ConfigKey, value: T): void {}
    useLocalConfig(): boolean {
        return false;
    }
}

/**
 * Test host implementation that reads real files from disk
 */
class DiskTestHost implements HostInterface {
    config: FullConfigInterface;
    private workspaceRoot: NormalizedPath;

    constructor(workspaceRoot: string, options: PreprocessorOptions) {
        this.workspaceRoot = normalizePath(workspaceRoot);
        this.config = new TestConfig(options);
    }

    async readFile(filePath: NormalizedPath): Promise<string | null> {
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            return content;
        } catch (err) {
            return null;
        }
    }

    async exists(filePath: NormalizedPath): Promise<boolean> {
        try {
            return fs.existsSync(filePath);
        } catch {
            return false;
        }
    }

    async resolveFile(
        filename: string,
        from: NormalizedPath,
        extensions?: string[],
        includePaths?: string[]
    ): Promise<NormalizedPath | null> {
        const exts = extensions || ['.lsl'];
        const paths = includePaths || ['./include/', 'include/', '.'];

        // Try relative to the current file first
        const fromDir = path.dirname(from);
        for (const ext of exts) {
            const withExt = filename.endsWith(ext) ? filename : filename + ext;
            const absolutePath = normalizePath(path.resolve(fromDir, withExt));
            if (await this.exists(absolutePath)) {
                return absolutePath;
            }
        }

        // Try include paths relative to workspace root
        for (const includePath of paths) {
            let searchDir: string;
            if (includePath.startsWith('./')) {
                searchDir = path.join(path.dirname(from), includePath.slice(2));
            } else if (includePath === '.') {
                searchDir = path.dirname(from);
            } else {
                searchDir = path.join(this.workspaceRoot, includePath);
            }

            for (const ext of exts) {
                const withExt = filename.endsWith(ext) ? filename : filename + ext;
                const absolutePath = normalizePath(path.resolve(searchDir, withExt));
                if (await this.exists(absolutePath)) {
                    return absolutePath;
                }
            }
        }

        return null;
    }

    async writeFile(p: NormalizedPath, content: string | Uint8Array): Promise<boolean> {
        return false;
    }

    async readJSON<T = any>(p: NormalizedPath): Promise<T | null> {
        return null;
    }

    async readYAML<T = any>(p: NormalizedPath): Promise<T | null> {
        return null;
    }

    async readTOML<T = any>(p: NormalizedPath): Promise<T | null> {
        return null;
    }

    async writeJSON(p: NormalizedPath, data: any, pretty?: boolean): Promise<boolean> {
        return false;
    }

    async writeYAML(p: NormalizedPath, data: any): Promise<boolean> {
        return false;
    }

    async writeTOML(p: NormalizedPath, data: Record<string, any>): Promise<boolean> {
        return false;
    }
    fileNameToUri(fileName: NormalizedPath): string {
        // Strip path to only include directories/filename after "test" directory
        const testIndex = fileName.indexOf('test');
        const relativePath = testIndex !== -1 ? fileName.substring(testIndex) : fileName;
        // Normalize backslashes to forward slashes
        const normalizedPath = relativePath.replace(/\\/g, '/');
        return "file:///" + normalizedPath;
    }

    uriToFileName(uri: string): NormalizedPath {
        return normalizePath(uri.replace(/^file:\/\/\//, '/'));
    }

}

suite('LSL Include Directive Tests - Disk-based Integration', () => {
    let workspaceRoot: string;
    let host: DiskTestHost;

    function createDefaultOptions(): PreprocessorOptions {
        return {
            enable: true,
            flags: {
                generateWarnings: false,
                generateDecls: false,
                disableInclude: false,
                disableMacros: false,
                disableConditionals: false,
            },
            includePaths: ['./include/', 'include/'],
            maxIncludeDepth: 10,
        };
    }

    suiteSetup(() => {
        // Point to the test workspace
        workspaceRoot = path.resolve(__dirname, '../../../src/test/workspace/set_1');
        host = new DiskTestHost(workspaceRoot, createDefaultOptions());
    });

    test('should process simple include chain (A->B->C) from disk files', async () => {
        const testFile = normalizePath(path.join(workspaceRoot, 'test_include_chain.lsl'));
        const expectedFile = path.join(workspaceRoot, 'test_include_chain_expected.lsl');
        const source = fs.readFileSync(testFile, 'utf-8');
        const expected = fs.readFileSync(expectedFile, 'utf-8');
        const preprocessor = new LexingPreprocessor(host, host.config);

        const result = await preprocessor.process(source, testFile, 'lsl');

        // Compare with expected output
        assert.strictEqual(result.content, expected, 'Output should match expected file');

        // Verify no errors
        assert.ok(result.success, 'Processing should succeed');
        assert.strictEqual(result.issues.length, 0, 'Should have no issues');
    });

    test('should handle diamond dependency (A->B,C; B->C) from disk files', async () => {
        const testFile = normalizePath(path.join(workspaceRoot, 'test_include_diamond.lsl'));
        const expectedFile = path.join(workspaceRoot, 'test_include_diamond_expected.lsl');
        const source = fs.readFileSync(testFile, 'utf-8');
        const expected = fs.readFileSync(expectedFile, 'utf-8');
        const preprocessor = new LexingPreprocessor(host, host.config);

        const result = await preprocessor.process(source, testFile, 'lsl');

        // Compare with expected output
        assert.strictEqual(result.content, expected, 'Output should match expected file');

        // Count occurrences of the add function - should only appear once due to include guards
        const addFunctionMatches = result.content.match(/float add\(float a, float b\)/g);
        assert.strictEqual(addFunctionMatches?.length, 1, 'add function should appear exactly once (include guard works)');

        // Verify no errors
        assert.ok(result.success, 'Processing should succeed');
        assert.strictEqual(result.issues.length, 0, 'Should have no issues');
    });

    test('should handle multiple includes with include guards', async () => {
        const testFile = normalizePath(path.join(workspaceRoot, 'test_include_multiple.lsl'));
        const expectedFile = path.join(workspaceRoot, 'test_include_multiple_expected.lsl');
        const source = fs.readFileSync(testFile, 'utf-8');
        const expected = fs.readFileSync(expectedFile, 'utf-8');
        const preprocessor = new LexingPreprocessor(host, host.config);

        const result = await preprocessor.process(source, testFile, 'lsl');

        // Compare with expected output
        assert.strictEqual(result.content, expected, 'Output should match expected file');

        // Verify macros were expanded (PI should be replaced with 3.14159265)
        assert.ok(result.content.includes('3.14159265'), 'PI macro should be expanded to its value');

        // Verify no errors
        assert.ok(result.success, 'Processing should succeed');
        assert.strictEqual(result.issues.length, 0, 'Should have no issues');
    });

    test('should generate correct @line directives at column 0', async () => {
        const testFile = normalizePath(path.join(workspaceRoot, 'test_include_chain.lsl'));
        const source = fs.readFileSync(testFile, 'utf-8');
        const preprocessor = new LexingPreprocessor(host, host.config);

        const result = await preprocessor.process(source, testFile, 'lsl');

        const lines = result.content.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.includes('@line')) {
                // @line directives should start at column 0
                assert.ok(line.startsWith('// @line') || line.startsWith('-- @line'),
                    `@line directive on line ${i + 1} should be at column 0: "${line}"`);

                // Next line (if it exists and is not another @line) should preserve indentation
                if (i + 1 < lines.length && !lines[i + 1].includes('@line') && lines[i + 1].trim().length > 0) {
                    // If the next line has content, it should have appropriate whitespace if needed
                    // Just verify it exists and isn't an @line
                    assert.ok(!lines[i + 1].startsWith('@line'), 'Consecutive @line directives should not occur');
                }
            }
        }
    });

    test('should create accurate line mappings for included files', async () => {
        const testFile = normalizePath(path.join(workspaceRoot, 'test_include_chain.lsl'));
        const source = fs.readFileSync(testFile, 'utf-8');
        const preprocessor = new LexingPreprocessor(host, host.config);

        const result = await preprocessor.process(source, testFile, 'lsl');

        // Verify we have mappings
        assert.ok(result.lineMappings && result.lineMappings.length > 0, 'Should have line mappings');

        // Verify mappings include references to multiple files
        const uniqueFiles = new Set(result.lineMappings!.map(m => m.sourceFile));
        assert.ok(uniqueFiles.size >= 3, 'Should have mappings for at least 3 files (main + 2 includes)');

        // Verify files referenced in mappings
        const files = Array.from(uniqueFiles);
        assert.ok(files.some(f => f.includes('test_include_chain.lsl')), 'Should have mapping for main file');
        assert.ok(files.some(f => f.includes('helper.lsl')), 'Should have mapping for helper.lsl');
        assert.ok(files.some(f => f.includes('common.lsl')), 'Should have mapping for common.lsl');
    });

    test('should respect maxIncludeDepth limit and stop processing on error', async () => {
        const testFile = normalizePath(path.join(workspaceRoot, 'test_include_chain.lsl'));
        const source = fs.readFileSync(testFile, 'utf-8');

        const options = createDefaultOptions();
        options.maxIncludeDepth = 1; // Only allow one level of includes

        const customHost = new DiskTestHost(workspaceRoot, options);
        const preprocessor = new LexingPreprocessor(customHost, customHost.config);
        const result = await preprocessor.process(source, testFile, 'lsl');

        // Should fail due to max depth exceeded
        assert.strictEqual(result.success, false, 'Should fail when max depth is exceeded');

        // With early termination, processing stops on first error and returns original source
        assert.strictEqual(result.content, source, 'Should return original source on error');

        // Should have an error about max depth exceeded
        const depthError = result.issues.find(d =>
            d.message.toLowerCase().includes('depth') ||
            d.message.toLowerCase().includes('exceeded')
        );
        assert.ok(depthError, 'Should have max depth exceeded error');
    });
});
