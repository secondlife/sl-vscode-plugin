/**
 * @file objectcontentprovider.ts
 * VS Code FileSystemProvider for the sl:// virtual filesystem.
 * Presents published Second Life in-world objects as browseable directories.
 * Copyright (C) 2025, Linden Research, Inc.
 */
import * as vscode from "vscode";
import { ObjectContentService } from "./objectcontentservice";
import { ViewerEditWSClient } from "../viewereditwsclient";
import {
    InventoryItemType,
    LinkedObject,
    ObjectContentSaveVM,
    ObjectInventoryItem,
    ObjectItemCreateParams,
    ScriptVM,
} from "./objectcontentinterfaces";
import type { Diagnostic } from "../viewereditwsclient";
import { ScriptLanguage } from "../shared/languageservice";

// ============================================
// Constants
// ============================================

export const SL_SCHEME = "sl";
export const SL_AUTHORITY = "objects";

/** PERM_MODIFY bit from viewer LLPermissions */
const PERM_MODIFY = 0x4000;

// JSON-RPC error codes used by the viewer
const JSONRPC_INVALID_PARAMS = -32602;
const JSONRPC_FORBIDDEN = -32003;
const JSONRPC_TIMEOUT = -32001;
const JSONRPC_INTERNAL_ERROR = -32603;

/**
 * Extract JSON-RPC error code from error message.
 * The websocket client formats errors as "JSON-RPC Error {code}: {message}"
 */
function extractJsonRpcErrorCode(error: Error): number | undefined {
    const match = error.message.match(/^JSON-RPC Error (-?\d+):/);
    return match ? parseInt(match[1], 10) : undefined;
}

/**
 * Map JSON-RPC error to appropriate FileSystemError.
 */
function mapRpcErrorToFileSystemError(error: unknown, uri: vscode.Uri): Error {
    if (!(error instanceof Error)) {
        return vscode.FileSystemError.Unavailable(uri);
    }

    const code = extractJsonRpcErrorCode(error);
    switch (code) {
        case JSONRPC_INVALID_PARAMS:
            // Prim not found, item not found, or invalid item type
            return vscode.FileSystemError.FileNotFound(uri);
        case JSONRPC_FORBIDDEN:
            // Object not published or insufficient permissions
            return vscode.FileSystemError.NoPermissions(uri);
        case JSONRPC_TIMEOUT:
            // Simulator didn't respond in time
            return vscode.FileSystemError.Unavailable(`Request timed out: ${uri}`);
        case JSONRPC_INTERNAL_ERROR:
            // Asset cache issue or other internal error
            return vscode.FileSystemError.Unavailable(error.message);
        default:
            // Pass through the original error message
            return vscode.FileSystemError.Unavailable(error.message);
    }
}

// ============================================
// URI Helpers
// ============================================

interface ParsedObjectUri {
    /** Root prim UUID (always present) */
    root_id: string;
    /** Child prim UUID if path has 2+ segments, otherwise undefined */
    link_id?: string;
    /** Item UUID if this is a file URI, otherwise undefined */
    item_id?: string;
    /** Unresolved leaf filename for create flows */
    pending_name?: string;
    /** Whether this URI refers to a directory */
    isDirectory: boolean;
    /** Whether this is a /+create/ URI for explicit item creation */
    isCreate?: boolean;
}

interface ParseUriOptions {
    allowMissingLeaf?: boolean;
}

/** Check if a string looks like a UUID */
function isUUID(s: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

/**
 * Returns the display name to use for a linked prim's directory entry in readDirectory.
 * Uses link_name when unique among siblings; disambiguates with link_number when names collide.
 * Falls back to link_id when link_name is empty.
 */
function linkedPrimDirName(lo: LinkedObject, allLinked: LinkedObject[]): string {
    if (!lo.link_name) return lo.link_id;
    const hasDuplicate = allLinked.some(
        (other) => other.link_id !== lo.link_id && other.link_name === lo.link_name
    );
    return hasDuplicate ? `${lo.link_name} (${lo.link_number})` : lo.link_name;
}

/**
 * Resolves a linked prim directory segment (as returned by readDirectory) back to its link_id.
 * Accepts: plain UUID, "Name (link_number)" disambiguated format, or plain name.
 */
function resolveLinkedPrimId(
    segment: string,
    linkedObjects: LinkedObject[]
): string | undefined {
    // UUID — used by internal API calls and content-change notifications
    const byId = linkedObjects.find((lo) => lo.link_id === segment);
    if (byId) return byId.link_id;

    // "Name (N)" — disambiguated display name
    const m = segment.match(/^(.*) \((\d+)\)$/);
    if (m) {
        const baseName = m[1];
        const linkNum = parseInt(m[2], 10);
        const found = linkedObjects.find(
            (lo) => lo.link_name === baseName && lo.link_number === linkNum
        );
        if (found) return found.link_id;
    }

    // Plain name — for unique names
    return linkedObjects.find((lo) => lo.link_name === segment)?.link_id;
}

/**
 * Find an item in an inventory list by its display name.
 * Returns the item_id if found, undefined otherwise.
 */
function findItemByDisplayName(
    inventory: ObjectInventoryItem[] | undefined,
    filename: string
): string | undefined {
    if (!inventory) return undefined;
    const item = inventory.find((i) => displayName(i) === filename);
    return item?.item_id;
}

/**
 * Parse an sl://objects/... URI into its components.
 *
 * URI shapes:
 *   sl://objects/{root_id}                  → root directory
 *   sl://objects/{root_id}/{seg}            → file in root (item_id or display name)
 *                                             OR child prim directory (link_id = seg)
 *   sl://objects/{root_id}/{link_id}/{seg}  → file in child prim (item_id or display name)
 *
 * For file URIs, the segment can be either:
 * - A UUID (item_id directly) — used by API calls
 * - A display name (e.g., "Hello World.lsl") — used by Explorer
 *
 * Directories are distinguished from files by checking the object tree.
 */
function parseUri(
    uri: vscode.Uri,
    service: ObjectContentService,
    options?: ParseUriOptions
): ParsedObjectUri {
    // Strip leading slash and split
    const parts = uri.path.replace(/^\//, "").split("/").filter((p) => p.length > 0);

    if (parts.length === 0) {
        throw vscode.FileSystemError.FileNotFound(uri);
    }

    const root_id = parts[0];

    // Detect /+create/ pattern early — no inventory lookup needed
    const createIdx = parts.indexOf("+create");
    if (createIdx !== -1) {
        if (createIdx === 1 && parts.length === 3) {
            // sl://objects/{root_id}/+create/{filename}
            return { root_id, pending_name: parts[2], isDirectory: false, isCreate: true };
        }
        if (createIdx === 2 && parts.length === 4) {
            // sl://objects/{root_id}/{link_id}/+create/{filename}
            return { root_id, link_id: parts[1], pending_name: parts[3], isDirectory: false, isCreate: true };
        }
        throw vscode.FileSystemError.FileNotFound(uri);
    }

    const entry = service.getObject(root_id);

    if (parts.length === 1) {
        return { root_id, isDirectory: true };
    }

    const seg1 = parts[1];

    if (parts.length === 2) {
        // Is seg1 a linked prim (directory) or an item (file)?
        const linkedObjects = entry?.object.linked_objects ?? [];
        const resolvedLinkId = resolveLinkedPrimId(seg1, linkedObjects);

        if (resolvedLinkId !== undefined) {
            return { root_id, link_id: resolvedLinkId, isDirectory: true };
        }

        // seg1 is either a UUID or a display name
        let item_id: string | undefined;
        if (isUUID(seg1)) {
            item_id = seg1;
        } else {
            item_id = findItemByDisplayName(entry?.object.inventory, seg1);
        }
        if (!item_id) {
            if (options?.allowMissingLeaf) {
                return { root_id, pending_name: seg1, isDirectory: false };
            }
            throw vscode.FileSystemError.FileNotFound(uri);
        }
        return { root_id, item_id, isDirectory: false };
    }

    if (parts.length === 3) {
        const linkedObjects = entry?.object.linked_objects ?? [];
        const link_id = resolveLinkedPrimId(parts[1], linkedObjects) ?? parts[1];
        const seg2 = parts[2];

        // seg2 is either a UUID or a display name
        let item_id: string | undefined;
        if (isUUID(seg2)) {
            item_id = seg2;
        } else {
            const linkedObj = entry?.object.linked_objects?.find((lo) => lo.link_id === link_id);
            item_id = findItemByDisplayName(linkedObj?.inventory, seg2);
        }
        if (!item_id) {
            if (options?.allowMissingLeaf) {
                return { root_id, link_id, pending_name: seg2, isDirectory: false };
            }
            throw vscode.FileSystemError.FileNotFound(uri);
        }
        return { root_id, link_id, item_id, isDirectory: false };
    }

    throw vscode.FileSystemError.FileNotFound(uri);
}

/** Build a URI for a root prim directory */
export function rootUri(root_id: string): vscode.Uri {
    return vscode.Uri.from({ scheme: SL_SCHEME, authority: SL_AUTHORITY, path: `/${root_id}` });
}

/** Build a URI for a linked prim directory */
export function linkedPrimUri(root_id: string, link_id: string): vscode.Uri {
    return vscode.Uri.from({ scheme: SL_SCHEME, authority: SL_AUTHORITY, path: `/${root_id}/${link_id}` });
}

export function scriptUri(
    root_id: string,
    prim_id: string | null,
    item_id: string,
    readable_name?: string,
): vscode.Uri {
    const segments = [root_id];

    if (prim_id) {
        segments.push(prim_id);
    }

    segments.push(item_id);

    if (readable_name) {
        segments.push(readable_name);
    }

    return vscode.Uri.from({
        scheme: SL_SCHEME,
        authority: SL_AUTHORITY,
        path: `/${segments.join("/")}`,
    });
}

/** Build a URI for a file (item in root or linked prim) */
export function itemUri(
    root_id: string,
    prim_id: string,
    item_id: string,
): vscode.Uri {
    return scriptUri(
        root_id,
        prim_id === root_id ? null : prim_id,
        item_id,
    );
}

// ============================================
// Display Name Helpers
// ============================================

/** Map item subtype to the appropriate file extension for display */
function extensionForItem(item: ObjectInventoryItem): string {
    if (item.type === "notecard") return ""; // no synthetic extension; user-supplied extension stays in the name
    return `.${languageForItem(item)}`;
}

/** Returns the display filename (name + synthetic extension) */
export function displayName(item: ObjectInventoryItem): string {
    return item.name + extensionForItem(item);
}

export function languageForItem(item: ObjectInventoryItem) : ScriptLanguage {
    if(item.type == "notecard") return "txt";
    return item.subtype === 1 ? "luau" : "lsl";
}

/**
 * Derive type and vm from a synthetic display extension.
 * Used when creating new items from a filename the user typed.
 */
function typeAndVmFromExtension(ext: string): { type: InventoryItemType; vm?: ScriptVM } {
    switch (ext.toLowerCase()) {
        case ".luau": return { type: "script", vm: "luau" };
        case ".lsl":  return { type: "script", vm: "lsl2" };
        default:      return { type: "notecard" };
    }
}

/**
 * Derive object.content.save vm from current script metadata.
 * Save API accepts: mono, lsl2, luau.
 */
function saveVmForItem(item: ObjectInventoryItem): ObjectContentSaveVM | undefined {
    if (item.type !== "script") {
        return undefined;
    }

    // Prefer explicit VM from metadata.
    if (item.vm === "luau") {
        return "luau";
    }

    if (item.vm === "lsl2") {
        return "lsl2";
    }

    if (item.vm === "mono") {
        return "mono";
    }

    // Compatibility fallback when VM metadata is absent.
    if (item.subtype === 1) {
        return "luau";
    }

    return "mono";
}

/** Strip the synthetic display extension to recover the raw SL inventory name */
function stripExtension(filename: string): { name: string; ext: string } {
    const dot = filename.lastIndexOf(".");
    if (dot === -1) return { name: filename, ext: "" };
    return { name: filename.slice(0, dot), ext: filename.slice(dot) };
}

// ============================================
// FileSystemProvider
// ============================================

export class ObjectContentProvider implements vscode.FileSystemProvider, vscode.Disposable {
    private _onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    readonly onDidChangeFile = this._onDidChangeFile.event;

    /** Maps object_id → (link_id → last-known dir segment name) for change notification lookup */
    private _linkedDirNames = new Map<string, Map<string, string>>();

    private disposables: vscode.Disposable[] = [];

    constructor(
        private readonly service: ObjectContentService,
        private readonly getClient: () => ViewerEditWSClient | undefined,
        private readonly addSaveDiagnostics: (
            rootId: string,
            primId: string,
            itemId: string,
            diagnostics: Diagnostic[],
        ) => void,
    ) {
        // Forward content invalidations to VS Code as Changed events
        this.disposables.push(
            service.onDidChangeContent(({ object_id, prim_id, item_id }) => {
                // Build the URI using the same display-name segment that readDirectory exposes,
                // so VS Code can match the notification to the correct open editor.
                let uri: vscode.Uri;
                if (prim_id === object_id) {
                    uri = itemUri(object_id, prim_id, item_id);
                } else {
                    const entry2 = service.getObject(object_id);
                    const allLinked = entry2?.object.linked_objects ?? [];
                    const lo = allLinked.find((l) => l.link_id === prim_id);
                    const linkSegment = lo ? linkedPrimDirName(lo, allLinked) : prim_id;
                    uri = vscode.Uri.from({
                        scheme: SL_SCHEME,
                        authority: SL_AUTHORITY,
                        path: `/${object_id}/${linkSegment}/${item_id}`,
                    });
                }
                // Defer to ensure VS Code processes even when not focused
                setTimeout(() => {
                    this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Changed, uri }]);
                }, 0);
            }),

            service.onDidChangeScriptVm(({ object_id, prim_id, item_id, vm }) => {
                void this._saveOnVmChange(object_id, prim_id, item_id, vm);
            }),

            // Forward tree changes (added/removed objects) as directory changes
            service.onDidChangeObjects((event) => {
                const { type, object_id } = event;
                const uri = rootUri(object_id);
                // Defer to ensure VS Code processes even when not focused
                setTimeout(() => {
                    if (type === "added") {
                        this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Created, uri }]);
                    } else if (type === "removed") {
                        this._linkedDirNames.delete(object_id);
                        this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Deleted, uri }]);
                    } else {
                        const { added_link_ids, removed_link_ids } = event;
                        const fileEvents: vscode.FileChangeEvent[] = [];

                        if (added_link_ids?.length || removed_link_ids?.length) {
                            // Structural change: fire Deleted for removed dirs (using cached
                            // names) and Created for added dirs.
                            const nameMap = this._linkedDirNames.get(object_id) ?? new Map<string, string>();
                            if (!this._linkedDirNames.has(object_id)) {
                                this._linkedDirNames.set(object_id, nameMap);
                            }

                            for (const link_id of removed_link_ids ?? []) {
                                const segment = nameMap.get(link_id);
                                if (segment) {
                                    fileEvents.push({
                                        type: vscode.FileChangeType.Deleted,
                                        uri: vscode.Uri.from({
                                            scheme: SL_SCHEME,
                                            authority: SL_AUTHORITY,
                                            path: `/${object_id}/${segment}`,
                                        }),
                                    });
                                    nameMap.delete(link_id);
                                }
                            }

                            const entry = service.getObject(object_id);
                            const allLinked = entry?.object.linked_objects ?? [];
                            for (const link_id of added_link_ids ?? []) {
                                const lo = allLinked.find((l) => l.link_id === link_id);
                                if (lo) {
                                    const segment = linkedPrimDirName(lo, allLinked);
                                    nameMap.set(link_id, segment);
                                    fileEvents.push({
                                        type: vscode.FileChangeType.Created,
                                        uri: vscode.Uri.from({
                                            scheme: SL_SCHEME,
                                            authority: SL_AUTHORITY,
                                            path: `/${object_id}/${segment}`,
                                        }),
                                    });
                                }
                            }

                            // Changed on root so VS Code re-calls readDirectory
                            fileEvents.push({ type: vscode.FileChangeType.Changed, uri });
                        } else {
                            // Non-structural update — refresh root and all current child dirs
                            fileEvents.push({ type: vscode.FileChangeType.Changed, uri });
                            const entry = service.getObject(object_id);
                            if (entry?.object.linked_objects?.length) {
                                const allLinked = entry.object.linked_objects;
                                for (const lo of allLinked) {
                                    fileEvents.push({
                                        type: vscode.FileChangeType.Changed,
                                        uri: vscode.Uri.from({
                                            scheme: SL_SCHEME,
                                            authority: SL_AUTHORITY,
                                            path: `/${object_id}/${linkedPrimDirName(lo, allLinked)}`,
                                        }),
                                    });
                                }
                            }
                        }

                        this._onDidChangeFile.fire(fileEvents);
                    }
                }, 0);
            }),

            this._onDidChangeFile,
        );
    }

    private async _saveOnVmChange(object_id: string, prim_id: string, item_id: string, vm: string): Promise<void> {
        const client = this.getClient();
        if (!client) { return; }
        try {
            let content: string;
            const cached = this.service.getCachedContent(object_id, item_id);
            if (cached) {
                content = Buffer.from(cached.content).toString("utf-8");
            } else {
                const fetched = await client.getObjectContent({ prim_id, item_id });
                if (!fetched.success) { return; }
                content = fetched.encoding === "base64"
                    ? Buffer.from(fetched.content, "base64").toString("utf-8")
                    : fetched.content;
            }
            const item = this.service.getItem(object_id, prim_id, item_id);
            await client.saveObjectContent({
                prim_id,
                item_id,
                content,
                vm: vm as ObjectContentSaveVM,
                running: item?.running,
            });
        } catch {
            // Viewer will report save/compile errors
        }
    }

    dispose(): void {
        for (const d of this.disposables) d.dispose();
        this.disposables = [];
    }

    // ============================================
    // FileSystemProvider — required methods
    // ============================================

    watch(_uri: vscode.Uri): vscode.Disposable {
        // Change notifications are pushed from the service; no polling needed.
        return new vscode.Disposable(() => { });
    }

    stat(uri: vscode.Uri): vscode.FileStat {
        const parsed = parseUri(uri, this.service);

        // /+create/ URI — return writable placeholder unconditionally
        if (parsed.isCreate) {
            return {
                type: vscode.FileType.File,
                ctime: 0,
                mtime: 0,
                size: 0,
                // No Readonly permission — file is writable
            };
        }

        if (parsed.isDirectory) {
            return {
                type: vscode.FileType.Directory,
                ctime: 0,
                mtime: 0,
                size: 0,
            };
        }

        const { root_id, link_id, item_id } = parsed;
        const prim_id = link_id ?? root_id;
        const item = this.service.getItem(root_id, prim_id, item_id!);
        if (!item) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }

        const cached = this.service.getCachedContent(root_id, item_id!);
        const canModify = (item.permissions?.owner ?? PERM_MODIFY) & PERM_MODIFY;

        return {
            type: vscode.FileType.File,
            ctime: this.service.getObject(root_id)?.publishedAt ?? 0,
            mtime: cached?.mtime ?? 0,
            size: cached?.content.byteLength ?? 0,
            permissions: canModify ? undefined : vscode.FilePermission.Readonly,
        };
    }

    readDirectory(uri: vscode.Uri): [string, vscode.FileType][] {
        const parsed = parseUri(uri, this.service);
        if (!parsed.isDirectory) {
            throw vscode.FileSystemError.FileNotADirectory(uri);
        }

        const { root_id, link_id } = parsed;
        const entry = this.service.getObject(root_id);
        if (!entry) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }

        const results: [string, vscode.FileType][] = [];

        if (link_id) {
            // Listing a child prim directory
            const lo = this.service.getLinkedObject(root_id, link_id);
            if (!lo) {
                throw vscode.FileSystemError.FileNotFound(uri);
            }
            for (const item of lo.inventory) {
                results.push([displayName(item), vscode.FileType.File]);
            }
        } else {
            // Listing the root prim directory
            for (const item of entry.object.inventory) {
                results.push([displayName(item), vscode.FileType.File]);
            }
            const allLinked = entry.object.linked_objects ?? [];
            // Cache dir names so the change-notification handler can fire Deleted
            // events with the correct URI even after the entry has been updated.
            let nameMap = this._linkedDirNames.get(root_id);
            if (!nameMap) {
                nameMap = new Map();
                this._linkedDirNames.set(root_id, nameMap);
            }
            for (const lo of allLinked) {
                // Use a human-readable display name; disambiguate duplicates with link_number.
                const segment = linkedPrimDirName(lo, allLinked);
                nameMap.set(lo.link_id, segment);
                results.push([segment, vscode.FileType.Directory]);
            }
        }

        return results;
    }

    async readFile(uri: vscode.Uri): Promise<Uint8Array> {
        const parsed = parseUri(uri, this.service);

        // /+create/ URI — return empty content (file doesn't exist yet)
        if (parsed.isCreate) {
            return Buffer.from("", "utf-8");
        }

        if (parsed.isDirectory) {
            throw vscode.FileSystemError.FileIsADirectory(uri);
        }

        const { root_id, link_id, item_id } = parsed;
        const prim_id = link_id ?? root_id;

        // Return cached content if available
        const cached = this.service.getCachedContent(root_id, item_id!);
        if (cached) {
            return cached.content;
        }

        // Fetch from viewer
        const client = this.getClient();
        if (!client) throw vscode.FileSystemError.Unavailable("Not connected to viewer");

        try {
            const response = await client.getObjectContent({ prim_id, item_id: item_id! });
            const text = response.content ?? "";
            const bytes = Buffer.from(text, "utf-8");
            this.service.cacheContent(root_id, item_id!, bytes);
            return bytes;
        } catch (error) {
            throw mapRpcErrorToFileSystemError(error, uri);
        }
    }

    async writeFile(
        uri: vscode.Uri,
        content: Uint8Array,
        options: { create: boolean; overwrite: boolean },
    ): Promise<void> {
        const parsed = parseUri(uri, this.service, { allowMissingLeaf: options.create });
        if (parsed.isDirectory) {
            throw vscode.FileSystemError.FileIsADirectory(uri);
        }

        // /+create/ URI — explicit creation path
        if (parsed.isCreate) {
            await this.handleCreate(uri, parsed, content);
            return;
        }

        const { root_id, link_id } = parsed;
        const prim_id = link_id ?? root_id;

        // Permission check (only meaningful for existing items)
        const entry = this.service.getObject(root_id);
        if (!entry) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }

        if (parsed.item_id) {
            // item_id known — existing item
            const item = this.service.getItem(root_id, prim_id, parsed.item_id);
            if (item) {
                const canModify = (item.permissions?.owner ?? PERM_MODIFY) & PERM_MODIFY;
                if (!canModify) {
                    throw vscode.FileSystemError.NoPermissions(uri);
                }

                const text = Buffer.from(content).toString("utf-8");
                const client = this.getClient();
                if (!client) throw vscode.FileSystemError.Unavailable("Not connected to viewer");

                try {
                    const vm = saveVmForItem(item);
                    const result = await client.saveObjectContent({
                        prim_id,
                        item_id: parsed.item_id,
                        content: text,
                        vm,
                        running: item.type === "script" ? item.running : undefined,
                    });

                    if (!result.success) {
                        throw vscode.FileSystemError.Unavailable(
                            result.message ?? "Save failed"
                        );
                    }

                    if (result.compiled === false) {
                        const diagnostics = result.diagnostics ?? [];
                        this.addSaveDiagnostics(
                            root_id,
                            prim_id,
                            parsed.item_id,
                            diagnostics,
                        );

                        const details = diagnostics
                            .slice(0, 5)
                            .map((diagnostic: Diagnostic) => diagnostic.message)
                            .join("\n");
                        const formattedDetails = details.length > 0
                            ? `\n${details}`
                            : "";
                        void vscode.window.showWarningMessage(
                            `Second Life: Saved, but compilation failed.${formattedDetails}`
                        );
                    }

                    this.service.cacheContent(root_id, parsed.item_id, content);
                    this.service.markContentSaved(root_id, parsed.item_id);
                    this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Changed, uri }]);
                    return;
                } catch (error) {
                    if (error instanceof vscode.FileSystemError) {
                        throw error;
                    }
                    throw mapRpcErrorToFileSystemError(error, uri);
                }
            }
        }

        // No existing item — fallback create path (for non-/+create/ URIs)
        if (!options.create) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }

        // Redirect to handleCreate with synthesized ParsedObjectUri
        await this.handleCreate(uri, parsed, content);
    }

    /**
     * Handle item creation for /+create/ URIs or fallback create requests.
     */
    private async handleCreate(
        uri: vscode.Uri,
        parsed: ParsedObjectUri,
        content: Uint8Array,
    ): Promise<void> {
        const { root_id, link_id, pending_name } = parsed;
        const prim_id = link_id ?? root_id;

        const entry = this.service.getObject(root_id);
        if (!entry) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }

        const filename = pending_name
            ?? uri.path.replace(/^\//, "").split("/").slice(-1)[0];
        const { name, ext } = stripExtension(filename);
        const { type, vm } = typeAndVmFromExtension(ext);
        // Scripts use a synthetic extension — strip it and let extensionForItem add it back.
        // Notecards have no synthetic extension, so keep the full filename as the SL item name.
        const itemName = type === "notecard" ? filename : name;

        const client = this.getClient();
        if (!client) throw vscode.FileSystemError.Unavailable("Not connected to viewer");

        try {
            const createCallParams: ObjectItemCreateParams = { prim_id, name: itemName, type };
            if (vm) {
                createCallParams.vm = vm;
            }
            if (type === "notecard" && content.length > 0) {
                createCallParams.text = Buffer.from(content).toString("utf-8");
            }

            const result = await client.createObjectItem(createCallParams);

            if (!result.item_id) {
                throw vscode.FileSystemError.Unavailable("Create failed: missing item_id");
            }

            // Fetch the created item's content. For scripts, the server generates
            // a template. There's a race between handleObjectItemCreate returning
            // and the inventory being fully visible, so retry with delay if needed.
            let fetchedContent: string | undefined;
            for (let attempt = 0; attempt < 3; attempt++) {
                try {
                    const response = await client.getObjectContent({ prim_id, item_id: result.item_id });
                    fetchedContent = response.content ?? "";
                    break;
                } catch (fetchError) {
                    // If item not found yet, wait and retry
                    if (attempt < 2) {
                        await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
                    } else {
                        throw fetchError;
                    }
                }
            }

            // Cache the content from the server
            this.service.cacheContent(root_id, result.item_id, Buffer.from(fetchedContent ?? "", "utf-8"));

            // Build the canonical URI for the created item
            const correctName = displayName(result);
            // Remove /+create/ segment if present, then build correct path
            let parentPath: string;
            if (parsed.isCreate) {
                // URI was: /{root_id}/+create/{name} or /{root_id}/{link_id}/+create/{name}
                parentPath = link_id ? `/${root_id}/${link_id}` : `/${root_id}`;
            } else {
                parentPath = uri.path.substring(0, uri.path.lastIndexOf("/"));
            }
            const correctUri = uri.with({ path: `${parentPath}/${correctName}` });

            // Fire events: delete the create URI, create the real URI
            const fileEvents: vscode.FileChangeEvent[] = [
                { type: vscode.FileChangeType.Deleted, uri },
                { type: vscode.FileChangeType.Created, uri: correctUri },
            ];
            this._onDidChangeFile.fire(fileEvents);
        } catch (error) {
            if (error instanceof vscode.FileSystemError) {
                throw error;
            }
            throw mapRpcErrorToFileSystemError(error, uri);
        }
    }

    async delete(uri: vscode.Uri, _options: { recursive: boolean }): Promise<void> {
        const parsed = parseUri(uri, this.service);
        if (parsed.isDirectory) {
            throw vscode.FileSystemError.NoPermissions(uri);
        }

        const { root_id, link_id, item_id } = parsed;
        const prim_id = link_id ?? root_id;

        const item = this.service.getItem(root_id, prim_id, item_id!);
        if (!item) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }

        const canModify = (item.permissions?.owner ?? PERM_MODIFY) & PERM_MODIFY;
        if (!canModify) {
            throw vscode.FileSystemError.NoPermissions(uri);
        }

        const client = this.getClient();
        if (!client) throw vscode.FileSystemError.Unavailable("Not connected to viewer");

        try {
            const result = await client.deleteObjectItem({ prim_id, item_id: item_id! });
            if (!result.success) {
                throw vscode.FileSystemError.Unavailable("Delete failed");
            }
        } catch (error) {
            if (error instanceof vscode.FileSystemError) {
                throw error;
            }
            throw mapRpcErrorToFileSystemError(error, uri);
        }
    }

    // Creating directories (linked prims) and renaming are not supported
    createDirectory(_uri: vscode.Uri): void {
        throw vscode.FileSystemError.NoPermissions(_uri);
    }

    rename(_oldUri: vscode.Uri, _newUri: vscode.Uri): void {
        throw vscode.FileSystemError.NoPermissions(_oldUri);
    }
}
