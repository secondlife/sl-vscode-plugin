/**
 * @file lexingpreprocessor.ts
 * Lexing-based preprocessor for LSL and SLua scripts
 * Copyright (C) 2025, Linden Research, Inc.
 *
 * This preprocessor uses a token-based lexical analysis approach rather than
 * line-by-line regex matching. This provides better accuracy for:
 * - Comment handling
 * - String literal processing
 * - Nested directive detection
 * - Macro expansion with proper tokenization
 */

import { ScriptLanguage } from "./languageservice";
import { NormalizedPath, HostInterface } from "../interfaces/hostinterface";
import { FullConfigInterface, ConfigKey } from "../interfaces/configinterface";
import { Lexer } from "./lexer";
import { IncludeInfo, Parser } from "./parser";
import { MacroProcessor } from "./macroprocessor";
import { DiagnosticSeverity } from "./diagnostics";
import { LineMapping } from "./linemapper";

//-------------------------------------------------------------
//#region Preprocessor Interfaces

export interface OptionFlags {
    generateWarnings: boolean;
    generateDecls: boolean;
    disableInclude?: boolean;
    disableMacros?: boolean;
    disableConditionals?: boolean;
}

export interface PreprocessorOptions {
    enable: boolean;
    flags: OptionFlags;
    includePaths?: string[];
    maxIncludeDepth?: number; // Maximum nesting depth for #include and require() directives
}

export interface PreprocessorError {
    message: string;
    lineNumber: number;
    columnNumber?: number;
    file?: NormalizedPath;
    isWarning: boolean;
}

export interface PreprocessorResult {
    content: string;
    success: boolean;
    language: ScriptLanguage;
    lineMappings?: LineMapping[];
    directiveCount?: number;
    issues: PreprocessorError[];
    includes?: IncludeInfo[];
}
//#endregion

/**
 * Interface for directive handler implementations
 * Used by parser to process preprocessor directives
 *
 * Handlers receive the parser instance as a parameter, allowing
 * the same handler implementations to be shared across multiple parsers.
 */
export interface DirectiveImplementations {
    define?: (parser: any) => void | Promise<void>;
    undef?: (parser: any) => void | Promise<void>;
    if?: (parser: any) => void | Promise<void>;
    ifdef?: (parser: any) => void | Promise<void>;
    ifndef?: (parser: any) => void | Promise<void>;
    else?: (parser: any) => void | Promise<void>;
    elif?: (parser: any) => void | Promise<void>;
    endif?: (parser: any) => void | Promise<void>;
    include?: (parser: any) => void | Promise<void>;
    require?: (parser: any) => void | Promise<void>;
}

//#region Lexing Preprocessor Main Class

/**
 * Main lexing-based preprocessor
 */
export class LexingPreprocessor {
    private fs: HostInterface;
    private config: FullConfigInterface;
    private macros?: MacroProcessor;

    constructor(fs: HostInterface, config: FullConfigInterface, macros?: MacroProcessor) {
        this.fs = fs;
        this.config = config;
        this.macros = macros;
    }

    /**
     * Initialize predefined macros for a language
     * This creates a MacroProcessor with standard predefined macros
     * that should be available in all scripts of the given language.
     */
    private initializePredefinedMacros(language: ScriptLanguage): MacroProcessor {
        const macros = new MacroProcessor(language);

        // Add standard predefined macros based on language
        if (language === 'lsl') {
            // LSL predefined macros would go here
            // Example: __LINE__, __FILE__, etc.
            // These are typically handled specially during macro expansion
            // so we may not need to define them here, but this is where
            // user-configurable predefined macros would be added
        } else if (language === 'luau') {
            // SLua predefined macros (if any)
        }

        return macros;
    }

    /**
     * Process a source file with lexing-based preprocessing
     */
    public async process(
        source: string,
        sourceFile: NormalizedPath,
        language: ScriptLanguage
    ): Promise<PreprocessorResult> {
        // Check if preprocessing is enabled
        const enabled = this.config.getConfig<boolean>(ConfigKey.PreprocessorEnable) ?? true;
        if (!enabled) {
            return {
                content: source,
                success: true,
                language,
                issues: [],
            };
        }

        try {
            // Phase 1: Lexical analysis
            const lexer = new Lexer(source, language);
            const tokens = lexer.tokenize();

            // Collect lexer diagnostics
            const lexerDiagnostics = lexer.getDiagnostics();

            // Get workspace roots if available
            let workspaceRoots: NormalizedPath[] | undefined = undefined;
            if (this.fs && this.fs.listWorkspaceFolders) {
                workspaceRoots = await this.fs.listWorkspaceFolders();
            }

            // Get configuration values for include processing
            const maxIncludeDepth = this.config.getConfig<number>(ConfigKey.PreprocessorMaxIncludeDepth) ?? 5;
            const includePaths = this.config.getConfig<string[]>(ConfigKey.PreprocessorIncludePaths) ?? ['.'];

            // Use provided macros or initialize predefined macros
            const predefinedMacros = this.macros ?? this.initializePredefinedMacros(language);

            // Create initial parser state with predefined macros
            const initialState = Parser.createInitialState(
                language,
                this.fs,
                predefinedMacros,
                maxIncludeDepth,
                includePaths
            );

            // Phase 2: Parsing and directive processing
            // Pass lexer diagnostics to parser so they're included in the result
            const parser = new Parser(
                tokens,
                sourceFile,
                language,
                this.fs,
                undefined,      // directives (use defaults)
                initialState,   // Pass state with predefined macros
                true,           // isTopLevel
                workspaceRoots, // workspaceRoots
                lexerDiagnostics, // Pass lexer diagnostics to parser
                this.config     // config
            );
            const result = await parser.parse();

            // Convert all diagnostics (lexer + parser) to preprocessor errors
            const issues: PreprocessorError[] = result.diagnostics.map(diag => ({
                message: diag.message,
                lineNumber: diag.line,
                columnNumber: diag.column,
                file: diag.sourceFile,
                isWarning: diag.severity !== DiagnosticSeverity.ERROR,
            }));

            // Add warnings for detected includes that weren't processed (if no host)
            if (result.includes.length > 0 && !this.fs) {
                for (const include of result.includes) {
                    issues.push({
                        message: `Include directive detected but host interface not available: ${include.file}`,
                        lineNumber: include.line,
                        columnNumber: include.column,
                        file: sourceFile,
                        isWarning: true,
                    });
                }
            }

            return {
                content: result.success ? result.source : source,  // Return original source on error, processed source on success
                success: result.success,  // Use parser's success determination
                language,
                lineMappings: result.mappings,
                issues,
                includes: result.includes,
            };

        } catch (error) {
            return {
                content: source,
                success: false,
                language,
                issues: [{
                    message: `Preprocessing failed: ${error instanceof Error ? error.message : String(error)}`,
                    lineNumber: 1,
                    file: sourceFile,
                    isWarning: false,
                }],
            };
        }
    }
}

//#endregion
