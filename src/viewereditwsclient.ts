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
    root_id?: string;
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

export interface CommandExecuteParams {
    command: string;
    params?: Record<string, unknown>;
}

export interface CommandExecuteResponse {
    success: boolean;
    result?: unknown;
    error_code?: CommandErrorCode;
    message?: string;
}

export const enum CommandErrorCode {
    UnknownCommand  = 1,
    InvalidParams   = 2,
    NotPermitted    = 3,
    ExecutionError  = 4,
}

export interface CommandParamInfo {
    type: "string" | "number" | "boolean" | "object" | "array";
    required?: boolean;
    description?: string;
}

export interface CommandInfo {
    command: string;
    description?: string;
    params?: Record<string, CommandParamInfo>;
}

export interface CommandListResponse {
    commands: CommandInfo[];
}

export interface Diagnostic {
    row: number;
    column: number;
    level: string;
    message: string;
    format?: "lsl";
}

export interface CompilationResult {
    /** @deprecated Retained during migration to item-based routing. */

    script_id: string; // Script ID for which the result applies

    success: boolean;
    running: boolean;
    diagnostics?: Diagnostic[];
}

export interface RuntimeDebug {
    object_id: string;
    /** @deprecated Use item.prim_id instead. */
    prim_id?: string;
    /** @deprecated Use item.item_id instead. */
    item_id?: string;
    object_name: string;
    message: string;
    channel?: "debug" | "owner_say";
    item?: ItemRef;
}

export interface RuntimeError {
    object_id: string;
    /** @deprecated Use item.prim_id instead. */
    prim_id?: string;
    /** @deprecated Use item.item_id instead. */
    item_id?: string;
    object_name: string;
    message: string;
    /** @deprecated Retained for the current runtime-error consumer. */
    error: string;
    /** @deprecated Use location.line in the unified diagnostic contract. */
    line: number;
    column?: number;
    /** @deprecated Use structured stack frames in the unified diagnostic contract. */
    stack?: string[];
    channel?: "debug" | "owner_say";
    item?: ItemRef;
}

export interface ItemRef {
    root_id: string;
    prim_id?: string | null;
    item_id?: string;
    name?: string;
    language?: "lsl" | "luau";
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
    onCommandExecute?: (params: CommandExecuteParams) => Promise<CommandExecuteResponse>;
    onCommandList?: () => CommandListResponse;
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

export interface MessageTransport extends vscode.Disposable {
    connect(): Promise<{ success: boolean; message?: string }>;
    disconnect(): void;
    isConnected(): boolean;
    getStatus(): { connected: boolean; url: string; reconnectAttempts: number };
    isDisposed(): boolean;
    isConnecting(): boolean;
    onConnectionChange(listener: (event: { connected: boolean; message?: string }) => any): vscode.Disposable;
    on(method: string, handler: ((params?: any) => any | Promise<any> | void) | undefined): void;
    call(method: string, params?: any): Promise<any>;
    notify(method: string, params?: any): boolean;
}

export type MessageTransportFactory = (
    context: vscode.ExtensionContext,
    url: string,
) => MessageTransport;

class JSONRPCMessageTransport implements MessageTransport {
    private readonly client: JSONRPCClient;

    constructor(context: vscode.ExtensionContext, url: string) {
        this.client = new JSONRPCClient(context, url);
    }

    public connect(): Promise<{ success: boolean; message?: string }> {
        return this.client.connect();
    }

    public disconnect(): void {
        this.client.disconnect();
    }

    public isConnected(): boolean {
        return this.client.isConnected();
    }

    public getStatus(): { connected: boolean; url: string; reconnectAttempts: number } {
        return this.client.getStatus();
    }

    public isDisposed(): boolean {
        return this.client.isDisposed();
    }

    public isConnecting(): boolean {
        return Boolean((this.client as any)["isConnecting"]);
    }

    public onConnectionChange(listener: (event: { connected: boolean; message?: string }) => any): vscode.Disposable {
        return this.client.onConnectionChange(listener);
    }

    public on(method: string, handler: ((params?: any) => any | Promise<any> | void) | undefined): void {
        this.client.on(method, handler);
    }

    public call(method: string, params?: any): Promise<any> {
        return this.client.call(method, params);
    }

    public notify(method: string, params?: any): boolean {
        return this.client.notify(method, params);
    }

    public dispose(): void {
        this.client.dispose();
    }
}

/**
 * Service class that handles WebSocket connection and JSON-RPC communication
 */
export class ViewerEditWSClient implements vscode.Disposable {
    private readonly context: vscode.ExtensionContext;
    private readonly transport: MessageTransport;
    private handlers: WebSocketHandlers = {};
    private pingTimer: NodeJS.Timeout | undefined;
    private consecutivePingFailures: number = 0;
    private static readonly MAX_PING_FAILURES = 2;

    constructor(
        context: vscode.ExtensionContext,
        url: string = "ws://localhost:9020",
        transportFactory: MessageTransportFactory = (ctx, transportUrl) => new JSONRPCMessageTransport(ctx, transportUrl),
    ) {
        this.context = context;
        this.transport = transportFactory(context, url);
    }

    public async connect(): Promise<{ success: boolean; message?: string }> {
        return this.transport.connect();
    }

    public disconnect(): void {
        this.transport.disconnect();
    }

    public isConnected(): boolean {
        return this.transport.isConnected();
    }

    public getStatus(): { connected: boolean; url: string; reconnectAttempts: number } {
        return this.transport.getStatus();
    }

    public isDisposed(): boolean {
        return this.transport.isDisposed();
    }

    public call(method: string, params?: any): Promise<any> {
        return this.transport.call(method, params);
    }

    public notify(method: string, params?: any): boolean {
        return this.transport.notify(method, params);
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
            this.transport.dispose();
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
        this.transport.on("session.handshake", this.handlers.onHandshake);
        this.transport.on("session.ok", this.handlers.onHandshakeOk);
        this.transport.on("session.disconnect", this.handlers.onDisconnect);
        this.transport.on("language.syntax.change", this.handlers.onSyntaxChange);
        this.transport.on("script.unsubscribe", this.handlers.onUnsubscribe);
        this.transport.on("script.compiled", this.handlers.onCompilationResult);
        this.transport.on("runtime.debug", this.handlers.onRuntimeDebug);
        this.transport.on("runtime.error", this.handlers.onRuntimeError);
        this.transport.on("object.publish", this.handlers.onObjectPublish);
        this.transport.on("object.unpublish", this.handlers.onObjectUnpublish);
        this.transport.on("object.update", this.handlers.onObjectUpdate);

        this.transport.on("command.execute", (params: CommandExecuteParams): Promise<CommandExecuteResponse> => {
            if (this.handlers.onCommandExecute) {
                return this.handlers.onCommandExecute(params);
            }
            return Promise.resolve({ success: false, error_code: CommandErrorCode.UnknownCommand, message: "Unknown command" });
        });

        this.transport.on("command.list", (): CommandListResponse => {
            if (this.handlers.onCommandList) {
                return this.handlers.onCommandList();
            }
            return { commands: [] };
        });

        // Register handler for viewer-initiated pings
        this.transport.on("session.ping", (params: SessionPing): SessionPingResponse => ({
            timestamp: params.timestamp,
            server_time: Date.now()
        }));

        // Handle connection close - stop ping timer and notify handlers
        this.transport.onConnectionChange((event) => {
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
                this.transport.notify("session.disconnect", { reason, message });

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
        return this.transport.call("session.ping", {
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
        return this.transport.call("object.content.get", params);
    }

    public saveObjectContent(params: ObjectContentSaveParams): Promise<ObjectContentSaveResponse> {
        return this.transport.call("object.content.save", params);
    }

    public createObjectItem(params: ObjectItemCreateParams): Promise<ObjectItemCreateResponse> {
        return this.transport.call("object.item.create", params);
    }

    public deleteObjectItem(params: ObjectItemDeleteParams): Promise<ObjectItemDeleteResponse> {
        return this.transport.call("object.item.delete", params);
    }

    public setScriptRunning(params: ObjectScriptSetRunningParams): Promise<ObjectScriptSetRunningResponse> {
        return this.transport.call("object.script.set_running", params);
    }

    public resetScript(params: ObjectScriptResetParams): Promise<ObjectScriptResetResponse> {
        return this.transport.call("object.script.reset", params);
    }

    public unpublishObject(params: ObjectUnpublishParams): Promise<ObjectUnpublishResponse> {
        return this.transport.call("object.unpublish", params);
    }

    public requestObject(params: ObjectRequestParams): Promise<ObjectRequestResponse> {
        return this.transport.call("object.request", params);
    }

    public getObjectList(): Promise<ObjectListResponse> {
        return this.transport.call("object.list", {});
    }

    public modifyObject(params: ObjectModifyParams): Promise<ObjectModifyResponse> {
        return this.transport.call("object.modify", params);
    }

    public modifyObjectItem(params: ObjectItemModifyParams): Promise<ObjectItemModifyResponse> {
        return this.transport.call("object.item.modify", params);
    }

    public getScriptList(): Promise<ScriptList> {
        return this.transport.call("script.list", {});
    }

    public executeCommand(params: CommandExecuteParams): Promise<CommandExecuteResponse> {
        return this.transport.call("command.execute", params);
    }

    public listCommands(): Promise<CommandListResponse> {
        return this.transport.call("command.list", {});
    }

    private setupConnectionCloseHandler(): void {
    // Instead of overriding dispose, use a periodic check for connection state
        const checkConnectionInterval = setInterval(() => {
            if (this.isDisposed()) {
                clearInterval(checkConnectionInterval);
                return;
            }

            // Check if connection was closed externally
            if (!this.isConnected() && !this.transport.isConnecting()) {
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
