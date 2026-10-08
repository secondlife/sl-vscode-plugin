import * as assert from "assert";
import * as vscode from "vscode";
import { ScriptIdentity } from "../../scriptsync";
import { ObjectContentService, ObjectInventoryItem } from "#sl-ide-ws-client";
import {
    createFakeScriptSync,
    createTestSynchService,
    masterKeyFor,
} from "./helpers/synchServiceTestHelpers";

function identity(rootId: string, primId: string | null, itemId: string): ScriptIdentity
{
    return { rootId, primId, itemId };
}

suite("SynchService eviction and detach characterization", () => {

    test("evictSlSyncs detaches every virtual item in the object, touching only the owning sync for each", () => {
        const { service, activeSyncs, refreshCalls } = createTestSynchService();
        const masterA = vscode.Uri.file("C:/ws/a.luau");
        const masterB = vscode.Uri.file("C:/ws/b.luau");

        const idA1 = identity("obj1", "prim1", "item1");
        const idA2 = identity("obj1", "prim2", "item2");
        const idB1 = identity("obj1", "prim3", "item3");
        const idOther = identity("obj2", "prim4", "item4");

        const fakeA = createFakeScriptSync({
            masterUri: masterA,
            snapshots: [
                { kind: "virtual", identity: idA1 },
                { kind: "virtual", identity: idA2 },
            ],
        });
        const fakeB = createFakeScriptSync({
            masterUri: masterB,
            snapshots: [
                { kind: "virtual", identity: idB1 },
                { kind: "virtual", identity: idOther },
            ],
        });

        activeSyncs.set(masterKeyFor(masterA), fakeA.sync);
        activeSyncs.set(masterKeyFor(masterB), fakeB.sync);

        service.evictSlSyncs("obj1");

        assert.deepStrictEqual(fakeA.calls.unsubscribeVirtualMappingByIdentity, [idA1, idA2]);
        // Phase 2 Step 9: detachVirtualFile now routes through the guarded detachEndpoint
        // primitive, so fakeB (never an owner of idA1/idA2) is no longer asked to unsubscribe
        // identities it never tracked. It is only touched for idB1, which it does own.
        assert.deepStrictEqual(fakeB.calls.unsubscribeVirtualMappingByIdentity, [idB1]);

        assert.strictEqual(activeSyncs.has(masterKeyFor(masterA)), false);
        assert.strictEqual(activeSyncs.has(masterKeyFor(masterB)), true);
        assert.strictEqual(fakeA.calls.dispose, 1);
        assert.strictEqual(fakeB.calls.dispose, 0);
        assert.strictEqual(refreshCalls.length, 1);
    });

    test("evictSlSyncsForPrim only detaches identities matching both object and prim", () => {
        const { service, activeSyncs } = createTestSynchService();
        const master = vscode.Uri.file("C:/ws/a.luau");
        const matching = identity("obj1", "prim1", "item1");
        const sameObjectDifferentPrim = identity("obj1", "prim2", "item2");

        const fake = createFakeScriptSync({
            masterUri: master,
            snapshots: [
                { kind: "virtual", identity: matching },
                { kind: "virtual", identity: sameObjectDifferentPrim },
            ],
        });
        activeSyncs.set(masterKeyFor(master), fake.sync);

        service.evictSlSyncsForPrim("obj1", "prim1");

        assert.deepStrictEqual(fake.calls.unsubscribeVirtualMappingByIdentity, [matching]);
        assert.strictEqual(activeSyncs.has(masterKeyFor(master)), true);
    });

    test("detachVirtualFile detaches only the owning sync", () => {
        const { service, activeSyncs, refreshCalls } = createTestSynchService();
        const masterA = vscode.Uri.file("C:/ws/a.luau");
        const masterB = vscode.Uri.file("C:/ws/b.luau");
        const owned = identity("obj1", "prim1", "item1");
        const unrelated = identity("obj2", "prim2", "item2");

        const fakeA = createFakeScriptSync({
            masterUri: masterA,
            snapshots: [{ kind: "virtual", identity: owned }],
        });
        const fakeB = createFakeScriptSync({
            masterUri: masterB,
            snapshots: [{ kind: "virtual", identity: unrelated }],
        });

        activeSyncs.set(masterKeyFor(masterA), fakeA.sync);
        activeSyncs.set(masterKeyFor(masterB), fakeB.sync);

        const detached = service.detachVirtualFile(owned);

        assert.strictEqual(detached, true);
        assert.deepStrictEqual(fakeA.calls.unsubscribeVirtualMappingByIdentity, [owned]);
        assert.deepStrictEqual(fakeB.calls.unsubscribeVirtualMappingByIdentity, []);

        assert.strictEqual(activeSyncs.has(masterKeyFor(masterA)), false);
        assert.strictEqual(activeSyncs.has(masterKeyFor(masterB)), true);
        assert.strictEqual(refreshCalls.length, 1);
    });

    test("detachTemporaryFile detaches only the owning sync", () => {
        const { service, activeSyncs, refreshCalls } = createTestSynchService();
        const masterA = vscode.Uri.file("C:/ws/a.luau");
        const masterB = vscode.Uri.file("C:/ws/b.luau");
        const ownedFile = vscode.Uri.file("C:/tmp/a.luau");
        const unrelatedFile = vscode.Uri.file("C:/tmp/b.luau");

        const fakeA = createFakeScriptSync({
            masterUri: masterA,
            snapshots: [{ kind: "local", fileUri: ownedFile }],
        });
        const fakeB = createFakeScriptSync({
            masterUri: masterB,
            snapshots: [{ kind: "local", fileUri: unrelatedFile }],
        });

        activeSyncs.set(masterKeyFor(masterA), fakeA.sync);
        activeSyncs.set(masterKeyFor(masterB), fakeB.sync);

        const detached = service.detachTemporaryFile(ownedFile.fsPath);

        assert.strictEqual(detached, true);
        assert.deepStrictEqual(fakeA.calls.unsubscribeByFile, [ownedFile.fsPath]);
        assert.deepStrictEqual(fakeB.calls.unsubscribeByFile, []);

        assert.strictEqual(activeSyncs.has(masterKeyFor(masterA)), false);
        assert.strictEqual(activeSyncs.has(masterKeyFor(masterB)), true);
        assert.strictEqual(refreshCalls.length, 1);
    });

    test("detachByScriptId only touches syncs that track the id, unlike the file/identity detach paths", () => {
        const { service, activeSyncs, refreshCalls } = createTestSynchService();
        const masterA = vscode.Uri.file("C:/ws/a.luau");
        const masterB = vscode.Uri.file("C:/ws/b.luau");

        const fakeA = createFakeScriptSync({ masterUri: masterA, scriptIds: ["script-1"] });
        const fakeB = createFakeScriptSync({ masterUri: masterB, scriptIds: ["script-2"] });

        activeSyncs.set(masterKeyFor(masterA), fakeA.sync);
        activeSyncs.set(masterKeyFor(masterB), fakeB.sync);

        const detached = service.detachByScriptId("script-1");

        assert.strictEqual(detached, true);
        assert.deepStrictEqual(fakeA.calls.unsubscribeById, ["script-1"]);
        // Today's behaviour: detachByScriptId skips syncs that don't track the id, unlike
        // detachVirtualFile/detachTemporaryFile which call every active sync unconditionally.
        assert.deepStrictEqual(fakeB.calls.unsubscribeById, []);

        assert.strictEqual(activeSyncs.has(masterKeyFor(masterA)), false);
        assert.strictEqual(activeSyncs.has(masterKeyFor(masterB)), true);
        assert.strictEqual(refreshCalls.length, 1);
    });

    test("detachByScriptId reports false when no sync tracks the id", () => {
        const { service, activeSyncs } = createTestSynchService();
        const master = vscode.Uri.file("C:/ws/solo.luau");
        const fake = createFakeScriptSync({ masterUri: master, scriptIds: ["script-1"] });
        activeSyncs.set(masterKeyFor(master), fake.sync);

        const detached = service.detachByScriptId("unknown-script");

        assert.strictEqual(detached, false);
        assert.deepStrictEqual(fake.calls.unsubscribeById, []);
        assert.strictEqual(activeSyncs.has(masterKeyFor(master)), true);
    });

    test("removeMasterLink disposes the matching sync and reports absence otherwise", () => {
        const { service, activeSyncs, refreshCalls } = createTestSynchService();
        const master = vscode.Uri.file("C:/ws/solo.luau");
        const fake = createFakeScriptSync({ masterUri: master, snapshots: [] });
        activeSyncs.set(masterKeyFor(master), fake.sync);

        const missing = service.removeMasterLink(vscode.Uri.file("C:/ws/missing.luau"));
        assert.strictEqual(missing, false);
        assert.strictEqual(fake.calls.dispose, 0);
        assert.strictEqual(refreshCalls.length, 0);

        const removed = service.removeMasterLink(master);
        assert.strictEqual(removed, true);
        assert.strictEqual(activeSyncs.has(masterKeyFor(master)), false);
        assert.strictEqual(fake.calls.dispose, 1);
        assert.strictEqual(refreshCalls.length, 1);
        assert.strictEqual(refreshCalls[0], master);
    });
});

interface PrivateViewerEventMethods
{
    onViewerDidChangeContent(e: { object_id: string; prim_id: string; item_id: string }): void;
    onViewerDidChangeObjects(e: {
        type: "added" | "removed" | "updated";
        object_id: string;
        removed_items?: { prim_id: string; item_id: string }[];
        removed_link_ids?: string[];
    }): void;
}

function scriptItem(item_id: string, name: string): ObjectInventoryItem
{
    return { item_id, name, type: "script" };
}

suite("SynchService viewer event detachment boundary (Issue 1)", () => {
    const rootId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const itemId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

    let contentService: ObjectContentService;

    setup(() => {
        contentService = ObjectContentService.getInstance();
    });

    teardown(() => {
        contentService.dispose();
    });

    test("content invalidation updates the tracking sync's metadata and does not detach", () => {
        contentService.handlePublish({
            object: {
                object_id: rootId,
                object_name: "Test Object",
                inventory: [scriptItem(itemId, "Script.luau")],
                linked_objects: [],
            },
        });

        const { service, activeSyncs } = createTestSynchService();
        const master = vscode.Uri.file("C:/ws/a.luau");
        const trackedIdentity = identity(rootId, null, itemId);
        const fake = createFakeScriptSync({
            masterUri: master,
            snapshots: [{ kind: "virtual", identity: trackedIdentity }],
        });
        activeSyncs.set(masterKeyFor(master), fake.sync);

        (service as unknown as PrivateViewerEventMethods).onViewerDidChangeContent({
            object_id: rootId,
            prim_id: rootId,
            item_id: itemId,
        });

        assert.strictEqual(fake.calls.updateVirtualItem.length, 1);
        assert.deepStrictEqual(fake.calls.unsubscribeVirtualMappingByIdentity, []);
        assert.strictEqual(fake.calls.dispose, 0);
        assert.strictEqual(activeSyncs.has(masterKeyFor(master)), true);
    });

    test("a removed_items event detaches the matching virtual endpoint", () => {
        const { service, activeSyncs } = createTestSynchService();
        const master = vscode.Uri.file("C:/ws/a.luau");
        const trackedIdentity = identity(rootId, null, itemId);
        const fake = createFakeScriptSync({
            masterUri: master,
            snapshots: [{ kind: "virtual", identity: trackedIdentity }],
        });
        activeSyncs.set(masterKeyFor(master), fake.sync);

        (service as unknown as PrivateViewerEventMethods).onViewerDidChangeObjects({
            type: "updated",
            object_id: rootId,
            removed_items: [{ prim_id: rootId, item_id: itemId }],
        });

        assert.deepStrictEqual(fake.calls.unsubscribeVirtualMappingByIdentity, [trackedIdentity]);
        assert.strictEqual(activeSyncs.has(masterKeyFor(master)), false);
        assert.strictEqual(fake.calls.dispose, 1);
    });
});
