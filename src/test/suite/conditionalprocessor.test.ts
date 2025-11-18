/**
 * @file conditionalprocessor.test.ts
 * Tests for ConditionalProcessor (lexing-based preprocessor)
 */

import * as assert from 'assert';
import { ConditionalProcessor } from '../../shared/conditionalprocessor';
import { MacroProcessor, MacroDefinition } from '../../shared/macroprocessor';
import { Token, TokenType, Lexer } from '../../shared/lexer';

suite('ConditionalProcessor (Lexing)', () => {
    let processor: ConditionalProcessor;
    let macros: MacroProcessor;

    /**
     * Helper to create a simple token
     */
    function createToken(type: TokenType, value: string, line: number = 1): Token {
        return new Token(type, value, line, 1, value.length);
    }

    /**
     * Helper to create a numeric token
     */
    function numToken(value: string, line: number = 1): Token {
        return createToken(TokenType.NUMBER_LITERAL, value, line);
    }

    /**
     * Helper to create an identifier token
     */
    function idToken(value: string, line: number = 1): Token {
        return createToken(TokenType.IDENTIFIER, value, line);
    }

    /**
     * Helper to define a simple macro
     */
    function defineMacro(name: string, body: Token[] = []): void {
        macros.define({
            name,
            parameters: undefined,
            body,
            isFunctionLike: false,
        });
    }

    /**
     * Helper to tokenize an expression for testing
     */
    function createTokens(expression: string, language: 'lsl' | 'luau' = 'lsl'): Token[] {
        const lexer = new Lexer(expression, language);
        const allTokens = lexer.tokenize();
        // Filter out EOF token
        return allTokens.filter(token => token.type !== TokenType.EOF);
    }

    setup(() => {
        processor = new ConditionalProcessor('lsl');
        macros = new MacroProcessor('lsl');
    });

    //#region Basic State Management

    suite('Basic State Management', () => {
        test('should initialize with active state', () => {
            assert.strictEqual(processor.isActive(), true);
            assert.strictEqual(processor.getDepth(), 0);
            assert.strictEqual(processor.hasUnclosedBlocks(), false);
        });

        test('should track nesting depth correctly', () => {
            assert.strictEqual(processor.getDepth(), 0);

            processor.processIfdef('FOO', macros, 1);
            assert.strictEqual(processor.getDepth(), 1);

            processor.processIfdef('BAR', macros, 2);
            assert.strictEqual(processor.getDepth(), 2);

            processor.processEndif(3);
            assert.strictEqual(processor.getDepth(), 1);

            processor.processEndif(4);
            assert.strictEqual(processor.getDepth(), 0);
        });

        test('should detect unclosed blocks', () => {
            assert.strictEqual(processor.hasUnclosedBlocks(), false);

            processor.processIfdef('TEST', macros, 1);
            assert.strictEqual(processor.hasUnclosedBlocks(), true);

            const unclosed = processor.getUnclosedBlocks();
            assert.strictEqual(unclosed.length, 1);
            assert.strictEqual(unclosed[0].directive, '#ifdef');
            assert.strictEqual(unclosed[0].line, 1);

            processor.processEndif(2);
            assert.strictEqual(processor.hasUnclosedBlocks(), false);
        });

        test('reset() should clear all state', () => {
            processor.processIfdef('FOO', macros, 1);
            processor.processIfdef('BAR', macros, 2);

            assert.strictEqual(processor.getDepth(), 2);
            assert.strictEqual(processor.hasUnclosedBlocks(), true);

            processor.reset();

            assert.strictEqual(processor.isActive(), true);
            assert.strictEqual(processor.getDepth(), 0);
            assert.strictEqual(processor.hasUnclosedBlocks(), false);
        });
    });

    //#endregion

    //#region #ifdef Directive

    suite('#ifdef Directive', () => {
        test('should activate when macro is defined', () => {
            defineMacro('DEBUG');

            const result = processor.processIfdef('DEBUG', macros, 1);

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.shouldInclude, true);
            assert.strictEqual(processor.isActive(), true);
        });

        test('should not activate when macro is undefined', () => {
            const result = processor.processIfdef('UNDEFINED', macros, 1);

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.shouldInclude, false);
            assert.strictEqual(processor.isActive(), false);
        });

        test('should respect parent block state', () => {
            // Parent block inactive
            processor.processIfdef('UNDEFINED', macros, 1);
            assert.strictEqual(processor.isActive(), false);

            // Nested block with defined macro - but parent is inactive
            defineMacro('DEBUG');
            processor.processIfdef('DEBUG', macros, 2);

            // Should remain inactive because parent is inactive
            assert.strictEqual(processor.isActive(), false);
        });

        test('should track multiple nested blocks', () => {
            defineMacro('FOO');
            defineMacro('BAR');

            processor.processIfdef('FOO', macros, 1);
            assert.strictEqual(processor.isActive(), true);

            processor.processIfdef('BAR', macros, 2);
            assert.strictEqual(processor.isActive(), true);

            processor.processEndif(3);
            assert.strictEqual(processor.isActive(), true);

            processor.processEndif(4);
            assert.strictEqual(processor.isActive(), true);
        });
    });

    //#endregion

    //#region #ifndef Directive

    suite('#ifndef Directive', () => {
        test('should activate when macro is not defined', () => {
            const result = processor.processIfndef('UNDEFINED', macros, 1);

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.shouldInclude, true);
            assert.strictEqual(processor.isActive(), true);
        });

        test('should not activate when macro is defined', () => {
            defineMacro('DEBUG');

            const result = processor.processIfndef('DEBUG', macros, 1);

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.shouldInclude, false);
            assert.strictEqual(processor.isActive(), false);
        });

        test('should work as include guard', () => {
            // First inclusion
            const result1 = processor.processIfndef('HEADER_H', macros, 1);
            assert.strictEqual(result1.shouldInclude, true);

            // Define the guard
            defineMacro('HEADER_H');

            processor.processEndif(10);
            processor.reset();

            // Second inclusion - should be blocked
            const result2 = processor.processIfndef('HEADER_H', macros, 1);
            assert.strictEqual(result2.shouldInclude, false);
            assert.strictEqual(processor.isActive(), false);
        });
    });

    //#endregion

    //#region #if Directive

    suite('#if Directive', () => {
        test('should handle numeric literal - zero is false', () => {
            const result = processor.processIf([numToken('0')], macros, 1);

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.shouldInclude, false);
            assert.strictEqual(processor.isActive(), false);
        });

        test('should handle numeric literal - non-zero is true', () => {
            const result = processor.processIf([numToken('1')], macros, 1);

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.shouldInclude, true);
            assert.strictEqual(processor.isActive(), true);
        });

        test('should handle numeric literal - negative is true', () => {
            const result = processor.processIf([numToken('-5')], macros, 1);

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.shouldInclude, true);
            assert.strictEqual(processor.isActive(), true);
        });

        test('should handle boolean identifier - true', () => {
            const result = processor.processIf([idToken('true')], macros, 1);

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.shouldInclude, true);
            assert.strictEqual(processor.isActive(), true);
        });

        test('should handle boolean identifier - false', () => {
            const result = processor.processIf([idToken('false')], macros, 1);

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.shouldInclude, false);
            assert.strictEqual(processor.isActive(), false);
        });

        test('should handle defined macro identifier as true', () => {
            defineMacro('DEBUG');

            const result = processor.processIf([idToken('DEBUG')], macros, 1);

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.shouldInclude, true);
            assert.strictEqual(processor.isActive(), true);
        });

        test('should handle undefined macro identifier as false', () => {
            const result = processor.processIf([idToken('UNDEFINED')], macros, 1);

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.shouldInclude, false);
            assert.strictEqual(processor.isActive(), false);
        });

        test('should handle empty token list as false', () => {
            const result = processor.processIf([], macros, 1);

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.shouldInclude, false);
            assert.strictEqual(processor.isActive(), false);
        });

        test('should handle defined() with defined macro', () => {
            defineMacro('DEBUG');

            // defined(DEBUG)
            const tokens = [
                createToken(TokenType.DIRECTIVE, 'defined', 1),
                createToken(TokenType.PAREN_OPEN, '(', 1),
                idToken('DEBUG'),
                createToken(TokenType.PAREN_CLOSE, ')', 1),
            ];

            const result = processor.processIf(tokens, macros, 1);

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.shouldInclude, true);
            assert.strictEqual(processor.isActive(), true);
        });

        test('should handle defined() with undefined macro', () => {
            // defined(UNDEFINED)
            const tokens = [
                createToken(TokenType.DIRECTIVE, 'defined', 1),
                createToken(TokenType.PAREN_OPEN, '(', 1),
                idToken('UNDEFINED'),
                createToken(TokenType.PAREN_CLOSE, ')', 1),
            ];

            const result = processor.processIf(tokens, macros, 1);

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.shouldInclude, false);
            assert.strictEqual(processor.isActive(), false);
        });

        test('should handle defined() with whitespace', () => {
            defineMacro('FOO');

            // defined  (  FOO  )
            const tokens = [
                createToken(TokenType.DIRECTIVE, 'defined', 1),
                createToken(TokenType.WHITESPACE, '  ', 1),
                createToken(TokenType.PAREN_OPEN, '(', 1),
                createToken(TokenType.WHITESPACE, '  ', 1),
                idToken('FOO'),
                createToken(TokenType.WHITESPACE, '  ', 1),
                createToken(TokenType.PAREN_CLOSE, ')', 1),
            ];

            const result = processor.processIf(tokens, macros, 1);

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.shouldInclude, true);
            assert.strictEqual(processor.isActive(), true);
        });

        test('should handle multiple defined() in expression', () => {
            defineMacro('A');
            // B is not defined

            // defined(A) && defined(B) should be: 1 && 0 = 0 (false)
            const tokens = [
                createToken(TokenType.DIRECTIVE, 'defined', 1),
                createToken(TokenType.PAREN_OPEN, '(', 1),
                idToken('A'),
                createToken(TokenType.PAREN_CLOSE, ')', 1),
                createToken(TokenType.OPERATOR, '&&', 1),
                createToken(TokenType.DIRECTIVE, 'defined', 1),
                createToken(TokenType.PAREN_OPEN, '(', 1),
                idToken('B'),
                createToken(TokenType.PAREN_CLOSE, ')', 1),
            ];

            const result = processor.processIf(tokens, macros, 1);

            // With full expression evaluation: defined(A)=1, defined(B)=0, 1 && 0 = 0 (false)
            assert.strictEqual(result.success, true);
            assert.strictEqual(result.shouldInclude, false);
        });
    });

    //#endregion

    //#region #elif Directive

    suite('#elif Directive', () => {
        test('should error when used without #if', () => {
            const result = processor.processElif([numToken('1')], macros, 1);

            assert.strictEqual(result.success, false);
            assert.strictEqual(result.shouldInclude, false);
            assert.ok(result.message);
            assert.ok(result.message.includes('#elif'));
            assert.ok(result.message.includes('#if'));
        });

        test('should activate when previous branch was false', () => {
            // #if 0
            processor.processIf([numToken('0')], macros, 1);
            assert.strictEqual(processor.isActive(), false);

            // #elif 1
            const result = processor.processElif([numToken('1')], macros, 2);

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.shouldInclude, true);
            assert.strictEqual(processor.isActive(), true);
        });

        test('should not activate when previous branch was true', () => {
            // #if 1
            processor.processIf([numToken('1')], macros, 1);
            assert.strictEqual(processor.isActive(), true);

            // #elif 1 - should not activate
            const result = processor.processElif([numToken('1')], macros, 2);

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.shouldInclude, false);
            assert.strictEqual(processor.isActive(), false);
        });

        test('should handle multiple #elif branches - first true wins', () => {
            // #if 0
            processor.processIf([numToken('0')], macros, 1);
            assert.strictEqual(processor.isActive(), false);

            // #elif 0
            processor.processElif([numToken('0')], macros, 2);
            assert.strictEqual(processor.isActive(), false);

            // #elif 1 - should activate
            processor.processElif([numToken('1')], macros, 3);
            assert.strictEqual(processor.isActive(), true);

            // #elif 1 - should not activate (previous branch taken)
            processor.processElif([numToken('1')], macros, 4);
            assert.strictEqual(processor.isActive(), false);
        });

        test('should error when used after #else', () => {
            processor.processIf([numToken('0')], macros, 1);
            processor.processElse(2);

            const result = processor.processElif([numToken('1')], macros, 3);

            assert.strictEqual(result.success, false);
            assert.strictEqual(result.shouldInclude, false);
            assert.ok(result.message);
            assert.ok(result.message.includes('#elif'));
            assert.ok(result.message.includes('#else'));
        });

        test('should respect parent block state', () => {
            // Parent inactive
            processor.processIfdef('UNDEFINED', macros, 1);
            assert.strictEqual(processor.isActive(), false);

            // Nested #if
            processor.processIf([numToken('0')], macros, 2);
            assert.strictEqual(processor.isActive(), false);

            // #elif with true condition - but parent inactive
            processor.processElif([numToken('1')], macros, 3);
            assert.strictEqual(processor.isActive(), false);
        });
    });

    //#endregion

    //#region #else Directive

    suite('#else Directive', () => {
        test('should error when used without #if', () => {
            const result = processor.processElse(1);

            assert.strictEqual(result.success, false);
            assert.strictEqual(result.shouldInclude, false);
            assert.ok(result.message);
            assert.ok(result.message.includes('#else'));
            assert.ok(result.message.includes('#if'));
        });

        test('should activate when previous branches were false', () => {
            // #if 0
            processor.processIf([numToken('0')], macros, 1);
            assert.strictEqual(processor.isActive(), false);

            // #else - should activate
            const result = processor.processElse(2);

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.shouldInclude, true);
            assert.strictEqual(processor.isActive(), true);
        });

        test('should not activate when previous branch was true', () => {
            // #if 1
            processor.processIf([numToken('1')], macros, 1);
            assert.strictEqual(processor.isActive(), true);

            // #else - should not activate
            const result = processor.processElse(2);

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.shouldInclude, false);
            assert.strictEqual(processor.isActive(), false);
        });

        test('should not activate when #elif was taken', () => {
            // #if 0
            processor.processIf([numToken('0')], macros, 1);

            // #elif 1 - takes this branch
            processor.processElif([numToken('1')], macros, 2);
            assert.strictEqual(processor.isActive(), true);

            // #else - should not activate
            const result = processor.processElse(3);
            assert.strictEqual(result.shouldInclude, false);
            assert.strictEqual(processor.isActive(), false);
        });

        test('should error on multiple #else for same #if', () => {
            processor.processIf([numToken('0')], macros, 1);

            const result1 = processor.processElse(2);
            assert.strictEqual(result1.success, true);

            const result2 = processor.processElse(3);
            assert.strictEqual(result2.success, false);
            assert.ok(result2.message);
            assert.ok(result2.message.includes('Multiple'));
        });

        test('should respect parent block state', () => {
            // Parent inactive
            processor.processIfdef('UNDEFINED', macros, 1);
            assert.strictEqual(processor.isActive(), false);

            // Nested #if
            processor.processIf([numToken('0')], macros, 2);

            // #else - condition would activate, but parent inactive
            processor.processElse(3);
            assert.strictEqual(processor.isActive(), false);
        });
    });

    //#endregion

    //#region #endif Directive

    suite('#endif Directive', () => {
        test('should error when used without #if', () => {
            const result = processor.processEndif(1);

            assert.strictEqual(result.success, false);
            assert.strictEqual(result.shouldInclude, false);
            assert.ok(result.message);
            assert.ok(result.message.includes('#endif'));
            assert.ok(result.message.includes('#if'));
        });

        test('should restore active state when exiting inactive block', () => {
            processor.processIfdef('UNDEFINED', macros, 1);
            assert.strictEqual(processor.isActive(), false);

            const result = processor.processEndif(2);

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.shouldInclude, true);
            assert.strictEqual(processor.isActive(), true);
        });

        test('should maintain active state when exiting active block', () => {
            defineMacro('DEBUG');

            processor.processIfdef('DEBUG', macros, 1);
            assert.strictEqual(processor.isActive(), true);

            const result = processor.processEndif(2);

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.shouldInclude, true);
            assert.strictEqual(processor.isActive(), true);
        });

        test('should handle multiple nested levels correctly', () => {
            defineMacro('LEVEL1');

            // Level 1 - active
            processor.processIfdef('LEVEL1', macros, 1);
            assert.strictEqual(processor.isActive(), true);
            assert.strictEqual(processor.getDepth(), 1);

            // Level 2 - inactive
            processor.processIfdef('UNDEFINED', macros, 2);
            assert.strictEqual(processor.isActive(), false);
            assert.strictEqual(processor.getDepth(), 2);

            // Exit level 2
            processor.processEndif(3);
            assert.strictEqual(processor.isActive(), true);
            assert.strictEqual(processor.getDepth(), 1);

            // Exit level 1
            processor.processEndif(4);
            assert.strictEqual(processor.isActive(), true);
            assert.strictEqual(processor.getDepth(), 0);
        });
    });

    //#endregion

    //#region Complex Nesting

    suite('Complex Nesting', () => {
        test('should handle deeply nested conditionals', () => {
            defineMacro('A');
            defineMacro('B');
            defineMacro('C');

            processor.processIfdef('A', macros, 1);
            assert.strictEqual(processor.isActive(), true);

            processor.processIfdef('B', macros, 2);
            assert.strictEqual(processor.isActive(), true);

            processor.processIfdef('C', macros, 3);
            assert.strictEqual(processor.isActive(), true);

            processor.processIfdef('UNDEFINED', macros, 4);
            assert.strictEqual(processor.isActive(), false);

            processor.processEndif(5);
            assert.strictEqual(processor.isActive(), true);

            processor.processEndif(6);
            assert.strictEqual(processor.isActive(), true);

            processor.processEndif(7);
            assert.strictEqual(processor.isActive(), true);

            processor.processEndif(8);
            assert.strictEqual(processor.isActive(), true);
        });

        test('should handle nested if/elif/else chains', () => {
            defineMacro('OUTER');

            // Outer block - active
            processor.processIfdef('OUTER', macros, 1);
            assert.strictEqual(processor.isActive(), true);

            // Inner if - false
            processor.processIf([numToken('0')], macros, 2);
            assert.strictEqual(processor.isActive(), false);

            // Inner elif - false
            processor.processElif([numToken('0')], macros, 3);
            assert.strictEqual(processor.isActive(), false);

            // Inner else - should activate
            processor.processElse(4);
            assert.strictEqual(processor.isActive(), true);

            processor.processEndif(5); // End inner
            assert.strictEqual(processor.isActive(), true);

            processor.processEndif(6); // End outer
            assert.strictEqual(processor.isActive(), true);
        });

        test('should handle all branches inactive in nested structure', () => {
            // Outer block - inactive
            processor.processIfdef('UNDEFINED', macros, 1);
            assert.strictEqual(processor.isActive(), false);

            // Inner #if - even with true condition, should stay inactive
            processor.processIf([numToken('1')], macros, 2);
            assert.strictEqual(processor.isActive(), false);

            // Inner #elif - should stay inactive
            processor.processElif([numToken('1')], macros, 3);
            assert.strictEqual(processor.isActive(), false);

            // Inner #else - should stay inactive
            processor.processElse(4);
            assert.strictEqual(processor.isActive(), false);

            processor.processEndif(5);
            assert.strictEqual(processor.isActive(), false);

            processor.processEndif(6);
            assert.strictEqual(processor.isActive(), true);
        });
    });

    //#endregion

    //#region Real-World Scenarios

    suite('Real-World Scenarios', () => {
        test('include guard pattern', () => {
            // First inclusion
            const result1 = processor.processIfndef('MY_HEADER_H', macros, 1);
            assert.strictEqual(result1.shouldInclude, true);

            defineMacro('MY_HEADER_H');
            // ... header content ...

            processor.processEndif(100);

            // Reset for second inclusion
            processor.reset();

            // Second inclusion - should be guarded
            const result2 = processor.processIfndef('MY_HEADER_H', macros, 1);
            assert.strictEqual(result2.shouldInclude, false);
        });

        test('debug vs release build', () => {
            defineMacro('DEBUG');

            // Debug-only code
            processor.processIfdef('DEBUG', macros, 1);
            assert.strictEqual(processor.isActive(), true);
            // ... debug code ...
            processor.processElse(10);
            assert.strictEqual(processor.isActive(), false);
            // ... release code ...
            processor.processEndif(20);
            assert.strictEqual(processor.isActive(), true);
        });

        test('platform-specific code', () => {
            defineMacro('PLATFORM_WINDOWS');

            processor.processIfdef('PLATFORM_LINUX', macros, 1);
            assert.strictEqual(processor.isActive(), false);
            // ... Linux code ...

            processor.processElif([idToken('PLATFORM_WINDOWS')], macros, 10);
            assert.strictEqual(processor.isActive(), true);
            // ... Windows code ...

            processor.processElif([idToken('PLATFORM_MAC')], macros, 20);
            assert.strictEqual(processor.isActive(), false);
            // ... Mac code ...

            processor.processElse(30);
            assert.strictEqual(processor.isActive(), false);
            // ... unknown platform code ...

            processor.processEndif(40);
            assert.strictEqual(processor.isActive(), true);
        });

        test('version checking', () => {
            defineMacro('VERSION', [numToken('2')]);

            // Check if version >= 2
            processor.processIf([idToken('VERSION')], macros, 1);
            assert.strictEqual(processor.isActive(), true);
            // ... new features ...
            processor.processEndif(10);
        });
    });

    //#region Expression Evaluation Tests

    suite('LSL Arithmetic Operations', () => {
        test('should evaluate addition', () => {
            const conditionals = new ConditionalProcessor('lsl');
            const macros = new MacroProcessor('lsl');
            const tokens = createTokens('2 + 3');

            const result = conditionals.processIf(tokens, macros, 1);
            assert.strictEqual(result.success, true);
            assert.strictEqual(result.shouldInclude, true, '2 + 3 should be true (non-zero)');
        });

        test('should evaluate subtraction', () => {
            const conditionals = new ConditionalProcessor('lsl');
            const macros = new MacroProcessor('lsl');
            const tokens = createTokens('10 - 5');

            const result = conditionals.processIf(tokens, macros, 1);
            assert.strictEqual(result.success, true);
            assert.strictEqual(result.shouldInclude, true, '10 - 5 should be true (non-zero)');
        });

        test('should evaluate multiplication', () => {
            const conditionals = new ConditionalProcessor('lsl');
            const macros = new MacroProcessor('lsl');
            const tokens = createTokens('3 * 4');

            const result = conditionals.processIf(tokens, macros, 1);
            assert.strictEqual(result.success, true);
            assert.strictEqual(result.shouldInclude, true, '3 * 4 should be true (non-zero)');
        });

        test('should evaluate division', () => {
            const conditionals = new ConditionalProcessor('lsl');
            const macros = new MacroProcessor('lsl');
            const tokens = createTokens('20 / 4');

            const result = conditionals.processIf(tokens, macros, 1);
            assert.strictEqual(result.success, true);
            assert.strictEqual(result.shouldInclude, true, '20 / 4 should be true (non-zero)');
        });

        test('should evaluate modulo', () => {
            const conditionals = new ConditionalProcessor('lsl');
            const macros = new MacroProcessor('lsl');
            const tokens = createTokens('10 % 3');

            const result = conditionals.processIf(tokens, macros, 1);
            assert.strictEqual(result.success, true);
            assert.strictEqual(result.shouldInclude, true, '10 % 3 should be true (result is 1)');
        });

        test('should respect operator precedence', () => {
            const conditionals = new ConditionalProcessor('lsl');
            const macros = new MacroProcessor('lsl');
            // 2 + 3 * 4 = 2 + 12 = 14
            const tokens = createTokens('2 + 3 * 4');

            const result = conditionals.processIf(tokens, macros, 1);
            assert.strictEqual(result.success, true);
            assert.strictEqual(result.shouldInclude, true);
        });

        test('should handle parentheses', () => {
            const conditionals = new ConditionalProcessor('lsl');
            const macros = new MacroProcessor('lsl');
            // (2 + 3) * 4 = 5 * 4 = 20
            const tokens = createTokens('(2 + 3) * 4');

            const result = conditionals.processIf(tokens, macros, 1);
            assert.strictEqual(result.success, true);
            assert.strictEqual(result.shouldInclude, true);
        });

        test('should handle unary minus', () => {
            const conditionals = new ConditionalProcessor('lsl');
            const macros = new MacroProcessor('lsl');
            const tokens = createTokens('-5 + 3');

            const result = conditionals.processIf(tokens, macros, 1);
            assert.strictEqual(result.success, true);
            assert.strictEqual(result.shouldInclude, true, '-5 + 3 = -2, which is non-zero so should be true');
        });
    });

    suite('LSL Comparison Operations', () => {
        test('should evaluate equal (==)', () => {
            const conditionals = new ConditionalProcessor('lsl');
            const macros = new MacroProcessor('lsl');
            const tokens = createTokens('5 == 5');

            const result = conditionals.processIf(tokens, macros, 1);
            assert.strictEqual(result.success, true);
            assert.strictEqual(result.shouldInclude, true, '5 == 5 should be true');
        });

        test('should evaluate not equal (!=)', () => {
            const conditionals = new ConditionalProcessor('lsl');
            const macros = new MacroProcessor('lsl');
            const tokens = createTokens('5 != 3');

            const result = conditionals.processIf(tokens, macros, 1);
            assert.strictEqual(result.success, true);
            assert.strictEqual(result.shouldInclude, true, '5 != 3 should be true');
        });

        test('should evaluate less than (<)', () => {
            const conditionals = new ConditionalProcessor('lsl');
            const macros = new MacroProcessor('lsl');
            const tokens = createTokens('3 < 5');

            const result = conditionals.processIf(tokens, macros, 1);
            assert.strictEqual(result.success, true);
            assert.strictEqual(result.shouldInclude, true, '3 < 5 should be true');
        });

        test('should evaluate greater than (>)', () => {
            const conditionals = new ConditionalProcessor('lsl');
            const macros = new MacroProcessor('lsl');
            const tokens = createTokens('5 > 3');

            const result = conditionals.processIf(tokens, macros, 1);
            assert.strictEqual(result.success, true);
            assert.strictEqual(result.shouldInclude, true, '5 > 3 should be true');
        });

        test('should evaluate less than or equal (<=)', () => {
            const conditionals = new ConditionalProcessor('lsl');
            const macros = new MacroProcessor('lsl');
            const tokens = createTokens('5 <= 5');

            const result = conditionals.processIf(tokens, macros, 1);
            assert.strictEqual(result.success, true);
            assert.strictEqual(result.shouldInclude, true, '5 <= 5 should be true');
        });

        test('should evaluate greater than or equal (>=)', () => {
            const conditionals = new ConditionalProcessor('lsl');
            const macros = new MacroProcessor('lsl');
            const tokens = createTokens('5 >= 5');

            const result = conditionals.processIf(tokens, macros, 1);
            assert.strictEqual(result.success, true);
            assert.strictEqual(result.shouldInclude, true, '5 >= 5 should be true');
        });
    });

    suite('LSL Logical Operations', () => {
        test('should evaluate logical AND (&&) - both true', () => {
            const conditionals = new ConditionalProcessor('lsl');
            const macros = new MacroProcessor('lsl');
            const tokens = createTokens('1 && 1');

            const result = conditionals.processIf(tokens, macros, 1);
            assert.strictEqual(result.success, true);
            assert.strictEqual(result.shouldInclude, true, '1 && 1 should be true');
        });

        test('should evaluate logical AND (&&) - one false', () => {
            const conditionals = new ConditionalProcessor('lsl');
            const macros = new MacroProcessor('lsl');
            const tokens = createTokens('1 && 0');

            const result = conditionals.processIf(tokens, macros, 1);
            assert.strictEqual(result.success, true);
            assert.strictEqual(result.shouldInclude, false, '1 && 0 should be false');
        });

        test('should evaluate logical OR (||) - one true', () => {
            const conditionals = new ConditionalProcessor('lsl');
            const macros = new MacroProcessor('lsl');
            const tokens = createTokens('1 || 0');

            const result = conditionals.processIf(tokens, macros, 1);
            assert.strictEqual(result.success, true);
            assert.strictEqual(result.shouldInclude, true, '1 || 0 should be true');
        });

        test('should evaluate logical OR (||) - both false', () => {
            const conditionals = new ConditionalProcessor('lsl');
            const macros = new MacroProcessor('lsl');
            const tokens = createTokens('0 || 0');

            const result = conditionals.processIf(tokens, macros, 1);
            assert.strictEqual(result.success, true);
            assert.strictEqual(result.shouldInclude, false, '0 || 0 should be false');
        });

        test('should evaluate logical NOT (!)', () => {
            const conditionals = new ConditionalProcessor('lsl');
            const macros = new MacroProcessor('lsl');
            const tokens = createTokens('!0');

            const result = conditionals.processIf(tokens, macros, 1);
            assert.strictEqual(result.success, true);
            assert.strictEqual(result.shouldInclude, true, '!0 should be true');
        });

        test('should respect logical operator precedence', () => {
            const conditionals = new ConditionalProcessor('lsl');
            const macros = new MacroProcessor('lsl');
            // 1 || 0 && 0 = 1 || (0 && 0) = 1 || 0 = 1
            const tokens = createTokens('1 || 0 && 0');

            const result = conditionals.processIf(tokens, macros, 1);
            assert.strictEqual(result.success, true);
            assert.strictEqual(result.shouldInclude, true);
        });
    });

    suite('LSL Complex Expressions', () => {
        test('should handle combined arithmetic and comparison', () => {
            const conditionals = new ConditionalProcessor('lsl');
            const macros = new MacroProcessor('lsl');
            const tokens = createTokens('(2 + 3) > 4');

            const result = conditionals.processIf(tokens, macros, 1);
            assert.strictEqual(result.success, true);
            assert.strictEqual(result.shouldInclude, true, '(2 + 3) > 4 = 5 > 4 should be true');
        });

        test('should handle nested parentheses', () => {
            const conditionals = new ConditionalProcessor('lsl');
            const macros = new MacroProcessor('lsl');
            const tokens = createTokens('((2 + 3) * (4 - 1)) == 15');

            const result = conditionals.processIf(tokens, macros, 1);
            assert.strictEqual(result.success, true);
            assert.strictEqual(result.shouldInclude, true, '((2 + 3) * (4 - 1)) == 15 should be true');
        });

        test('should handle complex logical expression', () => {
            const conditionals = new ConditionalProcessor('lsl');
            const macros = new MacroProcessor('lsl');
            const tokens = createTokens('(5 > 3) && (2 < 4) || (1 == 0)');

            const result = conditionals.processIf(tokens, macros, 1);
            assert.strictEqual(result.success, true);
            assert.strictEqual(result.shouldInclude, true);
        });
    });

    suite('LSL Macro Expansion in Expressions', () => {
        test('should expand macros in expressions', () => {
            const conditionals = new ConditionalProcessor('lsl');
            const macros = new MacroProcessor('lsl');
            macros.define({ name: 'FOO', body: [numToken('5')], isFunctionLike: false });
            macros.define({ name: 'BAR', body: [numToken('3')], isFunctionLike: false });

            const tokens = createTokens('FOO + BAR');
            const result = conditionals.processIf(tokens, macros, 1);

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.shouldInclude, true, 'FOO + BAR = 5 + 3 = 8 should be true');
        });

        test('should handle macros in comparisons', () => {
            const conditionals = new ConditionalProcessor('lsl');
            const macros = new MacroProcessor('lsl');
            macros.define({ name: 'VERSION', body: [numToken('2')], isFunctionLike: false });

            const tokens = createTokens('VERSION >= 2');
            const result = conditionals.processIf(tokens, macros, 1);

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.shouldInclude, true, 'VERSION >= 2 should be true');
        });

        test('should handle empty macro as 1 (true)', () => {
            const conditionals = new ConditionalProcessor('lsl');
            const macros = new MacroProcessor('lsl');
            const emptyDef: MacroDefinition = {
                name: 'EMPTY',
                body: [],
                isFunctionLike: false,
            };
            macros.define(emptyDef);

            const tokens = createTokens('EMPTY');
            const result = conditionals.processIf(tokens, macros, 1);

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.shouldInclude, true, 'Empty macro (defined but no value) should be treated as 1 (true)');
        });
    });

    suite('Luau Logical Operators', () => {
        test('should use "and" operator in Luau', () => {
            const conditionals = new ConditionalProcessor('luau');
            const macros = new MacroProcessor('luau');
            const tokens = createTokens('1 and 1', 'luau');

            const result = conditionals.processIf(tokens, macros, 1);
            assert.strictEqual(result.success, true);
            assert.strictEqual(result.shouldInclude, true, '1 and 1 should be true');
        });

        test('should use "or" operator in Luau', () => {
            const conditionals = new ConditionalProcessor('luau');
            const macros = new MacroProcessor('luau');
            const tokens = createTokens('0 or 1', 'luau');

            const result = conditionals.processIf(tokens, macros, 1);
            assert.strictEqual(result.success, true);
            assert.strictEqual(result.shouldInclude, true, '0 or 1 should be true');
        });

        test('should use "not" operator in Luau', () => {
            const conditionals = new ConditionalProcessor('luau');
            const macros = new MacroProcessor('luau');
            const tokens = createTokens('not 0', 'luau');

            const result = conditionals.processIf(tokens, macros, 1);
            assert.strictEqual(result.success, true);
            assert.strictEqual(result.shouldInclude, true, 'not 0 should be true');
        });

        test('should use ~= for inequality in Luau', () => {
            const conditionals = new ConditionalProcessor('luau');
            const macros = new MacroProcessor('luau');
            const tokens = createTokens('5 ~= 3', 'luau');

            const result = conditionals.processIf(tokens, macros, 1);
            assert.strictEqual(result.success, true);
            assert.strictEqual(result.shouldInclude, true, '5 ~= 3 should be true');
        });

        test('should handle complex Luau expression', () => {
            const conditionals = new ConditionalProcessor('luau');
            const macros = new MacroProcessor('luau');
            const tokens = createTokens('(5 > 3) and (2 < 4) or (1 == 0)', 'luau');

            const result = conditionals.processIf(tokens, macros, 1);
            assert.strictEqual(result.success, true);
            assert.strictEqual(result.shouldInclude, true);
        });
    });

    suite('Expression Error Handling', () => {
        test('should handle division by zero gracefully', () => {
            const conditionals = new ConditionalProcessor('lsl');
            const macros = new MacroProcessor('lsl');
            const tokens = createTokens('1 / 0');

            const result = conditionals.processIf(tokens, macros, 1);
            assert.strictEqual(result.success, true);
            // Should default to false on error
            assert.strictEqual(result.shouldInclude, false);
        });

        test('should handle missing closing parenthesis', () => {
            const conditionals = new ConditionalProcessor('lsl');
            const macros = new MacroProcessor('lsl');
            const tokens = createTokens('(1 + 2');

            const result = conditionals.processIf(tokens, macros, 1);
            assert.strictEqual(result.success, true);
            // Should default to false on error
            assert.strictEqual(result.shouldInclude, false);
        });

        test('should handle empty expression', () => {
            const conditionals = new ConditionalProcessor('lsl');
            const macros = new MacroProcessor('lsl');
            const tokens = createTokens('');

            const result = conditionals.processIf(tokens, macros, 1);
            assert.strictEqual(result.success, true);
            assert.strictEqual(result.shouldInclude, false, 'Empty expression should be false');
        });
    });

    suite('Expression Integration with defined()', () => {
        test('should combine defined() with arithmetic', () => {
            const conditionals = new ConditionalProcessor('lsl');
            const macros = new MacroProcessor('lsl');
            macros.define({ name: 'DEBUG', body: [numToken('1')], isFunctionLike: false });

            const tokens = createTokens('defined(DEBUG) && 1');
            const result = conditionals.processIf(tokens, macros, 1);

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.shouldInclude, true);
        });

        test('should combine defined() with comparison', () => {
            const conditionals = new ConditionalProcessor('lsl');
            const macros = new MacroProcessor('lsl');
            macros.define({ name: 'VERSION', body: [numToken('2')], isFunctionLike: false });

            const tokens = createTokens('defined(VERSION) && VERSION >= 2');
            const result = conditionals.processIf(tokens, macros, 1);

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.shouldInclude, true);
        });

        test('should handle !defined() for undefined macro', () => {
            const conditionals = new ConditionalProcessor('lsl');
            const macros = new MacroProcessor('lsl');

            const tokens = createTokens('!defined(UNDEFINED)');
            const result = conditionals.processIf(tokens, macros, 1);

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.shouldInclude, true); // !0 = true
        });

        test('should handle !defined() for defined macro', () => {
            const conditionals = new ConditionalProcessor('lsl');
            const macros = new MacroProcessor('lsl');
            macros.define({ name: 'DEBUG', body: [], isFunctionLike: false });

            const tokens = createTokens('!defined(DEBUG)');
            const result = conditionals.processIf(tokens, macros, 1);

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.shouldInclude, false); // !1 = false
        });

        test('should handle not defined() in Luau', () => {
            const conditionals = new ConditionalProcessor('luau');
            const macros = new MacroProcessor('luau');

            const tokens = createTokens('not defined(UNDEFINED)', 'luau');
            const result = conditionals.processIf(tokens, macros, 1);

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.shouldInclude, true); // not 0 = true
        });

        test('should handle complex expression with !defined()', () => {
            const conditionals = new ConditionalProcessor('lsl');
            const macros = new MacroProcessor('lsl');
            macros.define({ name: 'DEBUG', body: [], isFunctionLike: false });

            const tokens = createTokens('defined(DEBUG) && !defined(RELEASE)');
            const result = conditionals.processIf(tokens, macros, 1);

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.shouldInclude, true); // 1 && !0 = 1 && 1 = true
        });
    });

    //#endregion

    //#endregion
});
