/**
 * @file include-diagnostics.test.ts
 * Tests for IncludeProcessor diagnostic reporting (Phase 3)
 * Copyright (C) 2025, Linden Research, Inc.
 */

import * as assert from 'assert';
import { IncludeProcessor, IncludeState } from '../../shared/includeprocessor';
import { DiagnosticCollector, DiagnosticSeverity, ErrorCodes } from '../../shared/diagnostics';
import { NormalizedPath, HostInterface, normalizePath } from '../../interfaces/hostinterface';
import { MacroProcessor } from '../../shared/macroprocessor';
import { ConditionalProcessor } from '../../shared/conditionalprocessor';

suite('IncludeProcessor Diagnostics', () => {
    const testFile = normalizePath("d:/test/main.lsl");
    let diagnostics: DiagnosticCollector;
    let macros: MacroProcessor;
    let conditionals: ConditionalProcessor;

    setup(() => {
        diagnostics = new DiagnosticCollector();
        macros = new MacroProcessor('lsl');
        conditionals = new ConditionalProcessor('lsl');
    });

    suite('INC001: File Not Found', () => {
        test('should error when include file does not exist', async () => {
            // Given: A host that cannot find the file
            const host: Partial<HostInterface> = {
                readFile: async (_path: NormalizedPath) => null,
                exists: async (_path: NormalizedPath) => false,
                resolveFile: async (_filename: string, _from: NormalizedPath) => null
            };

            const processor = new IncludeProcessor('lsl', host as HostInterface);
            const state = IncludeProcessor.createState();

            // When: Trying to include a non-existent file
            const result = await processor.processInclude(
                'missing.lsl',
                testFile,
                false,
                state,
                macros,
                conditionals,
                diagnostics,
                1,
                0
            );

            // Then: Should create error diagnostic
            assert.strictEqual(result.success, false);
            const errors = diagnostics.getAll();
            assert.strictEqual(errors.length, 1);
            assert.strictEqual(errors[0].severity, DiagnosticSeverity.ERROR);
            assert.strictEqual(errors[0].code, ErrorCodes.FILE_NOT_FOUND);
            assert.ok(errors[0].message.includes('missing.lsl'));
            assert.strictEqual(errors[0].sourceFile, testFile);
            assert.strictEqual(errors[0].line, 1);
        });

        test('should not error when file exists', async () => {
            // Given: A host that can find the file
            const includePath = normalizePath("d:/test/lib.lsl");
            const host: Partial<HostInterface> = {
                readFile: async (path: NormalizedPath) => {
                    if (path === includePath) return '// Library code';
                    return null;
                },
                exists: async (path: NormalizedPath) => path === includePath,
                resolveFile: async (filename: string, _from: NormalizedPath) => {
                    if (filename === 'lib.lsl') return includePath;
                    return null;
                }
            };

            const processor = new IncludeProcessor('lsl', host as HostInterface);
            const state = IncludeProcessor.createState();

            // When: Including an existing file
            const result = await processor.processInclude(
                'lib.lsl',
                testFile,
                false,
                state,
                macros,
                conditionals,
                diagnostics,
                1,
                0
            );

            // Then: Should succeed without diagnostics
            assert.strictEqual(result.success, true);
            assert.strictEqual(diagnostics.getAll().length, 0);
        });
    });

    suite('INC002: Circular Include', () => {
        test('should error on circular include', async () => {
            // Given: A file that's already in the include stack
            const circularPath = normalizePath("d:/test/circular.lsl");
            const host: Partial<HostInterface> = {
                readFile: async (_path: NormalizedPath) => '// Content',
                exists: async (_path: NormalizedPath) => true,
                resolveFile: async (_filename: string, _from: NormalizedPath) => circularPath
            };

            const processor = new IncludeProcessor('lsl', host as HostInterface);
            const state = IncludeProcessor.createState();
            state.includeStack.push(circularPath); // Already in stack

            // When: Trying to include the same file again
            const result = await processor.processInclude(
                'circular.lsl',
                testFile,
                false,
                state,
                macros,
                conditionals,
                diagnostics,
                5,
                0
            );

            // Then: Should create error diagnostic
            assert.strictEqual(result.success, false);
            const errors = diagnostics.getAll();
            assert.strictEqual(errors.length, 1);
            assert.strictEqual(errors[0].severity, DiagnosticSeverity.ERROR);
            assert.strictEqual(errors[0].code, ErrorCodes.CIRCULAR_INCLUDE);
            assert.ok(errors[0].message.includes('Circular'));
            assert.ok(errors[0].message.includes('circular.lsl'));
            assert.strictEqual(errors[0].line, 5);
        });

        test('should allow include when not circular', async () => {
            // Given: A normal include scenario
            const includePath = normalizePath("d:/test/normal.lsl");
            const host: Partial<HostInterface> = {
                readFile: async (_path: NormalizedPath) => '// Content',
                exists: async (_path: NormalizedPath) => true,
                resolveFile: async (_filename: string, _from: NormalizedPath) => includePath
            };

            const processor = new IncludeProcessor('lsl', host as HostInterface);
            const state = IncludeProcessor.createState();

            // When: Including a file not in the stack
            const result = await processor.processInclude(
                'normal.lsl',
                testFile,
                false,
                state,
                macros,
                conditionals,
                diagnostics,
                1,
                0
            );

            // Then: Should succeed
            assert.strictEqual(result.success, true);
            assert.strictEqual(diagnostics.getAll().length, 0);
        });
    });

    suite('INC003: Include Depth Exceeded', () => {
        test('should error when max depth exceeded', async () => {
            // Given: Include state at max depth
            const host: Partial<HostInterface> = {
                readFile: async (_path: NormalizedPath) => '// Content',
                exists: async (_path: NormalizedPath) => true,
                resolveFile: async (_filename: string, _from: NormalizedPath) =>
                    normalizePath("d:/test/deep.lsl")
            };

            const processor = new IncludeProcessor('lsl', host as HostInterface);
            const maxDepth = 3;
            const state = IncludeProcessor.createState(maxDepth);
            state.includeDepth = maxDepth; // At max depth

            // When: Trying to include another file
            const result = await processor.processInclude(
                'deep.lsl',
                testFile,
                false,
                state,
                macros,
                conditionals,
                diagnostics,
                10,
                0
            );

            // Then: Should create error diagnostic
            assert.strictEqual(result.success, false);
            const errors = diagnostics.getAll();
            assert.strictEqual(errors.length, 1);
            assert.strictEqual(errors[0].severity, DiagnosticSeverity.ERROR);
            assert.strictEqual(errors[0].code, ErrorCodes.INCLUDE_DEPTH_EXCEEDED);
            assert.ok(errors[0].message.includes('Maximum include depth'));
            assert.ok(errors[0].message.includes('3'));
            assert.strictEqual(errors[0].line, 10);
        });

        test('should not error when below max depth', async () => {
            // Given: Include state below max depth
            const includePath = normalizePath("d:/test/shallow.lsl");
            const host: Partial<HostInterface> = {
                readFile: async (_path: NormalizedPath) => '// Content',
                exists: async (_path: NormalizedPath) => true,
                resolveFile: async (_filename: string, _from: NormalizedPath) => includePath
            };

            const processor = new IncludeProcessor('lsl', host as HostInterface);
            const state = IncludeProcessor.createState(5);
            state.includeDepth = 2; // Below max

            // When: Including a file
            const result = await processor.processInclude(
                'shallow.lsl',
                testFile,
                false,
                state,
                macros,
                conditionals,
                diagnostics,
                1,
                0
            );

            // Then: Should succeed
            assert.strictEqual(result.success, true);
            assert.strictEqual(diagnostics.getAll().length, 0);
        });
    });

    suite('INC005: File Read Error', () => {
        test('should error when file cannot be read', async () => {
            // Given: A host that resolves the file but cannot read it
            const errorPath = normalizePath("d:/test/unreadable.lsl");
            const host: Partial<HostInterface> = {
                readFile: async (_path: NormalizedPath) => null, // Read fails
                exists: async (_path: NormalizedPath) => true,
                resolveFile: async (_filename: string, _from: NormalizedPath) => errorPath
            };

            const processor = new IncludeProcessor('lsl', host as HostInterface);
            const state = IncludeProcessor.createState();

            // When: Trying to include an unreadable file
            const result = await processor.processInclude(
                'unreadable.lsl',
                testFile,
                false,
                state,
                macros,
                conditionals,
                diagnostics,
                7,
                0
            );

            // Then: Should create error diagnostic
            assert.strictEqual(result.success, false);
            const errors = diagnostics.getAll();
            assert.strictEqual(errors.length, 1);
            assert.strictEqual(errors[0].severity, DiagnosticSeverity.ERROR);
            assert.strictEqual(errors[0].code, ErrorCodes.FILE_READ_ERROR);
            assert.ok(errors[0].message.includes('Failed to read'));
            assert.strictEqual(errors[0].line, 7);
        });

        test('should not error when file is readable', async () => {
            // Given: A host that can read the file
            const readablePath = normalizePath("d:/test/readable.lsl");
            const host: Partial<HostInterface> = {
                readFile: async (_path: NormalizedPath) => '// Readable content',
                exists: async (_path: NormalizedPath) => true,
                resolveFile: async (_filename: string, _from: NormalizedPath) => readablePath
            };

            const processor = new IncludeProcessor('lsl', host as HostInterface);
            const state = IncludeProcessor.createState();

            // When: Including a readable file
            const result = await processor.processInclude(
                'readable.lsl',
                testFile,
                false,
                state,
                macros,
                conditionals,
                diagnostics,
                1,
                0
            );

            // Then: Should succeed
            assert.strictEqual(result.success, true);
            assert.strictEqual(diagnostics.getAll().length, 0);
        });
    });

    suite('Multiple Include Errors', () => {
        test('should report each error separately', async () => {
            // Given: Multiple include attempts with different errors
            const host: Partial<HostInterface> = {
                readFile: async (_path: NormalizedPath) => null,
                exists: async (_path: NormalizedPath) => false,
                resolveFile: async (_filename: string, _from: NormalizedPath) => null
            };

            const processor = new IncludeProcessor('lsl', host as HostInterface);
            const state = IncludeProcessor.createState(2);

            // When: Multiple failed includes
            await processor.processInclude('missing1.lsl', testFile, false, state, macros, conditionals, diagnostics, 1, 0);
            await processor.processInclude('missing2.lsl', testFile, false, state, macros, conditionals, diagnostics, 2, 0);

            // Then: Should have multiple error diagnostics
            const errors = diagnostics.getAll();
            assert.strictEqual(errors.length, 2);
            assert.strictEqual(errors[0].code, ErrorCodes.FILE_NOT_FOUND);
            assert.strictEqual(errors[1].code, ErrorCodes.FILE_NOT_FOUND);
            assert.ok(errors[0].message.includes('missing1.lsl'));
            assert.ok(errors[1].message.includes('missing2.lsl'));
        });
    });

    suite('Documentation Tests', () => {
        test('IncludeProcessor exists and has basic functionality', async () => {
            const host: Partial<HostInterface> = {
                readFile: async (_path: NormalizedPath) => null,
                exists: async (_path: NormalizedPath) => false,
                resolveFile: async (_filename: string, _from: NormalizedPath) => null
            };

            const processor = new IncludeProcessor('lsl', host as HostInterface);
            assert.ok(processor);
            assert.ok(typeof processor.processInclude === 'function');
        });

        test('DiagnosticCollector supports include error codes', () => {
            assert.ok(ErrorCodes.FILE_NOT_FOUND);
            assert.ok(ErrorCodes.CIRCULAR_INCLUDE);
            assert.ok(ErrorCodes.INCLUDE_DEPTH_EXCEEDED);
            assert.ok(ErrorCodes.FILE_READ_ERROR);

            const collector = new DiagnosticCollector();
            assert.ok(collector);
            assert.ok(typeof collector.add === 'function');
        });
    });

    suite('Complex Circular Chains', () => {
        test('should detect A→B→C→A circular chain', async () => {
            // Given: Three files in a circular chain
            const fileA = normalizePath("d:/test/a.lsl");
            const fileB = normalizePath("d:/test/b.lsl");
            const fileC = normalizePath("d:/test/c.lsl");

            const host: Partial<HostInterface> = {
                readFile: async (path: NormalizedPath) => {
                    if (path === fileA) return '#include "b.lsl"\nstring a;';
                    if (path === fileB) return '#include "c.lsl"\nstring b;';
                    if (path === fileC) return '#include "a.lsl"\nstring c;';
                    return null;
                },
                exists: async () => true,
                resolveFile: async (filename: string) => {
                    if (filename === 'a.lsl') return fileA;
                    if (filename === 'b.lsl') return fileB;
                    if (filename === 'c.lsl') return fileC;
                    return null;
                }
            };

            const processor = new IncludeProcessor('lsl', host as HostInterface);
            const state = IncludeProcessor.createState();

            // When: Processing the chain
            // Start with A
            state.includeStack.push(fileA);
            const resultB = await processor.processInclude('b.lsl', fileA, false, state, macros, conditionals, diagnostics, 1, 0);
            assert.strictEqual(resultB.success, true);

            // Then include B (which will try to include C)
            state.includeStack.push(fileB);
            const resultC = await processor.processInclude('c.lsl', fileB, false, state, macros, conditionals, diagnostics, 1, 0);
            assert.strictEqual(resultC.success, true);

            // Finally C tries to include A (circular!)
            state.includeStack.push(fileC);
            const resultCircular = await processor.processInclude('a.lsl', fileC, false, state, macros, conditionals, diagnostics, 1, 0);

            // Then: Should detect circular include
            assert.strictEqual(resultCircular.success, false);
            const errors = diagnostics.getAll();
            assert.strictEqual(errors.length, 1);
            assert.strictEqual(errors[0].code, ErrorCodes.CIRCULAR_INCLUDE);
            assert.ok(errors[0].message.includes('Circular'));
        });

        test('should detect A→B→A→C (circular earlier in chain)', async () => {
            // Given: Circular dependency that occurs before reaching end
            const fileA = normalizePath("d:/test/a.lsl");
            const fileB = normalizePath("d:/test/b.lsl");

            const host: Partial<HostInterface> = {
                readFile: async (path: NormalizedPath) => {
                    if (path === fileA) return '#include "b.lsl"\nstring a;';
                    if (path === fileB) return '#include "a.lsl"\n#include "c.lsl"\nstring b;';
                    return null;
                },
                exists: async () => true,
                resolveFile: async (filename: string) => {
                    if (filename === 'a.lsl') return fileA;
                    if (filename === 'b.lsl') return fileB;
                    return null;
                }
            };

            const processor = new IncludeProcessor('lsl', host as HostInterface);
            const state = IncludeProcessor.createState();

            // When: A includes B, then B tries to include A again
            state.includeStack.push(fileA);
            const resultB = await processor.processInclude('b.lsl', fileA, false, state, macros, conditionals, diagnostics, 1, 0);
            assert.strictEqual(resultB.success, true);

            state.includeStack.push(fileB);
            const resultCircular = await processor.processInclude('a.lsl', fileB, false, state, macros, conditionals, diagnostics, 1, 0);

            // Then: Should detect circular include
            assert.strictEqual(resultCircular.success, false);
            assert.strictEqual(diagnostics.getAll().length, 1);
            assert.strictEqual(diagnostics.getAll()[0].code, ErrorCodes.CIRCULAR_INCLUDE);
        });

        test('should allow diamond pattern (A→B, A→C, B→D, C→D)', async () => {
            // Given: Diamond dependency (not circular - D is included twice via different paths)
            const fileA = normalizePath("d:/test/a.lsl");
            const fileB = normalizePath("d:/test/b.lsl");
            const fileC = normalizePath("d:/test/c.lsl");
            const fileD = normalizePath("d:/test/d.lsl");

            const host: Partial<HostInterface> = {
                readFile: async (path: NormalizedPath) => {
                    if (path === fileD) return 'string d;';
                    return '// content';
                },
                exists: async () => true,
                resolveFile: async (filename: string) => {
                    if (filename === 'b.lsl') return fileB;
                    if (filename === 'c.lsl') return fileC;
                    if (filename === 'd.lsl') return fileD;
                    return null;
                }
            };

            const processor = new IncludeProcessor('lsl', host as HostInterface);
            const state = IncludeProcessor.createState();

            // When: Following the diamond pattern
            state.includeStack.push(fileA);

            // A → B
            const resultB = await processor.processInclude('b.lsl', fileA, false, state, macros, conditionals, diagnostics, 1, 0);
            assert.strictEqual(resultB.success, true);

            // B → D (first path to D)
            state.includeStack.push(fileB);
            const resultD1 = await processor.processInclude('d.lsl', fileB, false, state, macros, conditionals, diagnostics, 2, 0);
            assert.strictEqual(resultD1.success, true);
            state.includeStack.pop(); // Back to B
            state.includeStack.pop(); // Back to A

            // A → C
            const resultC = await processor.processInclude('c.lsl', fileA, false, state, macros, conditionals, diagnostics, 3, 0);
            assert.strictEqual(resultC.success, true);

            // C → D (second path to D - should be skipped by include guard)
            state.includeStack.push(fileC);
            const resultD2 = await processor.processInclude('d.lsl', fileC, false, state, macros, conditionals, diagnostics, 4, 0);

            // Then: Should succeed, D included only once due to guard
            assert.strictEqual(resultD2.success, true);
            assert.strictEqual(diagnostics.getAll().length, 0, 'Diamond pattern should not create errors');
        });
    });

    suite('Depth Exceeded Scenarios', () => {
        test('should error at exact max depth', async () => {
            // Given: Max depth of 3
            const maxDepth = 3;
            const host: Partial<HostInterface> = {
                readFile: async () => '// content',
                exists: async () => true,
                resolveFile: async (filename: string) => normalizePath(`d:/test/${filename}`)
            };

            const processor = new IncludeProcessor('lsl', host as HostInterface);
            const state = IncludeProcessor.createState(maxDepth);

            // When: Including files up to max depth
            state.includeDepth = 0;
            const result1 = await processor.processInclude('file1.lsl', testFile, false, state, macros, conditionals, diagnostics, 1, 0);
            assert.strictEqual(result1.success, true, 'Depth 0→1 should succeed');

            state.includeDepth = 1;
            const result2 = await processor.processInclude('file2.lsl', testFile, false, state, macros, conditionals, diagnostics, 2, 0);
            assert.strictEqual(result2.success, true, 'Depth 1→2 should succeed');

            state.includeDepth = 2;
            const result3 = await processor.processInclude('file3.lsl', testFile, false, state, macros, conditionals, diagnostics, 3, 0);
            assert.strictEqual(result3.success, true, 'Depth 2→3 should succeed');

            state.includeDepth = 3; // At max depth
            const result4 = await processor.processInclude('file4.lsl', testFile, false, state, macros, conditionals, diagnostics, 4, 0);

            // Then: Should fail at max depth
            assert.strictEqual(result4.success, false, 'Depth 3→4 should fail');
            const errors = diagnostics.getErrors();
            assert.strictEqual(errors.length, 1);
            assert.strictEqual(errors[0].code, ErrorCodes.INCLUDE_DEPTH_EXCEEDED);
        });

        test('should track depth correctly with multiple branches', async () => {
            // Given: Tree structure with different branch depths
            const fileA = normalizePath("d:/test/a.lsl");
            const fileB = normalizePath("d:/test/b.lsl");
            const fileC = normalizePath("d:/test/c.lsl");

            let readCount = 0;
            const host: Partial<HostInterface> = {
                readFile: async () => {
                    readCount++;
                    return '// content';
                },
                exists: async () => true,
                resolveFile: async (filename: string) => {
                    if (filename === 'a.lsl') return fileA;
                    if (filename === 'b.lsl') return fileB;
                    if (filename === 'c.lsl') return fileC;
                    return null;
                }
            };

            const processor = new IncludeProcessor('lsl', host as HostInterface);
            const state = IncludeProcessor.createState(3);

            // When: Processing multiple branches at different depths
            // Branch 1: depth 0→1
            state.includeDepth = 0;
            await processor.processInclude('a.lsl', testFile, false, state, macros, conditionals, diagnostics, 1, 0);
            const depth1 = state.includeDepth;

            // Branch 2: depth 0→1→2
            state.includeDepth = 0;
            await processor.processInclude('b.lsl', testFile, false, state, macros, conditionals, diagnostics, 2, 0);
            state.includeDepth = 1;
            await processor.processInclude('c.lsl', testFile, false, state, macros, conditionals, diagnostics, 3, 0);
            const depth2 = state.includeDepth;

            // Then: Depth tracking should be independent per branch
            assert.strictEqual(depth1, 0, 'Depth should remain at base after first branch');
            assert.strictEqual(depth2, 1, 'Depth should be 1 after second branch operations');
            assert.strictEqual(diagnostics.getAll().length, 0, 'No errors should occur');
        });

        test('should report multiple depth exceeded errors', async () => {
            // Given: Multiple includes that exceed depth
            const host: Partial<HostInterface> = {
                readFile: async () => '// content',
                exists: async () => true,
                resolveFile: async (filename: string) => normalizePath(`d:/test/${filename}`)
            };

            const processor = new IncludeProcessor('lsl', host as HostInterface);
            const state = IncludeProcessor.createState(2);

            // When: Multiple includes exceed depth
            state.includeDepth = 2;
            await processor.processInclude('deep1.lsl', testFile, false, state, macros, conditionals, diagnostics, 1, 0);
            await processor.processInclude('deep2.lsl', testFile, false, state, macros, conditionals, diagnostics, 2, 0);
            await processor.processInclude('deep3.lsl', testFile, false, state, macros, conditionals, diagnostics, 3, 0);

            // Then: Should have multiple depth exceeded errors
            const errors = diagnostics.getErrors();
            assert.strictEqual(errors.length, 3);
            assert.ok(errors.every(e => e.code === ErrorCodes.INCLUDE_DEPTH_EXCEEDED));
        });
    });

    suite('Mixed Successful and Failed Includes', () => {
        test('should process valid includes after failed include', async () => {
            // Given: Mix of valid and invalid includes
            const validFile = normalizePath("d:/test/valid.lsl");
            const host: Partial<HostInterface> = {
                readFile: async (path: NormalizedPath) => {
                    if (path === validFile) return '// valid content';
                    return null;
                },
                exists: async (path: NormalizedPath) => path === validFile,
                resolveFile: async (filename: string) => {
                    if (filename === 'valid.lsl') return validFile;
                    return null; // missing.lsl won't resolve
                }
            };

            const processor = new IncludeProcessor('lsl', host as HostInterface);
            const state = IncludeProcessor.createState();

            // When: Processing mixed includes
            const result1 = await processor.processInclude('missing.lsl', testFile, false, state, macros, conditionals, diagnostics, 1, 0);
            const result2 = await processor.processInclude('valid.lsl', testFile, false, state, macros, conditionals, diagnostics, 2, 0);
            const result3 = await processor.processInclude('also-missing.lsl', testFile, false, state, macros, conditionals, diagnostics, 3, 0);

            // Then: Should have correct results
            assert.strictEqual(result1.success, false, 'First include should fail');
            assert.strictEqual(result2.success, true, 'Second include should succeed');
            assert.strictEqual(result3.success, false, 'Third include should fail');

            const errors = diagnostics.getErrors();
            assert.strictEqual(errors.length, 2, 'Should have 2 errors');
            assert.ok(errors[0].message.includes('missing.lsl'));
            assert.ok(errors[1].message.includes('also-missing.lsl'));
        });

        test('should collect different error types in single parse', async () => {
            // Given: Scenario with multiple error types
            const circularFile = normalizePath("d:/test/circular.lsl");
            const unreadableFile = normalizePath("d:/test/unreadable.lsl");

            const host: Partial<HostInterface> = {
                readFile: async (path: NormalizedPath) => {
                    if (path === unreadableFile) return null; // Read fails
                    return '// content';
                },
                exists: async () => true,
                resolveFile: async (filename: string) => {
                    if (filename === 'missing.lsl') return null; // Not found
                    if (filename === 'circular.lsl') return circularFile;
                    if (filename === 'unreadable.lsl') return unreadableFile;
                    return normalizePath(`d:/test/${filename}`);
                }
            };

            const processor = new IncludeProcessor('lsl', host as HostInterface);
            const state = IncludeProcessor.createState(2);

            // When: Triggering different error types
            // 1. File not found
            await processor.processInclude('missing.lsl', testFile, false, state, macros, conditionals, diagnostics, 1, 0);

            // 2. Circular include
            state.includeStack.push(circularFile);
            await processor.processInclude('circular.lsl', testFile, false, state, macros, conditionals, diagnostics, 2, 0);
            state.includeStack.pop();

            // 3. Depth exceeded
            state.includeDepth = 2;
            await processor.processInclude('deep.lsl', testFile, false, state, macros, conditionals, diagnostics, 3, 0);
            state.includeDepth = 0;

            // 4. Read error
            await processor.processInclude('unreadable.lsl', testFile, false, state, macros, conditionals, diagnostics, 4, 0);

            // Then: Should have all different error types
            const errors = diagnostics.getAll();
            assert.strictEqual(errors.length, 4);

            const errorCodes = errors.map(e => e.code);
            assert.ok(errorCodes.includes(ErrorCodes.FILE_NOT_FOUND));
            assert.ok(errorCodes.includes(ErrorCodes.CIRCULAR_INCLUDE));
            assert.ok(errorCodes.includes(ErrorCodes.INCLUDE_DEPTH_EXCEEDED));
            assert.ok(errorCodes.includes(ErrorCodes.FILE_READ_ERROR));
        });

        test('should track line numbers correctly for multiple errors', async () => {
            // Given: Multiple failures at different lines
            const host: Partial<HostInterface> = {
                readFile: async () => null,
                exists: async () => false,
                resolveFile: async () => null
            };

            const processor = new IncludeProcessor('lsl', host as HostInterface);
            const state = IncludeProcessor.createState();

            // When: Multiple includes at different line numbers
            await processor.processInclude('file1.lsl', testFile, false, state, macros, conditionals, diagnostics, 5, 0);
            await processor.processInclude('file2.lsl', testFile, false, state, macros, conditionals, diagnostics, 12, 0);
            await processor.processInclude('file3.lsl', testFile, false, state, macros, conditionals, diagnostics, 23, 0);

            // Then: Line numbers should be tracked correctly
            const errors = diagnostics.getAll();
            assert.strictEqual(errors.length, 3);
            assert.strictEqual(errors[0].line, 5);
            assert.strictEqual(errors[1].line, 12);
            assert.strictEqual(errors[2].line, 23);
        });

        test('should handle partial success in nested includes', async () => {
            // Given: Nested include where inner include fails
            const outerFile = normalizePath("d:/test/outer.lsl");
            const middleFile = normalizePath("d:/test/middle.lsl");

            const host: Partial<HostInterface> = {
                readFile: async (path: NormalizedPath) => {
                    if (path === outerFile) return '// outer content';
                    if (path === middleFile) return '// middle content';
                    return null;
                },
                exists: async (path: NormalizedPath) =>
                    path === outerFile || path === middleFile,
                resolveFile: async (filename: string) => {
                    if (filename === 'outer.lsl') return outerFile;
                    if (filename === 'middle.lsl') return middleFile;
                    if (filename === 'inner.lsl') return null; // Missing!
                    return null;
                }
            };

            const processor = new IncludeProcessor('lsl', host as HostInterface);
            const state = IncludeProcessor.createState();

            // When: Outer succeeds, middle succeeds, inner fails
            const resultOuter = await processor.processInclude('outer.lsl', testFile, false, state, macros, conditionals, diagnostics, 1, 0);
            assert.strictEqual(resultOuter.success, true);

            state.includeStack.push(outerFile);
            const resultMiddle = await processor.processInclude('middle.lsl', outerFile, false, state, macros, conditionals, diagnostics, 2, 0);
            assert.strictEqual(resultMiddle.success, true);

            state.includeStack.push(middleFile);
            const resultInner = await processor.processInclude('inner.lsl', middleFile, false, state, macros, conditionals, diagnostics, 3, 0);

            // Then: Inner should fail, but outer and middle succeeded
            assert.strictEqual(resultInner.success, false);
            const errors = diagnostics.getErrors();
            assert.strictEqual(errors.length, 1);
            assert.strictEqual(errors[0].code, ErrorCodes.FILE_NOT_FOUND);
        });
    });
});
