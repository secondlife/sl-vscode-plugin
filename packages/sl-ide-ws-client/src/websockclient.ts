/**
 * @file websockclient.ts
 * Basic WebSocket client with connection tracking and reconnection support.
 * Copyright (C) 2025, Linden Research, Inc.
 */
import WebSocket from "ws";
import { Disposable, Emitter, Event, NotifyHost, WsLogger } from "./events";

export const DEFAULT_WS_URL = "ws://localhost:9020";

export interface ConnectionChangeEvent {
    connected: boolean;
    message?: string;
}

export interface WebsockClientOptions {
    /** Server to connect to. Defaults to {@link DEFAULT_WS_URL}. */
    url?: string;
    /** Host logging sink for protocol tracing. */
    logger?: WsLogger;
    /** Host hook for user-visible messages (notifications, status bar, ...). */
    notify?: NotifyHost;
    reconnectInterval?: number;
    maxReconnectAttempts?: number;
}

/**
 * WebSocket client for the Second Life viewer edit protocol.
 * Handles communication with external WebSocket servers or the Second Life viewer.
 */
export class WebsockClient implements Disposable {
    private client: WebSocket | undefined;
    private disposed = false;
    private reconnectTimer: NodeJS.Timeout | undefined;
    private reconnectInterval: number;
    private maxReconnectAttempts: number;
    private reconnectAttempts: number = 0;
    private url: string;
    private connecting: boolean = false;
    protected readonly logger: WsLogger | undefined;
    protected readonly notifyHost: NotifyHost | undefined;
    private _onConnectionChange = new Emitter<ConnectionChangeEvent>();

    public readonly onConnectionChange: Event<ConnectionChangeEvent> =
        this._onConnectionChange.event;

    constructor(options: WebsockClientOptions = {}) {
        this.url = options.url ?? DEFAULT_WS_URL;
        this.logger = options.logger;
        this.notifyHost = options.notify;
        this.reconnectInterval = options.reconnectInterval ?? 5000;
        this.maxReconnectAttempts = options.maxReconnectAttempts ?? 10;
    }

    public dispose(): void {
        if (this.disposed) {
            return;
        }

        this.disposed = true;

        // Disconnect safely
        this.disconnect();
        this._onConnectionChange.dispose();

        console.log("WebSocket client disposed");
    }

    public isDisposed(): boolean {
        return this.disposed;
    }

    /**
   * Connects to the WebSocket server
   */
    public async connect(): Promise<{ success: boolean; message?: string }> {
        if (this.connecting || this.isConnected()) {
            return { success: true };
        }

        this.connecting = true;
        console.log(`Attempting to connect to WebSocket server at ${this.url}`);

        let connectingResolve:
      | ((success: boolean, message?: string) => void)
      | undefined;

        let connecting = new Promise<{ success: boolean; message?: string }>(
            (resolve, _reject) => {
                connectingResolve = (success: boolean, message?: string): void => {
                    resolve({ success, message });
                };
            },
        );

        try {
            this.client = new WebSocket(this.url);

            this.client.on("open", () => {
                this.connecting = false;
                this.reconnectAttempts = 0;
                console.log("WebSocket client connected successfully");
                this.notifyHost?.("Connected to WebSocket server", "info");
                this._onConnectionChange.fire({ connected: true });
                connectingResolve!(true);
            });

            this.client.on("message", (data: WebSocket.RawData) => {
                this.handleMessage(data);
            });

            this.client.on("close", (code: number, reason: Buffer) => {
                this.connecting = false;
                console.log(
                    `WebSocket connection closed: ${code} - ${reason.toString()}`,
                );

                this._onConnectionChange.fire({
                    connected: false,
                    message: reason.toString(),
                });
                if (connectingResolve) {
                    connectingResolve(false, reason.toString());
                }
                // if (!this.disposed && this.shouldReconnect()) {
                //     this.scheduleReconnect();
                // }
            });

            this.client.on("error", (error: Error) => {
                this.connecting = false;
                console.error("WebSocket client error:", error);

                if (connectingResolve) {
                    connectingResolve(false, error.message);
                }
            });
        } catch (error) {
            this.connecting = false;
            console.error("Failed to create WebSocket connection:", error);
            if (connectingResolve) {
                connectingResolve(false, String(error));
            }
        }

        return connecting;
    }

    /**
   * Handles incoming WebSocket messages
   */
    protected handleMessage(data: WebSocket.RawData): void {
        try {
            const message = JSON.parse(data.toString());
            console.log("Received WebSocket message:", message);

            switch (message.command) {
                case "pong":
                    this.handlePongMessage(message);
                    break;
                default:
                    console.log("Unknown message type:", message.type);
            }
        } catch (error) {
            console.error("Error parsing WebSocket message:", error);
        }
    }

    /**
   * Handles pong response from server
   */
    private handlePongMessage(message: any): void {
        const latency = Date.now() - message.timestamp;
        console.log(`WebSocket ping latency: ${latency}ms`);
    }

    /**
   * Sends a message to the WebSocket server
   */
    public sendMessage(message: any): boolean {
        if (!this.isConnected()) {
            console.warn("Cannot send message: WebSocket not connected");
            return false;
        }

        try {
      this.client!.send(JSON.stringify(message));
      return true;
        } catch (error) {
            console.error("Error sending WebSocket message:", error);
            return false;
        }
    }

    /**
   * Sends a ping message to the server
   */
    public ping(): boolean {
        return this.sendMessage({
            type: "ping",
            timestamp: Date.now(),
        });
    }

    /**
   * Checks if the WebSocket is currently connected
   */
    public isConnected(): boolean {
        return (
            this.client !== undefined && this.client.readyState === WebSocket.OPEN
        );
    }

    /**
   * Checks if a connection attempt is currently in flight
   */
    public isConnecting(): boolean {
        return this.connecting;
    }

    /**
   * Gets the current connection status
   */
    public getStatus(): {
    connected: boolean;
    url: string;
    reconnectAttempts: number;
    } {
        return {
            connected: this.isConnected(),
            url: this.url,
            reconnectAttempts: this.reconnectAttempts,
        };
    }

    /**
   * Determines if reconnection should be attempted
   */
    private shouldReconnect(): boolean {
        return this.reconnectAttempts < this.maxReconnectAttempts;
    }

    /**
   * Schedules a reconnection attempt
   */
    private scheduleReconnect(): void {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
        }

        this.reconnectAttempts++;
        console.log(
            `Scheduling reconnection attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${this.reconnectInterval}ms`,
        );

        this.reconnectTimer = setTimeout(() => {
            if (!this.disposed) {
                this.connect();
            }
        }, this.reconnectInterval);
    }

    /**
   * Manually disconnects from the WebSocket server
   */
    public disconnect(): void {
        try {
            if (this.reconnectTimer) {
                clearTimeout(this.reconnectTimer);
                this.reconnectTimer = undefined;
            }

            if (this.client) {
                console.log("Disconnecting WebSocket client");

                // Remove all listeners first to prevent handling events during close
                this.client.removeAllListeners();

                // Close connection immediately without waiting
                if (
                    this.client.readyState === WebSocket.OPEN ||
          this.client.readyState === WebSocket.CONNECTING
                ) {
                    try {
                        this.client.terminate(); // Force close instead of graceful close
                    } catch (error) {
                        console.warn("Error during WebSocket terminate:", error);
                    }
                }

                this.client = undefined;
            }

            this.reconnectAttempts = 0;
            this.connecting = false;
        } catch (error) {
            console.warn("Error during WebSocket disconnect:", error);
        }
    }

    /**
   * Sets the WebSocket server URL
   */
    public setUrl(url: string): void {
        if (this.url !== url) {
            this.url = url;

            // If currently connected, disconnect and reconnect with new URL
            if (this.isConnected()) {
                this.disconnect();
                this.connect();
            }
        }
    }

    /**
   * Gets the current WebSocket server URL
   */
    public getUrl(): string {
        return this.url;
    }
}
