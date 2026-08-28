/**
 * @file jsonrpcclient.ts
 * JSON-RPC 2.0 specialization of the base WebSocket client.
 *
 * Example usage:
 * ```typescript
 * const client = new JSONRPCClient({ url: "ws://localhost:9020" });
 * client.connect();
 *
 * // Unified handler registration - works for both notifications and requests
 * client.on("script.updated", (params) => {
 *   console.log("Script updated:", params); // Notification handler
 * });
 *
 * // Call a method
 * const result = await client.call("someMethod", { param1: "value1" });
 *
 * // Send a notification
 * client.notify("someNotification", { data: "notification data" });
 *
 * // Remove handler
 * client.off("script.updated");
 * ```
 *
 * Copyright (C) 2025, Linden Research, Inc.
 */
import WebSocket from "ws";
import { WebsockClient, WebsockClientOptions } from "./websockclient";

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

/**
 * JSON-RPC WebSocket client specialization for the Second Life viewer edit protocol.
 * Implements JSON-RPC 2.0 protocol over a WebSocket connection.
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
    private requestTimeout: number = 30000; // 30 seconds

    // Unified handler registration - single map for both notifications and requests
    private methodHandlers = new Map<
    string,
    (params?: any) => any | Promise<any> | void
  >();

    constructor(options: WebsockClientOptions = {}) {
        super(options);
    }

    private logIncomingMessage(message: JSONRPCMessage): void {
        if (this.isJSONRPCRequest(message)) {
            this.logger?.debug?.(`[JSON-RPC] <- request method=${message.method} id=${String(message.id)}`);
            return;
        }

        if (this.isJSONRPCNotification(message)) {
            this.logger?.debug?.(`[JSON-RPC] <- notification method=${message.method}`);
            return;
        }

        if (this.isJSONRPCResponse(message)) {
            const status = message.error ? "error" : "result";
            this.logger?.debug?.(`[JSON-RPC] <- response id=${String(message.id)} status=${status}`);
        }
    }

    private logOutgoingMessage(message: JSONRPCMessage): void {
        if (this.isJSONRPCRequest(message)) {
            this.logger?.debug?.(`[JSON-RPC] -> request method=${message.method} id=${String(message.id)}`);
            return;
        }

        if (this.isJSONRPCNotification(message)) {
            this.logger?.debug?.(`[JSON-RPC] -> notification method=${message.method}`);
            return;
        }

        if (this.isJSONRPCResponse(message)) {
            const status = message.error ? "error" : "result";
            this.logger?.debug?.(`[JSON-RPC] -> response id=${String(message.id)} status=${status}`);
        }
    }

    /**
   * Handles incoming WebSocket messages with JSON-RPC support
   */
    protected handleMessage(data: WebSocket.RawData): void {
        try {
            const message = JSON.parse(data.toString()) as JSONRPCMessage;
            this.logIncomingMessage(message);

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
        // Check for dynamically registered handlers
        const handler = this.methodHandlers.get(notification.method);
        if (handler) {
            try {
                const result = handler(notification.params);
                if (result && typeof (result as PromiseLike<unknown>).then === "function") {
                    Promise.resolve(result).catch((error) => {
                        console.error(
                            `Error in async notification handler for ${notification.method}:`,
                            error,
                        );
                    });
                }
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
                    JSONRPCErrorCodes.INTERNAL_ERROR,
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
        this.logOutgoingMessage(message);
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
