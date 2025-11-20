/**
 * @file parser.ts
 * Parser for LSL and SLua preprocessor directives
 * Copyright (C) 2025, Linden Research, Inc.
 *
 * Consumes token stream from lexer and produces preprocessed output.
 */

import * as path from 'path';
import { Token, TokenType, getLanguageConfig } from './lexer';
import { ScriptLanguage } from './languageservice';
import { NormalizedPath, HostInterface } from '../interfaces/hostinterface';
import { FullConfigInterface, ConfigKey } from '../interfaces/configinterface';
import type { DirectiveImplementations } from './lexingpreprocessor';
import { MacroProcessor, MacroExpansionContext } from './macroprocessor';
import { ConditionalProcessor } from './conditionalprocessor';
import { IncludeProcessor, IncludeState } from './includeprocessor';
import { DiagnosticCollector, PreprocessorDiagnostic, ErrorCodes } from './diagnostics';

//#region Parser State

/**
 * State for tracking required modules (SLua)
 */
export interface RequireState {
    /** Map of resolved file path to module ID */
    moduleMap: Map<NormalizedPath, number>;
    /** Map of module ID to wrapped module tokens */
    wrappedModules: Map<number, Token[]>;
    /** Next available module ID */
    nextModuleId: number;
}

/**
 * Parser state maintained during preprocessing
 */
export interface ParserState {
    /** Macro processor for #define directives */
    macros: MacroProcessor;
    /** Conditional compilation processor */
    conditionals: ConditionalProcessor;
    /** Include processor for #include directives */
    includes: IncludeProcessor;
    /** Include state (guards, stack, depth) */
    includeState: IncludeState;
    /** Require state (for SLua require() directives) - only present when require is supported */
    requireState?: RequireState;
}

//#endregion

//#region Parser Result

/**
 * Result of parsing/preprocessing
 */
export interface ParserResult {
    /** Preprocessed source code */
    source: string;
    /** Line mappings from processed to original */
    mappings: LineMapping[];
    /** Detected include directives */
    includes: IncludeInfo[];
    /** Detected macro definitions */
    macros: MacroInfo[];
    /** Diagnostics (errors, warnings, etc.) collected during preprocessing */
    diagnostics: PreprocessorDiagnostic[];
    /** Whether preprocessing succeeded (no errors) */
    success: boolean;
}

/**
 * Line mapping for source map generation
 */
export interface LineMapping {
    processedLine: number;
    originalLine: number;
    sourceFile: NormalizedPath;
}

/**
 * Information about an include directive
 */
export interface IncludeInfo {
    file: string;
    line: number;
    column: number;
    isRequire: boolean; // true for SLua require(), false for LSL #include
}

/**
 * Information about a macro definition
 */
export interface MacroInfo {
    name: string;
    line: number;
    column: number;
    isFunctionLike: boolean;
    parameters?: string[];
}

//#endregion

//#region Parser

/**
 * Parser that consumes token stream and produces preprocessed output
 */
export class Parser {
    private tokens: Token[];
    private position: number;
    private state: ParserState;
    private sourceFile: NormalizedPath;
    private language: ScriptLanguage;

    // Output accumulators
    private outputTokens: Token[];
    private mappings: LineMapping[];
    private includes: IncludeInfo[];
    private macroInfos: MacroInfo[];

    // Current line tracking for mapping
    private currentOutputLine: number;
    private lastSourceLine: number;
    private lastSourceFile: NormalizedPath;
    private lineDirectiveEmittedForCurrentLine: boolean;
    private lastEmittedTokenType: TokenType | null;

    // Line ending style (detected from source)
    private lineEnding: string;

    // Directive implementations
    private directives: DirectiveImplementations;

    // Host interface for file I/O (needed for includes)
    private host?: HostInterface;

    // Configuration interface for reading settings
    private config?: FullConfigInterface;

    // Track whether this is the top-level parser (for emitting require table)
    private isTopLevelParser: boolean;

    // Workspace roots for generating relative paths in @line directives
    private workspaceRoots: NormalizedPath[];

    // Diagnostic collector
    private diagnostics: DiagnosticCollector;

    constructor(
        tokens: Token[],
        sourceFile: NormalizedPath,
        language: ScriptLanguage,
        host?: HostInterface,
        directives?: DirectiveImplementations,
        initialState?: Partial<ParserState>,
        isTopLevel: boolean = true,
        workspaceRoots?: NormalizedPath[],
        diagnostics?: DiagnosticCollector,
        config?: FullConfigInterface
    ) {
        this.tokens = tokens;
        this.position = 0;

        // Detect line ending style from first newline token (default to \n if none found)
        const firstNewline = tokens.find(t => t.type === TokenType.NEWLINE);
        this.lineEnding = firstNewline?.value || '\n';

        this.sourceFile = sourceFile;
        this.language = language;
        this.host = host;
        this.config = config;
        this.isTopLevelParser = isTopLevel;
        this.diagnostics = diagnostics || new DiagnosticCollector();

        // Default to file's directory as workspace root if not provided
        this.workspaceRoots = workspaceRoots || [path.dirname(sourceFile) as NormalizedPath];

        // Read configuration values for include processing from individual config keys
        const maxIncludeDepth = config?.getConfig<number>(ConfigKey.PreprocessorMaxIncludeDepth) ?? 5;
        const includePaths = config?.getConfig<string[]>(ConfigKey.PreprocessorIncludePaths) ?? ['.'];

        // Initialize parser state
        this.state = {
            macros: initialState?.macros || new MacroProcessor(language),
            conditionals: initialState?.conditionals || new ConditionalProcessor(language),
            includes: initialState?.includes || (host ? new IncludeProcessor(language, host) : undefined as any),
            includeState: initialState?.includeState || IncludeProcessor.createState(maxIncludeDepth, includePaths),
        };

        // Only initialize requireState for SLua (luau) files or if explicitly provided
        if (initialState?.requireState !== undefined) {
            this.state.requireState = initialState.requireState;
        } else if (language === 'luau' && isTopLevel) {
            this.state.requireState = Parser.createRequireState();
        }

        // Initialize output accumulators
        this.outputTokens = [];
        this.mappings = [];
        this.includes = [];
        this.macroInfos = [];
        this.currentOutputLine = 1;
        this.lastSourceLine = 0;
        this.lastSourceFile = sourceFile;
        this.lineDirectiveEmittedForCurrentLine = false;
        this.lastEmittedTokenType = null;

        // Use provided directives or create default ones
        this.directives = directives || Parser.createDefaultDirectives();
    }

    /**
     * Create default directive implementation handlers
     * Returns handlers that accept a parser parameter, allowing them to be shared
     * across multiple parser instances (e.g., parent and nested parsers).
     */
    public static createDefaultDirectives(): DirectiveImplementations {
        return {
            define: async (parser: Parser) => Parser.handleDefineDirective(parser),
            undef: async (parser: Parser) => Parser.handleUndefDirective(parser),
            ifdef: async (parser: Parser) => Parser.handleIfdefDirective(parser, false),
            ifndef: async (parser: Parser) => Parser.handleIfdefDirective(parser, true),
            if: async (parser: Parser) => Parser.handleIfDirective(parser),
            elif: async (parser: Parser) => Parser.handleElifDirective(parser),
            else: async (parser: Parser) => Parser.handleElseDirective(parser),
            endif: async (parser: Parser) => Parser.handleEndifDirective(parser),
            include: async (parser: Parser) => Parser.handleIncludeDirective(parser),
            require: async (parser: Parser) => Parser.handleRequireDirective(parser),
        };
    }

    /**
     * Create initial require state
     */
    public static createRequireState(): RequireState {
        return {
            moduleMap: new Map(),
            wrappedModules: new Map(),
            nextModuleId: 1,
        };
    }

    /**
     * Create initial parser state with optional predefined macros
     * This allows the preprocessor to inject predefined macros before parsing begins
     */
    public static createInitialState(
        language: ScriptLanguage,
        host?: HostInterface,
        macros?: MacroProcessor,
        maxIncludeDepth: number = 5,
        includePaths: string[] = ['.']
    ): ParserState {
        return {
            macros: macros ?? new MacroProcessor(language),
            conditionals: new ConditionalProcessor(language),
            includes: host ? new IncludeProcessor(language, host) : undefined as any,
            includeState: IncludeProcessor.createState(maxIncludeDepth, includePaths),
        };
    }

    /**
     * Get current parser state (for passing to nested parsers)
     */
    public getState(): ParserState {
        return this.state;
    }

    /**
     * Parse the token stream and produce preprocessed output
     */
    public async parse(): Promise<ParserResult> {
        // First pass: process all tokens to discover all required modules
        while (!this.isAtEnd()) {
            const token = this.current();

            if (token.isDirective()) {
                const positionAdvanced = await this.handleDirective(token);
                if (!positionAdvanced) {
                    this.advance();
                }
            } else if (this.shouldEmitToken()) {
                const positionAdvanced = this.emitToken(token);
                if (!positionAdvanced) {
                    this.advance();
                }
            } else {
                this.advance();
            }

            // Stop processing immediately if we encounter any errors
            if (this.diagnostics.hasErrors()) {
                return {
                    source: "",  // Return empty source on error
                    mappings: this.mappings,
                    includes: this.includes,
                    macros: this.macroInfos,
                    diagnostics: this.diagnostics.getAll(),
                    success: false,
                };
            }
        }

        // Check for unclosed conditional blocks (PAR004)
        const unclosed = this.state.conditionals.getUnclosedBlocks();
        if (unclosed.length > 0) {
            for (const block of unclosed) {
                this.diagnostics.addError(
                    `Unterminated #${block.directive} (started at line ${block.line})`,
                    {
                        line: block.line,
                        column: 0,
                        length: block.directive.length + 1,
                        sourceFile: this.sourceFile,
                    },
                    ErrorCodes.UNTERMINATED_CONDITIONAL
                );
            }
        }

        // If this is the top-level parser and we have required modules,
        // prepend the require table to the output
        if (this.isTopLevelParser && this.state.requireState && this.state.requireState.wrappedModules.size > 0) {
            this.prependRequireTable();
            this.appendRequireTableCleanup();
        }

        return {
            source: this.reconstructSource(),
            mappings: this.mappings,
            includes: this.includes,
            macros: this.macroInfos,
            diagnostics: this.diagnostics.getAll(),
            success: !this.diagnostics.hasErrors(),
        };
    }

    //#region Directive Handling

    /**
     * Handle a preprocessor directive
     * @returns true if the parser position was advanced past the directive and its arguments
     */
    private async handleDirective(token: Token): Promise<boolean> {
        const directive = token.value.toLowerCase();

        // Extract directive name (remove # prefix for LSL)
        let directiveName = directive;
        if (directiveName.startsWith('#')) {
            directiveName = directiveName.substring(1);
        }

        // Get the handler from the implementations map
        const handler = this.directives[directiveName as keyof DirectiveImplementations];

        if (handler) {
            // Call the handler, passing this parser instance
            await handler(this);
        } else {
            // PAR001: Unknown or malformed directive
            this.diagnostics.addError(
                `Unknown preprocessor directive '${token.value}'`,
                {
                    line: token.line,
                    column: token.column,
                    length: token.value.length,
                    sourceFile: this.sourceFile,
                },
                ErrorCodes.MALFORMED_DIRECTIVE
            );
        }

        // Consume rest of directive line (but not for require, which is inline)
        if (directiveName !== 'require') {
            this.consumeDirectiveLine();
            return false; // Let caller advance past the directive token
        } else {
            return true; // require handler already advanced past all its tokens
        }
    }

    //#region Inclusion Directives
    /**
     * Handle #include directive (LSL)
     * This method processes the directive and initiates async include resolution
     */
    private static async handleIncludeDirective(parser: Parser): Promise<void> {
        const token = parser.current();

        // Skip to next token (should be whitespace then string literal)
        parser.advance();

        // Skip only horizontal whitespace, not newlines
        while (!parser.isAtEnd() && parser.current().type === TokenType.WHITESPACE) {
            parser.advance();
        }

        // PAR002: Check for missing filename argument
        if (parser.isAtEnd() || parser.current().type === TokenType.NEWLINE || !parser.current().isString()) {
            parser.diagnostics.addError(
                '#include directive requires a filename argument',
                {
                    line: token.line,
                    column: token.column,
                    length: token.value.length,
                    sourceFile: parser.sourceFile,
                },
                ErrorCodes.MISSING_DIRECTIVE_ARGUMENT
            );
            return;
        }

        const fileToken = parser.current();
        const filename = parser.extractStringValue(fileToken.value);

        // Record the include for tracking
        parser.includes.push({
            file: filename,
            line: token.line,
            column: token.column,
            isRequire: false,
        });

        // Process the include if host interface is available
        if (parser.host) {
            await parser.processIncludeDirective(filename, token.line, false);
        }
    }

    /**
     * Handle require() directive (SLua)
     */
    private static async handleRequireDirective(parser: Parser): Promise<void> {
        const token = parser.current();

        // require("filename") - look for opening paren, string, closing paren
        parser.advance();
        parser.skipWhitespace();

        if (!parser.isAtEnd() && parser.current().type === TokenType.PAREN_OPEN) {
            parser.advance();
            parser.skipWhitespace();

            if (!parser.isAtEnd() && parser.current().isString()) {
                const fileToken = parser.current();
                const filename = parser.extractStringValue(fileToken.value);

                parser.includes.push({
                    file: filename,
                    line: token.line,
                    column: token.column,
                    isRequire: true,
                });

                // Advance past the string token
                parser.advance();
                parser.skipWhitespace();

                // Consume the closing parenthesis
                if (!parser.isAtEnd() && parser.current().type === TokenType.PAREN_CLOSE) {
                    parser.advance();
                }

                // Process the require if host interface is available
                if (parser.host) {
                    await parser.processRequireDirective(filename, token.line);
                }
            }
        }
    }
    //#endregion

    //#region Macro Definition
    /**
     * Handle #define directive (LSL)
     */
    private static handleDefineDirective(parser: Parser): void {
        // #define NAME [(params)] replacement-text
        const directiveToken = parser.current();
        parser.advance();

        // Skip only horizontal whitespace, not newlines
        while (!parser.isAtEnd() && parser.current().type === TokenType.WHITESPACE) {
            parser.advance();
        }

        // PAR002: Check for missing macro name
        if (parser.isAtEnd() || parser.current().type === TokenType.NEWLINE) {
            parser.diagnostics.addError(
                '#define directive requires a macro name',
                {
                    line: directiveToken.line,
                    column: directiveToken.column,
                    length: directiveToken.value.length,
                    sourceFile: parser.sourceFile,
                },
                ErrorCodes.MISSING_DIRECTIVE_ARGUMENT
            );
            return;
        }

        // PAR003: Check for invalid macro name (e.g., starting with digit)
        if (!parser.current().isIdentifier()) {
            parser.diagnostics.addError(
                `Invalid macro name: expected identifier, got ${parser.current().type}`,
                {
                    line: directiveToken.line,
                    column: parser.current().column,
                    length: parser.current().value.length,
                    sourceFile: parser.sourceFile,
                },
                ErrorCodes.INVALID_MACRO_DEFINITION
            );
            return;
        }

        const nameToken = parser.current();
        const macroName = nameToken.value;

        parser.advance();

        let isFunctionLike = false;
        let parameters: string[] | undefined;

        if (!parser.isAtEnd() && parser.current().type === TokenType.PAREN_OPEN) {
            isFunctionLike = true;
            parameters = parser.parseParameterList();

            // PAR003: Check for duplicate parameters
            if (parameters) {
                const seen = new Set<string>();
                for (const param of parameters) {
                    if (seen.has(param)) {
                        parser.diagnostics.addError(
                            `Duplicate parameter name '${param}' in macro definition`,
                            {
                                line: nameToken.line,
                                column: nameToken.column,
                                length: macroName.length,
                                sourceFile: parser.sourceFile,
                            },
                            ErrorCodes.INVALID_MACRO_DEFINITION
                        );
                        return;
                    }
                    seen.add(param);
                }
            }
        }

        // Collect replacement tokens (rest of line)
        // NOTE: Don't call skipWhitespace() here because it skips newlines too!
        // collectDirectiveBody() will skip whitespace tokens but stop at newlines
        const rawBody = parser.collectDirectiveBody();

        // Trim leading and trailing whitespace from macro body
        const body = parser.trimWhitespace(rawBody);

        // Define macro using MacroProcessor
        parser.state.macros.define({
            name: macroName,
            parameters,
            body,
            isFunctionLike,
        });

        parser.macroInfos.push({
            name: macroName,
            line: nameToken.line,
            column: nameToken.column,
            isFunctionLike,
            parameters,
        });
    }

    /**
     * Handle #undef directive (LSL)
     */
    private static handleUndefDirective(parser: Parser): void {
        // #undef NAME
        const directiveToken = parser.current();
        parser.advance();

        // Skip only horizontal whitespace, not newlines
        while (!parser.isAtEnd() && parser.current().type === TokenType.WHITESPACE) {
            parser.advance();
        }

        // PAR002: Check for missing macro name
        if (parser.isAtEnd() || parser.current().type === TokenType.NEWLINE || !parser.current().isIdentifier()) {
            parser.diagnostics.addError(
                '#undef directive requires a macro name',
                {
                    line: directiveToken.line,
                    column: directiveToken.column,
                    length: directiveToken.value.length,
                    sourceFile: parser.sourceFile,
                },
                ErrorCodes.MISSING_DIRECTIVE_ARGUMENT
            );
            return;
        }

        const macroName = parser.current().value;

        // Remove macro definition using MacroProcessor
        parser.state.macros.undefine(macroName);
    }
    //#endregion

    //#region Conditional Compilation Directives
    /**
     * Handle #ifdef or #ifndef directive (LSL)
     */
    private static handleIfdefDirective(parser: Parser, negate: boolean): void {
        const directiveToken = parser.current();
        const column = directiveToken.column;
        const directiveName = negate ? '#ifndef' : '#ifdef';

        parser.advance();

        // Skip only horizontal whitespace, not newlines
        while (!parser.isAtEnd() && parser.current().type === TokenType.WHITESPACE) {
            parser.advance();
        }

        // PAR002: Check for missing macro name argument
        if (parser.isAtEnd() || parser.current().type === TokenType.NEWLINE || !parser.current().isIdentifier()) {
            parser.diagnostics.addError(
                `${directiveName} directive requires a macro name argument`,
                {
                    line: directiveToken.line,
                    column: directiveToken.column,
                    length: directiveToken.value.length,
                    sourceFile: parser.sourceFile,
                },
                ErrorCodes.MISSING_DIRECTIVE_ARGUMENT
            );
            // Still process as false condition to continue parsing
            const result = negate
                ? parser.state.conditionals.processIfndef('', parser.state.macros, directiveToken.line, parser.sourceFile, column)
                : parser.state.conditionals.processIfdef('', parser.state.macros, directiveToken.line, parser.sourceFile, column);

            if (result.diagnostic) {
                parser.diagnostics?.add(result.diagnostic);
            }
            return;
        }

        const macroName = parser.current().value;
        const line = parser.current().line;

        const result = negate
            ? parser.state.conditionals.processIfndef(macroName, parser.state.macros, line, parser.sourceFile, column)
            : parser.state.conditionals.processIfdef(macroName, parser.state.macros, line, parser.sourceFile, column);

        if (result.diagnostic) {
            parser.diagnostics?.add(result.diagnostic);
        }
    }

    /**
     * Handle #if directive (LSL)
     */
    private static handleIfDirective(parser: Parser): void {
        const directiveToken = parser.current();
        const column = directiveToken.column;

        // Collect tokens until end of line for expression evaluation
        parser.advance();
        parser.skipWhitespace();

        const conditionTokens: Token[] = [];
        const line = parser.current().line;

        // Collect all tokens until newline
        while (!parser.isAtEnd() && parser.current().type !== TokenType.NEWLINE) {
            if (parser.current().type !== TokenType.WHITESPACE) {
                conditionTokens.push(parser.current());
            }
            parser.advance();
        }

        const result = parser.state.conditionals.processIf(conditionTokens, parser.state.macros, line, parser.sourceFile, column);
        if (result.diagnostic) {
            parser.diagnostics?.add(result.diagnostic);
        }
    }

    /**
     * Handle #elif directive (LSL)
     */
    private static handleElifDirective(parser: Parser): void {
        const directiveToken = parser.current();
        const column = directiveToken.column;

        // Collect tokens until end of line for expression evaluation
        parser.advance();
        parser.skipWhitespace();

        const conditionTokens: Token[] = [];
        const line = parser.current().line;

        // Collect all tokens until newline
        while (!parser.isAtEnd() && parser.current().type !== TokenType.NEWLINE) {
            if (parser.current().type !== TokenType.WHITESPACE) {
                conditionTokens.push(parser.current());
            }
            parser.advance();
        }

        const result = parser.state.conditionals.processElif(conditionTokens, parser.state.macros, line, parser.sourceFile, column);
        if (result.diagnostic) {
            parser.diagnostics?.add(result.diagnostic);
        }
    }

    /**
     * Handle #else directive (LSL)
     */
    private static handleElseDirective(parser: Parser): void {
        const directiveToken = parser.current();
        const line = directiveToken.line;
        const column = directiveToken.column;

        const result = parser.state.conditionals.processElse(line, parser.sourceFile, column);
        if (result.diagnostic) {
            parser.diagnostics?.add(result.diagnostic);
        }
    }

    /**
     * Handle #endif directive (LSL)
     */
    private static handleEndifDirective(parser: Parser): void {
        const directiveToken = parser.current();
        const line = directiveToken.line;
        const column = directiveToken.column;

        const result = parser.state.conditionals.processEndif(line, parser.sourceFile, column);
        if (result.diagnostic) {
            parser.diagnostics?.add(result.diagnostic);
        }
    }

    //#endregion

    //#region Conditional Compilation Helpers

    private shouldEmitToken(): boolean {
        // Delegate to conditional processor
        return this.state.conditionals.isActive();
    }

    //#endregion
    //#endregion

    //#region Token Emission

    /**
     * Emit a token to output and track line mapping
     * @returns true if the position was advanced beyond the current token (e.g., for function-like macros)
     */
    private emitToken(token: Token): boolean {
        // Check for macro expansion
        if (token.isIdentifier() && this.state.macros.isDefined(token.value)) {
            return this.expandMacro(token);
        }

        // Handle newlines first - emit the newline, then check for line skips on the NEXT line
        if (token.type === TokenType.NEWLINE) {
            this.outputTokens.push(token);
            this.lastEmittedTokenType = TokenType.NEWLINE;
            this.currentOutputLine++;
            this.lineDirectiveEmittedForCurrentLine = false;  // Reset for next line
            return false;
        }

        // Detect line skips or file changes BEFORE emitting tokens
        // Check on whitespace at start of line OR on meaningful (non-whitespace/non-comment) tokens
        // Check once per output line
        const isLeadingWhitespace = token.type === TokenType.WHITESPACE && this.lastEmittedTokenType === TokenType.NEWLINE;
        const isMeaningfulToken = token.type !== TokenType.WHITESPACE &&
            token.type !== TokenType.BLOCK_COMMENT_START &&
            token.type !== TokenType.BLOCK_COMMENT_CONTENT &&
            token.type !== TokenType.BLOCK_COMMENT_END;

        if ((isLeadingWhitespace || isMeaningfulToken) &&
            !this.lineDirectiveEmittedForCurrentLine) {

            const lineSkip = token.line - this.lastSourceLine;
            const fileChanged = this.sourceFile !== this.lastSourceFile;

            // Insert @line directive if we skipped lines (gap > 1) or changed files
            if ((lineSkip > 1 || fileChanged) && this.lastSourceLine > 0) {
                const languageConfig = getLanguageConfig(this.language);
                const lineDirectiveText = `${languageConfig.lineCommentPrefix} @line ${token.line} "${this.formatPathForLineDirective(this.sourceFile)}"`;
                const lineDirective = new Token(
                    TokenType.LINE_COMMENT,
                    lineDirectiveText,
                    token.line,
                    1,
                    lineDirectiveText.length
                );
                this.outputTokens.push(lineDirective);
                this.outputTokens.push(new Token(TokenType.NEWLINE, this.lineEnding, token.line, lineDirectiveText.length + 1, 1));
                this.lastEmittedTokenType = TokenType.NEWLINE;
                this.currentOutputLine++;
                this.lineDirectiveEmittedForCurrentLine = true;

                // Update tracking after emitting @line directive
                this.lastSourceLine = token.line;
                this.lastSourceFile = this.sourceFile;
            }

            // Update tracking for meaningful tokens (including line comments now)
            // This handles the case where we didn't emit a directive but still need to track
            if (isMeaningfulToken) {
                this.lastSourceLine = token.line;
                this.lastSourceFile = this.sourceFile;
            }
        }

        this.outputTokens.push(token);
        this.lastEmittedTokenType = token.type;
        return false;
    }

    /**
     * Format a file path for use in @line directives.
     * Attempts to make paths workspace-relative for portability and readability.
     * Falls back to normalized absolute paths if file is outside workspace.
     */
    private formatPathForLineDirective(absolutePath: NormalizedPath): string {
        return this.host?.fileNameToUri(absolutePath) ?? ("file://" + absolutePath);
    }

    /**
     * Expand a macro invocation
     * @returns true if the position was advanced beyond the current token
     */
    private expandMacro(token: Token): boolean {
        const macro = this.state.macros.getMacro(token.value);
        if (!macro) {
            // Macro not found - emit as-is
            this.outputTokens.push(token);
            return false;
        }

        if (macro.isFunctionLike) {
            // Look ahead for argument list
            const savedPos = this.position;
            this.advance();
            this.skipWhitespace();

            if (this.isAtEnd() || this.current().type !== TokenType.PAREN_OPEN) {
                // PAR006: Function-like macro used without arguments
                // This is technically valid (the identifier is left unexpanded)
                // but we can optionally warn about it
                this.diagnostics.addWarning(
                    `Function-like macro '${token.value}' used without parentheses`,
                    {
                        line: token.line,
                        column: token.column,
                        length: token.value.length,
                        sourceFile: this.sourceFile,
                    },
                    ErrorCodes.INVALID_MACRO_INVOCATION
                );
                // Restore position and emit identifier as-is
                this.position = savedPos;
                this.outputTokens.push(token);
                return false;
            }

            const args = this.parseArgumentList();

            // Expand using MacroProcessor with context and diagnostics
            const context: MacroExpansionContext = {
                line: token.line,
                column: token.column,
                sourceFile: this.sourceFile
            };

            const expanded = this.state.macros.expandFunction(
                token.value,
                args,
                context,
                undefined,
                this.diagnostics,
                this.sourceFile,
                token.line,
                token.column
            );
            if (expanded) {
                for (const expandedToken of expanded) {
                    this.outputTokens.push(expandedToken);
                }
            } else {
                // Expansion failed (diagnostics already added by MacroProcessor)
                // Emit the original token
                this.outputTokens.push(token);
            }
            // Position was advanced past the closing parenthesis by parseArgumentList()
            return true;
        } else {
            // Simple macro - expand using MacroProcessor
            const context: MacroExpansionContext = {
                line: token.line,
                column: token.column,
                sourceFile: this.sourceFile
            };

            const expanded = this.state.macros.expandSimple(
                token.value,
                context,
                undefined,  // expanding set
                this.diagnostics,  // Pass diagnostics collector
                this.sourceFile,
                token.line,
                token.column
            );
            if (expanded) {
                for (const expandedToken of expanded) {
                    this.outputTokens.push(expandedToken);
                }
            }
            // Simple macros don't advance position
            return false;
        }
    }

    //#endregion

    //#region Token Stream Navigation

    private current(): Token {
        return this.tokens[this.position];
    }

    private advance(): Token {
        const token = this.current();
        if (this.position < this.tokens.length - 1) {
            this.position++;
        }
        return token;
    }

    private isAtEnd(): boolean {
        return this.position >= this.tokens.length ||
               this.current().type === TokenType.EOF;
    }

    private skipWhitespace(): void {
        while (!this.isAtEnd() && this.current().isWhitespaceOrNewline()) {
            this.advance();
        }
    }

    private consumeDirectiveLine(): void {
        // Consume tokens until end of line
        let consumed = 0;
        while (!this.isAtEnd() && this.current().type !== TokenType.NEWLINE) {
            this.advance();
            consumed++;
            if (consumed > 50) {
                break; // Safety limit
            }
        }
    }

    //#endregion

    //#region Parsing Helpers

    /**
     * Parse parameter list for function-like macro: (a, b, c)
     */
    private parseParameterList(): string[] {
        const parameters: string[] = [];

        this.advance(); // consume (
        this.skipWhitespace();

        while (!this.isAtEnd() && this.current().type !== TokenType.PAREN_CLOSE) {
            if (this.current().isIdentifier()) {
                parameters.push(this.current().value);
                this.advance();
                this.skipWhitespace();

                if (!this.isAtEnd() && this.current().value === ',') {
                    this.advance();
                    this.skipWhitespace();
                }
            } else {
                this.advance(); // skip unexpected token
            }
        }

        if (!this.isAtEnd() && this.current().type === TokenType.PAREN_CLOSE) {
            this.advance(); // consume )
        }

        return parameters;
    }

    /**
     * Parse argument list for macro invocation: (expr1, expr2, expr3)
     */
    private parseArgumentList(): Token[][] {
        const args: Token[][] = [];
        let currentArg: Token[] = [];
        let parenDepth = 0;

        this.advance(); // consume (

        while (!this.isAtEnd()) {
            const token = this.current();

            if (token.type === TokenType.PAREN_OPEN) {
                parenDepth++;
                currentArg.push(token);
            } else if (token.type === TokenType.PAREN_CLOSE) {
                if (parenDepth === 0) {
                    // End of argument list
                    if (currentArg.length > 0) {
                        // Trim whitespace from argument
                        const trimmed = this.trimWhitespace(currentArg);
                        if (trimmed.length > 0) {
                            args.push(trimmed);
                        }
                    }
                    this.advance(); // consume )
                    break;
                }
                parenDepth--;
                currentArg.push(token);
            } else if (token.value === ',' && parenDepth === 0) {
                // Argument separator
                // Trim whitespace from argument
                const trimmed = this.trimWhitespace(currentArg);
                if (trimmed.length > 0) {
                    args.push(trimmed);
                }
                currentArg = [];
            } else {
                currentArg.push(token);
            }

            this.advance();
        }

        return args;
    }

    /**
     * Trim leading and trailing whitespace tokens from an array
     */
    private trimWhitespace(tokens: Token[]): Token[] {
        let start = 0;
        let end = tokens.length;

        // Find first non-whitespace token
        while (start < end && tokens[start].isWhitespaceOrNewline()) {
            start++;
        }

        // Find last non-whitespace token
        while (end > start && tokens[end - 1].isWhitespaceOrNewline()) {
            end--;
        }

        return tokens.slice(start, end);
    }

    /**
     * Collect tokens for directive body (rest of line)
     * Supports line continuation with backslash (\)
     * For line continuations, removes backslash, newline, and leading whitespace on next line
     */
    private collectDirectiveBody(): Token[] {
        const body: Token[] = [];

        while (!this.isAtEnd()) {
            const token = this.current();

            // Check if token is or contains a newline
            const hasNewline = token.type === TokenType.NEWLINE || token.value.includes('\n');

            if (hasNewline) {
                // Check if previous token was a backslash (line continuation)
                if (body.length > 0) {
                    const lastToken = body[body.length - 1];
                    if (lastToken.value === '\\') {
                        // Remove the backslash
                        body.pop();
                        // Skip the newline
                        this.advance();
                        // Skip any leading whitespace on the continuation line
                        while (!this.isAtEnd() && this.current().type === TokenType.WHITESPACE) {
                            this.advance();
                        }
                        continue; // Continue collecting from next line
                    }
                }
                // End of directive body
                break;
            }

            // Keep all tokens including whitespace for proper macro expansion
            body.push(token);
            this.advance();
        }

        return body;
    }

    /**
     * Extract string value from quoted string token
     */
    private extractStringValue(quotedString: string): string {
        // Remove quotes from string literal
        if (quotedString.length >= 2) {
            const firstChar = quotedString[0];
            const lastChar = quotedString[quotedString.length - 1];
            if ((firstChar === '"' || firstChar === "'" || firstChar === '`') &&
                firstChar === lastChar) {
                return quotedString.substring(1, quotedString.length - 1);
            }
        }
        return quotedString;
    }

    //#endregion

    //#region Include Processing

    /**
     * Process an include directive by reading, parsing, and merging the included file
     */
    private async processIncludeDirective(filename: string, lineNumber: number, isRequire: boolean): Promise<void> {
        if (!this.host || !this.state.includes) {
            throw new Error('Cannot process includes without host interface');
        }

        // Use the include processor to handle the include
        const result = await this.state.includes.processInclude(
            filename,
            this.sourceFile,
            isRequire,
            this.state.includeState,
            this.state.macros,
            this.state.conditionals,
            this.diagnostics,
            lineNumber,
            0  // column position
        );

        if (!result.success) {
            // Error diagnostic already added by IncludeProcessor
            // Don't throw - continue processing to collect more errors
            return;
        }

        // If no tokens were returned (e.g., include guard), just return
        if (result.tokens.length === 0) {
            return;
        }

        // Push to include stack before parsing nested file
        this.state.includeState.includeStack.push(result.resolvedPath!);
        this.state.includeState.includeDepth++;

        try {
            // Create a parser for the included file with shared state.
            // Pass parent's directives so child inherits the same handlers.
            // Handlers receive the parser as a parameter, so they work correctly
            // with both parent and child parser instances.
            const includeParser = new Parser(
                result.tokens,
                result.resolvedPath!,
                this.language,
                this.host,
                this.directives, // Inherit parent's directive handlers
                {
                    macros: this.state.macros, // Share by reference
                    conditionals: this.state.conditionals, // Share by reference
                    includes: this.state.includes, // Share by reference
                    includeState: this.state.includeState, // Share by reference
                    requireState: this.state.requireState, // Share by reference
                },
                false, // isTopLevel = false for included files
                this.workspaceRoots // Pass workspace roots to child parser
            );

            // Parse the included file
            const includeResult = await includeParser.parse();

            // Merge diagnostics from the included file into parent
            this.diagnostics.merge(includeParser.diagnostics);

            // Add @line directive at the start of the included file's output
            const languageConfig = getLanguageConfig(this.language);
            const lineDirectiveText = `${languageConfig.lineCommentPrefix} @line 1 "${this.formatPathForLineDirective(result.resolvedPath!)}"`;
            const lineDirective = new Token(
                TokenType.LINE_COMMENT,
                lineDirectiveText,
                1,
                1,
                lineDirectiveText.length
            );
            this.outputTokens.push(lineDirective);

            // Add a newline after the line directive (using parent file's line ending style)
            this.outputTokens.push(new Token(TokenType.NEWLINE, this.lineEnding, 1, lineDirectiveText.length + 1, 1));

            // Directly add the output tokens from the included file to our output
            for (const token of includeParser.outputTokens) {
                this.outputTokens.push(token);
            }

            // After adding included tokens, we need to update tracking to reflect
            // the state as if we'd just emitted those tokens through emitToken()
            // Find the last meaningful token from the included file to get proper line tracking
            for (let i = includeParser.outputTokens.length - 1; i >= 0; i--) {
                const token = includeParser.outputTokens[i];
                const isMeaningful = token.type !== TokenType.WHITESPACE &&
                    token.type !== TokenType.BLOCK_COMMENT_START &&
                    token.type !== TokenType.BLOCK_COMMENT_CONTENT &&
                    token.type !== TokenType.BLOCK_COMMENT_END;
                if (isMeaningful) {
                    this.lastSourceLine = token.line;
                    this.lastSourceFile = result.resolvedPath!;
                    break;
                }
            }

            // Reset the flag so the next token from parent file will trigger file change detection
            this.lineDirectiveEmittedForCurrentLine = false;

            // Merge the mappings, includes, and macros from the included file
            this.mappings.push(...includeResult.mappings);
            this.includes.push(...includeResult.includes);
            this.macroInfos.push(...includeResult.macros);

        } finally {
            // Pop from include stack after parsing nested file
            this.state.includeState.includeStack.pop();
            this.state.includeState.includeDepth--;
        }
    }

    /**
     * Process a require directive by reading, parsing, wrapping, and registering the module
     */
    private async processRequireDirective(filename: string, lineNumber: number): Promise<void> {
        if (!this.host || !this.state.includes) {
            throw new Error('Cannot process requires without host interface');
        }

        // Ensure requireState is initialized
        if (!this.state.requireState) {
            this.state.requireState = Parser.createRequireState();
        }

        // Use the include processor to read and tokenize the file
        const result = await this.state.includes.processInclude(
            filename,
            this.sourceFile,
            true, // isRequire
            this.state.includeState,
            this.state.macros,
            this.state.conditionals,
            this.diagnostics,
            lineNumber,
            0  // column position
        );

        if (!result.success) {
            // Error diagnostic already added by IncludeProcessor
            // Don't throw - continue processing to collect more errors
            return;
        }

        // If no tokens were returned, just return
        if (result.tokens.length === 0 || !result.resolvedPath) {
            return;
        }

        const resolvedPath = result.resolvedPath;

        // Check if this module has already been registered
        let moduleId = this.state.requireState.moduleMap.get(resolvedPath);

        if (moduleId === undefined) {
            // New module - assign it an ID and process it
            moduleId = this.state.requireState.nextModuleId++;
            this.state.requireState.moduleMap.set(resolvedPath, moduleId);

            // Parse the required file and wrap it
            // Push to include stack before parsing nested file
            this.state.includeState.includeStack.push(resolvedPath);
            this.state.includeState.includeDepth++;

            try {
                // Create a parser for the required file with shared state
                // Pass the entire requireState object reference (not a copy)
                const requireParser = new Parser(
                    result.tokens,
                    resolvedPath,
                    this.language,
                    this.host,
                    this.directives,
                    {
                        macros: this.state.macros,
                        conditionals: this.state.conditionals,
                        includes: this.state.includes,
                        includeState: this.state.includeState,
                        requireState: this.state.requireState, // Share the entire requireState object
                    },
                    false, // Nested parser is NOT top-level
                    this.workspaceRoots // Pass workspace roots to child parser
                );

                // Parse the required file
                const requireResult = await requireParser.parse();

                // Merge diagnostics from the required file into parent
                this.diagnostics.merge(requireParser.diagnostics);

                // Wrap the parsed output in a function
                const wrappedTokens = this.wrapModuleInFunction(
                    requireParser.outputTokens,
                    resolvedPath,
                    lineNumber
                );

                // Store the wrapped module
                this.state.requireState.wrappedModules.set(moduleId, wrappedTokens);

                // Merge the mappings, includes, and macros from the required file
                this.mappings.push(...requireResult.mappings);
                this.includes.push(...requireResult.includes);
                this.macroInfos.push(...requireResult.macros);

            } finally {
                // Pop from include stack after parsing nested file
                this.state.includeState.includeStack.pop();
                this.state.includeState.includeDepth--;
            }
        }

        // Emit the module invocation at the point of require()
        // __require_table[moduleId]()
        this.emitRequireInvocation(moduleId);
    }

    /**
     * Wrap module tokens in an anonymous function
     */
    private wrapModuleInFunction(moduleTokens: Token[], resolvedPath: NormalizedPath, lineNumber: number): Token[] {
        const wrapped: Token[] = [];
        const languageConfig = getLanguageConfig(this.language);

        // Opening: (function()
        wrapped.push(new Token(TokenType.PAREN_OPEN, '(', lineNumber, 1, 1));
        wrapped.push(new Token(TokenType.IDENTIFIER, 'function', lineNumber, 2, 8));
        wrapped.push(new Token(TokenType.PAREN_OPEN, '(', lineNumber, 10, 1));
        wrapped.push(new Token(TokenType.PAREN_CLOSE, ')', lineNumber, 11, 1));
        wrapped.push(new Token(TokenType.NEWLINE, this.lineEnding, lineNumber, 12, 1));

        // Add @line directive
        const lineDirectiveText = `${languageConfig.lineCommentPrefix} @line 1 "${this.formatPathForLineDirective(resolvedPath)}"`;
        wrapped.push(new Token(TokenType.LINE_COMMENT, lineDirectiveText, lineNumber + 1, 1, lineDirectiveText.length));
        wrapped.push(new Token(TokenType.NEWLINE, this.lineEnding, lineNumber + 1, lineDirectiveText.length + 1, 1));

        // Add the module content
        wrapped.push(...moduleTokens);

        // Closing: end)()
        console.log("LAST TOKEN",wrapped[wrapped.length - 1]);
        if(wrapped[wrapped.length-1].type !== TokenType.NEWLINE) {
            wrapped.push(new Token(TokenType.NEWLINE, this.lineEnding, lineNumber, lineDirectiveText.length + 1, 1));
        }
        wrapped.push(new Token(TokenType.IDENTIFIER, 'end', lineNumber, 1, 3));
        wrapped.push(new Token(TokenType.PAREN_CLOSE, ')', lineNumber, 4, 1));

        return wrapped;
    }

    /**
     * Emit the invocation code for a required module
     */
    private emitRequireInvocation(moduleId: number): void {
        // Emit: __require_table[moduleId]()
        const line = this.current().line;

        this.outputTokens.push(new Token(TokenType.IDENTIFIER, '__require_table', line, 1, 15));
        this.outputTokens.push(new Token(TokenType.BRACKET_OPEN, '[', line, 16, 1));
        this.outputTokens.push(new Token(TokenType.NUMBER_LITERAL, moduleId.toString(), line, 17, moduleId.toString().length));
        this.outputTokens.push(new Token(TokenType.BRACKET_CLOSE, ']', line, 17 + moduleId.toString().length, 1));
        this.outputTokens.push(new Token(TokenType.PAREN_OPEN, '(', line, 18 + moduleId.toString().length, 1));
        this.outputTokens.push(new Token(TokenType.PAREN_CLOSE, ')', line, 19 + moduleId.toString().length, 1));
    }

    //#endregion

    //#region Output Generation

    /**
     * Reconstruct source code from output tokens and build line mappings from @line directives
     */
    private reconstructSource(): string {
        // Clear existing mappings - we'll rebuild from @line directives
        this.mappings = [];

        let outputLine = 1;
        let currentSourceFile: NormalizedPath = this.sourceFile;
        let currentSourceLine = 1;
        const languageConfig = getLanguageConfig(this.language);
        const lineDirectivePrefix = `${languageConfig.lineCommentPrefix} @line `;

        for (let i = 0; i < this.outputTokens.length; i++) {
            const token = this.outputTokens[i];

            // Check if this token is an @line directive
            if (token.type === TokenType.LINE_COMMENT && token.value.startsWith(lineDirectivePrefix)) {
                // Parse the @line directive: // @line 123 "filename"
                const directiveContent = token.value.substring(lineDirectivePrefix.length).trim();
                const match = directiveContent.match(/^(\d+)\s+"([^"]+)"$/);

                if (match) {
                    currentSourceLine = parseInt(match[1], 10);
                    currentSourceFile = this.host?.uriToFileName(match[2]) ?? match[2] as NormalizedPath;
                }

                // Skip to next token (should be newline)
                if (i + 1 < this.outputTokens.length && this.outputTokens[i + 1].type === TokenType.NEWLINE) {
                    i++; // Skip the newline after @line directive
                    outputLine++; // But count the line in output
                }
                continue;
            }

            // For newlines, add mapping and increment counters
            if (token.type === TokenType.NEWLINE) {
                this.mappings.push({
                    processedLine: outputLine,
                    originalLine: currentSourceLine,
                    sourceFile: currentSourceFile,
                });
                outputLine++;
                currentSourceLine++;
            }
        }

        // Generate the source code
        return this.outputTokens.map(t => t.emit()).join('');
    }

    /**
     * Parse line mappings from preprocessed content containing @line directives.
     * This is the reverse operation of reconstructSource() - it reads @line directives
     * from incoming preprocessed content and builds a mapping array.
     *
     * @param content - The preprocessed source code containing @line directives
     * @param language - The script language (affects comment prefix)
     * @returns Array of line mappings from preprocessed lines to original source locations
     *
     * @example
     * // LSL content with @line directives:
     * // @line 1 "main.lsl"
     * default { state_entry() {
     * // @line 3 "include/math.lsl"
     *     float PI = 3.14159;
     *
     * // Returns mappings:
     * // Line 2 -> main.lsl:1
     * // Line 4 -> math.lsl:3
     */
    public static parseLineMappingsFromContent(content: string, language: ScriptLanguage = "lsl", host: HostInterface): LineMapping[] {
        const lines = content.split('\n');
        const lineMappings: LineMapping[] = [];
        const languageConfig = getLanguageConfig(language);
        const commentPrefix = `${languageConfig.lineCommentPrefix} @line`;

        let currentSourceFile: NormalizedPath | null = null;
        let currentSourceLine = 1;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();

            // Check if line starts with a line directive comment
            if (line.startsWith(commentPrefix)) {
                // Extract the content after the directive prefix
                const directiveContent = line.substring(commentPrefix.length).trim();

                // Parse line number and file path using regex
                // Expected format: "123 \"workspace:///path/to/file.ext\""
                const match = directiveContent.match(/^(\d+)\s+"([^"]+)"$/);

                if (match) {
                    const lineNumber = parseInt(match[1], 10);
                    const sourceFileString = match[2];

                    // Convert URI to normalized path using host
                    currentSourceFile = host.uriToFileName(sourceFileString);
                    currentSourceLine = lineNumber;
                }
            } else if (currentSourceFile) {
                // Map this line to current source location
                const processedLine = i + 1; // Line numbers are 1-based

                lineMappings.push({
                    processedLine: processedLine,
                    sourceFile: currentSourceFile,
                    originalLine: currentSourceLine
                });

                // Advance to next source line
                currentSourceLine++;
            }
        }

        return lineMappings;
    }

    /**
     * Prepend the require table declaration to the output
     * Format: local __require_table = {}
     *         __require_table[1] = <module1>
     *         __require_table[2] = <module2>
     *         ...
     */
    private prependRequireTable(): void {
        if (!this.state.requireState) {
            return; // Nothing to do if requireState doesn't exist
        }

        const tableTokens: Token[] = [];
        const line = 1;

        // local __require_table: { [number]: () -> any } = {}
        tableTokens.push(new Token(TokenType.IDENTIFIER, 'local', line, 1, 5));
        tableTokens.push(new Token(TokenType.WHITESPACE, ' ', line, 6, 1));
        tableTokens.push(new Token(TokenType.IDENTIFIER, '__require_table', line, 7, 15));
        tableTokens.push(new Token(TokenType.OPERATOR, ':', line, 22, 1));
        tableTokens.push(new Token(TokenType.WHITESPACE, ' ', line, 23, 1));
        tableTokens.push(new Token(TokenType.BRACE_OPEN, '{', line, 24, 1));
        tableTokens.push(new Token(TokenType.WHITESPACE, ' ', line, 25, 1));
        tableTokens.push(new Token(TokenType.BRACKET_OPEN, '[', line, 26, 1));
        tableTokens.push(new Token(TokenType.IDENTIFIER, 'number', line, 27, 6));
        tableTokens.push(new Token(TokenType.BRACKET_CLOSE, ']', line, 33, 1));
        tableTokens.push(new Token(TokenType.OPERATOR, ':', line, 34, 1));
        tableTokens.push(new Token(TokenType.WHITESPACE, ' ', line, 35, 1));
        tableTokens.push(new Token(TokenType.PAREN_OPEN, '(', line, 36, 1));
        tableTokens.push(new Token(TokenType.PAREN_CLOSE, ')', line, 37, 1));
        tableTokens.push(new Token(TokenType.WHITESPACE, ' ', line, 38, 1));
        tableTokens.push(new Token(TokenType.OPERATOR, '->', line, 39, 2));
        tableTokens.push(new Token(TokenType.WHITESPACE, ' ', line, 41, 1));
        tableTokens.push(new Token(TokenType.IDENTIFIER, 'any', line, 42, 3));
        tableTokens.push(new Token(TokenType.WHITESPACE, ' ', line, 45, 1));
        tableTokens.push(new Token(TokenType.BRACE_CLOSE, '}', line, 46, 1));
        tableTokens.push(new Token(TokenType.WHITESPACE, ' ', line, 47, 1));
        tableTokens.push(new Token(TokenType.OPERATOR, '=', line, 48, 1));
        tableTokens.push(new Token(TokenType.WHITESPACE, ' ', line, 49, 1));
        tableTokens.push(new Token(TokenType.BRACE_OPEN, '{', line, 50, 1));
        tableTokens.push(new Token(TokenType.BRACE_CLOSE, '}', line, 51, 1));
        tableTokens.push(new Token(TokenType.NEWLINE, '\n', line, 52, 1));

        // Add each module as an assignment: __require_table[id] = <wrapped_module>
        const sortedIds = Array.from(this.state.requireState.wrappedModules.keys()).sort((a, b) => a - b);

        for (const moduleId of sortedIds) {
            const wrappedModule = this.state.requireState.wrappedModules.get(moduleId)!;

            // __require_table[moduleId] =
            tableTokens.push(new Token(TokenType.IDENTIFIER, '__require_table', line, 1, 15));
            tableTokens.push(new Token(TokenType.BRACKET_OPEN, '[', line, 16, 1));
            tableTokens.push(new Token(TokenType.NUMBER_LITERAL, moduleId.toString(), line, 17, moduleId.toString().length));
            tableTokens.push(new Token(TokenType.BRACKET_CLOSE, ']', line, 17 + moduleId.toString().length, 1));
            tableTokens.push(new Token(TokenType.WHITESPACE, ' ', line, 18 + moduleId.toString().length, 1));
            tableTokens.push(new Token(TokenType.OPERATOR, '=', line, 19 + moduleId.toString().length, 1));
            tableTokens.push(new Token(TokenType.WHITESPACE, ' ', line, 20 + moduleId.toString().length, 1));

            // Add the wrapped module tokens
            tableTokens.push(...wrappedModule);

            // Add newline
            tableTokens.push(new Token(TokenType.NEWLINE, '\n', line, 1, 1));
        }

        // Add @line directive to reset to main file
        const languageConfig = getLanguageConfig(this.language);
        const lineDirectiveText = `${languageConfig.lineCommentPrefix}@line 1 "${this.sourceFile}"`;
        tableTokens.push(new Token(TokenType.LINE_COMMENT, lineDirectiveText, line, 1, lineDirectiveText.length));
        tableTokens.push(new Token(TokenType.NEWLINE, '\n', line, lineDirectiveText.length + 1, 1));

        // Prepend to output
        this.outputTokens.unshift(...tableTokens);
    }

    /**
     * Append the require table cleanup to the output
     * Format: __require_table = nil :: any
     */
    private appendRequireTableCleanup(): void {
        const line = this.currentOutputLine;

        // __require_table = nil :: any (type cast to allow nil assignment)
        this.outputTokens.push(new Token(TokenType.IDENTIFIER, '__require_table', line, 1, 15));
        this.outputTokens.push(new Token(TokenType.WHITESPACE, ' ', line, 16, 1));
        this.outputTokens.push(new Token(TokenType.OPERATOR, '=', line, 17, 1));
        this.outputTokens.push(new Token(TokenType.WHITESPACE, ' ', line, 18, 1));
        this.outputTokens.push(new Token(TokenType.IDENTIFIER, 'nil', line, 19, 3));
        this.outputTokens.push(new Token(TokenType.WHITESPACE, ' ', line, 22, 1));
        this.outputTokens.push(new Token(TokenType.OPERATOR, '::', line, 23, 2));
        this.outputTokens.push(new Token(TokenType.WHITESPACE, ' ', line, 25, 1));
        this.outputTokens.push(new Token(TokenType.IDENTIFIER, 'any', line, 26, 3));
        this.outputTokens.push(new Token(TokenType.NEWLINE, '\n', line, 29, 1));
    }

    //#endregion
}

//#endregion
