/**
 * @file ObjectContentDecorator.ts
 * File decoration provider for sl:// virtual filesystem entries.
 * Shows visual indicators for connection state, script running state, etc.
 * Copyright (C) 2025, Linden Research, Inc.
 */
import {
    FileDecorationProvider,
    Uri,
    FileDecoration,
    EventEmitter,
    ProviderResult,
    CancellationToken,
    ThemeColor,
    Disposable,
} from "vscode";
import { SL_SCHEME } from "./objectcontentprovider";
import { ObjectContentService } from "./objectcontentservice";
import { logDebug } from "../utils";

/**
 * Provides file decorations for sl:// URIs based on connection state and script running state.
 * When disconnected from the viewer, shows a red badge and tooltip.
 * For scripts, shows running/stopped state indicators.
 */
export class ObjectContentDecorator implements FileDecorationProvider, Disposable {
    private _onDidChangeFileDecorations = new EventEmitter<Uri | Uri[] | undefined>();
    readonly onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;

    private isConnected: boolean = false;
    private disposables: Disposable[] = [];

    constructor(
        private readonly getConnectionState: () => boolean,
        onConnectionChange: (listener: (connected: boolean) => void) => Disposable,
        private readonly contentService: ObjectContentService,
    ) {
        this.isConnected = getConnectionState();
        logDebug(`[ObjectContentDecorator] Initial connection state: ${this.isConnected}`);

        // Listen for connection state changes
        const connectionSub = onConnectionChange((connected) => {
            logDebug(`[ObjectContentDecorator] Connection state changed: ${connected}`);
            this.isConnected = connected;
            // Refresh all sl:// decorations (deferred to ensure processing when not focused)
            setTimeout(() => {
                this._onDidChangeFileDecorations.fire(undefined);
            }, 0);
        });

        // Listen for script running state changes
        const runningSub = contentService.onDidChangeRunningState((event) => {
            logDebug(`[ObjectContentDecorator] Script running state changed: ${event.item_id} -> ${event.running}`);
            // Fire undefined to refresh all decorations (simpler than reconstructing the exact URI)
            this._onDidChangeFileDecorations.fire(undefined);
        });

        this.disposables.push(
            connectionSub,
            runningSub,
            this._onDidChangeFileDecorations,
        );
    }

    dispose(): void {
        for (const d of this.disposables) {
            d.dispose();
        }
        this.disposables = [];
    }

    provideFileDecoration(uri: Uri, _token: CancellationToken): ProviderResult<FileDecoration> {
        // Only decorate sl:// URIs
        if (uri.scheme !== SL_SCHEME) {
            return undefined;
        }

        // When disconnected, show red badge with warning
        if (!this.isConnected) {
            return {
                badge: "⚠",
                tooltip: "Not connected to Second Life viewer",
                color: new ThemeColor("errorForeground"),
            };
        }

        // Parse URI to check for script running state
        // URI format: sl://objects/{root_id}/{displayName} or sl://objects/{root_id}/{link_id}/{displayName}
        const parts = uri.path.replace(/^\//,"").split("/").filter(p => p.length > 0);
        if (parts.length < 2) {
            return undefined; // Directory, not a file
        }

        const root_id = parts[0];
        let prim_id: string;
        let filename: string;

        if (parts.length === 2) {
            // Could be file in root or linked prim directory - check if it's a linked prim
            const linkedPrim = this.contentService.getLinkedObject(root_id, parts[1]);
            if (linkedPrim) {
                return undefined; // It's a linked prim directory, not a file
            }
            prim_id = root_id;
            filename = decodeURIComponent(parts[1]);
        } else {
            // File in linked prim
            prim_id = parts[1];
            filename = decodeURIComponent(parts[2]);
        }

        const item = this.contentService.getItemByDisplayName(root_id, prim_id, filename);
        if (!item || item.type !== "script") {
            return undefined; // Not a script, no decoration
        }

        // Return decoration based on running state
        if (item.running) {
            return {
                badge: "▶",
                tooltip: "Script is running",
                color: new ThemeColor("charts.green"),
            };
        } else {
            return {
                badge: "⏹",
                tooltip: "Script is stopped",
                color: new ThemeColor("charts.red"),
            };
        }
    }

    /**
     * Manually trigger a refresh of decorations for specific URIs or all sl:// URIs.
     */
    public refresh(uri?: Uri | Uri[]): void {
        this._onDidChangeFileDecorations.fire(uri);
    }
}
