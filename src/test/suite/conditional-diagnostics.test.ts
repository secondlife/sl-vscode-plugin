/**
 * @file conditional-diagnostics.test.ts
 * Tests for ConditionalProcessor diagnostic reporting (Phase 2)
 */

import * as assert from 'assert';
import { ConditionalProcessor } from '../../shared/conditionalprocessor';
import { MacroProcessor } from '../../shared/macroprocessor';
import { Lexer, Token, TokenType } from '../../shared/lexer';
import { ErrorCodes, DiagnosticSeverity } from '../../shared/diagnostics';
import { normalizePath } from '../../interfaces/hostinterface';

suite('ConditionalProcessor Diagnostics', () => {
    let conditionals: ConditionalProcessor;
    let macros: MacroProcessor;
    const testFile = normalizePath('test.lsl');

    /**
     * Helper to create a simple numeric token
     */
    function createNumberToken(value: string, line: number, column: number): Token {
        return new Token(TokenType.NUMBER_LITERAL, value, line, column, value.length);
    }

    setup(() => {
        conditionals = new ConditionalProcessor('lsl');
        macros = new MacroProcessor('lsl');
    });

    suite('#elif Diagnostics', () => {
        test('should create diagnostic for #elif without #if', () => {
            const tokens = [createNumberToken('1', 1, 1)];
            const result = conditionals.processElif(tokens, macros, 1, testFile, 1);

            assert.strictEqual(result.success, false);
            assert.strictEqual(result.shouldInclude, false);
            assert.ok(result.diagnostic, 'Diagnostic should be present');
            assert.strictEqual(result.diagnostic?.severity, DiagnosticSeverity.ERROR);
            assert.strictEqual(result.diagnostic?.code, ErrorCodes.MISMATCHED_CONDITIONAL);
            assert.strictEqual(result.diagnostic?.message, '#elif without matching #if');
            assert.strictEqual(result.diagnostic?.line, 1);
            assert.strictEqual(result.diagnostic?.column, 1);
            assert.strictEqual(result.diagnostic?.length, 5); // "#elif"
            assert.strictEqual(result.diagnostic?.sourceFile, testFile);
        });

        test('should create diagnostic for #elif after #else', () => {
            // Setup: #if true, #else
            const ifTokens = [createNumberToken('1', 1, 1)];
            conditionals.processIf(ifTokens, macros, 1);
            conditionals.processElse(2);

            // Try #elif after #else
            const elifTokens = [createNumberToken('1', 3, 1)];
            const result = conditionals.processElif(elifTokens, macros, 3, testFile, 1);

            assert.strictEqual(result.success, false);
            assert.ok(result.diagnostic, 'Diagnostic should be present');
            assert.strictEqual(result.diagnostic?.code, ErrorCodes.MISMATCHED_CONDITIONAL);
            assert.strictEqual(result.diagnostic?.message, '#elif after #else');
            assert.strictEqual(result.diagnostic?.line, 3);
        });

        test('should not create diagnostic when sourceFile is undefined', () => {
            const tokens = [createNumberToken('1', 1, 1)];
            const result = conditionals.processElif(tokens, macros, 1, undefined, 1);

            assert.strictEqual(result.success, false);
            assert.strictEqual(result.diagnostic, undefined, 'Diagnostic should be undefined when no sourceFile');
        });

        test('should create diagnostic with correct column position', () => {
            const tokens = [createNumberToken('1', 5, 10)];
            const result = conditionals.processElif(tokens, macros, 5, testFile, 10);

            assert.ok(result.diagnostic);
            assert.strictEqual(result.diagnostic?.line, 5);
            assert.strictEqual(result.diagnostic?.column, 10);
        });
    });

    suite('#else Diagnostics', () => {
        test('should create diagnostic for #else without #if', () => {
            const result = conditionals.processElse(1, testFile, 1);

            assert.strictEqual(result.success, false);
            assert.strictEqual(result.shouldInclude, false);
            assert.ok(result.diagnostic);
            assert.strictEqual(result.diagnostic?.severity, DiagnosticSeverity.ERROR);
            assert.strictEqual(result.diagnostic?.code, ErrorCodes.MISMATCHED_CONDITIONAL);
            assert.strictEqual(result.diagnostic?.message, '#else without matching #if');
            assert.strictEqual(result.diagnostic?.line, 1);
            assert.strictEqual(result.diagnostic?.column, 1);
            assert.strictEqual(result.diagnostic?.length, 5); // "#else"
            assert.strictEqual(result.diagnostic?.sourceFile, testFile);
        });

        test('should create diagnostic for multiple #else directives', () => {
            // Setup: #if true, #else
            const ifTokens = [createNumberToken('1', 1, 1)];
            conditionals.processIf(ifTokens, macros, 1);
            conditionals.processElse(2, testFile, 1);

            // Try second #else
            const result = conditionals.processElse(3, testFile, 1);

            assert.strictEqual(result.success, false);
            assert.ok(result.diagnostic);
            assert.strictEqual(result.diagnostic?.code, ErrorCodes.MISMATCHED_CONDITIONAL);
            assert.strictEqual(result.diagnostic?.message, 'Multiple #else directives for same #if');
            assert.strictEqual(result.diagnostic?.line, 3);
        });

        test('should not create diagnostic when sourceFile is undefined', () => {
            const result = conditionals.processElse(1, undefined, 1);

            assert.strictEqual(result.success, false);
            assert.strictEqual(result.diagnostic, undefined);
        });
    });

    suite('#endif Diagnostics', () => {
        test('should create diagnostic for #endif without #if', () => {
            const result = conditionals.processEndif(1, testFile, 1);

            assert.strictEqual(result.success, false);
            assert.strictEqual(result.shouldInclude, false);
            assert.ok(result.diagnostic);
            assert.strictEqual(result.diagnostic?.severity, DiagnosticSeverity.ERROR);
            assert.strictEqual(result.diagnostic?.code, ErrorCodes.MISMATCHED_CONDITIONAL);
            assert.strictEqual(result.diagnostic?.message, '#endif without matching #if');
            assert.strictEqual(result.diagnostic?.line, 1);
            assert.strictEqual(result.diagnostic?.column, 1);
            assert.strictEqual(result.diagnostic?.length, 6); // "#endif"
            assert.strictEqual(result.diagnostic?.sourceFile, testFile);
        });

        test('should not create diagnostic when sourceFile is undefined', () => {
            const result = conditionals.processEndif(1, undefined, 1);

            assert.strictEqual(result.success, false);
            assert.strictEqual(result.diagnostic, undefined);
        });

        test('should not create diagnostic for valid #endif', () => {
            // Setup: #if true
            const ifTokens = [createNumberToken('1', 1, 1)];
            conditionals.processIf(ifTokens, macros, 1);

            // Valid #endif
            const result = conditionals.processEndif(2, testFile, 1);

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.diagnostic, undefined, 'No diagnostic should be created for valid #endif');
        });
    });

    suite('Nested Conditionals with Diagnostics', () => {
        test('should create diagnostics for multiple errors in nested structure', () => {
            const diagnostics: any[] = [];

            // #if true
            const ifTokens = [createNumberToken('1', 1, 1)];
            conditionals.processIf(ifTokens, macros, 1);

            // #else
            conditionals.processElse(2, testFile, 1);

            // #elif after #else - ERROR
            const elifTokens = [createNumberToken('1', 3, 1)];
            const elifResult = conditionals.processElif(elifTokens, macros, 3, testFile, 1);
            if (elifResult.diagnostic) {
                diagnostics.push(elifResult.diagnostic);
            }

            // #else again - ERROR
            const elseResult = conditionals.processElse(4, testFile, 1);
            if (elseResult.diagnostic) {
                diagnostics.push(elseResult.diagnostic);
            }

            assert.strictEqual(diagnostics.length, 2, 'Should have collected 2 diagnostics');
            assert.strictEqual(diagnostics[0].message, '#elif after #else');
            assert.strictEqual(diagnostics[1].message, 'Multiple #else directives for same #if');
        });

        test('should report #endif without #if even in nested context', () => {
            // #if true
            const ifTokens = [createNumberToken('1', 1, 1)];
            conditionals.processIf(ifTokens, macros, 1);

            // #endif - closes the #if
            conditionals.processEndif(2, testFile, 1);

            // Another #endif without matching #if - ERROR
            const result = conditionals.processEndif(3, testFile, 1);

            assert.strictEqual(result.success, false);
            assert.ok(result.diagnostic);
            assert.strictEqual(result.diagnostic?.message, '#endif without matching #if');
        });
    });

    suite('Diagnostic Location Accuracy', () => {
        test('should track line numbers correctly across multiple directives', () => {
            const diagnostics: any[] = [];

            // Line 10: #elif without #if
            let result = conditionals.processElif(
                [createNumberToken('1', 10, 1)],
                macros,
                10,
                testFile,
                1
            );
            if (result.diagnostic) diagnostics.push(result.diagnostic);

            // Line 20: #else without #if
            result = conditionals.processElse(20, testFile, 1);
            if (result.diagnostic) diagnostics.push(result.diagnostic);

            // Line 30: #endif without #if
            result = conditionals.processEndif(30, testFile, 1);
            if (result.diagnostic) diagnostics.push(result.diagnostic);

            assert.strictEqual(diagnostics.length, 3);
            assert.strictEqual(diagnostics[0].line, 10);
            assert.strictEqual(diagnostics[1].line, 20);
            assert.strictEqual(diagnostics[2].line, 30);
        });

        test('should use provided column position', () => {
            const result = conditionals.processElse(5, testFile, 42);

            assert.ok(result.diagnostic);
            assert.strictEqual(result.diagnostic?.column, 42);
        });

        test('should default column to 1', () => {
            const result = conditionals.processElse(5, testFile);

            assert.ok(result.diagnostic);
            assert.strictEqual(result.diagnostic?.column, 1);
        });
    });

    suite('Integration with Unclosed Blocks', () => {
        test('should work alongside getUnclosedBlocks for EOF validation', () => {
            // #if without #endif
            const ifTokens = [createNumberToken('1', 1, 1)];
            conditionals.processIf(ifTokens, macros, 1);

            // Nested #ifdef without #endif
            macros.define({ name: 'TEST', body: [], isFunctionLike: false });
            conditionals.processIfdef('TEST', macros, 2);

            // Check unclosed blocks (separate from diagnostic system)
            const unclosed = conditionals.getUnclosedBlocks();
            assert.strictEqual(unclosed.length, 2);
            assert.strictEqual(unclosed[0].directive, '#if');
            assert.strictEqual(unclosed[0].line, 1);
            assert.strictEqual(unclosed[1].directive, '#ifdef');
            assert.strictEqual(unclosed[1].line, 2);

            // Note: EOF validation diagnostics would be generated by the parser
            // when it detects unclosed blocks at the end of file
        });
    });

    suite('Valid Directives Should Not Create Diagnostics', () => {
        test('#elif in valid context should not create diagnostic', () => {
            // #if false
            const ifTokens = [createNumberToken('0', 1, 1)];
            conditionals.processIf(ifTokens, macros, 1);

            // #elif true - valid
            const elifTokens = [createNumberToken('1', 2, 1)];
            const result = conditionals.processElif(elifTokens, macros, 2, testFile, 1);

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.diagnostic, undefined);
        });

        test('#else in valid context should not create diagnostic', () => {
            // #if false
            const ifTokens = [createNumberToken('0', 1, 1)];
            conditionals.processIf(ifTokens, macros, 1);

            // #else - valid
            const result = conditionals.processElse(2, testFile, 1);

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.diagnostic, undefined);
        });

        test('#ifdef and #ifndef should not create diagnostics', () => {
            macros.define({ name: 'DEFINED', body: [], isFunctionLike: false });

            const result1 = conditionals.processIfdef('DEFINED', macros, 1, testFile, 1);
            assert.strictEqual(result1.diagnostic, undefined);

            const result2 = conditionals.processIfndef('UNDEFINED', macros, 2, testFile, 1);
            assert.strictEqual(result2.diagnostic, undefined);
        });
    });
});
