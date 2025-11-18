/**
 * @file macro-diagnostics.test.ts
 * Tests for MacroProcessor diagnostic reporting (Phase 2)
 *
 * Note: These tests document expected behavior for macro diagnostics.
 * MacroProcessor diagnostic support is not yet fully implemented.
 */

import * as assert from 'assert';
import { MacroProcessor, MacroExpansionContext } from '../../shared/macroprocessor';
import { Lexer } from '../../shared/lexer';
import { DiagnosticCollector, DiagnosticSeverity, ErrorCodes } from '../../shared/diagnostics';
import { normalizePath } from '../../interfaces/hostinterface';

suite('MacroProcessor Diagnostics', () => {
    let processor: MacroProcessor;
    let diagnostics: DiagnosticCollector;
    const testFile = normalizePath('test.lsl');

    setup(() => {
        processor = new MacroProcessor('lsl');
        diagnostics = new DiagnosticCollector();
    });

    suite('MAC001: Undefined Macro (Warning)', () => {
        test('should warn when expanding undefined macro', () => {
            // Given: No macros defined
            // When: Trying to expand undefined macro
            const context: MacroExpansionContext = { line: 1, column: 1, sourceFile: testFile };
            const result = processor.expandSimple('UNDEFINED_MACRO', context, undefined, diagnostics, testFile, 1, 1);

            // Then: Should create warning diagnostic
            const warnings = diagnostics.getAll();
            assert.strictEqual(warnings.length, 1);
            assert.strictEqual(warnings[0].severity, DiagnosticSeverity.WARNING);
            assert.strictEqual(warnings[0].code, ErrorCodes.UNDEFINED_MACRO);
            assert.ok(warnings[0].message.includes('UNDEFINED_MACRO'));
            assert.strictEqual(result, null); // Expansion should return null for undefined macro
        });

        test('should not warn for defined macros', () => {
            // Given: Macro is defined
            const bodyLexer = new Lexer('42', 'lsl');
            const bodyTokens = bodyLexer.tokenize().slice(0, -1);
            processor.define({ name: 'DEFINED', body: bodyTokens, isFunctionLike: false });

            const context: MacroExpansionContext = { line: 1, column: 1, sourceFile: testFile };
            processor.expandSimple('DEFINED', context, undefined, diagnostics, testFile, 1, 1);

            // Then: Should not create any diagnostics
            assert.strictEqual(diagnostics.getAll().length, 0);
        });
    });

    suite('MAC002: Argument Count Mismatch', () => {
        test('should error when too few arguments provided', () => {
            // Given: Function-like macro expecting 2 parameters
            const bodyLexer = new Lexer('x + y', 'lsl');
            const bodyTokens = bodyLexer.tokenize().slice(0, -1);
            processor.define({
                name: 'ADD',
                parameters: ['x', 'y'],
                body: bodyTokens,
                isFunctionLike: true
            });

            // When: Calling with only 1 argument
            const source = 'ADD(5)';
            const lexer = new Lexer(source, 'lsl');
            const tokens = lexer.tokenize().slice(0, -1); // Remove EOF

            // Find the ADD identifier and parse the call
            const context: MacroExpansionContext = { line: 1, column: 1, sourceFile: testFile };
            const addToken = tokens[0]; // ADD
            const parenOpenIdx = 1; // (

            // Parse arguments from tokens starting at opening paren
            const { args } = (processor as any).parseArgumentsFromTokens(tokens, parenOpenIdx);

            // Try to expand
            processor.expandFunction('ADD', args, context, undefined, diagnostics, testFile, 1, 1);

            // Then: Should create error diagnostic
            const errors = diagnostics.getAll();
            assert.strictEqual(errors.length, 1);
            assert.strictEqual(errors[0].severity, DiagnosticSeverity.ERROR);
            assert.strictEqual(errors[0].code, ErrorCodes.ARGUMENT_COUNT_MISMATCH);
            assert.ok(errors[0].message.includes('ADD'));
            assert.ok(errors[0].message.includes('2') && errors[0].message.includes('1'));
        });

        test('should error when too many arguments provided', () => {
            // Given: Function-like macro expecting 1 parameter
            const bodyLexer = new Lexer('x * 2', 'lsl');
            const bodyTokens = bodyLexer.tokenize().slice(0, -1);
            processor.define({
                name: 'DOUBLE',
                parameters: ['x'],
                body: bodyTokens,
                isFunctionLike: true
            });

            // When: Calling with 2 arguments
            const source = 'DOUBLE(5, 10)';
            const lexer = new Lexer(source, 'lsl');
            const tokens = lexer.tokenize().slice(0, -1); // Remove EOF

            const context: MacroExpansionContext = { line: 1, column: 1, sourceFile: testFile };
            const parenOpenIdx = 1; // (

            // Parse arguments
            const { args } = (processor as any).parseArgumentsFromTokens(tokens, parenOpenIdx);

            // Try to expand
            processor.expandFunction('DOUBLE', args, context, undefined, diagnostics, testFile, 1, 1);

            // Then: Should create error diagnostic
            const errors = diagnostics.getAll();
            assert.strictEqual(errors.length, 1);
            assert.strictEqual(errors[0].code, ErrorCodes.ARGUMENT_COUNT_MISMATCH);
        });

        test('should not error when correct number of arguments provided', () => {
            // Given: Function-like macro with parameters
            const bodyLexer = new Lexer('x + y', 'lsl');
            const bodyTokens = bodyLexer.tokenize().slice(0, -1);
            processor.define({
                name: 'ADD',
                parameters: ['x', 'y'],
                body: bodyTokens,
                isFunctionLike: true
            });

            // When: Calling with correct argument count
            const source = 'ADD(5, 10)';
            const lexer = new Lexer(source, 'lsl');
            const tokens = lexer.tokenize().slice(0, -1); // Remove EOF

            const context: MacroExpansionContext = { line: 1, column: 1, sourceFile: testFile };
            const parenOpenIdx = 1; // (

            // Parse arguments
            const { args } = (processor as any).parseArgumentsFromTokens(tokens, parenOpenIdx);

            // Try to expand
            processor.expandFunction('ADD', args, context, undefined, diagnostics, testFile, 1, 1);

            // Then: Should not create diagnostics
            assert.strictEqual(diagnostics.getAll().length, 0);
        });
    });

    suite('MAC003: Recursive Expansion', () => {
        test('should detect direct self-recursion', () => {
            // Given: Macro that references itself
            const bodyLexer = new Lexer('SELF + 1', 'lsl');
            const bodyTokens = bodyLexer.tokenize().slice(0, -1);
            processor.define({
                name: 'SELF',
                body: bodyTokens,
                isFunctionLike: false
            });

            // When: Expanding the macro (it will try to expand SELF in the body)
            const context: MacroExpansionContext = { line: 1, column: 1, sourceFile: testFile };
            const expanding = new Set<string>();
            processor.expandSimple('SELF', context, expanding, diagnostics, testFile, 1, 1);

            // Then: Should create warning about recursion
            const warnings = diagnostics.getAll();
            assert.strictEqual(warnings.length, 1);
            assert.strictEqual(warnings[0].severity, DiagnosticSeverity.WARNING);
            assert.strictEqual(warnings[0].code, ErrorCodes.RECURSIVE_EXPANSION);
            assert.ok(warnings[0].message.includes('SELF'));
        });

        test('should detect indirect recursion', () => {
            // Given: Two macros that reference each other
            const aBodyLexer = new Lexer('B', 'lsl');
            const aBodyTokens = aBodyLexer.tokenize().slice(0, -1);
            processor.define({
                name: 'A',
                body: aBodyTokens,
                isFunctionLike: false
            });

            const bBodyLexer = new Lexer('A', 'lsl');
            const bBodyTokens = bBodyLexer.tokenize().slice(0, -1);
            processor.define({
                name: 'B',
                body: bBodyTokens,
                isFunctionLike: false
            });

            // When: Expanding macro A (which will expand to B, which will try to expand to A again)
            const context: MacroExpansionContext = { line: 1, column: 1, sourceFile: testFile };
            const expanding = new Set<string>();
            processor.expandSimple('A', context, expanding, diagnostics, testFile, 1, 1);

            // Then: Should create warning about recursion
            const warnings = diagnostics.getAll();
            assert.ok(warnings.length > 0, 'Should have at least one warning');
            assert.ok(warnings.some(w => w.code === ErrorCodes.RECURSIVE_EXPANSION), 'Should have recursive expansion warning');
        });
    });

    suite('MAC004: Invalid defined() Syntax', () => {
        test('should error on malformed defined() - missing parentheses', () => {
            // Given: defined without parentheses
            const source = 'defined MACRO';
            const lexer = new Lexer(source, 'lsl');
            const tokens = lexer.tokenize();

            // When: Processing defined() with diagnostics
            processor.processDefined(tokens, diagnostics, testFile, 1);

            // Then: Should create error
            const errors = diagnostics.getAll();
            assert.strictEqual(errors.length, 1);
            assert.strictEqual(errors[0].severity, DiagnosticSeverity.ERROR);
            assert.strictEqual(errors[0].code, ErrorCodes.INVALID_DEFINED_SYNTAX);
            assert.ok(errors[0].message.includes('defined'));
        });

        test('should error on malformed defined() - missing closing paren', () => {
            // Given: defined with unclosed parenthesis
            const source = 'defined(MACRO';
            const lexer = new Lexer(source, 'lsl');
            const tokens = lexer.tokenize();

            // When: Processing defined() with diagnostics
            processor.processDefined(tokens, diagnostics, testFile, 1);

            // Then: Should create error
            const errors = diagnostics.getAll();
            assert.strictEqual(errors.length, 1);
            assert.strictEqual(errors[0].code, ErrorCodes.INVALID_DEFINED_SYNTAX);
        });

        test('should error on defined() with no identifier', () => {
            // Given: defined with empty parentheses
            const source = 'defined()';
            const lexer = new Lexer(source, 'lsl');
            const tokens = lexer.tokenize();

            // When: Processing defined() with diagnostics
            processor.processDefined(tokens, diagnostics, testFile, 1);

            // Then: Should create error
            const errors = diagnostics.getAll();
            assert.strictEqual(errors.length, 1);
            assert.strictEqual(errors[0].code, ErrorCodes.INVALID_DEFINED_SYNTAX);
        });

        test('should not error on valid defined() syntax', () => {
            // Given: Valid defined() syntax
            const source = 'defined(MACRO)';
            const lexer = new Lexer(source, 'lsl');
            const tokens = lexer.tokenize();

            // When: Processing defined() with diagnostics
            processor.processDefined(tokens, diagnostics, testFile, 1);

            // Then: Should not create diagnostics
            assert.strictEqual(diagnostics.getAll().length, 0);
        });
    });

    suite('Documentation Tests', () => {
        test('MacroProcessor exists and has basic functionality', () => {
            // This test verifies the MacroProcessor structure needed for diagnostics
            assert.ok(processor);
            assert.strictEqual(typeof processor.define, 'function');
            assert.strictEqual(typeof processor.isDefined, 'function');
            assert.strictEqual(typeof processor.expandSimple, 'function');
            assert.strictEqual(typeof processor.processDefined, 'function');
        });

        test('DiagnosticCollector supports macro error codes', () => {
            // Verify all macro error codes are defined
            assert.ok(ErrorCodes.UNDEFINED_MACRO);
            assert.ok(ErrorCodes.ARGUMENT_COUNT_MISMATCH);
            assert.ok(ErrorCodes.RECURSIVE_EXPANSION);
            assert.ok(ErrorCodes.INVALID_DEFINED_SYNTAX);

            assert.strictEqual(ErrorCodes.UNDEFINED_MACRO, 'MAC001');
            assert.strictEqual(ErrorCodes.ARGUMENT_COUNT_MISMATCH, 'MAC002');
            assert.strictEqual(ErrorCodes.RECURSIVE_EXPANSION, 'MAC003');
            assert.strictEqual(ErrorCodes.INVALID_DEFINED_SYNTAX, 'MAC004');
        });
    });
});
