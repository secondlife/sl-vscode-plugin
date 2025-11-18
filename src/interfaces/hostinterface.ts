/**
 * @file hostinterface.ts
 * Copyright (C) 2025, Linden Research, Inc.
 */
import * as path from "path";
import * as fs from "fs";
import { FullConfigInterface } from "./configinterface";

//=============================================================================
declare const __NormalizedPathBrand: unique symbol;
export type NormalizedPath = string & { readonly [__NormalizedPathBrand]: true };

export function normalizePath(filePath: string): NormalizedPath {
    return path.normalize(filePath) as NormalizedPath;
}

export function normalizeJoinPath(...paths: string[]): NormalizedPath {
    return path.normalize(path.join(...paths)) as NormalizedPath;
}

export async function fileExists(filePath: NormalizedPath): Promise<boolean> {
    try {
        await fs.promises.stat(filePath);
        return true;
    } catch {
        return false;
    }
}

export function splitFilename(filename: NormalizedPath): { basepath: string; filename: string } {
    const dirname = path.dirname(filename);
    const basename = path.basename(filename);

    // If dirname is "." it means there was no path component
    const pathPart = dirname === "." ? "" : dirname;

    return {
        basepath: pathPart,
        filename: basename
    };
}

//=============================================================================
export interface HostInterface {
    /** Central configuration provider (framework-agnostic). */
    config: FullConfigInterface;
    exists(p: NormalizedPath, unsafe?: boolean): Promise<boolean>;
    resolveFile(
        filename: string,        // raw filename from directive
        from: NormalizedPath,   // path of current source file
        extensions: string[],    // possible extensions to try
        includePaths?: string[]  // additional include paths from options
    ): Promise<NormalizedPath | null>;

    readFile(p: NormalizedPath, unsafe?: boolean): Promise<string | null>;
    writeFile(p: NormalizedPath, content: string | Uint8Array): Promise<boolean>;
    readJSON<T = any>(p: NormalizedPath, unsafe?: boolean): Promise<T | null>;
    readYAML<T = any>(p: NormalizedPath, unsafe?: boolean): Promise<T | null>; // optional
    readTOML<T = any>(p: NormalizedPath, unsafe?: boolean): Promise<T | null>; // optional
    writeJSON(p: NormalizedPath, data: any, pretty?: boolean): Promise<boolean>;
    writeYAML(p: NormalizedPath, data: any): Promise<boolean>; // optional (not all hosts need YAML)
    writeTOML(p: NormalizedPath, data: Record<string, any>): Promise<boolean>; // optional

    listWorkspaceFolders?(): Promise<NormalizedPath[]>; // optional for non-workspace hosts
    // Extension / capability discovery ---------------------------------------
    isExtensionAvailable?(id: string): boolean;

    fileNameToUri(fileName: NormalizedPath): string;
    uriToFileName(uri: string): NormalizedPath;

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
