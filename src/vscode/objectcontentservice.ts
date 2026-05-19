/**
 * @file objectcontentservice.ts
 * Singleton service managing published in-world object content.
 * Copyright (C) 2025, Linden Research, Inc.
 */
import * as vscode from "vscode";
import {
    ObjectInventoryItem,
    LinkedObject,
    ObjectEntry,
    CachedItemContent,
    ObjectPublishMessage,
    ObjectUnpublishMessage,
    ObjectUpdateMessage,
    InventoryChanges,
} from "./objectcontentinterfaces";

// ============================================
// Event Types
// ============================================

/** Fired when objects are added, removed, or have metadata/inventory changes */
export interface ObjectTreeChangeEvent {
    type: "added" | "removed" | "updated";
    object_id: string;
}

/** Fired when cached content for a specific item is invalidated or needs refresh */
export interface ObjectContentChangeEvent {
    object_id: string;
    prim_id: string;
    item_id: string;
}

// ============================================
// Service
// ============================================

export class ObjectContentService implements vscode.Disposable {
    private static instance: ObjectContentService | undefined;

    private objects: Map<string, ObjectEntry> = new Map();

    private _onDidChangeObjects = new vscode.EventEmitter<ObjectTreeChangeEvent>();
    readonly onDidChangeObjects = this._onDidChangeObjects.event;

    private _onDidChangeContent = new vscode.EventEmitter<ObjectContentChangeEvent>();
    readonly onDidChangeContent = this._onDidChangeContent.event;

    private disposables: vscode.Disposable[] = [];

    private constructor() {
        this.disposables.push(this._onDidChangeObjects, this._onDidChangeContent);
    }

    static getInstance(): ObjectContentService {
        if (!ObjectContentService.instance) {
            ObjectContentService.instance = new ObjectContentService();
        }
        return ObjectContentService.instance;
    }

    dispose(): void {
        for (const d of this.disposables) {
            d.dispose();
        }
        this.disposables = [];
        if (ObjectContentService.instance === this) {
            ObjectContentService.instance = undefined;
        }
    }

    // ============================================
    // Message Handlers (Viewer → Extension)
    // ============================================

    handlePublish(msg: ObjectPublishMessage): void {
        const entry: ObjectEntry = {
            object: msg.object,
            contentCache: new Map(),
            publishedAt: Date.now(),
        };
        this.objects.set(msg.object.object_id, entry);
        this._onDidChangeObjects.fire({ type: "added", object_id: msg.object.object_id });
    }

    handleUnpublish(msg: ObjectUnpublishMessage): void {
        if (this.objects.delete(msg.object_id)) {
            this._onDidChangeObjects.fire({ type: "removed", object_id: msg.object_id });
        }
    }

    handleUpdate(msg: ObjectUpdateMessage): void {
        const entry = this.objects.get(msg.object_id);
        if (!entry) {
            return;
        }

        if (msg.object_name !== undefined) {
            entry.object.object_name = msg.object_name;
        }

        if (msg.changes) {
            // Delta update
            if (msg.changes.inventory) {
                this._applyInventoryChanges(
                    entry,
                    msg.object_id,
                    msg.object_id,
                    entry.object.inventory,
                    msg.changes.inventory
                );
            }
            if (msg.changes.linked_objects) {
                const lc = msg.changes.linked_objects;
                if (lc.added) {
                    entry.object.linked_objects = [
                        ...(entry.object.linked_objects ?? []),
                        ...lc.added,
                    ];
                }
                if (lc.removed) {
                    const removedSet = new Set(lc.removed);
                    entry.object.linked_objects = (entry.object.linked_objects ?? []).filter(
                        (lo) => !removedSet.has(lo.link_id)
                    );
                    // Evict cached content for removed linked prims
                    for (const link_id of lc.removed) {
                        this._evictPrimCache(entry, msg.object_id, link_id);
                    }
                }
                if (lc.modified) {
                    for (const mod of lc.modified) {
                        const lo = (entry.object.linked_objects ?? []).find(
                            (l) => l.link_id === mod.link_id
                        );
                        if (!lo) continue;
                        if (mod.link_name !== undefined) {
                            lo.link_name = mod.link_name;
                        }
                        if (mod.inventory) {
                            this._applyInventoryChanges(
                                entry,
                                msg.object_id,
                                mod.link_id,
                                lo.inventory,
                                mod.inventory
                            );
                        }
                    }
                }
            }
        } else {
            // Full replacement
            if (msg.inventory !== undefined) {
                entry.object.inventory = msg.inventory;
                // Evict root prim content cache entirely
                this._evictPrimCache(entry, msg.object_id, msg.object_id);
            }
            if (msg.linked_objects !== undefined) {
                // Evict cache for all replaced linked prims
                for (const lo of entry.object.linked_objects ?? []) {
                    this._evictPrimCache(entry, msg.object_id, lo.link_id);
                }
                entry.object.linked_objects = msg.linked_objects;
            }
        }

        this._onDidChangeObjects.fire({ type: "updated", object_id: msg.object_id });
    }

    // ============================================
    // Tree Queries
    // ============================================

    getObjects(): readonly ObjectEntry[] {
        return Array.from(this.objects.values());
    }

    getObject(object_id: string): ObjectEntry | undefined {
        return this.objects.get(object_id);
    }

    hasObject(object_id: string): boolean {
        return this.objects.has(object_id);
    }

    /**
     * Returns inventory for any prim in the linkset.
     * Pass prim_id === object_id for root prim, or a link_id for a child prim.
     */
    getInventory(object_id: string, prim_id: string): ObjectInventoryItem[] | undefined {
        const entry = this.objects.get(object_id);
        if (!entry) return undefined;
        if (prim_id === object_id) {
            return entry.object.inventory;
        }
        return entry.object.linked_objects?.find((lo) => lo.link_id === prim_id)?.inventory;
    }

    getItem(object_id: string, prim_id: string, item_id: string): ObjectInventoryItem | undefined {
        return this.getInventory(object_id, prim_id)?.find((i) => i.item_id === item_id);
    }

    getLinkedObject(object_id: string, link_id: string): LinkedObject | undefined {
        return this.objects.get(object_id)?.object.linked_objects?.find(
            (lo) => lo.link_id === link_id
        );
    }

    // ============================================
    // Content Cache
    // ============================================

    getCachedContent(object_id: string, item_id: string): CachedItemContent | undefined {
        return this.objects.get(object_id)?.contentCache.get(item_id);
    }

    cacheContent(object_id: string, item_id: string, content: Uint8Array): void {
        const entry = this.objects.get(object_id);
        if (!entry) return;
        const existing = entry.contentCache.get(item_id);
        entry.contentCache.set(item_id, {
            content,
            mtime: Date.now(),
            dirty: existing?.dirty ?? false,
        });
    }

    markContentDirty(object_id: string, item_id: string): void {
        const cached = this.objects.get(object_id)?.contentCache.get(item_id);
        if (cached) {
            cached.dirty = true;
        }
    }

    markContentSaved(object_id: string, item_id: string): void {
        const cached = this.objects.get(object_id)?.contentCache.get(item_id);
        if (cached) {
            cached.dirty = false;
        }
    }

    isContentDirty(object_id: string, item_id: string): boolean {
        return this.objects.get(object_id)?.contentCache.get(item_id)?.dirty ?? false;
    }

    // ============================================
    // Lifecycle
    // ============================================

    /** Remove all published objects (e.g. on viewer disconnect). */
    clear(): void {
        const ids = Array.from(this.objects.keys());
        this.objects.clear();
        for (const object_id of ids) {
            this._onDidChangeObjects.fire({ type: "removed", object_id });
        }
    }

    // ============================================
    // Private Helpers
    // ============================================

    /**
     * Apply delta inventory changes to an item list.
     * Fires onDidChangeContent for any content_changed or removed items.
     */
    private _applyInventoryChanges(
        entry: ObjectEntry,
        object_id: string,
        prim_id: string,
        inventory: ObjectInventoryItem[],
        changes: InventoryChanges
    ): void {
        if (changes.added) {
            inventory.push(...changes.added);
        }
        if (changes.removed) {
            const removedSet = new Set(changes.removed);
            for (let i = inventory.length - 1; i >= 0; i--) {
                if (removedSet.has(inventory[i].item_id)) {
                    inventory.splice(i, 1);
                }
            }
            for (const item_id of changes.removed) {
                entry.contentCache.delete(item_id);
                this._onDidChangeContent.fire({ object_id, prim_id, item_id });
            }
        }
        if (changes.modified) {
            for (const mod of changes.modified) {
                const idx = inventory.findIndex((i) => i.item_id === mod.item_id);
                if (idx !== -1) {
                    inventory[idx] = mod;
                }
            }
        }
        if (changes.content_changed) {
            for (const item_id of changes.content_changed) {
                entry.contentCache.delete(item_id);
                this._onDidChangeContent.fire({ object_id, prim_id, item_id });
            }
        }
        if (changes.running_changed) {
            for (const rc of changes.running_changed) {
                const item = inventory.find((i) => i.item_id === rc.item_id);
                if (item) {
                    item.running = rc.running;
                }
            }
        }
    }

    /**
     * Evict all cached content belonging to a specific prim from the entry's cache.
     * Used when inventory is fully replaced or a linked prim is removed.
     * Fires onDidChangeContent for each evicted item.
     */
    private _evictPrimCache(entry: ObjectEntry, object_id: string, prim_id: string): void {
        const inventory =
            prim_id === object_id
                ? entry.object.inventory
                : entry.object.linked_objects?.find((lo) => lo.link_id === prim_id)?.inventory ?? [];

        for (const item of inventory) {
            if (entry.contentCache.delete(item.item_id)) {
                this._onDidChangeContent.fire({ object_id, prim_id, item_id: item.item_id });
            }
        }
    }
}
