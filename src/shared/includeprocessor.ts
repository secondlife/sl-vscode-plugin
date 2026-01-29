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

import { NormalizedPath, HostInterface, normalizeJoinPath, normalizePath } from '../interfaces/hostinterface';
import { LanguageLexerConfig, Lexer, Token } from './lexer';
import { MacroProcessor } from './macroprocessor';
import { ConditionalProcessor } from './conditionalprocessor';
import { DiagnosticCollector, DiagnosticSeverity, ErrorCodes } from './diagnostics';
import { IncludeInfo } from './parser';
import path from 'path';

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
    /** Whether the file was included via an external alias */
    external?: boolean;
}

export type LuauRCRequireMap = {[k:NormalizedPath]:RequireMap};
export type RequireMap = {[k:string]:NormalizedPath};
export type LuauRCFile = {
    aliases: {[k:string]:string};
};

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
    /** Require map for file resolution */
    requireMap?: LuauRCRequireMap;
}

/**
 * Processor for handling include directives
 */
export class IncludeProcessor {
    private language: LanguageLexerConfig;
    private host: HostInterface;

    constructor(language: LanguageLexerConfig, host: HostInterface) {
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
        column?: number,
        allowExternal: boolean = false,
    ): Promise<IncludeResult> {
        let filename = include.file;
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
        const extensions = this.language.name === "lsl" ? ["lsl"] : ["luau", "lua"];
        let includePaths: string[] = [];
        let aliased = false;

        if(isRequire) {
            filename = this.normalizeRequirePath(filename);
            if(!filename.startsWith("@")) {
                // Regular require, relative lookup
                includePaths = ["."];
            } else {
                try {
                    // get the alias path
                    const aliasPath = await this.getLuauRequireAliasDir(filename, sourceFile, state);
                    // Remove the alias from the filename
                    filename = filename.split(path.sep).slice(1).join(path.sep);
                    includePaths = [aliasPath];
                    aliased = true;
                } catch(error) {
                    if(typeof(error) == "string") {
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
                        }
                    }
                    throw error;
                }
            }
        } else {
            includePaths = [...(state.includePaths ?? [])];
        }
        let resolvedPath = await this.host.resolveFile(
            filename,
            sourceFile,
            extensions,
            includePaths,
            aliased || allowExternal,
        );
        // console.error("Resolve: ", [filename, sourceFile, extensions, includePaths, aliased, allowExternal], resolvedPath);

        if(!resolvedPath && this.language.name == "luau") {
            // Luau require supports default file in folder include mechanic 'init.luau'
            if(!filename.toLowerCase().endsWith(".luau") && !filename.toLocaleLowerCase().endsWith(".lua")) {
                filename += (filename.length ? path.sep : "") + "init";
                resolvedPath = await this.host.resolveFile(
                    filename,
                    sourceFile,
                    extensions,
                    includePaths,
                    aliased || allowExternal,
                );
            }
        }

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

        if(aliased) {
            // Check that the resolved path for an alias is definitley a child of the alias path.
            const relative = path.relative(includePaths[0], resolvedPath);
            if(!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
                const error = `Require file was not inside alias directory`;

                if (diagnostics) {
                    diagnostics.add({
                        severity: DiagnosticSeverity.ERROR,
                        code: ErrorCodes.INCLUDE_PATH_INVALID,
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
        const includeContent = await this.host.readFile(resolvedPath, aliased || allowExternal);
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
            resolvedPath,
            external : aliased || allowExternal,
        };
    }

    private normalizeRequirePath(filename: string): string {
        if(!filename.includes(path.sep)) {
            filename = filename.split("/").join(path.sep);
        }
        const dbl = path.sep + path.sep;
        while(filename.includes(dbl)) filename = filename.split(dbl).join(path.sep);
        return filename;
    }

    private async getLuauRequireAliasDir(requirePath:string, sourceFile:NormalizedPath, state:IncludeState) : Promise<string> {
        if(!requirePath.startsWith("@")) {
            throw "Alias must start with @";
        }
        if(requirePath.endsWith(`${path.sep}..`) || requirePath.includes(`${path.sep}..${path.sep}`)) {
            throw `Require alias cannot contain directory traversal`;
        }

        let alias = "";
        let aliasLen = requirePath.split(path.sep)[0].length;
        alias = requirePath.slice(1,aliasLen);
        if(alias.startsWith("sl-")) {
            // Reserve sl-* alias for possible future use as a standard library system
            throw `Alias 'sl-*' is reserved`
        }

        if(!state.requireMap) {
            state.requireMap = {};
        }
        const map = await this.resolveLuaurcFileAliases(sourceFile, state.requireMap);

        if(map[alias]) return map[alias];

        throw `Require alias not found: ${requirePath}`;
    }

    private async resolveLuaurcFileAliases(sourceFile:string, rcMap: LuauRCRequireMap) : Promise<RequireMap> {
        const map: RequireMap = {};
        let dir = normalizePath(sourceFile);
        let last = dir;
        let limit = 25;
        while(limit-- > 0) {
            dir = normalizePath(path.dirname(dir));
            if(last == dir) {
                break;
            }
            const norm = normalizeJoinPath(dir,".luaurc");
            let dirMap = rcMap[norm] ?? null;
            if(!dirMap) {
                const rcfile = await this.host.readJSON<LuauRCFile>(norm);
                if(rcfile === null) {
                    rcMap[norm] = {};
                    continue;
                }
                if(typeof(rcfile) !== "object") continue;
                const aliases = rcfile.aliases ?? null;
                if(typeof(aliases) !== "object") continue;
                if(aliases === null) continue;
                if(aliases instanceof Array) continue;
                rcMap[norm] = {};
                for(const alias in aliases) {
                    let str = aliases[alias];
                    if(path.isAbsolute(str)) {
                        rcMap[norm][alias] = normalizePath(str);
                    } else {
                        rcMap[norm][alias] = normalizeJoinPath(dir,str);
                    }
                }
                dirMap = rcMap[norm] ?? {};
            }
            for(const alias in dirMap) {
                map[alias] = dirMap[alias];
            }
        }

        return map;
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
            includePaths,
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
