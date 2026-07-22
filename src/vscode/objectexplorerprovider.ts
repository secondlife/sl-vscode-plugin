/**
 * @file objectexplorerprovider.ts
 * TreeDataProvider for the "Second Life (Inworld)" Explorer accordion.
 * Displays published in-world objects and their script/notecard inventory.
 * Copyright (C) 2025, Linden Research, Inc.
 */
import * as vscode from "vscode";
import * as path from "path";
import { ObjectContentService } from "./objectcontentservice";
import { ObjectInventoryItem, LinkedObject, ObjectEntry, ItemPermissions } from "./objectcontentinterfaces";
import { displayName, itemUri } from "./objectcontentprovider";

// Permission bit flags from LLPermissions
const PERM_MODIFY = 0x4000;
const PERM_COPY = 0x8000;
const PERM_TRANSFER = 0x2000;

/**
 * Generate permission indicator icons for restricted permissions.
 * Shows icons only for permissions that are NOT granted.
 * @param permissions Item permission masks
 * @returns String with codicons for restricted permissions, or undefined if all permissions granted
 */
function getPermissionIcons(permissions: ItemPermissions | undefined): string | undefined {
    if (!permissions) return undefined;

    const icons: string[] = [];
    if ((permissions.owner & PERM_MODIFY) === 0) {
        icons.push("$(lock)");  // No-modify
    }
    if ((permissions.owner & PERM_COPY) === 0) {
        icons.push("$(circle-slash)");  // No-copy
    }
    if ((permissions.owner & PERM_TRANSFER) === 0) {
        icons.push("$(person)");  // No-transfer
    }

    return icons.length > 0 ? icons.join(" ") : undefined;
}

// ============================================
// Node Types
// ============================================

interface ObjectNode {
    kind: "object";
    object_id: string;
    label: string;
    region?: string;
}

interface LinkedPrimNode {
    kind: "linkedPrim";
    object_id: string;
    link_id: string;
    label: string;
}

interface InventoryNode {
    kind: "item";
    object_id: string;
    prim_id: string;
    item: ObjectInventoryItem;
    uri: vscode.Uri;
}

export type ExplorerNode = ObjectNode | LinkedPrimNode | InventoryNode;

// ============================================
// Provider
// ============================================

export class ObjectExplorerProvider implements vscode.TreeDataProvider<ExplorerNode>, vscode.Disposable
{
    private _onDidChangeTreeData = new vscode.EventEmitter<ExplorerNode | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private disposables: vscode.Disposable[] = [];
    private service: ObjectContentService;

    constructor(
        private readonly extensionPath: string,
        private readonly isConnected: () => boolean,
        onConnectionChange: vscode.Event<boolean>
    ) {
        this.service = ObjectContentService.getInstance();
        this.disposables.push(this._onDidChangeTreeData);

        // Refresh tree on any object change
        this.disposables.push(
            this.service.onDidChangeObjects(() => {
                this._onDidChangeTreeData.fire(undefined);
                this.updateContextKey();
            })
        );

        // Refresh tree on connection state change
        this.disposables.push(
            onConnectionChange(() => {
                this._onDidChangeTreeData.fire(undefined);
            })
        );

        // Refresh tree on script running state change
        this.disposables.push(
            this.service.onDidChangeRunningState(() => {
                this._onDidChangeTreeData.fire(undefined);
            })
        );

        // Set initial context key
        this.updateContextKey();
    }

    dispose(): void {
        for (const d of this.disposables) {
            d.dispose();
        }
        this.disposables = [];
    }

    private updateContextKey(): void {
        const hasObjects = this.service.getObjects().length > 0;
        vscode.commands.executeCommand("setContext", "slVscodeEdit:hasPublishedObjects", hasObjects);
    }

    // ============================================
    // TreeDataProvider Implementation
    // ============================================

    getTreeItem(node: ExplorerNode): vscode.TreeItem {
        switch (node.kind) {
            case "object": {
                const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Collapsed);
                item.description = node.region;
                item.contextValue = "slObject";
                // Use multi icon if object has linked prims with inventory, single icon otherwise
                const entry = this.service.getObject(node.object_id);
                const hasLinkedPrims = entry?.object.linked_objects?.some(lo => lo.inventory && lo.inventory.length > 0) ?? false;
                item.iconPath = vscode.Uri.file(path.join(
                    this.extensionPath,
                    "icons",
                    hasLinkedPrims ? "Inv_Object_Multi.png" : "Inv_Object.png"
                ));
                return item;
            }
            case "linkedPrim": {
                const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Collapsed);
                item.contextValue = "slLinkedPrim";
                item.iconPath = vscode.Uri.file(path.join(this.extensionPath, "icons", "Inv_Object.png"));
                return item;
            }
            case "item": {
                const label = displayName(node.item);
                const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
                // Determine modify permission for contextValue
                const canModify = !node.item.permissions || (node.item.permissions.owner & PERM_MODIFY) !== 0;
                const noModSuffix = canModify ? "" : "NoMod";
                if (node.item.type === "script") {
                    item.contextValue = (node.item.running ? "scriptRunning" : "scriptStopped") + noModSuffix;
                } else {
                    item.contextValue = "inventoryItem" + noModSuffix;
                }
                // Show permission restriction icons in description
                item.description = getPermissionIcons(node.item.permissions);
                // Allow opening: notecards always, scripts only if modifiable
                if (node.item.type !== "script" || canModify) {
                    item.command = {
                        command: "slVscodeEdit.openInventoryItem",
                        title: "Open",
                        arguments: [node.uri],
                    };
                }
                // Icon based on item type
                if (node.item.type === "notecard") {
                    item.iconPath = vscode.Uri.file(path.join(this.extensionPath, "icons", "Inv_Notecard.png"));
                } else if (node.item.subtype === 1) {
                    // Luau script
                    item.iconPath = vscode.Uri.file(path.join(this.extensionPath, "icons", "Inv_Script_Luau.png"));
                } else {
                    // LSL script
                    item.iconPath = vscode.Uri.file(path.join(this.extensionPath, "icons", "Inv_Script.png"));
                }
                // Enable FileDecorationProvider for running state badges
                item.resourceUri = node.uri;
                return item;
            }
        }
    }

    getChildren(node?: ExplorerNode): ExplorerNode[] {
        if (!node) {
            // Return empty when disconnected
            if (!this.isConnected()) {
                return [];
            }
            // Root: return one ObjectNode per published object
            return this.service.getObjects().map((entry) => this.makeObjectNode(entry));
        }

        switch (node.kind) {
            case "object":
                return this.getObjectChildren(node);
            case "linkedPrim":
                return this.getLinkedPrimChildren(node);
            case "item":
                return []; // Leaf node
        }
    }

    getParent(node: ExplorerNode): ExplorerNode | undefined {
        switch (node.kind) {
            case "object":
                return undefined; // Root level
            case "linkedPrim": {
                // Parent is the object
                const entry = this.service.getObject(node.object_id);
                if (entry) {
                    return this.makeObjectNode(entry);
                }
                return undefined;
            }
            case "item": {
                // Parent is either the object (if prim_id === object_id) or a linked prim
                if (node.prim_id === node.object_id) {
                    const entry = this.service.getObject(node.object_id);
                    if (entry) {
                        return this.makeObjectNode(entry);
                    }
                } else {
                    const lo = this.service.getLinkedObject(node.object_id, node.prim_id);
                    if (lo) {
                        return this.makeLinkedPrimNode(node.object_id, lo);
                    }
                }
                return undefined;
            }
        }
    }

    // ============================================
    // Node Builders
    // ============================================

    private makeObjectNode(entry: ObjectEntry): ObjectNode {
        return {
            kind: "object",
            object_id: entry.object.object_id,
            label: entry.object.object_name,
            region: entry.object.region,
        };
    }

    private makeLinkedPrimNode(object_id: string, lo: LinkedObject): LinkedPrimNode {
        return {
            kind: "linkedPrim",
            object_id,
            link_id: lo.link_id,
            label: `${lo.link_name || lo.link_id} (link #${lo.link_number})`,
        };
    }

    private makeInventoryNode(
        object_id: string,
        prim_id: string,
        item: ObjectInventoryItem
    ): InventoryNode {
        return {
            kind: "item",
            object_id,
            prim_id,
            item,
            uri: itemUri(object_id, prim_id, displayName(item)),
        };
    }

    // ============================================
    // Children Builders
    // ============================================

    private getObjectChildren(node: ObjectNode): ExplorerNode[] {
        const entry = this.service.getObject(node.object_id);
        if (!entry) return [];

        const children: ExplorerNode[] = [];

        // Linked prims first (that have inventory)
        for (const lo of entry.object.linked_objects ?? []) {
            if (lo.inventory && lo.inventory.length > 0) {
                children.push(this.makeLinkedPrimNode(node.object_id, lo));
            }
        }

        // Root prim inventory items, sorted by name
        const sortedInventory = [...(entry.object.inventory ?? [])].sort((a, b) =>
            displayName(a).localeCompare(displayName(b))
        );
        for (const item of sortedInventory) {
            children.push(this.makeInventoryNode(node.object_id, node.object_id, item));
        }

        return children;
    }

    private getLinkedPrimChildren(node: LinkedPrimNode): ExplorerNode[] {
        const lo = this.service.getLinkedObject(node.object_id, node.link_id);
        if (!lo) return [];

        // Sort inventory items by name
        const sortedInventory = [...(lo.inventory ?? [])].sort((a, b) =>
            displayName(a).localeCompare(displayName(b))
        );
        return sortedInventory.map((item) =>
            this.makeInventoryNode(node.object_id, node.link_id, item)
        );
    }
}
