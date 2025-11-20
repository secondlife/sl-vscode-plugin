/**
 * @file utils.ts
 * Copyright (C) 2025, Linden Research, Inc.
 */
import * as vscode from "vscode";
import * as path from "path";
import { ConfigService } from "./configservice";
import { ConfigKey, FullConfigInterface } from "./interfaces/configinterface";
import { fileExists, HostInterface, NormalizedPath, normalizePath } from "./interfaces/hostinterface";
import { writeJSONFile, readJSONFile, writeYAMLFile, writeTOMLFile, readYAMLFile, readTOMLFile } from "./shared/sharedutils";

// Generic utilities for sl-vscode-edit

//=============================================================================
// Output Channel for extension logging
//#region Output Channel

let outputChannel: vscode.OutputChannel | undefined;

/**
 * Get or create the output channel for Second Life extension logging
 */
export function getOutputChannel(): vscode.OutputChannel {
    if (!outputChannel) {
        outputChannel = vscode.window.createOutputChannel("Second Life Scripting");
    }
    return outputChannel;
}

/**
 * Log an informational message to the output channel
 */
export function logInfo(message: string): void {
    const channel = getOutputChannel();
    const timestamp = new Date().toISOString();
    channel.appendLine(`[${timestamp}] INFO: ${message}`);
}

/**
 * Log a warning message to the output channel
 */
export function logWarning(message: string): void {
    const channel = getOutputChannel();
    const timestamp = new Date().toISOString();
    channel.appendLine(`[${timestamp}] WARN: ${message}`);
}

/**
 * Log an error message to the output channel
 */
export function logError(message: string, error?: Error): void {
    const channel = getOutputChannel();
    const timestamp = new Date().toISOString();
    channel.appendLine(`[${timestamp}] ERROR: ${message}`);
    if (error) {
        channel.appendLine(`  ${error.message}`);
        if (error.stack) {
            channel.appendLine(`  Stack: ${error.stack}`);
        }
    }
}

/**
 * Show the output channel to the user
 */
export function showOutputChannel(): void {
    getOutputChannel().show();
}

//#endregion

//=============================================================================
// Messaging utilities
//#region Messaging and UI Utilities

// Display a message in the status bar for a specified duration or until a promise resolves
export function showStatusMessage(message: string, promise?: Thenable<any>): vscode.Disposable {

    const svc = ConfigService.getInstance();
    const timeoutSeconds = svc.getConfig<number>(ConfigKey.UITimeout) ?? 3;

    let disposable: vscode.Disposable;
    if (promise) {
        disposable = vscode.window.setStatusBarMessage(message, promise);
    } else {
        disposable = vscode.window.setStatusBarMessage(message, timeoutSeconds * 1000);
    }

    return disposable;
}

// Display an information message dialog
export function showInfoMessage(
    message: string,
    ...items: string[]
): Thenable<string | undefined> {
    return vscode.window.showInformationMessage(message, ...items);
}

export function showWarningMessage(
    message: string,
    ...items: string[]
): Thenable<string | undefined> {
    return vscode.window.showWarningMessage(message, ...items);
}

export function showErrorMessage(
    message: string,
    ...items: string[]
): Thenable<string | undefined> {
    return vscode.window.showErrorMessage(message, ...items);
}

//#endregion

//=============================================================================
//#region Workspace Editor Utilities
export function closeEditor(documentFile: string): void {
    documentFile = path.normalize(documentFile);
    const document = vscode.workspace.textDocuments.find(
        (doc) => path.normalize(doc.fileName) === documentFile,
    );
    if (document) {
        vscode.window.showTextDocument(document).then((_editor) => {
            vscode.commands.executeCommand("workbench.action.closeActiveEditor");
        });
    }
}

export async function closeTextDocument(
    document: vscode.TextDocument,
): Promise<void> {
    const normalizedPath = path.normalize(document.fileName);

    // First try to find and close via tab groups
    const tabGroups = vscode.window.tabGroups.all;
    let found: boolean = false;
    for (const tabGroup of tabGroups) {
        for (const tab of tabGroup.tabs) {
            if (
                tab.input instanceof vscode.TabInputText &&
        path.normalize(tab.input.uri.fsPath) === normalizedPath
            ) {
                await vscode.window.tabGroups.close(tab);
                found = true;
            }
        }
    }
    if (found) return;

    try {
        await vscode.window.showTextDocument(document);
        await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
    } catch (error) {
        console.log("Could not close editor via document:", error);
    }
}

export function hasWorkspace(): boolean {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    return workspaceFolders !== undefined && workspaceFolders.length > 0;
}

export function createFileWatcher(
    document: vscode.TextDocument,
): vscode.FileSystemWatcher {
    // Set up a file watcher on the viewerDocument for external deletions
    const filePattern = new vscode.RelativePattern(
        path.dirname(document.fileName),
        path.basename(document.fileName),
    );

    return vscode.workspace.createFileSystemWatcher(filePattern);
}

export async function uriExists(filePath: vscode.Uri): Promise<boolean> {
    try {
        await vscode.workspace.fs.stat(filePath);
        return true;
    } catch {
        return false;
    }
}

export function uriToNormalizedPath(uri: vscode.Uri): NormalizedPath {
    return normalizePath(uri.fsPath);
}

export function errorLevelToSeverity(level: string): vscode.DiagnosticSeverity {
    switch (level.toLowerCase()) {
        case "error":
            return vscode.DiagnosticSeverity.Error;
        case "warning":
            return vscode.DiagnosticSeverity.Warning;
        case "info":
            return vscode.DiagnosticSeverity.Information;
        default:
            return vscode.DiagnosticSeverity.Hint;
    }
};
//#endregion

//=============================================================================
//#region Workspace/VScode file interface

export class VSCodeHost implements HostInterface {
    public readonly config: FullConfigInterface;

    constructor(private readonly context?: vscode.ExtensionContext) {
        // Adapt existing ConfigService singleton to FullConfigInterface implementation
        if (context) {
            ConfigService.getInstance(context); // ensure initialized
        }
        const svc = ConfigService.getInstance();
        this.config = svc;
    }

    async writeFile(filename: NormalizedPath, content: string | Uint8Array): Promise<boolean> {
        try {
            const uri = vscode.Uri.file(filename);
            const data = typeof content === "string" ? Buffer.from(content, "utf8") : content;
            await vscode.workspace.fs.writeFile(uri, data);
            return true;
        } catch {
            return false;
        }
    }

    async readJSON<T = any>(p: NormalizedPath, _unsafe?: boolean): Promise<T | null> {
        return (await readJSONFile(p)) as T | null;
    }

    async writeJSON(p: NormalizedPath, data: any, _pretty: boolean = true): Promise<boolean> {
        return writeJSONFile(data, p);
    }

    async writeYAML(p: NormalizedPath, data: any): Promise<boolean> {
        return writeYAMLFile(data, p);
    }

    async writeTOML(p: NormalizedPath, data: Record<string, any>): Promise<boolean> {
        return writeTOMLFile(data, p);
    }

    async readYAML<T = any>(p: NormalizedPath, _unsafe?: boolean): Promise<T | null> {
        return (await readYAMLFile(p)) as T | null;
    }

    async readTOML<T = any>(p: NormalizedPath, _unsafe?: boolean): Promise<T | null> {
        return (await readTOMLFile(p)) as T | null;
    }

    async exists(filename: NormalizedPath, unsafe?: boolean): Promise<boolean> {
        if (unsafe) {
            return await fileExists(filename);
        }

        try {
            const uri = vscode.Uri.file(filename);
            const folder = vscode.workspace.getWorkspaceFolder(uri);
            if (!folder) {
                return false; // Outside workspace
            }
            const stat = await vscode.workspace.fs.stat(uri);
            return (stat.type & vscode.FileType.File) !== 0;
        } catch {
            return false; // stat threw -> does not exist
        }
    }

    async readFile(filepath: NormalizedPath, unsafe?: boolean): Promise<string | null> {
        if (!(await this.exists(filepath, unsafe))) {
            return null;
        }
        const uri = vscode.Uri.file(filepath);
        const document = await vscode.workspace.openTextDocument(uri);
        return document.getText();
    }

    async resolveFile(
        filename: string,
        from: NormalizedPath,
        extensions: string[],
        includePaths?: string[]
    ): Promise<NormalizedPath | null> {
        // Normalize base parameters
        const normalizedFrom = path.normalize(from);
        const fromDir = path.dirname(normalizedFrom);
        const hasExt = path.extname(filename).length > 0;
        const candidateExtensions = hasExt ? [""] : extensions.map(e => e.startsWith('.') ? e : `.${e}`);

        // Default include paths
        const searchGlobs = (includePaths && includePaths.length > 0) ? includePaths : ["."];

        // Workspace roots
        const roots = (vscode.workspace.workspaceFolders ?? []).map(f => path.normalize(f.uri.fsPath));
        if (roots.length === 0) {
            return null; // no workspace open
        }

        // Helper to verify path is inside any workspace root
        const isInsideWorkspace = (absPath: string): boolean => {
            const norm = path.normalize(absPath);
            return roots.some(r => norm.toLowerCase().startsWith(r.toLowerCase() + path.sep));
        };

        // Attempt to stat a candidate file
        const tryCandidate = async (absPath: string): Promise<string | null> => {
            if (!isInsideWorkspace(absPath)) return null;
            try {
                const uri = vscode.Uri.file(absPath);
                const stat = await vscode.workspace.fs.stat(uri);
                if ((stat.type & vscode.FileType.File) !== 0) {
                    return absPath;
                }
            } catch { /* ignore missing */ }
            return null;
        };

        // Separate explicit directories from wildcard directory globs
        const candidateDirs: string[] = [];
        const wildcardGlobs: string[] = [];
        const hasWildcard = (s: string): boolean => /[*?]/.test(s);

        for (const raw of searchGlobs) {
            const glob = raw.trim();
            if (!glob) continue;
            if (hasWildcard(glob)) {
                wildcardGlobs.push(glob);
                continue;
            }
            if (glob === ".") {
                candidateDirs.push(fromDir);
                continue;
            }
            if (glob.startsWith("./")) {
                candidateDirs.push(path.join(fromDir, glob.substring(2)));
                continue;
            }
            if (path.isAbsolute(glob)) {
                candidateDirs.push(glob);
                continue;
            }
            // Non-wildcard, workspace-root relative; add for each root (preserve order of roots)
            for (const root of roots) {
                candidateDirs.push(path.join(root, glob));
            }
        }

        // If filename is explicitly relative (./ or ../) prioritize its direct resolution from fromDir
        const isExplicitRelative = filename.startsWith("./") || filename.startsWith("../");
        if (isExplicitRelative && !candidateDirs.includes(fromDir)) {
            candidateDirs.unshift(fromDir);
        }

        const containsPath = filename.includes("/") || filename.includes("\\");

        for (const dir of candidateDirs) {
            const baseDir = path.normalize(dir);
            let baseCandidate: string;
            if (containsPath) {
                baseCandidate = path.isAbsolute(filename) ? path.normalize(filename) : path.join(baseDir, filename);
            } else {
                baseCandidate = path.join(baseDir, filename);
            }

            for (const ext of candidateExtensions) {
                const fullPath = ext === "" ? baseCandidate : baseCandidate + ext;
                const found = await tryCandidate(fullPath);
                if (found) {
                    return normalizePath(found);
                }
            }
        }

        // Wildcard glob phase (directories with * or ?). Deterministic: process in includePaths order.
        const toPosix = (p: string): string => p.split(path.sep).join("/");
        const relToRoot = (abs: string, root: string): string => toPosix(path.relative(root, abs));

        for (const globDirPattern of wildcardGlobs) {
            // Build list of (root, relativePattern) pairs.
            // Handle patterns starting with './' relative to fromDir.
            let basePatterns: { root: string; rel: string }[] = [];
            if (globDirPattern.startsWith('./')) {
                const abs = path.join(fromDir, globDirPattern.substring(2));
                for (const root of roots) {
                    if (abs.toLowerCase().startsWith(root.toLowerCase() + path.sep)) {
                        basePatterns.push({ root, rel: relToRoot(abs, root) });
                    }
                }
            } else if (path.isAbsolute(globDirPattern)) {
                for (const root of roots) {
                    if (globDirPattern.toLowerCase().startsWith(root.toLowerCase() + path.sep)) {
                        basePatterns.push({ root, rel: relToRoot(globDirPattern, root) });
                    }
                }
            } else {
                // Treat as workspace-root relative glob for each root
                for (const root of roots) {
                    basePatterns.push({ root, rel: globDirPattern });
                }
            }

            // For each candidate extension attempt findFiles with maxResults=1
            for (const { rel } of basePatterns) {
                for (const ext of candidateExtensions) {
                    const finalName = hasExt || ext === '' ? filename : filename + ext; // ext includes dot
                    const combined = rel.endsWith('/') ? `${rel}${finalName}` : `${rel}/${finalName}`;
                    // Collapse potential duplicate slashes
                    const includePattern = toPosix(combined).replace(/\\+/g, '/');
                    try {
                        const matches = await vscode.workspace.findFiles(includePattern, undefined, 1);
                        if (matches.length > 0) {
                            const candidate = path.normalize(matches[0].fsPath);
                            if (await tryCandidate(candidate)) {
                                return normalizePath(candidate);
                            }
                        }
                    } catch { /* ignore */ }
                }
            }
        }

        return null;
    }

    public fileNameToUri(fileName: NormalizedPath): string {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            // No workspace - return absolute file:// URL
            return vscode.Uri.file(fileName).toString();
        }

        // Find which workspace folder contains this file
        for (const folder of workspaceFolders) {
            const folderPath = folder.uri.fsPath;
            if (fileName.startsWith(folderPath)) {
                // File is inside this workspace folder - make it workspace-relative
                const relativePath = path.relative(folderPath, fileName);
                // Use forward slashes for URI consistency
                const normalizedRelative = relativePath.split(path.sep).join('/');
                // Include folder name in URI to identify which workspace root
                return `workspace:///${folder.name}/${normalizedRelative}`;
            }
        }

        // File is outside all workspace folders - return absolute file:// URL
        return vscode.Uri.file(fileName).toString();
    }

    uriToFileName(uri: string): NormalizedPath {
        // Handle workspace:// scheme
        if (uri.startsWith('workspace:///')) {
            const withoutScheme = uri.substring('workspace:///'.length);
            const slashIndex = withoutScheme.indexOf('/');

            if (slashIndex === -1) {
                throw new Error(`Invalid workspace URI: ${uri}`);
            }

            const folderName = withoutScheme.substring(0, slashIndex);
            const relativePath = withoutScheme.substring(slashIndex + 1);

            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                throw new Error(`No workspace open for URI: ${uri}`);
            }

            // Find the specific workspace folder by name
            const folder = workspaceFolders.find(f => f.name === folderName);
            if (!folder) {
                throw new Error(`Workspace folder not found: ${folderName}`);
            }

            const absolutePath = path.join(folder.uri.fsPath, relativePath);
            console.log(`uriToFileName: '${uri}' becomes '${absolutePath}'`);
            return normalizePath(absolutePath);
        }
        console.log(`uriToFileName: ${uri}`)
        // Handle standard file:// URLs
        return normalizePath(vscode.Uri.parse(uri).fsPath);
    }

    // Optional capability implementations ------------------------------------
    async listWorkspaceFolders(): Promise<NormalizedPath[]> {
        return (vscode.workspace.workspaceFolders || []).map(f => normalizePath(f.uri.fsPath));
    }

    isExtensionAvailable(id: string): boolean {
        return !!vscode.extensions.getExtension(id);
    }
    // Path queries now sourced through config service methods where needed.
}

//#endregion
