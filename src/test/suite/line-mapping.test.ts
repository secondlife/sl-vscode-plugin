/**
 * @file line-mapping.test.ts
 * Unit tests for line mapping functionality in LineMapper
 */

import * as assert from 'assert';
import { LineMapper, LineMapping } from '../../shared/linemapper';
import { normalizePath, NormalizedPath } from '../../interfaces/hostinterface';
import { expectMapping } from './helpers/expectMapping';

suite('Line Mapping Tests', () => {
    // Helper function to create a mock URI
    function np(p: string): NormalizedPath { return normalizePath(p); }

    // Helper function to create line mappings for testing
    function createLineMapping(processedLine: number, sourceFile: string, originalLine: number): LineMapping {
        return { processedLine, sourceFile: np(sourceFile), originalLine };
    }

    suite('convertAbsoluteLineToSource', () => {
        test('should return null for empty line mappings', () => {
            const result = LineMapper.convertAbsoluteLineToSource([], 5);
            assert.strictEqual(result, null);
        });

        test('should return null when no mapping covers the target line', () => {
            const mappings = [
                createLineMapping(10, '/main.lsl', 1),
                createLineMapping(20, '/main.lsl', 11)
            ];

            const result = LineMapper.convertAbsoluteLineToSource(mappings, 5);
            assert.strictEqual(result, null);
        });

        test('should handle simple single-file mapping', () => {
            const mappings = [
                createLineMapping(1, '/main.lsl', 1),
                createLineMapping(5, '/main.lsl', 5),
                createLineMapping(10, '/main.lsl', 10)
            ];

            // Test exact match
            const result1 = LineMapper.convertAbsoluteLineToSource(mappings, 5);
            expectMapping({ processedLine: 5, sourceFile: result1!.source, originalLine: result1!.line }, 5, 5, np('/main.lsl'));

            // Test line between mappings - should calculate offset from previous mapping
            const result2 = LineMapper.convertAbsoluteLineToSource(mappings, 7);
            expectMapping({ processedLine: 7, sourceFile: result2!.source, originalLine: result2!.line }, 7, 7, np('/main.lsl'));
        });

        test('should handle included files with nested includes', () => {
            // Simulate preprocessing of main.lsl with includes:
            // main.lsl (lines 1-3)
            // #include "lib1.lsl" (lines 4-8 from lib1.lsl lines 1-5)
            // main.lsl continues (lines 9-10 from main.lsl lines 4-5)
            // #include "lib2.lsl" (lines 11-15 from lib2.lsl lines 1-5)
            // main.lsl continues (lines 16-20 from main.lsl lines 6-10)

            const mappings = [
                // Main file starts
                createLineMapping(1, '/main.lsl', 1),
                createLineMapping(2, '/main.lsl', 2),
                createLineMapping(3, '/main.lsl', 3),
                // Include lib1.lsl
                createLineMapping(4, '/lib1.lsl', 1),
                createLineMapping(5, '/lib1.lsl', 2),
                createLineMapping(6, '/lib1.lsl', 3),
                createLineMapping(7, '/lib1.lsl', 4),
                createLineMapping(8, '/lib1.lsl', 5),
                // Back to main file
                createLineMapping(9, '/main.lsl', 4),
                createLineMapping(10, '/main.lsl', 5),
                // Include lib2.lsl
                createLineMapping(11, '/lib2.lsl', 1),
                createLineMapping(12, '/lib2.lsl', 2),
                createLineMapping(13, '/lib2.lsl', 3),
                createLineMapping(14, '/lib2.lsl', 4),
                createLineMapping(15, '/lib2.lsl', 5),
                // Back to main file
                createLineMapping(16, '/main.lsl', 6),
                createLineMapping(17, '/main.lsl', 7),
                createLineMapping(18, '/main.lsl', 8),
                createLineMapping(19, '/main.lsl', 9),
                createLineMapping(20, '/main.lsl', 10)
            ];

            // Test line in main file
            const result1 = LineMapper.convertAbsoluteLineToSource(mappings, 2);
            expectMapping({ processedLine: 2, sourceFile: result1!.source, originalLine: result1!.line }, 2, 2, np('/main.lsl'));

            // Test line in first included file
            const result2 = LineMapper.convertAbsoluteLineToSource(mappings, 6);
            expectMapping({ processedLine: 6, sourceFile: result2!.source, originalLine: result2!.line }, 6, 3, np('/lib1.lsl'));

            // Test line back in main file
            const result3 = LineMapper.convertAbsoluteLineToSource(mappings, 9);
            expectMapping({ processedLine: 9, sourceFile: result3!.source, originalLine: result3!.line }, 9, 4, np('/main.lsl'));

            // Test line in second included file
            const result4 = LineMapper.convertAbsoluteLineToSource(mappings, 13);
            expectMapping({ processedLine: 13, sourceFile: result4!.source, originalLine: result4!.line }, 13, 3, np('/lib2.lsl'));

            // Test final line in main file
            const result5 = LineMapper.convertAbsoluteLineToSource(mappings, 20);
            expectMapping({ processedLine: 20, sourceFile: result5!.source, originalLine: result5!.line }, 20, 10, np('/main.lsl'));
        });

        test('should handle deeply nested includes', () => {
            // Simulate: main.lsl includes lib1.lsl which includes lib2.lsl
            // main.lsl (lines 1-2)
            // lib1.lsl (lines 3-4) which includes lib2.lsl at line 4
            //   lib2.lsl (lines 5-7)
            // lib1.lsl continues (lines 8-9)
            // main.lsl continues (lines 10-11)

            const mappings = [
                createLineMapping(1, '/main.lsl', 1),
                createLineMapping(2, '/main.lsl', 2),
                createLineMapping(3, '/lib1.lsl', 1),
                createLineMapping(4, '/lib1.lsl', 2),
                createLineMapping(5, '/lib2.lsl', 1),
                createLineMapping(6, '/lib2.lsl', 2),
                createLineMapping(7, '/lib2.lsl', 3),
                createLineMapping(8, '/lib1.lsl', 3),
                createLineMapping(9, '/lib1.lsl', 4),
                createLineMapping(10, '/main.lsl', 3),
                createLineMapping(11, '/main.lsl', 4)
            ];

            // Test deeply nested file
            const result1 = LineMapper.convertAbsoluteLineToSource(mappings, 6);
            expectMapping({ processedLine: 6, sourceFile: result1!.source, originalLine: result1!.line }, 6, 2, np('/lib2.lsl'));

            // Test back to intermediate include
            const result2 = LineMapper.convertAbsoluteLineToSource(mappings, 8);
            expectMapping({ processedLine: 8, sourceFile: result2!.source, originalLine: result2!.line }, 8, 3, np('/lib1.lsl'));
        });



        test('should use last applicable mapping without offset calculation', () => {
            // Test that it uses the correct mapping when multiple mappings exist
            const mappings = [
                createLineMapping(1, '/main.lsl', 1),
                createLineMapping(5, '/include.lsl', 1),
                createLineMapping(10, '/main.lsl', 5)
            ];

            // Line 7 should use the mapping at processed line 5 and calculate offset
            const result = LineMapper.convertAbsoluteLineToSource(mappings, 7);
            expectMapping({ processedLine: 7, sourceFile: result!.source, originalLine: result!.line }, 7, 3, np('/include.lsl'));
        });

        test('should handle edge case at mapping boundaries', () => {
            const mappings = [
                createLineMapping(1, '/main.lsl', 1),
                createLineMapping(10, '/include.lsl', 1),
                createLineMapping(20, '/main.lsl', 10)
            ];

            // Test exact boundary
            const result1 = LineMapper.convertAbsoluteLineToSource(mappings, 10);
            expectMapping({ processedLine: 10, sourceFile: result1!.source, originalLine: result1!.line }, 10, 1, np('/include.lsl'));

            // Test just before boundary - should calculate offset from previous mapping
            const result2 = LineMapper.convertAbsoluteLineToSource(mappings, 9);
            expectMapping({ processedLine: 9, sourceFile: result2!.source, originalLine: result2!.line }, 9, 9, np('/main.lsl'));

            // Test just after boundary - should calculate offset from include mapping
            const result3 = LineMapper.convertAbsoluteLineToSource(mappings, 11);
            expectMapping({ processedLine: 11, sourceFile: result3!.source, originalLine: result3!.line }, 11, 2, np('/include.lsl'));
        });
    });

    suite('findMappingsForSourceFile', () => {
        test('should find all mappings for a specific source file', () => {
            const mappings = [
                createLineMapping(1, '/main.lsl', 1),
                createLineMapping(5, '/include.lsl', 1),
                createLineMapping(8, '/main.lsl', 5),
                createLineMapping(12, '/include.lsl', 5)
            ];

            const mainFile = np('/main.lsl');
            const result = LineMapper.findMappingsForSourceFile(mappings, mainFile);

            assert.strictEqual(result.length, 2);
            assert.strictEqual(result[0].processedLine, 1);
            assert.strictEqual(result[1].processedLine, 8);
        });
    });

    suite('findProcessedLines', () => {
        test('should find processed lines for specific original location', () => {
            const mappings = [
                createLineMapping(1, '/main.lsl', 1),
                createLineMapping(5, '/main.lsl', 1), // Same original line, different processed line (macro expansion)
                createLineMapping(8, '/main.lsl', 5)
            ];

            const mainFile = np('/main.lsl');
            const result = LineMapper.findProcessedLines(mappings, mainFile, 1);

            assert.strictEqual(result.length, 2);
            assert.strictEqual(result[0], 1);
            assert.strictEqual(result[1], 5);
        });
    });

    suite('Edge Cases', () => {
        test('should handle sparse line mappings correctly', () => {
            // Test case where not every line has a mapping entry
            // This simulates what might happen with macro expansions or blank lines
            const mappings = [
                createLineMapping(1, '/main.lsl', 1),
                createLineMapping(5, '/main.lsl', 2),    // Lines 2-4 in processed file came from line 2 in main
                createLineMapping(10, '/include.lsl', 1), // Lines 6-9 would be between these mappings
                createLineMapping(15, '/main.lsl', 3)     // Lines 11-14 in processed file came from line 3 in main
            ];

            // Test lines between mappings - should calculate offset from previous mapping
            const result1 = LineMapper.convertAbsoluteLineToSource(mappings, 3);
            assert.strictEqual(result1?.source, np('/main.lsl'));
            assert.strictEqual(result1?.line, 3); // Should be 3 (1 + offset 2)

            const result2 = LineMapper.convertAbsoluteLineToSource(mappings, 7);
            assert.strictEqual(result2?.source, np('/main.lsl'));
            assert.strictEqual(result2?.line, 4); // Should be 4 (2 + offset 2)

            const result3 = LineMapper.convertAbsoluteLineToSource(mappings, 12);
            assert.strictEqual(result3?.source, np('/include.lsl'));
            assert.strictEqual(result3?.line, 3); // Should be 3 (1 + offset 2)
        });

        test('should handle the actual preprocessing scenario with includes', () => {
            // This simulates a real preprocessing scenario:
            // main.lsl:
            //   line 1: some code
            //   line 2: #include "helper.lsl"
            //   line 3: more code
            //
            // helper.lsl:
            //   line 1: helper function
            //   line 2: another helper
            //
            // Processed output:
            //   line 1: some code (from main.lsl:1)
            //   line 2: helper function (from helper.lsl:1)
            //   line 3: another helper (from helper.lsl:2)
            //   line 4: more code (from main.lsl:3)

            const mappings = [
                createLineMapping(1, '/main.lsl', 1),
                createLineMapping(2, '/helper.lsl', 1),
                createLineMapping(3, '/helper.lsl', 2),
                createLineMapping(4, '/main.lsl', 3)
            ];

            // Test each line
            const result1 = LineMapper.convertAbsoluteLineToSource(mappings, 1);
            assert.strictEqual(result1?.source, np('/main.lsl'));
            assert.strictEqual(result1?.line, 1);

            const result2 = LineMapper.convertAbsoluteLineToSource(mappings, 2);
            assert.strictEqual(result2?.source, np('/helper.lsl'));
            assert.strictEqual(result2?.line, 1);

            const result3 = LineMapper.convertAbsoluteLineToSource(mappings, 3);
            assert.strictEqual(result3?.source, np('/helper.lsl'));
            assert.strictEqual(result3?.line, 2);

            const result4 = LineMapper.convertAbsoluteLineToSource(mappings, 4);
            assert.strictEqual(result4?.source, np('/main.lsl'));
            assert.strictEqual(result4?.line, 3);
        });

        test('should handle include within macro expansion', () => {
            // Complex case: a macro that includes a file
            // main.lsl:
            //   line 1: some code
            //   line 2: INCLUDE_MACRO("helper.lsl")
            //   line 3: more code
            //
            // The macro expands to an include directive, so the processed file becomes:
            //   line 1: some code (from main.lsl:1)
            //   line 2: helper content line 1 (from helper.lsl:1, but triggered by main.lsl:2)
            //   line 3: helper content line 2 (from helper.lsl:2, but triggered by main.lsl:2)
            //   line 4: more code (from main.lsl:3)

            const mappings = [
                createLineMapping(1, '/main.lsl', 1),
                createLineMapping(2, '/helper.lsl', 1), // From include triggered by macro on main.lsl:2
                createLineMapping(3, '/helper.lsl', 2), // Same include
                createLineMapping(4, '/main.lsl', 3)
            ];

            // The question is: should lines 2-3 map to helper.lsl or main.lsl?
            // Current implementation maps to helper.lsl, which might be correct for navigation
            // but might be wrong for error reporting context

            const result2 = LineMapper.convertAbsoluteLineToSource(mappings, 2);
            const result3 = LineMapper.convertAbsoluteLineToSource(mappings, 3);

            // Current behavior (might be correct)
            assert.strictEqual(result2?.source, np('/helper.lsl'));
            assert.strictEqual(result3?.source, np('/helper.lsl'));
        });

        test('should handle offset calculation with non-sequential original lines', () => {
            // This test demonstrates the correct behavior with offset calculation
            const mappings = [
                createLineMapping(1, '/main.lsl', 10),    // Processed line 1 = Original line 10
                createLineMapping(5, '/main.lsl', 15),    // Processed line 5 = Original line 15
            ];

            // Processed line 3 should map with offset calculation
            const result = LineMapper.convertAbsoluteLineToSource(mappings, 3);
            // With offset calculation: line 10 + offset 2 = line 12
            assert.strictEqual(result?.source, np('/main.lsl'));
            assert.strictEqual(result?.line, 12); // Should be 12 (10 + offset 2)

            // Test another line in the same range
            const result2 = LineMapper.convertAbsoluteLineToSource(mappings, 4);
            assert.strictEqual(result2?.source, np('/main.lsl'));
            assert.strictEqual(result2?.line, 13); // Should be 13 (10 + offset 3)

            // Test the exact mapping boundary
            const result3 = LineMapper.convertAbsoluteLineToSource(mappings, 5);
            assert.strictEqual(result3?.source, np('/main.lsl'));
            assert.strictEqual(result3?.line, 15); // Should be exactly 15
        });
    });
});
