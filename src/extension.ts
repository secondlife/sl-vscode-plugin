/**
 * @file extension.ts
 * Copyright (C) 2025, Linden Research, Inc.
 */
import * as vscode from "vscode";
import { SynchService } from "./synchservice";
import { LanguageService } from "./shared/languageservice";
import { ObjectContentService, ViewerEditWSClient } from "#sl-ide-ws-client";
import { ObjectContentProvider, SL_SCHEME, displayName } from "./vscode/objectcontentprovider";
import { ObjectContentDecorator } from "./vscode/ObjectContentDecorator";
import { ExplorerNode } from "./vscode/objectexplorerprovider";
import { ObjectExplorerWebviewProvider } from "./vscode/objectexplorerwebview";
import { ConfigService, configPrefix } from "./configservice";
import {
    VSCodeHost,
    getOutputChannel,
    getRuntimeOutputChannel,
    showOutputChannel,
    logInfo,
    logDebug,
    showStatusMessage,
    hasWorkspace,
    showErrorMessage
} from "./utils";
import { ConfigKey } from "./interfaces/configinterface";
import path from "path";

/**
 * Helper function for rename operations on objects and inventory items.
 * Consolidates common logic: connection check, input box, validation, and error handling.
 */
async function renameNode(
    synchService: SynchService,
    entityType: string,
    currentName: string,
    doRename: (client: ViewerEditWSClient, newName: string) => Promise<{ success: boolean; message?: string }>
): Promise<void> {
    const client = synchService.getWebSocket();
    if (!client) {
        vscode.window.showErrorMessage("Not connected to Second Life viewer.");
        return;
    }

    const newName = await vscode.window.showInputBox({
        prompt: `Enter new name for the ${entityType}`,
        value: currentName,
        validateInput: (value) => {
            if (!value || value.trim().length === 0) {
                return "Name cannot be empty";
            }
            if (value.length > 63) {
                return "Name must be 63 characters or less";
            }
            return undefined;
        }
    });

    if (!newName || newName === currentName) return;

    try {
        const result = await doRename(client, newName);
        if (!result.success) {
            vscode.window.showErrorMessage(`Failed to rename: ${result.message}`);
        }
    } catch (err) {
        vscode.window.showErrorMessage(`Failed to rename ${entityType}: ${err}`);
    }
}

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
        (rootId, primId, itemId, diagnostics) =>
            synchService.findSyncByItemRef(rootId, primId, itemId)
                ?.handleSaveDiagnostics(diagnostics),
    );
    context.subscriptions.push(
        vscode.workspace.registerFileSystemProvider(SL_SCHEME, objectContentProvider, {
            isCaseSensitive: true,
        }),
        objectContentProvider,
        objectContentService,
    );

    // Register file decoration provider for sl:// URIs (shows disconnected state, script running state)
    const objectContentDecorator = new ObjectContentDecorator(
        () => synchService.isConnected(),
        (listener) => synchService.onDidChangeConnectionState(listener),
        objectContentService,
    );
    context.subscriptions.push(
        vscode.window.registerFileDecorationProvider(objectContentDecorator),
        objectContentDecorator,
    );

    // Register the "Second Life" webview in Explorer
    const objectExplorerWebview = new ObjectExplorerWebviewProvider(
        context.extensionUri,
        () => synchService.isConnected(),
        synchService.onDidChangeConnectionState,
        () => synchService.getWebSocket(),
    );
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(ObjectExplorerWebviewProvider.viewType, objectExplorerWebview),
        objectExplorerWebview,
        synchService.onDidReceiveViewerCommands((commands) =>
            objectExplorerWebview.sendViewerCommands(commands))
    );

    // Command to open sl:// items from the tree view
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "slVscodeEdit.openInventoryItem",
            (uri: vscode.Uri) => {
                vscode.window.showTextDocument(uri, { preview: false });
            }
        )
    );

    // Rename commands for context menu actions
    context.subscriptions.push(
        vscode.commands.registerCommand("slVscodeEdit.renameInventoryItem", async (node: ExplorerNode) => {
            if (node.kind !== "item") return;
            await renameNode(synchService, "item", node.item.name, (client, newName) =>
                client.modifyObjectItem({ prim_id: node.prim_id, item_id: node.item.item_id, name: newName })
            );
        }),
        vscode.commands.registerCommand("slVscodeEdit.deleteInventoryItem", async (node: ExplorerNode) => {
            if (node.kind !== "item") {
                return;
            }
            const itemName = displayName(node.item);
            const confirm = await vscode.window.showWarningMessage(
                `Delete "${itemName}" from object?`,
                { modal: true },
                "Delete"
            );
            if (confirm !== "Delete") {
                return;
            }
            const client = synchService.getWebSocket();
            if (!client) {
                vscode.window.showErrorMessage("Not connected to Second Life viewer.");
                return;
            }
            try {
                const result = await client.deleteObjectItem({
                    prim_id: node.prim_id,
                    item_id: node.item.item_id,
                });
                if (result.success) {
                    vscode.window.showInformationMessage(`Deleted "${itemName}".`);
                } else {
                    vscode.window.showErrorMessage(`Failed to delete "${itemName}".`);
                }
            } catch (err) {
                vscode.window.showErrorMessage(`Error deleting "${itemName}": ${err}`);
            }
        }),
        vscode.commands.registerCommand("slVscodeEdit.saveItem", async (node: ExplorerNode) => {
            if (node.kind !== "item") return;
            try {
                const doc = await vscode.workspace.openTextDocument(node.uri);
                await doc.save();
            } catch (err) {
                vscode.window.showErrorMessage(`Failed to save: ${err}`);
            }
        }),
        vscode.commands.registerCommand("slVscodeEdit.recompileScript", async (node: ExplorerNode) => {
            if (node.kind !== "item" || node.item.type !== "script") return;
            try {
                const doc = await vscode.workspace.openTextDocument(node.uri);
                await doc.save();
            } catch (err) {
                vscode.window.showErrorMessage(`Failed to recompile: ${err}`);
            }
        }),
        vscode.commands.registerCommand("slVscodeEdit.renameObject", async (node: ExplorerNode) => {
            if (node.kind !== "object" && node.kind !== "linkedPrim") return;
            const prim_id = node.kind === "object" ? node.object_id : node.link_id;
            await renameNode(synchService, "object", node.label, (client, newName) =>
                client.modifyObject({ prim_id, name: newName })
            );
        }),
        vscode.commands.registerCommand("slVscodeEdit.teleportToObject", () => {
            vscode.window.showInformationMessage("Teleport is not yet implemented.");
        }),
        vscode.commands.registerCommand("slVscodeEdit.startScript", async (node: ExplorerNode) => {
            if (node.kind !== "item" || node.item.type !== "script") return;
            const client = synchService.getWebSocket();
            if (!client) {
                vscode.window.showErrorMessage("Not connected to Second Life viewer.");
                return;
            }
            try {
                const result = await client.setScriptRunning({ prim_id: node.prim_id, item_id: node.item.item_id, running: true });
                if (result.success) {
                    objectContentService.setScriptRunningState(node.object_id, node.prim_id, node.item.item_id, true);
                }
            } catch (err) {
                vscode.window.showErrorMessage(`Failed to start script: ${err}`);
            }
        }),
        vscode.commands.registerCommand("slVscodeEdit.stopScript", async (node: ExplorerNode) => {
            if (node.kind !== "item" || node.item.type !== "script") return;
            const client = synchService.getWebSocket();
            if (!client) {
                vscode.window.showErrorMessage("Not connected to Second Life viewer.");
                return;
            }
            try {
                const result = await client.setScriptRunning({ prim_id: node.prim_id, item_id: node.item.item_id, running: false });
                if (result.success) {
                    objectContentService.setScriptRunningState(node.object_id, node.prim_id, node.item.item_id, false);
                }
            } catch (err) {
                vscode.window.showErrorMessage(`Failed to stop script: ${err}`);
            }
        }),
        vscode.commands.registerCommand("slVscodeEdit.restartScript", async (node: ExplorerNode) => {
            if (node.kind !== "item" || node.item.type !== "script") return;
            const client = synchService.getWebSocket();
            if (!client) {
                vscode.window.showErrorMessage("Not connected to Second Life viewer.");
                return;
            }
            try {
                await client.resetScript({ prim_id: node.prim_id, item_id: node.item.item_id });
                // Reset restarts the script, so it's running after success
                objectContentService.setScriptRunningState(node.object_id, node.prim_id, node.item.item_id, true);
            } catch (err) {
                vscode.window.showErrorMessage(`Failed to restart script: ${err}`);
            }
        }),
        vscode.commands.registerCommand("slVscodeEdit.restartScriptDisabled", () => {
            // This command is always disabled, just a placeholder
        }),
        vscode.commands.registerCommand("slVscodeEdit.newFile", async (node: ExplorerNode) => {
            if (node.kind !== "object" && node.kind !== "linkedPrim") {
                return;
            }
            // Get inventory for duplicate checking
            const object_id = node.object_id;
            const prim_id = node.kind === "object" ? node.object_id : node.link_id;
            const inventory = objectContentService.getInventory(object_id, prim_id) ?? [];
            const existingNames = new Set(inventory.map((item) => displayName(item).toLowerCase()));

            const filename = await vscode.window.showInputBox({
                prompt: "Enter filename (.lsl, .luau for scripts, or notecard name)",
                placeHolder: "e.g., MyScript.luau or MyNotecard",
                validateInput: (value) => {
                    if (!value || !value.trim()) {
                        return "Filename cannot be empty";
                    }
                    // Check for duplicate - compare against displayNames
                    if (existingNames.has(value.trim().toLowerCase())) {
                        return `"${value.trim()}" already exists in this prim`;
                    }
                    return undefined;
                },
            });
            if (!filename) {
                return; // User pressed Escape
            }
            const client = synchService.getWebSocket();
            if (!client) {
                vscode.window.showErrorMessage("Not connected to Second Life viewer.");
                return;
            }
            // Determine type and vm from extension
            const ext = path.extname(filename).toLowerCase();
            let type: "script" | "notecard";
            let vm: "luau" | "lsl2" | undefined;
            let name: string;
            if (ext === ".luau") {
                type = "script";
                vm = "luau";
                name = filename.slice(0, -ext.length); // Strip extension for scripts
            } else if (ext === ".lsl") {
                type = "script";
                vm = "lsl2";
                name = filename.slice(0, -ext.length); // Strip extension for scripts
            } else {
                type = "notecard";
                name = filename; // Keep full filename for notecards
            }
            try {
                const result = await client.createObjectItem({ prim_id, name, type, vm });
                vscode.window.showInformationMessage(`Created "${displayName(result)}".`);
            } catch (err) {
                vscode.window.showErrorMessage(`Error creating "${filename}": ${err}`);
            }
        })
    );

    // Track connection state for UI visibility
    context.subscriptions.push(
        synchService.onDidChangeConnectionState((connected) => {
            vscode.commands.executeCommand("setContext", "slVscodeEdit:connected", connected);
        })
    );
    // Set initial connection state
    vscode.commands.executeCommand("setContext", "slVscodeEdit:connected", synchService.isConnected());

    // Clean up syncs when objects are unpublished
    context.subscriptions.push(
        objectContentService.onDidChangeObjects(({ type, object_id }) => {
            if (type === "removed") {
                synchService.evictSlSyncs(object_id);
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

                // Decode the query string first - some viewers incorrectly encode the delimiters.
                // Malformed percent-encoding from an external viewer should not break the URI handler.
                let decodedQuery = uri.query;
                try {
                    decodedQuery = decodeURIComponent(uri.query);
                } catch {
                    showErrorMessage("Second Life: Launch URI contained malformed encoding. Trying to continue with the raw query.");
                }
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

    // Register output channels for disposal so they appear in the VS Code Output panel.
    context.subscriptions.push(getOutputChannel());
    context.subscriptions.push(getRuntimeOutputChannel());

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
