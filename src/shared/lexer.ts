/**
 * @file lexer.ts
 * Lexical analyzer for LSL and SLua scripts
 * Copyright (C) 2025, Linden Research, Inc.
 *
 * Tokenizes source code into a stream of tokens for preprocessing and parsing.
 */

import { ScriptLanguage } from "./languageservice";
import { NormalizedPath } from "../interfaces/hostinterface";
import { DiagnosticCollector, ErrorCodes } from "./diagnostics";

//#region Language Configuration

/**
 * Language-specific lexer configuration
 */
export interface LanguageLexerConfig {
    lineCommentPrefix: string; // Line comment prefix (e.g., "//" for LSL, "--" for Luau)
    blockCommentStart: string; // Block comment start marker (e.g., slash-star)
    blockCommentEnd: string; // Block comment end marker (e.g., star-slash)
    logicalOperators: {
        and: string; // Logical AND operator (e.g., "&&" for LSL, "and" for Luau)
        or: string; // Logical OR operator (e.g., "||" for LSL, "or" for Luau)
        not: string; // Logical NOT operator (e.g., "!" for LSL, "not" for Luau)
    }; // Logical NOT operator (e.g., "!" for LSL, "not" for Luau)
    useLongBracketSyntax?: boolean; // Whether block comments use Lua-style long bracket syntax with variable equals (e.g., --[=[)
    supportsVectorLiterals?: boolean; // Whether the language supports vector/rotation literals like <1,2,3> (LSL)
    directivePrefix: string | null; // Directive prefix (e.g., "#" for LSL, null for Luau)
    directiveKeywords: string[]; // Directive keywords (e.g., ["require"] for Luau)
    operators?: string[]; // Operators and punctuation
    brackets?: Array<[string, string]>; // Bracket pairs
    stringDelimiters?: string[]; // String delimiters for this language (e.g., ['"', "'"] for LSL, ['"', "'", '`'] for Luau)
}

/**
 * Predefined language configurations
 */
export const LANGUAGE_CONFIGS: Record<ScriptLanguage, LanguageLexerConfig> = {
    lsl: {
        lineCommentPrefix: "//",
        blockCommentStart: "/*",
        blockCommentEnd: "*/",
        logicalOperators: {
            and: "&&",
            or: "||",
            not: "!"
        },
        useLongBracketSyntax: false,
        supportsVectorLiterals: true,
        directivePrefix: "#",
        directiveKeywords: ["defined"],
        operators: [
            // Multi-character operators
            "==", "!=", "<=", ">=", "&&", "||", "<<", ">>",
            "+=", "-=", "*=", "/=", "%=", "++", "--",
            // Single-character operators
            "+", "-", "*", "/", "%", "=", "!", "<", ">", "&", "|", "^", "~",
            // Punctuation (brackets handled separately as distinct token types)
            "?", ":", ";", ",", ".",
        ],
        brackets: [
            ["{", "}"],  // Braces for code blocks
            ["(", ")"],  // Parentheses for expressions and function calls
            ["[", "]"],  // Brackets for lists
        ],
        stringDelimiters: ['"', "'"],  // Double and single quotes
    },
    luau: {
        lineCommentPrefix: "--",
        blockCommentStart: "--[[",
        blockCommentEnd: "]]",
        logicalOperators: {
            and: "and",
            or: "or",
            not: "not"
        },
        useLongBracketSyntax: true,
        directivePrefix: null,
        directiveKeywords: ["require"],
        operators: [
            // Arithmetic operators
            "+", "-", "*", "/", "%", "^",
            // Relational operators
            "==", "~=", "<=", ">=", "<", ">",
            // Logical operators
            "and", "or", "not",
            // Other & punctuation (brackets handled separately as distinct token types)
            "..", "#", "?", ":", ";", ",", ".",
        ],
        brackets: [
            ["{", "}"],  // Braces for code blocks (do...end in Lua, but braces for tables)
            ["(", ")"],  // Parentheses for expressions and function calls
            ["[", "]"],  // Brackets for table indexing
        ],
        stringDelimiters: ['"', "'", '`'],  // Double quotes, single quotes, and backticks
    },
};

/**
 * Get language configuration for a script language
 */
export function getLanguageConfig(language: ScriptLanguage): LanguageLexerConfig {
    return LANGUAGE_CONFIGS[language];
}

//#endregion

//#region Token Types and Definitions

/**
 * Token types recognized by the lexer
 */
export enum TokenType {
    // Whitespace and structure
    WHITESPACE = "WHITESPACE",
    NEWLINE = "NEWLINE",

    // Comments
    LINE_COMMENT = "LINE_COMMENT",
    BLOCK_COMMENT_START = "BLOCK_COMMENT_START",
    BLOCK_COMMENT_END = "BLOCK_COMMENT_END",
    BLOCK_COMMENT_CONTENT = "BLOCK_COMMENT_CONTENT",

    // Preprocessor directives
    DIRECTIVE = "DIRECTIVE",          // #include, #define, etc. (LSL) or require (SLua)
    DIRECTIVE_PARAM = "DIRECTIVE_PARAM",

    // Literals
    STRING_LITERAL = "STRING_LITERAL",
    NUMBER_LITERAL = "NUMBER_LITERAL",
    VECTOR_LITERAL = "VECTOR_LITERAL",    // <x, y, z> or <x, y, z, w> (LSL vectors/rotations)

    // Identifiers and operators
    IDENTIFIER = "IDENTIFIER",
    OPERATOR = "OPERATOR",
    PUNCTUATION = "PUNCTUATION",

    // Brackets (for matching and macro expansion)
    BRACE_OPEN = "BRACE_OPEN",           // {
    BRACE_CLOSE = "BRACE_CLOSE",         // }
    PAREN_OPEN = "PAREN_OPEN",           // (
    PAREN_CLOSE = "PAREN_CLOSE",         // )
    BRACKET_OPEN = "BRACKET_OPEN",       // [
    BRACKET_CLOSE = "BRACKET_CLOSE",     // ]

    // Special
    EOF = "EOF",
    UNKNOWN = "UNKNOWN",
}

/**
 * Represents a single token in the source
 */
export class Token {
    constructor(
        public type: TokenType,
        public value: string,
        public line: number,
        public column: number,
        public length: number
    ) {}

    /**
     * Emit this token's value (for source reconstruction)
     */
    emit(): string {
        return this.value;
    }

    /**
     * Check if this token is a bracket (opening or closing)
     */
    isBracket(): boolean {
        return this.type === TokenType.BRACE_OPEN ||
               this.type === TokenType.BRACE_CLOSE ||
               this.type === TokenType.PAREN_OPEN ||
               this.type === TokenType.PAREN_CLOSE ||
               this.type === TokenType.BRACKET_OPEN ||
               this.type === TokenType.BRACKET_CLOSE;
    }

    /**
     * Check if this token is an opening bracket
     */
    isOpeningBracket(): boolean {
        return this.type === TokenType.BRACE_OPEN ||
               this.type === TokenType.PAREN_OPEN ||
               this.type === TokenType.BRACKET_OPEN;
    }

    /**
     * Check if this token is a closing bracket
     */
    isClosingBracket(): boolean {
        return this.type === TokenType.BRACE_CLOSE ||
               this.type === TokenType.PAREN_CLOSE ||
               this.type === TokenType.BRACKET_CLOSE;
    }

    /**
     * Check if this token is whitespace or newline
     */
    isWhitespaceOrNewline(): boolean {
        return this.type === TokenType.WHITESPACE ||
               this.type === TokenType.NEWLINE;
    }

    /**
     * Check if this token is a comment
     */
    isComment(): boolean {
        return this.type === TokenType.LINE_COMMENT ||
               this.type === TokenType.BLOCK_COMMENT_START ||
               this.type === TokenType.BLOCK_COMMENT_CONTENT ||
               this.type === TokenType.BLOCK_COMMENT_END;
    }

    /**
     * Check if this token is an identifier
     */
    isIdentifier(): boolean {
        return this.type === TokenType.IDENTIFIER;
    }

    /**
     * Check if this token is a directive
     */
    isDirective(): boolean {
        return this.type === TokenType.DIRECTIVE;
    }

    /**
     * Check if this token is a number literal
     */
    isNumber(): boolean {
        return this.type === TokenType.NUMBER_LITERAL;
    }

    /**
     * Check if this token is a string literal
     */
    isString(): boolean {
        return this.type === TokenType.STRING_LITERAL;
    }

    /**
     * Clone this token with optional property overrides
     * Useful for macro expansion
     */
    clone(overrides?: Partial<Pick<Token, 'type' | 'value' | 'line' | 'column' | 'length'>>): Token {
        return new Token(
            overrides?.type ?? this.type,
            overrides?.value ?? this.value,
            overrides?.line ?? this.line,
            overrides?.column ?? this.column,
            overrides?.length ?? this.length
        );
    }

    /**
     * Create a new token with a different value
     * Updates length automatically
     */
    withValue(newValue: string): Token {
        return this.clone({ value: newValue, length: newValue.length });
    }

    /**
     * Create a new token with a different type
     */
    withType(newType: TokenType): Token {
        return this.clone({ type: newType });
    }

    /**
     * Get a human-readable location string
     */
    getLocation(): string {
        return `line ${this.line}, column ${this.column}`;
    }

    /**
     * Get a debug string representation
     */
    toString(): string {
        const typeName = TokenType[this.type];
        return `${typeName}('${this.value}') at ${this.getLocation()}`;
    }
}

/**
 * Context for lexer state
 */
interface LexerContext {
    inBlockComment: boolean;
    blockCommentLevel: number; // For Lua long bracket syntax: 0 for [[, 1 for [=[, etc.
    lineNumber: number;
    columnNumber: number;
}

//#endregion

//#region Lexer

/**
 * Lexer that tokenizes source code into meaningful tokens
 */
export class Lexer {
    private source: string;
    private position: number;
    private context: LexerContext;
    private tokens: Token[];
    private config: LanguageLexerConfig;
    private sourceFile: NormalizedPath;
    private diagnostics: DiagnosticCollector;

    constructor(source: string, language: ScriptLanguage, sourceFile?: NormalizedPath, diagnostics?: DiagnosticCollector);
    constructor(source: string, config: LanguageLexerConfig, sourceFile?: NormalizedPath, diagnostics?: DiagnosticCollector);
    constructor(
        source: string,
        languageOrConfig: ScriptLanguage | LanguageLexerConfig,
        sourceFile?: NormalizedPath,
        diagnostics?: DiagnosticCollector
    ) {
        this.source = source;
        this.position = 0;
        this.context = {
            inBlockComment: false,
            blockCommentLevel: 0,
            lineNumber: 1,
            columnNumber: 1,
        };
        this.tokens = [];
        this.sourceFile = sourceFile || ("<unknown>" as NormalizedPath);
        this.diagnostics = diagnostics || new DiagnosticCollector();

        // Support both language string and config object
        if (typeof languageOrConfig === 'string') {
            this.config = getLanguageConfig(languageOrConfig);
        } else {
            this.config = languageOrConfig;
        }
    }

    /**
     * Tokenize the entire source
     */
    public tokenize(): Token[] {
        this.tokens = [];

        while (!this.isAtEnd()) {
            const token = this.nextToken();
            if (token) {
                this.tokens.push(token);
            }
        }

        // Check for unterminated block comment
        if (this.context.inBlockComment) {
            this.diagnostics.addError(
                `Unterminated block comment`,
                {
                    line: this.context.lineNumber,
                    column: this.context.columnNumber,
                    length: 0,
                    sourceFile: this.sourceFile,
                },
                ErrorCodes.UNTERMINATED_BLOCK_COMMENT
            );
        }

        // Add EOF token
        this.tokens.push(new Token(
            TokenType.EOF,
            "",
            this.context.lineNumber,
            this.context.columnNumber,
            0
        ));

        return this.tokens;
    }

    /**
     * Get the diagnostic collector for this lexer
     */
    public getDiagnostics(): DiagnosticCollector {
        return this.diagnostics;
    }

    /**
     * Get the next token from the source
     */
    private nextToken(): Token | null {
        const startLine = this.context.lineNumber;
        const startColumn = this.context.columnNumber;

        // Handle block comments (multi-line)
        if (this.context.inBlockComment) {
            return this.readBlockCommentContent();
        }

        const char = this.peek();

        // Newline
        if (char === '\n' || char === '\r') {
            return this.readNewline();
        }

        // Whitespace
        if (this.isWhitespace(char)) {
            return this.readWhitespace();
        }

        // Comments
        const commentToken = this.tryReadComment();
        if (commentToken) {
            return commentToken;
        }

        // String literals - check configured delimiters
        if (this.isStringDelimiter(char)) {
            return this.readStringLiteral(char);
        }

        // Preprocessor directives with prefix (e.g., #include)
        if (this.config.directivePrefix && char === this.config.directivePrefix) {
            return this.readDirective();
        }

        // Directive keywords without prefix (e.g., require)
        if (this.config.directiveKeywords.length > 0) {
            const word = this.peekWord();
            if (this.config.directiveKeywords.includes(word)) {
                return this.readDirectiveKeyword();
            }
        }

        // Numbers (but not ".." which is the Lua concatenation operator)
        if (this.isDigit(char) || (char === '.' && this.peekAhead(1) !== '.' && this.isDigit(this.peekAhead(1)))) {
            return this.readNumber();
        }

        // Vector/rotation literals (LSL only): <f,f,f> or <f,f,f,f>
        if (this.config.supportsVectorLiterals && char === '<') {
            const vectorToken = this.tryReadVectorLiteral();
            if (vectorToken) {
                return vectorToken;
            }
            // If not a vector, fall through to operator handling
        }

        // Identifiers and keywords
        if (this.isIdentifierStart(char)) {
            return this.readIdentifier();
        }

        // Operators and punctuation
        if (this.isOperatorOrPunctuation(char)) {
            return this.readOperatorOrPunctuation();
        }

        // Unknown character - skip it
        const value = this.advance();
        return new Token(
            TokenType.UNKNOWN,
            value,
            startLine,
            startColumn,
            value.length
        );
    }

    //#region Character classification

    private isWhitespace(char: string): boolean {
        return /\s/.test(char);
    }

    private isDigit(char: string): boolean {
        return /\d/.test(char);
    }

    private isIdentifierStart(char: string): boolean {
        return /[a-zA-Z_]/.test(char);
    }

    private isIdentifierChar(char: string): boolean {
        return this.isIdentifierStart(char) || this.isDigit(char);
    }

    /**
     * Check if a character can start an operator or punctuation (including brackets)
     * Used to determine if we should enter operator/punctuation parsing
     */
    private isOperatorOrPunctuation(char: string): boolean {
        // Check for brackets from config
        if (this.config.brackets) {
            for (const [open, close] of this.config.brackets) {
                if (char === open || char === close) {
                    return true;
                }
            }
        }

        if (!this.config.operators) {
            return false;
        }
        // Check if any configured operator starts with this character
        return this.config.operators.some(op => op[0] === char);
    }

    /**
     * Check if a character is a string delimiter for this language
     */
    private isStringDelimiter(char: string): boolean {
        if (!this.config.stringDelimiters) {
            // Fallback to common delimiters if not configured
            return char === '"' || char === "'";
        }
        return this.config.stringDelimiters.includes(char);
    }

    //#endregion

    //#region Token readers

    private readWhitespace(): Token {
        const startLine = this.context.lineNumber;
        const startColumn = this.context.columnNumber;
        let value = "";

        while (!this.isAtEnd() && this.isWhitespace(this.peek())) {
            value += this.advance();
        }

        return new Token(
            TokenType.WHITESPACE,
            value,
            startLine,
            startColumn,
            value.length
        );
    }

    private readNewline(): Token {
        const startLine = this.context.lineNumber;
        const startColumn = this.context.columnNumber;
        let value = "";

        const char = this.peek();
        if (char === '\r') {
            value += this.advance();
            if (this.peek() === '\n') {
                value += this.advance();
            }
        } else if (char === '\n') {
            value += this.advance();
        }

        this.context.lineNumber++;
        this.context.columnNumber = 1;

        return new Token(
            TokenType.NEWLINE,
            value,
            startLine,
            startColumn,
            value.length
        );
    }

    private tryReadComment(): Token | null {
        const char = this.peek();
        const nextChar = this.peekAhead(1);

        // For languages with long bracket syntax (Lua), check for block comment FIRST
        // because block comments start with the line comment prefix
        const blockStart = this.config.blockCommentStart;
        if (this.config.useLongBracketSyntax && blockStart) {
            // Check for start of long bracket comment (e.g., --[)
            const linePrefix = this.config.lineCommentPrefix;
            if (linePrefix.length === 2 &&
                char === linePrefix[0] &&
                nextChar === linePrefix[1] &&
                this.peekAhead(2) === '[') {
                return this.readBlockCommentStart();
            }
        } else if (blockStart && blockStart.length >= 2) {
            // Standard block comment (e.g., /*)
            const matches = blockStart.length === 2 &&
                           char === blockStart[0] &&
                           nextChar === blockStart[1];
            if (matches) {
                return this.readBlockCommentStart();
            }
        }

        // Line comment - check if current position matches line comment prefix
        const linePrefix = this.config.lineCommentPrefix;
        if (linePrefix.length === 2 && char === linePrefix[0] && nextChar === linePrefix[1]) {
            return this.readLineComment();
        } else if (linePrefix.length === 1 && char === linePrefix[0]) {
            return this.readLineComment();
        }

        return null;
    }

    private readLineComment(): Token {
        const startLine = this.context.lineNumber;
        const startColumn = this.context.columnNumber;
        let value = "";

        // Consume the comment marker (configured prefix)
        const prefix = this.config.lineCommentPrefix;
        for (let i = 0; i < prefix.length; i++) {
            value += this.advance();
        }

        // Read until end of line
        while (!this.isAtEnd() && this.peek() !== '\n' && this.peek() !== '\r') {
            value += this.advance();
        }

        return new Token(
            TokenType.LINE_COMMENT,
            value,
            startLine,
            startColumn,
            value.length
        );
    }

    private readBlockCommentStart(): Token {
        const startLine = this.context.lineNumber;
        const startColumn = this.context.columnNumber;

        // Consume the block comment start (configured)
        const start = this.config.blockCommentStart;
        let value = "";

        // For Lua-style long brackets: --[=*[
        // Detect the level of equals signs
        let equalsLevel = 0;

        if (this.config.useLongBracketSyntax) {
            // Read line comment prefix (e.g., "--")
            const linePrefix = this.config.lineCommentPrefix;
            for (let i = 0; i < linePrefix.length; i++) {
                value += this.advance();
            }

            // Read opening bracket
            const openBracket = this.config.blockCommentStart.charAt(linePrefix.length);
            if (this.peek() === openBracket) {
                value += this.advance();
            }

            // Count equals signs
            while (this.peek() === '=') {
                value += this.advance();
                equalsLevel++;
            }

            // Read the final bracket (same as opening bracket)
            if (this.peek() === openBracket) {
                value += this.advance();
            }
        } else {
            // Standard block comment (e.g., /* */)
            for (let i = 0; i < start.length; i++) {
                value += this.advance();
            }
        }

        this.context.inBlockComment = true;
        this.context.blockCommentLevel = equalsLevel;

        return new Token(
            TokenType.BLOCK_COMMENT_START,
            value,
            startLine,
            startColumn,
            value.length
        );
    }

    private readBlockCommentContent(): Token {
        const startLine = this.context.lineNumber;
        const startColumn = this.context.columnNumber;
        let value = "";
        const endMarker = this.config.blockCommentEnd;

        while (!this.isAtEnd()) {
            const char = this.peek();

            // Check for block comment end
            let matchesEnd = false;
            let endLength = 0;

            if (this.config.useLongBracketSyntax) {
                // Lua-style long brackets: ]=*]
                // Must match the same number of equals signs as the start
                if (char === ']') {
                    let tempPos = this.position;
                    let equalsCount = 0;

                    // Skip ']'
                    tempPos++;

                    // Count equals signs
                    while (tempPos < this.source.length && this.source[tempPos] === '=') {
                        equalsCount++;
                        tempPos++;
                    }

                    // Check for final ']'
                    if (tempPos < this.source.length &&
                        this.source[tempPos] === ']' &&
                        equalsCount === this.context.blockCommentLevel) {
                        matchesEnd = true;
                        endLength = 2 + equalsCount; // ']' + equals + ']'
                    }
                }
            } else {
                // Standard block comment (e.g., */)
                const nextChar = this.peekAhead(1);
                matchesEnd = endMarker.length === 2 &&
                           char === endMarker[0] &&
                           nextChar === endMarker[1];
                endLength = endMarker.length;
            }

            if (matchesEnd) {
                // If we have accumulated content, return it first
                // The end marker will be returned on the next call
                if (value.length > 0) {
                    return new Token(
                        TokenType.BLOCK_COMMENT_CONTENT,
                        value,
                        startLine,
                        startColumn,
                        value.length
                    );
                }

                // Return the end token
                let endValue = "";
                for (let i = 0; i < endLength; i++) {
                    endValue += this.advance();
                }
                this.context.inBlockComment = false;
                this.context.blockCommentLevel = 0;

                return new Token(
                    TokenType.BLOCK_COMMENT_END,
                    endValue,
                    startLine,
                    startColumn,
                    endLength
                );
            }

            if (char === '\n' || char === '\r') {
                // Include newline in comment content
                if (char === '\r' && this.peekAhead(1) === '\n') {
                    value += this.advance();
                }
                value += this.advance();
                this.context.lineNumber++;
                this.context.columnNumber = 1;
            } else {
                value += this.advance();
            }
        }

        return new Token(
            TokenType.BLOCK_COMMENT_CONTENT,
            value,
            startLine,
            startColumn,
            value.length
        );
    }

    private readStringLiteral(quoteChar: string): Token {
        const startLine = this.context.lineNumber;
        const startColumn = this.context.columnNumber;
        let value = "";

        value += this.advance(); // Opening quote

        while (!this.isAtEnd()) {
            const char = this.peek();

            if (char === quoteChar) {
                value += this.advance(); // Closing quote
                break;
            }

            if (char === '\\' && !this.isAtEnd()) {
                value += this.advance(); // Backslash
                if (!this.isAtEnd()) {
                    value += this.advance(); // Escaped character
                }
            } else if (char === '\n' || char === '\r') {
                // Unterminated string - add error diagnostic
                this.diagnostics.addError(
                    `Unterminated string literal`,
                    {
                        line: startLine,
                        column: startColumn,
                        length: value.length,
                        sourceFile: this.sourceFile,
                    },
                    ErrorCodes.UNTERMINATED_STRING
                );
                break;
            } else {
                value += this.advance();
            }
        }

        // Check if we reached end of file without closing quote
        if (this.isAtEnd() && !value.endsWith(quoteChar)) {
            this.diagnostics.addError(
                `Unterminated string literal`,
                {
                    line: startLine,
                    column: startColumn,
                    length: value.length,
                    sourceFile: this.sourceFile,
                },
                ErrorCodes.UNTERMINATED_STRING
            );
        }

        return new Token(
            TokenType.STRING_LITERAL,
            value,
            startLine,
            startColumn,
            value.length
        );
    }

    private readDirective(): Token {
        const startLine = this.context.lineNumber;
        const startColumn = this.context.columnNumber;
        let value = "";

        // Consume the directive prefix (configured, e.g., "#")
        if (this.config.directivePrefix) {
            for (let i = 0; i < this.config.directivePrefix.length; i++) {
                value += this.advance();
            }
        }

        // Read directive name
        while (!this.isAtEnd() && this.isIdentifierChar(this.peek())) {
            value += this.advance();
        }

        return new Token(
            TokenType.DIRECTIVE,
            value,
            startLine,
            startColumn,
            value.length
        );
    }

    private readDirectiveKeyword(): Token {
        const startLine = this.context.lineNumber;
        const startColumn = this.context.columnNumber;
        let value = "";

        // Read directive keyword (e.g., "require")
        while (!this.isAtEnd() && this.isIdentifierChar(this.peek())) {
            value += this.advance();
        }

        return new Token(
            TokenType.DIRECTIVE,
            value,
            startLine,
            startColumn,
            value.length
        );
    }

    private readNumber(): Token {
        const startLine = this.context.lineNumber;
        const startColumn = this.context.columnNumber;
        let value = "";
        let hasDigits = false;

        // Read integer part
        while (!this.isAtEnd() && this.isDigit(this.peek())) {
            value += this.advance();
            hasDigits = true;
        }

        // Read decimal part
        if (this.peek() === '.' && this.isDigit(this.peekAhead(1))) {
            value += this.advance(); // .
            while (!this.isAtEnd() && this.isDigit(this.peek())) {
                value += this.advance();
                hasDigits = true;
            }
        }

        // Read exponent
        const char = this.peek();
        if (char === 'e' || char === 'E') {
            value += this.advance();

            if (this.peek() === '+' || this.peek() === '-') {
                value += this.advance();
            }

            const beforeExponentDigits = value.length;
            while (!this.isAtEnd() && this.isDigit(this.peek())) {
                value += this.advance();
            }

            // Check if exponent has no digits after 'e'/'E' and optional sign
            if (value.length === beforeExponentDigits) {
                this.diagnostics.addError(
                    `Invalid number literal: exponent has no digits`,
                    {
                        line: startLine,
                        column: startColumn,
                        length: value.length,
                        sourceFile: this.sourceFile,
                    },
                    ErrorCodes.INVALID_NUMBER_LITERAL
                );
            }
        }

        // Read suffix (f for float, etc.)
        if (this.isIdentifierStart(this.peek())) {
            value += this.advance();
        }

        // Validate: must have at least one digit
        if (!hasDigits) {
            this.diagnostics.addError(
                `Invalid number literal: no digits found`,
                {
                    line: startLine,
                    column: startColumn,
                    length: value.length,
                    sourceFile: this.sourceFile,
                },
                ErrorCodes.INVALID_NUMBER_LITERAL
            );
        }

        return new Token(
            TokenType.NUMBER_LITERAL,
            value,
            startLine,
            startColumn,
            value.length
        );
    }

    private readIdentifier(): Token {
        const startLine = this.context.lineNumber;
        const startColumn = this.context.columnNumber;
        let value = "";

        while (!this.isAtEnd() && this.isIdentifierChar(this.peek())) {
            value += this.advance();
        }

        return new Token(
            TokenType.IDENTIFIER,
            value,
            startLine,
            startColumn,
            value.length
        );
    }

    private tryReadVectorLiteral(): Token | null {
        const startLine = this.context.lineNumber;
        const startColumn = this.context.columnNumber;
        const startPos = this.position;
        let foundNewline = false;

        // Try to parse as vector: < expr , expr , expr [, expr] >
        // where expr can be a number literal or identifier
        // This is a lookahead operation - we'll restore position if it fails

        if (this.peek() !== '<') {
            return null;
        }

        this.advance(); // consume <
        if (this.skipWhitespaceInVector()) {
            foundNewline = true;
        }

        // Expect at least 3 components (number or identifier)
        for (let i = 0; i < 3; i++) {
            if (!this.isVectorComponentStart(this.peek())) {
                // Not a vector, restore position
                this.position = startPos;
                this.context.columnNumber = startColumn;
                return null;
            }

            // Skip the component (number or identifier)
            this.skipVectorComponent();
            if (this.skipWhitespaceInVector()) {
                foundNewline = true;
            }

            // Expect comma (except after last required component)
            if (i < 2) {
                if (this.peek() !== ',') {
                    this.position = startPos;
                    this.context.columnNumber = startColumn;
                    return null;
                }
                this.advance(); // consume ,
                if (this.skipWhitespaceInVector()) {
                    foundNewline = true;
                }
            }
        }

        // Optional 4th component (for rotations)
        if (this.peek() === ',') {
            this.advance();
            if (this.skipWhitespaceInVector()) {
                foundNewline = true;
            }

            if (!this.isVectorComponentStart(this.peek())) {
                this.position = startPos;
                this.context.columnNumber = startColumn;
                return null;
            }

            this.skipVectorComponent();
            if (this.skipWhitespaceInVector()) {
                foundNewline = true;
            }
        }

        // Must end with >
        if (this.peek() !== '>') {
            // Check if we encountered newline or EOF - this indicates unterminated vector
            if (foundNewline || this.isAtEnd()) {
                // This was likely intended as a vector literal but is unterminated
                const partialValue = this.source.substring(startPos, this.position);
                this.diagnostics.addError(
                    `Unterminated vector literal`,
                    {
                        line: startLine,
                        column: startColumn,
                        length: partialValue.length,
                        sourceFile: this.sourceFile,
                    },
                    ErrorCodes.UNTERMINATED_VECTOR_LITERAL
                );
            }
            this.position = startPos;
            this.context.columnNumber = startColumn;
            return null;
        }

        this.advance(); // consume >

        // Success! Extract the literal value
        const value = this.source.substring(startPos, this.position);

        return new Token(
            TokenType.VECTOR_LITERAL,
            value,
            startLine,
            startColumn,
            value.length
        );
    }

    private skipWhitespace(): void {
        while (!this.isAtEnd() && this.isWhitespace(this.peek())) {
            this.advance();
            // Note: We're not tracking line/column here since this is during lookahead
        }
    }

    /**
     * Skip whitespace in vector literal context, return true if newline encountered
     */
    private skipWhitespaceInVector(): boolean {
        let foundNewline = false;
        while (!this.isAtEnd()) {
            const char = this.peek();
            if (char === '\n' || char === '\r') {
                foundNewline = true;
                this.advance();
            } else if (this.isWhitespace(char) && char !== '\n' && char !== '\r') {
                this.advance();
            } else {
                break;
            }
        }
        return foundNewline;
    }

    private isVectorComponentStart(char: string): boolean {
        // Vector components can be numbers or identifiers
        return this.isNumberStart(char) || this.isIdentifierStart(char);
    }

    private skipVectorComponent(): void {
        const char = this.peek();

        if (this.isNumberStart(char)) {
            this.skipNumber();
        } else if (this.isIdentifierStart(char)) {
            // Skip identifier
            while (!this.isAtEnd() && this.isIdentifierChar(this.peek())) {
                this.advance();
            }
        }
    }

    private isNumberStart(char: string): boolean {
        return this.isDigit(char) || char === '-' || char === '+' || char === '.';
    }

    private skipNumber(): void {
        // Skip optional sign
        if (this.peek() === '-' || this.peek() === '+') {
            this.advance();
        }

        // Skip digits before decimal point
        while (!this.isAtEnd() && this.isDigit(this.peek())) {
            this.advance();
        }

        // Skip decimal point and fractional part
        if (this.peek() === '.') {
            this.advance();
            while (!this.isAtEnd() && this.isDigit(this.peek())) {
                this.advance();
            }
        }

        // Skip exponent
        const char = this.peek();
        if (char === 'e' || char === 'E') {
            this.advance();
            if (this.peek() === '+' || this.peek() === '-') {
                this.advance();
            }
            while (!this.isAtEnd() && this.isDigit(this.peek())) {
                this.advance();
            }
        }
    }

    private readOperatorOrPunctuation(): Token {
        const startLine = this.context.lineNumber;
        const startColumn = this.context.columnNumber;
        let value = this.advance();

        // Check for bracket types first (single character, always specific token type)
        const bracketType = this.getBracketType(value);
        if (bracketType) {
            return new Token(
                bracketType,
                value,
                startLine,
                startColumn,
                1
            );
        }

        // Handle multi-character operators - try longest match first
        const next = this.peek();

        // Two-character operators
        const twoChar = value + next;
        if (this.isOperator(twoChar)) {
            value += this.advance();

            // Three-character operators (e.g., <<= or >>=)
            const thirdChar = this.peek();
            const threeChar = value + thirdChar;
            if (this.isOperator(threeChar)) {
                value += this.advance();
            }
        }

        return new Token(
            this.isOperator(value) ? TokenType.OPERATOR : TokenType.PUNCTUATION,
            value,
            startLine,
            startColumn,
            value.length
        );
    }

    /**
     * Get the specific bracket token type for a character based on language configuration
     */
    private getBracketType(char: string): TokenType | null {
        if (!this.config.brackets) {
            return null;
        }

        // Check each bracket pair in the configuration
        for (const [open, close] of this.config.brackets) {
            if (char === open) {
                // Determine token type based on the bracket character
                // Standard mappings for common brackets
                if (open === '{') return TokenType.BRACE_OPEN;
                if (open === '(') return TokenType.PAREN_OPEN;
                if (open === '[') return TokenType.BRACKET_OPEN;
            } else if (char === close) {
                if (close === '}') return TokenType.BRACE_CLOSE;
                if (close === ')') return TokenType.PAREN_CLOSE;
                if (close === ']') return TokenType.BRACKET_CLOSE;
            }
        }

        return null;
    }

    private isOperator(op: string): boolean {

        if (!this.config.operators) {
            return false;
        }
        return this.config.operators.includes(op);
    }

    //#endregion

    //#region Helper methods

    private peek(): string {
        if (this.isAtEnd()) {
            return '\0';
        }
        return this.source[this.position];
    }

    private peekAhead(offset: number): string {
        const pos = this.position + offset;
        if (pos >= this.source.length) {
            return '\0';
        }
        return this.source[pos];
    }

    private peekWord(): string {
        let word = "";
        let offset = 0;

        while (this.position + offset < this.source.length) {
            const char = this.source[this.position + offset];
            if (this.isIdentifierChar(char)) {
                word += char;
                offset++;
            } else {
                break;
            }
        }

        return word;
    }

    private advance(): string {
        const char = this.source[this.position++];
        this.context.columnNumber++;
        return char;
    }

    private isAtEnd(): boolean {
        return this.position >= this.source.length;
    }

    //#endregion
}

//#endregion
