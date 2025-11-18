/**
 * @file parser-directive-diagnostics.test.ts
 * Tests for parser directive validation errors (PAR001-PAR006)
 */

import * as assert from 'assert';
import { Parser } from '../../shared/parser';
import { Lexer } from '../../shared/lexer';
import { DiagnosticCollector, DiagnosticSeverity, ErrorCodes } from '../../shared/diagnostics';
import { normalizePath, NormalizedPath } from '../../interfaces/hostinterface';

suite('Parser Directive Validation', () => {
    let sourceFile: NormalizedPath;

    setup(() => {
        sourceFile = normalizePath('test.lsl');
    });

    suite('PAR001: Malformed Directive', () => {
        test('should error on unknown directive', async () => {
            const source = `#unknown
code here`;
            const diagnostics = new DiagnosticCollector();
            const lexer = new Lexer(source, 'lsl', sourceFile, diagnostics);
            const tokens = lexer.tokenize();
            const parser = new Parser(tokens, sourceFile, 'lsl', undefined, undefined, undefined, true, undefined, diagnostics);

            await parser.parse();

            const errors = diagnostics.getErrors();
            assert.strictEqual(errors.length, 1, 'Should have one error');
            assert.strictEqual(errors[0].code, ErrorCodes.MALFORMED_DIRECTIVE);
            assert.ok(errors[0].message.includes('unknown'));
            assert.strictEqual(errors[0].line, 1);
        });

        test('should error on invalid directive name', async () => {
            const source = `#123invalid
code here`;
            const diagnostics = new DiagnosticCollector();
            const lexer = new Lexer(source, 'lsl', sourceFile, diagnostics);
            const tokens = lexer.tokenize();
            const parser = new Parser(tokens, sourceFile, 'lsl', undefined, undefined, undefined, true, undefined, diagnostics);

            await parser.parse();

            const errors = diagnostics.getErrors();
            assert.ok(errors.length >= 1);
            assert.ok(errors.some(e => e.code === ErrorCodes.MALFORMED_DIRECTIVE));
        });

        test('should not error on valid directives', async () => {
            const source = `#define X 1
#ifdef X
#endif`;
            const diagnostics = new DiagnosticCollector();
            const lexer = new Lexer(source, 'lsl', sourceFile, diagnostics);
            const tokens = lexer.tokenize();
            const parser = new Parser(tokens, sourceFile, 'lsl', undefined, undefined, undefined, true, undefined, diagnostics);

            await parser.parse();

            const par001Errors = diagnostics.getAll().filter(e => e.code === ErrorCodes.MALFORMED_DIRECTIVE);
            assert.strictEqual(par001Errors.length, 0, 'Should not have PAR001 errors for valid directives');
        });
    });

    suite('PAR002: Missing Directive Argument', () => {
        test('should error on #include without filename', async () => {
            const source = `#include
code here`;
            const diagnostics = new DiagnosticCollector();
            const lexer = new Lexer(source, 'lsl', sourceFile, diagnostics);
            const tokens = lexer.tokenize();
            const parser = new Parser(tokens, sourceFile, 'lsl', undefined, undefined, undefined, true, undefined, diagnostics);

            await parser.parse();

            const errors = diagnostics.getErrors();
            assert.ok(errors.length >= 1);
            const par002Error = errors.find(e => e.code === ErrorCodes.MISSING_DIRECTIVE_ARGUMENT);
            assert.ok(par002Error, 'Should have PAR002 error');
            assert.ok(par002Error!.message.includes('#include'));
            assert.ok(par002Error!.message.includes('filename'));
        });

        test('should error on #ifdef without macro name', async () => {
            const source = `#ifdef
code here
#endif`;
            const diagnostics = new DiagnosticCollector();
            const lexer = new Lexer(source, 'lsl', sourceFile, diagnostics);
            const tokens = lexer.tokenize();
            const parser = new Parser(tokens, sourceFile, 'lsl', undefined, undefined, undefined, true, undefined, diagnostics);

            await parser.parse();

            const errors = diagnostics.getErrors();
            const par002Error = errors.find(e => e.code === ErrorCodes.MISSING_DIRECTIVE_ARGUMENT);
            assert.ok(par002Error, 'Should have PAR002 error');
            assert.ok(par002Error!.message.includes('#ifdef'));
        });

        test('should error on #ifndef without macro name', async () => {
            const source = `#ifndef
code here
#endif`;
            const diagnostics = new DiagnosticCollector();
            const lexer = new Lexer(source, 'lsl', sourceFile, diagnostics);
            const tokens = lexer.tokenize();
            const parser = new Parser(tokens, sourceFile, 'lsl', undefined, undefined, undefined, true, undefined, diagnostics);

            await parser.parse();

            const errors = diagnostics.getErrors();
            const par002Error = errors.find(e => e.code === ErrorCodes.MISSING_DIRECTIVE_ARGUMENT);
            assert.ok(par002Error, 'Should have PAR002 error');
            assert.ok(par002Error!.message.includes('#ifndef'));
        });

        test('should error on #define without macro name', async () => {
            const source = `#define
code here`;
            const diagnostics = new DiagnosticCollector();
            const lexer = new Lexer(source, 'lsl', sourceFile, diagnostics);
            const tokens = lexer.tokenize();
            const parser = new Parser(tokens, sourceFile, 'lsl', undefined, undefined, undefined, true, undefined, diagnostics);

            await parser.parse();

            const errors = diagnostics.getErrors();
            const par002Error = errors.find(e => e.code === ErrorCodes.MISSING_DIRECTIVE_ARGUMENT);
            assert.ok(par002Error, 'Should have PAR002 error');
            assert.ok(par002Error!.message.includes('#define'));
        });

        test('should error on #undef without macro name', async () => {
            const source = `#undef
code here`;
            const diagnostics = new DiagnosticCollector();
            const lexer = new Lexer(source, 'lsl', sourceFile, diagnostics);
            const tokens = lexer.tokenize();
            const parser = new Parser(tokens, sourceFile, 'lsl', undefined, undefined, undefined, true, undefined, diagnostics);

            await parser.parse();

            const errors = diagnostics.getErrors();
            const par002Error = errors.find(e => e.code === ErrorCodes.MISSING_DIRECTIVE_ARGUMENT);
            assert.ok(par002Error, 'Should have PAR002 error');
            assert.ok(par002Error!.message.includes('#undef'));
        });

        test('should not error when arguments are provided', async () => {
            const source = `#define X 1
#ifdef X
#endif
#undef X`;
            const diagnostics = new DiagnosticCollector();
            const lexer = new Lexer(source, 'lsl', sourceFile, diagnostics);
            const tokens = lexer.tokenize();
            const parser = new Parser(tokens, sourceFile, 'lsl', undefined, undefined, undefined, true, undefined, diagnostics);

            await parser.parse();

            const par002Errors = diagnostics.getAll().filter(e => e.code === ErrorCodes.MISSING_DIRECTIVE_ARGUMENT);
            assert.strictEqual(par002Errors.length, 0, 'Should not have PAR002 errors');
        });
    });

    suite('PAR003: Invalid Macro Definition', () => {
        test('should error on macro name starting with digit', async () => {
            const source = `#define 123ABC 1`;
            const diagnostics = new DiagnosticCollector();
            const lexer = new Lexer(source, 'lsl', sourceFile, diagnostics);
            const tokens = lexer.tokenize();
            const parser = new Parser(tokens, sourceFile, 'lsl', undefined, undefined, undefined, true, undefined, diagnostics);

            await parser.parse();

            const errors = diagnostics.getErrors();
            const par003Error = errors.find(e => e.code === ErrorCodes.INVALID_MACRO_DEFINITION);
            assert.ok(par003Error, 'Should have PAR003 error');
            assert.ok(par003Error!.message.includes('Invalid macro name'), 'Message should indicate invalid macro name');
        });

        test('should error on duplicate parameter names', async () => {
            const source = `#define MACRO(a, b, a) (a + b)`;
            const diagnostics = new DiagnosticCollector();
            const lexer = new Lexer(source, 'lsl', sourceFile, diagnostics);
            const tokens = lexer.tokenize();
            const parser = new Parser(tokens, sourceFile, 'lsl', undefined, undefined, undefined, true, undefined, diagnostics);

            await parser.parse();

            const errors = diagnostics.getErrors();
            const par003Error = errors.find(e => e.code === ErrorCodes.INVALID_MACRO_DEFINITION);
            assert.ok(par003Error, 'Should have PAR003 error');
            assert.ok(par003Error!.message.includes('Duplicate'));
            assert.ok(par003Error!.message.includes('parameter'));
        });

        test('should not error on valid macro definitions', async () => {
            const source = `#define PI 3.14159
#define MAX(a, b) ((a) > (b) ? (a) : (b))`;
            const diagnostics = new DiagnosticCollector();
            const lexer = new Lexer(source, 'lsl', sourceFile, diagnostics);
            const tokens = lexer.tokenize();
            const parser = new Parser(tokens, sourceFile, 'lsl', undefined, undefined, undefined, true, undefined, diagnostics);

            await parser.parse();

            const par003Errors = diagnostics.getAll().filter(e => e.code === ErrorCodes.INVALID_MACRO_DEFINITION);
            assert.strictEqual(par003Errors.length, 0, 'Should not have PAR003 errors');
        });
    });

    suite('PAR004: Unterminated Conditional', () => {
        test('should error on #if without #endif', async () => {
            const source = `#if 1
code here`;
            const diagnostics = new DiagnosticCollector();
            const lexer = new Lexer(source, 'lsl', sourceFile, diagnostics);
            const tokens = lexer.tokenize();
            const parser = new Parser(tokens, sourceFile, 'lsl', undefined, undefined, undefined, true, undefined, diagnostics);

            await parser.parse();

            const errors = diagnostics.getErrors();
            const par004Error = errors.find(e => e.code === ErrorCodes.UNTERMINATED_CONDITIONAL);
            assert.ok(par004Error, 'Should have PAR004 error');
            assert.ok(par004Error!.message.includes('Unterminated'));
            assert.ok(par004Error!.message.includes('#if'));
        });

        test('should error on #ifdef without #endif', async () => {
            const source = `#ifdef X
code here`;
            const diagnostics = new DiagnosticCollector();
            const lexer = new Lexer(source, 'lsl', sourceFile, diagnostics);
            const tokens = lexer.tokenize();
            const parser = new Parser(tokens, sourceFile, 'lsl', undefined, undefined, undefined, true, undefined, diagnostics);

            await parser.parse();

            const errors = diagnostics.getErrors();
            const par004Error = errors.find(e => e.code === ErrorCodes.UNTERMINATED_CONDITIONAL);
            assert.ok(par004Error, 'Should have PAR004 error');
            assert.ok(par004Error!.message.includes('#ifdef'));
        });

        test('should error on nested unterminated conditionals', async () => {
            const source = `#if 1
#ifdef X
code here
#endif`;
            const diagnostics = new DiagnosticCollector();
            const lexer = new Lexer(source, 'lsl', sourceFile, diagnostics);
            const tokens = lexer.tokenize();
            const parser = new Parser(tokens, sourceFile, 'lsl', undefined, undefined, undefined, true, undefined, diagnostics);

            await parser.parse();

            const errors = diagnostics.getErrors();
            const par004Errors = errors.filter(e => e.code === ErrorCodes.UNTERMINATED_CONDITIONAL);
            assert.strictEqual(par004Errors.length, 1, 'Should have one PAR004 error (outer #if)');
        });

        test('should not error when conditionals are properly closed', async () => {
            const source = `#if 1
#ifdef X
code here
#endif
#endif`;
            const diagnostics = new DiagnosticCollector();
            const lexer = new Lexer(source, 'lsl', sourceFile, diagnostics);
            const tokens = lexer.tokenize();
            const parser = new Parser(tokens, sourceFile, 'lsl', undefined, undefined, undefined, true, undefined, diagnostics);

            await parser.parse();

            const par004Errors = diagnostics.getAll().filter(e => e.code === ErrorCodes.UNTERMINATED_CONDITIONAL);
            assert.strictEqual(par004Errors.length, 0, 'Should not have PAR004 errors');
        });
    });

    suite('PAR006: Invalid Macro Invocation', () => {
        test('should warn when function-like macro used without parentheses', async () => {
            const source = `#define MAX(a, b) ((a) > (b) ? (a) : (b))
integer x = MAX;`;
            const diagnostics = new DiagnosticCollector();
            const lexer = new Lexer(source, 'lsl', sourceFile, diagnostics);
            const tokens = lexer.tokenize();
            const parser = new Parser(tokens, sourceFile, 'lsl', undefined, undefined, undefined, true, undefined, diagnostics);

            await parser.parse();

            const warnings = diagnostics.getWarnings();
            const par006Warning = warnings.find(w => w.code === ErrorCodes.INVALID_MACRO_INVOCATION);
            assert.ok(par006Warning, 'Should have PAR006 warning');
            assert.ok(par006Warning!.message.includes('MAX'));
            assert.ok(par006Warning!.message.includes('without parentheses'));
        });

        test('should not warn when function-like macro used correctly', async () => {
            const source = `#define MAX(a, b) ((a) > (b) ? (a) : (b))
integer x = MAX(1, 2);`;
            const diagnostics = new DiagnosticCollector();
            const lexer = new Lexer(source, 'lsl', sourceFile, diagnostics);
            const tokens = lexer.tokenize();
            const parser = new Parser(tokens, sourceFile, 'lsl', undefined, undefined, undefined, true, undefined, diagnostics);

            await parser.parse();

            const par006Warnings = diagnostics.getAll().filter(w => w.code === ErrorCodes.INVALID_MACRO_INVOCATION);
            assert.strictEqual(par006Warnings.length, 0, 'Should not have PAR006 warnings');
        });

        test('should not warn for simple (non-function) macros', async () => {
            const source = `#define PI 3.14159
float x = PI;`;
            const diagnostics = new DiagnosticCollector();
            const lexer = new Lexer(source, 'lsl', sourceFile, diagnostics);
            const tokens = lexer.tokenize();
            const parser = new Parser(tokens, sourceFile, 'lsl', undefined, undefined, undefined, true, undefined, diagnostics);

            await parser.parse();

            const par006Warnings = diagnostics.getAll().filter(w => w.code === ErrorCodes.INVALID_MACRO_INVOCATION);
            assert.strictEqual(par006Warnings.length, 0, 'Should not warn for simple macros');
        });
    });

    suite('Valid Code Should Not Produce Parser Errors', () => {
        test('should not error on well-formed directives', async () => {
            const source = `#define PI 3.14159
#define MAX(a, b) ((a) > (b) ? (a) : (b))
#ifdef PI
float radius = 1.0;
float area = PI * radius * radius;
#endif
#undef PI`;
            const diagnostics = new DiagnosticCollector();
            const lexer = new Lexer(source, 'lsl', sourceFile, diagnostics);
            const tokens = lexer.tokenize();
            const parser = new Parser(tokens, sourceFile, 'lsl', undefined, undefined, undefined, true, undefined, diagnostics);

            await parser.parse();

            const parserErrors = diagnostics.getAll().filter(d =>
                d.code?.startsWith('PAR')
            );
            assert.strictEqual(parserErrors.length, 0, 'Should not have any parser errors');
        });
    });
});
