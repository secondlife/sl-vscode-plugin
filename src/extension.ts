/**
 * @file extension.ts
 * Copyright (C) 2025, Linden Research, Inc.
 */
import * as vscode from "vscode";
import { SynchService } from "./synchservice";
import { LanguageService } from "./shared/languageservice";
import { ConfigService } from "./configservice";
import {
    VSCodeHost,
    getOutputChannel,
    showOutputChannel,
    logInfo,
    showStatusMessage,
    hasWorkspace,
    showErrorMessage
} from "./utils";

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext): void {
    const configService = ConfigService.getInstance(context);
    const host = new VSCodeHost(context);
    // Initialize shared LSP services with injected host
    const languageService = LanguageService.getInstance(host);
    // Initialize the file sync functionality
    const synchService = SynchService.getInstance(context);

    // Register output channel for disposal
    context.subscriptions.push(getOutputChannel());

    if (!hasWorkspace()) {
        showErrorMessage("Second Life Scripting Extension: No workspace is opened.\nPlease open a folder in VSCode to enable full functionality.");
    }

    logInfo("Second Life Scripting Extension activated");

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "second-life-scripting.connectWebSocket",
            () => {
                // TODO: Implement WebSocket connection logic
                vscode.window.showInformationMessage("Connect WebSocket command executed");
            }
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "second-life-scripting.disconnectWebSocket",
            () => {
                // TODO: Implement WebSocket disconnection logic
                vscode.window.showInformationMessage("Disconnect WebSocket command executed");
            }
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "second-life-scripting.showWebSocketClientStatus",
            () => {
                showOutputChannel();
                logInfo("WebSocket status requested");
                // TODO: Add actual status information
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

    context.subscriptions.push(configService);
    context.subscriptions.push(languageService);
    context.subscriptions.push(synchService);
}

// This method is called when your extension is deactivated
export function deactivate(): void {
    const synchService = SynchService.getInstance();
    synchService.deactivate();
}
