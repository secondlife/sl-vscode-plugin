/**
 * @file includeprocessor.ts
 * Include processor for handling #include and require() directives
 * Copyright (C) 2025, Linden Research, Inc.
 *
 * Handles file inclusion with:
 * - Include guards (for #include, not require)
 * - Circular dependency detection
 * - Depth limiting
 * - File resolution via HostInterface
 */

import { NormalizedPath, HostInterface } from '../interfaces/hostinterface';
import { ScriptLanguage } from './languageservice';
import { Lexer, Token } from './lexer';
import { MacroProcessor } from './macroprocessor';
import { ConditionalProcessor } from './conditionalprocessor';
import { DiagnosticCollector, DiagnosticSeverity, ErrorCodes } from './diagnostics';
import { IncludeInfo } from './parser';

/**
 * Result of processing an include directive
 */
export interface IncludeResult {
    /** Whether the include was successful */
    success: boolean;
    /** Parsed tokens from the included file */
    tokens: Token[];
    /** Resolved path of the included file */
    resolvedPath: NormalizedPath | null;
    /** Error message if unsuccessful */
    error?: string;
}

/**
 * State for include processing shared across nested includes
 */
export interface IncludeState {
    /** Files already included (for include guards) */
    includedFiles: Set<NormalizedPath>;
    /** Current include stack (for circular detection) */
    includeStack: NormalizedPath[];
    /** Current include depth */
    includeDepth: number;
    /** Maximum include depth allowed */
    maxIncludeDepth: number;
    /** Include paths for file resolution */
    includePaths?: string[];
}

/**
 * Processor for handling include directives
 */
export class IncludeProcessor {
    private language: ScriptLanguage;
    private host: HostInterface;

    constructor(language: ScriptLanguage, host: HostInterface) {
        this.language = language;
        this.host = host;
    }

    /**
     * Process an include directive
     *
     * @param filename - The filename to include
     * @param sourceFile - The current source file path
     * @param isRequire - Whether this is a require() (true) or #include (false)
     * @param state - The include state
     * @param _macros - Shared macro processor (reserved for future use)
     * @param _conditionals - Shared conditional processor (reserved for future use)
     * @param diagnostics - Optional diagnostic collector
     * @param line - Optional line number for diagnostics
     * @param column - Optional column number for diagnostics
     * @returns Result of the include processing
     */
    public async processInclude(
        include: IncludeInfo,
        sourceFile: NormalizedPath,
        state: IncludeState,
        _macros: MacroProcessor,
        _conditionals: ConditionalProcessor,
        diagnostics?: DiagnosticCollector,
        column?: number
    ): Promise<IncludeResult> {
        const filename = include.file;
        const line = include.line;
        const isRequire = include.isRequire;
        // Check max include depth
        if (state.includeDepth >= state.maxIncludeDepth) {
            const error = `Maximum include depth (${state.maxIncludeDepth}) exceeded for file: ${filename}`;

            // INC003: Include depth exceeded
            if (diagnostics) {
                diagnostics.add({
                    severity: DiagnosticSeverity.ERROR,
                    code: ErrorCodes.INCLUDE_DEPTH_EXCEEDED,
                    message: error,
                    sourceFile: sourceFile,
                    line: line ?? 0,
                    column: column ?? 0,
                    length: filename.length
                });
            }

            return {
                success: false,
                tokens: [],
                resolvedPath: null,
                error
            };
        }

        // Resolve the include file path
        const extensions = this.language === "lsl" ? ["lsl"] : ["luau", "lua"];
        const includePaths = isRequire ? ["."] : (state.includePaths || ["."]);

        const resolvedPath = await this.host.resolveFile(
            filename,
            sourceFile,
            extensions,
            includePaths
        );

        if (!resolvedPath) {
            const error = `Include file not found: ${filename}`;

            // INC001: File not found
            if (diagnostics) {
                diagnostics.add({
                    severity: DiagnosticSeverity.ERROR,
                    code: ErrorCodes.FILE_NOT_FOUND,
                    message: error,
                    sourceFile: sourceFile,
                    line: line ?? 0,
                    column: column ?? 0,
                    length: filename.length
                });
            }

            return {
                success: false,
                tokens: [],
                resolvedPath: null,
                error
            };
        }

        include.path = resolvedPath;

        // Check for circular includes
        if (state.includeStack.includes(resolvedPath)) {
            const error = `Circular include detected for file: ${resolvedPath}`;

            // INC002: Circular include
            if (diagnostics) {
                diagnostics.add({
                    severity: DiagnosticSeverity.ERROR,
                    code: ErrorCodes.CIRCULAR_INCLUDE,
                    message: error,
                    sourceFile: sourceFile,
                    line: line ?? 0,
                    column: column ?? 0,
                    length: filename.length
                });
            }

            return {
                success: false,
                tokens: [],
                resolvedPath,
                error
            };
        }

        // Check include guards (only for #include, not require)
        if (!isRequire && state.includedFiles.has(resolvedPath)) {
            // File already included, skip it (not an error)
            return {
                success: true,
                tokens: [],
                resolvedPath
            };
        }

        // Read the include file
        const includeContent = await this.host.readFile(resolvedPath);
        if (!includeContent) {
            const error = `Failed to read include file: ${resolvedPath}`;

            // INC005: File read error
            if (diagnostics) {
                diagnostics.add({
                    severity: DiagnosticSeverity.ERROR,
                    code: ErrorCodes.FILE_READ_ERROR,
                    message: error,
                    sourceFile: sourceFile,
                    line: line ?? 0,
                    column: column ?? 0,
                    length: filename.length
                });
            }

            return {
                success: false,
                tokens: [],
                resolvedPath,
                error
            };
        }

        // NOTE: Stack management moved to caller (processIncludeDirective in parser.ts)
        // The stack needs to remain valid during nested parser execution, not just
        // during token reading.

        // Only add include guard for #include directives
        if (!isRequire) {
            state.includedFiles.add(resolvedPath);
        }

        // Parse the included file into tokens
        const lexer = new Lexer(includeContent, this.language);
        const tokens = lexer.tokenize();

        return {
            success: true,
            tokens,
            resolvedPath
        };
    }

    /**
     * Create initial include state
     */
    public static createState(maxIncludeDepth: number = 5, includePaths?: string[]): IncludeState {
        return {
            includedFiles: new Set(),
            includeStack: [],
            includeDepth: 0,
            maxIncludeDepth,
            includePaths
        };
    }

    /**
     * Reset include state (clear guards and stack)
     */
    public static resetState(state: IncludeState): void {
        state.includedFiles.clear();
        state.includeStack = [];
        state.includeDepth = 0;
    }
}
