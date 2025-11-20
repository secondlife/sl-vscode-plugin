/**
 * @file lexingpreprocessor.test.ts
 * Tests for the lexing-based preprocessor
 * Copyright (C) 2025, Linden Research, Inc.
 */

import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import {
    Lexer,
    TokenType,
    LanguageLexerConfig,
} from "../../shared/lexer";
import { LexingPreprocessor, PreprocessorOptions } from "../../shared/lexingpreprocessor";
import { normalizePath, HostInterface, NormalizedPath } from "../../interfaces/hostinterface";
import { FullConfigInterface, ConfigKey } from "../../interfaces/configinterface";

/**
 * Mock configuration class for testing
 */
class MockConfig implements FullConfigInterface {
    private configValues: Map<ConfigKey, any> = new Map();

    constructor(optionsOrMap?: PreprocessorOptions | Map<ConfigKey, any>) {
        if (optionsOrMap) {
            if (optionsOrMap instanceof Map) {
                this.configValues = new Map(optionsOrMap);
            } else {
                // Set individual config keys instead of PreprocessorOptions object
                this.configValues.set(ConfigKey.PreprocessorEnable, optionsOrMap.enable);
                this.configValues.set(ConfigKey.PreprocessorIncludePaths, optionsOrMap.includePaths ?? ['.']);
                this.configValues.set(ConfigKey.PreprocessorMaxIncludeDepth, optionsOrMap.maxIncludeDepth ?? 5);
            }
        }
    }

    isEnabled(): boolean {
        return true;
    }

    getConfig<T>(key: ConfigKey): T | undefined {
        return this.configValues.get(key) as T | undefined;
    }

    async setConfig<T>(key: ConfigKey, value: T, scope?: any): Promise<void> {
        this.configValues.set(key, value);
    }

    async getWorkspaceConfigPath(): Promise<NormalizedPath> {
        return normalizePath("");
    }

    async getGlobalConfigPath(): Promise<NormalizedPath> {
        return normalizePath("");
    }

    async getExtensionInstallPath(): Promise<NormalizedPath> {
        return normalizePath("");
    }

    getSessionValue<T>(key: ConfigKey): T | undefined {
        return undefined;
    }

    setSessionValue<T>(key: ConfigKey, value: T): void {
        // No-op for tests
    }

    useLocalConfig(): boolean {
        return false;
    }
}

suite("Lexing Preprocessor Test Suite", () => {

    /**
     * Helper to create a mock HostInterface for testing
     */
    function createMockHost(options?: PreprocessorOptions): HostInterface {
        // Use provided options or default ones
        const preprocessorOptions = options || createDefaultOptions();

        return new class implements HostInterface {
            config: FullConfigInterface = new MockConfig(preprocessorOptions);

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

    /**
     * Helper to create a mock host with custom file system implementation
     */
    function createMockHostWithFS(
        options: PreprocessorOptions | undefined,
        readFileFn: (path: NormalizedPath) => Promise<string | null>,
        existsFn?: (path: NormalizedPath) => Promise<boolean>,
        resolveFileFn?: (filename: string, from: NormalizedPath, extensions?: string[], includePaths?: string[]) => Promise<NormalizedPath | null>
    ): HostInterface {
        const opts = options || createDefaultOptions();

        return new class implements HostInterface {
            config: FullConfigInterface = new MockConfig(opts);

            async readFile(path: NormalizedPath): Promise<string | null> {
                return readFileFn(path);
            }
            async exists(path: NormalizedPath): Promise<boolean> {
                return existsFn ? existsFn(path) : false;
            }
            async resolveFile(
                filename: string,
                from: NormalizedPath,
                extensions?: string[],
                includePaths?: string[]
            ): Promise<NormalizedPath | null> {
                return resolveFileFn ? resolveFileFn(filename, from, extensions, includePaths) : null;
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

    /**
     * Helper to create default preprocessor options for testing
     */
    function createDefaultOptions(): PreprocessorOptions {
        return {
            enable: true,
            flags: {
                generateWarnings: true,
                generateDecls: true,
            },
            includePaths: ["."],
            maxIncludeDepth: 5,
        };
    }

    /**
     * Helper to normalize output for comparison
     * Removes trailing spaces and collapses multiple blank lines
     */
    function normalizeOutput(text: string): string {
        return text
            .split('\n')
            .map(line => line.trimEnd())  // Remove trailing spaces
            .join('\n')
            .replace(/\n{3,}/g, '\n\n');  // Collapse multiple blank lines to max 2
    }

    suite("Lexer", () => {

        test("should tokenize simple LSL code", () => {
            const source = `integer x = 42;`;
            const lexer = new Lexer(source, "lsl");
            const tokens = lexer.tokenize();

            assert.strictEqual(tokens.length, 9); // integer, space, x, space, =, space, 42, ;, EOF
            assert.strictEqual(tokens[0].type, TokenType.IDENTIFIER);
            assert.strictEqual(tokens[0].value, "integer");
            assert.strictEqual(tokens[2].type, TokenType.IDENTIFIER);
            assert.strictEqual(tokens[2].value, "x");
            assert.strictEqual(tokens[4].type, TokenType.OPERATOR);
            assert.strictEqual(tokens[4].value, "=");
        });

        test("should recognize LSL line comments", () => {
            const source = `// This is a comment\ninteger x;`;
            const lexer = new Lexer(source, "lsl");
            const tokens = lexer.tokenize();

            assert.strictEqual(tokens[0].type, TokenType.LINE_COMMENT);
            assert.strictEqual(tokens[0].value, "// This is a comment");
            assert.strictEqual(tokens[1].type, TokenType.NEWLINE);
        });

        test("should recognize SLua line comments", () => {
            const source = `-- This is a comment\nlocal x = 5`;
            const lexer = new Lexer(source, "luau");
            const tokens = lexer.tokenize();

            assert.strictEqual(tokens[0].type, TokenType.LINE_COMMENT);
            assert.strictEqual(tokens[0].value, "-- This is a comment");
            assert.strictEqual(tokens[1].type, TokenType.NEWLINE);
        });

        test("should tokenize block comments", () => {
            const source = `/* Block comment */\ninteger x;`;
            const lexer = new Lexer(source, "lsl");
            const tokens = lexer.tokenize();

            assert.strictEqual(tokens[0].type, TokenType.BLOCK_COMMENT_START);
            assert.strictEqual(tokens[0].value, "/*");
            assert.strictEqual(tokens[1].type, TokenType.BLOCK_COMMENT_CONTENT);
            assert.strictEqual(tokens[1].value, " Block comment ");
            assert.strictEqual(tokens[2].type, TokenType.BLOCK_COMMENT_END);
            assert.strictEqual(tokens[2].value, "*/");
        });

        test("should tokenize multi-line block comments", () => {
            const source = `/* Line 1\nLine 2\nLine 3 */`;
            const lexer = new Lexer(source, "lsl");
            const tokens = lexer.tokenize();

            assert.strictEqual(tokens[0].type, TokenType.BLOCK_COMMENT_START);
            assert.strictEqual(tokens[1].type, TokenType.BLOCK_COMMENT_CONTENT);
            assert.ok(tokens[1].value.includes("Line 1"));
            assert.ok(tokens[1].value.includes("Line 2"));
            assert.ok(tokens[1].value.includes("Line 3"));
            assert.strictEqual(tokens[2].type, TokenType.BLOCK_COMMENT_END);
        });

        test("should tokenize Lua long bracket comments with equals", () => {
            // Test --[=[ ... ]=]
            const source1 = `--[=[\nThis is a comment with ]] inside\n]=]`;
            const lexer1 = new Lexer(source1, "luau");
            const tokens1 = lexer1.tokenize();

            assert.strictEqual(tokens1[0].type, TokenType.BLOCK_COMMENT_START);
            assert.strictEqual(tokens1[0].value, "--[=[");
            assert.strictEqual(tokens1[1].type, TokenType.BLOCK_COMMENT_CONTENT);
            assert.ok(tokens1[1].value.includes("]] inside"));
            assert.strictEqual(tokens1[2].type, TokenType.BLOCK_COMMENT_END);
            assert.strictEqual(tokens1[2].value, "]=]");

            // Test --[==[ ... ]==]
            const source2 = `--[==[\nDouble equals level\n]==]`;
            const lexer2 = new Lexer(source2, "luau");
            const tokens2 = lexer2.tokenize();

            assert.strictEqual(tokens2[0].type, TokenType.BLOCK_COMMENT_START);
            assert.strictEqual(tokens2[0].value, "--[==[");
            assert.strictEqual(tokens2[2].type, TokenType.BLOCK_COMMENT_END);
            assert.strictEqual(tokens2[2].value, "]==]");

            // Test that ]] doesn't close [=[ ... ]=]
            const source3 = `--[=[\nHas ]] in middle\n]=]`;
            const lexer3 = new Lexer(source3, "luau");
            const tokens3 = lexer3.tokenize();

            // Should have exactly one block comment content token with ]] inside
            const contentTokens = tokens3.filter(t => t.type === TokenType.BLOCK_COMMENT_CONTENT);
            assert.strictEqual(contentTokens.length, 1);
            assert.ok(contentTokens[0].value.includes("]] in middle"));
        });

        test("should tokenize string literals with escapes", () => {
            const source = `"Hello \\"World\\""`;
            const lexer = new Lexer(source, "lsl");
            const tokens = lexer.tokenize();

            assert.strictEqual(tokens[0].type, TokenType.STRING_LITERAL);
            assert.strictEqual(tokens[0].value, `"Hello \\"World\\""`);
        });

        test("should support configured string delimiters", () => {
            // Test LSL with both double and single quotes
            const lslSource = `"double" 'single'`;
            const lslLexer = new Lexer(lslSource, "lsl");
            const lslTokens = lslLexer.tokenize();

            const lslStrings = lslTokens.filter(t => t.type === TokenType.STRING_LITERAL);
            assert.strictEqual(lslStrings.length, 2);
            assert.strictEqual(lslStrings[0].value, `"double"`);
            assert.strictEqual(lslStrings[1].value, `'single'`);

            // Test Luau with double, single, and backticks
            const luauSource = `"double" 'single' \`backtick\``;
            const luauLexer = new Lexer(luauSource, "luau");
            const luauTokens = luauLexer.tokenize();

            const luauStrings = luauTokens.filter(t => t.type === TokenType.STRING_LITERAL);
            assert.strictEqual(luauStrings.length, 3);
            assert.strictEqual(luauStrings[0].value, `"double"`);
            assert.strictEqual(luauStrings[1].value, `'single'`);
            assert.strictEqual(luauStrings[2].value, `\`backtick\``);
        });

        test("should handle embedded quotes in strings", () => {
            // Test single quotes inside double-quoted strings
            const source1 = `"This is a 'string'"`;
            const lexer1 = new Lexer(source1, "lsl");
            const tokens1 = lexer1.tokenize();

            const strings1 = tokens1.filter(t => t.type === TokenType.STRING_LITERAL);
            assert.strictEqual(strings1.length, 1);
            assert.strictEqual(strings1[0].value, `"This is a 'string'"`);

            // Test double quotes inside single-quoted strings
            const source2 = `'embedded "double" quote'`;
            const lexer2 = new Lexer(source2, "lsl");
            const tokens2 = lexer2.tokenize();

            const strings2 = tokens2.filter(t => t.type === TokenType.STRING_LITERAL);
            assert.strictEqual(strings2.length, 1);
            assert.strictEqual(strings2[0].value, `'embedded "double" quote'`);

            // Test mixed quotes in Luau with backticks
            const source3 = `\`can contain "double" and 'single' quotes\``;
            const lexer3 = new Lexer(source3, "luau");
            const tokens3 = lexer3.tokenize();

            const strings3 = tokens3.filter(t => t.type === TokenType.STRING_LITERAL);
            assert.strictEqual(strings3.length, 1);
            assert.strictEqual(strings3[0].value, `\`can contain "double" and 'single' quotes\``);

            // Test multiple strings with different delimiters
            const source4 = `"first 'has' single" 'second "has" double'`;
            const lexer4 = new Lexer(source4, "lsl");
            const tokens4 = lexer4.tokenize();

            const strings4 = tokens4.filter(t => t.type === TokenType.STRING_LITERAL);
            assert.strictEqual(strings4.length, 2);
            assert.strictEqual(strings4[0].value, `"first 'has' single"`);
            assert.strictEqual(strings4[1].value, `'second "has" double'`);
        });

        test("should recognize LSL preprocessor directives", () => {
            const source = `#include "test.lsl"`;
            const lexer = new Lexer(source, "lsl");
            const tokens = lexer.tokenize();

            assert.strictEqual(tokens[0].type, TokenType.DIRECTIVE);
            assert.strictEqual(tokens[0].value, "#include");
        });

        test("should recognize SLua require directive", () => {
            const source = `require("test.luau")`;
            const lexer = new Lexer(source, "luau");
            const tokens = lexer.tokenize();

            assert.strictEqual(tokens[0].type, TokenType.DIRECTIVE);
            assert.strictEqual(tokens[0].value, "require");
        });

        test("should tokenize numbers", () => {
            const source = `42 3.14 1.5e-10`;
            const lexer = new Lexer(source, "lsl");
            const tokens = lexer.tokenize();

            const numberTokens = tokens.filter(t => t.type === TokenType.NUMBER_LITERAL);
            assert.strictEqual(numberTokens.length, 3);
            assert.strictEqual(numberTokens[0].value, "42");
            assert.strictEqual(numberTokens[1].value, "3.14");
            assert.strictEqual(numberTokens[2].value, "1.5e-10");
        });

        test("should tokenize multi-character operators", () => {
            // Test comparison operators
            const source1 = `if (x == y && a != b)`;
            const lexer1 = new Lexer(source1, "lsl");
            const tokens1 = lexer1.tokenize();

            const operators1 = tokens1.filter(t => t.type === TokenType.OPERATOR);
            assert.ok(operators1.some(t => t.value === "=="));
            assert.ok(operators1.some(t => t.value === "&&"));
            assert.ok(operators1.some(t => t.value === "!="));

            // Test assignment operators
            const source2 = `x += 5; y -= 2;`;
            const lexer2 = new Lexer(source2, "lsl");
            const tokens2 = lexer2.tokenize();

            const operators2 = tokens2.filter(t => t.type === TokenType.OPERATOR);
            assert.ok(operators2.some(t => t.value === "+="));
            assert.ok(operators2.some(t => t.value === "-="));

            // Test bitwise operators
            const source3 = `a << 3 >> 1`;
            const lexer3 = new Lexer(source3, "lsl");
            const tokens3 = lexer3.tokenize();

            const operators3 = tokens3.filter(t => t.type === TokenType.OPERATOR);
            assert.ok(operators3.some(t => t.value === "<<"));
            assert.ok(operators3.some(t => t.value === ">>"));

            // Test Lua-specific operators
            const source4 = `if x ~= y then local s = a .. b end`;
            const lexer4 = new Lexer(source4, "luau");
            const tokens4 = lexer4.tokenize();

            const operators4 = tokens4.filter(t => t.type === TokenType.OPERATOR);
            assert.ok(operators4.some(t => t.value === "~="));
            assert.ok(operators4.some(t => t.value === ".."));

            // Test that single-character operators still work
            const source5 = `x + y - z * 2 / 3`;
            const lexer5 = new Lexer(source5, "lsl");
            const tokens5 = lexer5.tokenize();

            const operators5 = tokens5.filter(t => t.type === TokenType.OPERATOR);
            assert.ok(operators5.some(t => t.value === "+"));
            assert.ok(operators5.some(t => t.value === "-"));
            assert.ok(operators5.some(t => t.value === "*"));
            assert.ok(operators5.some(t => t.value === "/"));
        });

        test("should tokenize LSL vector and rotation literals", () => {
            // Test 3-component vector
            const source1 = `vector pos = <1.0, 2.5, -3.0>;`;
            const lexer1 = new Lexer(source1, "lsl");
            const tokens1 = lexer1.tokenize();

            const vectors1 = tokens1.filter(t => t.type === TokenType.VECTOR_LITERAL);
            assert.strictEqual(vectors1.length, 1);
            assert.strictEqual(vectors1[0].value, "<1.0, 2.5, -3.0>");

            // Test 4-component rotation
            const source2 = `rotation rot = <0.0, 0.0, 0.707, 0.707>;`;
            const lexer2 = new Lexer(source2, "lsl");
            const tokens2 = lexer2.tokenize();

            const vectors2 = tokens2.filter(t => t.type === TokenType.VECTOR_LITERAL);
            assert.strictEqual(vectors2.length, 1);
            assert.strictEqual(vectors2[0].value, "<0.0, 0.0, 0.707, 0.707>");

            // Test vector with no spaces
            const source3 = `<1,2,3>`;
            const lexer3 = new Lexer(source3, "lsl");
            const tokens3 = lexer3.tokenize();

            const vectors3 = tokens3.filter(t => t.type === TokenType.VECTOR_LITERAL);
            assert.strictEqual(vectors3.length, 1);
            assert.strictEqual(vectors3[0].value, "<1,2,3>");

            // Test that < is still an operator in non-vector context
            const source4 = `if (x < 5)`;
            const lexer4 = new Lexer(source4, "lsl");
            const tokens4 = lexer4.tokenize();

            const operators = tokens4.filter(t => t.type === TokenType.OPERATOR && t.value === "<");
            assert.strictEqual(operators.length, 1);

            // Test vector with whitespace variations
            const source5 = `<  1.5 ,  2.5  , 3.5  >`;
            const lexer5 = new Lexer(source5, "lsl");
            const tokens5 = lexer5.tokenize();

            const vectors5 = tokens5.filter(t => t.type === TokenType.VECTOR_LITERAL);
            assert.strictEqual(vectors5.length, 1);
            assert.ok(vectors5[0].value.includes("1.5"));

            // Test that Luau doesn't recognize vectors
            const source6 = `<1, 2, 3>`;
            const lexer6 = new Lexer(source6, "luau");
            const tokens6 = lexer6.tokenize();

            const vectors6 = tokens6.filter(t => t.type === TokenType.VECTOR_LITERAL);
            assert.strictEqual(vectors6.length, 0);

            // Should have < and > as separate operators in Luau
            const luauOps = tokens6.filter(t => t.type === TokenType.OPERATOR && (t.value === "<" || t.value === ">"));
            assert.strictEqual(luauOps.length, 2);

            // Test vectors with identifiers (variables)
            const source7 = `vector pos = <x, y, z>;`;
            const lexer7 = new Lexer(source7, "lsl");
            const tokens7 = lexer7.tokenize();

            const vectors7 = tokens7.filter(t => t.type === TokenType.VECTOR_LITERAL);
            assert.strictEqual(vectors7.length, 1);
            assert.strictEqual(vectors7[0].value, "<x, y, z>");

            // Test mixed literals and identifiers
            const source8 = `<1.0, height, 3.0>`;
            const lexer8 = new Lexer(source8, "lsl");
            const tokens8 = lexer8.tokenize();

            const vectors8 = tokens8.filter(t => t.type === TokenType.VECTOR_LITERAL);
            assert.strictEqual(vectors8.length, 1);
            assert.strictEqual(vectors8[0].value, "<1.0, height, 3.0>");

            // Test rotation with variables
            const source9 = `rotation rot = <0, 0, angle, 1>;`;
            const lexer9 = new Lexer(source9, "lsl");
            const tokens9 = lexer9.tokenize();

            const vectors9 = tokens9.filter(t => t.type === TokenType.VECTOR_LITERAL);
            assert.strictEqual(vectors9.length, 1);
            assert.strictEqual(vectors9[0].value, "<0, 0, angle, 1>");
        });

        test("should tokenize brackets as distinct types", () => {
            const source = `{ ( [ ] ) }`;
            const lexer = new Lexer(source, "lsl");
            const tokens = lexer.tokenize();

            const brackets = tokens.filter(t =>
                t.type === TokenType.BRACE_OPEN ||
                t.type === TokenType.BRACE_CLOSE ||
                t.type === TokenType.PAREN_OPEN ||
                t.type === TokenType.PAREN_CLOSE ||
                t.type === TokenType.BRACKET_OPEN ||
                t.type === TokenType.BRACKET_CLOSE
            );

            assert.strictEqual(brackets.length, 6);
            assert.strictEqual(brackets[0].type, TokenType.BRACE_OPEN);
            assert.strictEqual(brackets[0].value, "{");
            assert.strictEqual(brackets[1].type, TokenType.PAREN_OPEN);
            assert.strictEqual(brackets[1].value, "(");
            assert.strictEqual(brackets[2].type, TokenType.BRACKET_OPEN);
            assert.strictEqual(brackets[2].value, "[");
            assert.strictEqual(brackets[3].type, TokenType.BRACKET_CLOSE);
            assert.strictEqual(brackets[3].value, "]");
            assert.strictEqual(brackets[4].type, TokenType.PAREN_CLOSE);
            assert.strictEqual(brackets[4].value, ")");
            assert.strictEqual(brackets[5].type, TokenType.BRACE_CLOSE);
            assert.strictEqual(brackets[5].value, "}");
        });

        test("should preserve line and column information", () => {
            const source = `integer x;\nfloat y;`;
            const lexer = new Lexer(source, "lsl");
            const tokens = lexer.tokenize();

            // First line tokens
            assert.strictEqual(tokens[0].line, 1);
            assert.strictEqual(tokens[0].column, 1);

            // Find first token on line 2
            const line2Token = tokens.find(t => t.line === 2);
            assert.ok(line2Token);
            assert.strictEqual(line2Token.value, "float");
        });

        test("should handle empty input", () => {
            const source = ``;
            const lexer = new Lexer(source, "lsl");
            const tokens = lexer.tokenize();

            assert.strictEqual(tokens.length, 1); // Just EOF
            assert.strictEqual(tokens[0].type, TokenType.EOF);
        });

        test("should handle whitespace-only input", () => {
            const source = `   \t  \n  `;
            const lexer = new Lexer(source, "lsl");
            const tokens = lexer.tokenize();

            const nonEofTokens = tokens.filter(t => t.type !== TokenType.EOF);
            assert.ok(nonEofTokens.every(t =>
                t.type === TokenType.WHITESPACE || t.type === TokenType.NEWLINE
            ));
        });

        test("should accept custom language configuration", () => {
            // Create a custom language config with Python-style comments
            const customConfig: LanguageLexerConfig = {
                lineCommentPrefix: "#",
                blockCommentStart: "'''",
                blockCommentEnd: "'''",
                logicalOperators: {
                    and: "&&",
                    or: "||",
                    not: "!",
                },
                directivePrefix: "@",
                directiveKeywords: ["import"],
            };

            const source = `# This is a comment\n@directive\nimport module`;
            const lexer = new Lexer(source, customConfig);
            const tokens = lexer.tokenize();

            // Find the comment token
            const commentToken = tokens.find(t => t.type === TokenType.LINE_COMMENT);
            assert.ok(commentToken);
            assert.strictEqual(commentToken.value, "# This is a comment");

            // Find directive tokens
            const directiveToken = tokens.find(t => t.type === TokenType.DIRECTIVE);
            assert.ok(directiveToken);
        });

        test("should support custom multi-character operators in configuration", () => {
            // Create a custom language config with unique operators
            const customConfig: LanguageLexerConfig = {
                lineCommentPrefix: "//",
                blockCommentStart: "/*",
                blockCommentEnd: "*/",
                logicalOperators: {
                    and: "&&",
                    or: "||",
                    not: "!",
                },
                directivePrefix: "#",
                directiveKeywords: [],
                operators: ["=>", "**", "??", "<>", ";"],
            };

            const source = `x => y; a ** b; c ?? d; e <> f`;
            const lexer = new Lexer(source, customConfig);
            const tokens = lexer.tokenize();

            const operators = tokens.filter(t => t.type === TokenType.OPERATOR);

            // Should find our custom multi-char operators
            assert.ok(operators.some(t => t.value === "=>"), "Expected to find => operator");
            assert.ok(operators.some(t => t.value === "**"), "Expected to find ** operator");
            assert.ok(operators.some(t => t.value === "??"), "Expected to find ?? operator");
            assert.ok(operators.some(t => t.value === "<>"), "Expected to find <> operator");
        });

        test("should support custom bracket configuration", () => {
            // Create a custom language config with standard brackets
            const customConfig: LanguageLexerConfig = {
                lineCommentPrefix: "//",
                blockCommentStart: "/*",
                blockCommentEnd: "*/",
                logicalOperators: {
                    and: "&&",
                    or: "||",
                    not: "!",
                },
                directivePrefix: "#",
                directiveKeywords: [],
                operators: ["+", "-", ";"],
                brackets: [
                    ["{", "}"],
                    ["(", ")"],
                ],
            };

            const source = `{ ( test ) }`;
            const lexer = new Lexer(source, customConfig);
            const tokens = lexer.tokenize();

            const brackets = tokens.filter(t =>
                t.type === TokenType.BRACE_OPEN ||
                t.type === TokenType.BRACE_CLOSE ||
                t.type === TokenType.PAREN_OPEN ||
                t.type === TokenType.PAREN_CLOSE
            );

            assert.strictEqual(brackets.length, 4);
            assert.strictEqual(brackets[0].type, TokenType.BRACE_OPEN);
            assert.strictEqual(brackets[1].type, TokenType.PAREN_OPEN);
            assert.strictEqual(brackets[2].type, TokenType.PAREN_CLOSE);
            assert.strictEqual(brackets[3].type, TokenType.BRACE_CLOSE);
        });

        test("should reconstruct simple source from tokens", () => {
            const source = `integer x = 42;`;
            const lexer = new Lexer(source, "lsl");
            const tokens = lexer.tokenize();

            // Reconstruct using Token.emit() method
            const reconstructed = tokens
                .filter(t => t.type !== TokenType.EOF)
                .map(t => t.emit())
                .join("");

            assert.strictEqual(reconstructed, source);
        });

        test("should reconstruct source with whitespace", () => {
            const source = `integer  x\t=  42;\n`;
            const lexer = new Lexer(source, "lsl");
            const tokens = lexer.tokenize();

            const reconstructed = tokens
                .filter(t => t.type !== TokenType.EOF)
                .map(t => t.emit())
                .join("");

            assert.strictEqual(reconstructed, source);
        });

        test("should reconstruct source with comments", () => {
            const source = `// Line comment\ninteger x; // end comment\n/* block */`;
            const lexer = new Lexer(source, "lsl");
            const tokens = lexer.tokenize();

            const reconstructed = tokens
                .filter(t => t.type !== TokenType.EOF)
                .map(t => t.emit())
                .join("");

            assert.strictEqual(reconstructed, source);
        });

        test("should reconstruct source with strings", () => {
            const source = `string msg = "Hello 'world'";`;
            const lexer = new Lexer(source, "lsl");
            const tokens = lexer.tokenize();

            const reconstructed = tokens
                .filter(t => t.type !== TokenType.EOF)
                .map(t => t.emit())
                .join("");

            assert.strictEqual(reconstructed, source);
        });

        test("should reconstruct source with multi-character operators", () => {
            const source = `if (x == y && a != b || c >= d) { x += 5; }`;
            const lexer = new Lexer(source, "lsl");
            const tokens = lexer.tokenize();

            const reconstructed = tokens
                .filter(t => t.type !== TokenType.EOF)
                .map(t => t.emit())
                .join("");

            assert.strictEqual(reconstructed, source);
        });

        test("should reconstruct source with vector literals", () => {
            const source = `vector pos = <1.0, 2.5, 3.0>;`;
            const lexer = new Lexer(source, "lsl");
            const tokens = lexer.tokenize();

            const reconstructed = tokens
                .filter(t => t.type !== TokenType.EOF)
                .map(t => t.emit())
                .join("");

            assert.strictEqual(reconstructed, source);
        });

        test("should reconstruct source with Luau long bracket comments", () => {
            const source = `--[=[ Multi-line\ncomment ]=] x = 5`;
            const lexer = new Lexer(source, "luau");
            const tokens = lexer.tokenize();

            const reconstructed = tokens
                .filter(t => t.type !== TokenType.EOF)
                .map(t => t.emit())
                .join("");

            assert.strictEqual(reconstructed, source);
        });

        test("should reconstruct complex multi-line source", () => {
            const source = `default
{
    state_entry()
    {
        // Initialize
        vector pos = <0.0, 0.0, 0.5>;
        llSetPos(pos);
        /* Multi-line
           comment block */
        string msg = "Hello";
    }
}`;
            const lexer = new Lexer(source, "lsl");
            const tokens = lexer.tokenize();

            const reconstructed = tokens
                .filter(t => t.type !== TokenType.EOF)
                .map(t => t.emit())
                .join("");

            assert.strictEqual(reconstructed, source);
        });

        test("should reconstruct source with all bracket types", () => {
            const source = `list items = [1, 2, 3]; vector v = <1,2,3>; func(a, b);`;
            const lexer = new Lexer(source, "lsl");
            const tokens = lexer.tokenize();

            const reconstructed = tokens
                .filter(t => t.type !== TokenType.EOF)
                .map(t => t.emit())
                .join("");

            assert.strictEqual(reconstructed, source);
        });

        test("should reconstruct Luau source with all string delimiters", () => {
            const source = `local s1 = "double"; local s2 = 'single'; local s3 = \`backtick\`;`;
            const lexer = new Lexer(source, "luau");
            const tokens = lexer.tokenize();

            const reconstructed = tokens
                .filter(t => t.type !== TokenType.EOF)
                .map(t => t.emit())
                .join("");

            assert.strictEqual(reconstructed, source);
        });

        test("should use Token class methods", () => {
            const source = `integer x = 42; // comment`;
            const lexer = new Lexer(source, "lsl");
            const tokens = lexer.tokenize();

            // Test emit()
            const reconstructed = tokens
                .filter(t => t.type !== TokenType.EOF)
                .map(t => t.emit())
                .join("");
            assert.strictEqual(reconstructed, source);

            // Test type checking methods
            const identifierToken = tokens.find(t => t.value === "integer");
            assert.ok(identifierToken);
            assert.ok(identifierToken.isIdentifier());
            assert.ok(!identifierToken.isBracket());

            const numberToken = tokens.find(t => t.value === "42");
            assert.ok(numberToken);
            assert.ok(numberToken.isNumber());

            const commentToken = tokens.find(t => t.type === TokenType.LINE_COMMENT);
            assert.ok(commentToken);
            assert.ok(commentToken.isComment());

            // Test withValue()
            const newToken = identifierToken.withValue("float");
            assert.strictEqual(newToken.value, "float");
            assert.strictEqual(newToken.length, 5);
            assert.strictEqual(newToken.type, identifierToken.type);
            assert.strictEqual(identifierToken.value, "integer"); // Original unchanged

            // Test withType()
            const changedType = identifierToken.withType(TokenType.NUMBER_LITERAL);
            assert.strictEqual(changedType.type, TokenType.NUMBER_LITERAL);
            assert.strictEqual(changedType.value, identifierToken.value);

            // Test clone()
            const cloned = identifierToken.clone({ line: 999 });
            assert.strictEqual(cloned.line, 999);
            assert.strictEqual(cloned.value, identifierToken.value);
            assert.strictEqual(cloned.type, identifierToken.type);

            // Test getLocation()
            assert.ok(identifierToken.getLocation().includes("line"));
            assert.ok(identifierToken.getLocation().includes("column"));

            // Test toString()
            const str = identifierToken.toString();
            assert.ok(str.includes("IDENTIFIER"));
            assert.ok(str.includes("integer"));
        });

        test("should use bracket checking methods", () => {
            const source = `{ ( [ ] ) }`;
            const lexer = new Lexer(source, "lsl");
            const tokens = lexer.tokenize();

            const braceOpen = tokens.find(t => t.value === "{");
            assert.ok(braceOpen);
            assert.ok(braceOpen.isBracket());
            assert.ok(braceOpen.isOpeningBracket());
            assert.ok(!braceOpen.isClosingBracket());

            const braceClose = tokens.find(t => t.value === "}");
            assert.ok(braceClose);
            assert.ok(braceClose.isBracket());
            assert.ok(!braceClose.isOpeningBracket());
            assert.ok(braceClose.isClosingBracket());
        });
    });

    suite("Parser", () => {

        // Use the shared helper functions
        const testOptions = createDefaultOptions();
        const mockHost = createMockHost(testOptions);

        test("should pass through simple code without directives", async () => {
            const source = `integer x = 42;`;
            const sourceFile = normalizePath("test.lsl");

            const preprocessor = new LexingPreprocessor(mockHost, mockHost.config);
            const result = await preprocessor.process(source, sourceFile, "lsl");

            if (!result.success) {
                console.log("Preprocessing failed with issues:", result.issues);
            }
            assert.strictEqual(result.success, true, `Expected success but got issues: ${JSON.stringify(result.issues)}`);
            assert.strictEqual(result.content, source);
        });

        test("should preserve comments", async () => {
            const source = `// Comment\ninteger x; /* block */`;
            const sourceFile = normalizePath("test.lsl");

            const preprocessor = new LexingPreprocessor(mockHost, mockHost.config);
            const result = await preprocessor.process(source, sourceFile, "lsl");

            assert.strictEqual(result.success, true);
            assert.ok(result.content.includes("// Comment"));
            assert.ok(result.content.includes("/* block */"));
        });

        test("should handle disabled preprocessing", async () => {
            const source = `#include "test.lsl"\ninteger x;`;
            const sourceFile = normalizePath("test.lsl");
            const disabledOptions = { ...testOptions, enable: false };
            const disabledHost = createMockHost(disabledOptions);

            const preprocessor = new LexingPreprocessor(disabledHost, disabledHost.config);
            const result = await preprocessor.process(source, sourceFile, "lsl");

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.content, source); // Unchanged
        });
    });

    suite("Integration", () => {

        test("should tokenize and parse complete LSL script", async () => {
            const source = `// Test script
#define TEST_VALUE 42

default {
    state_entry() {
        llSay(0, "Hello");
        integer x = TEST_VALUE;
    }
}`;
            const options = createDefaultOptions();
            const mockHost = createMockHost(options);

            const preprocessor = new LexingPreprocessor(mockHost, mockHost.config);
            const result = await preprocessor.process(
                source,
                normalizePath("test.lsl"),
                "lsl"
            );

            assert.strictEqual(result.success, true);
            assert.ok(result.content.length > 0);
        });
    });

    suite("Integration - Full LSL Script with Defines and Conditionals", () => {

        test("should process comprehensive LSL script with macros and conditionals from file", async () => {
            // Read source and expected output from files
            const testDataPath = path.join(__dirname, "..", "workspace", "set_1");
            const sourceFile = path.join(testDataPath, "test_defines_conditionals.lsl");
            const expectedFile = path.join(testDataPath, "test_defines_conditionals_expected.lsl");

            const source = fs.readFileSync(sourceFile, "utf-8");
            const expected = fs.readFileSync(expectedFile, "utf-8");

            const options = createDefaultOptions();
            const mockHost = createMockHost(options);

            const preprocessor = new LexingPreprocessor(mockHost, mockHost.config);
            const result = await preprocessor.process(
                source,
                normalizePath(sourceFile),
                "lsl"
            );

            // Verify successful preprocessing
            assert.strictEqual(result.success, true, "Preprocessing should succeed");
            assert.ok(result.content.length > 0, "Should have output content");

            // Compare actual output to expected output
            const actualNormalized = normalizeOutput(result.content);
            const expectedNormalized = normalizeOutput(expected);

            if (actualNormalized !== expectedNormalized) {
                // If not equal, show differences for debugging
                const actualLines = actualNormalized.split('\n');
                const expectedLines = expectedNormalized.split('\n');
                const maxLines = Math.max(actualLines.length, expectedLines.length);

                let firstDiff = -1;
                for (let i = 0; i < maxLines; i++) {
                    if (actualLines[i] !== expectedLines[i]) {
                        firstDiff = i;
                        break;
                    }
                }

                if (firstDiff >= 0) {
                    const contextStart = Math.max(0, firstDiff - 2);
                    const contextEnd = Math.min(maxLines, firstDiff + 3);

                    console.log(`\nFirst difference at line ${firstDiff + 1}:`);
                    console.log('Expected:', expectedLines[firstDiff]);
                    console.log('Actual:  ', actualLines[firstDiff]);
                    console.log('\nContext (lines ' + (contextStart + 1) + '-' + (contextEnd) + '):');
                    for (let i = contextStart; i < contextEnd; i++) {
                        const marker = i === firstDiff ? '>>> ' : '    ';
                        console.log(marker + 'E:', expectedLines[i] || '<missing>');
                        console.log(marker + 'A:', actualLines[i] || '<missing>');
                    }
                }
            }

            assert.strictEqual(
                actualNormalized,
                expectedNormalized,
                "Preprocessed output should match expected output"
            );

            // Verify we have line mappings
            if (result.lineMappings) {
                assert.ok(result.lineMappings.length > 0, "Should have line mappings");
            }
        });

        test("should handle nested conditionals with macro expansion from file", async () => {
            // Read source and expected output from files
            const testDataPath = path.join(__dirname, "..", "workspace", "set_1");
            const sourceFile = path.join(testDataPath, "test_nested_conditionals.lsl");
            const expectedFile = path.join(testDataPath, "test_nested_conditionals_expected.lsl");

            const source = fs.readFileSync(sourceFile, "utf-8");
            const expected = fs.readFileSync(expectedFile, "utf-8");

            const options = createDefaultOptions();
            const mockHost = createMockHost(options);

            const preprocessor = new LexingPreprocessor(mockHost, mockHost.config);
            const result = await preprocessor.process(
                source,
                normalizePath(sourceFile),
                "lsl"
            );

            assert.strictEqual(result.success, true, "Preprocessing should succeed");

            // Compare actual output to expected output
            const actualNormalized = normalizeOutput(result.content);
            const expectedNormalized = normalizeOutput(expected);

            if (actualNormalized !== expectedNormalized) {
                const actualLines = actualNormalized.split('\n');
                const expectedLines = expectedNormalized.split('\n');
                const maxLines = Math.max(actualLines.length, expectedLines.length);

                let firstDiff = -1;
                for (let i = 0; i < maxLines; i++) {
                    if (actualLines[i] !== expectedLines[i]) {
                        firstDiff = i;
                        break;
                    }
                }

                if (firstDiff >= 0) {
                    const contextStart = Math.max(0, firstDiff - 2);
                    const contextEnd = Math.min(maxLines, firstDiff + 3);

                    console.log(`\nFirst difference at line ${firstDiff + 1}:`);
                    console.log('Expected:', expectedLines[firstDiff]);
                    console.log('Actual:  ', actualLines[firstDiff]);
                    console.log('\nContext (lines ' + (contextStart + 1) + '-' + (contextEnd) + '):');
                    for (let i = contextStart; i < contextEnd; i++) {
                        const marker = i === firstDiff ? '>>> ' : '    ';
                        console.log(marker + 'E:', expectedLines[i] || '<missing>');
                        console.log(marker + 'A:', actualLines[i] || '<missing>');
                    }
                }
            }

            assert.strictEqual(
                actualNormalized,
                expectedNormalized,
                "Preprocessed output should match expected output"
            );
        });
    });

    suite("Configuration Integration", () => {
        test("should use maxIncludeDepth from config", async () => {
            const options = createDefaultOptions();
            options.maxIncludeDepth = 2; // Only allow 2 levels of includes

            const mockHost = createMockHostWithFS(
                options,
                async (path: NormalizedPath) => {
                    // Simulate a chain of includes that exceeds depth 2
                    if (path.endsWith('file1.lsl')) {
                        return '#include "file2.lsl"\ndefault { state_entry() {} }';
                    } else if (path.endsWith('file2.lsl')) {
                        return '#include "file3.lsl"\ndefault { state_entry() {} }';
                    } else if (path.endsWith('file3.lsl')) {
                        return 'default { state_entry() {} }';
                    }
                    return null;
                },
                async (path: NormalizedPath) => path.endsWith('.lsl'),
                async (filename: string, from: NormalizedPath) => normalizePath(path.join(path.dirname(from), filename))
            );

            const preprocessor = new LexingPreprocessor(mockHost, mockHost.config);

            const source = '#include "file1.lsl"\ndefault { state_entry() {} }';
            const result = await preprocessor.process(
                source,
                normalizePath('/test/main.lsl'),
                'lsl'
            );

            // Should fail due to depth limit of 2 being exceeded
            assert.strictEqual(result.success, false, "Should fail when max depth is exceeded");
            assert.ok(result.issues.length > 0, "Should have error about depth exceeded");
            assert.ok(
                result.issues.some(issue => issue.message.includes('depth')),
                "Error should mention depth limit"
            );
        });

        test("should use includePaths from config", async () => {
            const options = createDefaultOptions();
            options.maxIncludeDepth = 5;
            options.includePaths = ['./include/', '.'];

            const mockHost = createMockHostWithFS(
                options,
                async (path: NormalizedPath): Promise<string | null> => {
                    if (path.includes('include') && path.endsWith('utils.lsl')) {
                        return 'integer MAGIC = 42;';
                    }
                    return null;
                },
                async (path: NormalizedPath): Promise<boolean> => {
                    return path.includes('include') && path.endsWith('utils.lsl');
                },
                async (filename: string, from: NormalizedPath, extensions?: string[], includePaths?: string[]): Promise<NormalizedPath | null> => {
                    // Check if includePaths contains './include/'
                    if (includePaths && includePaths.includes('./include/')) {
                        const dir = path.dirname(from);
                        const resolved = path.join(dir, 'include', filename);
                        return normalizePath(resolved);
                    }
                    return null;
                }
            );
            const preprocessor = new LexingPreprocessor(mockHost, mockHost.config);

            const source = '#include "utils.lsl"\ndefault { state_entry() { integer x = MAGIC; } }';
            const result = await preprocessor.process(
                source,
                normalizePath('/test/main.lsl'),
                'lsl'
            );

            assert.strictEqual(result.success, true, "Should succeed with configured include paths");
            assert.ok(result.content.includes('MAGIC'), "Should have included content from utils.lsl");
        });

        test("should use default values when config is not provided", async () => {
            const options = createDefaultOptions();
            const mockHost = createMockHost(options); // With default config values
            const preprocessor = new LexingPreprocessor(mockHost, mockHost.config);

            const source = 'default { state_entry() {} }';
            const result = await preprocessor.process(
                source,
                normalizePath('/test/main.lsl'),
                'lsl'
            );

            // Should work fine with defaults (maxIncludeDepth: 5, includePaths: ['.'])
            assert.strictEqual(result.success, true, "Should succeed with default config values");
        });

        test("should respect preprocessor.enable config when set to false", async () => {
            const options = createDefaultOptions();
            options.enable = false;  // Disable preprocessing

            const mockHost = createMockHost(options);
            const preprocessor = new LexingPreprocessor(mockHost, mockHost.config);

            // Source with macros and conditionals that would normally be processed
            const source = `#define MAX 100
#ifdef MAX
integer x = MAX;
#endif
default { state_entry() {} }`;

            const result = await preprocessor.process(
                source,
                normalizePath('/test/main.lsl'),
                'lsl'
            );

            // Should succeed but return source unchanged
            assert.strictEqual(result.success, true, "Should succeed when disabled");
            assert.strictEqual(result.content, source, "Should return original source unchanged");
            assert.ok(!result.content.includes('integer x = 100'), "Should NOT have processed macros");
        });

        test("should process when preprocessor.enable is true", async () => {
            const options = createDefaultOptions();
            options.enable = true;  // Explicitly enable

            const mockHost = createMockHost(options);
            const preprocessor = new LexingPreprocessor(mockHost, mockHost.config);

            const source = `#define MAX 100
integer x = MAX;
default { state_entry() {} }`;

            const result = await preprocessor.process(
                source,
                normalizePath('/test/main.lsl'),
                'lsl'
            );

            // Should succeed and process the macros
            assert.strictEqual(result.success, true, "Should succeed when enabled");
            assert.ok(result.content.includes('integer x = 100'), "Should have processed macro");
            assert.ok(!result.content.includes('#define'), "Should have removed directive");
        });

        test("should process when preprocessor.enable is undefined (default enabled)", async () => {
            // Use default options which have enable: true
            const mockHost = createMockHost();
            const preprocessor = new LexingPreprocessor(mockHost, mockHost.config);

            const source = `#define MAX 100
integer x = MAX;
default { state_entry() {} }`;

            const result = await preprocessor.process(
                source,
                normalizePath('/test/main.lsl'),
                'lsl'
            );

            // Should succeed and process (default is enabled)
            assert.strictEqual(result.success, true, "Should succeed with default (enabled)");
            assert.ok(result.content.includes('integer x = 100'), "Should have processed macro by default");
        });

        test("should validate maxIncludeDepth range (minimum)", async () => {
            const options = createDefaultOptions();
            options.maxIncludeDepth = 1;
            options.includePaths = ['.'];

            const mockHost = createMockHostWithFS(
                options,
                async (path: NormalizedPath) => {
                    if (path.endsWith('file1.lsl')) {
                        return 'integer x = 1;';
                    }
                    return null;
                },
                async (path: NormalizedPath) => path.endsWith('.lsl'),
                async (filename: string, from: NormalizedPath) => normalizePath(path.join(path.dirname(from), filename))
            );

            const preprocessor = new LexingPreprocessor(mockHost, mockHost.config);

            const source = '#include "file1.lsl"\ndefault { state_entry() {} }';
            const result = await preprocessor.process(
                source,
                normalizePath('/test/main.lsl'),
                'lsl'
            );

            // Should succeed with depth of 1 (allows one level of includes)
            assert.strictEqual(result.success, true, "Should succeed with maxIncludeDepth of 1");
            assert.ok(result.content.includes('integer x = 1'), "Should have included content");
        });

        test("should validate maxIncludeDepth range (exceeds maximum)", async () => {
            const options = createDefaultOptions();
            options.maxIncludeDepth = 3;  // Use depth 3 for a chain that goes: main -> file1 -> file2 -> file3 -> file4
            options.includePaths = ['.'];

            const mockHost = createMockHostWithFS(
                options,
                async (path: NormalizedPath) => {
                    if (path.endsWith('file1.lsl')) {
                        return '#include "file2.lsl"\ninteger a = 1;';
                    } else if (path.endsWith('file2.lsl')) {
                        return '#include "file3.lsl"\ninteger b = 2;';
                    } else if (path.endsWith('file3.lsl')) {
                        return '#include "file4.lsl"\ninteger c = 3;';
                    } else if (path.endsWith('file4.lsl')) {
                        return 'integer d = 4;';
                    }
                    return null;
                },
                async (path: NormalizedPath) => path.endsWith('.lsl'),
                async (filename: string, from: NormalizedPath) => normalizePath(path.join(path.dirname(from), filename))
            );

            const preprocessor = new LexingPreprocessor(mockHost, mockHost.config);

            const source = '#include "file1.lsl"\ndefault { state_entry() {} }';
            const result = await preprocessor.process(
                source,
                normalizePath('/test/main.lsl'),
                'lsl'
            );

            // Should fail because the chain exceeds depth 3
            assert.strictEqual(result.success, false, "Should fail when chain exceeds maxIncludeDepth");
            assert.ok(result.issues.length > 0, "Should have error issues");
            assert.ok(
                result.issues.some(issue => !issue.isWarning && issue.message.toLowerCase().includes('depth')),
                "Should have error about depth being exceeded"
            );
        });
    });

    suite("Error Handling and Recovery", () => {
        test("should continue processing after macro expansion error", async () => {
            const options = createDefaultOptions();
            const mockHost = createMockHost(options);
            const preprocessor = new LexingPreprocessor(mockHost, mockHost.config);

            // Function-like macro invoked with wrong number of args, but processing continues
            const source = `#define ADD(a, b) ((a) + (b))
integer x = ADD(1);  // Wrong number of args - should error but continue
integer y = 42;      // This should still be processed
default { state_entry() {} }`;

            const result = await preprocessor.process(
                source,
                normalizePath('/test/main.lsl'),
                'lsl'
            );

            // Should have warnings/errors but still produce output
            assert.ok(result.issues.length > 0, "Should have issues from macro error");
            assert.ok(result.content.includes('integer y = 42'), "Should continue processing after error");
            assert.ok(result.content.includes('default'), "Should reach end of file");
        });

        test("should recover from unterminated conditional", async () => {
            const options = createDefaultOptions();            const mockHost = createMockHost(options);
            const preprocessor = new LexingPreprocessor(mockHost, mockHost.config);

            const source = `#define DEBUG 1
#ifdef DEBUG
integer x = 1;
// Missing #endif - should error but process all code
integer y = 2;
default { state_entry() {} }`;

            const result = await preprocessor.process(
                source,
                normalizePath('/test/main.lsl'),
                'lsl'
            );

            // Should have error about unterminated conditional
            assert.ok(result.issues.length > 0, "Should have error about unterminated conditional");
            assert.ok(
                result.issues.some(issue => issue.message.toLowerCase().includes('unterminated') ||
                                           issue.message.toLowerCase().includes('#ifdef')),
                "Should report unterminated #ifdef"
            );
            assert.strictEqual(result.success, false, "Should fail with unterminated conditional");

            // But should still have processed the code
            assert.ok(result.content.length > 0, "Should still have output content");
        });

        test("should distinguish between errors and warnings", async () => {
            const options = createDefaultOptions();
            const mockHost = createMockHost(options);
            const preprocessor = new LexingPreprocessor(mockHost, mockHost.config);

            // Function-like macro used without parentheses generates a warning
            const source = `#define FUNC(x) ((x) * 2)
integer y = FUNC;  // Warning: function-like macro without parentheses
integer z = FUNC(5);  // Correct usage
default { state_entry() {} }`;

            const result = await preprocessor.process(
                source,
                normalizePath('/test/main.lsl'),
                'lsl'
            );

            // Should have warnings but still succeed
            const warnings = result.issues.filter(i => i.isWarning);
            const errors = result.issues.filter(i => !i.isWarning);

            assert.ok(warnings.length > 0, "Should have warnings");
            assert.strictEqual(errors.length, 0, "Should not have errors for this case");

            // Note: Currently the parser doesn't fail on warnings alone,
            // but we check that the issue was properly categorized
            assert.ok(result.content.includes('default'), "Should complete processing");
        });
    });
});
