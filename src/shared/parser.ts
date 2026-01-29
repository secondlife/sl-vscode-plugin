/**
 * @file parser.ts
 * Parser for LSL and SLua preprocessor directives
 * Copyright (C) 2025, Linden Research, Inc.
 *
 * Consumes token stream from lexer and produces preprocessed output.
 */

import * as path from 'path';
import { LanguageLexerConfig, Token, TokenType } from './lexer';
import { NormalizedPath, HostInterface } from '../interfaces/hostinterface';
import { FullConfigInterface, ConfigKey } from '../interfaces/configinterface';
import type { DirectiveImplementations } from './lexingpreprocessor';
import { MacroProcessor, MacroExpansionContext } from './macroprocessor';
import { ConditionalProcessor } from './conditionalprocessor';
import { IncludeProcessor, IncludeState } from './includeprocessor';
import { DiagnosticCollector, PreprocessorDiagnostic, ErrorCodes, DiagnosticError, DiagnosticSeverity } from './diagnostics';

//#region Parser State

/**
 * State for tracking required modules (SLua)
 */
export interface RequireState {
    /** Map of resolved file path to module ID */
    moduleMap: Map<NormalizedPath, number>;
    /** Map of module ID to resolved file path */
    modulePathMap: Map<number, NormalizedPath>;
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
    /** Set of unique identifiers to use for naming things like switch/loop jumps */
    uniqueidentifiers: Set<string>;
    /** Random number state, for deterministic random number generation */
    random: RNG;
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
    path?: string;
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

class HaltParseError extends Error{}

type CaseBlock = {
    defaultCase: boolean;
    condition: Token[];
    body: Token[];
    identifier: string;
    commentsBefore: Token[];
    commentsAfter: Token[];
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
    private language: LanguageLexerConfig;

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

    // Flag whether external require is allowed, passed down when using .luarc
    private allowExternalRequires: boolean = false;
    private indentationLevel: number = 0;

    constructor(
        tokens: Token[],
        sourceFile: NormalizedPath,
        language: LanguageLexerConfig,
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
            macros: initialState?.macros || new MacroProcessor(),
            conditionals: initialState?.conditionals || new ConditionalProcessor(this.language),
            includes: initialState?.includes || (host ? new IncludeProcessor(this.language, host) : undefined as any),
            includeState: initialState?.includeState || IncludeProcessor.createState(maxIncludeDepth, includePaths),
            uniqueidentifiers: initialState?.uniqueidentifiers || new Set<string>(),
            random: initialState?.random || new RNG(),
        };

        // Only initialize requireState for SLua (luau) files or if explicitly provided
        if (initialState?.requireState !== undefined) {
            this.state.requireState = initialState.requireState;
        } else if (this.language.name === 'luau' && isTopLevel) {
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
            switch: async (parser: Parser) => Parser.handleSwitchDirective(parser),
        };
    }

    /**
     * Create initial require state
     */
    public static createRequireState(): RequireState {
        return {
            moduleMap: new Map(),
            modulePathMap: new Map(),
            wrappedModules: new Map(),
            nextModuleId: 1,
        };
    }

    /**
     * Create initial parser state with optional predefined macros
     * This allows the preprocessor to inject predefined macros before parsing begins
     */
    public static createInitialState(
        language: LanguageLexerConfig,
        host?: HostInterface,
        macros?: MacroProcessor,
        maxIncludeDepth: number = 5,
        includePaths: string[] = ['.']
    ): ParserState {
        return {
            macros: macros ?? new MacroProcessor(),
            conditionals: new ConditionalProcessor(language),
            includes: host ? new IncludeProcessor(language, host) : undefined as any,
            includeState: IncludeProcessor.createState(maxIncludeDepth, includePaths),
            uniqueidentifiers: new Set<string>(),
            random: new RNG(),
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

        // State Conditionals are passed between parsers
        // so we need to check that we exit at the same level we came in on
        const entryBlock = this.state.conditionals.getCurrentBlockIdentifier();

        // First pass: process all tokens to discover all required modules
        while (!this.isAtEnd()) {
            const token = this.current();

            try {
                await this.parseToken(token);
            } catch(error) {
                if(error instanceof HaltParseError) {
                    // Stop processing on HaltParseError
                } else if(error instanceof DiagnosticError) {
                    this.diagnostics.add(error.diagnostic);
                } else {
                    throw error;
                }
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
        // State Conditionals are passed between parsers
        // so we need to check that we exit at the same block we came in on
        if (this.state.conditionals.getCurrentBlockIdentifier() !== entryBlock) {
            for (const block of this.state.conditionals.getUnclosedBlocks()) {
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
            this.prependRequireFunction();
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

    private async parseToken(token: Token): Promise<void> {
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
        if(this.diagnostics.hasErrors()) {
            throw new HaltParseError();
        }
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
        if (directiveName !== 'require' && directiveName !== 'switch') {
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

        if(!parser.getState().conditionals.isActive()) {
            return;
        }

        // Skip only horizontal whitespace, not newlines
        while (!parser.isAtEnd() && parser.current().type === TokenType.WHITESPACE) {
            parser.advance();
        }

        // PAR002: Check for missing filename argument
        let filename:string|null = null;

        if (!parser.isAtEnd()) {
            const current = parser.current();
            if (current.isString()) {
                const fileToken = parser.current();
                // console.error("INCLUDE",token,fileToken);
                filename = parser.extractStringValue(fileToken.value);
            }
            else if(current.type == TokenType.OPERATOR && current.value == "<") {
                parser.advance();
                let closed = false;
                filename = "";
                while(!parser.isAtEnd()) {
                    const current = parser.current();
                    if(current.type == TokenType.OPERATOR && current.value == ">") {
                        closed = true;
                        break;
                    }
                    if(current.type == TokenType.BLOCK_COMMENT_START) break;
                    if(current.type == TokenType.LINE_COMMENT) break;
                    if(current.type == TokenType.NEWLINE) break;
                    filename += current.value;
                    parser.advance();
                }
                if(!closed) {
                    filename = null;
                }
            }
        }

        if(filename == null) {
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

        // Record the include for tracking
        const include : IncludeInfo = {
            file: filename,
            line: token.line,
            column: token.column,
            isRequire: false,
        };
        parser.includes.push(include);

        // Process the include if host interface is available
        if (parser.host) {
            await parser.processIncludeDirective(include);
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

                const include : IncludeInfo = {
                    file: filename,
                    line: token.line,
                    column: token.column,
                    isRequire: true,
                };
                parser.includes.push(include);

                // Advance past the string token
                parser.advance();
                parser.skipWhitespace();

                // Consume the closing parenthesis
                if (!parser.isAtEnd() && parser.current().type === TokenType.PAREN_CLOSE) {
                    parser.advance();
                }

                // Process the require if host interface is available
                if (parser.host) {
                    await parser.processRequireDirective(include);
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
        if(!parser.getState().conditionals.isActive()) {
            return;
        }

        // Skip only horizontal whitespace, not newlines
        parser.skipNonNewlineWhiteSpace();

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
        if(!parser.getState().conditionals.isActive()) {
            return;
        }

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
     * Handle switch directive (LSL)
     */
    private static handleSwitchDirective(parser: Parser): void {
        const directiveToken = parser.current();
        parser.advance();

        const indentation = parser.indentationLevel;
        const indentationWhitespace = ' '.repeat(indentation);
        parser.skipWhitespace();
        parser.consumeTokenOfType(TokenType.PAREN_OPEN, 'SWITCH directive');
        const condition :Token[] = [];
        let depth = 1;
        while(!parser.isAtEnd()) {
            const current = parser.current();
            if(current.type === TokenType.PAREN_OPEN) {
                depth++;
            } else if(current.type === TokenType.PAREN_CLOSE) {
                depth--;
                if(depth < 1) {
                    parser.advance();
                    break;
                }
            }
            condition.push(current);
            parser.advance();
        }
        const commentsBefore = this.trimTrailingWhiteSpace(parser.consumeWhiteSpaceAndComments());

        parser.consumeTokenOfType(TokenType.BRACE_OPEN, 'SWITCH directive');
        parser.skipWhitespace();

        let caseBlock = this.consumeCaseBlock(parser);
        let cases = [];
        while(caseBlock) {
            cases.push(caseBlock);
            caseBlock = this.consumeCaseBlock(parser);
        }

        if(cases.length < 1) {
            throw new DiagnosticError({
                severity: DiagnosticSeverity.ERROR,
                message: `SWITCH directive requires at least one CASE block`,
                line: directiveToken.line,
                column: directiveToken.column,
                length: directiveToken.value.length,
                sourceFile: parser.sourceFile,
            });
        }

        parser.consumeTokenOfType(TokenType.BRACE_CLOSE, 'SWITCH directive');

        if(cases.filter(c=>c.defaultCase).length > 1) {
            throw new DiagnosticError({
                severity: DiagnosticSeverity.ERROR,
                message: `SWITCH directive cannot have more than one DEFAULT case`,
                line: directiveToken.line,
                column: directiveToken.column,
                length: directiveToken.value.length,
                sourceFile: parser.sourceFile,
            });
        }
        const defaultCase = cases.find(c=>c.defaultCase);
        const outJump = parser.generateUniqueIdentifier(5,"s");
        if(commentsBefore.length > 0) {
            parser.emitTokens(commentsBefore);
            parser.emitToken(new Token(TokenType.NEWLINE, "\n", 0,0,0));
        }
        let first = true;
        for(const c of cases) {
            if(c.defaultCase) continue;
            if(!first)parser.emitToken(new Token(TokenType.WHITESPACE, indentationWhitespace, 0,0,0));
            first = false;
            this.emitCaseIfStatement(parser,condition,c);
        }

        if(!first)parser.emitToken(new Token(TokenType.WHITESPACE, indentationWhitespace, 0,0,0));
        parser.emitToken(new Token(TokenType.IDENTIFIER, `jump`, 0,0,0));
        parser.emitToken(new Token(TokenType.WHITESPACE, " ", 0,0,0));
        parser.emitToken(new Token(TokenType.IDENTIFIER, defaultCase ? defaultCase.identifier : outJump, 0,0,0));
        parser.emitToken(new Token(TokenType.PUNCTUATION, ";", 0,0,0));
        if(defaultCase) parser.emitTokens(defaultCase.commentsBefore);
        parser.emitToken(new Token(TokenType.NEWLINE, "\n", 0,0,0));

        for(const c of cases) {
            this.emitCaseBlock(parser,c,outJump,indentationWhitespace);
        }
        parser.emitToken(new Token(TokenType.WHITESPACE, indentationWhitespace, 0,0,0));
        parser.emitToken(new Token(TokenType.IDENTIFIER, `@${outJump}`, 0,0,0));
        parser.emitToken(new Token(TokenType.PUNCTUATION, ";", 0,0,0));
        // parser.emitToken(new Token(TokenType.NEWLINE, "\n", 0,0,0));
    }

    private static emitCaseBlock(parser: Parser, caseBlock: CaseBlock, outJump: string, indentationWhitespace: string): void {
        parser.emitToken(new Token(TokenType.WHITESPACE, indentationWhitespace, 0,0,0));
        parser.emitToken(new Token(TokenType.IDENTIFIER, `@${caseBlock.identifier}`, 0,0,0));
        parser.emitToken(new Token(TokenType.PUNCTUATION, ";", 0,0,0));
        parser.emitTokens(caseBlock.commentsBefore);
        parser.emitToken(new Token(TokenType.NEWLINE, "\n", 0,0,0));
        if(caseBlock.body.filter(t=>!t.isWhitespaceOrNewline()).length < 1) return;
        parser.emitToken(new Token(TokenType.WHITESPACE, indentationWhitespace, 0,0,0));
        parser.emitToken(new Token(TokenType.BRACE_OPEN, "{", 0,0,0));
        parser.emitToken(new Token(TokenType.NEWLINE, "\n", 0,0,0));
        // parser.emitToken(new Token(TokenType.WHITESPACE, indentationWhitespace, 0,0,0));
        let indentation = 0;
        let lastNewLine = true;
        for(const t of caseBlock.body) {
            if(t.is(TokenType.IDENTIFIER,"break")) {
                parser.emitToken(new Token(TokenType.IDENTIFIER, `jump`, 0,0,0));
                parser.emitToken(new Token(TokenType.WHITESPACE, " ", 0,0,0));
                parser.emitToken(new Token(TokenType.IDENTIFIER, outJump, 0,0,0));
                continue;
            }
            if(lastNewLine) {
                if(!t.isType(TokenType.WHITESPACE)) {
                    if (indentation == 0) {
                        parser.emitToken(new Token(TokenType.WHITESPACE, indentationWhitespace + '    ', 0,0,0));
                    }
                    lastNewLine = false;
                } else {
                    t.value = t.value.substring(4);
                }
            }
            parser.emitToken(t);
            if(lastNewLine && t.type == TokenType.WHITESPACE) {
                indentation += t.value.length;
            }
            if(t.isType(TokenType.NEWLINE)) {
                indentation = 0;
                lastNewLine = true;
            }
        }
        // parser.emitToken(new Token(TokenType.NEWLINE, "\n", 0,0,0));
        // parser.emitToken(new Token(TokenType.WHITESPACE, indentationWhitespace, 0,0,0));
        parser.emitToken(new Token(TokenType.BRACE_CLOSE, "}", 0,0,0));
        parser.emitTokens(caseBlock.commentsAfter);
        parser.emitToken(new Token(TokenType.NEWLINE, "\n", 0,0,0));
    }

    private static emitCaseIfStatement(parser: Parser, condition: Token[], caseBlock: CaseBlock): void {
        parser.emitToken(new Token(TokenType.IDENTIFIER, `if`, 0, 0, 0));
        parser.emitToken(new Token(TokenType.PAREN_OPEN, "(", 0, 0, 0));
        parser.emitToken(new Token(TokenType.PAREN_OPEN, "(", 0, 0, 0));

        parser.emitTokens(condition);

        parser.emitToken(new Token(TokenType.PAREN_CLOSE, ")", 0, 0, 0));
        parser.emitToken(new Token(TokenType.WHITESPACE, " ", 0, 0, 0));
        parser.emitToken(new Token(TokenType.OPERATOR, "==", 0, 0, 0));
        parser.emitToken(new Token(TokenType.WHITESPACE, " ", 0, 0, 0));
        parser.emitToken(new Token(TokenType.PAREN_OPEN, "(", 0, 0, 0));

        parser.emitTokens(caseBlock.condition);

        parser.emitToken(new Token(TokenType.PAREN_CLOSE, ")", 0, 0, 0));
        parser.emitToken(new Token(TokenType.PAREN_CLOSE, ")", 0, 0, 0));
        parser.emitToken(new Token(TokenType.WHITESPACE, " ", 0, 0, 0));
        parser.emitToken(new Token(TokenType.IDENTIFIER, "jump", 0, 0, 0));
        parser.emitToken(new Token(TokenType.WHITESPACE, " ", 0, 0, 0));
        parser.emitToken(new Token(TokenType.IDENTIFIER, caseBlock.identifier, 0, 0, 0));
        parser.emitToken(new Token(TokenType.PUNCTUATION, ";", 0, 0, 0));
        parser.emitToken(new Token(TokenType.NEWLINE, "\n", 0, 0, 0));
    }

    private static consumeCaseBlock(parser: Parser): CaseBlock | null {
        if(parser.isAtEnd()) return null;
        parser.skipWhitespace();
        const keyword = parser.consumeTokenIfType(TokenType.IDENTIFIER);
        if(!keyword) {
            return null;
        }
        if(keyword.value !== 'case' && keyword.value !== 'default') {
            throw new DiagnosticError({
                severity: DiagnosticSeverity.ERROR,
                message: `Expected 'case' or 'default' keyword in SWITCH directive`,
                line: keyword.line,
                column: keyword.column,
                length: keyword.value.length,
                sourceFile: parser.sourceFile,
            });
        }
        const defaultCase = keyword.value === 'default';
        parser.skipWhitespace();
        const condition :Token[] = [];
        while(!parser.isAtEnd()) {
            const current = parser.current();
            if(current.type == TokenType.BRACE_OPEN) break;
            if(current.is(TokenType.OPERATOR,":")) break;
            condition.push(current);
            parser.advance();
        }
        if(parser.isAtEnd()) {
            throw new DiagnosticError({
                severity: DiagnosticSeverity.ERROR,
                message: `Unexpected end of file while parsing CASE block in SWITCH directive`,
                line: keyword.line,
                column: keyword.column,
                length: keyword.value.length,
                sourceFile: parser.sourceFile,
            });
        }

        const commentsBefore = this.trimTrailingWhiteSpace(parser.consumeWhiteSpaceAndComments());
        let current = parser.current();

        if(current.is(TokenType.OPERATOR, ":")) {
            parser.advance();
            commentsBefore.push(...this.trimTrailingWhiteSpace(parser.consumeWhiteSpaceAndComments()));
            current = parser.current();
            if(current.is(TokenType.IDENTIFIER, "case") || current.is(TokenType.IDENTIFIER, "default")) {
                return {
                    identifier: parser.generateUniqueIdentifier(5,"c"),
                    defaultCase,
                    condition,
                    body: [],
                    commentsBefore,
                    commentsAfter:[],
                };
            }
        }
        parser.consumeTokenOfType(TokenType.BRACE_OPEN, 'case condition');
        parser.advance();

        let depth = 1;
        const originalOutput = parser.outputTokens;
        parser.outputTokens = [];
        while(!parser.isAtEnd() && depth > 0) {
            const current = parser.current();
            if(current.type === TokenType.BRACE_OPEN) {
                depth++;
            } else if(current.type === TokenType.BRACE_CLOSE) {
                depth--;
                if(depth === 0) {
                    parser.advance();
                    break;
                }
            }
            parser.parseToken(current);
        }
        const body = parser.outputTokens;
        parser.outputTokens = originalOutput;
        return {
            identifier: parser.generateUniqueIdentifier(5,"c"),
            defaultCase,
            condition,
            body,
            commentsBefore,
            commentsAfter: this.trimTrailingWhiteSpace(parser.consumeWhiteSpaceAndComments()),
        };
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

    private emitTokens(tokens: Token[]): void {
        for (const token of tokens) {
            this.emitToken(token);
        }
    }

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
            this.indentationLevel = 0;
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

        if(isLeadingWhitespace) {
            // Track indentation level
            this.indentationLevel += token.value.length;
        }

        if ((isLeadingWhitespace || isMeaningfulToken) &&
            !this.lineDirectiveEmittedForCurrentLine) {

            const lineSkip = token.line - this.lastSourceLine;
            const fileChanged = this.sourceFile !== this.lastSourceFile;

            // Insert @line directive if we skipped lines (gap > 1) or changed files
            if ((lineSkip > 1 || fileChanged) && this.lastSourceLine > 0) {
                const lineDirectiveText = `${this.language.lineCommentPrefix} @line ${token.line} "${this.formatPathForLineDirective(this.sourceFile)}"`;
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

    private peek(offset: number): Token|null {
        offset += this.position;
        if(offset >= this.tokens.length) {
            return null;
        }
        return this.tokens[offset];
    }

    private current(): Token {
        return this.tokens[this.position];
    }

    private advance(steps:number = 1): Token {
        const token = this.current();
        steps += this.position;
        if (steps < this.tokens.length) {
            this.position = steps;
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

    private static trimTrailingWhiteSpace(tokens: Token[]): Token[] {
        const out = [];
        let white = [];
        for(const token of tokens) {
            if(token.isWhitespaceOrNewline()) {
                white.push(token);
            } else {
                out.push(...white);
                white = [];
                out.push(token);
            }
        }
        return out;
    }

    private consumeWhiteSpaceAndComments(): Token[] {
        const comments: Token[] = [];
        while(!this.isAtEnd()) {
            const current = this.current();
            if(current.isComment() || current.isWhitespaceOrNewline()) {
                comments.push(current);
                this.advance();
                continue;
            }
            break;
        }
        return comments;
    }

    private generateUniqueIdentifier(len: number = 6, prefix: string = "u"): string {
        let identifier: string = "";
        while(identifier.length < 1 || this.state.uniqueidentifiers.has(identifier)) {
            const rand = this.state.random.nextHex();
            identifier = prefix + rand.substring(rand.length - len);
        }
        this.state.uniqueidentifiers.add(identifier);
        return identifier;
    }

    private checkTokenOfType(type: TokenType): boolean {
        if (this.isAtEnd()) {
            return false;
        }
        return this.current().type === type;
    }

    private consumeTokenIfType(type: TokenType): Token | null {
        if (this.isAtEnd()) {
            return null;
        }
        const token = this.current();
        if (token.type === type) {
            this.advance();
            return token;
        }
        return null;
    }

    private consumeTokenOfType(type: TokenType, after?: string): Token {
        if (this.isAtEnd()) {
            const token = this.tokens[this.tokens.length - 1];
            throw new DiagnosticError({
                severity: DiagnosticSeverity.ERROR,
                message: `Expected token of type ${type}${after ? ` after ${after}` : ""}, but reached end of input`,
                line: token.line,
                column: token.column,
                length: token.value.length,
                sourceFile: this.sourceFile,
            });
        }
        const token = this.current();
        if (token.type === type) {
            this.advance();
            return token;
        } else {
            throw new DiagnosticError({
                severity: DiagnosticSeverity.ERROR,
                message: `Expected token of type ${type}${after ? ` after ${after}` : ""}, got ${token.type}`,
                line: token.line,
                column: token.column,
                length: token.value.length,
                sourceFile: this.sourceFile,
            });
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
            const current = this.current();
            if (current.isIdentifier()) {
                parameters.push(current.value);
                this.advance();
                this.skipWhitespace();

                if (!this.isAtEnd() && this.current().value === ',') {
                    this.advance();
                    this.skipWhitespace();
                }
            } else {
                // Detect ... for __VA_ARGS__
                if(current.value == ".") {
                    const peek1 = this.peek(1);
                    const peek2 = this.peek(2);
                    if(peek1 && peek2) {
                        if(peek1.value == "." && peek2.value == ".") {
                            this.advance(2);
                            parameters.push("...");
                        }
                    }
                }
                this.advance(); // skip unexpected token
            }
        }

        if (!this.isAtEnd() && this.current().type === TokenType.PAREN_CLOSE) {
            this.advance(); // consume )
        }

        return parameters;
    }

    private consumeEncapsulatedSequence(enter: TokenType, exit: TokenType) : Token[] {
        const first = this.consumeTokenOfType(enter);
        const tokens = [first];
        let depth = 1;
        while(!this.isAtEnd()) {
            const current = this.current();
            if(current.type == enter) depth++;
            else if(current.type == exit) depth--;
            tokens.push(current);
            this.advance();
            if(depth == 0) {
                return tokens;
            }
        }
        this.diagnostics.addError(
            `Unclosed sequence wrapped with ${enter} ${exit}`,
            {
                line: first.line,
                column: first.column,
                length: first.value.length,
                sourceFile: this.sourceFile,
            },
            ErrorCodes.INVALID_MACRO_INVOCATION
        );
        return [];
    }

    /**
     * Parse argument list for macro invocation: (expr1, expr2, expr3)
     */
    private parseArgumentList(): Token[][] {
        const args: Token[][] = [];
        let currentArg: Token[] = [];
        let parenDepth = 0;

        this.consumeTokenOfType(TokenType.PAREN_OPEN, "function macro call"); // consume (

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
            } else if(token.type === TokenType.BRACKET_OPEN) {
                // Consume list
                currentArg.push(...this.consumeEncapsulatedSequence(TokenType.BRACKET_OPEN, TokenType.BRACKET_CLOSE));
                continue;
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

    private skipNonNewlineWhiteSpace(): void {
        while (!this.isAtEnd() && this.current().type == TokenType.WHITESPACE) {
            this.advance();
        }
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

            if(token.type == TokenType.LINE_COMMENT) {
                this.advance();
                break;
            }
            if(token.type == TokenType.BLOCK_COMMENT_START) {
                this.advance();
                while(!this.isAtEnd() && this.current().type != TokenType.BLOCK_COMMENT_END) {
                    this.advance();
                }
                this.advance();
                break;
            }

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
    private async processIncludeDirective(include: IncludeInfo): Promise<void> {
        if (!this.host || !this.state.includes) {
            throw new Error('Cannot process includes without host interface');
        }

        // Use the include processor to handle the include
        const result = await this.state.includes.processInclude(
            include,
            this.sourceFile,
            this.state.includeState,
            this.state.macros,
            this.state.conditionals,
            this.diagnostics,
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
            const lineDirectiveText = `${this.language.lineCommentPrefix} @line 1 "${this.formatPathForLineDirective(result.resolvedPath!)}"`;
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
    private async processRequireDirective(include: IncludeInfo): Promise<void> {
        if (!this.host || !this.state.includes) {
            throw new Error('Cannot process requires without host interface');
        }

        // Ensure requireState is initialized
        if (!this.state.requireState) {
            this.state.requireState = Parser.createRequireState();
        }

        // Use the include processor to read and tokenize the file
        const result = await this.state.includes.processInclude(
            include,
            this.sourceFile,
            this.state.includeState,
            this.state.macros,
            this.state.conditionals,
            this.diagnostics,
            0,  // column position
            this.allowExternalRequires,
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
            this.state.requireState.modulePathMap.set(moduleId, resolvedPath);

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
                // Pass on this setting so that external files can perform requires
                requireParser.allowExternalRequire(result.external ?? false);

                // Parse the required file
                const requireResult = await requireParser.parse();

                // Merge diagnostics from the required file into parent
                this.diagnostics.merge(requireParser.diagnostics);

                // Wrap the parsed output in a function
                const wrappedTokens = this.wrapModuleInFunction(
                    requireParser.outputTokens,
                    resolvedPath,
                    include.line
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

    public allowExternalRequire(allow:boolean) : void {
        this.allowExternalRequires = allow;
    }

    /**
     * Wrap module tokens in an anonymous function
     */
    private wrapModuleInFunction(moduleTokens: Token[], resolvedPath: NormalizedPath, lineNumber: number): Token[] {
        const wrapped: Token[] = [];

        // Opening: (function()
        wrapped.push(new Token(TokenType.PAREN_OPEN, '(', lineNumber, 1, 1));
        wrapped.push(new Token(TokenType.IDENTIFIER, 'function', lineNumber, 2, 8));
        wrapped.push(new Token(TokenType.PAREN_OPEN, '(', lineNumber, 10, 1));
        wrapped.push(new Token(TokenType.PAREN_CLOSE, ')', lineNumber, 11, 1));
        wrapped.push(new Token(TokenType.NEWLINE, this.lineEnding, lineNumber, 12, 1));

        // Add @line directive
        const lineDirectiveText = `${this.language.lineCommentPrefix} @line 1 "${this.formatPathForLineDirective(resolvedPath)}"`;
        wrapped.push(new Token(TokenType.LINE_COMMENT, lineDirectiveText, lineNumber + 1, 1, lineDirectiveText.length));
        wrapped.push(new Token(TokenType.NEWLINE, this.lineEnding, lineNumber + 1, lineDirectiveText.length + 1, 1));

        // Add the module content
        wrapped.push(...moduleTokens);

        // Closing: end)()
        const last = wrapped[wrapped.length-1];
        if(last.type !== TokenType.NEWLINE) {
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
        // Emit: require(<moduleId>)
        const line = this.current().line;

        this.outputTokens.push(new Token(TokenType.IDENTIFIER, 'require', line, 1, 7));
        this.outputTokens.push(new Token(TokenType.PAREN_OPEN, '(', line, 8, 1));
        this.outputTokens.push(new Token(TokenType.NUMBER_LITERAL, moduleId.toString(), line, 9, moduleId.toString().length));
        this.outputTokens.push(new Token(TokenType.PAREN_CLOSE, ')', line, 9 + moduleId.toString().length, 1));
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
        const lineDirectivePrefix = `${this.language.lineCommentPrefix} @line `;

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
    public static parseLineMappingsFromContent(content: string, language: LanguageLexerConfig, host: HostInterface): LineMapping[] {
        const lines = content.split('\n');
        const lineMappings: LineMapping[] = [];
        const commentPrefix = `${language.lineCommentPrefix} @line`;

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
     * Format:
     * (function()
     *     local mods = {
     *         ...<modules>
     *     }
     *     local cache = {}
     *     function require(mod)
     *         if not cache[mod] then
     *             if not mods[mod] then
     *                 error(`unknown module '{mod}'`)
     *             end
     *             cache[mod] = dangerouslyexecuterequiredmodule(mods[mod])
     *         end
     *         return cache[mod]
     *     end
     * end)()
     */
    private prependRequireFunction(): void {
        if (!this.state.requireState) {
            return; // Nothing to do if requireState doesn't exist
        }

        const sortedIds = Array.from(this.state.requireState.wrappedModules.keys()).sort((a, b) => a - b);
        const moduleTokens: ([TokenType,string]|Token)[]  = [];
        for (const moduleId of sortedIds) {
            const wrappedModule = this.state.requireState.wrappedModules.get(moduleId)!;
            const modulePath = this.state.requireState.modulePathMap.get(moduleId);
            const modulePathFormatted = modulePath ? ` ${this.formatPathForLineDirective(modulePath)}` :  "";
            // Add module comment
            moduleTokens.push([TokenType.LINE_COMMENT, `${this.language.lineCommentPrefix} @module ${moduleId}${modulePathFormatted}`]);
            moduleTokens.push([TokenType.NEWLINE, "\n"]);
            // (function() <moduleCode> end)
            moduleTokens.push(...wrappedModule);

            // Add newline
            moduleTokens.push([TokenType.PUNCTUATION, ","]);
            moduleTokens.push([TokenType.NEWLINE, "\n"]);
        }

        const requireCode:([TokenType,string]|Token)[] = [
            [TokenType.PAREN_OPEN, "("],
            [TokenType.IDENTIFIER, "function"],
            [TokenType.PAREN_OPEN, "("],
            [TokenType.PAREN_CLOSE, ")"],
            [TokenType.NEWLINE, "\n"],

            [TokenType.WHITESPACE, "    "],
            [TokenType.IDENTIFIER, 'local'],
            [TokenType.WHITESPACE, " "],
            [TokenType.IDENTIFIER, 'modules'],
            [TokenType.WHITESPACE, " "],
            [TokenType.OPERATOR, "="],
            [TokenType.WHITESPACE, " "],
            [TokenType.BRACE_OPEN, '{'],
            [TokenType.NEWLINE, "\n"],

            ...moduleTokens,

            [TokenType.WHITESPACE, "    "],
            [TokenType.BRACE_CLOSE, '}'],
            [TokenType.NEWLINE, "\n"],
            [TokenType.WHITESPACE, "    "],
            [TokenType.IDENTIFIER, 'local'],
            [TokenType.WHITESPACE, " "],
            [TokenType.IDENTIFIER, 'cache'],
            [TokenType.WHITESPACE, " "],
            [TokenType.OPERATOR, "="],
            [TokenType.WHITESPACE, " "],
            [TokenType.BRACE_OPEN, '{'],
            [TokenType.BRACE_CLOSE, '}'],
            [TokenType.NEWLINE, "\n"],

            [TokenType.WHITESPACE, "    "],
            [TokenType.IDENTIFIER,"function"],
            [TokenType.WHITESPACE," "],
            [TokenType.IDENTIFIER,"require"],
            [TokenType.PAREN_OPEN,"("],
            [TokenType.IDENTIFIER,"mod"],
            [TokenType.PAREN_CLOSE,")"],
            [TokenType.NEWLINE,"\n"],
            [TokenType.WHITESPACE,"        "],
            [TokenType.IDENTIFIER,"if"],
            [TokenType.WHITESPACE," "],
            [TokenType.IDENTIFIER,"not"],
            [TokenType.WHITESPACE," "],
            [TokenType.IDENTIFIER,"cache"],
            [TokenType.BRACKET_OPEN,"["],
            [TokenType.IDENTIFIER,"mod"],
            [TokenType.BRACKET_CLOSE,"]"],
            [TokenType.WHITESPACE," "],
            [TokenType.IDENTIFIER,"then"],
            [TokenType.NEWLINE,"\n"],
            [TokenType.WHITESPACE,"            "],
            [TokenType.IDENTIFIER,"if"],
            [TokenType.WHITESPACE," "],
            [TokenType.IDENTIFIER,"not"],
            [TokenType.WHITESPACE," "],
            [TokenType.IDENTIFIER,"modules"],
            [TokenType.BRACKET_OPEN,"["],
            [TokenType.IDENTIFIER,"mod"],
            [TokenType.BRACKET_CLOSE,"]"],
            [TokenType.WHITESPACE," "],
            [TokenType.IDENTIFIER,"then"],
            [TokenType.NEWLINE,"\n"],
            [TokenType.WHITESPACE,"                "],
            [TokenType.IDENTIFIER,"error"],
            [TokenType.PAREN_OPEN,"("],
            [TokenType.IDENTIFIER,"`unknown module '{mod}'`"],
            [TokenType.PAREN_CLOSE,")"],
            [TokenType.NEWLINE,"\n"],
            [TokenType.WHITESPACE,"            "],
            [TokenType.IDENTIFIER,"end"],
            [TokenType.NEWLINE,"\n"],
            [TokenType.WHITESPACE,"            "],
            [TokenType.IDENTIFIER,"cache"],
            [TokenType.BRACKET_OPEN,"["],
            [TokenType.IDENTIFIER,"mod"],
            [TokenType.BRACKET_CLOSE,"]"],
            [TokenType.WHITESPACE," "],
            [TokenType.IDENTIFIER,"="],
            [TokenType.WHITESPACE," "],
            [TokenType.IDENTIFIER,"dangerouslyexecuterequiredmodule"],
            [TokenType.PAREN_OPEN,"("],
            [TokenType.IDENTIFIER,"modules"],
            [TokenType.BRACKET_OPEN,"["],
            [TokenType.IDENTIFIER,"mod"],
            [TokenType.BRACKET_CLOSE,"]"],
            [TokenType.PAREN_CLOSE,")"],
            [TokenType.NEWLINE,"\n"],
            [TokenType.WHITESPACE,"        "],
            [TokenType.IDENTIFIER,"end"],
            [TokenType.NEWLINE,"\n"],
            [TokenType.WHITESPACE,"        "],
            [TokenType.IDENTIFIER,"return"],
            [TokenType.WHITESPACE," "],
            [TokenType.IDENTIFIER,"cache"],
            [TokenType.BRACKET_OPEN,"["],
            [TokenType.IDENTIFIER,"mod"],
            [TokenType.BRACKET_CLOSE,"]"],
            [TokenType.NEWLINE,"\n"],
            [TokenType.WHITESPACE,"    "],
            [TokenType.IDENTIFIER,"end"],
            [TokenType.NEWLINE,"\n"],
            [TokenType.IDENTIFIER,"end"],
            [TokenType.PAREN_CLOSE,")"],
            [TokenType.PAREN_OPEN,"("],
            [TokenType.PAREN_CLOSE,")"],
            [TokenType.NEWLINE,"\n"],
            // [TokenType.LINE_COMMENT, `${languageConfig.lineCommentPrefix}@line 1 "${this.sourceFile}"`],
            [TokenType.LINE_COMMENT, `${this.language.lineCommentPrefix}@line 1 "${this.formatPathForLineDirective(this.sourceFile)}"`],
            [TokenType.NEWLINE,"\n"],
        ];

        const requireTokens: Token[] = [];
        let line = 1;
        let pos = 1;
        for(const toke of requireCode) {
            if(toke instanceof Array) {
                const [tokeType, text] = toke;
                requireTokens.push(new Token(tokeType, text, line, pos, text.length));
                pos += text.length;
                if(tokeType == TokenType.NEWLINE) {
                    line++;
                    pos = 0;
                }
            } else {
                requireTokens.push(toke);
            }
        }

        // Prepend to output
        this.outputTokens.unshift(...requireTokens);
    }

    //#endregion
}


class RNG {
    private state: number;
    constructor(seed: number = 9863369152) {
        // Ensure seed is treated as a 32-bit signed integer
        this.state = seed | 0;
    }
    public next(): number {
        // Xorshift* algorithm (32-bit integer arithmetic)
        let x = this.state;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        // Clamp back to 32-bit signed integer
        x |= 0;
        this.state = x;
        return x & 0x7FFFFFFF;
    }

    public nextHex(): string {
        return this.next().toString(16).padStart(8, '0');
    }
}

//#endregion
