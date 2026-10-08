import * as vscode from "vscode";
import { SynchService } from "../../../synchservice";
import { ScriptIdentity, ScriptSync, TrackedFileSnapshot } from "../../../scriptsync";
import { ObjectInventoryItem } from "#sl-ide-ws-client";
import { FileLinkIndex } from "../../../shared/filelinkindex";
import { canonicalFileUri } from "../../../shared/filelinkidentity";

/** The key SynchService's private `masterKey()` would compute for `uri`, for placing fakes into `activeSyncs`. */
export function masterKeyFor(uri: vscode.Uri): string
{
    return canonicalFileUri(uri.fsPath);
}

function identitiesMatch(a: ScriptIdentity, b: ScriptIdentity): boolean
{
    return a.rootId === b.rootId && a.primId === b.primId && a.itemId === b.itemId;
}

export interface FakeScriptSyncCalls
{
    dispose: number;
    unsubscribeByFile: string[];
    unsubscribeVirtualMappingByIdentity: ScriptIdentity[];
    unsubscribeById: string[];
    handleMasterSaved: number;
    updateVirtualItem: { uri: vscode.Uri; identity: ScriptIdentity; item: ObjectInventoryItem }[];
}

export interface FakeScriptSyncOptions
{
    masterUri: vscode.Uri;
    snapshots?: TrackedFileSnapshot[];
    /** Opaque ids tracked outside `TrackedFileSnapshot`, mirroring `ScriptSync`'s scriptId-based lookups. */
    scriptIds?: string[];
    hasFilesToTrack?: boolean;
}

export interface FakeScriptSync
{
    sync: ScriptSync;
    calls: FakeScriptSyncCalls;
}

/**
 * A minimal `ScriptSync` stand-in implementing only the methods the
 * relationship layer in `SynchService` calls. Snapshots are mutated as the
 * fake's unsubscribe methods are invoked, so `hasFilesToTrack()` reflects
 * detachment the same way the real class would.
 */
export function createFakeScriptSync(options: FakeScriptSyncOptions): FakeScriptSync
{
    let snapshots = options.snapshots ?? [];
    let scriptIds = options.scriptIds ?? [];
    let masterUri = options.masterUri;
    const calls: FakeScriptSyncCalls = {
        dispose: 0,
        unsubscribeByFile: [],
        unsubscribeVirtualMappingByIdentity: [],
        unsubscribeById: [],
        handleMasterSaved: 0,
        updateVirtualItem: [],
    };

    const fake = {
        getMasterUri: (): vscode.Uri => masterUri,
        getMasterDocument: (): vscode.TextDocument =>
            ({ uri: masterUri } as unknown as vscode.TextDocument),
        getMasterFilePath: (): string => masterUri.fsPath,
        renameMasterDocument: (document: vscode.TextDocument): void =>
        {
            masterUri = document.uri;
        },
        getTrackedFileSnapshots: (): TrackedFileSnapshot[] => snapshots,
        getTrackedVirtualItemsInObject: (
            object_id: string,
        ): ReturnType<ScriptSync["getTrackedVirtualItemsInObject"]> =>
            snapshots
                .filter((s) => s.kind === "virtual" && s.identity?.rootId === object_id)
                .map((s) => ({
                    kind: "virtual",
                    id: s.fileUri?.toString() ?? "",
                    uri: s.fileUri ?? options.masterUri,
                    identity: s.identity!,
                })) as ReturnType<ScriptSync["getTrackedVirtualItemsInObject"]>,
        isTrackingIdentity: (identity: ScriptIdentity): boolean =>
            snapshots.some((s) => s.kind === "virtual" && s.identity && identitiesMatch(s.identity, identity)),
        isTrackingFile: (filePath: string): boolean =>
            snapshots.some((s) => s.kind === "local" && s.fileUri?.fsPath === filePath),
        isTrackingId: (id: string): boolean => scriptIds.includes(id),
        hasFilesToTrack: (): boolean =>
            options.hasFilesToTrack ?? (snapshots.length > 0 || scriptIds.length > 0),
        subscribe: (id: string, viewerDocument: vscode.TextDocument): boolean =>
        {
            if (scriptIds.includes(id) || snapshots.some((s) => s.kind === "local" && s.fileUri?.fsPath === viewerDocument.uri.fsPath)) {
                return false;
            }
            scriptIds = [...scriptIds, id];
            snapshots = [...snapshots, { kind: "local", fileUri: viewerDocument.uri }];
            return true;
        },
        subscribeVirtual: (uri: vscode.Uri, _content: string | undefined, identity: ScriptIdentity): boolean =>
        {
            if (snapshots.some((s) => s.kind === "virtual" && s.identity && identitiesMatch(s.identity, identity))) {
                return false;
            }
            snapshots = [...snapshots, { kind: "virtual", identity, fileUri: uri }];
            return true;
        },
        unsubscribeByFile: (filePath: string): void =>
        {
            calls.unsubscribeByFile.push(filePath);
            snapshots = snapshots.filter((s) => !(s.kind === "local" && s.fileUri?.fsPath === filePath));
        },
        unsubscribeVirtualMappingByIdentity: (identity: ScriptIdentity): void =>
        {
            calls.unsubscribeVirtualMappingByIdentity.push(identity);
            snapshots = snapshots.filter((s) => !(s.kind === "virtual" && s.identity && identitiesMatch(s.identity, identity)));
        },
        unsubscribeById: (id: string): number =>
        {
            calls.unsubscribeById.push(id);
            const before = scriptIds.length;
            scriptIds = scriptIds.filter((existing) => existing !== id);
            return before - scriptIds.length;
        },
        renameTemporaryFile: async (oldUri: vscode.Uri, newUri: vscode.Uri): Promise<boolean> =>
        {
            const index = snapshots.findIndex((s) => s.kind === "local" && s.fileUri?.fsPath === oldUri.fsPath);
            if (index === -1) {
                return false;
            }
            snapshots = snapshots.map((s, i) => (i === index ? { ...s, fileUri: newUri } : s));
            return true;
        },
        dispose: (): void =>
        {
            calls.dispose++;
        },
        handleMasterSaved: async (): Promise<void> =>
        {
            calls.handleMasterSaved++;
        },
        updateVirtualItem: (uri: vscode.Uri, identity: ScriptIdentity, item: ObjectInventoryItem): void =>
        {
            calls.updateVirtualItem.push({ uri, identity, item });
        },
    };

    return { sync: fake as unknown as ScriptSync, calls };
}

export interface TestSynchService
{
    service: SynchService;
    activeSyncs: Map<string, ScriptSync>;
    fileLinkIndex: FileLinkIndex<ScriptSync>;
    refreshCalls: (vscode.Uri | vscode.Uri[] | undefined)[];
}

/**
 * A `SynchService` instance with its relationship state injected directly,
 * bypassing the private constructor and viewer connection. Real prototype
 * methods (detach, evict, index rebuild, `masterKey`, etc.) run unmodified
 * against this injected data.
 */
export function createTestSynchService(): TestSynchService
{
    const service = Object.create(SynchService.prototype) as SynchService;
    const activeSyncs = new Map<string, ScriptSync>();
    const fileLinkIndex = new FileLinkIndex<ScriptSync>();
    const refreshCalls: (vscode.Uri | vscode.Uri[] | undefined)[] = [];

    Object.assign(service, {
        activeSyncs,
        fileLinkIndex,
        fileLinkIndexDirty: true,
        endpointOperations: new Map<string, Promise<void>>(),
        stopping: false,
        syncedFileDecorator: {
            refresh: (uri?: vscode.Uri | vscode.Uri[]): void =>
            {
                refreshCalls.push(uri);
            },
        },
    });

    return { service, activeSyncs, fileLinkIndex, refreshCalls };
}
