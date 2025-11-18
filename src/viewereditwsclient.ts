/**
 * @file viewereditwsclient.ts
 * Copyright (C) 2025, Linden Research, Inc.
 */
import * as vscode from "vscode";
import { JSONRPCClient } from "./websockclient";
import { ConfigService } from "./configservice";
import { ConfigKey } from "./interfaces/configinterface";
import { showStatusMessage } from "./utils";

//#region Message Formats

export interface SessionHandshake {
    server_version: "1.0.0";
    protocol_version: "1.0";
    viewer_name: string;
    viewer_version: string;
    agent_id: string;
    agent_name: string;
    languages: string[];
    syntax_id: string;
    features: { [feature: string]: boolean };
    challenge?: string;
}

export interface SessionHandshakeResponse {
    client_name: string;
    client_version: "1.0";
    protocol_version: string;
    languages: string[];
    features: { [feature: string]: boolean };
    challenge_response?: string;
}

export interface SessionDisconnect {
    reason: number;
    message: string;
}

export interface ScriptSubscribe {
    script_id: string;
    script_name: string;
    script_language: string;
}

export interface ScriptSubscribeResponse {
    script_id: string;
    success: boolean;
    status: number;
    message?: string;
}

export interface ScriptUnsubscribe {
    script_id: string;
}

export interface SyntaxChange {
    id: string;
}

export interface CompilationError {
    row: number;
    column: number;
    level: string;
    message: string;
}

export interface CompilationResult {
    script_id: string; // Optional script ID for which the result applies
    success: boolean;
    running: boolean;
    errors?: CompilationError[];
}

export interface RuntimeDebug {
    script_id: string;
    object_id: string;
    object_name: string;
    message: string;
}

export interface RuntimeError {
    script_id: string;
    object_id: string;
    object_name: string;
    message: string;
    error: string;
    line: number;
    stack?: string[];
}

/**
 * Interface for WebSocket event handlers
 */
export interface WebSocketHandlers {
    onHandshake?: (message: SessionHandshake) => SessionHandshakeResponse;
    onHandshakeOk?: () => void;
    onDisconnect?: (message: SessionDisconnect) => void;
    onSyntaxChange?: (message: SyntaxChange) => void;
    onSubscribe?: (message: ScriptSubscribe) => ScriptSubscribeResponse;
    onUnsubscribe?: (message: ScriptUnsubscribe) => void;
    onCompilationResult?: (message: CompilationResult) => void;
    onRuntimeDebug?: (message: RuntimeDebug) => void;
    onRuntimeError?: (message: RuntimeError) => void;
    onConnectionClosed?: () => void;
}

/**
 * Interface for client information used in handshake responses
 */
export interface ClientInfo {
    scriptName: string;
    scriptId: string;
    extension: string;
}

//#endregion

/**
 * Service class that handles WebSocket connection and JSON-RPC communication
 */
export class ViewerEditWSClient extends JSONRPCClient {
    private handlers: WebSocketHandlers = {};

    constructor(
        context: vscode.ExtensionContext,
        url: string = "ws://localhost:9020",
    ) {
        super(context, url);
    }

    public dispose(): void {
        if (this.isDisposed()) {
            return;
        }

        try {
            // Don't wait for disconnect messages during disposal
            // Just close the connection immediately
            this.disconnect();
            super.dispose();
        } catch (error) {
            // Log but don't throw during disposal
            console.warn("Error during ViewerEditWSClient disposal:", error);
        }
    }

    /**
   * Sets up the WebSocket connection with handlers
   * @param handlers - Event handlers for various WebSocket events
   */
    public setup(handlers: WebSocketHandlers): void {
        if (this.isDisposed()) {
            throw new Error("Cannot setup disposed ViewerEditWSClient");
        }

        this.handlers = handlers;

        // Register JSON-RPC handlers
        this.on("session.handshake", this.handlers.onHandshake);
        this.on("session.ok", this.handlers.onHandshakeOk);
        this.on("session.disconnect", this.handlers.onDisconnect);
        this.on("language.syntax.change", this.handlers.onSyntaxChange);
        this.on("script.unsubscribe", this.handlers.onUnsubscribe);
        this.on("script.compiled", this.handlers.onCompilationResult);
        this.on("runtime.debug", this.handlers.onRuntimeDebug);
        this.on("runtime.error", this.handlers.onRuntimeError);

        // Setup connection close handler
        this.setupConnectionCloseHandler();

        // Activate the WebSocket client
        this.connect();
    }

    /**
   * Sends a disconnect message and closes the connection
   * @param reason - Disconnect reason code
   * @param message - Disconnect message
   */
    public sendDisconnect(reason: number = 0, message: string = "Goodbye"): void {
        if (this.isDisposed()) {
            return; // Don't send messages after disposal
        }

        try {
            if (this.isConnected()) {
                this.notify("session.disconnect", { reason, message });

                setTimeout(
                    () => {
                        if (!this.isDisposed()) {
                            this.disconnect();
                        }
                    },
                    ConfigService.getInstance().getConfig<number>(ConfigKey.NetworkDisconnectDelayMs) || 1000,
                );

                showStatusMessage(`Disconnected from Second Life: ${message}`);
            } else {
                console.log("WebSocket not connected, skipping disconnect message");
            }
        } catch (err: any) {
            console.warn(`Error sending disconnect message: ${err.message}`);
        }
    }

    private setupConnectionCloseHandler(): void {
    // Instead of overriding dispose, use a periodic check for connection state
        const checkConnectionInterval = setInterval(() => {
            if (this.isDisposed()) {
                clearInterval(checkConnectionInterval);
                return;
            }

            // Check if connection was closed externally
            if (!this.isConnected() && !this["isConnecting"]) {
                clearInterval(checkConnectionInterval);
                this.handlers.onConnectionClosed?.();
            }
        }, 1000);

        // Clean up interval when service is disposed
        this.context.subscriptions.push({
            dispose: () => clearInterval(checkConnectionInterval),
        });
    }
}
