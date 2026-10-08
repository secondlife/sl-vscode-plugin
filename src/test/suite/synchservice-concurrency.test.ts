import * as assert from "assert";
import * as path from "path";
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

const workspaceRoot = path.resolve(__dirname, "../../../src/test/workspace/set_1");

function scriptItem(item_id: string, name: string): ObjectInventoryItem
{
    return { item_id, name, type: "script" };
}

suite("SynchService concurrent attach races (Phase 4 Step 15)", () => {

    setup(() => {
        ObjectContentService.getInstance().handlePublish({
            object: {
                object_id: "obj1",
                object_name: "Test Object",
                inventory: [scriptItem("item1", "Script.luau")],
                linked_objects: [],
            },
        });
    });

    teardown(() => {
        ObjectContentService.getInstance().dispose();
    });

    test("concurrent attach of the same virtual endpoint to two different masters results in exactly one owner", async () => {
        const { service, activeSyncs } = createTestSynchService();
        const masterA = vscode.Uri.file(path.join(workspaceRoot, "circular_a.luau"));
        const masterB = vscode.Uri.file(path.join(workspaceRoot, "circular_b.luau"));
        const sharedIdentity = identity("obj1", null, "item1");
        const virtualUri = vscode.Uri.parse("sl://obj1/item1");

        const fakeA = createFakeScriptSync({
            masterUri: masterA,
            snapshots: [{ kind: "virtual", identity: identity("placeholder", null, "placeholder-a") }],
        });
        const fakeB = createFakeScriptSync({
            masterUri: masterB,
            snapshots: [{ kind: "virtual", identity: identity("placeholder", null, "placeholder-b") }],
        });
        activeSyncs.set(masterKeyFor(masterA), fakeA.sync);
        activeSyncs.set(masterKeyFor(masterB), fakeB.sync);

        // Both calls lock on the same virtualIdentityKey, so runEndpointOperation serializes
        // them even though they are launched together; the second call deterministically
        // observes the first's result as `previousSync` and takes over ownership. Each fake
        // starts with an unrelated placeholder item so neither looks empty (and is swept by
        // clearEmptySyncs) before the race for `sharedIdentity` is decided.
        await Promise.all([
            service.moveVirtualFile(masterA, "luau", virtualUri, "content", sharedIdentity),
            service.moveVirtualFile(masterB, "luau", virtualUri, "content", sharedIdentity),
        ]);

        assert.strictEqual(fakeA.sync.isTrackingIdentity(sharedIdentity), false);
        assert.strictEqual(fakeB.sync.isTrackingIdentity(sharedIdentity), true);
        assert.strictEqual(service.findIndexedSyncByVirtualIdentity(sharedIdentity), fakeB.sync);
    });

    test("concurrent attach of the same temporary endpoint to two different masters results in exactly one owner", async () => {
        const { service, activeSyncs } = createTestSynchService();
        const masterA = vscode.Uri.file(path.join(workspaceRoot, "circular_a.luau"));
        const masterB = vscode.Uri.file(path.join(workspaceRoot, "circular_b.luau"));
        const viewerUri = vscode.Uri.file(path.join(workspaceRoot, "nested_module_a.luau"));

        const fakeA = createFakeScriptSync({
            masterUri: masterA,
            snapshots: [{ kind: "virtual", identity: identity("placeholder", null, "placeholder-a") }],
        });
        const fakeB = createFakeScriptSync({
            masterUri: masterB,
            snapshots: [{ kind: "virtual", identity: identity("placeholder", null, "placeholder-b") }],
        });
        activeSyncs.set(masterKeyFor(masterA), fakeA.sync);
        activeSyncs.set(masterKeyFor(masterB), fakeB.sync);

        const viewerDocument = await vscode.workspace.openTextDocument(viewerUri);

        // Both calls lock on the same canonicalFileUri(viewerDocument.uri), so they are
        // serialized; the second deterministically takes over from the first. Each fake
        // starts with an unrelated placeholder item so neither is swept as empty mid-race.
        await Promise.all([
            service.moveTemporaryFile(masterA, "luau", "script-1", viewerDocument),
            service.moveTemporaryFile(masterB, "luau", "script-1", viewerDocument),
        ]);

        assert.strictEqual(fakeA.sync.isTrackingFile(viewerUri.fsPath), false);
        assert.strictEqual(fakeB.sync.isTrackingFile(viewerUri.fsPath), true);
        assert.strictEqual(service.findIndexedSyncByTemporaryFilePath(viewerUri.fsPath), fakeB.sync);
    });
});

suite("SynchService endpoint deleted while destination is being prepared (Phase 4 Step 16)", () => {

    setup(() => {
        ObjectContentService.getInstance().handlePublish({
            object: {
                object_id: "obj1",
                object_name: "Test Object",
                inventory: [scriptItem("item1", "Script.luau")],
                linked_objects: [],
            },
        });
    });

    teardown(() => {
        ObjectContentService.getInstance().dispose();
    });

    test("virtual endpoint deleted mid-move rolls back without a dangling link", async () => {
        const { service, activeSyncs } = createTestSynchService();
        const masterA = vscode.Uri.file(path.join(workspaceRoot, "circular_a.luau"));
        const masterB = vscode.Uri.file(path.join(workspaceRoot, "circular_b.luau"));
        const sharedIdentity = identity("obj1", null, "item1");
        const virtualUri = vscode.Uri.parse("sl://obj1/item1");

        const fakeA = createFakeScriptSync({
            masterUri: masterA,
            snapshots: [{ kind: "virtual", identity: sharedIdentity }],
        });
        const fakeB = createFakeScriptSync({
            masterUri: masterB,
            snapshots: [{ kind: "virtual", identity: identity("placeholder", null, "placeholder-b") }],
        });
        activeSyncs.set(masterKeyFor(masterA), fakeA.sync);
        activeSyncs.set(masterKeyFor(masterB), fakeB.sync);

        // Racing this against real timing (setTimeout/microtasks) is inherently flaky, since it
        // depends on how fast the real openTextDocument/fs.stat calls happen to resolve. Instead,
        // deterministically simulate the endpoint being deleted (e.g. the in-world item removed)
        // exactly when the destination attach happens — the precise moment moveVirtualFile's
        // "is the previous owner still valid?" check needs to observe it.
        const originalSubscribeVirtual = fakeB.sync.subscribeVirtual.bind(fakeB.sync);
        (fakeB.sync as unknown as { subscribeVirtual: typeof fakeB.sync.subscribeVirtual }).subscribeVirtual =
            (uri, content, identity2, item): boolean => {
                service.detachVirtualFile(sharedIdentity);
                return originalSubscribeVirtual(uri, content, identity2, item);
            };

        const result = await service.moveVirtualFile(masterB, "luau", virtualUri, "content", sharedIdentity);

        assert.strictEqual(result.outcome, "failed");
        assert.strictEqual(result.changed, false);
        assert.strictEqual(fakeB.sync.isTrackingIdentity(sharedIdentity), false);
        assert.strictEqual(service.findIndexedSyncByVirtualIdentity(sharedIdentity), undefined);
        // fakeA had nothing else tracked, so the deletion also cleaned up its now-empty sync.
        assert.strictEqual(activeSyncs.has(masterKeyFor(masterA)), false);
        // fakeB's unrelated placeholder survives; the failed move did not disturb it.
        assert.strictEqual(activeSyncs.has(masterKeyFor(masterB)), true);
    });

    test("temporary endpoint deleted mid-move rolls back without a dangling link", async () => {
        const { service, activeSyncs } = createTestSynchService();
        const masterA = vscode.Uri.file(path.join(workspaceRoot, "circular_a.luau"));
        const masterB = vscode.Uri.file(path.join(workspaceRoot, "circular_b.luau"));
        const viewerUri = vscode.Uri.file(path.join(workspaceRoot, "nested_module_a.luau"));

        const fakeA = createFakeScriptSync({
            masterUri: masterA,
            snapshots: [{ kind: "local", fileUri: viewerUri }],
        });
        const fakeB = createFakeScriptSync({
            masterUri: masterB,
            snapshots: [{ kind: "virtual", identity: identity("placeholder", null, "placeholder-b") }],
        });
        activeSyncs.set(masterKeyFor(masterA), fakeA.sync);
        activeSyncs.set(masterKeyFor(masterB), fakeB.sync);

        const viewerDocument = await vscode.workspace.openTextDocument(viewerUri);

        // Same deterministic approach as the virtual-endpoint test above, avoiding a timing race.
        const originalSubscribe = fakeB.sync.subscribe.bind(fakeB.sync);
        (fakeB.sync as unknown as { subscribe: typeof fakeB.sync.subscribe }).subscribe =
            (id, document): boolean => {
                service.detachTemporaryFile(viewerUri.fsPath);
                return originalSubscribe(id, document);
            };

        const result = await service.moveTemporaryFile(masterB, "luau", "script-1", viewerDocument);

        assert.strictEqual(result.outcome, "failed");
        assert.strictEqual(result.changed, false);
        assert.strictEqual(fakeB.sync.isTrackingFile(viewerUri.fsPath), false);
        assert.strictEqual(service.findIndexedSyncByTemporaryFilePath(viewerUri.fsPath), undefined);
        assert.strictEqual(activeSyncs.has(masterKeyFor(masterA)), false);
        assert.strictEqual(activeSyncs.has(masterKeyFor(masterB)), true);
    });
});

interface PrivateViewerEventMethods
{
    onViewerDidChangeContent(e: { object_id: string; prim_id: string; item_id: string }): void;
}

suite("SynchService reassignment racing a metadata update (Phase 4 Step 17)", () => {
    const rootId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const itemId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

    let contentService: ObjectContentService;

    setup(() => {
        contentService = ObjectContentService.getInstance();
        contentService.handlePublish({
            object: {
                object_id: rootId,
                object_name: "Test Object",
                inventory: [scriptItem(itemId, "Script.luau")],
                linked_objects: [],
            },
        });
    });

    teardown(() => {
        contentService.dispose();
    });

    test("a metadata update always targets the identity's current owner, never an owner made obsolete by reassignment", async () => {
        const { service, activeSyncs } = createTestSynchService();
        const masterA = vscode.Uri.file(path.join(workspaceRoot, "circular_a.luau"));
        const masterB = vscode.Uri.file(path.join(workspaceRoot, "circular_b.luau"));
        const trackedIdentity = identity(rootId, null, itemId);
        const virtualUri = vscode.Uri.parse(`sl://${rootId}/${itemId}`);

        const fakeA = createFakeScriptSync({
            masterUri: masterA,
            snapshots: [{ kind: "virtual", identity: trackedIdentity }],
        });
        const fakeB = createFakeScriptSync({
            masterUri: masterB,
            snapshots: [{ kind: "virtual", identity: identity("placeholder", null, "placeholder-b") }],
        });
        activeSyncs.set(masterKeyFor(masterA), fakeA.sync);
        activeSyncs.set(masterKeyFor(masterB), fakeB.sync);

        const fireContentChange = (): void =>
            (service as unknown as PrivateViewerEventMethods).onViewerDidChangeContent({
                object_id: rootId,
                prim_id: rootId,
                item_id: itemId,
            });

        // Before reassignment, the current owner (fakeA) receives the metadata update.
        fireContentChange();
        assert.strictEqual(fakeA.calls.updateVirtualItem.length, 1);
        assert.strictEqual(fakeB.calls.updateVirtualItem.length, 0);

        // Reassign the identity to masterB.
        const result = await service.moveVirtualFile(masterB, "luau", virtualUri, "content", trackedIdentity);
        assert.strictEqual(result.outcome, "moved");
        assert.strictEqual(fakeA.sync.isTrackingIdentity(trackedIdentity), false);
        assert.strictEqual(fakeB.sync.isTrackingIdentity(trackedIdentity), true);

        // A metadata update arriving after reassignment must go to the new owner only —
        // never a write through fakeA, which is now an obsolete owner.
        fireContentChange();
        assert.strictEqual(fakeA.calls.updateVirtualItem.length, 1);
        assert.strictEqual(fakeB.calls.updateVirtualItem.length, 1);
    });
});

suite("SynchService object unpublished during a bulk auto-link or pull (Phase 4 Step 19)", () => {
    const rootId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const itemId = "ffffffff-ffff-4fff-8fff-ffffffffffff";

    let contentService: ObjectContentService;

    setup(() => {
        contentService = ObjectContentService.getInstance();
    });

    teardown(() => {
        contentService.dispose();
    });

    test("a late attach for an already-unpublished object is rejected, not left as an orphaned link", async () => {
        const { service, activeSyncs } = createTestSynchService();
        const master = vscode.Uri.file(path.join(workspaceRoot, "circular_b.luau"));
        const trackedIdentity = identity(rootId, null, itemId);
        const virtualUri = vscode.Uri.parse(`sl://${rootId}/${itemId}`);

        // Object is not published (simulating: it was unpublished before this in-flight
        // attach — from a bulk auto-link/pull operation — could complete).
        const fake = createFakeScriptSync({ masterUri: master, scriptIds: ["placeholder"] });
        activeSyncs.set(masterKeyFor(master), fake.sync);

        const result = await service.moveVirtualFile(master, "luau", virtualUri, "content", trackedIdentity);

        assert.strictEqual(result.outcome, "failed");
        assert.strictEqual(result.changed, false);
        assert.strictEqual(fake.sync.isTrackingIdentity(trackedIdentity), false);
        assert.strictEqual(service.findIndexedSyncByVirtualIdentity(trackedIdentity), undefined);
    });

    test("attach still succeeds normally when the object remains published", async () => {
        const { service, activeSyncs } = createTestSynchService();
        const master = vscode.Uri.file(path.join(workspaceRoot, "circular_b.luau"));
        const trackedIdentity = identity(rootId, null, itemId);
        const virtualUri = vscode.Uri.parse(`sl://${rootId}/${itemId}`);

        contentService.handlePublish({
            object: {
                object_id: rootId,
                object_name: "Test Object",
                inventory: [scriptItem(itemId, "Script.luau")],
                linked_objects: [],
            },
        });

        const fake = createFakeScriptSync({ masterUri: master, scriptIds: ["placeholder"] });
        activeSyncs.set(masterKeyFor(master), fake.sync);

        const result = await service.moveVirtualFile(master, "luau", virtualUri, "content", trackedIdentity);

        assert.strictEqual(result.outcome, "linked");
        assert.strictEqual(fake.sync.isTrackingIdentity(trackedIdentity), true);
    });
});

suite("SynchService destination initialization failure (Phase 4 Step 20)", () => {
    const rootId = "11112222-1111-4111-8111-111122223333";
    const itemId = "44445555-4444-4444-8444-444455556666";

    let contentService: ObjectContentService;

    setup(() => {
        contentService = ObjectContentService.getInstance();
        contentService.handlePublish({
            object: {
                object_id: rootId,
                object_name: "Test Object",
                inventory: [scriptItem(itemId, "Script.luau")],
                linked_objects: [],
            },
        });
    });

    teardown(() => {
        contentService.dispose();
    });

    test("a failed destination initialization leaves an existing old virtual link completely intact", async () => {
        const { service, activeSyncs } = createTestSynchService();
        const oldMaster = vscode.Uri.file(path.join(workspaceRoot, "circular_a.luau"));
        const badMaster = vscode.Uri.file(path.join(workspaceRoot, "does-not-exist-step20.luau"));
        const trackedIdentity = identity(rootId, null, itemId);
        const virtualUri = vscode.Uri.parse(`sl://${rootId}/${itemId}`);

        const oldFake = createFakeScriptSync({
            masterUri: oldMaster,
            snapshots: [{ kind: "virtual", identity: trackedIdentity }],
        });
        activeSyncs.set(masterKeyFor(oldMaster), oldFake.sync);
        // No fake registered for badMaster: getOrCreateSync must construct a real ScriptSync,
        // but validateMasterUri() throws first since the file doesn't exist — simulating a
        // destination initialization failure.

        await assert.rejects(
            service.moveVirtualFile(badMaster, "luau", virtualUri, "content", trackedIdentity),
        );

        // The old link is never touched: detach only happens after getOrCreateSync succeeds.
        assert.strictEqual(oldFake.sync.isTrackingIdentity(trackedIdentity), true);
        assert.strictEqual(oldFake.calls.unsubscribeVirtualMappingByIdentity.length, 0);
        assert.strictEqual(oldFake.calls.dispose, 0);
        assert.strictEqual(activeSyncs.has(masterKeyFor(oldMaster)), true);
        assert.strictEqual(service.findIndexedSyncByVirtualIdentity(trackedIdentity), oldFake.sync);
    });

    test("a failed destination initialization leaves an existing old temporary link completely intact", async () => {
        const { service, activeSyncs } = createTestSynchService();
        const oldMaster = vscode.Uri.file(path.join(workspaceRoot, "circular_a.luau"));
        const badMaster = vscode.Uri.file(path.join(workspaceRoot, "does-not-exist-step20b.luau"));
        const viewerUri = vscode.Uri.file(path.join(workspaceRoot, "nested_module_a.luau"));

        const oldFake = createFakeScriptSync({
            masterUri: oldMaster,
            snapshots: [{ kind: "local", fileUri: viewerUri }],
        });
        activeSyncs.set(masterKeyFor(oldMaster), oldFake.sync);

        const viewerDocument = await vscode.workspace.openTextDocument(viewerUri);

        await assert.rejects(
            service.moveTemporaryFile(badMaster, "luau", "script-1", viewerDocument),
        );

        assert.strictEqual(oldFake.sync.isTrackingFile(viewerUri.fsPath), true);
        assert.strictEqual(oldFake.calls.unsubscribeByFile.length, 0);
        assert.strictEqual(oldFake.calls.dispose, 0);
        assert.strictEqual(activeSyncs.has(masterKeyFor(oldMaster)), true);
        assert.strictEqual(service.findIndexedSyncByTemporaryFilePath(viewerUri.fsPath), oldFake.sync);
    });
});

interface PrivateObjectEventMethods
{
    onViewerDidChangeObjects(e: { type: "added" | "removed" | "updated"; object_id: string }): void;
}

suite("SynchService duplicate deletion and eviction events are harmless (Phase 4 Step 22)", () => {

    test("calling evictSlSyncs twice for the same object is harmless", () => {
        const { service, activeSyncs, refreshCalls } = createTestSynchService();
        const master = vscode.Uri.file(path.join(workspaceRoot, "circular_a.luau"));
        const trackedIdentity = identity("obj1", null, "item1");
        const fake = createFakeScriptSync({
            masterUri: master,
            snapshots: [{ kind: "virtual", identity: trackedIdentity }],
        });
        activeSyncs.set(masterKeyFor(master), fake.sync);

        service.evictSlSyncs("obj1");
        assert.strictEqual(fake.calls.dispose, 1);
        assert.strictEqual(refreshCalls.length, 1);

        // Duplicate eviction event: nothing left to evict, must be a harmless no-op.
        service.evictSlSyncs("obj1");
        assert.strictEqual(fake.calls.dispose, 1);
        assert.strictEqual(refreshCalls.length, 1);
    });

    test("calling removeMasterLink twice for the same master is harmless", () => {
        const { service, activeSyncs, refreshCalls } = createTestSynchService();
        const master = vscode.Uri.file(path.join(workspaceRoot, "circular_a.luau"));
        const fake = createFakeScriptSync({ masterUri: master });
        activeSyncs.set(masterKeyFor(master), fake.sync);

        assert.strictEqual(service.removeMasterLink(master), true);
        assert.strictEqual(fake.calls.dispose, 1);
        assert.strictEqual(refreshCalls.length, 1);

        assert.strictEqual(service.removeMasterLink(master), false);
        assert.strictEqual(fake.calls.dispose, 1);
        assert.strictEqual(refreshCalls.length, 1);
    });

    test("calling detachVirtualFile twice for the same identity is harmless", () => {
        const { service, activeSyncs } = createTestSynchService();
        const master = vscode.Uri.file(path.join(workspaceRoot, "circular_a.luau"));
        const trackedIdentity = identity("obj1", null, "item1");
        const fake = createFakeScriptSync({
            masterUri: master,
            snapshots: [{ kind: "virtual", identity: trackedIdentity }],
        });
        activeSyncs.set(masterKeyFor(master), fake.sync);

        assert.strictEqual(service.detachVirtualFile(trackedIdentity), true);
        assert.strictEqual(service.detachVirtualFile(trackedIdentity), false);
    });

    test("duplicate onViewerDidChangeObjects 'removed' events for the same object are harmless", () => {
        const { service, activeSyncs, refreshCalls } = createTestSynchService();
        const master = vscode.Uri.file(path.join(workspaceRoot, "circular_a.luau"));
        const trackedIdentity = identity("obj1", null, "item1");
        const fake = createFakeScriptSync({
            masterUri: master,
            snapshots: [{ kind: "virtual", identity: trackedIdentity }],
        });
        activeSyncs.set(masterKeyFor(master), fake.sync);

        const fireRemoved = (): void =>
            (service as unknown as PrivateObjectEventMethods).onViewerDidChangeObjects({
                type: "removed",
                object_id: "obj1",
            });

        fireRemoved();
        assert.strictEqual(fake.calls.dispose, 1);
        assert.strictEqual(refreshCalls.length, 1);

        // Duplicate removal event arriving again must not throw or double-dispose/-refresh.
        fireRemoved();
        assert.strictEqual(fake.calls.dispose, 1);
        assert.strictEqual(refreshCalls.length, 1);
    });
});
