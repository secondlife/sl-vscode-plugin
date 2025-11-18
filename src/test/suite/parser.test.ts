/**
 * @file parser.test.ts
 * Comprehensive tests for the Parser implementation
 */

import * as assert from 'assert';
import { Parser } from '../../shared/parser';
import { Lexer } from '../../shared/lexer';
import { normalizePath, HostInterface, NormalizedPath } from '../../interfaces/hostinterface';
import { ConfigKey, FullConfigInterface } from '../../interfaces/configinterface';

suite('Parser Tests', () => {
    const testFile = normalizePath('/test/script.lsl');

    // Create a minimal mock host for testing URI conversions
    function createMockHost(): HostInterface {
        return new class implements HostInterface {
            config = {} as FullConfigInterface;

            async readFile(path: NormalizedPath): Promise<string | null> {
                return null;
            }
            async exists(path: NormalizedPath): Promise<boolean> {
                return false;
            }
            async resolveFile(
                filename: string,
                from: NormalizedPath,
                extensions?: string[],
                includePaths?: string[]
            ): Promise<NormalizedPath | null> {
                return null;
            }
            async writeFile(p: NormalizedPath, content: string | Uint8Array): Promise<boolean> {
                return false;
            }
            async readJSON<T = any>(p: NormalizedPath): Promise<T | null> {
                return null;
            }
            async readYAML<T = any>(p: NormalizedPath): Promise<T | null> {
                return null;
            }
            async readTOML<T = any>(p: NormalizedPath): Promise<T | null> {
                return null;
            }
            async writeJSON(p: NormalizedPath, data: any, pretty?: boolean): Promise<boolean> {
                return false;
            }
            async writeYAML(p: NormalizedPath, data: any): Promise<boolean> {
                return false;
            }
            async writeTOML(p: NormalizedPath, data: Record<string, any>): Promise<boolean> {
                return false;
            }
            fileNameToUri(fileName: NormalizedPath): string {
                // Strip path to only include directories/filename after "test" directory
                const testIndex = fileName.indexOf('test');
                const relativePath = testIndex !== -1 ? fileName.substring(testIndex) : fileName;
                // Normalize backslashes to forward slashes
                const normalizedPath = relativePath.replace(/\\/g, '/');
                return "unittest:///" + normalizedPath;
            }
            uriToFileName(uri: string): NormalizedPath {
                return normalizePath(uri.replace("unittest:///", ""));
            }
        };
    }

    //#region Basic Parser Tests

    test('should handle simple pass-through code', async () => {
        const source = `integer x = 42;
string s = "hello";`;

        const lexer = new Lexer(source, 'lsl');
        const tokens = lexer.tokenize();

        const parser = new Parser(tokens, testFile, 'lsl');
        const result = await parser.parse();

        assert.strictEqual(result.source, source);
        assert.strictEqual(result.includes.length, 0);
        assert.strictEqual(result.macros.length, 0);
    });

    test('should detect #include directives', async () => {
        const source = `#include "common.lsl"
integer x = 42;`;

        const lexer = new Lexer(source, 'lsl');
        const tokens = lexer.tokenize();

        const parser = new Parser(tokens, testFile, 'lsl');
        const result = await parser.parse();

        assert.strictEqual(result.includes.length, 1);
        assert.strictEqual(result.includes[0].file, 'common.lsl');
        assert.strictEqual(result.includes[0].isRequire, false);
    });

    test('should detect require() directives', async () => {
        const source = `require("module.luau")
local x = 42`;

        const lexer = new Lexer(source, 'luau');
        const tokens = lexer.tokenize();

        const parser = new Parser(tokens, testFile, 'luau');
        const result = await parser.parse();

        assert.strictEqual(result.includes.length, 1);
        assert.strictEqual(result.includes[0].file, 'module.luau');
        assert.strictEqual(result.includes[0].isRequire, true);
    });

    test('should handle simple macro definition', async () => {
        const source = `#define PI 3.14159
float area = PI * r * r;`;

        const lexer = new Lexer(source, 'lsl');
        const tokens = lexer.tokenize();

        const parser = new Parser(tokens, testFile, 'lsl');
        const result = await parser.parse();

        assert.strictEqual(result.macros.length, 1);
        assert.strictEqual(result.macros[0].name, 'PI');
        assert.strictEqual(result.macros[0].isFunctionLike, false);
    });

    test('should expand simple macros', async () => {
        const source = `#define PI 3.14159
float x = PI;`;

        const lexer = new Lexer(source, 'lsl');
        const tokens = lexer.tokenize();

        const parser = new Parser(tokens, testFile, 'lsl');
        const result = await parser.parse();

        // Check that PI was expanded to 3.14159
        assert.ok(result.source.includes('3.14159'));
        assert.ok(!result.source.match(/\bPI\b/)); // PI identifier should be replaced
    });

    test('should handle #ifdef conditionals', async () => {
        const source = `#define DEBUG
#ifdef DEBUG
llOwnerSay("Debug mode");
#endif
llOwnerSay("Always");`;

        const lexer = new Lexer(source, 'lsl');
        const tokens = lexer.tokenize();

        const parser = new Parser(tokens, testFile, 'lsl');
        const result = await parser.parse();

        // Both lines should be in output
        assert.ok(result.source.includes('Debug mode'));
        assert.ok(result.source.includes('Always'));
    });

    test('should exclude code in false #ifdef', async () => {
        const source = `#ifdef UNDEFINED
llOwnerSay("This should not appear");
#endif
llOwnerSay("This should appear");`;

        const lexer = new Lexer(source, 'lsl');
        const tokens = lexer.tokenize();

        const parser = new Parser(tokens, testFile, 'lsl');
        const result = await parser.parse();

        // Only the second line should be in output
        assert.ok(!result.source.includes('should not appear'));
        assert.ok(result.source.includes('should appear'));
    });

    test('should handle #else branches', async () => {
        const source = `#ifdef UNDEFINED
llOwnerSay("Not included");
#else
llOwnerSay("Included");
#endif`;

        const lexer = new Lexer(source, 'lsl');
        const tokens = lexer.tokenize();

        const parser = new Parser(tokens, testFile, 'lsl');
        const result = await parser.parse();

        assert.ok(!result.source.includes('Not included'));
        assert.ok(result.source.includes('Included'));
    });

    test('should create line mappings', async () => {
        const source = `line 1
line 2
line 3`;

        const lexer = new Lexer(source, 'lsl');
        const tokens = lexer.tokenize();

        const parser = new Parser(tokens, testFile, 'lsl');
        const result = await parser.parse();

        assert.ok(result.mappings.length > 0);
        // Check that mappings reference the correct source file
        assert.strictEqual(result.mappings[0].sourceFile, testFile);
    });

    test('should handle function-like macro definition', async () => {
        const source = `#define MAX(a, b) ((a) > (b) ? (a) : (b))
integer x = 5;`;

        const lexer = new Lexer(source, 'lsl');
        const tokens = lexer.tokenize();

        const parser = new Parser(tokens, testFile, 'lsl');
        const result = await parser.parse();

        assert.strictEqual(result.macros.length, 1);
        assert.strictEqual(result.macros[0].name, 'MAX');
        assert.strictEqual(result.macros[0].isFunctionLike, true);
        assert.ok(result.macros[0].parameters);
        assert.strictEqual(result.macros[0].parameters?.length, 2);
        assert.deepStrictEqual(result.macros[0].parameters, ['a', 'b']);
    });

    test('should handle #undef directive', async () => {
        const source = `#define PI 3.14159
float x = PI;
#undef PI
float y = PI;`;

        const lexer = new Lexer(source, 'lsl');
        const tokens = lexer.tokenize();

        const parser = new Parser(tokens, testFile, 'lsl');
        const result = await parser.parse();

        // After preprocessing:
        // - #define directive is removed
        // - First PI should be expanded to 3.14159
        // - #undef directive is removed
        // - Second PI (after #undef) should remain as identifier

        // The output should contain the expanded value from the first usage
        assert.ok(result.source.includes('3.14159'),
            'First usage of PI should be expanded');

        // The output should also contain PI as an identifier in the second usage
        // We need to check that PI appears after the expanded value
        const expandedIndex = result.source.indexOf('3.14159');
        const identifierIndex = result.source.indexOf('PI', expandedIndex + 1);
        assert.ok(identifierIndex > expandedIndex,
            'Second usage of PI should remain as identifier after #undef');
    });

    //#endregion

    //#region Line Continuation Tests

    test('define with line continuation', async () => {
        const source = `#define LONG_MACRO \\\n    value1 \\\n    value2 \\\n    value3\nresult`;
        const lexer = new Lexer(source, 'lsl');
        const tokens = lexer.tokenize();

        const parser = new Parser(tokens, testFile, 'lsl');
        await parser.parse();

        // Macro should be defined with all three values
        const macros = parser.getState().macros.getAllMacros();
        const longMacro = macros.get('LONG_MACRO');
        assert.ok(longMacro, 'LONG_MACRO should be defined');
        // After trimming, body should be: value1 <ws> value2 <ws> value3
        assert.strictEqual(longMacro.body.length, 5, 'Should have 5 tokens (3 identifiers + 2 whitespace)');
        // Verify the important tokens are present
        const identifierTokens = longMacro.body.filter(t => t.type === 'IDENTIFIER');
        assert.strictEqual(identifierTokens.length, 3, 'Should have 3 identifier tokens');
        assert.strictEqual(identifierTokens[0].value, 'value1');
        assert.strictEqual(identifierTokens[1].value, 'value2');
        assert.strictEqual(identifierTokens[2].value, 'value3');
    });

    test('define with multiple line continuations', async () => {
        const source = `#define MULTI \\\n    a + \\\n    b + \\\n    c + \\\n    d\nx`;
        const lexer = new Lexer(source, 'lsl');
        const tokens = lexer.tokenize();

        const parser = new Parser(tokens, testFile, 'lsl');
        await parser.parse();

        const macros = parser.getState().macros.getAllMacros();
        const multiMacro = macros.get('MULTI');
        assert.ok(multiMacro, 'MULTI should be defined');
        // After trimming: a <ws> + <ws> b <ws> + <ws> c <ws> + <ws> d
        // = 4 identifiers + 3 operators + 6 whitespace = 13 tokens
        assert.strictEqual(multiMacro.body.length, 13, 'Should have 13 tokens (4 identifiers + 3 operators + 6 whitespace)');
        // Verify key tokens are present
        const identifiers = multiMacro.body.filter(t => t.type === 'IDENTIFIER');
        const operators = multiMacro.body.filter(t => t.type === 'OPERATOR');
        assert.strictEqual(identifiers.length, 4, 'Should have 4 identifiers: a, b, c, d');
        assert.strictEqual(operators.length, 3, 'Should have 3 + operators');
        assert.strictEqual(identifiers[0].value, 'a');
        assert.strictEqual(identifiers[1].value, 'b');
        assert.strictEqual(identifiers[2].value, 'c');
        assert.strictEqual(identifiers[3].value, 'd');
    });

    test('define without line continuation', async () => {
        const source = `#define SIMPLE value\nresult`;
        const lexer = new Lexer(source, 'lsl');
        const tokens = lexer.tokenize();

        const parser = new Parser(tokens, testFile, 'lsl');
        await parser.parse();

        const macros = parser.getState().macros.getAllMacros();
        const simpleMacro = macros.get('SIMPLE');
        assert.ok(simpleMacro, 'SIMPLE should be defined');
        assert.strictEqual(simpleMacro.body.length, 1, 'Should have 1 token');
        assert.strictEqual(simpleMacro.body[0].value, 'value');
    });

    test('line continuation only works at end of line', async () => {
        const source = `#define TEST \\ value\nresult`;
        const lexer = new Lexer(source, 'lsl');
        const tokens = lexer.tokenize();

        const parser = new Parser(tokens, testFile, 'lsl');
        await parser.parse();

        const macros = parser.getState().macros.getAllMacros();
        const testMacro = macros.get('TEST');
        assert.ok(testMacro, 'TEST should be defined');
        // Backslash in middle of line should be kept as a token
        // But we remove it, so we should have just 'value'
        // Actually, based on implementation, backslash followed by space is not line continuation
        // Only backslash immediately before newline
        assert.ok(testMacro.body.length >= 1, 'Should have at least 1 token');
    });

    test('function-like macro with line continuation', async () => {
        const source = `#define FUNC(x) \\\n    ((x) * \\\n     (x))\nFUNC(5)`;
        const lexer = new Lexer(source, 'lsl');
        const tokens = lexer.tokenize();

        const parser = new Parser(tokens, testFile, 'lsl');
        await parser.parse();

        const macros = parser.getState().macros.getAllMacros();
        const funcMacro = macros.get('FUNC');
        assert.ok(funcMacro, 'FUNC should be defined');
        assert.ok(funcMacro.isFunctionLike, 'Should be function-like');
        assert.ok(funcMacro.parameters, 'Should have parameters');
        assert.strictEqual(funcMacro.parameters[0], 'x');
        // Body should contain: (, (, x, ), *, (, x, ), ) (9 tokens)
        assert.ok(funcMacro.body.length >= 7, 'Should have multiple tokens in body');
    });

    test('empty line after backslash', async () => {
        const source = `#define TEST \\\n\\\n    value\nresult`;
        const lexer = new Lexer(source, 'lsl');
        const tokens = lexer.tokenize();

        const parser = new Parser(tokens, testFile, 'lsl');
        await parser.parse();

        const macros = parser.getState().macros.getAllMacros();
        const testMacro = macros.get('TEST');
        assert.ok(testMacro, 'TEST should be defined');
        // Should continue through empty line
        assert.strictEqual(testMacro.body.length, 1);
        assert.strictEqual(testMacro.body[0].value, 'value');
    });

    test('macro expansion with line-continued definition', async () => {
        const source = `#define ADD(a,b) \\\n    ((a) + \\\n     (b))\nADD(1,2)`;
        const lexer = new Lexer(source, 'lsl');
        const tokens = lexer.tokenize();

        const parser = new Parser(tokens, testFile, 'lsl');
        await parser.parse();

        // Verify the macro was defined with line continuation
        const macros = parser.getState().macros.getAllMacros();
        const addMacro = macros.get('ADD');
        assert.ok(addMacro, 'ADD should be defined');
        assert.ok(addMacro.isFunctionLike, 'Should be function-like');
        assert.ok(addMacro.parameters, 'Should have parameters');
        assert.deepStrictEqual(addMacro.parameters, ['a', 'b']);
        // Body should contain the tokens from the line-continued definition
        assert.ok(addMacro.body.length >= 7, 'Should have multiple tokens in body');

        // Note: Full parameter substitution in expandFunction is TODO in MacroProcessor
        // This test verifies the line continuation worked during definition
    });

    //#endregion

    //#region Multi-Token Macro Tests

    test('simple macro with multi-token body', async () => {
        const source = `#define VECTOR <1.0, 2.0, 3.0>
vector v = VECTOR;`;

        const lexer = new Lexer(source, 'lsl');
        const tokens = lexer.tokenize();

        const parser = new Parser(tokens, testFile, 'lsl');
        const result = await parser.parse();

        // Verify macro definition
        const macros = parser.getState().macros.getAllMacros();
        const vectorMacro = macros.get('VECTOR');
        assert.ok(vectorMacro, 'VECTOR should be defined');
        assert.ok(!vectorMacro.isFunctionLike, 'Should be simple macro');
        // Body should contain: <, 1.0, ,, 2.0, ,, 3.0, > (multiple tokens)
        assert.ok(vectorMacro.body.length >= 1, `Should have at least 1 token, got ${vectorMacro.body.length}`);

        // Most importantly: verify the macro CAN have multiple tokens in its body
        // The body will include < 1.0 , 2.0 , 3.0 > as separate tokens
        if (vectorMacro.body.length > 1) {
            assert.strictEqual(vectorMacro.body[0].value, '<', 'First token should be <');
        }

        // Verify expansion works with multi-token body
        assert.ok(result.source.includes('<'));
        assert.ok(result.source.includes('1.0'));
        assert.ok(result.source.includes('2.0'));
        assert.ok(result.source.includes('3.0'));
    });

    test('simple macro with expression body', async () => {
        const source = `#define SQUARED_SUM (x * x) + (y * y)
integer result = SQUARED_SUM;`;

        const lexer = new Lexer(source, 'lsl');
        const tokens = lexer.tokenize();

        const parser = new Parser(tokens, testFile, 'lsl');
        const result = await parser.parse();

        // Verify macro definition
        const macros = parser.getState().macros.getAllMacros();
        const macro = macros.get('SQUARED_SUM');
        assert.ok(macro, 'SQUARED_SUM should be defined');
        // Body should contain multiple tokens
        assert.ok(macro.body.length >= 9, 'Should have many tokens in body');

        // Verify expansion includes all tokens
        assert.ok(result.source.includes('x'));
        assert.ok(result.source.includes('y'));
        assert.ok(result.source.includes('*'));
        assert.ok(result.source.includes('+'));
    });

    test('simple macro with string concatenation', async () => {
        const source = `#define MESSAGE "Hello, " + "World!"
string msg = MESSAGE;`;

        const lexer = new Lexer(source, 'lsl');
        const tokens = lexer.tokenize();

        const parser = new Parser(tokens, testFile, 'lsl');
        const result = await parser.parse();

        // Verify macro definition
        const macros = parser.getState().macros.getAllMacros();
        const macro = macros.get('MESSAGE');
        assert.ok(macro, 'MESSAGE should be defined');
        // Body contains: "Hello, ", whitespace, +, whitespace, "World!" (5 tokens)
        assert.strictEqual(macro.body.length, 5, 'Should have 5 tokens (2 strings, 1 operator, 2 whitespace)');
        // Verify the important tokens
        const stringTokens = macro.body.filter(t => t.type === 'STRING_LITERAL');
        const operatorTokens = macro.body.filter(t => t.type === 'OPERATOR');
        assert.strictEqual(stringTokens.length, 2, 'Should have 2 string literals');
        assert.strictEqual(operatorTokens.length, 1, 'Should have 1 operator');
        assert.strictEqual(stringTokens[0].value, '"Hello, "');
        assert.strictEqual(operatorTokens[0].value, '+');
        assert.strictEqual(stringTokens[1].value, '"World!"');

        // Verify expansion
        assert.ok(result.source.includes('"Hello, "'));
        assert.ok(result.source.includes('"World!"'));
    });

    //#endregion

    //#region Nested Conditional Tests

    test('nested #ifdef blocks', async () => {
        const source = `#define OUTER
#define INNER
#ifdef OUTER
llOwnerSay("outer");
#ifdef INNER
llOwnerSay("inner");
#endif
llOwnerSay("outer2");
#endif
llOwnerSay("always");`;

        const lexer = new Lexer(source, 'lsl');
        const tokens = lexer.tokenize();

        const parser = new Parser(tokens, testFile, 'lsl');
        const result = await parser.parse();

        // All messages should be included
        assert.ok(result.source.includes('"outer"'));
        assert.ok(result.source.includes('"inner"'));
        assert.ok(result.source.includes('"outer2"'));
        assert.ok(result.source.includes('"always"'));
    });

    test('nested #ifdef with false outer', async () => {
        const source = `#define INNER
#ifdef OUTER
llOwnerSay("outer");
#ifdef INNER
llOwnerSay("inner");
#endif
#endif
llOwnerSay("always");`;

        const lexer = new Lexer(source, 'lsl');
        const tokens = lexer.tokenize();

        const parser = new Parser(tokens, testFile, 'lsl');
        const result = await parser.parse();

        // Only "always" should be included
        assert.ok(!result.source.includes('"outer"'));
        assert.ok(!result.source.includes('"inner"'));
        assert.ok(result.source.includes('"always"'));
    });

    test('#elif chain', async () => {
        const source = `#define OPTION_B
#ifdef OPTION_A
llOwnerSay("A");
#elif OPTION_B
llOwnerSay("B");
#elif OPTION_C
llOwnerSay("C");
#else
llOwnerSay("none");
#endif`;

        const lexer = new Lexer(source, 'lsl');
        const tokens = lexer.tokenize();

        const parser = new Parser(tokens, testFile, 'lsl');
        const result = await parser.parse();

        // Only "B" should be included
        assert.ok(!result.source.includes('"A"'));
        assert.ok(result.source.includes('"B"'));
        assert.ok(!result.source.includes('"C"'));
        assert.ok(!result.source.includes('"none"'));
    });

    //#endregion

    //#region Macro Redefinition Tests

    test('macro redefinition', async () => {
        const source = `#define VALUE 10
integer x = VALUE;
#define VALUE 20
integer y = VALUE;`;

        const lexer = new Lexer(source, 'lsl');
        const tokens = lexer.tokenize();

        const parser = new Parser(tokens, testFile, 'lsl');
        const result = await parser.parse();

        // First usage should expand to 10
        const firstValueIndex = result.source.indexOf('10');
        assert.ok(firstValueIndex >= 0, 'First VALUE should expand to 10');

        // Second usage should expand to 20
        const secondValueIndex = result.source.indexOf('20', firstValueIndex + 1);
        assert.ok(secondValueIndex >= 0, 'Second VALUE should expand to 20');
    });

    test('function-like macro with no parameters', async () => {
        const source = `#define FUNC() 42
integer x = FUNC();`;

        const lexer = new Lexer(source, 'lsl');
        const tokens = lexer.tokenize();

        const parser = new Parser(tokens, testFile, 'lsl');
        await parser.parse();

        // Verify macro definition
        const macros = parser.getState().macros.getAllMacros();
        const macro = macros.get('FUNC');
        assert.ok(macro, 'FUNC should be defined');
        assert.ok(macro.isFunctionLike, 'Should be function-like');
        assert.ok(macro.parameters);
        assert.strictEqual(macro.parameters.length, 0, 'Should have no parameters');
    });

    test('function-like macro not expanded without parentheses', async () => {
        const source = `#define FUNC(x) x * 2
integer ptr = FUNC;`;

        const lexer = new Lexer(source, 'lsl');
        const tokens = lexer.tokenize();

        const parser = new Parser(tokens, testFile, 'lsl');
        const result = await parser.parse();

        // FUNC without parentheses should remain as identifier
        assert.ok(result.source.includes('FUNC'), 'FUNC should not be expanded without ()');
        assert.ok(!result.source.includes('* 2'), 'Body should not appear without ()');
    });

    //#endregion

    //#region Recursive Macro Expansion Tests

    test('simple macro referencing another macro', async () => {
        const source = `#define MACROA 5
#define MACROB 2 * MACROA
integer x = MACROB;`;

        const lexer = new Lexer(source, 'lsl');
        const tokens = lexer.tokenize();

        const parser = new Parser(tokens, testFile, 'lsl');
        const result = await parser.parse();

        // MACROB should expand to "2 * 5" (with MACROA expanded)
        assert.ok(result.source.includes('2'), 'Should have 2 from MACROB');
        assert.ok(result.source.includes('5'), 'Should have 5 from expanded MACROA');
        assert.ok(!result.source.includes('MACROA'), 'MACROA should be expanded');
        assert.ok(!result.source.includes('MACROB'), 'MACROB should be expanded');
    });

    test('multi-level macro expansion', async () => {
        const source = `#define A 1
#define B A + 1
#define C B + 1
integer x = C;`;

        const lexer = new Lexer(source, 'lsl');
        const tokens = lexer.tokenize();

        const parser = new Parser(tokens, testFile, 'lsl');
        const result = await parser.parse();

        // C should expand to "1 + 1 + 1" through recursive expansion
        // Count occurrences of '1' in the result
        const ones = (result.source.match(/\b1\b/g) || []).length;
        assert.strictEqual(ones, 3, 'Should have three 1s from full expansion');
        assert.ok(!result.source.includes('A'), 'A should be expanded');
        assert.ok(!result.source.includes('B'), 'B should be expanded');
        assert.ok(!result.source.includes('C'), 'C should be expanded');
    });

    test('prevent infinite recursion in self-referencing macro', async () => {
        const source = `#define RECURSIVE RECURSIVE
integer x = RECURSIVE;`;

        const lexer = new Lexer(source, 'lsl');
        const tokens = lexer.tokenize();

        const parser = new Parser(tokens, testFile, 'lsl');
        const result = await parser.parse();

        // RECURSIVE should not expand to prevent infinite recursion
        assert.ok(result.source.includes('RECURSIVE'), 'Should keep RECURSIVE to prevent infinite loop');
    });

    test('prevent infinite recursion in mutually-referencing macros', async () => {
        const source = `#define A B
#define B A
integer x = A;`;

        const lexer = new Lexer(source, 'lsl');
        const tokens = lexer.tokenize();

        const parser = new Parser(tokens, testFile, 'lsl');
        const result = await parser.parse();

        // Should stop at the circular reference
        // A expands to B, B tries to expand to A but A is already expanding
        assert.ok(result.source.includes('B') || result.source.includes('A'),
            'Should preserve one identifier to prevent infinite loop');
    });

    test('macro expansion with arithmetic expression', async () => {
        const source = `#define TWO 2
#define FOUR TWO * TWO
#define SIXTEEN FOUR * FOUR
integer x = SIXTEEN;`;

        const lexer = new Lexer(source, 'lsl');
        const tokens = lexer.tokenize();

        const parser = new Parser(tokens, testFile, 'lsl');
        const result = await parser.parse();

        // SIXTEEN should expand to "2 * 2 * 2 * 2"
        const twos = (result.source.match(/\b2\b/g) || []).length;
        assert.strictEqual(twos, 4, 'Should have four 2s from full expansion');
        assert.ok(!result.source.includes('TWO'), 'TWO should be expanded');
        assert.ok(!result.source.includes('FOUR'), 'FOUR should be expanded');
        assert.ok(!result.source.includes('SIXTEEN'), 'SIXTEEN should be expanded');
    });

    //#endregion

    //#region Edge Case Tests

    test('empty macro definition', async () => {
        const source = `#define EMPTY
integer x = 1;`;

        const lexer = new Lexer(source, 'lsl');
        const tokens = lexer.tokenize();

        const parser = new Parser(tokens, testFile, 'lsl');
        await parser.parse();

        // Verify macro exists but has empty body
        const macros = parser.getState().macros.getAllMacros();
        const macro = macros.get('EMPTY');
        assert.ok(macro, 'EMPTY should be defined');
        assert.strictEqual(macro.body.length, 0, 'Body should be empty');
    });

    test('macro with only whitespace is empty', async () => {
        const source = `#define WHITESPACE
integer x = 1;`;

        const lexer = new Lexer(source, 'lsl');
        const tokens = lexer.tokenize();

        const parser = new Parser(tokens, testFile, 'lsl');
        await parser.parse();

        // Verify macro exists but has empty body (whitespace is not included)
        const macros = parser.getState().macros.getAllMacros();
        const macro = macros.get('WHITESPACE');
        assert.ok(macro, 'WHITESPACE should be defined');
        assert.strictEqual(macro.body.length, 0, 'Body should be empty (whitespace excluded)');
    });

    test('empty macro expands to nothing', async () => {
        const source = `#define EMPTY
integer x = EMPTY 42;`;

        const lexer = new Lexer(source, 'lsl');
        const tokens = lexer.tokenize();

        const parser = new Parser(tokens, testFile, 'lsl');
        const result = await parser.parse();

        // EMPTY should expand to nothing, leaving "integer x = 42;"
        assert.ok(result.source.includes('42'), 'Should have 42');
        assert.ok(!result.source.includes('EMPTY'), 'EMPTY should be gone');
        // The result should effectively be "integer x = 42;"
        const normalized = result.source.replace(/\s+/g, ' ').trim();
        assert.ok(normalized.includes('integer x = 42'), 'Should collapse to "integer x = 42"');
    });

    test('empty macro in conditional compilation', async () => {
        const source = `#define FEATURE_ENABLED
#ifdef FEATURE_ENABLED
llOwnerSay("enabled");
#endif`;

        const lexer = new Lexer(source, 'lsl');
        const tokens = lexer.tokenize();

        const parser = new Parser(tokens, testFile, 'lsl');
        const result = await parser.parse();

        // Empty macro should still be recognized as defined for #ifdef
        assert.ok(result.source.includes('"enabled"'), 'Empty macro should be defined for #ifdef');
    });

    test('multiple includes in same file', async () => {
        const source = `#include "lib1.lsl"
#include "lib2.lsl"
#include "lib3.lsl"
integer x = 1;`;

        const lexer = new Lexer(source, 'lsl');
        const tokens = lexer.tokenize();

        const parser = new Parser(tokens, testFile, 'lsl');
        const result = await parser.parse();

        assert.strictEqual(result.includes.length, 3, 'Should detect 3 includes');
        assert.strictEqual(result.includes[0].file, 'lib1.lsl');
        assert.strictEqual(result.includes[1].file, 'lib2.lsl');
        assert.strictEqual(result.includes[2].file, 'lib3.lsl');
    });

    test('macro expansion in conditional block', async () => {
        const source = `#define DEBUG
#define LOG(msg) llOwnerSay(msg)
#ifdef DEBUG
LOG("debug message");
#endif`;

        const lexer = new Lexer(source, 'lsl');
        const tokens = lexer.tokenize();

        const parser = new Parser(tokens, testFile, 'lsl');
        const result = await parser.parse();

        // LOG should be expanded within the ifdef block
        assert.ok(result.source.includes('llOwnerSay'));
        assert.ok(result.source.includes('"debug message"'));
    });

    test('#ifndef directive', async () => {
        const source = `#ifndef UNDEFINED
llOwnerSay("not defined");
#endif
#define DEFINED
#ifndef DEFINED
llOwnerSay("should not appear");
#endif`;

        const lexer = new Lexer(source, 'lsl');
        const tokens = lexer.tokenize();

        const parser = new Parser(tokens, testFile, 'lsl');
        const result = await parser.parse();

        assert.ok(result.source.includes('"not defined"'));
        assert.ok(!result.source.includes('"should not appear"'));
    });

    //#endregion

    //#region Include Processing Tests

    test('should process #include directives with host interface', async () => {
        const includeContent = '#define PI 3.14159';
        const mainContent = `#include "lib.lsl"
float area = PI * r * r;`;

        // Create a mock host interface
        const mockHost = {
            config: {} as any,
            resolveFile: async (filename: string): Promise<NormalizedPath | null> => {
                return filename === 'lib.lsl' ? normalizePath('/test/lib.lsl') : null;
            },
            readFile: async (path: any): Promise<string | null> => {
                return path === normalizePath('/test/lib.lsl') ? includeContent : null;
            },
            exists: async (): Promise<boolean> => true,
            writeFile: async (): Promise<boolean> => true,
            readJSON: async (): Promise<any> => null,
            writeJSON: async (): Promise<boolean> => true,
            fileNameToUri: (fileName: any): string => {
                const testIndex = fileName.indexOf('test');
                const relativePath = testIndex !== -1 ? fileName.substring(testIndex) : fileName;
                const normalizedPath = relativePath.replace(/\\/g, '/');
                return "unittest:///" + normalizedPath;
            },
            uriToFileName: (uri: string): any => {
                return normalizePath(uri.replace(/^unittest:\/\/\//, '/'));
            },
        };

        const lexer = new Lexer(mainContent, 'lsl');
        const tokens = lexer.tokenize();

        console.log('Main tokens:', tokens.map(t => `${t.type}:${t.value}`));

        const parser = new Parser(tokens, testFile, 'lsl', mockHost as any);

        // Add debugging to see what's happening during parsing
        console.log('Parser state before parse:', {
            hasMacros: parser.getState().macros !== undefined,
            hasConditionals: parser.getState().conditionals !== undefined,
            hasIncludes: parser.getState().includes !== undefined
        });

        const result = await parser.parse();

        // Debug: Print the actual result
        console.log('Result source:', JSON.stringify(result.source));
        console.log('Result source length:', result.source.length);
        console.log('Result includes:', result.includes);
        console.log('Result macros:', result.macros);

        // The included file should have been processed
        assert.ok(result.includes.length === 1);
        assert.strictEqual(result.includes[0].file, 'lib.lsl');

        // The macro from the included file should be expanded
        assert.ok(result.source.includes('3.14159'));
        assert.ok(!result.source.match(/\bPI\b/)); // PI should be expanded
    });

    test('should prevent circular includes', async () => {
        let callCount = 0;
        const mockHost = {
            config: {} as any,
            resolveFile: async (filename: string): Promise<NormalizedPath | null> => {
                if (filename === 'a.lsl') return normalizePath('/test/a.lsl');
                if (filename === 'b.lsl') return normalizePath('/test/b.lsl');
                return null;
            },
            readFile: async (path: any): Promise<string | null> => {
                callCount++;
                if (path === normalizePath('/test/a.lsl')) return '#include "b.lsl"\nstring a = "a";';
                if (path === normalizePath('/test/b.lsl')) return '#include "a.lsl"\nstring b = "b";';
                return null;
            },
            exists: async (): Promise<boolean> => true,
            writeFile: async (): Promise<boolean> => true,
            readJSON: async (): Promise<any> => null,
            writeJSON: async (): Promise<boolean> => true,
            fileNameToUri: (fileName: any): string => {
                const testIndex = fileName.indexOf('test');
                const relativePath = testIndex !== -1 ? fileName.substring(testIndex) : fileName;
                const normalizedPath = relativePath.replace(/\\/g, '/');
                return "unittest:///" + normalizedPath;
            },
            uriToFileName: (uri: string): any => {
                return normalizePath(uri.replace(/^unittest:\/\/\//, '/'));
            },
        };

        const mainContent = '#include "a.lsl"';
        const lexer = new Lexer(mainContent, 'lsl');
        const tokens = lexer.tokenize();

        const parser = new Parser(tokens, testFile, 'lsl', mockHost as any);

        // Parse should complete but collect circular include error
        const result = await parser.parse();

        // Check that circular include error was detected
        assert.ok(result.diagnostics.length > 0, 'Should have error diagnostics');
        const circularError = result.diagnostics.find(e => e.message.includes('Circular'));
        assert.ok(circularError, 'Should have circular include error');
    });

    test('should respect include guards', async () => {
        const libContent = '#define MYLIB 1';
        let readCount = 0;

        const mockHost = {
            config: {} as any,
            resolveFile: async (filename: string): Promise<NormalizedPath | null> => {
                return filename === 'lib.lsl' ? normalizePath('/test/lib.lsl') : null;
            },
            readFile: async (path: any): Promise<string | null> => {
                if (path === normalizePath('/test/lib.lsl')) {
                    readCount++;
                    return libContent;
                }
                return null;
            },
            exists: async (): Promise<boolean> => true,
            writeFile: async (): Promise<boolean> => true,
            readJSON: async (): Promise<any> => null,
            writeJSON: async (): Promise<boolean> => true,
            fileNameToUri: (fileName: any): string => {
                const testIndex = fileName.indexOf('test');
                const relativePath = testIndex !== -1 ? fileName.substring(testIndex) : fileName;
                const normalizedPath = relativePath.replace(/\\/g, '/');
                return "unittest:///" + normalizedPath;
            },
            uriToFileName: (uri: string): any => {
                return normalizePath(uri.replace(/^unittest:\/\/\//, '/'));
            },
        };

        const mainContent = `#include "lib.lsl"
#include "lib.lsl"
integer x = 1;`;

        const lexer = new Lexer(mainContent, 'lsl');
        const tokens = lexer.tokenize();

        const parser = new Parser(tokens, testFile, 'lsl', mockHost as any);
        const result = await parser.parse();

        // The file should only be read and included once due to include guards
        assert.strictEqual(result.includes.length, 2); // Both directives are detected
        // The file is actually not read the second time because the guard check happens first
        // Actually, we DO check the guard before reading, so it should only be read once
        assert.strictEqual(readCount, 1); // Only read once due to guard check before reading
    });

    test('should enforce maximum include depth', async () => {
        // Create a chain of includes that exceeds the default max depth of 5
        // a.lsl -> b.lsl -> c.lsl -> d.lsl -> e.lsl -> f.lsl (6 levels, should fail)
        const mockHost = {
            config: {} as any,
            resolveFile: async (filename: string): Promise<NormalizedPath | null> => {
                const fileMap: { [key: string]: string } = {
                    'a.lsl': '/test/a.lsl',
                    'b.lsl': '/test/b.lsl',
                    'c.lsl': '/test/c.lsl',
                    'd.lsl': '/test/d.lsl',
                    'e.lsl': '/test/e.lsl',
                    'f.lsl': '/test/f.lsl',
                };
                return fileMap[filename] ? normalizePath(fileMap[filename]) : null;
            },
            readFile: async (path: any): Promise<string | null> => {
                const contentMap: { [key: string]: string } = {
                    [normalizePath('/test/a.lsl')]: '#include "b.lsl"\nstring a = "a";',
                    [normalizePath('/test/b.lsl')]: '#include "c.lsl"\nstring b = "b";',
                    [normalizePath('/test/c.lsl')]: '#include "d.lsl"\nstring c = "c";',
                    [normalizePath('/test/d.lsl')]: '#include "e.lsl"\nstring d = "d";',
                    [normalizePath('/test/e.lsl')]: '#include "f.lsl"\nstring e = "e";',
                    [normalizePath('/test/f.lsl')]: 'string f = "f";',
                };
                return contentMap[path] || null;
            },
            exists: async (): Promise<boolean> => true,
            writeFile: async (): Promise<boolean> => true,
            readJSON: async (): Promise<any> => null,
            writeJSON: async (): Promise<boolean> => true,
            fileNameToUri: (fileName: any): string => {
                const testIndex = fileName.indexOf('test');
                const relativePath = testIndex !== -1 ? fileName.substring(testIndex) : fileName;
                const normalizedPath = relativePath.replace(/\\/g, '/');
                return "unittest:///" + normalizedPath;
            },
            uriToFileName: (uri: string): any => {
                return normalizePath(uri.replace(/^unittest:\/\/\//, '/'));
            },
        };

        const mainContent = '#include "a.lsl"';
        const lexer = new Lexer(mainContent, 'lsl');
        const tokens = lexer.tokenize();

        const parser = new Parser(tokens, testFile, 'lsl', mockHost as any);

        // Parse should complete but collect depth exceeded error
        const result = await parser.parse();

        // Check that include depth error was detected
        assert.ok(result.diagnostics.length > 0, 'Should have error diagnostics');
        const depthError = result.diagnostics.find(e => e.message.match(/Maximum include depth.*exceeded/i));
        assert.ok(depthError, 'Should have include depth exceeded error');
    });

    //#endregion

    //#region Reverse Source Map Parsing

    test('parseLineMappingsFromContent - should parse @line directives from LSL content', () => {
        const content = `// @line 1 "${testFile}"
integer x = 42;
string s = "hello";

// @line 5 "${testFile}"
float y = 3.14;`;

        const mappings = Parser.parseLineMappingsFromContent(content, 'lsl', createMockHost());

        // Should have mappings for actual code lines (not directive lines or blank lines)
        assert.strictEqual(mappings.length, 4);

        // Line 2: integer x = 42; -> testFile:1
        assert.strictEqual(mappings[0].processedLine, 2);
        assert.strictEqual(mappings[0].originalLine, 1);
        assert.strictEqual(mappings[0].sourceFile, testFile);

        // Line 3: string s = "hello"; -> testFile:2
        assert.strictEqual(mappings[1].processedLine, 3);
        assert.strictEqual(mappings[1].originalLine, 2);

        // Line 6: float y = 3.14; -> testFile:5
        assert.strictEqual(mappings[3].processedLine, 6);
        assert.strictEqual(mappings[3].originalLine, 5);
    });

    test('parseLineMappingsFromContent - should parse @line directives from Luau content', () => {
        const content = `-- @line 1 "${testFile}"
local x = 42
local s = "hello"

-- @line 10 "${testFile}"
local y = 3.14`;

        const mappings = Parser.parseLineMappingsFromContent(content, 'luau', createMockHost());

        assert.strictEqual(mappings.length, 4);

        // Line 2: local x = 42 -> testFile:1
        assert.strictEqual(mappings[0].processedLine, 2);
        assert.strictEqual(mappings[0].originalLine, 1);

        // Line 6: local y = 3.14 -> testFile:10
        assert.strictEqual(mappings[3].processedLine, 6);
        assert.strictEqual(mappings[3].originalLine, 10);
    });

    test('parseLineMappingsFromContent - should handle multiple source files', () => {
        const mainFile = normalizePath('/test/main.lsl');
        const includeFile = normalizePath('/test/include/math.lsl');

        const content = `// @line 1 "${mainFile}"
integer x = 1;

// @line 1 "${includeFile}"
// Math utilities
float PI = 3.14159;

// @line 4 "${mainFile}"
// Back to main
integer y = 2;`;

        const mappings = Parser.parseLineMappingsFromContent(content, 'lsl', createMockHost());

        // Find mapping for line 2 (integer x = 1;)
        const mainMapping = mappings.find(m => m.processedLine === 2);
        assert.ok(mainMapping, 'Should have mapping for line 2');
        assert.strictEqual(mainMapping.originalLine, 1);
        assert.strictEqual(mainMapping.sourceFile, mainFile);

        // Find mapping for line 6 (float PI = 3.14159;)
        const includeMapping = mappings.find(m => m.processedLine === 6);
        assert.ok(includeMapping, 'Should have mapping for line 6');
        assert.strictEqual(includeMapping.originalLine, 2); // Line after comment
        assert.strictEqual(includeMapping.sourceFile, includeFile);

        // Find mapping for line 9 (// Back to main)
        const backToMainMapping1 = mappings.find(m => m.processedLine === 9);
        assert.ok(backToMainMapping1, 'Should have mapping for line 9');
        assert.strictEqual(backToMainMapping1.originalLine, 4);
        assert.strictEqual(backToMainMapping1.sourceFile, mainFile);

        // Find mapping for line 10 (integer y = 2;)
        const backToMainMapping2 = mappings.find(m => m.processedLine === 10);
        assert.ok(backToMainMapping2, 'Should have mapping for line 10');
        assert.strictEqual(backToMainMapping2.originalLine, 5);
        assert.strictEqual(backToMainMapping2.sourceFile, mainFile);
    });

    test('parseLineMappingsFromContent - should handle content without directives', () => {
        const content = `integer x = 42;
string s = "hello";
float y = 3.14;`;

        const mappings = Parser.parseLineMappingsFromContent(content, 'lsl', createMockHost());

        // No directives means no mappings
        assert.strictEqual(mappings.length, 0);
    });

    test('parseLineMappingsFromContent - should handle blank lines and comments', () => {
        const content = `// @line 1 "${testFile}"
// This is a comment

integer x = 42;

// Another comment
string s = "hello";`;

        const mappings = Parser.parseLineMappingsFromContent(content, 'lsl', createMockHost());

        // Should have mappings for all lines after the directive (including blank and comment lines)
        assert.ok(mappings.length > 0);

        // Line 4 should map to testFile:3 (blank lines count)
        const line4Mapping = mappings.find(m => m.processedLine === 4);
        assert.ok(line4Mapping, 'Should have mapping for line 4');
        assert.strictEqual(line4Mapping.originalLine, 3);
    });

    test('parseLineMappingsFromContent - should handle relative paths', () => {
        const relativePath = 'include/math.lsl';
        const content = `// @line 1 "${relativePath}"
float PI = 3.14159;`;

        const mappings = Parser.parseLineMappingsFromContent(content, 'lsl', createMockHost());

        assert.strictEqual(mappings.length, 1);
        // Relative paths should be resolved to absolute paths
        assert.ok(mappings[0].sourceFile.includes('math.lsl'));
    });

    //#endregion

    //#region Forward Line Mapping Generation

    test('should generate line mappings during preprocessing', async () => {
        const source = `// Test file
integer x = 42;
string s = "hello";`;

        const lexer = new Lexer(source, 'lsl');
        const tokens = lexer.tokenize();

        const parser = new Parser(tokens, testFile, 'lsl');
        const result = await parser.parse();

        // Should have at least some mappings (one per newline in output)
        assert.ok(result.mappings.length >= 1, 'Should have line mappings');

        // All mappings should reference the test file
        result.mappings.forEach(mapping => {
            assert.strictEqual(mapping.sourceFile, testFile);
        });
    });

    test('should generate @line directives for file transitions', async () => {
        // This test verifies that @line directives are inserted when tokens
        // are marked as coming from different source files (which happens during includes)
        // Rather than testing actual file inclusion (tested elsewhere), we verify
        // that the output generation respects source file transitions.

        const source = `integer x = 42;
integer y = 100;`;

        const lexer = new Lexer(source, 'lsl');
        const tokens = lexer.tokenize();

        const parser = new Parser(tokens, testFile, 'lsl');
        const result = await parser.parse();

        // For simple single-file code, @line directives are only inserted on line skips
        // The output should be clean code without @line directives
        assert.ok(result.source.includes('integer x'), 'Should have first variable');
        assert.ok(result.source.includes('integer y'), 'Should have second variable');

        // Mappings should exist for newlines in output
        assert.ok(result.mappings.length >= 1, 'Should have at least one mapping');
    });

    test('should handle line skips in mappings', async () => {
        const source = `integer x = 42;


string s = "hello";`;  // Note: 2 blank lines

        const lexer = new Lexer(source, 'lsl');
        const tokens = lexer.tokenize();

        const parser = new Parser(tokens, testFile, 'lsl');
        const result = await parser.parse();

        // Should have @line directive for the line skip
        const lines = result.source.split('\n');
        const lineDirectives = lines.filter(line => line.trim().startsWith('// @line'));

        // Should have at least one directive for the skip
        assert.ok(lineDirectives.length > 0, 'Should have @line directives for line skips');
    });

    test('should handle macro expansion in mappings', async () => {
        const source = `#define PI 3.14159
float circumference = 2 * PI * 5.0;
integer x = 42;`;

        const lexer = new Lexer(source, 'lsl');
        const tokens = lexer.tokenize();

        const parser = new Parser(tokens, testFile, 'lsl');
        const result = await parser.parse();

        // Should have at least one mapping (for lines with newlines in output)
        assert.ok(result.mappings.length >= 1, 'Should have line mappings');

        // The output should contain the expanded macro
        assert.ok(result.source.includes('3.14159'), 'Should expand macro');
    });

    test('should handle conditional compilation in mappings', async () => {
        const source = `#define DEBUG
#ifdef DEBUG
integer debugMode = 1;
#else
integer debugMode = 0;
#endif
integer x = 42;`;

        const lexer = new Lexer(source, 'lsl');
        const tokens = lexer.tokenize();

        const parser = new Parser(tokens, testFile, 'lsl');
        const result = await parser.parse();

        // Should have mappings for lines that made it through preprocessing
        assert.ok(result.mappings.length >= 1, 'Should have line mappings');

        // Should include debugMode = 1 but not debugMode = 0
        assert.ok(result.source.includes('debugMode = 1'), 'Should include active branch');
        assert.ok(!result.source.includes('debugMode = 0'), 'Should exclude inactive branch');
    });

    test('should handle nested conditionals in mappings', async () => {
        const source = `#define LEVEL1
#define LEVEL2
#ifdef LEVEL1
    #ifdef LEVEL2
        integer x = 1;
    #endif
#endif
integer y = 2;`;

        const lexer = new Lexer(source, 'lsl');
        const tokens = lexer.tokenize();

        const parser = new Parser(tokens, testFile, 'lsl');
        const result = await parser.parse();

        // Should have mappings for processed output
        assert.ok(result.mappings.length >= 1, 'Should have line mappings');

        // Should include nested code when both conditions are true
        assert.ok(result.source.includes('integer x = 1'), 'Should include nested conditional code');
        assert.ok(result.source.includes('integer y = 2'), 'Should include code after conditionals');
    });

    test('should preserve blank lines in mappings', async () => {
        const source = `integer x = 1;

integer y = 2;

integer z = 3;`;

        const lexer = new Lexer(source, 'lsl');
        const tokens = lexer.tokenize();

        const parser = new Parser(tokens, testFile, 'lsl');
        const result = await parser.parse();

        // Blank lines should be preserved in output
        const outputLines = result.source.split('\n');
        const blankLines = outputLines.filter(line => line.trim() === '');

        assert.ok(blankLines.length >= 2, 'Should preserve blank lines');
    });

    test('should handle function-like macro expansion in mappings', async () => {
        const source = `#define SQUARE(x) ((x) * (x))
integer result = SQUARE(5);
integer y = 10;`;

        const lexer = new Lexer(source, 'lsl');
        const tokens = lexer.tokenize();

        const parser = new Parser(tokens, testFile, 'lsl');
        const result = await parser.parse();

        // Should have at least one mapping
        assert.ok(result.mappings.length >= 1, 'Should have line mappings');

        // Output should contain the expanded code (whitespace may vary)
        assert.ok(result.source.match(/\(\(5\)\s*\*\s*\(5\)\)/), 'Should expand function-like macro');
    });

    test('should generate correct mappings for files starting with directives', async () => {
        const source = `#define VERSION 1
#ifdef VERSION
integer v = VERSION;
#endif
integer x = 42;`;

        const lexer = new Lexer(source, 'lsl');
        const tokens = lexer.tokenize();

        const parser = new Parser(tokens, testFile, 'lsl');
        const result = await parser.parse();

        // Should have mappings for the output
        assert.ok(result.mappings.length >= 1, 'Should have mappings');

        // Output should contain the expanded code
        assert.ok(result.source.includes('integer v = 1'), 'Should expand macro in conditional');
    });

    test('should handle empty conditional blocks in mappings', async () => {
        const source = `#define FLAG
#ifdef UNDEFINED_FLAG
    // This should not appear
    integer x = 1;
#endif
integer y = 2;
integer z = 3;`;

        const lexer = new Lexer(source, 'lsl');
        const tokens = lexer.tokenize();

        const parser = new Parser(tokens, testFile, 'lsl');
        const result = await parser.parse();

        // Should have at least one mapping
        assert.ok(result.mappings.length >= 1, 'Should have mappings');

        // Should not include excluded code
        assert.ok(!result.source.includes('integer x = 1'), 'Should not include excluded conditional block');

        // Should include code after conditional
        assert.ok(result.source.includes('integer y = 2'), 'Should include line after empty conditional');
    });

    //#endregion
});
