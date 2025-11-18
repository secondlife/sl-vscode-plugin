/**
 * @file require-table.test.ts
 * Tests for require() table-based module loading in SLua
 *
 * Tests the new table-based require mechanism where:
 * 1. Required files are wrapped in anonymous functions
 * 2. Functions are stored in a table at the start of the main file
 * 3. Require directives invoke the function from the table
 * 4. Each file is added to the table exactly once
 * 5. Table is cleaned up at the end
 */

import * as assert from 'assert';
import * as path from 'path';
import { Parser } from '../../shared/parser';
import { Lexer } from '../../shared/lexer';
import { NormalizedPath, normalizePath } from '../../interfaces/hostinterface';

suite('Require Table Tests', () => {
    const testFile = normalizePath('/test/main.luau');

    /**
     * Create a minimal mock host for testing with in-memory files
     */
    function createMockHost(files: Map<NormalizedPath, string>): any {
        return {
            config: {} as any,
            readFile: async (p: NormalizedPath): Promise<string | null> => {
                return files.get(p) || null;
            },
            exists: async (p: NormalizedPath): Promise<boolean> => {
                return files.has(p);
            },
            resolveFile: async (
                filename: string,
                from: NormalizedPath,
                extensions?: string[],
                includePaths?: string[]
            ): Promise<NormalizedPath | null> => {
                // Simple resolution: look in same directory as caller
                const resolved = normalizePath(path.join(path.dirname(from), filename));
                return files.has(resolved) ? resolved : null;
            },
            writeFile: async (): Promise<boolean> => true,
            readJSON: async (): Promise<any> => null,
            writeJSON: async (): Promise<boolean> => true,
            fileNameToUri: (fileName: NormalizedPath): string => {
                const testIndex = fileName.indexOf('test');
                const relativePath = testIndex !== -1 ? fileName.substring(testIndex) : fileName;
                const normalizedPath = relativePath.replace(/\\/g, '/');
                return "unittest:///" + normalizedPath;
            },
            uriToFileName: (uri: string): NormalizedPath => {
                return normalizePath(uri.replace(/^unittest:\/\/\//, '/'));
            },
        };
    }

    test('should wrap required module in function', async () => {
        const moduleFile = normalizePath('/test/module.luau');
        const files = new Map<NormalizedPath, string>();
        files.set(moduleFile, 'local x = 42\nreturn x');
        files.set(testFile, 'local result = require("module.luau")');

        const host = createMockHost(files);

        const lexer = new Lexer('local result = require("module.luau")', 'luau');
        const tokens = lexer.tokenize();

        const parser = new Parser(tokens, testFile, 'luau', host);
        const result = await parser.parse();

        // Should contain function wrapper
        assert.ok(result.source.includes('(function()'), 'Should have function opening');
        assert.ok(result.source.includes('end)'), 'Should have function closing');
    });

    test('should emit require table at file start', async () => {
        const moduleFile = normalizePath('/test/module.luau');
        const files = new Map<NormalizedPath, string>();
        files.set(moduleFile, 'local x = 42');
        files.set(testFile, 'local result = require("module.luau")');

        const host = createMockHost(files);

        const lexer = new Lexer('local result = require("module.luau")', 'luau');
        const tokens = lexer.tokenize();

        const parser = new Parser(tokens, testFile, 'luau', host);
        const result = await parser.parse();

        // Should start with table declaration
        assert.ok(result.source.startsWith('local __require_table'), 'Should start with table declaration');
        assert.ok(result.source.includes('local __require_table: { [number]: () -> any } = {}'), 'Should have table opening');
    });

    test('should emit table cleanup at file end', async () => {
        const moduleFile = normalizePath('/test/module.luau');
        const files = new Map<NormalizedPath, string>();
        files.set(moduleFile, 'local x = 42');
        files.set(testFile, 'local result = require("module.luau")');

        const host = createMockHost(files);

        const lexer = new Lexer('local result = require("module.luau")', 'luau');
        const tokens = lexer.tokenize();

        const parser = new Parser(tokens, testFile, 'luau', host);
        const result = await parser.parse();

        // Should end with table cleanup
        assert.ok(result.source.includes('__require_table = nil'), 'Should have table cleanup');
    });

    test('should invoke module from table at require point', async () => {
        const moduleFile = normalizePath('/test/module.luau');
        const files = new Map<NormalizedPath, string>();
        files.set(moduleFile, 'local x = 42');
        files.set(testFile, 'local result = require("module.luau")');

        const host = createMockHost(files);

        const lexer = new Lexer('local result = require("module.luau")', 'luau');
        const tokens = lexer.tokenize();

        const parser = new Parser(tokens, testFile, 'luau', host);
        const result = await parser.parse();

        // Should have invocation in place of require
        assert.ok(result.source.includes('__require_table[1]()'), 'Should have table invocation');
    });

    test('should use same module ID for duplicate requires', async () => {
        const moduleFile = normalizePath('/test/module.luau');
        const files = new Map<NormalizedPath, string>();
        files.set(moduleFile, 'local x = 42');
        files.set(testFile, 'require("module.luau")\nrequire("module.luau")');

        const host = createMockHost(files);

        const source = 'require("module.luau")\nrequire("module.luau")';
        const lexer = new Lexer(source, 'luau');
        const tokens = lexer.tokenize();

        const parser = new Parser(tokens, testFile, 'luau', host);
        const result = await parser.parse();

        // Count occurrences of module in table - should be only once
        const tableMatch = result.source.match(/\[1\]\s*=/g);
        assert.strictEqual(tableMatch?.length, 1, 'Module should appear in table only once');

        // Count invocations - should be twice
        const invocationMatches = result.source.match(/__require_table\[1\]\(\)/g);
        assert.strictEqual(invocationMatches?.length, 2, 'Should have two invocations');
    });

    test('should assign different IDs to different modules', async () => {
        const module1 = normalizePath('/test/module1.luau');
        const module2 = normalizePath('/test/module2.luau');
        const files = new Map<NormalizedPath, string>();
        files.set(module1, 'local x = 1');
        files.set(module2, 'local y = 2');
        files.set(testFile, 'require("module1.luau")\nrequire("module2.luau")');

        const host = createMockHost(files);

        const source = 'require("module1.luau")\nrequire("module2.luau")';
        const lexer = new Lexer(source, 'luau');
        const tokens = lexer.tokenize();

        const parser = new Parser(tokens, testFile, 'luau', host);
        const result = await parser.parse();

        // Should have both modules in table
        assert.ok(result.source.includes('[1] ='), 'Should have module 1');
        assert.ok(result.source.includes('[2] ='), 'Should have module 2');

        // Should have invocations for both
        assert.ok(result.source.includes('__require_table[1]()'), 'Should invoke module 1');
        assert.ok(result.source.includes('__require_table[2]()'), 'Should invoke module 2');
    });

    test('should include @line directives in wrapped modules', async () => {
        const moduleFile = normalizePath('/test/module.luau');
        const files = new Map<NormalizedPath, string>();
        files.set(moduleFile, 'local x = 42');
        files.set(testFile, 'require("module.luau")');

        const host = createMockHost(files);

        const lexer = new Lexer('require("module.luau")', 'luau');
        const tokens = lexer.tokenize();

        const parser = new Parser(tokens, testFile, 'luau', host);
        const result = await parser.parse();

        // Should have @line directive in wrapped module
        assert.ok(result.source.includes('-- @line 1'), 'Should have @line directive');
        // With workspace-relative paths, should reference the module's relative path (not absolute)
        assert.ok(result.source.includes('module.luau'), 'Should reference module file');
    });

    test('should not emit table if no requires', async () => {
        const source = 'local x = 42';
        const lexer = new Lexer(source, 'luau');
        const tokens = lexer.tokenize();

        const parser = new Parser(tokens, testFile, 'luau');
        const result = await parser.parse();

        // Should not have require table if no requires
        assert.ok(!result.source.includes('__require_table'), 'Should not have require table');
    });

    test('should handle nested requires (require within required module)', async () => {
        const utilsFile = normalizePath('/test/utils.luau');
        const moduleFile = normalizePath('/test/module.luau');
        const files = new Map<NormalizedPath, string>();
        files.set(utilsFile, 'local function helper() end');
        files.set(moduleFile, 'require("utils.luau")\nlocal x = 42');
        files.set(testFile, 'require("module.luau")');

        const host = createMockHost(files);

        const lexer = new Lexer('require("module.luau")', 'luau');
        const tokens = lexer.tokenize();

        const parser = new Parser(tokens, testFile, 'luau', host);
        const result = await parser.parse();

        // Should have both modules in table
        assert.ok(result.source.includes('[1] ='), 'Should have first module');
        assert.ok(result.source.includes('[2] ='), 'Should have second module');
    });

    // Tests using real files on disk
    suite('Disk-based Integration Tests', () => {
        const fs = require('fs');
        const workspaceRoot = path.join(__dirname, '..', '..', '..', 'src', 'test', 'workspace', 'set_2');

        /**
         * Create a file-based host that reads from disk
         */
        function createFileHost(rootDir: string): any {
            return {
                config: {} as any,
                readFile: async (filePath: NormalizedPath): Promise<string | null> => {
                    try {
                        return fs.readFileSync(filePath, 'utf8');
                    } catch {
                        return null;
                    }
                },
                exists: async (filePath: NormalizedPath): Promise<boolean> => {
                    return fs.existsSync(filePath);
                },
                resolveFile: async (
                    filename: string,
                    from: NormalizedPath,
                    extensions?: string[],
                    includePaths?: string[]
                ): Promise<NormalizedPath | null> => {
                    const fromDir = path.dirname(from);
                    const resolved = normalizePath(path.join(fromDir, filename));
                    if (fs.existsSync(resolved)) {
                        return resolved;
                    }
                    return null;
                },
                writeFile: async (): Promise<boolean> => true,
                readJSON: async (): Promise<any> => null,
                writeJSON: async (): Promise<boolean> => true,
                readYAML: async (): Promise<any> => null,
                readTOML: async (): Promise<any> => null,
                writeYAML: async (): Promise<boolean> => true,
                writeTOML: async (): Promise<boolean> => true,
                fileNameToUri: (fileName: NormalizedPath): string => {
                    const testIndex = fileName.indexOf('test');
                    const relativePath = testIndex !== -1 ? fileName.substring(testIndex) : fileName;
                    const normalizedPath = relativePath.replace(/\\/g, '/');
                    return "unittest:///" + normalizedPath;
                },
                uriToFileName: (uri: string): NormalizedPath => {
                    return normalizePath(uri.replace(/^unittest:\/\/\//, '/'));
                },
            };
        }

        test('should handle nested requires (A->B->C->D) from disk files', async () => {
            const mainFile = normalizePath(path.join(workspaceRoot, 'nested_a.luau'));

            const host = createFileHost(workspaceRoot);

            // Read the main file
            const mainContent = fs.readFileSync(mainFile, 'utf8');
            const lexer = new Lexer(mainContent, 'luau');
            const tokens = lexer.tokenize();

            // Parse with the file host
            const parser = new Parser(tokens, mainFile, 'luau', host);
            const result = await parser.parse();

            // Check that all modules are in the table
            assert.ok(result.source.includes('[1] ='), 'Should have module 1 (B)');
            assert.ok(result.source.includes('[2] ='), 'Should have module 2 (C)');
            assert.ok(result.source.includes('[3] ='), 'Should have module 3 (D)');

            // Check that table is created and cleaned up
            assert.ok(result.source.includes('local __require_table: { [number]: () -> any } = {}'), 'Should have table declaration');
            assert.ok(result.source.includes('__require_table = nil :: any'), 'Should have table cleanup');

            // Verify invocations are present
            assert.ok(result.source.includes('__require_table[1]()'), 'Should have invocation for module B');
            assert.ok(result.source.includes('__require_table[2]()'), 'Should have invocation for module C');
            assert.ok(result.source.includes('__require_table[3]()'), 'Should have invocation for module D');

            // Check @line directives are present (paths may be absolute)
            assert.ok(result.source.includes('nested_b.luau"'), 'Should have @line for B');
            assert.ok(result.source.includes('nested_c.luau"'), 'Should have @line for C');
            assert.ok(result.source.includes('nested_d.luau"'), 'Should have @line for D');

            // Verify the structure: D is used only once in the table
            const module3Matches = result.source.match(/\[3\]\s*=/g);
            assert.strictEqual(module3Matches?.length, 1, 'Module D ([3]) should appear exactly once in table');

            // Verify nested structure: B calls [2], C calls [3]
            assert.ok(result.source.includes('local moduleC = __require_table[2]()'), 'B should invoke C as [2]');
            assert.ok(result.source.includes('local moduleD = __require_table[3]()'), 'C should invoke D as [3]');
        });

        test('should handle diamond dependency (A->B,D; B->D) from disk files', async () => {
            const mainFile = normalizePath(path.join(workspaceRoot, 'diamond_a.luau'));

            const host = createFileHost(workspaceRoot);

            // Read the main file
            const mainContent = fs.readFileSync(mainFile, 'utf8');
            const lexer = new Lexer(mainContent, 'luau');
            const tokens = lexer.tokenize();

            // Parse with the file host
            const parser = new Parser(tokens, mainFile, 'luau', host);
            const result = await parser.parse();

            // Check that D appears only once in the table
            const moduleMatches = result.source.match(/\[2\]\s*=/g);
            assert.strictEqual(moduleMatches?.length, 1, 'Module D should appear only once in table as [2]');

            // Check that D is invoked twice (once in B, once in A)
            const invocationMatches = result.source.match(/__require_table\[2\]\(\)/g);
            assert.strictEqual(invocationMatches?.length, 2, 'Module D should be invoked twice');

            // Verify both B and D are in the table
            assert.ok(result.source.includes('[1] ='), 'Should have module 1 (B)');
            assert.ok(result.source.includes('[2] ='), 'Should have module 2 (D)');

            // D should NOT appear as [3] since it's reused
            assert.ok(!result.source.includes('[3] ='), 'Should not have module 3 (D is shared)');

            // Check @line directives (paths may be absolute)
            assert.ok(result.source.includes('diamond_b.luau"'), 'Should have @line for B');
            assert.ok(result.source.includes('diamond_d.luau"'), 'Should have @line for D');

            // Verify B invokes D (variable name is moduleD not just d)
            assert.ok(result.source.includes('local moduleD = __require_table[2]()'), 'B should invoke D as [2]');
        });

        test('should handle complex nested diamond (A->B,C; B->D; C->D)', async () => {
            // Create test files for this scenario
            const files = new Map<NormalizedPath, string>();

            const fileA = normalizePath(path.join(workspaceRoot, 'complex_a.luau'));
            const fileB = normalizePath(path.join(workspaceRoot, 'complex_b.luau'));
            const fileC = normalizePath(path.join(workspaceRoot, 'complex_c.luau'));
            const fileD = normalizePath(path.join(workspaceRoot, 'complex_d.luau'));

            // Create a hybrid host that uses in-memory files
            const memoryHost = {
                config: {} as any,
                readFile: async (p: NormalizedPath): Promise<string | null> => {
                    return files.get(p) || null;
                },
                exists: async (p: NormalizedPath): Promise<boolean> => {
                    return files.has(p);
                },
                resolveFile: async (
                    filename: string,
                    from: NormalizedPath,
                    extensions?: string[],
                    includePaths?: string[]
                ): Promise<NormalizedPath | null> => {
                    const fromDir = path.dirname(from);
                    const resolved = normalizePath(path.join(fromDir, filename));
                    return files.has(resolved) ? resolved : null;
                },
                writeFile: async (): Promise<boolean> => true,
                readJSON: async (): Promise<any> => null,
                writeJSON: async (): Promise<boolean> => true,
                readYAML: async (): Promise<any> => null,
                readTOML: async (): Promise<any> => null,
                writeYAML: async (): Promise<boolean> => true,
                writeTOML: async (): Promise<boolean> => true,
                fileNameToUri: (fileName: NormalizedPath): string => {
                    // Strip path to only include directories/filename after "test" directory
                    const testIndex = fileName.indexOf('test');
                    const relativePath = testIndex !== -1 ? fileName.substring(testIndex) : fileName;
                    // Normalize backslashes to forward slashes
                    const normalizedPath = relativePath.replace(/\\/g, '/');
                    return "unittest:///" + normalizedPath;
                },
                uriToFileName: (uri: string): NormalizedPath => {
                    return normalizePath(uri.replace("unittest:///", ""));
                }
            };

            // Set up the complex diamond
            files.set(fileD, 'return { shared_value = 999 }');
            files.set(fileC, 'local d = require("complex_d.luau")\nlocal function getC() return d.shared_value end\nreturn { getC = getC }');
            files.set(fileB, 'local d = require("complex_d.luau")\nlocal function getB() return d.shared_value end\nreturn { getB = getB }');
            files.set(fileA, 'local b = require("complex_b.luau")\nlocal c = require("complex_c.luau")\nprint(b.getB(), c.getC())');

            // Parse A
            const mainContent = files.get(fileA)!;
            const lexer = new Lexer(mainContent, 'luau');
            const tokens = lexer.tokenize();
            const parser = new Parser(tokens, fileA, 'luau', memoryHost);
            const result = await parser.parse();

            // Debug: Log the actual output to see what indices are used
            console.log('=== COMPLEX DIAMOND OUTPUT ===');
            console.log(result.source);
            console.log('=== END OUTPUT ===');

            // Verify D appears only once in table (should be at index 2)
            const dTableRegex = /shared_value = 999/g;
            const dTableMatches = result.source.match(dTableRegex);
            assert.strictEqual(dTableMatches?.length, 1, 'Module D should appear once in table');

            // Verify D is invoked twice (once in B and once in C)
            const dInvocationMatches = result.source.match(/__require_table\[2\]\(\)/g);
            assert.strictEqual(dInvocationMatches?.length, 2, 'Module D should be invoked twice (from B and C)');

            // Verify all three modules are in the table
            assert.ok(result.source.includes('[1] ='), 'Should have module 1 (B)');
            assert.ok(result.source.includes('[2] ='), 'Should have module 2 (D - shared)');
            assert.ok(result.source.includes('[3] ='), 'Should have module 3 (C)');

            // Should not have a 4th module
            assert.ok(!result.source.includes('[4] ='), 'Should not have module 4');
        });
    });
});
