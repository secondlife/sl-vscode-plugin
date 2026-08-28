/**
 * @file protocol.ts
 * Message formats for the Second Life viewer edit protocol.
 */
import type {
    ObjectPublishMessage,
    ObjectUnpublishMessage,
    ObjectUpdateMessage,
} from "./objectcontentinterfaces";

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
