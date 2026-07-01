/**
 * @file hostinterface.ts
 * Copyright (C) 2025, Linden Research, Inc.
 */
import * as fs from "fs";
import { FullConfigInterface } from "./configinterface";

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
 * Works for file:// and workspace:// URIs.
 */
export function resolveUri(base: StringUri, relativePath: string): StringUri {
    // Find the last slash to get directory
    const lastSlash = base.lastIndexOf("/");
    if (lastSlash === -1) {
        throw new Error(`Invalid base URI: ${base}`);
    }

    // Get base directory (everything up to last slash)
    const baseDir = base.slice(0, lastSlash);

    // Normalize relative path separators
    const normalizedRelative = relativePath.replace(/\\/g, "/");

    // Simple resolution: append relative to base directory
    // Handle ../ and ./ segments
    const parts = `${baseDir}/${normalizedRelative}`.split("/");
    const resolved: string[] = [];

    for (const part of parts) {
        if (part === "..") {
            resolved.pop();
        } else if (part !== "." && part !== "") {
            resolved.push(part);
        }
    }

    // Reconstruct with proper scheme prefix
    const result = resolved.join("/");

    // Ensure file:// URIs have triple slash for absolute paths
    if (result.startsWith("file:/") && !result.startsWith("file:///")) {
        return result.replace("file:/", "file:///") as StringUri;
    }

    return result as StringUri;
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
    /** Central configuration provider (framework-agnostic). */
    config: FullConfigInterface;

    existsInSameWorkspace(knownUri: string, desiredUri: string): Promise<boolean>;

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

    // Path queries are now derived from config implementation, not host.
}

// Configuration scope descriptor (mirrors VS Code concept but host-agnostic)
export interface ConfigScope {
    target?: "workspace" | "global"; // workspace: affects project, global: user-level
    languageId?: string;              // optional language-specific override
}

//=============================================================================
export interface TextDocLike {
    languageId: string;
    fileName: string;
}

export interface DisposableLike {
    dispose(): void;
}
