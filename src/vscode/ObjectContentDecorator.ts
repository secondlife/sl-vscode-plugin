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
import { logDebug } from "../utils";

/**
 * Provides file decorations for sl:// URIs based on connection state.
 * When disconnected from the viewer, shows a red badge and tooltip.
 */
export class ObjectContentDecorator implements FileDecorationProvider, Disposable {
    private _onDidChangeFileDecorations = new EventEmitter<Uri | Uri[] | undefined>();
    readonly onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;

    private isConnected: boolean = false;
    private disposables: Disposable[] = [];

    constructor(
        private readonly getConnectionState: () => boolean,
        onConnectionChange: (listener: (connected: boolean) => void) => Disposable,
    ) {
        this.isConnected = getConnectionState();
        logDebug(`[ObjectContentDecorator] Initial connection state: ${this.isConnected}`);

        // Listen for connection state changes
        const subscription = onConnectionChange((connected) => {
            logDebug(`[ObjectContentDecorator] Connection state changed: ${connected}`);
            this.isConnected = connected;
            // Refresh all sl:// decorations (deferred to ensure processing when not focused)
            setTimeout(() => {
                this._onDidChangeFileDecorations.fire(undefined);
            }, 0);
        });
        this.disposables.push(
            subscription,
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

        // Connected state - no special decoration for now
        // Future: could show script running state, dirty state, etc.
        return undefined;
    }

    /**
     * Manually trigger a refresh of decorations for specific URIs or all sl:// URIs.
     */
    public refresh(uri?: Uri | Uri[]): void {
        this._onDidChangeFileDecorations.fire(uri);
    }
}
