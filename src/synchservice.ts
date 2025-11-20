/**
 * @file synchservice.ts
 * Copyright (C) 2025, Linden Research, Inc.
 */
import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { SCRIPT_FILE_PATTERN, ConfigService } from "./configservice";
import { ConfigKey } from "./interfaces/configinterface";
import {
    ViewerEditWSClient,
    CompilationResult,
    SessionHandshake,
    SessionHandshakeResponse,
    SessionDisconnect,
    ScriptSubscribe,
    ScriptSubscribeResponse,
    ScriptUnsubscribe,
    SyntaxChange,
    RuntimeDebug,
    RuntimeError,
} from "./viewereditwsclient";
import {
    hasWorkspace,
    showInfoMessage,
    showStatusMessage,
    showWarningMessage,
    closeEditor,
} from "./utils";
import { maybe } from "./shared/sharedutils"; // TODO: migrate needed utilities from sharedutils if required
import { ScriptLanguage, LanguageService } from "./shared/languageservice";
import { ScriptSync } from "./scriptsync";

export class SynchService implements vscode.Disposable {
    // Tracks all active sync relationships between temp files and master files
    private activeSyncs: Map<string, ScriptSync> = new Map();
    private context: vscode.ExtensionContext;
    private static instance: SynchService;
    private websocket: ViewerEditWSClient | undefined;
    private handshakeResolve?: (value: boolean, message?: string) => void;
    private handshakePromise?: Promise<{ success: boolean; message: string }>;
    private lastActiveChange: number = 0;
    private activeSync: ScriptSync | undefined;

    public viewerName?: string;
    public viewerVersion?: string;
    public viewerLanguages?: string[];
    public viewerFeatures?: { [feature: string]: boolean };
    public syntaxId?: string;
    public agentId?: string;
    public agentName?: string;

    private disposables : vscode.Disposable[] = [];

    private constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    public static getInstance(context?: vscode.ExtensionContext): SynchService {
        if (!SynchService.instance) {
            if (!context) {
                throw new Error(
                    "SynchService not initialized. Context is required for first initialization.",
                );
            }
            SynchService.instance = new SynchService(context);
        }
        return SynchService.instance;
    }

    dispose(): void {
    // Dispose of all active script syncs
        for (const [tempFilePath, scriptSync] of this.activeSyncs) {
            try {
                scriptSync.dispose();
            } catch (error) {
                console.warn(`Error disposing sync for ${tempFilePath}:`, error);
            }
        }
        this.activeSyncs.clear();
        for(const disposable of this.disposables) {
            disposable.dispose();
        }
        this.disposables = [];
    }

    public initialize(): void {

        const onDidOpenListener = vscode.workspace.onDidOpenTextDocument(
            async (document) => this.onOpenTextDocument(document),
        );

        const onDidCloseListener = vscode.workspace.onDidCloseTextDocument(
            (document: vscode.TextDocument) => this.onCloseTextDocument(document),
        );

        const onDidDeleteListener = vscode.workspace.onDidDeleteFiles(
            (event: vscode.FileDeleteEvent) => this.onDeleteFiles(event),
        );

        const onDidSaveListener = vscode.workspace.onDidSaveTextDocument(
            (document: vscode.TextDocument) => this.onSaveTextDocument(document),
        );

        const onDidChangeWindowState = vscode.window.onDidChangeWindowState(
            (windowState: vscode.WindowState) =>
                this.onChangeWindowState(windowState),
        );

        const onDidChangeActiveTextEditor = vscode.window.onDidChangeActiveTextEditor(
            (editor: vscode.TextEditor | undefined) =>
                this.onChangeActiveTextEditor(editor),
        );

        this.initializeSyntax();

        // TODO: Figure out why restart isn't working on the luau-lsp server
        // TODO: Bug when prepping language syntax on download
        // const syntaxInit = this.initializeSyntax();
        // showStatusMessage("Initializing syntax...", syntaxInit);

        this.disposables.push(onDidOpenListener);
        this.disposables.push(onDidCloseListener);
        this.disposables.push(onDidDeleteListener);
        this.disposables.push(onDidSaveListener);
        this.disposables.push(onDidChangeWindowState);
        this.disposables.push(onDidChangeActiveTextEditor);
    }

    private async initializeSyntax(): Promise<void> {
        let loaded = false;
        const lastSyntaxID = ConfigService.getInstance().getConfig<string>(ConfigKey.LastSyntaxID);
        const languageService = LanguageService.getInstance();

        if (lastSyntaxID) {
            loaded = await languageService.changeSyntaxVersion(lastSyntaxID);
        }
        // TODO: Search for the most recently cached syntax version and load that
        if (!loaded) {
            loaded = await languageService.changeSyntaxVersion("default");
        }

        if (!loaded) {
            showWarningMessage(
                "Failed to load any language syntax definitions.\nSyntax highlighting and error checking may not be accurate.",
            );
        }
    }

    private async setupSync(
        viewerDocument: vscode.TextDocument,
    ): Promise<boolean> {
        const viewerFilePath = path.normalize(viewerDocument.fileName);
        const openedBase = path.basename(viewerFilePath);

        if (!hasWorkspace()) {
            showWarningMessage(
                "No workspace is open. Open a workspace to enable script syncing.",
            );
            return false;
        }

        const parsed = SynchService.parseTempFile(viewerFilePath);
        if (!parsed) {
            // TODO: this may be a master file... set up an empty sync.
            return false; // Not a valid SL temp script file
        }

        let masterName = parsed.scriptName + "." + parsed.extension;
        // Look for a file in the workspace with the same name as the master script
        let masterUri = await SynchService.findMasterFile(masterName);
        if (!masterUri) {
            // There was no master file found, we are our own master
            showInfoMessage(
                `No master script found for: ${parsed.scriptName}.${parsed.extension}`,
            );
            masterUri = viewerDocument.uri;
        }

        const masterPath = masterUri.fsPath;
        // Open the master script file in the editor
        showInfoMessage(`Opening master script: ${path.basename(masterPath)}`);
        let masterDoc = await SynchService.openMasterScript(masterUri);

        // Connection goes on in the background
        let viewerConnecting: Promise<boolean> = this.setupConnection();

        viewerConnecting.then((connected) => {
            if (connected) {
                showStatusMessage(
                    `Connected to Second Life viewer for syncing ${openedBase} with ${path.basename(
                        masterPath,
                    )}`,
                );
            } else {
                showWarningMessage(
                    `Failed to connect to Second Life viewer for syncing ${openedBase} with ${path.basename(
                        masterPath,
                    )}`,
                );
            }
        });

        let sync = this.findSyncByTempFilePath(viewerFilePath) ??
            this.findSyncByMasterFilePath(masterPath);
        if (sync) {
            // Already syncing the master, add another id and viewer file
            sync.subscribe(parsed.scriptId, viewerDocument);
        } else {
            const config = ConfigService.getInstance();
            sync = new ScriptSync(
                masterDoc,
                parsed.extension as ScriptLanguage,
                config,
                parsed.scriptId,
                viewerDocument,
            );
            this.activeSyncs.set(masterPath, sync);
        }

        if (this.websocket && this.websocket.isConnected()) {
            this.sendSyncSubscription(sync);
        } else {
            viewerConnecting.then((connected) => {
                if (connected) {
                    this.sendSyncSubscription(sync);
                }
            });
        }

        return true;
    }

    public removeSync(filePath: string, close: boolean): void {
    // seeing if we closed a temp file or a master file
        let sync =
      this.findSyncByTempFilePath(filePath) ??
      this.findSyncByMasterFilePath(filePath);
        if (!sync) {
            // No sync found for this file, we are not tracking it
            return;
        }

        if (sync.getMasterFilePath() !== filePath) {
            // We only destroy the sync if the master file is closed
            // This is so we can continue to handle preprocessor directives while editing.
            this.activeSyncs.delete(sync.getMasterFilePath());
            sync.dispose();
        } else {
            // This is not the master file, just remove the tracking links.
            const parsed = SynchService.parseTempFile(filePath);
            if (parsed) {
                // Remove the tracking subscription, if there are no more tracked files we will dispose the sync
                sync.unsubscribeById(parsed.scriptId);
                if (close) {
                    closeEditor(filePath);
                }
            }
        }

        if (this.activeSyncs.size === 0) {
            // There is nothing being tracked, close the websocket connection
            if (this.websocket) {
                if (this.websocket.isConnected()) {
                    this.websocket.disconnect();
                }
                this.websocket.dispose();
                this.websocket = undefined;
            }
        }
    }

    //====================================================================
    //#region WebSocket connection management and handlers
    private async setupConnection(): Promise<boolean> {
        const handlers = {
            onHandshake: (message: SessionHandshake): any => this.onHandshake(message),
            onHandshakeOk: (): any => this.onHandshakeOk(),
            onDisconnect: (message: SessionDisconnect): any => this.onDisconnect(message),
            onScriptUnsubscribe: (message: ScriptUnsubscribe): any =>
                this.onScriptUnsubscribe(message),
            onSyntaxChange: (message: SyntaxChange): any => this.onSyntaxChange(message),
            onCompilationResult: (message: CompilationResult): any => this.onCompilationResult(message),
            onRuntimeDebug: (message: RuntimeDebug): any => this.onRuntimeDebug(message),
            onRuntimeError: (message: RuntimeError): any => this.onRuntimeError(message),

        };

        if (this.websocket && this.websocket.isConnected()) {
            return true;
        }

        const handshake: Promise<{ success: boolean; message?: string }> =
            this.getHandshakePromise();
        showStatusMessage("Connecting to Second Life viewer...", handshake);

        this.websocket = new ViewerEditWSClient(this.context);
        this.websocket.setup(handlers);
        let connected = await this.websocket.connect();

        if (!connected.success) {
            showWarningMessage(
                `Second Life session failed to connect: ${connected.message}`,
            );
            // we need to also trigger the handshake promise to close the status message.
            this.handshakeResolve!(false, connected.message);
            return false;
        }

        let results = await handshake;

        if (!results.success) {
            showWarningMessage(
                `Second Life session failed to connect: ${results.message}`,
            );
        }

        return results.success;
    }

    //--------------------------------------------------------------------
    private async onHandshake(message: SessionHandshake): Promise<SessionHandshakeResponse> {
        this.viewerName = message.viewer_name;
        this.viewerVersion = message.viewer_version;
        this.agentId = message.agent_id;
        this.agentName = message.agent_name;
        this.viewerLanguages = message.languages;
        this.syntaxId = message.syntax_id;
        this.viewerFeatures = message.features;

        let challengeResponse: string | undefined = undefined;
        if (message.challenge) {
            // The challenge is the name of a file, we just need to read the contents
            // and return it to the server.
            await fs.promises.readFile(message.challenge, 'utf8').then((data: string) => {
                challengeResponse = data;
                console.log("Received challenge from viewer:", message.challenge);
            });
        }

        const response: SessionHandshakeResponse = {
            client_name: ConfigService.getInstance().getConfig<string>(ConfigKey.ClientName) || "sl-vscode-edit",
            client_version: "1.0",
            protocol_version: "1.0",
            ...maybe("challenge_response", challengeResponse),
            languages: ["lsl", "luau"],
            features: {
                live_sync: true,
                error_reporting: true,
                debugging: false,
                breakpoints: false,
            },
        };
        return response;
    }

    private onHandshakeOk(): void {
    // Session established successfully
        console.log(
            `Session established with viewer ${this.viewerName} v${this.viewerVersion}`,
        );
        showInfoMessage(
            `Connected to Second Life viewer: ${this.viewerName} v${this.viewerVersion}`,
        );

        const service = LanguageService.getInstance();
        if (!this.checkLanguageVersion()) {
            const socket = this.getWebSocket();
            if (socket && this.syntaxId) {
                const promise = service.changeSyntaxVersion(this.syntaxId, socket);
                showStatusMessage("Updating to latest language definitions...", promise);
            }
        }

        if (this.handshakeResolve) {
            this.handshakeResolve(true, "Connected");
        }
    }

    private onDisconnect(params: SessionDisconnect): void {
        const reason = params?.reason || 0;
        const message = params?.message || "Session disconnected";

        // Show status message specific to this script

        if (this.handshakeResolve) {
            this.handshakeResolve(false, message);
        } else {
            showStatusMessage(
                `Second Life session disconnected from viewer: ${message} (reason ${reason})`,
            );
        }

    // Don't dispose immediately - let the connection close handler do the cleanup
    // The websocket will be closed by the server, triggering our close handler
    }

    private onScriptUnsubscribe(message: ScriptUnsubscribe): void {
        const scriptId = message.script_id;
        const sync = this.findSyncByScriptId(scriptId);
        if (sync) {
            sync.unsubscribeById(scriptId, true);
        }
    }

    private onSyntaxChange(params: SyntaxChange): void {
        if (this.syntaxId !== params.id) {
            this.syntaxId = params.id;
            if (!this.checkLanguageVersion()) {
                const service = LanguageService.getInstance();
                const socket = this.getWebSocket();
                if (socket) {
                    const promise = service.changeSyntaxVersion(params.id, socket);
                    showStatusMessage("Updating to latest language definitions...", promise);
                }
            }
        }
    }

    private onCompilationResult(message: CompilationResult): void {
        const scriptId = message.script_id;
        const sync = this.findSyncByScriptId(scriptId);

        if (sync) {
            sync.handleCompilationResult(message);
        }
    }

    private onRuntimeDebug(message: RuntimeDebug): void {
        const scriptId = message.script_id;
        const sync = this.findSyncByScriptId(scriptId);
        if (sync) {
            sync.handleRuntimeDebug(message);
        }
        else {
            console.log(`Runtime:Debug in ${message.object_name}: ${message.message}`);
        }
    }

    private onRuntimeError(message: RuntimeError): void {
        const scriptId = message.script_id;
        const sync = this.findSyncByScriptId(scriptId);

        if (sync) {
            sync.handleRuntimeError(message);
        }
        else
        {
            console.warn(`Runtime:Error in ${message.object_name}:${message.line}: ${message.error}`);
        }
    }

    private async sendSyncSubscription(sync: ScriptSync): Promise<void> {
        if (!this.websocket || !this.websocket.isConnected()) {
            return;
        }

        //TODO: This isn't quite right for multiple tracked ids
        // we should check subscription state first for each tracked id
        const masterName = path.basename(sync.getMasterDocument().fileName);
        const language = sync.getLanguage();
        const ids = sync.getTrackedIds();
        for (const id of ids) {
            const subscribeMsg: ScriptSubscribe = {
                script_id: id,
                script_name: masterName,
                script_language: language,
            };
            this.websocket
                .call("script.subscribe", subscribeMsg)
                .then((response: ScriptSubscribeResponse) => {
                    if (response.success) {
                        showStatusMessage(
                            `Subscribed to script ${masterName} for live syncing.`,
                        );
                    } else {
                        showWarningMessage(
                            `Failed to subscribe to script ${masterName}: ${response.message}`,
                        );
                    }
                });
        }
    }

    public getHandshakePromise(): Promise<{
        success: boolean;
        message?: string;
    }> {
        if (!this.handshakePromise) {
            this.handshakePromise = new Promise((resolve, _message?) => {
                this.handshakeResolve = (value: boolean, message?: string): void =>
                    resolve({
                        success: value,
                        message: message || (value ? "Connected" : "Failed to connect"),
                    });
            });
            this.handshakePromise.then((_result) => {
                this.handshakePromise = undefined;
                this.handshakeResolve = undefined;
            });
        }
        return this.handshakePromise;
    }

    public isHandshaking(): boolean {
        return !!this.handshakeResolve;
    }

    //#endregion

    //====================================================================
    //#region Language version checking and management
    public checkLanguageVersion(): boolean | undefined {
        if (!this.syntaxId) {
            return;
        }

        const language: LanguageService = LanguageService.getInstance();
        if (language.getSyntaxID() === this.syntaxId) {
            return true;
        }

        return false;
    }

    public async forceLanguageUpdate(): Promise<void> {
        const service = LanguageService.getInstance();
        const socket = this.getWebSocket();
        if (!socket || !socket.isConnected()) {
            showWarningMessage("No viewer connection for syntax update.");
            return;
        }
        const syntaxId = await service.requestSyntaxId(socket);
        if (!syntaxId) {
            showWarningMessage("Failed to get syntax ID from viewer.");
            return;
        }
        const success = await service.changeSyntaxVersion(syntaxId, socket, true);
        if (!success) {
            showWarningMessage("Failed to update syntax.");
        }
    }

    //#endregion

    //=====================================================================
    //#region Helper methods
    // Break up the temp file name into its components
    private static parseTempFile(
        viewerFilePath: string,
    ): { scriptName: string; scriptId: string; extension: string } | null {
        const openedBase = path.basename(viewerFilePath);
        const match = openedBase.match(SCRIPT_FILE_PATTERN);

        return match
            ? {
                scriptName: match[1],
                scriptId: match[2],
                extension: match[3],
            }
            : null;
    }

    public findSyncByScriptId(scriptId: string): ScriptSync | undefined {
        return [...this.activeSyncs.values()].find((sync) =>
            sync.isTrackingId(scriptId),
        );
    }

    public findSyncByTempFilePath(filePath: string): ScriptSync | undefined {
        filePath = path.normalize(filePath);
        return [...this.activeSyncs.values()].find((sync) =>
            sync.isTrackingFile(filePath),
        );
    }

    public findSyncByMasterFilePath(
        masterFilePath: string,
    ): ScriptSync | undefined {
        return this.activeSyncs.get(path.normalize(masterFilePath));
    }

    private static async findMasterFile(
        scriptName: string,
    ): Promise<vscode.Uri | null> {
        const files = await vscode.workspace.findFiles(`**/${scriptName}`);
        return files.length > 0 ? files[0] : null;
    }

    private static async openMasterScript(
        masterUri: vscode.Uri,
    ): Promise<vscode.TextDocument> {
        const masterDoc = await vscode.workspace.openTextDocument(masterUri);
        await vscode.window.showTextDocument(masterDoc, { preview: false });
        return masterDoc;
    }

    public getWebSocket(): ViewerEditWSClient | undefined {
        return this.websocket;
    }
    //#endregion

    //====================================================================
    //#region Event handlers
    private async onOpenTextDocument(document: vscode.TextDocument): Promise<void> {
        this.lastActiveChange = 0;
        await this.setupSync(document);
    }

    private onCloseTextDocument(document: vscode.TextDocument): void {
        const filePath = path.normalize(document.fileName);
        this.removeSync(filePath, false);
    }

    private onDeleteFiles(event: vscode.FileDeleteEvent): void {
        const uris = event.files;
        uris.forEach((uri) => {
            const filePath = path.normalize(uri.fsPath);
            this.removeSync(filePath, false);
        });
    }

    private onSaveTextDocument(document: vscode.TextDocument): void {
        const filePath = path.normalize(document.fileName);
        this.findSyncByMasterFilePath(filePath)?.handleMasterSaved();
    }

    private onChangeWindowState(windowState: vscode.WindowState): void {
        const timeSinceChange = Date.now() - this.lastActiveChange;
        if (windowState.focused && this.activeSync && timeSinceChange < 500) {
            this.activeSync.showMasterDocument();
            this.lastActiveChange = 0;
            this.activeSync = undefined;
        }
    }

    private onChangeActiveTextEditor(editor: vscode.TextEditor | undefined): void {
        if (!editor) {
            return;
        }
        // The active editor has been changed, this MAY have been due to the viewer
        // relaunching us with an existing temp file. We can't determine this directly,
        // but we can look at the circumstantial evidence, if we already have a sync for
        // this temp file then either the user switched to it, or the viewer launched it.
        // if the viewer launched it we will soon get a foucus event (onChangeWindowState)
        // Find the sync for this file, if any and then record the time.
        const filePath = path.normalize(editor.document.fileName);
        const sync = this.findSyncByTempFilePath(filePath);
        if (sync) {
            // We have a sync for this file, record the time
            // We'll use this to see if a focus event happens very soon after
            // this event, if so we can assume the viewer launched us
            this.lastActiveChange = Date.now();
            this.activeSync = sync;
        }
    }
    //#endregion

    public activate(): void {
        this.deactivate();
        this.initialize();
    }

    //====================================================================
    /**
   * Deactivates the file sync functionality
   */
    public deactivate(): void {
        try {
            // Dispose of all active syncs synchronously
            this.dispose();
        } catch (error) {
            console.warn("Error during SynchService deactivation:", error);
        }
    }
}
