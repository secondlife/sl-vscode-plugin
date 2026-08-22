/**
 * @file objectpinstore.ts
 * Workspace-local persistence for pinned in-world objects.
 * Copyright (C) 2025, Linden Research, Inc.
 */
import * as vscode from "vscode";
import { logDebug, logWarning } from "../utils";
import { rootUri, SL_AUTHORITY, SL_SCHEME } from "./objectcontentprovider";

const PIN_FILE_VERSION = 1;
const PIN_FILE_NAME = "sl-object-pins.json";
const PIN_DIR_NAME = ".vscode";
const PIN_SUBDIR_NAME = "sl-vscode-plugin";

export interface PinnedObjectRecord {
    uri: string;
    name: string;
}

interface PinFileV1 {
    version: number;
    pinned: PinnedObjectRecord[];
}

interface PinObjectArgs {
    objectId: string;
    name: string;
}

function isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function parseObjectIdFromPinnedUri(uriText: string): string | null {
    let parsed: vscode.Uri;
    try {
        parsed = vscode.Uri.parse(uriText);
    } catch {
        return null;
    }

    if (parsed.scheme !== SL_SCHEME) {
        return null;
    }
    if (parsed.authority !== SL_AUTHORITY) {
        return null;
    }

    const parts = parsed.path.replace(/^\/+/, "").split("/").filter((p) => p.length > 0);
    if (parts.length !== 1) {
        return null;
    }
    if (!isUuid(parts[0])) {
        return null;
    }
    return parts[0];
}

function makePinnedUri(objectId: string): string {
    return rootUri(objectId).toString();
}

function normalizePinnedEntries(entries: PinnedObjectRecord[]): PinnedObjectRecord[] {
    const byObjectId = new Map<string, PinnedObjectRecord>();

    for (const entry of entries) {
        const objectId = parseObjectIdFromPinnedUri(entry.uri);
        if (objectId === null) {
            continue;
        }
        const normalized: PinnedObjectRecord = {
            uri: makePinnedUri(objectId),
            name: (entry.name ?? "").trim(),
        };
        byObjectId.set(objectId, normalized);
    }

    const out = Array.from(byObjectId.values());
    out.sort((a, b) => {
        const nameCmp = a.name.localeCompare(b.name);
        if (nameCmp !== 0) {
            return nameCmp;
        }
        return a.uri.localeCompare(b.uri);
    });
    return out;
}

export class ObjectPinStore {
    private static instance: ObjectPinStore | undefined;

    public static getInstance(): ObjectPinStore {
        if (!ObjectPinStore.instance) {
            ObjectPinStore.instance = new ObjectPinStore();
        }
        return ObjectPinStore.instance;
    }

    private constructor() {}

    public async loadPins(): Promise<PinnedObjectRecord[]> {
        const pinFileUri = this.getPinFileUri();
        if (pinFileUri === null) {
            return [];
        }

        let raw: Uint8Array;
        try {
            raw = await vscode.workspace.fs.readFile(pinFileUri);
        } catch {
            return [];
        }

        let parsed: unknown;
        try {
            parsed = JSON.parse(Buffer.from(raw).toString("utf8"));
        } catch {
            logWarning("[ObjectPinStore] Pin file is malformed JSON; treating as empty.");
            return [];
        }

        const migrated = this.parsePinDocument(parsed);
        return normalizePinnedEntries(migrated);
    }

    public async savePins(entries: PinnedObjectRecord[]): Promise<void> {
        const pinFileUri = this.getPinFileUri();
        if (pinFileUri === null) {
            logDebug("[ObjectPinStore] No file-based workspace folder found; skipping pin save.");
            return;
        }

        const normalized = normalizePinnedEntries(entries);
        const body: PinFileV1 = {
            version: PIN_FILE_VERSION,
            pinned: normalized,
        };
        const serialized = JSON.stringify(body, null, 2) + "\n";

        const workspaceRoot = this.getWorkspaceRootUri();
        if (workspaceRoot === null) {
            logDebug("[ObjectPinStore] No file-based workspace folder found while saving pins.");
            return;
        }
        const pinDirUri = vscode.Uri.joinPath(workspaceRoot, PIN_DIR_NAME, PIN_SUBDIR_NAME);
        await vscode.workspace.fs.createDirectory(pinDirUri);
        await vscode.workspace.fs.writeFile(pinFileUri, Buffer.from(serialized, "utf8"));
    }

    public async pinObject(args: PinObjectArgs): Promise<PinnedObjectRecord[]> {
        const objectId = args.objectId.trim();
        if (!isUuid(objectId)) {
            logWarning(`[ObjectPinStore] Ignoring pin for invalid object id: ${args.objectId}`);
            return await this.loadPins();
        }

        const current = await this.loadPins();
        const withoutExisting = current.filter((e) => {
            const id = parseObjectIdFromPinnedUri(e.uri);
            if (id === null) {
                return true;
            }
            return id !== objectId;
        });

        withoutExisting.push({
            uri: makePinnedUri(objectId),
            name: args.name.trim(),
        });

        await this.savePins(withoutExisting);
        return await this.loadPins();
    }

    public async unpinObject(objectId: string): Promise<PinnedObjectRecord[]> {
        const cleanedId = objectId.trim();
        if (!isUuid(cleanedId)) {
            logWarning(`[ObjectPinStore] Ignoring unpin for invalid object id: ${objectId}`);
            return await this.loadPins();
        }

        const current = await this.loadPins();
        const next = current.filter((e) => {
            const id = parseObjectIdFromPinnedUri(e.uri);
            if (id === null) {
                return true;
            }
            return id !== cleanedId;
        });
        await this.savePins(next);
        return await this.loadPins();
    }

    public async isPinned(objectId: string): Promise<boolean> {
        const pins = await this.loadPins();
        for (const pin of pins) {
            const id = parseObjectIdFromPinnedUri(pin.uri);
            if (id === objectId) {
                return true;
            }
        }
        return false;
    }

    public async getPinnedObjectIds(): Promise<string[]> {
        const pins = await this.loadPins();
        const ids: string[] = [];
        for (const pin of pins) {
            const id = parseObjectIdFromPinnedUri(pin.uri);
            if (id !== null) {
                ids.push(id);
            }
        }
        return ids;
    }

    private parsePinDocument(parsed: unknown): PinnedObjectRecord[] {
        // Legacy migration path: plain string[] of object IDs.
        if (Array.isArray(parsed)) {
            const migrated: PinnedObjectRecord[] = [];
            for (const value of parsed) {
                if (typeof value !== "string") {
                    continue;
                }
                const id = value.trim();
                if (!isUuid(id)) {
                    continue;
                }
                migrated.push({
                    uri: makePinnedUri(id),
                    name: "",
                });
            }
            return migrated;
        }

        if (!parsed || typeof parsed !== "object") {
            return [];
        }

        const maybe = parsed as Partial<PinFileV1>;
        if (!Array.isArray(maybe.pinned)) {
            return [];
        }

        const out: PinnedObjectRecord[] = [];
        for (const entry of maybe.pinned) {
            if (!entry || typeof entry !== "object") {
                continue;
            }
            const e = entry as Partial<PinnedObjectRecord>;
            if (typeof e.uri !== "string") {
                continue;
            }
            out.push({
                uri: e.uri,
                name: typeof e.name === "string" ? e.name : "",
            });
        }
        return out;
    }

    private getPinFileUri(): vscode.Uri | null {
        const root = this.getWorkspaceRootUri();
        if (root === null) {
            return null;
        }
        return vscode.Uri.joinPath(root, PIN_DIR_NAME, PIN_SUBDIR_NAME, PIN_FILE_NAME);
    }

    private getWorkspaceRootUri(): vscode.Uri | null {
        const folders = vscode.workspace.workspaceFolders ?? [];
        for (const folder of folders) {
            if (folder.uri.scheme === "file") {
                return folder.uri;
            }
        }
        return null;
    }
}
