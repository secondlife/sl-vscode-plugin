/**
 * @file utils.ts
 * Copyright (C) 2025, Linden Research, Inc.
 */
import * as vscode from "vscode";
import path from "path";
import { ConfigService } from "./configservice";
import { ConfigKey, FullConfigInterface } from "./interfaces/configinterface";
import { fileExists, HostInterface, StringUri, filePathToStringUri, stringUriToFilePath } from "./interfaces/hostinterface";
import { writeJSONFile, readJSONFile, writeYAMLFile, writeTOMLFile, readYAMLFile, readTOMLFile } from "./shared/sharedutils";

// Generic utilities for sl-vscode-plugin

//=============================================================================
// Output Channel for extension logging
//#region Output Channel

let outputChannel: vscode.OutputChannel | undefined;
let runtimeOutputChannel: vscode.OutputChannel | undefined;

export function getRuntimeOutputChannel(): vscode.OutputChannel {
    if (!runtimeOutputChannel) {
        runtimeOutputChannel = vscode.window.createOutputChannel("Second Life");
    }
    return runtimeOutputChannel;
}

/**
 * Get or create the output channel for Second Life plugin logging.
 */
export function getOutputChannel(): vscode.OutputChannel {
    if (!outputChannel) {
        outputChannel = vscode.window.createOutputChannel("Second Life Plugin Log");
    }
    return outputChannel;
}

export function logRuntimeInfo(message: string): void {
    const channel = getRuntimeOutputChannel();
    const timestamp = new Date().toLocaleTimeString();
    channel.appendLine(`[${timestamp}] ${message}`);
}

export function logRuntimeError(message: string): void {
    const channel = getRuntimeOutputChannel();
    const timestamp = new Date().toLocaleTimeString();
    channel.appendLine(`[${timestamp}] ${message}`);
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
 * Log a debug message to the output channel (only when debug logging is enabled)
 */
export function logDebug(message: string): void {
    // TODO: Check a debug setting to conditionally log
    // For now, always log debug messages
    const channel = getOutputChannel();
    const timestamp = new Date().toISOString();
    channel.appendLine(`[${timestamp}] DEBUG: ${message}`);
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
export function closeEditor(documentUri: vscode.Uri): void {
    const document = vscode.workspace.textDocuments.find(
        (doc) => doc.uri.toString() === documentUri.toString(),
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
    const docUriString = document.uri.toString();

    // First try to find and close via tab groups
    const tabGroups = vscode.window.tabGroups.all;
    let found: boolean = false;
    for (const tabGroup of tabGroups) {
        for (const tab of tabGroup.tabs) {
            if (
                tab.input instanceof vscode.TabInputText &&
        tab.input.uri.toString() === docUriString
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

export function vscodeUriToStringUri(uri: vscode.Uri): StringUri {
    // Prefer workspace:// URIs for files inside a workspace folder
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (folder) {
        const relativePath = path.relative(folder.uri.fsPath, uri.fsPath).split(path.sep).join('/');
        return `workspace:///${folder.name}/${relativePath}` as StringUri;
    }
    return filePathToStringUri(uri.fsPath);
}

export function stringUriToVscodeUri(uri: StringUri): vscode.Uri {
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

        const folder = workspaceFolders.find(f => f.name === folderName);
        if (!folder) {
            throw new Error(`Workspace folder not found: ${folderName}`);
        }

        return vscode.Uri.joinPath(folder.uri, relativePath);
    }

    // Handle file:// URIs
    const filePath = stringUriToFilePath(uri);
    if (filePath) {
        return vscode.Uri.file(filePath);
    }

    // Fallback: parse as generic URI
    return vscode.Uri.parse(uri);
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

    /**
     * Convert an absolute filesystem path to a StringUri.
     * Returns workspace:// URI for files inside a workspace folder,
     * falling back to file:// for paths outside all workspace roots.
     * This ensures @line directives never reveal true filesystem paths.
     */
    private absPathToStringUri(absPath: string): StringUri {
        const norm = path.normalize(absPath);
        const isWin = process.platform === "win32";
        const normCmp = isWin ? norm.toLowerCase() : norm;
        for (const folder of vscode.workspace.workspaceFolders || []) {
            const folderPath = path.normalize(folder.uri.fsPath);
            const folderCmp = isWin ? folderPath.toLowerCase() : folderPath;
            if (normCmp.startsWith(folderCmp + path.sep)) {
                const relativePath = path.relative(folderPath, norm).split(path.sep).join('/');
                return `workspace:///${folder.name}/${relativePath}` as StringUri;
            }
        }
        return filePathToStringUri(norm);
    }

    async writeFile(filename: StringUri, content: string | Uint8Array): Promise<boolean> {
        try {
            const uri = stringUriToVscodeUri(filename);
            const data = typeof content === "string" ? Buffer.from(content, "utf8") : content;
            await vscode.workspace.fs.writeFile(uri, data);
            return true;
        } catch {
            return false;
        }
    }

    async readJSON<T = any>(p: StringUri, _unsafe?: boolean): Promise<T | null> {
        const filePath = stringUriToFilePath(p);
        if (!filePath) return null;
        return (await readJSONFile(filePath)) as T | null;
    }

    async writeJSON(p: StringUri, data: any, _pretty: boolean = true): Promise<boolean> {
        const filePath = stringUriToFilePath(p);
        if (!filePath) return false;
        return writeJSONFile(data, filePath);
    }

    async writeYAML(p: StringUri, data: any): Promise<boolean> {
        const filePath = stringUriToFilePath(p);
        if (!filePath) return false;
        return writeYAMLFile(data, filePath);
    }

    async writeTOML(p: StringUri, data: Record<string, any>): Promise<boolean> {
        const filePath = stringUriToFilePath(p);
        if (!filePath) return false;
        return writeTOMLFile(data, filePath);
    }

    async readYAML<T = any>(p: StringUri, _unsafe?: boolean): Promise<T | null> {
        const filePath = stringUriToFilePath(p);
        if (!filePath) return null;
        return (await readYAMLFile(filePath)) as T | null;
    }

    async readTOML<T = any>(p: StringUri, _unsafe?: boolean): Promise<T | null> {
        const filePath = stringUriToFilePath(p);
        if (!filePath) return null;
        return (await readTOMLFile(filePath)) as T | null;
    }

    async existsInSameWorkspace(knownUri: StringUri, desiredPath: string): Promise<boolean> {
        const vscodeKnownUri = stringUriToVscodeUri(knownUri);
        const workspaceDir = vscode.workspace.getWorkspaceFolder(vscodeKnownUri);
        if(!workspaceDir) return false;
        const desiredUri = vscode.Uri.file(path.normalize(workspaceDir.uri.fsPath + path.sep + desiredPath));
        const dWorkspaceDir = vscode.workspace.getWorkspaceFolder(desiredUri);
        if(!dWorkspaceDir) return false;
        return dWorkspaceDir.uri.fsPath == workspaceDir.uri.fsPath;
    }

    async exists(filename: StringUri, unsafe?: boolean): Promise<boolean> {
        // Handle both file:// and workspace:// URIs
        let filePath = stringUriToFilePath(filename);
        if (!filePath && filename.startsWith('workspace:///')) {
            try {
                const vscodeUri = stringUriToVscodeUri(filename);
                filePath = vscodeUri.fsPath;
            } catch {
                return false;
            }
        }
        if (!filePath) return false;

        if (unsafe) {
            return await fileExists(filePath);
        }

        try {
            const uri = stringUriToVscodeUri(filename);
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

    async readFile(filepath: StringUri, unsafe?: boolean): Promise<string | null> {
        if (!(await this.exists(filepath, unsafe))) {
            return null;
        }
        const uri = stringUriToVscodeUri(filepath);
        const document = await vscode.workspace.openTextDocument(uri);
        return document.getText();
    }

    async resolveFile(
        filename: string,
        from: StringUri,
        extensions: string[],
        includePaths?: string[],
        unsafe: boolean = false,
    ): Promise<StringUri | null> {
        // Convert from StringUri to file path
        // Handle both file:// and workspace:// URIs
        let fromPath = stringUriToFilePath(from);
        if (!fromPath) {
            // Try workspace:// URI - convert via vscode.Uri to get fsPath
            if (from.startsWith('workspace:///')) {
                try {
                    const vscodeUri = stringUriToVscodeUri(from);
                    fromPath = vscodeUri.fsPath;
                } catch {
                    return null;
                }
            } else {
                return null;
            }
        }

        const fromDir = path.dirname(fromPath);
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
            if (!isInsideWorkspace(absPath) && !unsafe) return null;
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
                    return this.absPathToStringUri(found);
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
                                return this.absPathToStringUri(candidate);
                            }
                        }
                    } catch { /* ignore */ }
                }
            }
        }

        return null;
    }

    // Optional capability implementations ------------------------------------
    async listWorkspaceFolders(): Promise<StringUri[]> {
        return (vscode.workspace.workspaceFolders || []).map(f => filePathToStringUri(f.uri.fsPath));
    }

    isExtensionAvailable(id: string): boolean {
        return !!vscode.extensions.getExtension(id);
    }
    // Path queries now sourced through config service methods where needed.
}

//#endregion


export function sortObjectKeysRecursive(obj: any): any {
    if(typeof(obj) != "object" || obj == null) return obj;
    if(Array.isArray(obj)) {
        for(const i in obj) {
            obj[i] = sortObjectKeysRecursive(obj[i])
        }
        return obj;
    }
    return Object.keys(obj).sort().reduce((result: any, key: string) => {
        result[key] = sortObjectKeysRecursive(obj[key]);
        return result;
    },{});
}
