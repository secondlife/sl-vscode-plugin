/**
 * @file token.ts
 * Token for lexical analyzer for LSL and SLua scripts
 * Copyright (C) 2025, Linden Research, Inc.
 */


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
    STRING_INTERP_START = "STRING_INTERP_START",
    STRING_INTERP_MIDDLE = "STRING_INTERP_MIDDLE",
    STRING_INTERP_END = "STRING_INTERP_END",
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

    is(type: TokenType, value: string): boolean {
        return this.isType(type) && this.value === value;
    }

    isType(type: TokenType): boolean {
        return this.type === type;
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
