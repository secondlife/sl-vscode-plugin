/**
 * @file objectcontentinterfaces.ts
 * Interfaces for object content publishing feature
 * Copyright (C) 2025, Linden Research, Inc.
 */

// ============================================
// Core Data Types
// ============================================

/**
 * Types of inventory items supported by the object content provider.
 * Only scripts and notecards are supported; other item types are not exposed.
 */
export type InventoryItemType = "script" | "notecard";

/** Script virtual machine / compiler target */
export type ScriptVM = "lsl2" | "mono" | "luau";

/** Save-time compile target accepted by object.content.save */
export type ObjectContentSaveVM = "mono" | "lsl2" | "luau";

/**
 * Permission masks from viewer's LLPermissions.
 * Only owner and next_owner masks are transmitted.
 * Bit flags: PERM_MODIFY=0x4000, PERM_COPY=0x8000, PERM_TRANSFER=0x2000
 */
export interface ItemPermissions {
    owner: number;             // Current owner's permission mask
    next_owner: number;        // Applied on transfer
}

/**
 * Inventory item within an object or linked prim.
 * Only scripts and notecards are supported; other item types are not exposed.
 * Note: asset_id is intentionally not transmitted for security.
 */
export interface ObjectInventoryItem {
    item_id: string;           // Inventory item UUID (unique within container)
    name: string;              // Display name
    description?: string;      // Item description
    type: InventoryItemType;
    /** Scripts only: script language subtype from viewer's II_FLAGS_SUBTYPE_MASK (0=LSL, 1=Luau) */
    subtype?: number;
    /** Scripts only: which VM the script targets/was compiled for (from script metadata) */
    vm?: ScriptVM;
    /** For scripts only: whether the script is currently running */
    running?: boolean;
    permissions?: ItemPermissions;
    creator_id?: string;       // Creator UUID
}

/**
 * A linked prim within a linkset
 */
export interface LinkedObject {
    link_id: string;           // UUID of the linked prim
    link_number: number;       // Link number (2+ = children; root is 1)
    link_name: string;         // Display name of the linked prim
    link_description?: string;
    inventory: ObjectInventoryItem[];
}

/**
 * Permission masks for the object itself
 */
export interface ObjectPermissions {
    owner: number;
    next_owner: number;
}

/**
 * Published object container (root of a linkset)
 */
export interface PublishedObject {
    object_id: string;           // UUID of the root prim
    object_name: string;         // Display name of root prim
    object_description?: string;
    region?: string;             // Region where object exists
    owner_id?: string;           // Owner UUID
    permissions?: ObjectPermissions;
    inventory: ObjectInventoryItem[];    // Root prim inventory (scripts and notecards only)
    linked_objects?: LinkedObject[];     // Child prims in linkset
}

// ============================================
// WebSocket Message Interfaces
// ============================================

/** object.publish — Viewer → Extension (notification) */
export interface ObjectPublishMessage {
    object: PublishedObject;
}

/** object.unpublish — Viewer → Extension (notification) */
export interface ObjectUnpublishMessage {
    object_id: string;
    reason?: string;
}

/** object.unpublish — Extension → Viewer (call) */
export interface ObjectUnpublishParams {
    object_id: string;
}

export interface ObjectUnpublishResponse {
    success: boolean;
    object_id?: string;
}

/** Delta changes for inventory items */
export interface InventoryChanges {
    added?: ObjectInventoryItem[];
    removed?: string[];                                           // item_ids
    modified?: ObjectInventoryItem[];                            // metadata changes
    content_changed?: string[];                                  // item_ids (invalidates cache)
    running_changed?: { item_id: string; running: boolean }[];
}

/** Delta changes for linked objects */
export interface LinkedObjectChanges {
    added?: LinkedObject[];
    removed?: string[];                                           // link_ids
    modified?: {
        link_id: string;
        link_name?: string;
        // Can be either full replacement (array) or delta changes (object)
        inventory?: InventoryChanges | ObjectInventoryItem[];
    }[];
}

/**
 * object.update — Viewer → Extension (notification)
 * Supports full replacement or delta-based updates.
 * If `changes` is present it takes precedence over full replacement fields.
 */
export interface ObjectUpdateMessage {
    object_id: string;
    object_name?: string;
    // Full replacement
    inventory?: ObjectInventoryItem[];
    linked_objects?: LinkedObject[];
    // Delta
    changes?: {
        inventory?: InventoryChanges;
        linked_objects?: LinkedObjectChanges;
    };
}

/** object.content.get — Extension → Viewer (call) */
export interface ObjectContentGetParams {
    prim_id: string;           // UUID of any prim (root or child)
    item_id: string;
}

/** object.content.get response */
export interface ObjectContentGetResponse {
    success: boolean;
    prim_id: string;
    item_id: string;
    content: string;
    encoding?: "utf-8" | "base64";
}

/** object.content.save — Extension → Viewer (call) */
export interface ObjectContentSaveParams {
    prim_id: string;           // UUID of any prim (root or child)
    item_id: string;
    content: string;
    vm?: ObjectContentSaveVM;  // Scripts only: explicit compile target
    running?: boolean;         // Scripts only: whether to start the script after save
}

/** object.content.save response */
export interface ObjectContentSaveResponse {
    success: boolean;
    prim_id?: string;
    item_id?: string;
    compiled?: boolean;        // Scripts only: true if compilation succeeded
    errors?: string[];         // Scripts only: compiler diagnostics when compiled is false
    message?: string;
}

/** object.item.create — Extension → Viewer (call) */
export interface ObjectItemCreateParams {
    prim_id: string;           // UUID of any prim (root or child)
    name: string;              // Item name (no extension — pure SL inventory name)
    type: InventoryItemType;   // "script" | "notecard"
    vm?: ScriptVM;             // Required for scripts: "luau" | "mono" | "lsl2"
    text?: string;             // Optional initial text content (notecards only)
}

/** object.item.create response */
export interface ObjectItemCreateResponse extends ObjectInventoryItem {
    prim_id: string;           // Echoed prim UUID
}

/** object.item.delete — Extension → Viewer (call) */
export interface ObjectItemDeleteParams {
    prim_id: string;           // UUID of any prim (root or child)
    item_id: string;
}

/** object.item.delete response */
export interface ObjectItemDeleteResponse {
    success: boolean;
    prim_id: string;           // Echoed back from request
    item_id: string;           // Echoed back from request
}

/** object.script.set_running — Extension → Viewer (call) */
export interface ObjectScriptSetRunningParams {
    prim_id: string;           // UUID of any prim (root or child)
    item_id: string;
    running: boolean;          // true = start, false = stop
}

/** object.script.set_running response */
export interface ObjectScriptSetRunningResponse {
    success: boolean;
    message?: string;
}

/** object.script.reset — Extension → Viewer (call)
 * Resets a script, clearing its state and restarting from default state.
 */
export interface ObjectScriptResetParams {
    prim_id: string;           // UUID of any prim (root or child)
    item_id: string;           // UUID of the script inventory item
}

/** object.script.reset response */
export interface ObjectScriptResetResponse {
    success: boolean;
    message?: string;
}

/** object.request — Extension → Viewer (call) */
export interface ObjectRequestParams {
    object_id: string;   // UUID of the root prim to request publishing for
}

/** object.request response */
export interface ObjectRequestResponse {
    object?: PublishedObject; // Primary response payload for requested object
    success?: boolean;        // Legacy compatibility for older viewers
    message?: string;         // reason on failure (e.g. "object not found", "permission denied")
}

/** object.list response */
export interface ObjectListResponse {
    objects: PublishedObject[];
}

/**
 * object.modify — Extension → Viewer (call)
 * Modifies properties of a prim (root or linked).
 * Only specified fields are modified; omitted fields remain unchanged.
 */
export interface ObjectModifyParams {
    prim_id: string;               // UUID of any prim (root or child)
    name?: string;                 // New display name
    description?: string;          // New description
    permissions?: {
        next_owner?: number;       // Permission mask applied on transfer
    };
}

/** object.modify response */
export interface ObjectModifyResponse {
    success: boolean;
    prim_id: string;               // Echoed back from request
    message?: string;              // Error description on failure
}

/**
 * object.item.modify — Extension → Viewer (call)
 * Modifies properties of an inventory item.
 * Only specified fields are modified; omitted fields remain unchanged.
 */
export interface ObjectItemModifyParams {
    prim_id: string;               // UUID of any prim (root or child)
    item_id: string;               // Inventory item UUID
    name?: string;                 // New display name (no file extension)
    description?: string;          // New description
    permissions?: {
        next_owner?: number;       // Permission mask applied on transfer
    };
}

/** object.item.modify response */
export interface ObjectItemModifyResponse {
    success: boolean;
    prim_id: string;               // Echoed back from request
    item_id: string;               // Echoed back from request
    message?: string;              // Error description on failure
}

// ============================================
// Internal Service Types (not transmitted)
// ============================================

/** Cached content for an inventory item */
export interface CachedItemContent {
    content: Uint8Array;
    mtime: number;
    dirty: boolean;
}

/** Internal representation of a published object with content cache */
export interface ObjectEntry {
    object: PublishedObject;
    contentCache: Map<string, CachedItemContent>;  // keyed by item_id
    publishedAt: number;
}
