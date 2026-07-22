/**
 * @file synchservice.ts
 * Copyright (C) 2025, Linden Research, Inc.
 */
import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { SCRIPT_FILE_PATTERN, ConfigService, NOTECARD_FILE_PATTERN } from "./configservice";
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
    ObjectPublishMessage,
    ObjectUnpublishMessage,
    ObjectUpdateMessage,
    ObjectInventoryItem,
    PublishedObject,
} from "./vscode/objectcontentinterfaces";
import {
    hasWorkspace,
    showInfoMessage,
    showStatusMessage,
    showWarningMessage,
    logDebug,
    logInfo,
    VSCodeHost,
    closeTextDocument,
} from "./utils";
import { maybe } from "./shared/sharedutils"; // TODO: migrate needed utilities from sharedutils if required
import { ScriptLanguage, LanguageService } from "./shared/languageservice";
import { ScriptSync } from "./scriptsync";
import { getLanguageConfig } from "./shared/lexer";
import { HostInterface } from "./interfaces/hostinterface";
import { SyncedFileDecorator } from "./vscode/SyncedFileDecorator";
import { ObjectContentService } from "./vscode/objectcontentservice";
import { SL_SCHEME, SL_AUTHORITY, displayName, itemUri } from "./vscode/objectcontentprovider";

/** PERM_MODIFY bit from viewer LLPermissions */
const PERM_MODIFY = 0x4000;

type ParsedTempFile = { scriptName: string; scriptId: string; extension: string, language: ScriptLanguage, item?: ObjectInventoryItem };

export class SynchService implements vscode.Disposable {
    // Tracks all active sync relationships, keyed by master file uri.toString()
    private activeSyncs: Map<string, ScriptSync> = new Map();
    private context: vscode.ExtensionContext;
    private static instance: SynchService;
    private websocket: ViewerEditWSClient | undefined;
    private handshakeResolve?: (value: boolean, message?: string) => void;
    private handshakePromise?: Promise<{ success: boolean; message: string }>;
    private lastActiveChange: number = 0;
    private activeSync: ScriptSync | undefined;
    private host: HostInterface;
    private initialGenerationDone: boolean = false;
    private pendingLaunchObjectId?: string;
    private pendingLaunchScriptId?: string;

    public viewerName?: string;
    public viewerVersion?: string;
    public viewerLanguages?: string[];
    public viewerFeatures?: { [feature: string]: boolean };
    public syntaxCacheSupported: boolean = false;
    public syntaxId?: string;
    public agentId?: string;
    public agentName?: string;

    private syncedFileDecorator : SyncedFileDecorator;

    private _onDidChangeConnectionState = new vscode.EventEmitter<boolean>();
    readonly onDidChangeConnectionState = this._onDidChangeConnectionState.event;

    private disposables: vscode.Disposable[] = [];

    private constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.host = new VSCodeHost();
        this.syncedFileDecorator = new SyncedFileDecorator(this);
        // Note: _onDidChangeConnectionState is NOT added to disposables
        // because it must survive activate/deactivate cycles
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
        for (const [masterUriKey, scriptSync] of this.activeSyncs) {
            try {
                scriptSync.dispose();
            } catch (error) {
                console.warn(`Error disposing sync for ${masterUriKey}:`, error);
            }
        }
        this.activeSyncs.clear();
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
        this.disposables = [];
    }

    public getHost() : HostInterface
    {
        return this.host;
    }

    public initialize(): void {

        const onDidOpenListener = vscode.workspace.onDidOpenTextDocument(
            async (document) => this.onOpenTextDocument(document),
        );

        // const onDidCloseListener = vscode.workspace.onDidCloseTextDocument(
        //     (document: vscode.TextDocument) => this.onCloseTextDocument(document),
        // );

        const onDidDeleteListener = vscode.workspace.onDidDeleteFiles(
            (event: vscode.FileDeleteEvent) => this.onDeleteFiles(event),
        );

        const onDidCloseWorkspace = vscode.workspace.onDidChangeWorkspaceFolders((e) => {
            e.removed.forEach(folder => this.onCloseWorkspace(folder));
        });

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

        ConfigService.getInstance().on(ConfigKey.PreprocessorConstantsInSLua, () => {
            this.initializeSyntax();
        });

        // TODO: Figure out why restart isn't working on the luau-lsp server
        // TODO: Bug when prepping language syntax on download
        // const syntaxInit = this.initializeSyntax();
        // showStatusMessage("Initializing syntax...", syntaxInit);

        this.disposables.push(onDidOpenListener);
        // this.disposables.push(onDidCloseListener);
        this.disposables.push(onDidCloseWorkspace);
        this.disposables.push(onDidDeleteListener);
        this.disposables.push(onDidSaveListener);
        this.disposables.push(onDidChangeWindowState);
        this.disposables.push(onDidChangeActiveTextEditor);
        this.disposables.push(vscode.window.registerFileDecorationProvider(this.syncedFileDecorator));

        const launchDoc = vscode.window.activeTextEditor?.document

        if(launchDoc) {
            this.onOpenTextDocument(launchDoc);
        }
    }

    private async initializeSyntax(): Promise<void> {
        const autoUpdate: boolean = ConfigService.getInstance().getConfig<boolean>(ConfigKey.AutoUpdateLanguageFiles) != false
        if (!autoUpdate) {
            return;
        }
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
        if (viewerDocument.uri.scheme === SL_SCHEME) {
            await this.setupSyncForSlUri(viewerDocument);
            return true;
        }
        const viewerFilePath = path.normalize(viewerDocument.uri.fsPath);
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

        // Look for a file in the workspace with the same name as the master script
        let masterUri = await SynchService.findMasterFile(parsed, viewerDocument);
        let masterFound = true;
        if (!masterUri) {
            masterFound = false;
            // There was no master file found, we are our own master
            showInfoMessage(
                `No master script found for: ${parsed.scriptName}.${parsed.extension}`,
            );
            masterUri = viewerDocument.uri;
        }

        const masterPath = masterUri.fsPath;
        // Open the master script file in the editor
        showInfoMessage(`Opening master script: ${path.basename(masterPath)}`);
        let masterEditor = await SynchService.openMasterScript(masterUri);
        let masterDoc = masterEditor.document
        SynchService.checkAndUpdateMasterDocumentInBackground(masterEditor, viewerDocument);

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

        const masterSync = this.findSyncByMasterFilePath(masterPath);
        const syncs : ScriptSync[] = [];

        if(masterSync) {
            syncs.push(masterSync);
        } else {
            syncs.push(...this.findSyncsByTempFilePath(viewerFilePath));
        }

        if(!this.host.config.getConfig(ConfigKey.KeepViewerFileOpen, true) && masterFound) {
            void closeTextDocument(viewerDocument).catch((error) => {
                logInfo(
                    `Failed to auto-close viewer document ${viewerDocument.uri.fsPath}: ${error instanceof Error ? error.message : String(error)}`,
                );
            });
        }

        if(syncs.length) {
            // Already syncing the master, add another id and viewer file
            syncs.forEach(sync => sync.subscribe(parsed.scriptId, viewerDocument));
        } else {
            const sync = await this.getOrCreateSync(masterDoc, parsed.extension as ScriptLanguage);
            sync.subscribe(parsed.scriptId, viewerDocument);
            syncs.push(sync);
        }

        syncs.forEach(sync => this.syncedFileDecorator.refresh(sync.getMasterDocument().uri));

        if (this.websocket && this.websocket.isConnected()) {
            syncs.forEach(sync => this.sendSyncSubscription(sync));
        } else {
            viewerConnecting.then((connected) => {
                if (connected) {
                    syncs.forEach(sync=>this.sendSyncSubscription(sync));
                }
            });
        }

        this.clearEmptySyncs();

        return true;
    }

    private async getOrCreateSync(
        masterDoc: vscode.TextDocument,
        language: ScriptLanguage,
    ): Promise<ScriptSync> {
        const key = masterDoc.uri.toString();
        const existing = this.activeSyncs.get(key);
        if (existing) return existing;

        const config = ConfigService.getInstance();
        const sync = new ScriptSync(masterDoc, language, config, '', undefined, this);
        await sync.initialize();
        this.activeSyncs.set(key, sync);
        return sync;
    }

    private async setupSyncForSlUri(
        slDocument: vscode.TextDocument,
    ): Promise<void> {
        if (!hasWorkspace()) {
            return;
        }
        if (!this.websocket?.isConnected()) {
            showWarningMessage(`Cannot link sl:// script: not connected to Second Life viewer.`);
            return;
        }
        const parsed = SynchService.parseSlFileInfo(slDocument.uri);
        if (!parsed) {
            logInfo(`[setupSyncForSlUri] Could not parse sl:// URI: ${slDocument.uri.toString()}`);
            return;
        }
        // Skip filesystem linking for no-modify items (they can still be viewed but not synced)
        const canModify = !parsed.item?.permissions || (parsed.item.permissions.owner & PERM_MODIFY) !== 0;
        if (!canModify) {
            logInfo(
                `[setupSyncForSlUri] Skipping filesystem link for no-modify item "${parsed.scriptName}.${parsed.extension}"`,
            );
            return;
        }
        const masterUri = await SynchService.findMasterFile(parsed, slDocument);
        if (!masterUri) {
            logInfo(
                `[setupSyncForSlUri] No master found for "${parsed.scriptName}.${parsed.extension}"; ` +
                `editing directly via viewer.`,
            );
            return;
        }
        const masterEditor = await SynchService.openMasterScript(masterUri);
        const sync = await this.getOrCreateSync(masterEditor.document, parsed.language);
        sync.subscribeVirtual(slDocument.uri);
        SynchService.checkAndUpdateMasterDocumentInBackground(masterEditor, slDocument);
        this.syncedFileDecorator.refresh(masterEditor.document.uri);
        logInfo(
            `[setupSyncForSlUri] Linked "${parsed.scriptName}" ` +
            `(${slDocument.uri.toString()}) \u2192 ${masterUri.fsPath}`,
        );
        // Do NOT call setupConnection() — already connected
        // Do NOT call sendSyncSubscription() — sl:// content travels via object.content.save
    }

    public removeSync(filePath: string): void {
        // seeing if we closed a temp file or a master file
        let sync = this.findSyncByMasterFilePath(filePath);
        if (!sync) {
            // No sync found for this file, we are not tracking it
            return;
        }

        this.activeSyncs.delete(sync.getMasterUri().toString());
        this.syncedFileDecorator.refresh(sync.getMasterDocument().uri);
        sync.dispose();

        this.clearEmptySyncs();
    }

    public evictSlSyncs(object_id: string): void {
        for (const [, sync] of this.activeSyncs) {
            sync.evictVirtualMappingsForObject(object_id);
        }
        this.clearEmptySyncs();
    }

    public clearEmptySyncs() : void {
        for(const [key,sync] of this.activeSyncs) {
            if(!sync.hasFilesToTrack()) {
                this.activeSyncs.delete(key);
                this.syncedFileDecorator.refresh(sync.getMasterDocument().uri);
                sync.dispose();
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
        vscode.commands.executeCommand(
            "setContext",
            "slVscodeEdit:syncsActive",
            this.activeSyncs.size > 0
        );
    }

    //====================================================================
    //#region WebSocket connection management and handlers
    private async setupConnection(portOverride?: number): Promise<boolean> {
        const handlers = {
            onHandshake: (message: SessionHandshake): any => this.onHandshake(message),
            onHandshakeOk: (): any => this.onHandshakeOk(),
            onDisconnect: (message: SessionDisconnect): any => this.onDisconnect(message),
            onConnectionClosed: (): any => this.onConnectionClosed(),
            onUnsubscribe: (message: ScriptUnsubscribe): any =>
                this.onScriptUnsubscribe(message),
            onSyntaxChange: (message: SyntaxChange): any => this.onSyntaxChange(message),
            onCompilationResult: (message: CompilationResult): any => this.onCompilationResult(message),
            onRuntimeDebug: (message: RuntimeDebug): any => this.onRuntimeDebug(message),
            onRuntimeError: (message: RuntimeError): any => this.onRuntimeError(message),
            onObjectPublish: (msg: ObjectPublishMessage): any => {
                logDebug(`[object.publish] object_id=${msg.object.object_id}`);
                ObjectContentService.getInstance().handlePublish(msg);
            },
            onObjectUnpublish: (msg: ObjectUnpublishMessage): any => {
                logDebug(`[object.unpublish] object_id=${msg.object_id}`);
                ObjectContentService.getInstance().handleUnpublish(msg);
            },
            onObjectUpdate: (msg: ObjectUpdateMessage): any => {
                logDebug(`[object.update] object_id=${msg.object_id}`);
                logDebug(`[object.update] object_name=${msg.object_name}`);
                ObjectContentService.getInstance().handleUpdate(msg);
            },
        };

        if (this.websocket && this.websocket.isConnected()) {
            return true;
        }

        const handshake: Promise<{ success: boolean; message?: string }> =
            this.getHandshakePromise();
        showStatusMessage("Connecting to Second Life viewer...", handshake);

        const port = portOverride
            ?? this.host.config.getConfig<number>(ConfigKey.NetworkWebsocketPort, 9020);
        this.websocket = new ViewerEditWSClient(
            this.context,
            `ws://localhost:${port}`
        );
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
        this.syntaxCacheSupported = message.features?.["syntax_cache"] === true;

        let challengeResponse: string | undefined = undefined;
        if (message.challenge) {
            // The challenge is the name of a file, we just need to read the contents
            // and return it to the server.
            await fs.promises.readFile(message.challenge, 'utf8').then((data: string) => {
                challengeResponse = data;
                console.log("Received challenge from viewer:", message.challenge);
            });
        }

        const firstSync = this.activeSync ?? [...this.activeSyncs.values()][0];
        const scriptName = firstSync ? path.basename(firstSync.getMasterUri().fsPath) : undefined;
        const scriptLanguage = firstSync ? firstSync.getLanguage() : undefined;

        const response: SessionHandshakeResponse = {
            client_name: ConfigService.getInstance().getConfig<string>(ConfigKey.ClientName) || "sl-vscode-plugin",
            client_version: "1.0",
            protocol_version: "1.0",
            ...maybe("challenge_response", challengeResponse),
            ...maybe("script_name", scriptName),
            ...maybe("script_language", scriptLanguage),
            languages: ["lsl", "luau"],
            features: {
                live_sync: true,
                error_reporting: true,
                debugging: false,
                breakpoints: false,
                object_publish: true,
            },
        };
        return response;
    }

    private async onHandshakeOk(): Promise<void> {
        // Session established successfully
        console.log(
            `Session established with viewer ${this.viewerName} v${this.viewerVersion}`,
        );
        showInfoMessage(
            `Connected to Second Life viewer: ${this.viewerName} v${this.viewerVersion}`,
        );

        const service = LanguageService.getInstance();
        await this.refreshSyntaxCacheListIfSupported(service);
        if (!this.checkLanguageVersion()) {
            const socket = this.getWebSocket();
            if (socket && this.syntaxId) {
                const promise = service.changeSyntaxVersion(
                    this.syntaxId,
                    socket,
                    false,
                    this.syntaxCacheSupported,
                );
                showStatusMessage("Updating to latest language definitions...", promise);
            }
        }

        if (this.handshakeResolve) {
            this.handshakeResolve(true, "Connected");
        }

        this._onDidChangeConnectionState.fire(true);

        // Start periodic ping timer for connection health monitoring
        this.websocket?.startPingTimer();

        await this.handleLaunchParams();
        await this.syncPublishedObjects();
    }

    private onDisconnect(params: SessionDisconnect): void {
        // Graceful disconnect - just show the message with reason
        // Actual cleanup happens in onConnectionClosed which fires after socket closes
        const reason = params?.reason || 0;
        const message = params?.message || "Session disconnected";
        showStatusMessage(
            `Second Life viewer disconnected: ${message} (reason ${reason})`,
        );
    }

    private onConnectionClosed(): void {
        // All cleanup happens here - fires for both graceful and crash disconnects
        console.log("[SynchService] Connection closed");
        this.websocket?.stopPingTimer();

        if (this.handshakeResolve) {
            this.handshakeResolve(false, "Connection closed");
        }

        this._onDidChangeConnectionState.fire(false);
        // Collapse explorer folders instead of removing tracked objects
        vscode.commands.executeCommand("workbench.files.action.collapseExplorerFolders");
    }

    private onScriptUnsubscribe(message: ScriptUnsubscribe): void {
        const scriptId = message.script_id;
        const sync = this.findSyncByScriptId(scriptId);
        if (sync) {
            sync.unsubscribeById(scriptId, true);
        }
    }

    private async onSyntaxChange(params: SyntaxChange): Promise<void> {
        if (this.syntaxId !== params.id) {
            this.syntaxId = params.id;
            const service = LanguageService.getInstance();
            await this.refreshSyntaxCacheListIfSupported(service);
            if (!this.checkLanguageVersion()) {
                const socket = this.getWebSocket();
                if (socket) {
                    const promise = service.changeSyntaxVersion(
                        params.id,
                        socket,
                        false,
                        this.syntaxCacheSupported,
                    );
                    showStatusMessage("Updating to latest language definitions...", promise);
                }
            }
        }
    }

    private async refreshSyntaxCacheListIfSupported(service: LanguageService): Promise<void> {
        if (!this.syntaxCacheSupported) {
            return;
        }

        const socket = this.getWebSocket();
        if (!socket) {
            return;
        }

        await service.requestSyntaxCacheList(socket);
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
        else {
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
        const autoUpdate: boolean = ConfigService.getInstance().getConfig<boolean>(ConfigKey.AutoUpdateLanguageFiles) != false
        if (!autoUpdate) {
            return true;
        }

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
        const defaultSuccess = await service.changeSyntaxVersion('default');
        if (!defaultSuccess) {
            showWarningMessage("Failed to update default syntax.");
        }
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
        const success = await service.changeSyntaxVersion(syntaxId, socket, true, this.syntaxCacheSupported);
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
    ): ParsedTempFile | null {
        return SynchService.parseTempScriptFile(viewerFilePath) ?? SynchService.parseTempNotecardFile(viewerFilePath);
    }

    private static parseTempScriptFile(
        viewerFilePath: string,
    ): ParsedTempFile | null {
        const openedBase = path.basename(viewerFilePath);
        const match = openedBase.match(SCRIPT_FILE_PATTERN);

        return match
            ? {
                scriptName: match[1],
                scriptId: match[2],
                extension: match[3],
                language: match[3].toLowerCase() == "lsl" ? "lsl" : "luau",
            }
            : null;
    }

    private static parseTempNotecardFile(
        viewerFilePath: string,
    ): ParsedTempFile | null {
        const openedBase = path.basename(viewerFilePath);
        const match = openedBase.match(NOTECARD_FILE_PATTERN);

        return match
            ? {
                scriptName: match[1],
                scriptId: match[2],
                extension: "txt",
                language: "txt",
            }
            : null;
    }

    private static parseSlFileInfo(uri: vscode.Uri): ParsedTempFile | null {
        if (uri.scheme !== SL_SCHEME || uri.authority !== SL_AUTHORITY) {
            return null;
        }
        // Path segments after stripping the leading "/"
        // Structure: /<root_id>/[<link_dir>/]<item_id_or_display_name>
        const segments = uri.path.replace(/^\//, '').split('/');
        if (segments.length < 2) {
            return null;
        }

        const root_id = segments[0];
        const lastSeg = segments[segments.length - 1];

        // Always resolve name and type from the inventory record, never from the URI path.
        // The last segment may be a UUID (itemUri) or a display name (Explorer) — both are
        // matched against the service inventory.
        const item = SynchService.findSlInventoryItem(root_id, lastSeg);
        if (!item) return null;

        const fullName = displayName(item);           // e.g. "My Script.luau"
        const di = fullName.lastIndexOf('.');
        if (di < 0) return null;

        const scriptName = fullName.slice(0, di);     // "My Script"
        const extension = fullName.slice(di + 1).toLowerCase(); // "luau"
        const language: ScriptLanguage = extension === 'lsl' ? 'lsl' : 'luau';

        return { scriptName, scriptId: uri.toString(), extension, language, item };
    }

    private static findSlInventoryItem(
        root_id: string,
        seg: string,
    ): ObjectInventoryItem | undefined {
        const service = ObjectContentService.getInstance();
        for (const inv of service.getAllInventories(root_id)) {
            const byId = inv.find(i => i.item_id === seg);
            if (byId) return byId;
            const byName = inv.find(i => displayName(i) === seg);
            if (byName) return byName;
        }
        return undefined;
    }

    public findSyncByScriptId(scriptId: string): ScriptSync | undefined {
        return [...this.activeSyncs.values()].find((sync) =>
            sync.isTrackingId(scriptId),
        );
    }

    public findSyncsByTempFilePath(filePath: string): ScriptSync[] {
        filePath = path.normalize(filePath);
        return [...this.activeSyncs.values()].filter((sync) =>
            sync.isTrackingFile(filePath),
        );
    }

    public findSyncByMasterFilePath(
        masterFilePath: string,
    ): ScriptSync | undefined {
        return this.activeSyncs.get(vscode.Uri.file(masterFilePath).toString());
    }

    public findSyncByIncludeFilePath(
        includePath: string,
    ): ScriptSync[] {
        const syncs: ScriptSync[] = [];
        for (const sync of this.activeSyncs.values()) {
            if (sync.usesInclude(includePath)) {
                syncs.push(sync);
            }
        }
        return syncs;
    }

    private static async findMasterFile(
        script: ParsedTempFile,
        viewerFile: vscode.TextDocument
    ): Promise<vscode.Uri | null> {
        // Attempt to match by file meta info
        const metaMatch = await SynchService.findMasterFileByMetaComment(script, viewerFile);
        if(metaMatch) return metaMatch;

        let files = await vscode.workspace.findFiles(`**/${script.scriptName}.${script.extension}`);
        // Only consider local files as master candidates. Remote/virtual workspace support
        // would require updating ScriptSync.initialize and handleMasterSaved to use
        // vscode.workspace.fs.readFile instead of fs.promises.readFile.
        files = files.filter(f => f.scheme === 'file');
        if (files.length > 0) {
            return files[0];
        } else {
            // Not found a glob match, try a broader fit
            // Get all files with right extenstion
            const possibleFiles = (await vscode.workspace.findFiles(`**/*.${script.extension}`))
                .filter(f => f.scheme === 'file'); // see note above
            for (const possibleFile of possibleFiles) {
                const wsFile = vscode.Uri.file(vscode.workspace.asRelativePath(possibleFile));
                // filter out paths with hidden directories
                if (wsFile.path.includes("/.") || wsFile.path.includes("\\.")) continue;
                let relative = wsFile.path;
                // Remove leading `/` or `\` characters
                while (relative.startsWith("/") || relative.startsWith("\\")) {
                    relative = relative.slice(1);
                }
                const matches = [
                    relative.replaceAll(path.sep, ""), // Try match `folder/script.luau` to `folderscript` or `folder/script` from sl
                    relative.replaceAll(path.sep, "_"), // Try to match `folder/script.luau` to `folder_script` from sl
                    relative.replaceAll(path.sep, " "), // Try to match `folder/script.luau` to `folder_script` from sl
                ];
                if (matches.includes(`${script.scriptName}.${script.extension}`)) {
                    return possibleFile;
                }
                logInfo(relative);
            }
            return null
        }
    }

    // Resolve file by checking actual paths, not searching with globs as, filenames may contain glob special characters
    private static async resolveUriFromMetaFilePath(
        pathPart: string,
    ): Promise<vscode.Uri | null> {
        const trimmed = pathPart.trim();
        if (!trimmed) {
            return null;
        }

        const isWindowsDrive = /^[a-zA-Z]:[\\/]/.test(trimmed);
        const isAbs = path.isAbsolute(trimmed) || isWindowsDrive;

        const tryUriInWorkspace = async (uri: vscode.Uri): Promise<vscode.Uri | null> => {
            if (!vscode.workspace.getWorkspaceFolder(uri)) {
                return null;
            }
            try {
                const st = await vscode.workspace.fs.stat(uri);
                if (st.type === vscode.FileType.File) {
                    return uri;
                }
            } catch {
                // Miss
            }
            return null;
        };

        if (isAbs) {
            const uri = vscode.Uri.file(path.normalize(trimmed));
            return tryUriInWorkspace(uri);
        }

        const folders = vscode.workspace.workspaceFolders;
        if (!folders?.length) {
            return null;
        }
        // Split path windows or unix style
        const segments = trimmed
            .replace(/\\/g, "/")
            .split("/")
            .filter((s) => s.length > 0);
        for (const folder of folders) {
            const joined = path.join(folder.uri.fsPath, ...segments);
            const candidate = vscode.Uri.file(path.normalize(joined));
            const hit = await tryUriInWorkspace(candidate);
            if (hit) {
                return hit;
            }
        }
        return null;
    }

    private static async findMasterFileByMetaComment(
        script: ParsedTempFile,
        viewerFile: vscode.TextDocument
    ) : Promise<vscode.Uri | null> {
        const config =  ConfigService.getInstance()

        const cmt = getLanguageConfig(script.language,config).lineCommentPrefix;

        if(cmt.length < 1) return null;

        const lineRegExp = new RegExp(`^[\\s]*${cmt}[\\s]*@file[\\s]+.*$`, "i");
        const range = new vscode.Range(0, 0, 10, 0);
        const lines = viewerFile.getText(range).split("\n");
        const start = lines.filter(line => line.match(lineRegExp))[0] ?? null;
        if (start) {
            const pathPart = start.split("@file")[1]?.trim() ?? "";
            const resolved = await SynchService.resolveUriFromMetaFilePath(pathPart);
            if (resolved) {
                return resolved;
            }
        }
        return null;
    }

    private static async openMasterScript(
        masterUri: vscode.Uri,
    ): Promise<vscode.TextEditor> {
        const masterDoc = await vscode.workspace.openTextDocument(masterUri);
        return await vscode.window.showTextDocument(masterDoc, { preview: false });
    }

    private static checkAndUpdateMasterDocumentInBackground(masterEditor: vscode.TextEditor, viewerDocument: vscode.TextDocument): void {
        if (!ConfigService.getInstance().getConfig<boolean>(ConfigKey.AskIfViewerScriptMismatchesMaster, true)) return;
        if (masterEditor.document.getText() == viewerDocument.getText()) return;
        const viewerFileName = SynchService.parseTempFile(viewerDocument.fileName)?.scriptName
            ?? path.basename(viewerDocument.fileName);
        const masterFileName = path.basename(masterEditor.document.fileName);
        vscode.window.showInformationMessage(`Viewer script "${viewerFileName}" differs from master script "${masterFileName}". What would you like to do?`,
            "Ignore", "Overwrite master", "Compare", "Always ignore")
            .then(async (pick) => {
                if (pick === "Always ignore") {
                    ConfigService.getInstance().setConfig<boolean>(ConfigKey.AskIfViewerScriptMismatchesMaster, false);
                } else if (pick === "Overwrite master") {
                    const firstLine = masterEditor.document.lineAt(0);
                    const lastLine = masterEditor.document.lineAt(masterEditor.document.lineCount - 1);
                    const textRange = new vscode.Range(firstLine.range.start, lastLine.range.end);
                    masterEditor.edit(edit => edit.replace(textRange, viewerDocument.getText()));
                } else if (pick === "Compare") {
                    const viewer = viewerDocument.uri;
                    const master = masterEditor.document.uri;
                    const title = `${viewerFileName} (Viewer) ↔ ${masterFileName} (Master)`;
                    await vscode.commands.executeCommand("vscode.diff", viewer, master, title); //, { preview: false });
                }
            })
        //*/
    }

    public getWebSocket(): ViewerEditWSClient | undefined {
        return this.websocket;
    }

    public isConnected(): boolean {
        return this.websocket?.isConnected() ?? false;
    }

    /**
     * Explicitly connect to the Second Life viewer WebSocket.
     * @returns true if connection was successful
     */
    public async connect(): Promise<boolean> {
        return this.setupConnection();
    }

    /**
     * Disconnect from the Second Life viewer WebSocket.
     */
    public disconnect(): void {
        if (this.websocket) {
            if (this.websocket.isConnected()) {
                this.websocket.disconnect();
            }
            this.websocket.dispose();
            this.websocket = undefined;
        }
        this._onDidChangeConnectionState.fire(false);
    }

    /**
     * Get current connection status information for display.
     */
    public getConnectionStatus(): string {
        if (!this.isConnected()) {
            return "Not connected to Second Life viewer";
        }
        const parts: string[] = [];
        if (this.viewerName) {
            parts.push(`Viewer: ${this.viewerName} ${this.viewerVersion || ""}`.trim());
        }
        if (this.agentName) {
            parts.push(`Agent: ${this.agentName}`);
        }
        const syncCount = this.activeSyncs.size;
        parts.push(`Active syncs: ${syncCount}`);
        return parts.join("\n");
    }
    //#endregion

    //====================================================================
    //#region Event handlers
    private async onOpenTextDocument(document: vscode.TextDocument): Promise<void> {
        this.lastActiveChange = 0;
        this.initialDefinitionGeneration(document);
        await this.setupSync(document);
    }

    private async initialDefinitionGeneration(document: vscode.TextDocument): Promise<void> {
        if (this.initialGenerationDone) return;
        if (!document.uri.fsPath.endsWith(".luau")) return;
        this.initialGenerationDone = true;
        this.initializeSyntax();
    }

    private onCloseWorkspace(workspace: vscode.WorkspaceFolder) : void {
        const workspacePath = path.normalize(workspace.uri.fsPath);
        const workspacePrefix = workspacePath.endsWith(path.sep)
            ? workspacePath
            : workspacePath + path.sep;

        for (const document of vscode.workspace.textDocuments) {
            const filePath = path.normalize(document.fileName);
            if (filePath === workspacePath || filePath.startsWith(workspacePrefix)) {
                this.removeSync(filePath);
            }
        }
    }

    private onDeleteFiles(event: vscode.FileDeleteEvent): void {
        const uris = event.files;
        uris.forEach((uri) => {
            this.removeSync(uri.fsPath);
        });
    }

    private async onSaveTextDocument(document: vscode.TextDocument): Promise<void> {
        const filePath = document.uri.fsPath;
        const sync = this.findSyncByMasterFilePath(filePath);
        if (sync) {
            await sync.handleMasterSaved();
        } else {
            for (const sync of this.findSyncByIncludeFilePath(filePath)) {
                await sync.handleMasterSaved();
            }
        }
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
        const syncs = this.findSyncsByTempFilePath(filePath);
        if (syncs.length) {
            // We have a sync for this file, record the time
            // We'll use this to see if a focus event happens very soon after
            // this event, if so we can assume the viewer launched us
            this.lastActiveChange = Date.now();
            this.activeSync = syncs.pop();
        }
    }
    //#endregion

    public async connectToViewer(params: { port?: number; object_id?: string; script_id?: string }): Promise<void> {
        this.pendingLaunchObjectId = params.object_id;
        this.pendingLaunchScriptId = params.script_id;

        if (this.websocket?.isConnected()) {
            // Already connected — act on params immediately
            await this.handleLaunchParams();
            return;
        }

        await this.setupConnection(params.port);
        // handleLaunchParams is called from onHandshakeOk
    }

    private async syncPublishedObjects(): Promise<void> {
        if (!this.websocket?.isConnected()) { return; }

        const service = ObjectContentService.getInstance();

        // Step 1: restore/refresh objects the viewer currently has published
        try {
            const result = await this.websocket.getObjectList();
            for (const obj of result.objects ?? []) {
                // Always call handlePublish — this is authoritative state from the viewer.
                // If the object is already known, handlePublish is a no-op for the workspace
                // folder (slIdx !== -1 guard in extension.ts), but refreshes the service data.
                service.handlePublish({ object: obj });
                logDebug(`[object.list] refreshed ${obj.object_id} (${obj.object_name})`);
            }
        } catch (err) {
            logDebug(`[object.list] failed: ${err}`);
        }

        // Step 2: request publishing for workspace folders not yet in the published list
        await this.requestWorkspaceObjects();
    }

    private async requestWorkspaceObjects(): Promise<void> {
        if (!this.websocket?.isConnected()) { return; }

        const service = ObjectContentService.getInstance();
        const folders = vscode.workspace.workspaceFolders ?? [];

        for (const folder of folders) {
            if (folder.uri.scheme !== SL_SCHEME || folder.uri.authority !== SL_AUTHORITY) {
                continue;
            }

            const object_id = folder.uri.path.slice(1); // strip leading "/"
            if (!object_id || service.hasObject(object_id)) {
                continue; // already published
            }

            try {
                const result = await this.websocket.requestObject({ object_id });
                if (result.object) {
                    service.handlePublish({ object: result.object });
                } else if (result.success === false) {
                    logDebug(`[requestWorkspaceObjects] viewer rejected ${object_id}: ${result.message ?? "unknown"}`);
                }
            } catch (err) {
                logDebug(`[requestWorkspaceObjects] error requesting ${object_id}: ${err}`);
            }
        }
    }

    private async handleLaunchParams(): Promise<void> {
        const objectId = this.pendingLaunchObjectId;
        const scriptId = this.pendingLaunchScriptId;
        this.pendingLaunchObjectId = undefined;
        this.pendingLaunchScriptId = undefined;

        if (objectId && this.websocket?.isConnected()) {
            // Tight-integration path: objectId always present.
            // scriptId, when provided, is the inventory item_id — open via sl:// virtual FS.
            let publishedObject: PublishedObject | undefined;

            const result = await this.websocket.requestObject({ object_id: objectId });
            if (result.object) {
                logDebug(`[object.request] response contained object_id=${result.object.object_id}`);
                ObjectContentService.getInstance().handlePublish({ object: result.object });
                publishedObject = result.object;
            } else if (result.success === false) {
                showWarningMessage(`Failed to request object: ${result.message ?? "unknown error"}`);
            } else {
                // Keep this visible while we support mixed viewer versions.
                logDebug("[object.request] response contained no object payload; waiting for object.publish notification");
            }

            if (scriptId && publishedObject) {
                await this.openScriptInObject(publishedObject, scriptId);
            }
        } else if (scriptId && this.websocket?.isConnected()) {
            // Command-line / legacy-URI path: script only, no object.
            // scriptId is the custom hash; search viewer temp directory.
            await this.openScriptById(scriptId);
        }
    }

    private async openScriptInObject(obj: PublishedObject, itemId: string): Promise<void> {
        // Check root prim inventory first.
        if (obj.inventory.some(i => i.item_id === itemId)) {
            const uri = itemUri(obj.object_id, obj.object_id, itemId);
            await vscode.window.showTextDocument(uri);
            return;
        }
        // Check linked prims.
        for (const linked of obj.linked_objects ?? []) {
            if (linked.inventory?.some(i => i.item_id === itemId)) {
                const uri = itemUri(obj.object_id, linked.link_id, itemId);
                await vscode.window.showTextDocument(uri);
                return;
            }
        }
        showWarningMessage(`Script ${itemId} not found in object ${obj.object_id}`);
    }

    private async openScriptById(scriptId: string): Promise<void> {
        if (!this.websocket) { return; }
        const list = await this.websocket.getScriptList();
        if (!list.success) { return; }

        try {
            const files = await fs.promises.readdir(list.temp_dir);
            const match = files.find(f => f.includes(scriptId));
            if (match) {
                const tempPath = path.join(list.temp_dir, match);
                await vscode.window.showTextDocument(vscode.Uri.file(tempPath));
                // onOpenTextDocument fires and handles the normal subscribe + sync flow
            } else {
                showWarningMessage(`Script ${scriptId} not found in viewer temp directory`);
            }
        } catch {
            showWarningMessage(`Could not open script ${scriptId} from temp directory`);
        }
    }

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
