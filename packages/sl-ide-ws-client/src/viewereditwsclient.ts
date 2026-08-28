/**
 * @file viewereditwsclient.ts
 * Client for the Second Life viewer edit protocol.
 * Copyright (C) 2025, Linden Research, Inc.
 */
import { Disposable, NotifyHost } from "./events";
import { DEFAULT_WS_URL, WebsockClientOptions } from "./websockclient";
import {
    JSONRPCMessageTransport,
    MessageTransport,
    MessageTransportFactory,
} from "./transport";
import {
    CommandErrorCode,
    CommandExecuteParams,
    CommandExecuteResponse,
    CommandListResponse,
    ScriptList,
    SessionPing,
    SessionPingResponse,
    WebSocketHandlers,
} from "./protocol";
import {
    ObjectContentGetParams,
    ObjectContentGetResponse,
    ObjectContentSaveParams,
    ObjectContentSaveResponse,
    ObjectItemCreateParams,
    ObjectItemCreateResponse,
    ObjectItemDeleteParams,
    ObjectItemDeleteResponse,
    ObjectItemModifyParams,
    ObjectItemModifyResponse,
    ObjectListResponse,
    ObjectModifyParams,
    ObjectModifyResponse,
    ObjectRequestParams,
    ObjectRequestResponse,
    ObjectScriptResetParams,
    ObjectScriptResetResponse,
    ObjectScriptSetRunningParams,
    ObjectScriptSetRunningResponse,
    ObjectUnpublishParams,
    ObjectUnpublishResponse,
} from "./objectcontentinterfaces";

export interface ViewerEditWSClientOptions extends WebsockClientOptions {
    /** Grace period between sending session.disconnect and closing the socket. */
    disconnectDelayMs?: number | (() => number);
    /** Override the transport, primarily for tests. */
    transportFactory?: MessageTransportFactory;
}

const DEFAULT_DISCONNECT_DELAY_MS = 1000;

/**
 * Service class that handles WebSocket connection and JSON-RPC communication
 */
export class ViewerEditWSClient implements Disposable {
    private readonly transport: MessageTransport;
    private readonly disconnectDelayMs: number | (() => number) | undefined;
    private readonly notifyHost: NotifyHost | undefined;
    private subscriptions: Disposable[] = [];
    private handlers: WebSocketHandlers = {};
    private pingTimer: NodeJS.Timeout | undefined;
    private consecutivePingFailures: number = 0;
    private static readonly MAX_PING_FAILURES = 2;

    constructor(options: ViewerEditWSClientOptions = {}) {
        const { disconnectDelayMs, transportFactory, ...transportOptions } = options;
        this.disconnectDelayMs = disconnectDelayMs;
        this.notifyHost = options.notify;
        const factory: MessageTransportFactory =
            transportFactory ?? ((opts): MessageTransport => new JSONRPCMessageTransport(opts));
        this.transport = factory({
            ...transportOptions,
            url: transportOptions.url ?? DEFAULT_WS_URL,
        });
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
            this.clearSubscriptions();
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
   * @returns A disposable that releases the connection watchers created here
   */
    public setup(handlers: WebSocketHandlers): Disposable {
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
        this.subscriptions.push(
            this.transport.onConnectionChange((event) => {
                if (!event.connected) {
                    console.log("[WebSocket] Connection closed, cleaning up");
                    this.stopPingTimer();
                    this.handlers.onConnectionClosed?.();
                }
            }),
        );

        // Setup connection close handler
        this.subscriptions.push(this.setupConnectionCloseHandler());

        // Activate the WebSocket client
        this.connect();

        return { dispose: () => this.clearSubscriptions() };
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
                    this.resolveDisconnectDelay(),
                );

                this.notifyHost?.(`Disconnected from Second Life: ${message}`, "status");
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

    private resolveDisconnectDelay(): number {
        const delay = typeof this.disconnectDelayMs === "function"
            ? this.disconnectDelayMs()
            : this.disconnectDelayMs;
        return delay || DEFAULT_DISCONNECT_DELAY_MS;
    }

    private clearSubscriptions(): void {
        for (const subscription of this.subscriptions) {
            subscription.dispose();
        }
        this.subscriptions = [];
    }

    private setupConnectionCloseHandler(): Disposable {
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

        return { dispose: () => clearInterval(checkConnectionInterval) };
    }
}
