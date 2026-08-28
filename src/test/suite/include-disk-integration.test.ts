/**
 * Disk-based integration tests for LSL #include directives
 * Tests real file I/O with actual files from src/test/workspace/set_1
 */

import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import { LexingPreprocessor, PreprocessorOptions, ScriptLanguage } from '#sl-script-preprocessor';
import { filePathToStringUri, stringUriToFilePath, type StringUri, type HostInterface } from '#sl-script-preprocessor';
import type { FullConfigInterface } from '../../interfaces/configinterface';
import { ConfigKey } from '../../interfaces/configinterface';
import { getLanguageConfig } from '#sl-script-preprocessor';

/**
 * Normalize paths in preprocessor output for comparison with expected files.
 * Replaces absolute file:// URIs with relative-style paths that match expected output.
 * @param content - The preprocessor output content
 * @param workspaceRoot - The workspace root path
 * @returns Content with normalized paths
 */
function normalizePathsForComparison(content: string, workspaceRoot: string): string {
    // Convert workspaceRoot to URI format for matching
    const workspaceUri = filePathToStringUri(workspaceRoot);
    // Extract the path portion after file:///
    const workspaceUriPath = workspaceUri.replace(/^file:\/\/\//, '');

    // Replace absolute paths with relative-style paths matching expected output format
    // The expected files use format like: file:///test/workspace/set_1/...
    // We need to replace: file:///c:/Users/.../src/test/workspace/set_1/...
    // with: file:///test/workspace/set_1/...

    const absolutePattern = new RegExp(
        `file:///${workspaceUriPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\//g, '/')}`,
        'gi'
    );
    return content.replace(absolutePattern, 'file:///test/workspace/set_1');
}

/**
 * Test config implementation
 */
class TestConfig implements FullConfigInterface {
    private options: PreprocessorOptions;

    constructor(options: PreprocessorOptions) {
        this.options = options;
    }

    isEnabled(): boolean {
        return true;
    }

    getConfig<T>(key: ConfigKey): T | undefined {
        // Return individual config values instead of PreprocessorOptions object
        if (key === ConfigKey.PreprocessorEnable) {
            return this.options.enabled as T;
        }
        if (key === ConfigKey.PreprocessorIncludePaths) {
            return (this.options.include?.paths ?? ['.']) as T;
        }
        if (key === ConfigKey.PreprocessorMaxIncludeDepth) {
            return (this.options.include?.maxDepth ?? 5) as T;
        }
        return undefined;
    }
    async setConfig<T>(key: ConfigKey, value: T, scope?: any): Promise<void> {}
    async getWorkspaceConfigPath(): Promise<StringUri> {
        return filePathToStringUri("d:/test/config");
    }
    async getGlobalConfigPath(): Promise<StringUri> {
        return filePathToStringUri("d:/test/global");
    }
    async getExtensionInstallPath(): Promise<StringUri> {
        return filePathToStringUri("d:/test/extension");
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
    private workspaceRoot: string;
    private workspaceRootUri: StringUri;

    constructor(workspaceRoot: string) {
        this.workspaceRoot = workspaceRoot;
        this.workspaceRootUri = filePathToStringUri(workspaceRoot);
    }

    async readFile(filePath: StringUri): Promise<string | null> {
        try {
            const fsPath = stringUriToFilePath(filePath);
            if (!fsPath) return null;
            const content = fs.readFileSync(fsPath, 'utf-8');
            return content;
        } catch (err) {
            return null;
        }
    }

    async exists(filePath: StringUri): Promise<boolean> {
        try {
            const fsPath = stringUriToFilePath(filePath);
            if (!fsPath) return false;
            return fs.existsSync(fsPath);
        } catch {
            return false;
        }
    }

    async resolveFile(
        filename: string,
        from: StringUri,
        extensions?: string[],
        includePaths?: string[]
    ): Promise<StringUri | null> {
        const exts = extensions || ['.lsl'];
        const paths = includePaths || ['./include/', 'include/', '.'];

        // Convert URI to file path for path operations
        const fromPath = stringUriToFilePath(from);
        if (!fromPath) return null;
        const fromDir = path.dirname(fromPath);

        // Try relative to the current file first
        for (const ext of exts) {
            const withExt = filename.endsWith(ext) ? filename : filename + ext;
            const absolutePath = path.resolve(fromDir, withExt);
            if (fs.existsSync(absolutePath)) {
                return filePathToStringUri(absolutePath);
            }
        }

        // Try include paths relative to workspace root
        for (const includePath of paths) {
            let searchDir: string;
            if (includePath.startsWith('./')) {
                searchDir = path.join(fromDir, includePath.slice(2));
            } else if (includePath === '.') {
                searchDir = fromDir;
            } else {
                searchDir = path.join(this.workspaceRoot, includePath);
            }

            for (const ext of exts) {
                const withExt = filename.endsWith(ext) ? filename : filename + ext;
                const absolutePath = path.resolve(searchDir, withExt);
                if (fs.existsSync(absolutePath)) {
                    return filePathToStringUri(absolutePath);
                }
            }
        }

        return null;
    }

    async writeFile(p: StringUri, content: string | Uint8Array): Promise<boolean> {
        return false;
    }

    async readJSON<T = any>(p: StringUri): Promise<T | null> {
        return null;
    }

    async existsInSameWorkspace(knownPath: string, desiredPath: string): Promise<boolean> {
        return false;
    }

    async readYAML<T = any>(p: StringUri): Promise<T | null> {
        return null;
    }

    async readTOML<T = any>(p: StringUri): Promise<T | null> {
        return null;
    }

    async writeJSON(p: StringUri, data: any, pretty?: boolean): Promise<boolean> {
        return false;
    }

    async writeYAML(p: StringUri, data: any): Promise<boolean> {
        return false;
    }

    async writeTOML(p: StringUri, data: Record<string, any>): Promise<boolean> {
        return false;
    }
}

suite('LSL Include Directive Tests - Disk-based Integration', () => {
    let workspaceRoot: string;
    let host: DiskTestHost;
    let config: PreprocessorOptions;

    const lslLanguageConfig = getLanguageConfig('lsl');
    const lslLanguageConfigWithSwitch = getLanguageConfig('lsl');
    lslLanguageConfigWithSwitch.directiveKeywords.push('switch');

    function createDefaultOptions(language: ScriptLanguage): PreprocessorOptions {
        return {
            enabled: true,
            flags: {
                generateWarnings: false,
                generateDecls: false,
                disableInclude: false,
                disableMacros: false,
                disableConditionals: false,
            },
            include: {
                paths: ['./include/', 'include/'],
                maxDepth: 10,
            },
            language: language,
        };
    }

    suiteSetup(() => {
        // Point to the test workspace
        workspaceRoot = path.resolve(__dirname, '../../../src/test/workspace/set_1');
        host = new DiskTestHost(workspaceRoot);
        config = createDefaultOptions("lsl");
    });

    test('should process simple include chain (A->B->C) from disk files', async () => {
        const testFilePath = path.join(workspaceRoot, 'test_include_chain.lsl');
        const testFile = filePathToStringUri(testFilePath);
        const expectedFile = path.join(workspaceRoot, 'test_include_chain_expected.lsl');
        const source = fs.readFileSync(testFilePath, 'utf-8');
        const expected = fs.readFileSync(expectedFile, 'utf-8');
        const preprocessor = new LexingPreprocessor(host, config);

        const result = await preprocessor.process(source, testFile, lslLanguageConfig);

        // Normalize paths for comparison (actual output has absolute URIs, expected has relative)
        const normalizedContent = normalizePathsForComparison(result.content, workspaceRoot);

        // Compare with expected output
        assert.strictEqual(normalizedContent, expected, 'Output should match expected file');

        // Verify no errors
        assert.ok(result.success, 'Processing should succeed');
        assert.strictEqual(result.issues.length, 0, 'Should have no issues');
    });

    test('should handle diamond dependency (A->B,C; B->C) from disk files', async () => {
        const testFilePath = path.join(workspaceRoot, 'test_include_diamond.lsl');
        const testFile = filePathToStringUri(testFilePath);
        const expectedFile = path.join(workspaceRoot, 'test_include_diamond_expected.lsl');
        const source = fs.readFileSync(testFilePath, 'utf-8');
        const expected = fs.readFileSync(expectedFile, 'utf-8');
        const preprocessor = new LexingPreprocessor(host, config);

        const result = await preprocessor.process(source, testFile, lslLanguageConfig);

        // Normalize paths for comparison
        const normalizedContent = normalizePathsForComparison(result.content, workspaceRoot);

        // Compare with expected output
        assert.strictEqual(normalizedContent, expected, 'Output should match expected file');

        // Count occurrences of the add function - should only appear once due to include guards
        const addFunctionMatches = result.content.match(/float add\(float a, float b\)/g);
        assert.strictEqual(addFunctionMatches?.length, 1, 'add function should appear exactly once (include guard works)');

        // Verify no errors
        assert.ok(result.success, 'Processing should succeed');
        assert.strictEqual(result.issues.length, 0, 'Should have no issues');
    });

    test('should handle multiple includes with include guards', async () => {
        const testFilePath = path.join(workspaceRoot, 'test_include_multiple.lsl');
        const testFile = filePathToStringUri(testFilePath);
        const expectedFile = path.join(workspaceRoot, 'test_include_multiple_expected.lsl');
        const source = fs.readFileSync(testFilePath, 'utf-8');
        const expected = fs.readFileSync(expectedFile, 'utf-8');
        const preprocessor = new LexingPreprocessor(host, config);

        const result = await preprocessor.process(source, testFile, lslLanguageConfig);

        // Normalize paths for comparison
        const normalizedContent = normalizePathsForComparison(result.content, workspaceRoot);

        // Compare with expected output
        assert.strictEqual(normalizedContent, expected, 'Output should match expected file');

        // Verify macros were expanded (PI should be replaced with 3.14159265)
        assert.ok(result.content.includes('3.14159265'), 'PI macro should be expanded to its value');

        // Verify no errors
        assert.ok(result.success, 'Processing should succeed');
        assert.strictEqual(result.issues.length, 0, 'Should have no issues');
    });

    test('should generate correct @line directives at column 0', async () => {
        const testFilePath = path.join(workspaceRoot, 'test_include_chain.lsl');
        const testFile = filePathToStringUri(testFilePath);
        const source = fs.readFileSync(testFilePath, 'utf-8');
        const preprocessor = new LexingPreprocessor(host, config);

        const result = await preprocessor.process(source, testFile, lslLanguageConfig);

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
        const testFilePath = path.join(workspaceRoot, 'test_include_chain.lsl');
        const testFile = filePathToStringUri(testFilePath);
        const source = fs.readFileSync(testFilePath, 'utf-8');
        const preprocessor = new LexingPreprocessor(host, config);

        const result = await preprocessor.process(source, testFile, lslLanguageConfig);

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
        const testFilePath = path.join(workspaceRoot, 'test_include_chain.lsl');
        const testFile = filePathToStringUri(testFilePath);
        const source = fs.readFileSync(testFilePath, 'utf-8');

        const options = createDefaultOptions("lsl");
        options.include!.maxDepth = 1; // Only allow one level of includes

        const customHost = new DiskTestHost(workspaceRoot);
        const preprocessor = new LexingPreprocessor(customHost, options);
        const result = await preprocessor.process(source, testFile, lslLanguageConfig);

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

    test('test switch case', async () => {
        const testFilePath = path.join(workspaceRoot, 'test_switch.lsl');
        const testFile = filePathToStringUri(testFilePath);
        const expectedFile = path.join(workspaceRoot, 'test_switch_expected.lsl');
        const source = fs.readFileSync(testFilePath, 'utf-8');
        const expected = fs.readFileSync(expectedFile, 'utf-8');
        const preprocessor = new LexingPreprocessor(host, config);


        const result = await preprocessor.process(source, testFile, lslLanguageConfigWithSwitch);


        // Normalize paths for comparison
        const normalizedContent = normalizePathsForComparison(result.content, workspaceRoot);

        // Compare with expected output
        assert.strictEqual(normalizedContent, expected, 'Output should match expected file');

        // Verify no errors
        assert.ok(result.success, 'Processing should succeed');
        assert.strictEqual(result.issues.length, 0, 'Should have no issues');
    });
});
