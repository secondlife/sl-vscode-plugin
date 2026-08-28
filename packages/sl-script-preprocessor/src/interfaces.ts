/**
 * @file hostinterface.ts
 * Copyright (C) 2025, Linden Research, Inc.
 */
import * as fs from "fs";

//=============================================================================
// Preprocessor Configuration
//=============================================================================

export type ScriptLanguage = "lsl" | "luau" | "txt";

export interface PreprocessorOptions {
    enabled: boolean;
    language: ScriptLanguage;
    flags: OptionFlags;
    include?: {
        maxDepth?: number;
        paths?: string[];
    },
    logger?: PreprocessorLogger;
    notecard?: {
        commentPrefix?: string;
    }
}

export interface OptionFlags {
    generateWarnings: boolean;
    generateDecls: boolean;
    disableInclude?: boolean;
    disableMacros?: boolean;
    disableConditionals?: boolean;
}

export interface PreprocessorLogger {
    debug?(message: string): void;
    info?(message: string): void;
    warn?(message: string): void;
    error?(message: string, error?: unknown): void;
}


//=============================================================================
// StringUri - URI-based file identification
//=============================================================================
declare const __StringUriBrand: unique symbol;
/**
 * A branded string type representing a URI.
 * Used for file identification throughout the preprocessor.
 *
 * Supported schemes:
 * - file:// - Standard filesystem paths
 * - workspace:///{folderName}/{path} - Workspace-relative paths
 *
 * Use helper functions to create and manipulate:
 * - filePathToStringUri() - Convert filesystem path to file:// URI
 * - stringUriToFilePath() - Extract path from file:// URI (null for other schemes)
 * - resolveUri() - Resolve relative path against base URI
 * - uriEquals() - Compare URIs with proper case handling
 */
export type StringUri = string & { readonly [__StringUriBrand]: true };

export async function fileExists(filePath: string): Promise<boolean> {
    try {
        await fs.promises.stat(filePath);
        return true;
    } catch {
        return false;
    }
}

//=============================================================================
// StringUri helper functions
//=============================================================================

/**
 * Convert a filesystem path to a file:// URI string.
 * Handles Windows drive letters and path separators.
 */
export function filePathToStringUri(filePath: string): StringUri {
    // Normalize path separators to forward slashes
    let normalized = filePath.replace(/\\/g, "/");

    // Handle Windows drive letters: C:/foo → file:///C:/foo
    if (/^[a-zA-Z]:/.test(normalized)) {
        return `file:///${normalized}` as StringUri;
    }

    // Unix absolute paths: /foo → file:///foo
    if (normalized.startsWith("/")) {
        return `file://${normalized}` as StringUri;
    }

    throw new Error(`Cannot convert relative path to URI: ${filePath}. Use resolveUri(baseUri, relativePath) for relative paths.`);
}

/**
 * Extract filesystem path from a file:// URI.
 * Returns null for non-file:// URIs (workspace://, sl://, etc.)
 */
export function stringUriToFilePath(uri: StringUri): string | null {
    if (!uri.startsWith("file://")) {
        return null;
    }

    // Remove file:// prefix
    let filePath = uri.slice(7);

    // Decode URI encoding
    filePath = decodeURIComponent(filePath);

    // Windows: file:///C:/foo → C:/foo (remove leading slash before drive)
    if (/^\/[a-zA-Z]:/.test(filePath)) {
        filePath = filePath.slice(1);
    }

    return filePath;
}

/**
 * Resolve a relative path against a base URI.
 * Treats `base` as a directory URI and appends `relativePath` to it.
 * Works for file:// and workspace:// URIs, preserving the scheme prefix exactly.
 * Use uriDirname(base) first if base is a file URI and you want its parent directory.
 */
export function resolveUri(base: StringUri, relativePath: string): StringUri {
    const normalizedRelative = relativePath.replace(/\\/g, "/");

    // Treat base as a directory; strip any trailing slash before appending
    const baseDir = base.endsWith("/") ? base.slice(0, -1) : base as string;
    const full = `${baseDir}/${normalizedRelative}`;

    // Extract the scheme+authority prefix (e.g. "file:///", "workspace:///") exactly,
    // so that empty-segment collapsing below never erases the ":///" triple slash.
    const schemeMatch = full.match(/^([a-zA-Z][a-zA-Z0-9+\-.]*:\/\/\/?)/);
    if (!schemeMatch) {
        throw new Error(`Invalid base URI (no scheme): ${base}`);
    }
    const schemePrefix = schemeMatch[1];
    const pathStr = full.slice(schemePrefix.length);

    // Resolve . and .. segments
    const parts = pathStr.split("/");
    const resolved: string[] = [];
    for (const part of parts) {
        if (part === "..") {
            resolved.pop();
        } else if (part !== "." && part !== "") {
            resolved.push(part);
        }
    }

    return (schemePrefix + resolved.join("/")) as StringUri;
}

/**
 * Get the filename (last path component) from a URI.
 */
export function uriFileName(uri: StringUri): string {
    const lastSlash = uri.lastIndexOf("/");
    if (lastSlash === -1) {
        return uri;
    }
    return decodeURIComponent(uri.slice(lastSlash + 1));
}

/**
 * Get the directory URI (parent) from a URI.
 */
export function uriDirname(uri: StringUri): StringUri {
    const lastSlash = uri.lastIndexOf("/");
    if (lastSlash === -1) {
        return uri;
    }
    return uri.slice(0, lastSlash) as StringUri;
}

/**
 * Compare two URIs for equality.
 * Handles case-insensitivity on Windows for file:// URIs.
 */
export function uriEquals(a: StringUri, b: StringUri): boolean {
    if (a === b) return true;

    // Case-insensitive comparison for file:// URIs on Windows
    if (
        process.platform === "win32" &&
        a.startsWith("file://") &&
        b.startsWith("file://")
    ) {
        return a.toLowerCase() === b.toLowerCase();
    }

    return false;
}

/**
 * Normalize a URI for use as a Set/Map key.
 * Lowercases file:// URIs on Windows.
 */
export function uriKey(uri: StringUri): string {
    if (process.platform === "win32" && uri.startsWith("file://")) {
        return uri.toLowerCase();
    }
    return uri;
}

/**
 * A Set implementation that handles URI case-sensitivity correctly.
 * On Windows, file:// URIs are compared case-insensitively.
 */
export class UriSet implements Iterable<StringUri> {
    private map = new Map<string, StringUri>();

    constructor(values?: Iterable<StringUri>) {
        if (values) {
            for (const uri of values) {
                this.add(uri);
            }
        }
    }

    add(uri: StringUri): this {
        this.map.set(uriKey(uri), uri);
        return this;
    }

    has(uri: StringUri): boolean {
        return this.map.has(uriKey(uri));
    }

    delete(uri: StringUri): boolean {
        return this.map.delete(uriKey(uri));
    }

    clear(): void {
        this.map.clear();
    }

    get size(): number {
        return this.map.size;
    }

    *[Symbol.iterator](): Iterator<StringUri> {
        yield* this.map.values();
    }

    values(): IterableIterator<StringUri> {
        return this.map.values();
    }

    forEach(callback: (uri: StringUri) => void): void {
        this.map.forEach(callback);
    }
}

//=============================================================================
export interface HostInterface {
    existsInSameWorkspace(knownUri: StringUri, desiredPath: string): Promise<boolean>;

    exists(uri: StringUri, unsafe?: boolean): Promise<boolean>;
    resolveFile(
        filename: string,        // raw filename from directive
        from: StringUri,         // URI of current source file
        extensions: string[],    // possible extensions to try
        includePaths?: string[], // additional include paths from options
        unsafe?: boolean,
    ): Promise<StringUri | null>;

    readFile(uri: StringUri, unsafe?: boolean): Promise<string | null>;
    writeFile(uri: StringUri, content: string | Uint8Array): Promise<boolean>;
    readJSON<T = any>(uri: StringUri, unsafe?: boolean): Promise<T | null>;
    readYAML<T = any>(uri: StringUri, unsafe?: boolean): Promise<T | null>;
    readTOML<T = any>(uri: StringUri, unsafe?: boolean): Promise<T | null>;
    writeJSON(uri: StringUri, data: any, pretty?: boolean): Promise<boolean>;
    writeYAML(uri: StringUri, data: any): Promise<boolean>;
    writeTOML(uri: StringUri, data: Record<string, any>): Promise<boolean>;

    listWorkspaceFolders?(): Promise<StringUri[]>;

    // Extension / capability discovery
    isExtensionAvailable?(id: string): boolean;
}
