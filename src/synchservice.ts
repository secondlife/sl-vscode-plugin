/**
 * @file synchservice.ts
 * Copyright (C) 2025, Linden Research, Inc.
 */
import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { SCRIPT_FILE_PATTERN, ConfigService, NOTECARD_FILE_PATTERN } from "./configservice";
import { ConfigKey, FullConfigInterface } from "./interfaces/configinterface";
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
    JSONRPCError,
    ObjectPublishMessage,
    ObjectUnpublishMessage,
    ObjectUpdateMessage,
    ObjectInventoryItem,
    PublishedObject,
} from "#sl-ide-ws-client";
import {
    hasWorkspace,
    showInfoMessage,
    showStatusMessage,
    showWarningMessage,
    logDebug,
    logInfo,
    logWarning,
    logRuntimeInfo,
    logRuntimeError,
    VSCodeHost,
    closeTextDocument,
    vscodeUriToStringUri,
    resolveProtonPath,
    pluginLogSink,
} from "./utils";
import { maybe } from "./shared/sharedutils"; // TODO: migrate needed utilities from sharedutils if required
import { CommandRegistry } from "./commandregistry";
import {
    CommandExecuteParams,
    CommandExecuteResponse,
    CommandListResponse,
} from "#sl-ide-ws-client";
import {LanguageService } from "./shared/languageservice";
import { buildPreprocessorConfig, ScriptIdentity, ScriptSync } from "./scriptsync";
import {
    canonicalFileUri,
    virtualIdentityKey,
} from "./shared/filelinkidentity";
import { FileLinkIndex } from "./shared/filelinkindex";
import { getLanguageConfig, HostInterface, ScriptLanguage } from "#sl-script-preprocessor";
import { SyncedFileDecorator } from "./vscode/SyncedFileDecorator";
import { ObjectContentChangeEvent, ObjectContentService, ObjectTreeChangeEvent } from "#sl-ide-ws-client";
import { ObjectPinStore } from "./vscode/objectpinstore";
import { SL_SCHEME, SL_AUTHORITY, displayName, itemUri, languageForItem, extractJsonRpcErrorCode, JSONRPC_INVALID_PARAMS, JSONRPC_FORBIDDEN } from "./vscode/objectcontentprovider";

/** PERM_MODIFY bit from viewer LLPermissions */
const PERM_MODIFY = 0x4000;

type ParsedTempFile = {
    scriptName: string;
    scriptId: string;
    extension: string;
    language: ScriptLanguage;
    item?: ObjectInventoryItem;
    rootId?: string;
    primId?: string | null;
    itemId?: string;
};

type LinkOutcome =
    | "linked"
    | "already-linked"
    | "moved"
    | "no-match"
    | "skipped-no-modify"
    | "rejected"
    | "error"
    | "failed";

interface LinkOperationResult
{
    outcome: LinkOutcome;
    endpointUri?: vscode.Uri;
    masterUri?: vscode.Uri;
    previousMasterUri?: vscode.Uri;
    changed: boolean;
    reason?: string;
    mismatch?: boolean;
}

interface SlLinkResult extends LinkOperationResult
{
    outcome: LinkOutcome;
}

type TemporaryMoveResult = LinkOperationResult;

interface AutoLinkSummary {
    linked: number;
    alreadyLinked: number;
    noMatch: number;
    skippedNoModify: number;
    errors: number;
    mismatches: number;
}

type VirtualMoveResult = LinkOperationResult;

function isUuidSegment(segment: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment);
}

function describeRequestObjectError(err: unknown): string {
    if (err instanceof Error) {
        const code = extractJsonRpcErrorCode(err);
        if (code === JSONRPC_INVALID_PARAMS) {
            return "object not found";
        }
        if (code === JSONRPC_FORBIDDEN) {
            return "permission denied";
        }
        return err.message;
    }
    return String(err);
}

export class SynchService implements vscode.Disposable {
    // Tracks all active sync relationships, keyed by master file uri.toString()
    private activeSyncs: Map<string, ScriptSync> = new Map();
    private readonly fileLinkIndex = new FileLinkIndex<ScriptSync>();
    private readonly endpointOperations = new Map<string, Promise<void>>();
    private stopping = false;
    private context: vscode.ExtensionContext;
    private static instance: SynchService;
    private websocket: ViewerEditWSClient | undefined;
    private handshakeResolve?: (value: boolean, message?: string) => void;
    private handshakePromise?: Promise<{ success: boolean; message: string }>;
    private sessionConnected: boolean = false;
    private lastActiveChange: number = 0;
    private activeSync: ScriptSync | undefined;
    private host: HostInterface;
    private config: FullConfigInterface;
    private readonly commandRegistry = new CommandRegistry();
    private initialGenerationDone: boolean = false;
    private pendingLaunchObjectId?: string;
    private pendingLaunchScriptId?: string;
    private autoLinkedObjectIds = new Set<string>();

    public viewerName?: string;
    public viewerVersion?: string;
    public viewerLanguages?: string[];
    public viewerFeatures?: { [feature: string]: boolean };
    public syntaxCacheSupported: boolean = false;
    public commandsSupported: boolean = false;
    public syntaxId?: string;
    public agentId?: string;
    public agentName?: string;

    private syncedFileDecorator : SyncedFileDecorator;

    private _onDidChangeConnectionState = new vscode.EventEmitter<boolean>();
    readonly onDidChangeConnectionState = this._onDidChangeConnectionState.event;
    private _onDidReceiveViewerCommands = new vscode.EventEmitter<string[]>();
    readonly onDidReceiveViewerCommands = this._onDidReceiveViewerCommands.event;

    private disposables: vscode.Disposable[] = [];

    private constructor(context: vscode.ExtensionContext, config: FullConfigInterface) {
        this.context = context;
        this.host = new VSCodeHost();
        this.config = config;
        this.syncedFileDecorator = new SyncedFileDecorator(this);
        this.commandRegistry.register(
            {
                command: "editor.show_message",
                description: "Show a notification in the editor.",
                params: {
                    message: {
                        type: "string",
                        required: true,
                        description: "Notification text.",
                    },
                    level: {
                        type: "string",
                        description: "Notification level: info, warn, or error.",
                    },
                },
            },
            async (params) => {
                if (typeof params.message !== "string")
                {
                    throw new JSONRPCError(-32602, "message must be a string");
                }

                const level = params.level ?? "info";
                if (level !== "info" && level !== "warn" && level !== "error")
                {
                    throw new JSONRPCError(-32602, "level must be one of: info, warn, error");
                }

                if (level === "warn")
                {
                    await showWarningMessage(params.message);
                }
                else if (level === "error")
                {
                    await vscode.window.showErrorMessage(params.message);
                }
                else
                {
                    await showInfoMessage(params.message);
                }

                return { success: true };
            },
        );
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
            SynchService.instance = new SynchService(context, ConfigService.getInstance());
        }
        return SynchService.instance;
    }

    dispose(): void {
        this.stopping = true;
        // Dispose of all active script syncs
        for (const [masterUriKey, scriptSync] of this.activeSyncs) {
            try {
                scriptSync.dispose();
            } catch (error) {
                console.warn(`Error disposing sync for ${masterUriKey}:`, error);
            }
        }
        this.activeSyncs.clear();
        this.endpointOperations.clear();
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

        const onWillRenameListener = vscode.workspace.onWillRenameFiles(
            (event: vscode.FileWillRenameEvent) => this.onWillRenameFiles(event),
        );

        const onDidRenameListener = vscode.workspace.onDidRenameFiles(
            (event: vscode.FileRenameEvent) => this.onDidRenameFiles(event),
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

        const onViewerDidChangeContent = ObjectContentService.getInstance().onDidChangeContent(
            (e: ObjectContentChangeEvent) => {
                this.onViewerDidChangeContent(e);
            }
        );

        const onViewerDidChangeObjects = ObjectContentService.getInstance().onDidChangeObjects(
            (e: ObjectTreeChangeEvent) => {
                this.onViewerDidChangeObjects(e);
            }
        )

        this.initialGenerationDone = true;
        const syntaxInit = this.initializeSyntax();
        showStatusMessage("Initializing syntax...", syntaxInit);

        this.disposables.push(onDidOpenListener);
        // this.disposables.push(onDidCloseListener);
        this.disposables.push(onDidCloseWorkspace);
        this.disposables.push(onDidDeleteListener);
        this.disposables.push(onWillRenameListener);
        this.disposables.push(onDidRenameListener);
        this.disposables.push(onDidSaveListener);
        this.disposables.push(onDidChangeWindowState);
        this.disposables.push(onDidChangeActiveTextEditor);
        this.disposables.push(vscode.window.registerFileDecorationProvider(this.syncedFileDecorator));
        this.disposables.push(onViewerDidChangeContent);
        this.disposables.push(onViewerDidChangeObjects);

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
        let masterUri = await SynchService.findMasterFile(parsed, viewerDocument.getText());
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

        const sync = await this.getOrCreateSync(
            masterDoc,
            parsed.extension as ScriptLanguage,
        );

        if(!this.config.getConfig(ConfigKey.KeepViewerFileOpen, true) && masterFound) {
            void closeTextDocument(viewerDocument).catch((error) => {
                logInfo(
                    `Failed to auto-close viewer document ${viewerDocument.uri.fsPath}: ${error instanceof Error ? error.message : String(error)}`,
                );
            });
        }

        const linkResult = await this.moveTemporaryFile(
            masterUri,
            parsed.extension as ScriptLanguage,
            parsed.scriptId,
            viewerDocument,
        );
        if (linkResult.outcome === "failed") {
            return false;
        }

        this.syncedFileDecorator.refresh(sync.getMasterDocument().uri);

        if (this.websocket && this.websocket.isConnected()) {
            this.sendSyncSubscription(sync);
        } else {
            viewerConnecting.then((connected) => {
                if (connected) {
                    this.sendSyncSubscription(sync);
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
        await this.validateMasterUri(masterDoc.uri);
        const key = this.masterKey(masterDoc.uri);
        const existing = this.activeSyncs.get(key);
        if (existing) return existing;

        const config = ConfigService.getInstance();
        const sync = new ScriptSync(masterDoc, language, config, '', undefined, this);
        try {
            await sync.initialize();
        } catch (error) {
            sync.dispose();
            throw error;
        }
        this.activeSyncs.set(key, sync);
        return sync;
    }

    public async validateMasterUri(uri: vscode.Uri): Promise<void>
    {
        try {
            const stat = await vscode.workspace.fs.stat(uri);
            if (stat.type !== vscode.FileType.File) {
                throw new Error(`Master URI is not a file: ${uri.toString()}`);
            }
        } catch (error) {
            if (error instanceof vscode.FileSystemError &&
                error.code === "FileNotFound") {
                this.removeMasterLink(uri);
            }
            throw error;
        }
    }

    private async setupSyncForSlUri(
        slDocument: vscode.TextDocument,
    ): Promise<void> {
        await this.linkSlItem(
            slDocument.uri,
            slDocument.getText(),
            { reveal: true },
            slDocument,
        );
    }

    private async linkSlItem(
        uri: vscode.Uri,
        content: string,
        options: { reveal: boolean },
        viewerDocument?: vscode.TextDocument,
    ): Promise<SlLinkResult> {
        if (!hasWorkspace()) {
            return { outcome: "error", endpointUri: uri, changed: false };
        }
        if (!this.websocket?.isConnected()) {
            if (options.reveal) {
                showWarningMessage(`Cannot link sl:// script: not connected to Second Life viewer.`);
            }
            return { outcome: "error", endpointUri: uri, changed: false };
        }
        const parsed = SynchService.parseSlFileInfo(uri);
        if (!parsed) {
            logInfo(`[setupSyncForSlUri] Could not parse sl:// URI: ${uri.toString()}`);
            return { outcome: "error", endpointUri: uri, changed: false };
        }
        // Skip filesystem linking for no-modify items (they can still be viewed but not synced)
        const canModify = !parsed.item?.permissions || (parsed.item.permissions.owner & PERM_MODIFY) !== 0;
        if (!canModify) {
            logInfo(
                `[setupSyncForSlUri] Skipping filesystem link for no-modify item "${parsed.scriptName}.${parsed.extension}"`,
            );
            return { outcome: "skipped-no-modify", endpointUri: uri, changed: false };
        }
        const masterUri = await SynchService.findMasterFile(parsed, content);
        if (!masterUri) {
            logInfo(
                `[setupSyncForSlUri] No master found for "${parsed.scriptName}.${parsed.extension}"; ` +
                `editing directly via viewer.`,
            );
            return { outcome: "no-match", endpointUri: uri, changed: false };
        }
        const masterDoc = await vscode.workspace.openTextDocument(masterUri);
        const masterEditor = options.reveal
            ? await vscode.window.showTextDocument(masterDoc, { preview: false })
            : undefined;
        if (!parsed.rootId || !parsed.itemId) {
            logInfo(
                `[setupSyncForSlUri] Missing canonical identity for "${uri.toString()}"`,
            );
            return { outcome: "error", endpointUri: uri, changed: false };
        }

        const identity: ScriptIdentity = {
            rootId: parsed.rootId,
            primId: parsed.primId ?? null,
            itemId: parsed.itemId,
        };

        const linkResult = await this.moveVirtualFile(
            masterUri,
            parsed.language,
            uri,
            content,
            identity,
            parsed.item,
        );
        const mismatch = masterDoc.getText() !== content;
        if (masterEditor && viewerDocument) {
            SynchService.checkAndUpdateMasterDocumentInBackground(masterEditor, viewerDocument);
        }
        this.syncedFileDecorator.refresh(masterDoc.uri);
        logInfo(
            `[setupSyncForSlUri] ${linkResult.outcome === "moved" ? "Moved" : "Linked"} "${parsed.scriptName}" ` +
            `(${uri.toString()}) \u2192 ${masterUri.fsPath}`,
        );
        // Do NOT call setupConnection() — already connected
        // Do NOT call sendSyncSubscription() — sl:// content travels via object.content.save
        return { ...linkResult, endpointUri: uri, masterUri, mismatch };
    }

    public async autoLinkObject(objectId: string): Promise<AutoLinkSummary> {
        const summary: AutoLinkSummary = {
            linked: 0,
            alreadyLinked: 0,
            noMatch: 0,
            skippedNoModify: 0,
            errors: 0,
            mismatches: 0,
        };
        const entry = ObjectContentService.getInstance().getObject(objectId);
        if (!entry) {
            summary.errors++;
            return summary;
        }

        const items = [
            {
                primId: objectId,
                items: entry.object.inventory ?? [],
            },
            ...(entry.object.linked_objects ?? []).map((linked) => ({
                primId: linked.link_id,
                items: linked.inventory ?? [],
            })),
        ].flatMap(({ primId, items: inventory }) =>
            inventory.map((item) => ({ primId, item })),
        );

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Linking files in ${entry.object.object_name}`,
                cancellable: true,
            },
            async (progress, token) => {
                for (let index = 0; index < items.length; index++) {
                    if (token.isCancellationRequested) {
                        break;
                    }

                    const { primId, item } = items[index];
                    const uri = itemUri(objectId, primId, item.item_id);
                    progress.report({
                        message: `${index + 1}/${items.length}: ${displayName(item)}`,
                        increment: items.length > 0 ? 100 / items.length : 100,
                    });

                    try {
                        const content = Buffer.from(
                            await vscode.workspace.fs.readFile(uri),
                        ).toString("utf-8");
                        const result = await this.linkSlItem(
                            uri,
                            content,
                            { reveal: false },
                        );

                        switch (result.outcome) {
                            case "linked":
                            case "moved":
                                summary.linked++;
                                if (result.mismatch) {
                                    summary.mismatches++;
                                }
                                break;
                            case "already-linked":
                                summary.alreadyLinked++;
                                break;
                            case "no-match":
                                summary.noMatch++;
                                break;
                            case "skipped-no-modify":
                                summary.skippedNoModify++;
                                break;
                            case "rejected":
                            case "failed":
                            case "error":
                                summary.errors++;
                                logWarning(
                                    `[autoLinkObject] Failed to link ${displayName(item)}: ` +
                                    `${result.reason ?? "Unknown link failure."}`,
                                );
                                break;
                        }
                    } catch (error) {
                        summary.errors++;
                        logWarning(
                            `[autoLinkObject] Failed to link ${displayName(item)}: ` +
                            `${error instanceof Error ? error.message : String(error)}`,
                        );
                    }
                }
            },
        );

        await showInfoMessage(
            `Auto-link complete for ${entry.object.object_name}: ` +
            `${summary.linked} linked, ${summary.alreadyLinked} already linked, ` +
            `${summary.noMatch} not matched, ${summary.skippedNoModify} skipped ` +
            `(no modify), ${summary.errors} errors, ${summary.mismatches} differing.`,
        );
        return summary;
    }

    public removeSync(filePath: string): void {
        this.removeMasterLink(vscode.Uri.file(filePath));
    }

    public evictSlSyncs(object_id: string): void {
        const identities = [...this.activeSyncs.values()]
            .flatMap((sync) => sync.getTrackedVirtualItemsInObject(object_id))
            .map((mapping) => mapping.identity);

        for (const identity of identities) {
            this.detachVirtualFile(identity);
        }
        this.clearEmptySyncs();
    }

    public evictSlSyncsForPrim(rootId: string, primId: string): void {
        const identities = [...this.activeSyncs.values()]
            .flatMap((sync) => sync.getTrackedVirtualItemsInObject(rootId))
            .filter((mapping) => mapping.identity.primId === primId)
            .map((mapping) => mapping.identity);

        for (const identity of identities) {
            this.detachVirtualFile(identity);
        }
        this.clearEmptySyncs();
    }

    public detachByScriptId(scriptId: string, close = false): boolean {
        let detached = false;
        for (const sync of [...this.activeSyncs.values()]) {
            if (!sync.isTrackingId(scriptId)) {
                continue;
            }
            sync.unsubscribeById(scriptId, close);
            detached = true;
        }
        this.clearEmptySyncs();
        return detached;
    }

    public clearEmptySyncs() : void {
        for(const sync of [...this.activeSyncs.values()]) {
            if(!sync.hasFilesToTrack()) {
                this.disposeSync(sync);
            }
        }

        if (this.activeSyncs.size === 0 && this.sessionConnected) {
            // Keep the viewer session alive for object explorer usage even without script syncs.
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
                const service = ObjectContentService.getInstance();
                service.handlePublish(msg);

                void this.autoLinkObjectIfEnabled(msg.object.object_id);
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
            onCommandExecute: (params: CommandExecuteParams): Promise<CommandExecuteResponse> =>
                this.commandRegistry.execute(params),
            onCommandList: (): CommandListResponse => this.commandRegistry.list(),
        };

        if (this.sessionConnected) {
            return true;
        }

        if (this.handshakePromise) {
            const pending = await this.handshakePromise;
            return pending.success;
        }

        if (this.websocket && this.websocket.isConnected()) {
            this.websocket.disconnect();
            this.websocket.dispose();
            this.websocket = undefined;
        }

        const handshake: Promise<{ success: boolean; message?: string }> =
            this.getHandshakePromise();
        showStatusMessage("Connecting to Second Life viewer...", handshake);

        const port = portOverride
            ?? this.config.getConfig<number>(ConfigKey.NetworkWebsocketPort, 9020);
        const packageJson = this.context.extension.packageJSON as {
            name?: string;
            version?: string;
        };
        this.websocket = new ViewerEditWSClient({
            url: `ws://localhost:${port}`,
            clientInfo: {
                name: packageJson.name ?? "sl-vscode-plugin",
                version: packageJson.version ?? "0.0.0",
            },
            logger: pluginLogSink,
            notify: (message, kind): void => {
                if (kind === "status") {
                    showStatusMessage(message);
                } else {
                    showInfoMessage(message);
                }
            },
            disconnectDelayMs: (): number =>
                this.config.getConfig<number>(ConfigKey.NetworkDisconnectDelayMs, 1000),
        });
        this.context.subscriptions.push(this.websocket.setup(handlers));
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
        this.commandsSupported = message.features?.["commands"] === true;

        let challengeResponse: string | undefined = undefined;
        if (message.challenge) {
            // The challenge is the name of a file, we just need to read the contents
            // and return it to the server.
            const challengePath = resolveProtonPath(message.challenge);
            await fs.promises.readFile(challengePath, 'utf8').then((data: string) => {
                challengeResponse = data;
                console.log("Received challenge from viewer:", challengePath);
            });
        }

        const firstSync = this.activeSync ?? [...this.activeSyncs.values()][0];
        const scriptName = firstSync ? path.basename(firstSync.getMasterUri().fsPath) : undefined;
        const scriptLanguage = firstSync ? firstSync.getLanguage() : undefined;

        const response: SessionHandshakeResponse = {
            client_name: ConfigService.getInstance().getConfig<string>(ConfigKey.ClientName) || "sl-vscode-plugin",
            client_version: this.context.extension.packageJSON.version || "0.0.0",
            protocol_version: "1.0",
            ...maybe("challenge_response", challengeResponse),
            ...maybe("script_name", scriptName),
            ...maybe("script_language", scriptLanguage),
            languages: ["lsl", "luau"],
            features: {
                live_sync: true,
                error_reporting: true,
                unified_diagnostics: true,
                debugging: false,
                breakpoints: false,
                object_publish: true,
                commands: true,
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

        if (this.commandsSupported) {
            this.websocket?.listCommands().then(response => {
                console.log("[Commands] Viewer supports commands:", response.commands.map(c => c.command));
                this._onDidReceiveViewerCommands.fire(response.commands.map(c => c.command));
            }).catch(err => {
                console.warn("[Commands] Failed to list viewer commands:", err);
            });
        }
        const socket = this.getWebSocket();
        const languageMatches = this.checkLanguageVersion() === true;
        let hasViewerSyntaxFiles = true;
        if (this.syntaxCacheSupported && this.syntaxId) {
            hasViewerSyntaxFiles = await service.hasCachedViewerSyntaxFiles(this.syntaxId);
        }
        if ((!languageMatches || !hasViewerSyntaxFiles) && socket && this.syntaxId) {
            const promise = service.changeSyntaxVersion(
                this.syntaxId,
                socket,
                false,
                this.syntaxCacheSupported,
            );
            showStatusMessage("Updating to latest language definitions...", promise);
        }

        if (this.handshakeResolve) {
            this.handshakeResolve(true, "Connected");
        }

        this.setSessionConnected(true);

        // Start periodic ping timer for connection health monitoring
        this.websocket?.startPingTimer();

        await this.handleLaunchParams();
        await this.syncPublishedObjects();
        await this.restorePinnedObjects();
    }

    private async autoLinkObjectIfEnabled(objectId: string): Promise<void> {
        const autoLinkEnabled = ConfigService.getInstance()
            .getConfig<boolean>(ConfigKey.AutoLinkOnPublish, false);
        if (
            !autoLinkEnabled ||
            !hasWorkspace() ||
            this.autoLinkedObjectIds.has(objectId)
        ) {
            return;
        }

        this.autoLinkedObjectIds.add(objectId);
        await this.autoLinkObject(objectId);
    }

    private onDisconnect(params: SessionDisconnect): void {
        // Graceful disconnect - just show the message with reason
        // Actual cleanup happens in onConnectionClosed which fires after socket closes
        const reason = params?.reason || 0;
        const message = params?.message || "Session disconnected";
        showStatusMessage(
            `Second Life viewer disconnected: ${message} (reason ${reason})`,
        );
        this.setSessionConnected(false);
    }

    private onConnectionClosed(): void {
        // All cleanup happens here - fires for both graceful and crash disconnects
        console.log("[SynchService] Connection closed");
        this.websocket?.stopPingTimer();
        this.autoLinkedObjectIds.clear();

        if (this.handshakeResolve) {
            this.handshakeResolve(false, "Connection closed");
        }

        this.setSessionConnected(false);
        this.destroyAllLinks();
        // Collapse explorer folders instead of removing tracked objects
        vscode.commands.executeCommand("workbench.files.action.collapseExplorerFolders");
    }

    private destroyAllLinks(): void
    {
        for (const sync of [...this.activeSyncs.values()]) {
            this.disposeSync(sync);
        }
        this.clearEmptySyncs();
    }

    private onScriptUnsubscribe(message: ScriptUnsubscribe): void {
        this.detachByScriptId(message.script_id, true);
    }

    private async onSyntaxChange(params: SyntaxChange): Promise<void> {
        if (this.syntaxId !== params.id) {
            this.syntaxId = params.id;
            const service = LanguageService.getInstance();
            await this.refreshSyntaxCacheListIfSupported(service);
            let hasViewerSyntaxFiles = true;
            if (this.syntaxCacheSupported) {
                hasViewerSyntaxFiles = await service.hasCachedViewerSyntaxFiles(params.id);
            }
            if (!this.checkLanguageVersion() || !hasViewerSyntaxFiles) {
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

    public findSyncByIdentity(identity: ScriptIdentity): ScriptSync | undefined {
        return this.findIndexedSyncByVirtualIdentity(identity);
    }

    public findSyncByItemRef(
        rootId: string,
        primId: string,
        itemId: string,
    ): ScriptSync | undefined {
        return this.findSyncByIdentity({
            rootId,
            primId: primId === rootId ? null : primId,
            itemId,
        });
    }

    private runtimeIdentity(
        item?: { root_id?: string; prim_id?: string | null; item_id?: string },
    ): ScriptIdentity | undefined {
        if (!item?.root_id || !item.item_id) {
            return undefined;
        }

        return {
            rootId: item.root_id,
            primId: item.prim_id ?? null,
            itemId: item.item_id,
        };
    }

    private onRuntimeDebug(message: RuntimeDebug): void {
        const identity = this.runtimeIdentity(message.item);
        let sync: ScriptSync | undefined;
        if (identity) {
            sync = this.findSyncByIdentity(identity);
        } else if (message.script_id) {
            sync = this.findSyncByScriptId(message.script_id);
        } else {
            sync = undefined;
        }
        if (sync) {
            sync.handleRuntimeDebug(message);
        }
        else {
            const label = message.channel === "owner_say"
                ? "OWNER"
                : "DEBUG";
            logRuntimeInfo(
                `${message.object_name} ${label}: ${message.message}`,
            );
        }
    }

    private onRuntimeError(message: RuntimeError): void {
        const identity = this.runtimeIdentity(message.item);
        let sync: ScriptSync | undefined;
        if (identity) {
            sync = this.findSyncByIdentity(identity);
        } else if (message.script_id) {
            sync = this.findSyncByScriptId(message.script_id);
        } else {
            sync = undefined;
        }

        if (sync) {
            sync.handleRuntimeError(message);
        }
        else {
            logRuntimeError(
                `${message.object_name} ERROR: ${message.error}`,
            );
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
                        if (response.root_id && response.item_id) {
                            const identity: ScriptIdentity = {
                                rootId: response.root_id,
                                primId:
                                    response.object_id &&
                                    response.object_id !== response.root_id
                                        ? response.object_id
                                        : null,
                                itemId: response.item_id,
                            };
                            sync.setIdentityForId(id, identity);

                        }

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
        const pathSegments = segments.slice(1);
        const lastSeg = pathSegments[pathSegments.length - 1];

        let prim_id: string | null = null;
        let item_id: string | undefined;

        if (pathSegments.length >= 2 && isUuidSegment(pathSegments[0])) {
            prim_id = pathSegments[0];
            item_id = pathSegments[1];
        }
        else {
            item_id = pathSegments[0];
        }

        // Always resolve name and type from the inventory record, never from the URI path.
        // The last segment may be a UUID (itemUri) or a display name (Explorer) — both are
        // matched against the service inventory.
        const item = SynchService.findSlInventoryItem(
            root_id,
            item_id ?? lastSeg,
        );
        if (!item) return null;

        const fullName = displayName(item);           // e.g. "My Script.luau"
        const di = fullName.lastIndexOf('.');
        if (di < 0) {
            if(item.type == "notecard") {
                return {
                    scriptName: item.name,
                    scriptId: uri.toString(),
                    extension: "txt",
                    language: "txt",
                    item,
                    rootId: root_id,
                    primId: prim_id,
                    itemId: item.item_id,
                };
            }
            return null;
        }

        const scriptName = fullName.slice(0, di);     // "My Script"
        const extension = fullName.slice(di + 1).toLowerCase(); // "luau"
        const language = languageForItem(item);

        return {
            scriptName,
            scriptId: uri.toString(),
            extension,
            language,
            item,
            rootId: root_id,
            primId: prim_id,
            itemId: item.item_id,
        };
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

    private rebuildFileLinkIndex(): void
    {
        this.fileLinkIndex.clear();

        for (const sync of this.activeSyncs.values()) {
            this.fileLinkIndex.setMaster(
                canonicalFileUri(sync.getMasterFilePath()),
                sync,
            );

            for (const snapshot of sync.getTrackedFileSnapshots()) {
                if (snapshot.kind === "local" && snapshot.fileUri) {
                    this.fileLinkIndex.setTemporaryFile(
                        canonicalFileUri(snapshot.fileUri.fsPath),
                        sync,
                    );
                } else if (snapshot.kind === "virtual" && snapshot.identity) {
                    this.fileLinkIndex.setVirtualFile(
                        virtualIdentityKey(snapshot.identity),
                        sync,
                    );
                }
            }
        }
    }

    public findIndexedSyncByMasterFilePath(
        masterFilePath: string,
    ): ScriptSync | undefined
    {
        this.rebuildFileLinkIndex();
        return this.fileLinkIndex.getMaster(
            canonicalFileUri(masterFilePath),
        );
    }

    public findIndexedSyncByTemporaryFilePath(
        temporaryFilePath: string,
    ): ScriptSync | undefined
    {
        this.rebuildFileLinkIndex();
        return this.fileLinkIndex.getTemporaryFile(
            canonicalFileUri(temporaryFilePath),
        );
    }

    public findIndexedSyncByVirtualIdentity(
        identity: ScriptIdentity,
    ): ScriptSync | undefined
    {
        this.rebuildFileLinkIndex();
        return this.fileLinkIndex.getVirtualFile(
            virtualIdentityKey(identity),
        );
    }

    public async runEndpointOperation<T>(
        endpointKey: string,
        operation: () => Promise<T> | T,
    ): Promise<T>
    {
        if (this.stopping) {
            throw new Error("SynchService is stopping.");
        }

        const previous = this.endpointOperations.get(endpointKey) ?? Promise.resolve();
        const operationPromise = previous
            .catch(() => undefined)
            .then(operation);
        const settled = operationPromise.then(
            () => undefined,
            () => undefined,
        );

        this.endpointOperations.set(endpointKey, settled);
        try {
            return await operationPromise;
        } finally {
            if (this.endpointOperations.get(endpointKey) === settled) {
                this.endpointOperations.delete(endpointKey);
            }
        }
    }

    public async moveTemporaryFile(
        masterUri: vscode.Uri,
        language: ScriptLanguage,
        scriptId: string,
        viewerDocument: vscode.TextDocument,
    ): Promise<TemporaryMoveResult>
    {
        const endpointKey = canonicalFileUri(viewerDocument.uri.fsPath);
        return this.runEndpointOperation(
            endpointKey,
            async () => {
                const previousSync = this.findIndexedSyncByTemporaryFilePath(
                    viewerDocument.uri.fsPath,
                );
                const previousMasterUri = previousSync?.getMasterUri();
                const masterDocument = await vscode.workspace.openTextDocument(masterUri);
                const destinationSync = await this.getOrCreateSync(
                    masterDocument,
                    language,
                );

                if (previousSync === destinationSync) {
                    return {
                        outcome: "already-linked",
                        endpointUri: viewerDocument.uri,
                        previousMasterUri,
                        masterUri,
                        changed: false,
                    };
                }

                const attached = destinationSync.subscribe(
                    scriptId,
                    viewerDocument,
                );
                if (!attached) {
                    this.clearEmptySyncs();
                    return {
                        outcome: "failed",
                        endpointUri: viewerDocument.uri,
                        previousMasterUri,
                        masterUri,
                        changed: false,
                        reason: "Destination rejected the temporary endpoint.",
                    };
                }

                if (previousSync) {
                    const wasTracked = previousSync.isTrackingFile(
                        viewerDocument.uri.fsPath,
                    );
                    previousSync.unsubscribeByFile(
                        viewerDocument.uri.fsPath,
                    );
                    if (!wasTracked) {
                        destinationSync.unsubscribeByFile(
                            viewerDocument.uri.fsPath,
                        );
                        this.clearEmptySyncs();
                        return {
                            outcome: "failed",
                            endpointUri: viewerDocument.uri,
                            previousMasterUri,
                            masterUri,
                            changed: false,
                            reason: "The previous temporary endpoint was no longer owned.",
                        };
                    }
                }

                this.clearEmptySyncs();
                return {
                    outcome: previousSync ? "moved" : "linked",
                    endpointUri: viewerDocument.uri,
                    previousMasterUri,
                    masterUri,
                    changed: true,
                };
            },
        );
    }

    public async moveVirtualFile(
        masterUri: vscode.Uri,
        language: ScriptLanguage,
        uri: vscode.Uri,
        content: string | undefined,
        identity: ScriptIdentity,
        item?: ObjectInventoryItem,
    ): Promise<VirtualMoveResult>
    {
        return this.runEndpointOperation(
            virtualIdentityKey(identity),
            async () => {
                const previousSync = this.findIndexedSyncByVirtualIdentity(identity);
                const previousMasterUri = previousSync?.getMasterUri();

                const masterDocument = await vscode.workspace.openTextDocument(masterUri);
                const destinationSync = await this.getOrCreateSync(
                    masterDocument,
                    language,
                );

                if (previousSync === destinationSync) {
                    return {
                        outcome: "already-linked",
                        endpointUri: uri,
                        previousMasterUri,
                        masterUri,
                        changed: false,
                    };
                }

                const attached = destinationSync.subscribeVirtual(
                    uri,
                    content,
                    identity,
                    item,
                );
                if (!attached) {
                    this.clearEmptySyncs();
                    return {
                        outcome: "failed",
                        endpointUri: uri,
                        previousMasterUri,
                        masterUri,
                        changed: false,
                        reason: "Destination rejected the virtual endpoint.",
                    };
                }

                if (previousSync) {
                    const wasTracked = previousSync.isTrackingIdentity(identity);
                    previousSync.unsubscribeVirtualMappingByIdentity(identity);
                    if (!wasTracked) {
                        destinationSync.unsubscribeVirtualMappingByIdentity(identity);
                        this.clearEmptySyncs();
                        return {
                            outcome: "failed",
                            endpointUri: uri,
                            previousMasterUri,
                            masterUri,
                            changed: false,
                            reason: "The previous virtual endpoint was no longer owned.",
                        };
                    }
                }

                this.clearEmptySyncs();
                return {
                    outcome: previousSync ? "moved" : "linked",
                    endpointUri: uri,
                    previousMasterUri,
                    masterUri,
                    changed: true,
                };
            },
        );
    }

    public detachTemporaryFile(
        temporaryFilePath: string,
        close = false,
    ): boolean
    {
        let detached = false;
        for (const sync of this.activeSyncs.values()) {
            const wasTracked = sync.isTrackingFile(temporaryFilePath);
            sync.unsubscribeByFile(temporaryFilePath, close);
            detached = detached || wasTracked;
        }
        this.clearEmptySyncs();
        return detached;
    }

    public detachVirtualFile(identity: ScriptIdentity): boolean
    {
        let detached = false;
        for (const sync of this.activeSyncs.values()) {
            const wasTracked = sync.isTrackingIdentity(identity);
            sync.unsubscribeVirtualMappingByIdentity(identity);
            detached = detached || wasTracked;
        }
        this.clearEmptySyncs();
        return detached;
    }

    public removeMasterLink(masterUri: vscode.Uri): boolean
    {
        const sync = this.findSyncByMasterFilePath(masterUri.fsPath);
        if (!sync) {
            return false;
        }

        this.disposeSync(sync);
        this.clearEmptySyncs();
        return true;
    }

    private disposeSync(sync: ScriptSync): boolean
    {
        const key = this.masterKey(sync.getMasterUri());
        if (this.activeSyncs.get(key) !== sync) {
            return false;
        }

        this.activeSyncs.delete(key);
        this.syncedFileDecorator.refresh(sync.getMasterDocument().uri);
        sync.dispose();
        return true;
    }

    public findSyncByTempFilePath(filePath: string): ScriptSync | undefined {
        filePath = path.normalize(filePath);
        return [...this.activeSyncs.values()].find((sync) =>
            sync.isTrackingFile(filePath),
        );
    }

    /** Master identity key; must match the canonical form used by the link index. */
    private masterKey(uri: vscode.Uri | string): string {
        return canonicalFileUri(typeof uri === "string" ? uri : uri.fsPath);
    }

    public findSyncByMasterFilePath(
        masterFilePath: string,
    ): ScriptSync | undefined {
        return this.activeSyncs.get(this.masterKey(masterFilePath));
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
        content: string
    ): Promise<vscode.Uri | null> {
        // Attempt to match by file meta info
        const metaMatch = await SynchService.findMasterFileByMetaComment(script, content);
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
        content: string
    ) : Promise<vscode.Uri | null> {
        const config =  ConfigService.getInstance()

        const cmt = getLanguageConfig(script.language,buildPreprocessorConfig(script.language, config)).lineCommentPrefix;

        if(cmt.length < 1) return null;

        const lineRegExp = new RegExp(`^[\\s]*${cmt}[\\s]*@file[\\s]+.*$`, "i");
        const lines = content.split("\n").slice(0, 10);
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
        return this.sessionConnected;
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
            // Explicit disposal may prevent the transport close callback from
            // running, so perform the same cleanup synchronously.
            this.onConnectionClosed();
            this.websocket.dispose();
            this.websocket = undefined;
        }
    }

    private setSessionConnected(connected: boolean): void {
        if (this.sessionConnected === connected) {
            return;
        }
        this.sessionConnected = connected;
        this._onDidChangeConnectionState.fire(connected);
        if (!connected) {
            this.handshakeResolve?.(false, "Disconnected");
        }
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
                this.removeMasterLink(vscode.Uri.file(filePath));
            }
        }
    }

    private onDeleteFiles(event: vscode.FileDeleteEvent): void {
        for (const uri of event.files) {
            const masterSync = this.findIndexedSyncByMasterFilePath(uri.fsPath);
            if (masterSync) {
                this.removeMasterLink(uri);
                continue;
            }

            this.detachTemporaryFile(uri.fsPath);
        }
    }

    private onWillRenameFiles(event: vscode.FileWillRenameEvent): void {
        for (const file of event.files) {
            const masterSync = this.findIndexedSyncByMasterFilePath(file.oldUri.fsPath);
            const temporarySync = this.findIndexedSyncByTemporaryFilePath(
                file.oldUri.fsPath,
            );

            if (!masterSync && !temporarySync) {
                continue;
            }

            if (masterSync &&
                this.findIndexedSyncByMasterFilePath(file.newUri.fsPath)) {
                event.waitUntil(Promise.reject(
                    new Error("The destination master file is already linked."),
                ));
                return;
            }

            if (temporarySync &&
                this.findIndexedSyncByTemporaryFilePath(file.newUri.fsPath)) {
                event.waitUntil(Promise.reject(
                    new Error("The destination temporary file is already linked."),
                ));
                return;
            }
        }
    }

    private async onDidRenameFiles(event: vscode.FileRenameEvent): Promise<void> {
        for (const file of event.files) {
            const masterSync = this.findIndexedSyncByMasterFilePath(file.oldUri.fsPath);
            if (masterSync) {
                await this.renameMasterLink(file.oldUri, file.newUri);
                continue;
            }

            const temporarySync = this.findIndexedSyncByTemporaryFilePath(
                file.oldUri.fsPath,
            );
            if (temporarySync) {
                await this.renameTemporaryLink(file.oldUri, file.newUri);
            }
        }
    }

    private async renameMasterLink(
        oldUri: vscode.Uri,
        newUri: vscode.Uri,
    ): Promise<boolean> {
        const sync = this.findSyncByMasterFilePath(oldUri.fsPath);
        if (!sync || this.findIndexedSyncByMasterFilePath(newUri.fsPath)) {
            return false;
        }

        const masterDocument = await vscode.workspace.openTextDocument(newUri);
        if (!this.rekeyMasterSync(sync, newUri)) {
            return false;
        }
        sync.renameMasterDocument(masterDocument);
        this.syncedFileDecorator.refresh(newUri);
        return true;
    }

    /** Sole path that re-keys a live sync; removal must still go through disposeSync(). */
    private rekeyMasterSync(sync: ScriptSync, newUri: vscode.Uri): boolean {
        const oldKey = this.masterKey(sync.getMasterUri());
        const newKey = this.masterKey(newUri);
        if (this.activeSyncs.get(oldKey) !== sync || this.activeSyncs.has(newKey)) {
            return false;
        }

        this.activeSyncs.delete(oldKey);
        this.activeSyncs.set(newKey, sync);
        return true;
    }

    private async renameTemporaryLink(
        oldUri: vscode.Uri,
        newUri: vscode.Uri,
    ): Promise<boolean> {
        const sync = this.findIndexedSyncByTemporaryFilePath(oldUri.fsPath);
        if (!sync || this.findIndexedSyncByTemporaryFilePath(newUri.fsPath)) {
            return false;
        }

        return sync.renameTemporaryFile(oldUri, newUri);
    }

    private async onSaveTextDocument(document: vscode.TextDocument): Promise<void> {
        const filePath = document.uri.fsPath;
        const sync = this.findSyncByMasterFilePath(filePath);
        if (sync) {
            await sync.handleMasterSaved();
        } else {
            const includeUri = vscodeUriToStringUri(document.uri);
            for (const sync of this.findSyncByIncludeFilePath(includeUri)) {
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
        const sync = this.findSyncByTempFilePath(filePath);
        if (sync) {
            // We have a sync for this file, record the time
            // We'll use this to see if a focus event happens very soon after
            // this event, if so we can assume the viewer launched us
            this.lastActiveChange = Date.now();
            this.activeSync = sync;
        }
    }

    private onViewerDidChangeContent(e: ObjectContentChangeEvent): void {
        const objectcontentservice = ObjectContentService.getInstance();
        const item = objectcontentservice.getItem(e.object_id,e.prim_id,e.item_id);
        if(!item)return;
        const uri = itemUri(e.object_id, e.prim_id, item.item_id);
        const identity: ScriptIdentity = {
            rootId: e.object_id,
            primId: e.prim_id === e.object_id ? null : e.prim_id,
            itemId: e.item_id,
        };
        for(const sync of this.activeSyncs.values()) {
            if(sync.isTrackingIdentity(identity)) {
                sync.updateVirtualItem(uri, identity, item);
            }
        }
    }

    private onViewerDidChangeObjects(e: ObjectTreeChangeEvent): void {
        const objectContentService = ObjectContentService.getInstance();

        if (e.type === "removed") {
            this.evictSlSyncs(e.object_id);
            return;
        }

        for (const removedItem of e.removed_items ?? []) {
            this.detachVirtualFile({
                rootId: e.object_id,
                primId: removedItem.prim_id === e.object_id
                    ? null
                    : removedItem.prim_id,
                itemId: removedItem.item_id,
            });
        }

        for (const primId of e.removed_link_ids ?? []) {
            this.evictSlSyncsForPrim(e.object_id, primId);
        }

        for(const sync of this.activeSyncs.values()) {
            if(!sync.isTrackingVirtualItemInObject(e.object_id)) continue;
            const mappings = sync.getTrackedVirtualItemsInObject(e.object_id);
            for(const mapping of mappings) {
                if(!mapping.item) continue;
                const newItem = objectContentService.getItemInObject(e.object_id, undefined, mapping.item.item_id)
                if(newItem) {
                    const uri = itemUri(newItem.object_id, newItem.prim_id, newItem.item.item_id);
                    sync.updateVirtualItem(
                        uri,
                        mapping.identity,
                        newItem.item,
                    );
                }
            }
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
            const objects = result.objects ?? [];
            for (const obj of objects) {
                // Always call handlePublish — this is authoritative state from the viewer.
                // If the object is already known, handlePublish is a no-op for the workspace
                // folder (slIdx !== -1 guard in extension.ts), but refreshes the service data.
                service.handlePublish({ object: obj });
                logDebug(`[object.list] refreshed ${obj.object_id} (${obj.object_name})`);
            }

            // Run once for every object after the complete object list is available.
            for (const obj of objects) {
                await this.autoLinkObjectIfEnabled(obj.object_id);
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
                // The object itself arrives separately via the object.publish notification.
                await this.websocket.requestObject({ object_id });
            } catch (err) {
                logDebug(`[requestWorkspaceObjects] viewer rejected ${object_id}: ${describeRequestObjectError(err)}`);
            }
        }
    }

    private async restorePinnedObjects(): Promise<void> {
        if (!this.websocket?.isConnected()) {
            return;
        }

        const service = ObjectContentService.getInstance();
        const pinStore = ObjectPinStore.getInstance();
        const pinnedObjectIds = await pinStore.getPinnedObjectIds();

        for (const object_id of pinnedObjectIds) {
            if (!object_id || service.hasObject(object_id)) {
                continue;
            }

            try {
                await this.websocket.requestObject({ object_id });
                const entry = await service.waitForObjectPublish(object_id);
                if (entry) {
                    logDebug(`[restorePinnedObjects] restored ${entry.object.object_id} (${entry.object.object_name})`);
                } else {
                    logDebug(`[restorePinnedObjects] accepted but object.publish never arrived for ${object_id}`);
                }
            } catch (err) {
                logDebug(`[restorePinnedObjects] viewer rejected ${object_id}: ${describeRequestObjectError(err)}`);
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

            try {
                await this.websocket.requestObject({ object_id: objectId });
                const entry = await ObjectContentService.getInstance().waitForObjectPublish(objectId);
                if (entry) {
                    publishedObject = entry.object;
                } else {
                    showWarningMessage(`Timed out waiting for object ${objectId} to publish`);
                }
            } catch (err) {
                showWarningMessage(`Failed to request object: ${describeRequestObjectError(err)}`);
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
            const tempDir = resolveProtonPath(list.temp_dir);
            const files = await fs.promises.readdir(tempDir);
            const match = files.find(f => f.includes(scriptId));
            if (match) {
                const tempPath = path.join(tempDir, match);
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
        this.stopping = false;
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
