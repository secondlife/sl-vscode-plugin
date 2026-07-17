/**
 * @file extension.ts
 * Copyright (C) 2025, Linden Research, Inc.
 */
import * as vscode from "vscode";
import { SynchService } from "./synchservice";
import { LanguageService } from "./shared/languageservice";
import { ObjectContentService } from "./vscode/objectcontentservice";
import { ObjectContentProvider, SL_SCHEME, SL_AUTHORITY, rootUri } from "./vscode/objectcontentprovider";
import { ObjectContentDecorator } from "./vscode/ObjectContentDecorator";
import { ConfigService, configPrefix } from "./configservice";
import {
    VSCodeHost,
    getOutputChannel,
    showOutputChannel,
    logInfo,
    logDebug,
    showStatusMessage,
    hasWorkspace,
    showErrorMessage
} from "./utils";
import { ConfigKey } from "./interfaces/configinterface";
import path from "path";

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext): void {
    const configService = ConfigService.getInstance(context);
    const host = new VSCodeHost(context);
    // Initialize shared LSP services with injected host
    const languageService = LanguageService.getInstance(host);
    // Initialize the file sync functionality
    const synchService = SynchService.getInstance(context);

    // Initialize object content service and register the sl:// FileSystemProvider
    const objectContentService = ObjectContentService.getInstance();
    const objectContentProvider = new ObjectContentProvider(
        objectContentService,
        () => synchService.getWebSocket(),
    );
    context.subscriptions.push(
        vscode.workspace.registerFileSystemProvider(SL_SCHEME, objectContentProvider, {
            isCaseSensitive: true,
        }),
        objectContentProvider,
        objectContentService,
    );

    // Register file decoration provider for sl:// URIs (shows disconnected state)
    const objectContentDecorator = new ObjectContentDecorator(
        () => synchService.isConnected(),
        (listener) => synchService.onDidChangeConnectionState(listener),
    );
    context.subscriptions.push(
        vscode.window.registerFileDecorationProvider(objectContentDecorator),
        objectContentDecorator,
    );

    // Manage workspace folders for published objects so Explorer shows friendly names.
    // Batch folder adds to avoid VS Code cancelling rapid successive updateWorkspaceFolders calls.
    const pendingFolderAdds: Array<{ object_id: string; name: string }> = [];
    let flushScheduled = false;

    function flushPendingFolderAdds(): void {
        flushScheduled = false;
        if (pendingFolderAdds.length === 0) {
            return;
        }
        const currentFolders = vscode.workspace.workspaceFolders ?? [];
        const toAdd: Array<{ uri: vscode.Uri; name: string }> = [];
        for (const { object_id, name } of pendingFolderAdds) {
            const alreadyPresent = currentFolders.some(
                (f) => f.uri.scheme === SL_SCHEME && f.uri.authority === SL_AUTHORITY && f.uri.path === `/${object_id}`
            );
            if (!alreadyPresent) {
                toAdd.push({ uri: rootUri(object_id), name });
            }
        }
        pendingFolderAdds.length = 0;
        if (toAdd.length > 0) {
            vscode.workspace.updateWorkspaceFolders(currentFolders.length, 0, ...toAdd);
        }
    }

    context.subscriptions.push(
        objectContentService.onDidChangeObjects(({ type, object_id }) => {
            const folders = vscode.workspace.workspaceFolders ?? [];
            const slIdx = folders.findIndex(
                (f) => f.uri.scheme === SL_SCHEME && f.uri.authority === SL_AUTHORITY && f.uri.path === `/${object_id}`
            );
            if (type === "added") {
                const entry = objectContentService.getObject(object_id);
                if (entry && slIdx === -1) {
                    pendingFolderAdds.push({ object_id, name: entry.object.object_name });
                    if (!flushScheduled) {
                        flushScheduled = true;
                        setTimeout(flushPendingFolderAdds, 0);
                    }
                }
            } else if (type === "removed") {
                if (slIdx !== -1) {
                    vscode.workspace.updateWorkspaceFolders(slIdx, 1);
                }
                synchService.evictSlSyncs(object_id);
            } else if (type === "updated") {
                if (slIdx !== -1) {
                    const entry = objectContentService.getObject(object_id);
                    if (entry) {
                        vscode.workspace.updateWorkspaceFolders(slIdx, 1, {
                            uri: rootUri(object_id),
                            name: entry.object.object_name,
                        });
                    }
                }
            }
        })
    );

    // Register URI handler so the viewer can launch VS Code and trigger a connection.
    // URI format: vscode://lindenlab.sl-vscode-plugin/connect?port=9020[&object=<uuid>][&script=<uuid>]
    context.subscriptions.push(
        vscode.window.registerUriHandler({
            handleUri(uri: vscode.Uri): void {

                logDebug(`Received URI: ${uri.toString()}`);

                if (uri.path !== "/connect") { return; }

                // Decode the query string first - some viewers incorrectly encode the delimiters
                const decodedQuery = decodeURIComponent(uri.query);
                logDebug(`Decoded query: ${decodedQuery}`);

                const query = Object.fromEntries(
                    decodedQuery.split("&").filter(Boolean).map(p => {
                        const eq = p.indexOf("=");
                        return eq === -1
                            ? [p, ""]
                            : [p.slice(0, eq), p.slice(eq + 1)];
                    })
                );

                logDebug(`Parsed query: ${JSON.stringify(query)}`);

                const rawPort = query["port"] as string | undefined;
                const port = rawPort !== undefined ? parseInt(rawPort, 10) : undefined;
                if (port !== undefined && (isNaN(port) || port < 1024 || port > 65535)) {
                    showErrorMessage(`Second Life: Invalid port in launch URI: ${rawPort}`);
                    return;
                }

                const object_id = query["object"] as string | undefined;
                const script_id = query["script"] as string | undefined;

                logInfo(`Connecting with port=${port}, object_id=${object_id ?? "(none)"}, script_id=${script_id ?? "(none)"}`);

                synchService.connectToViewer({ port, object_id, script_id });
            }
        })
    );

    // Register output channel for disposal
    context.subscriptions.push(getOutputChannel());

    if (!hasWorkspace()) {
        showErrorMessage("Second Life Scripting Extension: No workspace is opened.\nPlease open a folder in VSCode to enable full functionality.");
    }

    setupCommands(context);

    configService.on(ConfigKey.Enabled, (configService) => {
        if(configService.isEnabled()) {
            synchService.activate();
            logInfo("Second Life Scripting Extension activated");
        } else {
            synchService.deactivate();
            logInfo("Second Life Scripting Extension deactivated");
        }
    });

    if(configService.isEnabled()) {
        synchService.activate();
        logInfo("Second Life Scripting Extension activated");
    }

    context.subscriptions.push(configService);
    context.subscriptions.push(languageService);
    context.subscriptions.push(synchService);
}

// This method is called when your extension is deactivated
export function deactivate(): void {
    const synchService = SynchService.getInstance();
    synchService.deactivate();
}

function setupCommands(context: vscode.ExtensionContext) : void {
    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "second-life-scripting.enable",
            () => {
                // TODO: Implement WebSocket connection logic
                vscode.workspace.getConfiguration(configPrefix).update(ConfigKey.Enabled, true);
            }
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "second-life-scripting.connectWebSocket",
            async () => {
                const sync = SynchService.getInstance();
                if (sync.isConnected()) {
                    vscode.window.showInformationMessage("Already connected to Second Life viewer");
                    return;
                }
                const promise = sync.connect();
                showStatusMessage("Connecting to Second Life viewer...", promise);
                const success = await promise;
                if (success) {
                    vscode.window.showInformationMessage("Connected to Second Life viewer");
                }
                // Warning message is shown by SynchService on failure
            }
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "second-life-scripting.disconnectWebSocket",
            () => {
                const sync = SynchService.getInstance();
                if (!sync.isConnected()) {
                    vscode.window.showInformationMessage("Not connected to Second Life viewer");
                    return;
                }
                sync.disconnect();
                vscode.window.showInformationMessage("Disconnected from Second Life viewer");
            }
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "second-life-scripting.showWebSocketClientStatus",
            () => {
                showOutputChannel();
                const sync = SynchService.getInstance();
                const status = sync.getConnectionStatus();
                logInfo(status);
                vscode.window.showInformationMessage(status);
            }
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "second-life-scripting.forceLanguageUpdate",
            () => {
                vscode.window.showInformationMessage("Forcing Language Update");
                const sync = SynchService.getInstance();
                const promise = sync.forceLanguageUpdate();
                showStatusMessage("Forcing language update...", promise);
            }
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "second-life-scripting.stopFileSync",
            (uri?: vscode.Uri) => {
                if(!uri) {
                    uri = vscode.window.activeTextEditor?.document.uri;
                }
                if(!uri) {
                    return;
                }
                SynchService.getInstance().removeSync(path.normalize(uri.fsPath));
            }
        )
    );
}
