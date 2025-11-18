/**
 * @file lexer-diagnostics.test.ts
 * Tests for lexer diagnostic error reporting
 * Copyright (C) 2025, Linden Research, Inc.
 */

import * as assert from 'assert';
import { Lexer, TokenType } from '../../shared/lexer';
import { DiagnosticCollector, DiagnosticSeverity, ErrorCodes } from '../../shared/diagnostics';
import { NormalizedPath } from '../../interfaces/hostinterface';

suite('Lexer Diagnostics', () => {
    const testFile = "test.lsl" as NormalizedPath;

    test('Unterminated string - newline', () => {
        const source = '"unterminated string\n';
        const diagnostics = new DiagnosticCollector();
        const lexer = new Lexer(source, 'lsl', testFile, diagnostics);

        const tokens = lexer.tokenize();

        // Should still produce a string token
        assert.strictEqual(tokens[0].type, TokenType.STRING_LITERAL);

        // Should have error diagnostic
        assert.strictEqual(diagnostics.hasErrors(), true);
        const errors = diagnostics.getErrors();
        assert.strictEqual(errors.length, 1);
        assert.strictEqual(errors[0].code, ErrorCodes.UNTERMINATED_STRING);
        assert.strictEqual(errors[0].severity, DiagnosticSeverity.ERROR);
        assert.strictEqual(errors[0].line, 1);
        assert.ok(errors[0].message.includes('Unterminated string'));
    });

    test('Unterminated string - EOF', () => {
        const source = '"unterminated string';
        const diagnostics = new DiagnosticCollector();
        const lexer = new Lexer(source, 'lsl', testFile, diagnostics);

        const tokens = lexer.tokenize();

        // Should still produce a string token
        assert.strictEqual(tokens[0].type, TokenType.STRING_LITERAL);

        // Should have error diagnostic
        assert.strictEqual(diagnostics.hasErrors(), true);
        const errors = diagnostics.getErrors();
        assert.strictEqual(errors.length, 1);
        assert.strictEqual(errors[0].code, ErrorCodes.UNTERMINATED_STRING);
    });

    test('Properly terminated string - no error', () => {
        const source = '"properly terminated"';
        const diagnostics = new DiagnosticCollector();
        const lexer = new Lexer(source, 'lsl', testFile, diagnostics);

        const tokens = lexer.tokenize();

        // Should produce a string token
        assert.strictEqual(tokens[0].type, TokenType.STRING_LITERAL);

        // Should have NO error diagnostic
        assert.strictEqual(diagnostics.hasErrors(), false);
        assert.strictEqual(diagnostics.getCount(), 0);
    });

    test('Unterminated block comment', () => {
        const source = '/* unterminated block comment\nmore lines\n';
        const diagnostics = new DiagnosticCollector();
        const lexer = new Lexer(source, 'lsl', testFile, diagnostics);

        const tokens = lexer.tokenize();

        // Should produce block comment tokens
        assert.ok(tokens.some(t =>
            t.type === TokenType.BLOCK_COMMENT_START ||
            t.type === TokenType.BLOCK_COMMENT_CONTENT
        ));

        // Should have error diagnostic
        assert.strictEqual(diagnostics.hasErrors(), true);
        const errors = diagnostics.getErrors();
        assert.strictEqual(errors.length, 1);
        assert.strictEqual(errors[0].code, ErrorCodes.UNTERMINATED_BLOCK_COMMENT);
        assert.ok(errors[0].message.includes('Unterminated block comment'));
    });

    test('Properly terminated block comment - no error', () => {
        const source = '/* properly terminated */';
        const diagnostics = new DiagnosticCollector();
        const lexer = new Lexer(source, 'lsl', testFile, diagnostics);

        const tokens = lexer.tokenize();

        // Should produce block comment tokens
        assert.ok(tokens.some(t => t.type === TokenType.BLOCK_COMMENT_START));
        assert.ok(tokens.some(t => t.type === TokenType.BLOCK_COMMENT_END));

        // Should have NO error diagnostic
        assert.strictEqual(diagnostics.hasErrors(), false);
        assert.strictEqual(diagnostics.getCount(), 0);
    });

    test('Multiple errors in same file', () => {
        const source = '"unterminated\n/* also unterminated';
        const diagnostics = new DiagnosticCollector();
        const lexer = new Lexer(source, 'lsl', testFile, diagnostics);

        lexer.tokenize();

        // Should have two error diagnostics
        assert.strictEqual(diagnostics.hasErrors(), true);
        const errors = diagnostics.getErrors();
        assert.strictEqual(errors.length, 2);

        // Check both error codes are present
        const codes = errors.map(e => e.code);
        assert.ok(codes.includes(ErrorCodes.UNTERMINATED_STRING));
        assert.ok(codes.includes(ErrorCodes.UNTERMINATED_BLOCK_COMMENT));
    });

    test('Diagnostic collector merge', () => {
        const collector1 = new DiagnosticCollector();
        const collector2 = new DiagnosticCollector();

        collector1.addError('Error 1', {
            line: 1,
            column: 1,
            length: 5,
            sourceFile: testFile
        });

        collector2.addError('Error 2', {
            line: 2,
            column: 1,
            length: 5,
            sourceFile: testFile
        });

        collector1.merge(collector2);

        assert.strictEqual(collector1.getCount(), 2);
        assert.strictEqual(collector1.hasErrors(), true);
    });

    test('Diagnostic collector clear', () => {
        const diagnostics = new DiagnosticCollector();

        diagnostics.addError('Error', {
            line: 1,
            column: 1,
            length: 5,
            sourceFile: testFile
        });

        assert.strictEqual(diagnostics.hasErrors(), true);

        diagnostics.clear();

        assert.strictEqual(diagnostics.hasErrors(), false);
        assert.strictEqual(diagnostics.getCount(), 0);
    });

    test('Diagnostic severity filtering', () => {
        const diagnostics = new DiagnosticCollector();

        diagnostics.addError('Error', {
            line: 1,
            column: 1,
            length: 5,
            sourceFile: testFile
        });

        diagnostics.addWarning('Warning', {
            line: 2,
            column: 1,
            length: 5,
            sourceFile: testFile
        });

        diagnostics.addInfo('Info', {
            line: 3,
            column: 1,
            length: 5,
            sourceFile: testFile
        });

        assert.strictEqual(diagnostics.getCount(), 3);
        assert.strictEqual(diagnostics.getErrors().length, 1);
        assert.strictEqual(diagnostics.getWarnings().length, 1);
        assert.strictEqual(diagnostics.getCount(DiagnosticSeverity.INFO), 1);
    });

    test('Invalid number literal - exponent without digits', () => {
        const source = 'float x = 123e;';
        const diagnostics = new DiagnosticCollector();
        const lexer = new Lexer(source, 'lsl', testFile, diagnostics);

        const tokens = lexer.tokenize();

        // Should still produce a number token
        const numberToken = tokens.find(t => t.type === TokenType.NUMBER_LITERAL);
        assert.ok(numberToken);
        assert.strictEqual(numberToken.value, '123e');

        // Should have error diagnostic
        assert.strictEqual(diagnostics.hasErrors(), true);
        const errors = diagnostics.getErrors();
        assert.strictEqual(errors.length, 1);
        assert.strictEqual(errors[0].code, ErrorCodes.INVALID_NUMBER_LITERAL);
        assert.ok(errors[0].message.includes('exponent has no digits'));
    });

    test('Invalid number literal - exponent with sign but no digits', () => {
        const source = 'float x = 1.5e+;';
        const diagnostics = new DiagnosticCollector();
        const lexer = new Lexer(source, 'lsl', testFile, diagnostics);

        const tokens = lexer.tokenize();

        // Should still produce a number token
        const numberToken = tokens.find(t => t.type === TokenType.NUMBER_LITERAL);
        assert.ok(numberToken);
        assert.strictEqual(numberToken.value, '1.5e+');

        // Should have error diagnostic
        assert.strictEqual(diagnostics.hasErrors(), true);
        const errors = diagnostics.getErrors();
        assert.strictEqual(errors.length, 1);
        assert.strictEqual(errors[0].code, ErrorCodes.INVALID_NUMBER_LITERAL);
    });

    test('Valid number literals - no errors', () => {
        const source = 'float a = 123; float b = 1.5; float c = 1e10; float d = 1.5e-5; float e = 1.0f;';
        const diagnostics = new DiagnosticCollector();
        const lexer = new Lexer(source, 'lsl', testFile, diagnostics);

        lexer.tokenize();

        // Should have NO error diagnostics
        assert.strictEqual(diagnostics.hasErrors(), false);
        assert.strictEqual(diagnostics.getCount(), 0);
    });

    test('Unterminated vector literal - EOF', () => {
        const source = 'vector v = <1.0, 2.0, 3.0';
        const diagnostics = new DiagnosticCollector();
        const lexer = new Lexer(source, 'lsl', testFile, diagnostics);

        const tokens = lexer.tokenize();

        // Should not produce a vector token (falls back to operator)
        const vectorToken = tokens.find(t => t.type === TokenType.VECTOR_LITERAL);
        assert.strictEqual(vectorToken, undefined);

        // Should have error diagnostic
        assert.strictEqual(diagnostics.hasErrors(), true);
        const errors = diagnostics.getErrors();
        assert.strictEqual(errors.length, 1);
        assert.strictEqual(errors[0].code, ErrorCodes.UNTERMINATED_VECTOR_LITERAL);
        assert.ok(errors[0].message.includes('Unterminated vector literal'));
    });

    test('Unterminated vector literal - newline', () => {
        const source = 'vector v = <1.0, 2.0, 3.0\nvector v2 = <1,2,3>;';
        const diagnostics = new DiagnosticCollector();
        const lexer = new Lexer(source, 'lsl', testFile, diagnostics);

        const tokens = lexer.tokenize();

        // Should have error diagnostic for first vector
        assert.strictEqual(diagnostics.hasErrors(), true);
        const errors = diagnostics.getErrors();
        assert.strictEqual(errors.length, 1);
        assert.strictEqual(errors[0].code, ErrorCodes.UNTERMINATED_VECTOR_LITERAL);
    });

    test('Valid vector literals - no errors', () => {
        const source = 'vector v = <1.0, 2.0, 3.0>; rotation r = <0.0, 0.0, 0.0, 1.0>;';
        const diagnostics = new DiagnosticCollector();
        const lexer = new Lexer(source, 'lsl', testFile, diagnostics);

        lexer.tokenize();

        // Should have NO error diagnostics
        assert.strictEqual(diagnostics.hasErrors(), false);
        assert.strictEqual(diagnostics.getCount(), 0);
    });
});
