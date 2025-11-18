/**
 * @file parser-diagnostics.test.ts
 * Tests for Parser diagnostic collection and reporting (Phase 2)
 */

import * as assert from 'assert';
import { Parser } from '../../shared/parser';
import { Lexer } from '../../shared/lexer';
import { DiagnosticCollector, DiagnosticSeverity, ErrorCodes } from '../../shared/diagnostics';
import { normalizePath, NormalizedPath } from '../../interfaces/hostinterface';

suite('Parser Diagnostics Integration', () => {
    let sourceFile: NormalizedPath;

    setup(() => {
        sourceFile = normalizePath('test.lsl');
    });

    suite('Conditional Directive Errors', () => {
        test('should collect diagnostic for #elif without #if', async () => {
            const source = `#elif 1
code here`;
            const diagnostics = new DiagnosticCollector();
            const lexer = new Lexer(source, 'lsl', sourceFile, diagnostics);
            const tokens = lexer.tokenize();
            const parser = new Parser(tokens, sourceFile, 'lsl', undefined, undefined, undefined, true, undefined, diagnostics);

            await parser.parse();

            const errors = diagnostics.getAll();
            assert.strictEqual(errors.length, 1, 'Should have one error');
            assert.strictEqual(errors[0].severity, DiagnosticSeverity.ERROR);
            assert.strictEqual(errors[0].code, ErrorCodes.MISMATCHED_CONDITIONAL);
            assert.strictEqual(errors[0].message, '#elif without matching #if');
            assert.strictEqual(errors[0].line, 1);
        });

        test('should collect diagnostic for #else without #if', async () => {
            const source = `#else
code here`;
            const diagnostics = new DiagnosticCollector();
            const lexer = new Lexer(source, 'lsl', sourceFile, diagnostics);
            const tokens = lexer.tokenize();
            const parser = new Parser(tokens, sourceFile, 'lsl', undefined, undefined, undefined, true, undefined, diagnostics);

            await parser.parse();

            const errors = diagnostics.getAll();
            assert.strictEqual(errors.length, 1);
            assert.strictEqual(errors[0].code, ErrorCodes.MISMATCHED_CONDITIONAL);
            assert.strictEqual(errors[0].message, '#else without matching #if');
        });

        test('should collect diagnostic for #endif without #if', async () => {
            const source = `#endif
code here`;
            const diagnostics = new DiagnosticCollector();
            const lexer = new Lexer(source, 'lsl', sourceFile, diagnostics);
            const tokens = lexer.tokenize();
            const parser = new Parser(tokens, sourceFile, 'lsl', undefined, undefined, undefined, true, undefined, diagnostics);

            await parser.parse();

            const errors = diagnostics.getAll();
            assert.strictEqual(errors.length, 1);
            assert.strictEqual(errors[0].code, ErrorCodes.MISMATCHED_CONDITIONAL);
            assert.strictEqual(errors[0].message, '#endif without matching #if');
        });

        test('should collect diagnostic for #elif after #else', async () => {
            const source = `#if 1
code1
#else
code2
#elif 1
code3
#endif`;
            const diagnostics = new DiagnosticCollector();
            const lexer = new Lexer(source, 'lsl', sourceFile, diagnostics);
            const tokens = lexer.tokenize();
            const parser = new Parser(tokens, sourceFile, 'lsl', undefined, undefined, undefined, true, undefined, diagnostics);

            await parser.parse();

            const errors = diagnostics.getAll();
            assert.strictEqual(errors.length, 1);
            assert.strictEqual(errors[0].code, ErrorCodes.MISMATCHED_CONDITIONAL);
            assert.strictEqual(errors[0].message, '#elif after #else');
            assert.strictEqual(errors[0].line, 5);
        });

        test('should collect diagnostic for multiple #else', async () => {
            const source = `#if 1
code1
#else
code2
#else
code3
#endif`;
            const diagnostics = new DiagnosticCollector();
            const lexer = new Lexer(source, 'lsl', sourceFile, diagnostics);
            const tokens = lexer.tokenize();
            const parser = new Parser(tokens, sourceFile, 'lsl', undefined, undefined, undefined, true, undefined, diagnostics);

            await parser.parse();

            const errors = diagnostics.getAll();
            assert.strictEqual(errors.length, 1);
            assert.strictEqual(errors[0].code, ErrorCodes.MISMATCHED_CONDITIONAL);
            assert.strictEqual(errors[0].message, 'Multiple #else directives for same #if');
            assert.strictEqual(errors[0].line, 5);
        });
    });

    suite('Valid Conditionals Produce No Errors', () => {
        test('should not create diagnostics for valid #if/#endif', async () => {
            const source = `#if 1
code here
#endif`;
            const diagnostics = new DiagnosticCollector();
            const lexer = new Lexer(source, 'lsl', sourceFile, diagnostics);
            const tokens = lexer.tokenize();
            const parser = new Parser(tokens, sourceFile, 'lsl', undefined, undefined, undefined, true, undefined, diagnostics);

            await parser.parse();

            const errors = diagnostics.getAll();
            assert.strictEqual(errors.length, 0, 'Should have no errors for valid conditionals');
        });

        test('should not create diagnostics for valid #if/#elif/#else/#endif chain', async () => {
            const source = `#if 0
code1
#elif 1
code2
#else
code3
#endif`;
            const diagnostics = new DiagnosticCollector();
            const lexer = new Lexer(source, 'lsl', sourceFile, diagnostics);
            const tokens = lexer.tokenize();
            const parser = new Parser(tokens, sourceFile, 'lsl', undefined, undefined, undefined, true, undefined, diagnostics);

            await parser.parse();

            const errors = diagnostics.getAll();
            assert.strictEqual(errors.length, 0);
        });

        test('should not create diagnostics for nested conditionals', async () => {
            const source = `#if 1
    #ifdef TEST
        code
    #endif
#endif`;
            const diagnostics = new DiagnosticCollector();
            const lexer = new Lexer(source, 'lsl', sourceFile, diagnostics);
            const tokens = lexer.tokenize();
            const parser = new Parser(tokens, sourceFile, 'lsl', undefined, undefined, undefined, true, undefined, diagnostics);

            await parser.parse();

            const errors = diagnostics.getAll();
            assert.strictEqual(errors.length, 0);
        });
    });

    suite('Diagnostic Source File Tracking', () => {
        test('should track correct source file in diagnostics', async () => {
            const testSource = normalizePath('custom.lsl');
            const source = `#endif`;
            const diagnostics = new DiagnosticCollector();
            const lexer = new Lexer(source, 'lsl', testSource, diagnostics);
            const tokens = lexer.tokenize();
            const parser = new Parser(tokens, testSource, 'lsl', undefined, undefined, undefined, true, undefined, diagnostics);

            await parser.parse();

            const errors = diagnostics.getAll();
            assert.strictEqual(errors.length, 1);
            assert.strictEqual(errors[0].sourceFile, testSource);
        });
    });

    suite('Diagnostic Collector Operations', () => {
        test('should be able to filter diagnostics by severity', async () => {
            const source = `"unterminated
#elif 1`;
            const diagnostics = new DiagnosticCollector();
            const lexer = new Lexer(source, 'lsl', sourceFile, diagnostics);
            const tokens = lexer.tokenize();
            const parser = new Parser(tokens, sourceFile, 'lsl', undefined, undefined, undefined, true, undefined, diagnostics);

            await parser.parse();

            const errors = diagnostics.getAll();
            assert.ok(errors.length > 0);

            const onlyErrors = errors.filter(d => d.severity === DiagnosticSeverity.ERROR);
            assert.strictEqual(onlyErrors.length, errors.length, 'All collected diagnostics should be errors');
        });

        test('should be able to check for errors', async () => {
            const source = `#endif`;
            const diagnostics = new DiagnosticCollector();
            const lexer = new Lexer(source, 'lsl', sourceFile, diagnostics);
            const tokens = lexer.tokenize();
            const parser = new Parser(tokens, sourceFile, 'lsl', undefined, undefined, undefined, true, undefined, diagnostics);

            await parser.parse();

            assert.strictEqual(diagnostics.hasErrors(), true);
        });

        test('should report no errors for valid code', async () => {
            const source = `#if 1
code
#endif`;
            const diagnostics = new DiagnosticCollector();
            const lexer = new Lexer(source, 'lsl', sourceFile, diagnostics);
            const tokens = lexer.tokenize();
            const parser = new Parser(tokens, sourceFile, 'lsl', undefined, undefined, undefined, true, undefined, diagnostics);

            await parser.parse();

            assert.strictEqual(diagnostics.hasErrors(), false);
        });
    });
});
