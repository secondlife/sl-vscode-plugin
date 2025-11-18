/**
 * @file websockclient.ts
 * Copyright (C) 2025, Linden Research, Inc.
 */
/**
 * @ * Example usage of JSON-RPC client:
 * ```typescript
 * const client = new JSONRPCClient(context, 'ws://localhost:9020');
 * client.activate();
 *
 * // Unified handler registration - works for both notifications and requests
 * client.on('script.updated', (params) => {
 *   console.log('Script updated:', params); // Notification handler
 * });
 *
 * client.on('editor.getText', async (params) => {
 *   const document = await vscode.workspace.openTextDocument(params.uri);
 *   return document.getText(); // Request handler (returns value)
 * });                console.error(`Error in request handler for ${request.method}:`, error);
                this.respondWithJSONRPCError(
                    requestId,
                    JSONRPCErrorCodes.INTERNAL_ERROR,
                    'Internal error',
                    error instanceof Error ? error.message : String(error)
                ); // Call a method
 * try {
 *   const result = await client.call('someMethod', { param1: 'value1' });
 *   console.log('Method result:', result);
 * } catch (error) {
 *   console.error('RPC call failed:', error);
 * }
 *
 * // Send a notification
 * client.notify('someNotification', { data: 'notification data' });
 *
 * // Remove handler
 * client.off('script.updated');
 * ```s
 *
 * WebSocket client implementations for Second Life scripting extension.
 *
 * This file provides two main classes:
 * - WebsockClient: Basic WebSocket client with reconnection logic
 * - JSONRPCClient: JSON-RPC 2.0 specialization for structured communication
 *
 * Example usage of JSON-RPC client:
 * ```typescript
 * const client = new JSONRPCClient(context, 'ws://localhost:9020');
 * client.activate();
 *
 * // Call a method
 * try {
 *   const result = await client.call('someMethod', { param1: 'value1' });
 *   console.log('Method result:', result);
 * } catch (error) {
 *   console.error('RPC call failed:', error);
 * }
 *
 * // Send a notification
 * client.notify('someNotification', { data: 'notification data' });
 * ```
 *
 */

import * as vscode from "vscode";
import WebSocket from "ws";

/**
 * JSON-RPC 2.0 message types
 */
interface JSONRPCRequest {
  jsonrpc: "2.0";
  method: string;
  params?: any;
  id?: string | number | null;
}

interface JSONRPCResponse {
  jsonrpc: "2.0";
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
  id: string | number | null;
}

interface JSONRPCNotification {
  jsonrpc: "2.0";
  method: string;
  params?: any;
}

type JSONRPCMessage = JSONRPCRequest | JSONRPCResponse | JSONRPCNotification;

/**
 * JSON-RPC 2.0 standard error codes
 */
const JSONRPCErrorCodes = {
    PARSE_ERROR: -32700,
    INVALID_REQUEST: -32600,
    METHOD_NOT_FOUND: -32601,
    INVALID_PARAMS: -32602,
    INTERNAL_ERROR: -32603,
    SERVER_ERROR: -32000, // -32000 to -32099 are reserved for implementation-defined server errors
} as const;

export interface JSONRPCInterface {
    // Connection / lifecycle (inherited from base WebSocket client)
    isConnected(): boolean;
    getStatus(): { connected: boolean; url: string; reconnectAttempts: number };

    // JSON-RPC specific
    call(method: string, params?: any): Promise<any>;
    notify(method: string, params?: any): boolean;

    // Handler management
    on?(method: string, handler: ((params?: any) => any | Promise<any> | void) | undefined): void;
    off?(method: string): boolean;
    getHandlers?(): string[];
    clearHandlers?(): void;
}

//#region Base websocket client
/**
 * WebSocket client for Second Life scripting extension
 * Handles communication with external WebSocket servers or Second Life viewer
 */
export class WebsockClient implements vscode.Disposable {
    private client: WebSocket | undefined;
    private disposed = false;
    private reconnectTimer: NodeJS.Timeout | undefined;
    private reconnectInterval: number = 5000; // 5 seconds
    private maxReconnectAttempts: number = 10;
    private reconnectAttempts: number = 0;
    private url: string;
    private isConnecting: boolean = false;
    protected context: vscode.ExtensionContext;
    private _onConnectionChange = new vscode.EventEmitter<{
    connected: boolean;
    message?: string;
  }>();

    public readonly onConnectionChange: vscode.Event<{
    connected: boolean;
    message?: string;
  }> = this._onConnectionChange.event;

    constructor(
        context: vscode.ExtensionContext,
        url: string = "ws://localhost:9020",
    ) {
        this.url = url;
        this.context = context;
    }

    public dispose(): void {
        if (this.disposed) {
            return;
        }

        this.disposed = true;

        // Disconnect safely
        this.disconnect();

        console.log("WebSocket client disposed");
    }

    public isDisposed(): boolean {
        return this.disposed;
    }

    /**
   * Connects to the WebSocket server
   */
    public async connect(): Promise<{ success: boolean; message?: string }> {
        if (this.isConnecting || this.isConnected()) {
            return { success: true };
        }

        this.isConnecting = true;
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
                this.isConnecting = false;
                this.reconnectAttempts = 0;
                console.log("WebSocket client connected successfully");
                vscode.window.showInformationMessage("Connected to WebSocket server");
                this._onConnectionChange.fire({ connected: true });
                connectingResolve!(true);
            });

            this.client.on("message", (data: WebSocket.RawData) => {
                this.handleMessage(data);
            });

            this.client.on("close", (code: number, reason: Buffer) => {
                this.isConnecting = false;
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
                this.isConnecting = false;
                console.error("WebSocket client error:", error);

                if (connectingResolve) {
                    connectingResolve(false, error.message);
                }
            });
        } catch (error) {
            this.isConnecting = false;
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
            this.isConnecting = false;
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
//#endregion

//#region JSON-RPC client specialization
/**
 * JSON-RPC WebSocket client specialization for Second Life scripting extension
 * Implements JSON-RPC 2.0 protocol over WebSocket connection
 */
export class JSONRPCClient extends WebsockClient implements JSONRPCInterface {
    private pendingRequests = new Map<
    string | number,
    {
      resolve: (value: any) => void;
      reject: (error: any) => void;
      timeout: NodeJS.Timeout;
    }
  >();
    private nextRequestId: number = 1;
    //private requestTimeout: number = 30000; // 30 seconds
    private requestTimeout: number = 300000; // 5 minutes TODO: Debbuging

    // Unified handler registration - single map for both notifications and requests
    private methodHandlers = new Map<
    string,
    (params?: any) => any | Promise<any> | void
  >();

    constructor(
        context: vscode.ExtensionContext,
        url: string = "ws://localhost:9020",
    ) {
        super(context, url);
    }

    /**
   * Handles incoming WebSocket messages with JSON-RPC support
   */
    protected handleMessage(data: WebSocket.RawData): void {
        try {
            const message = JSON.parse(data.toString()) as JSONRPCMessage;
            console.log("Received JSON-RPC message:", message);

            if (this.isJSONRPCResponse(message)) {
                this.handleJSONRPCResponse(message);
            } else if (this.isJSONRPCNotification(message)) {
                this.handleJSONRPCNotification(message);
            } else if (this.isJSONRPCRequest(message)) {
                // Handle async request processing
                this.handleJSONRPCRequest(message).catch((error) => {
                    console.error("Error handling JSON-RPC request:", error);
                });
            } else {
                console.warn("Invalid JSON-RPC message format:", message);
            }
        } catch (error) {
            console.error("Error parsing JSON-RPC message:", error);
        }
    }

    /**
   * Type guard for JSON-RPC response
   */
    private isJSONRPCResponse(message: any): message is JSONRPCResponse {
        return (
            message.jsonrpc === "2.0" &&
      message.id !== undefined &&
      (message.result !== undefined || message.error !== undefined)
        );
    }

    /**
   * Type guard for JSON-RPC notification
   */
    private isJSONRPCNotification(message: any): message is JSONRPCNotification {
        return (
            message.jsonrpc === "2.0" &&
      message.method !== undefined &&
      message.id === undefined
        );
    }

    /**
   * Type guard for JSON-RPC request
   */
    private isJSONRPCRequest(message: any): message is JSONRPCRequest {
        return (
            message.jsonrpc === "2.0" &&
            message.method !== undefined &&
            message.id !== undefined
        );
    }

    private handleJSONRPCResponse(response: JSONRPCResponse): void {
        if (response.id === null) {
            console.warn("Received response with null ID");
            return;
        }

        const pendingRequest = this.pendingRequests.get(response.id);
        if (!pendingRequest) {
            console.warn("Received response for unknown request ID:", response.id);
            return;
        }

        this.pendingRequests.delete(response.id);
        clearTimeout(pendingRequest.timeout);

        if (response.error) {
            pendingRequest.reject(
                new Error(
                    `JSON-RPC Error ${response.error.code}: ${response.error.message}`,
                ),
            );
        } else {
            pendingRequest.resolve(response.result);
        }
    }

    private handleJSONRPCNotification(notification: JSONRPCNotification): void {
        console.log(
            `JSON-RPC notification: ${notification.method}`,
            notification.params,
        );

        // Check for dynamically registered handlers
        const handler = this.methodHandlers.get(notification.method);
        if (handler) {
            try {
                handler(notification.params);
            } catch (error) {
                console.error(
                    `Error in notification handler for ${notification.method}:`,
                    error,
                );
            }
            return;
        }

        // Fallback to built-in handlers
        switch (notification.method) {
            default:
                console.log(`Unhandled JSON-RPC notification: ${notification.method}`);
        }
    }

    private async handleJSONRPCRequest(request: JSONRPCRequest): Promise<void> {
        console.log(`JSON-RPC request: ${request.method}`, request.params);

        // For requests, id should not be undefined, but we need to handle it safely
        const requestId = request.id !== undefined ? request.id : null;

        // Check for dynamically registered handlers
        const handler = this.methodHandlers.get(request.method);
        if (handler) {
            try {
                const result = await handler(request.params);
                this.respondToJSONRPC(requestId, result);
            } catch (error) {
                console.error(`Error in request handler for ${request.method}:`, error);
                this.respondWithJSONRPCError(
                    requestId,
                    -32603,
                    "Internal error",
                    error instanceof Error ? error.message : String(error),
                );
            }
            return;
        }

        // Fallback to built-in handlers
        switch (request.method) {
            case "system.ping":
                this.respondToJSONRPC(requestId, "pong");
                break;
            case "system.getVersion":
                this.respondToJSONRPC(requestId, {
                    version: "1.0.0",
                    client: "vscode-extension",
                });
                break;
            case "system.listMethods": {
                const builtInMethods = [
                    "system.ping",
                    "system.getVersion",
                    "system.listMethods",
                ];
                const registeredMethods = this.getHandlers();
                const allMethods = [
                    ...new Set([...builtInMethods, ...registeredMethods]),
                ];
                this.respondToJSONRPC(requestId, allMethods);
                break;
            }
            default:
                this.respondWithJSONRPCError(
                    requestId,
                    JSONRPCErrorCodes.METHOD_NOT_FOUND,
                    `Method not found: ${request.method}`,
                );
        }
    }

    /**
   * Makes a JSON-RPC method call
   */
    public async call(method: string, params?: any): Promise<any> {
        return new Promise((resolve, reject) => {
            if (!this.isConnected()) {
                reject(new Error("WebSocket not connected"));
                return;
            }

            const id = this.nextRequestId++;
            const request: JSONRPCRequest = {
                jsonrpc: "2.0",
                method,
                params,
                id,
            };

            const timeout = setTimeout(() => {
                this.pendingRequests.delete(id);
                reject(new Error(`JSON-RPC request timeout for method: ${method}`));
            }, this.requestTimeout);

            this.pendingRequests.set(id, { resolve, reject, timeout });

            if (!this.sendJSONRPCMessage(request)) {
                this.pendingRequests.delete(id);
                clearTimeout(timeout);
                reject(new Error("Failed to send JSON-RPC request"));
            }
        });
    }

    /**
   * Sends a JSON-RPC notification
   */
    public notify(method: string, params?: any): boolean {
        const notification: JSONRPCNotification = {
            jsonrpc: "2.0",
            method,
            params,
        };

        return this.sendJSONRPCMessage(notification);
    }

    /**
   * Sends a JSON-RPC message
   */
    private sendJSONRPCMessage(message: JSONRPCMessage): boolean {
        return this.sendMessage(message);
    }

    /**
   * Responds to a JSON-RPC request
   */
    private respondToJSONRPC(id: string | number | null, result: any): boolean {
        const response: JSONRPCResponse = {
            jsonrpc: "2.0",
            result,
            id,
        };

        return this.sendJSONRPCMessage(response);
    }

    /**
   * Responds with a JSON-RPC error
   */
    private respondWithJSONRPCError(
        id: string | number | null,
        code: number,
        message: string,
        data?: any,
    ): boolean {
        const response: JSONRPCResponse = {
            jsonrpc: "2.0",
            error: { code, message, data },
            id,
        };

        return this.sendJSONRPCMessage(response);
    }

    // Dynamic handler registration methods

    /**
   * Unified method to register handlers for both JSON-RPC notifications and requests
   * @param method The method name to handle
   * @param handler The function to call when this method is received
   *                For notifications: (params?) => void
   *                For requests: (params?) => any | Promise<any>
   */
    public on(
        method: string,
        handler: ((params?: any) => any | Promise<any> | void) | undefined,
    ): void {
        if (handler) {
            this.methodHandlers.set(method, handler);
        } else {
            this.methodHandlers.delete(method);
        }
    }

    /**
   * Unified method to unregister handlers for both notifications and requests
   * @param method The method name to stop handling
   */
    public off(method: string): boolean {
        return this.methodHandlers.delete(method);
    }

    /**
   * Gets all registered handlers (both notifications and requests)
   */
    public getHandlers(): string[] {
        return Array.from(this.methodHandlers.keys());
    }

    /**
   * Clears all registered handlers
   */
    public clearHandlers(): void {
        this.methodHandlers.clear();
    }

    /**
   * Sets the request timeout for JSON-RPC calls
   */
    public setRequestTimeout(timeout: number): void {
        this.requestTimeout = timeout;
    }

    /**
   * Gets the request timeout for JSON-RPC calls
   */
    public getRequestTimeout(): number {
        return this.requestTimeout;
    }

    /**
   * Disposes of the JSON-RPC client resources
   */
    public dispose(): void {
        if (this.isDisposed()) {
            return;
        }

        try {
            // Clear all pending requests immediately with cancellation errors
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            for (const [_id, pending] of this.pendingRequests) {
                clearTimeout(pending.timeout);
                pending.reject(new Error("Client shutting down"));
            }
            this.pendingRequests.clear();

            // Clear all method handlers
            this.methodHandlers.clear();

            // Call parent dispose (this will handle WebSocket cleanup)
            super.dispose();
        } catch (error) {
            console.warn("Error during JSONRPCClient disposal:", error);
        }
    }
}

//#endregion
