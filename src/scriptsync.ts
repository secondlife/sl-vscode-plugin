/**
 * @file scriptsync.ts
 * Copyright (C) 2025, Linden Research, Inc.
 */
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { ConfigService } from "./configservice";
import { ConfigKey } from "./interfaces/configinterface";
import {
    LexingPreprocessor,
    PreprocessorResult,
    PreprocessorError
} from "./shared/lexingpreprocessor";
import { MacroProcessor } from './shared/macroprocessor';
import { LineMapping, LineMapper } from "./shared/linemapper";
import {
    showStatusMessage,
    createFileWatcher,
    closeTextDocument,
    errorLevelToSeverity,
    VSCodeHost,
    logInfo,
    logError
} from "./utils";
import { ScriptLanguage } from "./shared/languageservice";
import { CompilationResult, RuntimeDebug, RuntimeError } from "./viewereditwsclient";
import { StringUri, uriEquals } from "./interfaces/hostinterface";
import { vscodeUriToStringUri } from "./utils";
import { SynchService } from "./synchservice";
import { IncludeInfo } from "./shared/parser";
import { sha256 } from "js-sha256";
import { getLanguageConfig, isProccessedLanguage, LanguageLexerConfig } from "./shared/lexer";

//====================================================================
interface TrackedLocalFile {
    kind: 'local';
    id: string;
    viewerDocument: vscode.TextDocument;
    watcher?: vscode.FileSystemWatcher;
    hash?: string;
}

interface TrackedVirtualFile {
    kind: 'virtual';
    id: string;   // uri.toString() — stable unique key
    uri: vscode.Uri;
    hash?: string;
}

type TrackedFile = TrackedLocalFile | TrackedVirtualFile;

export class ScriptSync implements vscode.Disposable {
    private saveListener: vscode.Disposable | undefined;
    private masterDocument: vscode.TextDocument;
    private language: ScriptLanguage;
    private fileMappings: TrackedFile[] = [];
    private macros: MacroProcessor;
    private preprocessor: LexingPreprocessor | undefined;
    private disposed: boolean = false;
    private diagnosticCollection: vscode.DiagnosticCollection;
    private diagnosticSources: Set<string> = new Set();
    private lineMappings?: LineMapping[];
    private config: ConfigService;
    // private host: HostInterface;

    private includedFiles : IncludeInfo[] = [];
    private syncService: SynchService;

    //====================================================================
    public constructor(
        masterDocument: vscode.TextDocument,
        language: ScriptLanguage,
        config: ConfigService,
        scriptId: string,
        viewerDocument: vscode.TextDocument | undefined,
        syncService: SynchService,
    ) {
        this.config = config;

        // Create macro processor first
        this.language = language;
        this.macros = new MacroProcessor();
        this.initializeSystemMacros(language);

        this.syncService = syncService;

        // Initialize preprocessor with macro processor
        const enabled = config.getConfig<boolean>(ConfigKey.PreprocessorEnable, true);
        if (enabled && isProccessedLanguage(this.language)) {
            this.preprocessor = new LexingPreprocessor(this.syncService.getHost(), config, this.macros);
        }

        this.masterDocument = masterDocument;
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection(
            config.getConfig<string>(ConfigKey.ClientName) || "SL-Scripting",
        );
        if (scriptId && viewerDocument) {
            this.subscribe(scriptId, viewerDocument);
        }
        if(this.language == "luau") {
            this.config.on(ConfigKey.PreprocessorConstantsInSLua, (_config) => {
                this.initializeSystemMacros(this.language);
            });
        }
    }

    public async initialize() : Promise<void> {
        const masterFilePath: string = this.getMasterFilePath();

        const originalContent = await fs.promises.readFile(
            masterFilePath,
            "utf8",
        );

        await this.preProcessContent(originalContent);
    }

    //====================================================================
    //#region utilities
    public showMasterDocument(): void {
        vscode.window.showTextDocument(this.masterDocument, {
            preview: false,
        });
    }

    //====================================================================
    //#region subscription management
    public subscribe(id: string, viewerDocument: vscode.TextDocument): boolean {
        if (this.isTrackingId(id) || this.isTrackingFile(viewerDocument.fileName)) {
            return false;
        }

        let mapping: TrackedLocalFile = { kind: 'local', id, viewerDocument };

        mapping.watcher = createFileWatcher(viewerDocument);
        mapping.watcher.onDidDelete((e) => {
            this.unsubscribeByFile(e.fsPath, true);
        });

        this.fileMappings.push(mapping);

        console.log("Subscribeing.");
        // on initial subscription, we need to generate an initial line mapping
        if (this.fileMappings.filter(m => m.kind === 'local').length === 1) {
            this.lineMappings = LineMapper.parseLineMappingsFromContent(
                viewerDocument.getText(),
                this.language,
                new VSCodeHost()
            );
        }
        return true;
    }

    public subscribeVirtual(uri: vscode.Uri): boolean {
        const id = uri.toString();
        if (this.isTrackingId(id)) {
            return false; // already tracking
        }
        this.fileMappings.push({ kind: 'virtual', id, uri });
        return true;
    }

    public unsubscribeById(id: string, close?: boolean): number {
        const mapping = this.fileMappings.find((m) => m.id === id);
        if (mapping) {
            this.fileMappings = this.fileMappings.filter((m) => m !== mapping);
            if (close) {
                if (mapping.kind === 'local') {
                    closeTextDocument(mapping.viewerDocument);
                    mapping.watcher?.dispose();
                }
            }
            if(!this.hasFilesToTrack()) {
                this.syncService.clearEmptySyncs();
            }
        }
        return this.fileMappings.length;
    }

    public unsubscribeByFile(viewerFile: string, close?: boolean): number {
        viewerFile = path.normalize(viewerFile);
        const mapping = this.fileMappings.find(
            (m): m is TrackedLocalFile =>
                m.kind === 'local' &&
                path.normalize(m.viewerDocument.fileName) === viewerFile,
        );
        if (mapping) {
            this.unsubscribeById(mapping.id, close);
        }
        return this.fileMappings.length;
    }

    public unsubscribeVirtualByUri(uri: vscode.Uri, close?: boolean): void {
        this.unsubscribeById(uri.toString(), close);
    }

    public evictVirtualMappingsForObject(object_id: string): void {
        const prefix = `/${object_id}/`;
        this.fileMappings = this.fileMappings.filter(
            (m) => m.kind !== 'virtual' ||
                   (!m.uri.path.startsWith(prefix) && m.uri.path !== `/${object_id}`)
        );
    }

    //#endregion
    //====================================================================
    //#region Properties
    public isTrackingId(id: string): boolean {
        return this.fileMappings.some((mapping) => mapping.id === id);
    }

    public isTrackingFile(viewerFile: string): boolean {
        // TODO: revisit use of fileName for comparison — for remote/virtual workspace
        // support this should use viewerDocument.uri.toString() instead.
        return this.fileMappings.some(
            (m): m is TrackedLocalFile =>
                m.kind === 'local' && m.viewerDocument.fileName === viewerFile,
        );
    }

    public isTrackingVirtualUri(uri: vscode.Uri): boolean {
        return this.isTrackingId(uri.toString());
    }

    public hasFilesToTrack() : boolean {
        return this.fileMappings.length > 0;
    }

    public getMasterDocument(): vscode.TextDocument {
        return this.masterDocument;
    }

    public getMasterFilePath(): string {
        return this.masterDocument.uri.fsPath;
    }

    public getMasterUri(): vscode.Uri {
        return this.masterDocument.uri;
    }

    public getLanguage(): string {
        return this.language;
    }

    public getTrackedIds(): string[] {
        // Only return local script IDs — virtual URI strings must not be sent
        // to the viewer as script.subscribe targets.
        return this.fileMappings
            .filter((m): m is TrackedLocalFile => m.kind === 'local')
            .map((m) => m.id);
    }
    //#endregion

    //#region Diagnostics
    public clearDiagnostics(): void {
        this.diagnosticSources.forEach((source) => {
            this.diagnosticCollection.delete(vscode.Uri.parse(source));
        });
        this.diagnosticSources.clear();
    }

    public addDiagnostics(diagnosticsMap: { [source: string]: vscode.Diagnostic[] }): void {
        Object.entries(diagnosticsMap).forEach(([filePath, diagnostics]) => {
            const fileUri = vscode.Uri.parse(filePath);

            const oldList = this.diagnosticCollection.get(fileUri) || [];
            const newList = [...oldList, ...diagnostics];

            this.diagnosticSources.add(filePath);
            this.diagnosticCollection.set(fileUri, newList);
            console.log(`Displayed ${diagnostics.length} errors for ${path.basename(fileUri.fsPath)}`);
        });

    }

    public async handleCompilationResult(message: CompilationResult): Promise<void> {
        const scriptUri: vscode.Uri = this.masterDocument.uri;
        const scriptName: string = path.basename(this.masterDocument.fileName);

        if (message.success) {
            // Clear any existing diagnostics on successful compilation
            this.diagnosticCollection.delete(scriptUri);
            showStatusMessage(
                `Compilation successful for ${scriptName} and script is ${message.running ? 'running' : 'not running'}`);
            return;
        }

        const errors = message.errors || [];

        // Walk through the errors returned from the viewer and map them back to a source file.
        const diagnosticList: {
            [source: string]: vscode.Diagnostic[];
        } = {};

        errors.forEach((error) => {
            let line = error.row;
            let file: StringUri = vscodeUriToStringUri(this.masterDocument.uri);
            let document: vscode.TextDocument | undefined = this.masterDocument;

            if (this.lineMappings) {
                const mapping = LineMapper.convertAbsoluteLineToSource(this.lineMappings, error.row);
                if (mapping) {
                    line = mapping.line;
                    file = mapping.source;
                    document = vscode.workspace.textDocuments.find(doc =>
                        uriEquals(vscodeUriToStringUri(doc.uri), mapping.source)
                    );
                }
            }

            line = Math.max(0, (line || 1) - 1);
            const column = Math.max(0, (error.column || 1) - 1);

            // Get the line length to create a proper range
            const lineText = document?.lineAt(Math.min(line, document.lineCount - 1)).text;
            const endColumn = lineText ? (column < lineText.length ? column + 1 : lineText.length) : column + 1;

            const range = new vscode.Range(
                new vscode.Position(line, column),
                new vscode.Position(line, endColumn)
            );

            const diagnostic = new vscode.Diagnostic(
                range,
                error.message,
                errorLevelToSeverity(error.level)
            );
            diagnostic.source = `Second Life Compile`;

            if (!diagnosticList[file]) {
                diagnosticList[file] = [];
            }
            diagnosticList[file].push(diagnostic);

        });

        this.addDiagnostics(diagnosticList);
    }

    public usesInclude(filePath:string) : boolean {
        return this.includedFiles.some(
            include => include.path === filePath,
        );
    }

    public static preprocessorErrorsToDiagnostics(
        errors: PreprocessorError[],
        sourceName: string = "Second Life Preprocessor"
    ): { [source: string]: vscode.Diagnostic[] } {
        const diagnosticMap: { [source: string]: vscode.Diagnostic[] } = {};

        for (const error of errors) {
            // Skip errors without a file path
            if (!error.file) {
                continue;
            }

            const file = error.file;
            const line = Math.max(0, (error.lineNumber || 1) - 1);
            const column = 0;

            // Create a range for the diagnostic
            const range = new vscode.Range(
                new vscode.Position(line, column),
                new vscode.Position(line, column + 1)
            );

            // Create the diagnostic
            const diagnostic = new vscode.Diagnostic(
                range,
                error.message,
                error.isWarning ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error
            );
            diagnostic.source = sourceName;

            // Add to the map
            if (!diagnosticMap[file]) {
                diagnosticMap[file] = [];
            }
            diagnosticMap[file].push(diagnostic);
        }

        return diagnosticMap;
    }

    //#endregion

    //#region Script Compilation and Runtime
    public async handleRuntimeError(message: RuntimeError): Promise<void> {
        const errorMessage = `Runtime error on object ${message.object_name} (${message.object_id}): ${message.error}`;

        let line = message.line;
        let file: StringUri = vscodeUriToStringUri(this.masterDocument.uri);
        let document: vscode.TextDocument | undefined = this.masterDocument;

        if (this.lineMappings) {
            const mapping = LineMapper.convertAbsoluteLineToSource(this.lineMappings, message.line);
            if (mapping) {
                line = mapping.line;
                file = mapping.source;
                document = vscode.workspace.textDocuments.find(doc =>
                    uriEquals(vscodeUriToStringUri(doc.uri), mapping.source)
                );
            }
        }

        line = Math.max(0, (line || 1) - 1);
        const column = 0;

        // Get the line length to create a proper range
        const lineText = document?.lineAt(Math.min(line, document.lineCount - 1)).text;
        const endColumn = lineText ? (column < lineText.length ? column + 1 : lineText.length) : column + 1;

        const range = new vscode.Range(
            new vscode.Position(line, column),
            new vscode.Position(line, endColumn)
        );

        const diagnostic = new vscode.Diagnostic(
            range,
            errorMessage,
            vscode.DiagnosticSeverity.Error
        );
        diagnostic.source = `Second Life Runtime`;

        const fileUri = vscode.Uri.parse(file as string);
        this.diagnosticSources.add(file);
        this.diagnosticCollection.set(fileUri, [diagnostic]);

        const errorLog = errorMessage +
            (message.stack ? `\nStack trace:\n    ${message.stack.join('\n    ')}` : '');
        logError(errorLog);

    }

    public async handleRuntimeDebug(message: RuntimeDebug): Promise<void> {
        const debugMessage = `Debug message on object ${message.object_name} (${message.object_id}): ${message.message}`;
        logInfo(debugMessage);
    }
    //#endregion

    public async preProcessContent(originalContent: string): Promise<string> {
        // Check if preprocessing is enabled
        if(!this.preprocessor) return originalContent;
        if(!this.config.getConfig<boolean>(ConfigKey.PreprocessorEnable)) return originalContent;

        this.clearDiagnostics();

        const masterFilePath: string = this.getMasterFilePath();
        const baseName: string = path.basename(masterFilePath);
        let preprocessorResult: PreprocessorResult | null = null;
        let finalContent = originalContent;
        try {
            console.log(`Preprocessing enabled for: ${baseName}`);

            this.macros.clearNonSystemMacros();
            const languageConfig = this.getLanguageConfig();
            preprocessorResult = await this.preprocessor.process(
                originalContent,
                vscodeUriToStringUri(this.masterDocument.uri),
                languageConfig,
            );

            if (preprocessorResult.issues && preprocessorResult.issues.length > 0) {
                const diagnostics = ScriptSync.preprocessorErrorsToDiagnostics(
                    preprocessorResult.issues,
                    `${preprocessorResult.language} Preprocessor`
                );
                this.addDiagnostics(diagnostics);
            }

            if (preprocessorResult.includes && preprocessorResult.includes.length > 0) {
                this.includedFiles = preprocessorResult.includes;
            }

            if (preprocessorResult.success) {
                finalContent = preprocessorResult.content;
                this.lineMappings = preprocessorResult.lineMappings;

                console.log(
                    `${preprocessorResult.language.toUpperCase()} preprocessing completed successfully for: ${baseName}`,
                );
            } else {
                // Preprocessing failed, use original content and show error
                finalContent = originalContent;

                vscode.window.showErrorMessage("Preprocessing failed");
            }
        } catch (error) {
            // Fallback to original content on any unexpected errors
            finalContent = originalContent;
            const errorMessage = `Preprocessing error for ${baseName}: ${error instanceof Error ? error.message : String(error)}`;
            console.error(errorMessage);
            vscode.window.showErrorMessage(errorMessage);
        }
        return finalContent;
    }

    private getLanguageConfig(): LanguageLexerConfig {
        const config = getLanguageConfig(this.language, this.config);
        if(config.name === "lsl" && this.config.getConfig<boolean>(ConfigKey.PreprocessorLSLSwitchStatements, false)) {
            config.directiveKeywords.push("switch");
        }
        return config;
    }

    public async handleMasterSaved(): Promise<void> {
        try {
            // Read the original content
            const masterFilePath: string = this.getMasterFilePath();

            const originalContent = await fs.promises.readFile(
                masterFilePath,
                "utf8",
            );
            const processedContent = await this.preProcessContent(originalContent);

            const sha = sha256.create();
            sha.update(processedContent);
            const hash = sha.hex();

            const prefixedContent = this.prefixWithMetaInformation(processedContent, hash);

            // Walk through all tracked files and save if hash has changed
            await Promise.all(
                this.getFileMappingsFilteredByHash(hash)
                    .map((mapping) => {
                        mapping.hash = hash;
                        if (mapping.kind === 'local') {
                            if (masterFilePath === mapping.viewerDocument.fileName) {
                                // Do not write to the same file we are processing from.
                                // Allows quick editing of a script externally that hasn't matched
                                // without the script extending forever if the preproc is enabled.
                                return Promise.resolve();
                            }
                            return fs.promises.writeFile(
                                mapping.viewerDocument.fileName,
                                prefixedContent,
                                "utf8",
                            );
                        } else {
                            // Virtual (sl://) — same content as local temp files,
                            // written via the virtual filesystem provider
                            return vscode.workspace.fs.writeFile(
                                mapping.uri,
                                Buffer.from(prefixedContent, "utf-8"),
                            );
                        }
                    }),
            );

        } catch (err: any) {
            vscode.window.showErrorMessage(`Error syncing file: ${err.message}`);
        }
    }

    private prefixWithMetaInformation(content:string, hash: string) : string {
        // console.error("PREFIX ENABLED", this.config.getConfig<boolean>(ConfigKey.FileMetaInfoInOutput,false));
        if(!this.config.getConfig<boolean>(ConfigKey.FileMetaInfoInOutput,false)) {
            return content;
        }
        const meta : string[]= [];
        const date = (new Date()).toISOString().split("T");

        // console.error("PREFIX")

        const path = vscode.workspace.asRelativePath(this.masterDocument.uri.fsPath);

        const comment =  this.getLanguageConfig().lineCommentPrefix;

        if(comment.length < 1) return content;

        meta.push(`${comment} ================ sl-vscode-plugin meta ================`);
        meta.push(`${comment} @file ${path}`);
        meta.push(`${comment} @hash ${hash}`);
        meta.push(`${comment} @date ${date[0]} ${date[1].split(".")[0]}`);
        // console.error("PREFIX CREATOR", this.config.getConfig<boolean>(ConfigKey.FileMetaInfoIncludeCreator,false));
        if(this.config.getConfig<boolean>(ConfigKey.FileMetaInfoIncludeCreator, false)) {
            const agentName = ScriptSync.getCurrentAgentName();
            if(agentName) meta.push(`${comment} @creator ${agentName}`);
            const agentID = ScriptSync.getCurrentAgentId();
            if(agentID) meta.push(`${comment} @creatorID ${agentID}`);
        }
        meta.push(`${comment} =======================================================`);
        meta.push(content)

        return meta.join("\n");
    }

    private getFileMappingsFilteredByHash(hash:string) : TrackedFile[] {
        if(!ConfigService.getInstance().getConfig<boolean>(ConfigKey.CompareHashBeforeSync, false)) {
            return this.fileMappings;
        }
        return this.fileMappings.filter(mapping => mapping.hash !== hash);
    }

    private static getCurrentAgentId(): string | null {
        return SynchService.getInstance().agentId ?? null;
    }

    private static getCurrentAgentName(): string | null {
        return SynchService.getInstance().agentName ?? null;
    }

    private initializeSystemMacros(language: ScriptLanguage): void {
        if (!this.macros) {
            return;
        }

        if(language === "luau" && !this.config.getConfig<boolean>(ConfigKey.PreprocessorConstantsInSLua, false)) {
            return;
        }

        this.macros.clear();
        if (language === "lsl") {
            this.macros.defineSystemMacro("__AGENTKEY__", (_context) => `"${ScriptSync.getCurrentAgentId() ?? "unkown-agent-id"}"`);
            this.macros.defineSystemMacro("__AGENTIDRAW__", (_context) => ScriptSync.getCurrentAgentId() ?? "unkown-agent-id");
        } else if(language === "luau") {
            this.macros.defineSystemMacro("__AGENTKEY__", (_context) => `uuid("${ScriptSync.getCurrentAgentId() ?? "unkown-agent-id"}")`);
        }
        this.macros.defineSystemMacro("__LINE__", (context) => context.line.toString());
        this.macros.defineSystemMacro("__FILE__", (context) => `"${path.normalize(context.sourceFile)}"`);
        this.macros.defineSystemMacro("__SHORTFILE__", (context) => `"${path.basename(path.normalize(context.sourceFile))}"`);
        this.macros.defineSystemMacro("__AGENTID__", (_context) => `"${ScriptSync.getCurrentAgentId() ?? "unknown-agent-id"}"`);
        this.macros.defineSystemMacro("__AGENTNAME__", (_context) => `"${ScriptSync.getCurrentAgentName() ?? "unknown-agent-name"}"`);
        //this.macros.defineSystemMacro("__ASSETID__", (_context) => `"${getCurrentAssetId()}"`);
        this.macros.defineSystemMacro("__DATE__", (_context) => {
            let date = new Date();
            return `"${date.toISOString().split("T")[0]}"`;
        });
        this.macros.defineSystemMacro("__TIME__", (_context) => {
            let date = new Date();
            return `"${date.toISOString().split("T")[1].split(".")[0]}"`;
        });
        this.macros.defineSystemMacro("__TIMESTAMP__", (_context) => {
            let date = new Date();
            return `"${date.toISOString()}"`;
        });
        this.macros.defineSystemMacro("__UNIXTIME__", ()=>  `${Math.floor(Date.now() / 1000)}`);
    }

    public dispose(): void {
        if (this.disposed) {
            return;
        }

        this.disposed = true;

        try {
            this.diagnosticCollection.dispose();
            this.fileMappings.forEach(map => {
                if (map.kind === 'local') map.watcher?.dispose();
            });
        } catch (error) {
            // Log but don't throw during disposal
            console.warn("Error during ScriptSync disposal:", error);
        }
    }
}
