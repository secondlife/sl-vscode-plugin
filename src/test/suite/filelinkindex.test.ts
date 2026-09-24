import * as assert from "assert";
import {
    FileLinkIndex,
} from "../../shared/filelinkindex";
import {
    canonicalFileUri,
    virtualIdentityKey,
} from "../../shared/filelinkidentity";

suite("FileLinkIndex", () => {
    test("keeps endpoint namespaces separate", () => {
        const index = new FileLinkIndex<string>();
        const masterUri = canonicalFileUri("/workspace/master.luau");
        const temporaryUri = canonicalFileUri("/tmp/viewer.luau");
        const virtualKey = virtualIdentityKey({
            rootId: "11111111-1111-4111-8111-111111111111",
            primId: null,
            itemId: "22222222-2222-4222-8222-222222222222",
        });

        index.setMaster(masterUri, "master");
        index.setTemporaryFile(temporaryUri, "temporary");
        index.setVirtualFile(virtualKey, "virtual");

        assert.strictEqual(index.getMaster(masterUri), "master");
        assert.strictEqual(index.getTemporaryFile(temporaryUri), "temporary");
        assert.strictEqual(index.getVirtualFile(virtualKey), "virtual");
    });

    test("replaces the owner for an existing endpoint", () => {
        const index = new FileLinkIndex<string>();
        const masterUri = canonicalFileUri("/workspace/master.luau");

        index.setMaster(masterUri, "old-owner");
        index.setMaster(masterUri, "new-owner");

        assert.strictEqual(index.getMaster(masterUri), "new-owner");
    });

    test("coalesces equivalent file spellings to one canonical endpoint", () => {
        const index = new FileLinkIndex<string>();
        const first = canonicalFileUri("/workspace/../workspace/master.luau");
        const second = canonicalFileUri("/workspace/master.luau");

        index.setMaster(first, "master");
        index.setTemporaryFile(
            canonicalFileUri("/tmp/../tmp/viewer.luau"),
            "temporary",
        );

        assert.strictEqual(index.getMaster(second), "master");
        assert.strictEqual(
            index.getTemporaryFile(canonicalFileUri("/tmp/viewer.luau")),
            "temporary",
        );
    });

    test("removes stale master keys when a master is reassigned", () => {
        const index = new FileLinkIndex<string>();
        const oldMaster = canonicalFileUri("/workspace/old-master.luau");
        const newMaster = canonicalFileUri("/workspace/new-master.luau");

        index.setMaster(oldMaster, "old-owner");
        assert.strictEqual(index.getMaster(oldMaster), "old-owner");

        assert.strictEqual(index.deleteMaster(oldMaster), true);
        assert.strictEqual(index.getMaster(oldMaster), undefined);

        index.setMaster(newMaster, "new-owner");
        assert.strictEqual(index.getMaster(newMaster), "new-owner");
        assert.strictEqual(index.getMaster(oldMaster), undefined);
    });

    test("removes stale temporary keys when a temporary file is moved", () => {
        const index = new FileLinkIndex<string>();
        const oldTemporary = canonicalFileUri("/tmp/old-viewer.luau");
        const newTemporary = canonicalFileUri("/tmp/new-viewer.luau");

        index.setTemporaryFile(oldTemporary, "old-temp");
        assert.strictEqual(index.getTemporaryFile(oldTemporary), "old-temp");

        assert.strictEqual(index.deleteTemporaryFile(oldTemporary), true);
        assert.strictEqual(index.getTemporaryFile(oldTemporary), undefined);

        index.setTemporaryFile(newTemporary, "new-temp");
        assert.strictEqual(index.getTemporaryFile(newTemporary), "new-temp");
        assert.strictEqual(index.getTemporaryFile(oldTemporary), undefined);
    });

    test("removes stale virtual keys when a virtual item is reassigned", () => {
        const index = new FileLinkIndex<string>();
        const oldIdentity = {
            rootId: "11111111-1111-4111-8111-111111111111",
            primId: null,
            itemId: "22222222-2222-4222-8222-222222222222",
        };
        const newIdentity = {
            ...oldIdentity,
            itemId: "33333333-3333-4333-8333-333333333333",
        };
        const oldKey = virtualIdentityKey(oldIdentity);
        const newKey = virtualIdentityKey(newIdentity);

        index.setVirtualFile(oldKey, "old-virtual");
        assert.strictEqual(index.getVirtualFile(oldKey), "old-virtual");

        assert.strictEqual(index.deleteVirtualFile(oldKey), true);
        assert.strictEqual(index.getVirtualFile(oldKey), undefined);

        index.setVirtualFile(newKey, "new-virtual");
        assert.strictEqual(index.getVirtualFile(newKey), "new-virtual");
        assert.strictEqual(index.getVirtualFile(oldKey), undefined);
    });

    test("does not retain stale keys after a rejected concurrent move", () => {
        const index = new FileLinkIndex<string>();
        const oldKey = canonicalFileUri("/tmp/old-viewer.luau");
        const newKey = canonicalFileUri("/tmp/new-viewer.luau");

        index.setTemporaryFile(oldKey, "old-owner");
        assert.strictEqual(index.getTemporaryFile(oldKey), "old-owner");

        assert.strictEqual(index.deleteTemporaryFile(oldKey), true);
        assert.strictEqual(index.getTemporaryFile(oldKey), undefined);

        index.setTemporaryFile(newKey, "new-owner");
        assert.strictEqual(index.getTemporaryFile(newKey), "new-owner");
        assert.strictEqual(index.getTemporaryFile(oldKey), undefined);
    });

    test("clears all endpoint namespaces", () => {
        const index = new FileLinkIndex<string>();
        const masterUri = canonicalFileUri("/workspace/master.luau");
        const temporaryUri = canonicalFileUri("/tmp/viewer.luau");
        const virtualKey = virtualIdentityKey({
            rootId: "11111111-1111-4111-8111-111111111111",
            primId: null,
            itemId: "22222222-2222-4222-8222-222222222222",
        });

        index.setMaster(masterUri, "master");
        index.setTemporaryFile(temporaryUri, "temporary");
        index.setVirtualFile(virtualKey, "virtual");
        index.clear();

        assert.strictEqual(index.getMaster(masterUri), undefined);
        assert.strictEqual(index.getTemporaryFile(temporaryUri), undefined);
        assert.strictEqual(index.getVirtualFile(virtualKey), undefined);
    });
});
