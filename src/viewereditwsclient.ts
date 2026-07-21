/**
 * @file viewereditwsclient.ts
 * Copyright (C) 2025, Linden Research, Inc.
 */
import * as vscode from "vscode";
import { JSONRPCClient } from "./websockclient";
import { ConfigService } from "./configservice";
import { ConfigKey } from "./interfaces/configinterface";
import { showStatusMessage } from "./utils";
import {
    ObjectPublishMessage,
    ObjectUnpublishMessage,
    ObjectUpdateMessage,
    ObjectContentGetParams,
    ObjectContentGetResponse,
    ObjectContentSaveParams,
    ObjectContentSaveResponse,
    ObjectItemCreateParams,
    ObjectItemCreateResponse,
    ObjectItemDeleteParams,
    ObjectItemDeleteResponse,
    ObjectScriptSetRunningParams,
    ObjectScriptSetRunningResponse,
    ObjectScriptResetParams,
    ObjectScriptResetResponse,
    ObjectUnpublishParams,
    ObjectUnpublishResponse,
    ObjectRequestParams,
    ObjectRequestResponse,
    ObjectListResponse,
    ObjectModifyParams,
    ObjectModifyResponse,
    ObjectItemModifyParams,
    ObjectItemModifyResponse,
} from "./vscode/objectcontentinterfaces";

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
    script_name?: string;
    script_language?: string;
}

export interface SessionDisconnect {
    reason: number;
    message: string;
}

export interface SessionPing {
    timestamp: number;
}

export interface SessionPingResponse {
    timestamp: number;
    server_time: number;
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
    object_id?: string;
    item_id?: string;
    message?: string;
}

export interface ScriptUnsubscribe {
    script_id: string;
}

export interface SyntaxChange {
    id: string;
}

export interface SyntaxCacheList {
    files: string[];
    success: boolean;
}

export interface ScriptList {
    temp_dir: string;
    script_ids: string[];
    success: boolean;
}

export interface SyntaxCacheGetRequest {
    filename: string;
    as_json?: boolean;
}

export interface SyntaxCacheFile {
    content?: string | object;
    success: boolean;
    error?: string;
}

export interface CompilationError {
    row: number;
    column: number;
    level: string;
    message: string;
    format?: "lsl";
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
    onObjectPublish?: (message: ObjectPublishMessage) => void;
    onObjectUnpublish?: (message: ObjectUnpublishMessage) => void;
    onObjectUpdate?: (message: ObjectUpdateMessage) => void;
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
    private pingTimer: NodeJS.Timeout | undefined;
    private consecutivePingFailures: number = 0;
    private static readonly MAX_PING_FAILURES = 2;

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
            // Stop ping timer before disconnecting
            this.stopPingTimer();
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
        this.on("object.publish", this.handlers.onObjectPublish);
        this.on("object.unpublish", this.handlers.onObjectUnpublish);
        this.on("object.update", this.handlers.onObjectUpdate);

        // Register handler for viewer-initiated pings
        this.on("session.ping", (params: SessionPing): SessionPingResponse => ({
            timestamp: params.timestamp,
            server_time: Date.now()
        }));

        // Handle connection close - stop ping timer and notify handlers
        this.onConnectionChange((event) => {
            if (!event.connected) {
                console.log("[WebSocket] Connection closed, cleaning up");
                this.stopPingTimer();
                this.handlers.onConnectionClosed?.();
            }
        });

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

    /**
     * Sends a ping to the viewer to check connection health and measure latency.
     * @returns Promise resolving to the ping response with timing information
     */
    public sendPing(): Promise<SessionPingResponse> {
        return this.call("session.ping", {
            timestamp: Date.now()
        });
    }

    /**
     * Starts periodic pinging to the viewer.
     * @param intervalMs - Interval between pings in milliseconds (default: 30000)
     */
    public startPingTimer(intervalMs: number = 30000): void {
        this.stopPingTimer();
        console.log(`[Ping] Starting ping timer with interval ${intervalMs}ms`);
        this.pingTimer = setInterval(async () => {
            if (!this.isConnected() || this.isDisposed()) {
                console.log("[Ping] Connection closed, stopping timer");
                this.stopPingTimer();
                return;
            }
            try {
                console.log("[Ping] Sending ping...");
                const response = await this.sendPing();
                const latency = Date.now() - response.timestamp;
                console.log(`[Ping] Received pong, latency: ${latency}ms`);
                this.consecutivePingFailures = 0;
            } catch (error) {
                this.consecutivePingFailures++;
                console.warn(`[Ping] Failed (${this.consecutivePingFailures}/${ViewerEditWSClient.MAX_PING_FAILURES}):`, error);
                if (this.consecutivePingFailures >= ViewerEditWSClient.MAX_PING_FAILURES) {
                    console.warn(`[Ping] Max failures reached, closing connection`);
                    this.stopPingTimer();
                    this.handlers.onConnectionClosed?.();
                    this.disconnect();
                }
            }
        }, intervalMs);
    }

    /**
     * Stops the periodic ping timer.
     */
    public stopPingTimer(): void {
        if (this.pingTimer) {
            clearInterval(this.pingTimer);
            this.pingTimer = undefined;
        }
        this.consecutivePingFailures = 0;
    }

    // ============================================
    // Object Content Calls (Extension → Viewer)
    // ============================================

    public getObjectContent(params: ObjectContentGetParams): Promise<ObjectContentGetResponse> {
        return this.call("object.content.get", params);
    }

    public saveObjectContent(params: ObjectContentSaveParams): Promise<ObjectContentSaveResponse> {
        return this.call("object.content.save", params);
    }

    public createObjectItem(params: ObjectItemCreateParams): Promise<ObjectItemCreateResponse> {
        return this.call("object.item.create", params);
    }

    public deleteObjectItem(params: ObjectItemDeleteParams): Promise<ObjectItemDeleteResponse> {
        return this.call("object.item.delete", params);
    }

    public setScriptRunning(params: ObjectScriptSetRunningParams): Promise<ObjectScriptSetRunningResponse> {
        return this.call("object.script.set_running", params);
    }

    public resetScript(params: ObjectScriptResetParams): Promise<ObjectScriptResetResponse> {
        return this.call("object.script.reset", params);
    }

    public unpublishObject(params: ObjectUnpublishParams): Promise<ObjectUnpublishResponse> {
        return this.call("object.unpublish", params);
    }

    public requestObject(params: ObjectRequestParams): Promise<ObjectRequestResponse> {
        return this.call("object.request", params);
    }

    public getObjectList(): Promise<ObjectListResponse> {
        return this.call("object.list", {});
    }

    public modifyObject(params: ObjectModifyParams): Promise<ObjectModifyResponse> {
        return this.call("object.modify", params);
    }

    public modifyObjectItem(params: ObjectItemModifyParams): Promise<ObjectItemModifyResponse> {
        return this.call("object.item.modify", params);
    }

    public getScriptList(): Promise<ScriptList> {
        return this.call("script.list", {});
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
