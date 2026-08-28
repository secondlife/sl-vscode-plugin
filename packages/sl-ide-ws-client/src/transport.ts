/**
 * @file transport.ts
 * Message transport abstraction used by ViewerEditWSClient, plus the default
 * JSON-RPC over WebSocket implementation.
 * Copyright (C) 2025, Linden Research, Inc.
 */
import { ConnectionChangeEvent, WebsockClientOptions } from "./websockclient";
import { JSONRPCClient } from "./jsonrpcclient";
import { Disposable } from "./events";

export interface MessageTransport extends Disposable {
    connect(): Promise<{ success: boolean; message?: string }>;
    disconnect(): void;
    isConnected(): boolean;
    getStatus(): { connected: boolean; url: string; reconnectAttempts: number };
    isDisposed(): boolean;
    isConnecting(): boolean;
    onConnectionChange(listener: (event: ConnectionChangeEvent) => any): Disposable;
    on(method: string, handler: ((params?: any) => any | Promise<any> | void) | undefined): void;
    call(method: string, params?: any): Promise<any>;
    notify(method: string, params?: any): boolean;
}

export type MessageTransportFactory = (
    options: WebsockClientOptions,
) => MessageTransport;

export class JSONRPCMessageTransport implements MessageTransport {
    private readonly client: JSONRPCClient;

    constructor(options: WebsockClientOptions) {
        this.client = new JSONRPCClient(options);
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
        return this.client.isConnecting();
    }

    public onConnectionChange(listener: (event: ConnectionChangeEvent) => any): Disposable {
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
