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
import { normalizePath } from "./interfaces/hostinterface";
import { SynchService } from "./synchservice";
import { IncludeInfo } from "./shared/parser";
import { sha256 } from "js-sha256";

//====================================================================
interface TrackedDocument {
  id: string;
  viewerDocument: vscode.TextDocument;
  watcher?: vscode.FileSystemWatcher;
  hash?: string;
}

export class ScriptSync implements vscode.Disposable {
    private saveListener: vscode.Disposable | undefined;
    private masterDocument: vscode.TextDocument;
    private language: ScriptLanguage;
    private fileMappings: TrackedDocument[] = [];
    private macros: MacroProcessor;
    private preprocessor: LexingPreprocessor | undefined;
    private disposed: boolean = false;
    private diagnosticCollection: vscode.DiagnosticCollection;
    private diagnosticSources: Set<string> = new Set();
    private lineMappings?: LineMapping[];
    private config: ConfigService;

    private includedFiles : IncludeInfo[] = [];

    //====================================================================
    public constructor(
        masterDocument: vscode.TextDocument,
        language: ScriptLanguage,
        config: ConfigService,
        scriptId?: string,
        viewerDocument?: vscode.TextDocument,
    ) {
        this.config = config;

        // Create macro processor first
        this.language = language;
        this.macros = new MacroProcessor(this.language);
        this.initializeSystemMacros(language);

        // Initialize preprocessor with macro processor
        const enabled = config.getConfig<boolean>(ConfigKey.PreprocessorEnable) ?? true;
        if (enabled) {
            this.preprocessor = new LexingPreprocessor(new VSCodeHost(), config, this.macros);
        }

        this.masterDocument = masterDocument;
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection(
            config.getConfig<string>(ConfigKey.ClientName) || "SL-Scripting",
        );
        if (scriptId && viewerDocument) {
            this.subscribe(scriptId, viewerDocument);
        }
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

        let mapping: TrackedDocument = { id, viewerDocument };

        mapping.watcher = createFileWatcher(viewerDocument);
        mapping.watcher.onDidDelete((e) => {
            this.unsubscribeByFile(e.fsPath, true);
        });

        this.fileMappings.push(mapping);

        console.log("Subscribeing.");
        // on initial subscription, we need to generate an inital line mapping
        if (this.fileMappings.length === 1) {
            this.lineMappings = LineMapper.parseLineMappingsFromContent(
                viewerDocument.getText(),
                this.language,
                new VSCodeHost()
            );
        }
        return true;
    }

    public unsubscribeById(id: string, close?: boolean): number {
        const mapping = this.fileMappings.find((m) => m.id === id);
        if (mapping) {
            this.fileMappings = this.fileMappings.filter((m) => m !== mapping);
            if (close) {
                closeTextDocument(mapping.viewerDocument);
            }
        }
        return this.fileMappings.length;
    }

    public unsubscribeByFile(viewerFile: string, close?: boolean): number {
        viewerFile = path.normalize(viewerFile);
        const mapping = this.fileMappings.find(
            (m) => path.normalize(m.viewerDocument.fileName) === viewerFile,
        );
        if (mapping) {
            this.fileMappings = this.fileMappings.filter((m) => m !== mapping);
            if (close) {
                closeTextDocument(mapping.viewerDocument);
            }
        }
        return this.fileMappings.length;
    }

    //#endregion
    //====================================================================
    //#region Properties
    public isTrackingId(id: string): boolean {
        return this.fileMappings.some((mapping) => mapping.id === id);
    }

    public isTrackingFile(viewerFile: string): boolean {
        return this.fileMappings.some(
            (mapping) => mapping.viewerDocument.fileName === viewerFile,
        );
    }

    public getMasterDocument(): vscode.TextDocument {
        return this.masterDocument;
    }

    public getMasterFilePath(): string {
        return path.normalize(this.masterDocument.fileName);
    }

    public getLanguage(): string {
        return this.language;
    }

    public getTrackedIds(): string[] {
        return this.fileMappings.map((mapping) => mapping.id);
    }
    //#endregion

    //#region Diagnostics
    public clearDiagnostics(): void {
        this.diagnosticSources.forEach((source) => {
            this.diagnosticCollection.delete(vscode.Uri.file(source));
        });
        this.diagnosticSources.clear();
    }

    public addDiagnostics(diagnosticsMap: { [source: string]: vscode.Diagnostic[] }): void {
        Object.entries(diagnosticsMap).forEach(([filePath, diagnostics]) => {
            const fileUri = vscode.Uri.file(filePath);

            const oldList = this.diagnosticCollection.get(fileUri) || [];
            const newList = [...oldList, ...diagnostics];

            this.diagnosticSources.add(filePath)
            this.diagnosticCollection.set(fileUri, newList);
            console.log(`Displayed ${diagnostics.length} errors for ${path.basename(filePath)}`);
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
            let file = normalizePath(this.masterDocument.uri.fsPath);
            let document: vscode.TextDocument | undefined = this.masterDocument;

            if (this.lineMappings) {
                const mapping = LineMapper.convertAbsoluteLineToSource(this.lineMappings, error.row);
                if (mapping) {
                    line = mapping.line;
                    file = mapping.source;
                    document = vscode.workspace.textDocuments.find(doc =>
                        normalizePath(doc.uri.fsPath) === mapping.source
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
        let file = normalizePath(this.masterDocument.uri.fsPath);
        let document: vscode.TextDocument | undefined = this.masterDocument;

        if (this.lineMappings) {
            const mapping = LineMapper.convertAbsoluteLineToSource(this.lineMappings, message.line);
            if (mapping) {
                line = mapping.line;
                file = mapping.source;
                document = vscode.workspace.textDocuments.find(doc =>
                    normalizePath(doc.uri.fsPath) === mapping.source
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

        const fileUri = vscode.Uri.file(file);
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

    public async handleMasterSaved(): Promise<void> {
        try {
            // Read the original content
            const masterFilePath: string = this.getMasterFilePath();
            const baseName: string = path.basename(masterFilePath);

            const originalContent = await fs.promises.readFile(
                masterFilePath,
                "utf8",
            );
            let finalContent = originalContent;
            let preprocessorResult: PreprocessorResult | null = null;

            this.clearDiagnostics();
            // Check if preprocessing is enabled
            if (this.preprocessor && this.config.getConfig<boolean>(ConfigKey.PreprocessorEnable)) {
                try {
                    console.log(`Preprocessing enabled for: ${baseName}`);

                    this.macros.clearNonSystemMacros();
                    preprocessorResult = await this.preprocessor.process(
                        originalContent,
                        normalizePath(masterFilePath),
                        this.language
                    );


                    if (preprocessorResult.issues && preprocessorResult.issues.length > 0) {
                        const diagnostics = ScriptSync.preprocessorErrorsToDiagnostics(
                            preprocessorResult.issues,
                            `${preprocessorResult.language} Preprocessor`
                        );
                        this.addDiagnostics(diagnostics);
                    }

                    if(preprocessorResult.includes && preprocessorResult.includes.length > 0) {
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
                    const errorMessage = `Preprocessing error for ${baseName}: ${
                        error instanceof Error ? error.message : String(error)
                    }`;
                    console.error(errorMessage);
                    vscode.window.showErrorMessage(errorMessage);
                }
            } else {
                console.log(
                    `Preprocessing disabled, using original content for: ${baseName}`,
                );
            }

            const sha = sha256.create();
            sha.update(finalContent);
            const hash = sha.hex();

            // Walk through all TrackedDocuments and save their finalContents if the hash has changed
            await Promise.all(
                this.fileMappings
                    .filter(mapping => mapping.hash !== hash)
                    .map((mapping) => {
                        mapping.hash = hash;
                        return fs.promises.writeFile(
                            mapping.viewerDocument.fileName,
                            finalContent,
                            "utf8",
                        );
                    }
                    ),
            );

        } catch (err: any) {
            vscode.window.showErrorMessage(`Error syncing file: ${err.message}`);
        }
    }

    private static getCurrentAgentId(): string {
        return SynchService.getInstance().agentId || "unknown-agent-id";
    }

    private static getCurrentAgentName(): string {
        return SynchService.getInstance().agentName || "unknown-agent-name";
    }

    private initializeSystemMacros(language: ScriptLanguage): void {
        if (!this.macros) {
            return;
        }

        this.macros.clear();
        if (language === "lsl") {
            this.macros.defineSystemMacro("__LINE__", (context) => context.line.toString());
            this.macros.defineSystemMacro("__FILE__", (context) => `"${path.normalize(context.sourceFile)}"`);
            this.macros.defineSystemMacro("__SHORTFILE__", (context) => `"${path.basename(path.normalize(context.sourceFile))}"`);
            this.macros.defineSystemMacro("__AGENTID__", (_context) => `"${ScriptSync.getCurrentAgentId()}"`);
            this.macros.defineSystemMacro("__AGENTKEY__", (_context) => `"${ScriptSync.getCurrentAgentId()}"`);
            this.macros.defineSystemMacro("__AGENTIDRAW__", (_context) => ScriptSync.getCurrentAgentId());
            this.macros.defineSystemMacro("__AGENTNAME__", (_context) => `"${ScriptSync.getCurrentAgentName()}"`);
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
        }
    }

    public dispose(): void {
        if (this.disposed) {
            return;
        }

        this.disposed = true;

        try {
            this.diagnosticCollection.dispose();
        } catch (error) {
            // Log but don't throw during disposal
            console.warn("Error during ScriptSync disposal:", error);
        }
    }
}
