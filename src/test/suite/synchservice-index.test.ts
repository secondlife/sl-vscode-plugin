import * as assert from "assert";
import * as vscode from "vscode";
import { ScriptIdentity } from "../../scriptsync";
import {
    createFakeScriptSync,
    createTestSynchService,
    masterKeyFor,
} from "./helpers/synchServiceTestHelpers";

function identity(rootId: string, primId: string | null, itemId: string): ScriptIdentity
{
    return { rootId, primId, itemId };
}

suite("SynchService index lookup characterization", () => {

    test("findIndexedSyncByMasterFilePath resolves equivalent path spellings and misses otherwise", () => {
        const { service, activeSyncs } = createTestSynchService();
        const master = vscode.Uri.file("C:/ws/sub/a.luau");
        const fake = createFakeScriptSync({ masterUri: master });
        activeSyncs.set(masterKeyFor(master), fake.sync);

        const forwardSlashSpelling = master.fsPath.replace(/\\/g, "/");
        const redundantSpelling = forwardSlashSpelling.replace("/sub/a.luau", "/sub/other/../a.luau");

        assert.strictEqual(service.findIndexedSyncByMasterFilePath(master.fsPath), fake.sync);
        assert.strictEqual(service.findIndexedSyncByMasterFilePath(forwardSlashSpelling), fake.sync);
        assert.strictEqual(service.findIndexedSyncByMasterFilePath(redundantSpelling), fake.sync);

        assert.strictEqual(service.findIndexedSyncByMasterFilePath("C:/ws/sub/missing.luau"), undefined);
    });

    test("rekeyMasterSync invalidates the index so the new master path resolves and the old path misses", () => {
        const { service, activeSyncs } = createTestSynchService();
        const oldMaster = vscode.Uri.file("C:/ws/old.luau");
        const newMaster = vscode.Uri.file("C:/ws/new.luau");
        const fake = createFakeScriptSync({ masterUri: oldMaster });
        activeSyncs.set(masterKeyFor(oldMaster), fake.sync);

        // Prime the index on the old path before rekeying.
        assert.strictEqual(service.findIndexedSyncByMasterFilePath(oldMaster.fsPath), fake.sync);

        const rekeyed = (service as any).rekeyMasterSync(fake.sync, newMaster);
        assert.strictEqual(rekeyed, true);
        // renameMasterLink always follows a successful rekey with this call.
        fake.sync.renameMasterDocument({ uri: newMaster } as unknown as vscode.TextDocument);

        assert.strictEqual(service.findIndexedSyncByMasterFilePath(newMaster.fsPath), fake.sync);
        assert.strictEqual(service.findIndexedSyncByMasterFilePath(oldMaster.fsPath), undefined);
    });

    test("renameTemporaryLink invalidates the index so the new temporary path resolves and the old path misses", async () => {
        const { service, activeSyncs } = createTestSynchService();
        const master = vscode.Uri.file("C:/ws/a.luau");
        const oldTemp = vscode.Uri.file("C:/tmp/old.luau");
        const newTemp = vscode.Uri.file("C:/tmp/new.luau");
        const fake = createFakeScriptSync({
            masterUri: master,
            snapshots: [{ kind: "local", fileUri: oldTemp }],
        });
        activeSyncs.set(masterKeyFor(master), fake.sync);

        // Prime the index on the old path before renaming.
        assert.strictEqual(service.findIndexedSyncByTemporaryFilePath(oldTemp.fsPath), fake.sync);

        const renamed = await (service as any).renameTemporaryLink(oldTemp, newTemp);
        assert.strictEqual(renamed, true);

        assert.strictEqual(service.findIndexedSyncByTemporaryFilePath(newTemp.fsPath), fake.sync);
        assert.strictEqual(service.findIndexedSyncByTemporaryFilePath(oldTemp.fsPath), undefined);
    });

    test("findIndexedSyncByTemporaryFilePath resolves equivalent path spellings and misses otherwise", () => {
        const { service, activeSyncs } = createTestSynchService();
        const master = vscode.Uri.file("C:/ws/a.luau");
        const tempFile = vscode.Uri.file("C:/tmp/sub/a.luau");
        const fake = createFakeScriptSync({
            masterUri: master,
            snapshots: [{ kind: "local", fileUri: tempFile }],
        });
        activeSyncs.set(masterKeyFor(master), fake.sync);

        const forwardSlashSpelling = tempFile.fsPath.replace(/\\/g, "/");

        assert.strictEqual(service.findIndexedSyncByTemporaryFilePath(tempFile.fsPath), fake.sync);
        assert.strictEqual(service.findIndexedSyncByTemporaryFilePath(forwardSlashSpelling), fake.sync);

        assert.strictEqual(service.findIndexedSyncByTemporaryFilePath("C:/tmp/sub/missing.luau"), undefined);
    });

    test("findIndexedSyncByVirtualIdentity resolves structurally equal identities and misses otherwise", () => {
        const { service, activeSyncs } = createTestSynchService();
        const master = vscode.Uri.file("C:/ws/a.luau");
        const tracked = identity("obj1", "prim1", "item1");
        const fake = createFakeScriptSync({
            masterUri: master,
            snapshots: [{ kind: "virtual", identity: tracked }],
        });
        activeSyncs.set(masterKeyFor(master), fake.sync);

        // A separately-constructed object with the same field values must still match:
        // findIndexedSyncByVirtualIdentity keys structurally (JSON-encoded), not by reference.
        assert.strictEqual(
            service.findIndexedSyncByVirtualIdentity(identity("obj1", "prim1", "item1")),
            fake.sync,
        );

        assert.strictEqual(
            service.findIndexedSyncByVirtualIdentity(identity("obj1", "prim2", "item1")),
            undefined,
        );
    });

    test("index lookups never return a stale owner after a sync is removed", () => {
        const { service, activeSyncs } = createTestSynchService();
        const master = vscode.Uri.file("C:/ws/a.luau");
        const tempFile = vscode.Uri.file("C:/tmp/a.luau");
        const trackedIdentity = identity("obj1", "prim1", "item1");
        const fake = createFakeScriptSync({
            masterUri: master,
            snapshots: [
                { kind: "local", fileUri: tempFile },
                { kind: "virtual", identity: trackedIdentity },
            ],
        });
        activeSyncs.set(masterKeyFor(master), fake.sync);

        assert.strictEqual(service.findIndexedSyncByMasterFilePath(master.fsPath), fake.sync);
        assert.strictEqual(service.findIndexedSyncByTemporaryFilePath(tempFile.fsPath), fake.sync);
        assert.strictEqual(service.findIndexedSyncByVirtualIdentity(trackedIdentity), fake.sync);

        assert.strictEqual(service.removeMasterLink(master), true);

        assert.strictEqual(service.findIndexedSyncByMasterFilePath(master.fsPath), undefined);
        assert.strictEqual(service.findIndexedSyncByTemporaryFilePath(tempFile.fsPath), undefined);
        assert.strictEqual(service.findIndexedSyncByVirtualIdentity(trackedIdentity), undefined);
    });

    test("a detach that does not dispose the sync still invalidates the index (Phase 3 Step 14)", () => {
        const { service, activeSyncs } = createTestSynchService();
        const master = vscode.Uri.file("C:/ws/a.luau");
        const idKept = identity("obj1", "prim1", "item1");
        const idRemoved = identity("obj1", "prim2", "item2");
        const fake = createFakeScriptSync({
            masterUri: master,
            snapshots: [
                { kind: "virtual", identity: idKept },
                { kind: "virtual", identity: idRemoved },
            ],
        });
        activeSyncs.set(masterKeyFor(master), fake.sync);

        // Prime the index with a lookup before the mutation.
        assert.strictEqual(service.findIndexedSyncByVirtualIdentity(idRemoved), fake.sync);

        // idKept remains, so the sync survives and disposeSync's own dirty-marking never runs —
        // this isolates detachEndpoint's dirty-marking as the only thing that can fix the index.
        const detached = service.detachVirtualFile(idRemoved);
        assert.strictEqual(detached, true);
        assert.strictEqual(activeSyncs.has(masterKeyFor(master)), true);

        assert.strictEqual(service.findIndexedSyncByVirtualIdentity(idRemoved), undefined);
        assert.strictEqual(service.findIndexedSyncByVirtualIdentity(idKept), fake.sync);
    });
});
