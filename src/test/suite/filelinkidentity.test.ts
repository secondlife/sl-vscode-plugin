import * as assert from "assert";
import * as path from "path";
import {
    canonicalFileUri,
    virtualIdentityKey,
} from "../../shared/filelinkidentity";
import { FileLinkIndex } from "../../shared/filelinkindex";

suite("File link identity", () => {
    test("canonicalizes equivalent filesystem paths to the same URI", () => {
        const basePath = path.join(process.cwd(), "workspace", "example.luau");
        const equivalentPath = path.join(
            process.cwd(),
            "workspace",
            "nested",
            "..",
            "example.luau",
        );

        assert.strictEqual(
            canonicalFileUri(basePath),
            canonicalFileUri(equivalentPath),
        );
    });

    test("keeps virtual identity stable when the display name changes", () => {
        const identity = {
            rootId: "11111111-1111-4111-8111-111111111111",
            primId: "22222222-2222-4222-8222-222222222222",
            itemId: "33333333-3333-4333-8333-333333333333",
        };

        assert.strictEqual(
            virtualIdentityKey(identity),
            virtualIdentityKey({ ...identity }),
        );
    });

    test("changes virtual identity when the inventory item changes", () => {
        const identity = {
            rootId: "11111111-1111-4111-8111-111111111111",
            primId: "22222222-2222-4222-8222-222222222222",
            itemId: "33333333-3333-4333-8333-333333333333",
        };
        const differentIdentity = {
            ...identity,
            itemId: "44444444-4444-4444-8444-444444444444",
        };

        assert.notStrictEqual(
            virtualIdentityKey(identity),
            virtualIdentityKey(differentIdentity),
        );
    });

    test("keeps master, temporary, and virtual indexes separate", () => {
        const index = new FileLinkIndex<string>();
        const masterUri = canonicalFileUri(
            path.join(process.cwd(), "workspace", "example.luau"),
        );
        const temporaryUri = canonicalFileUri(
            path.join(process.cwd(), "temp", "example.luau"),
        );
        const virtualKey = virtualIdentityKey({
            rootId: "11111111-1111-4111-8111-111111111111",
            primId: null,
            itemId: "33333333-3333-4333-8333-333333333333",
        });

        index.setMaster(masterUri, "master");
        index.setTemporaryFile(temporaryUri, "temporary");
        index.setVirtualFile(virtualKey, "virtual");

        assert.strictEqual(index.getMaster(masterUri), "master");
        assert.strictEqual(index.getTemporaryFile(temporaryUri), "temporary");
        assert.strictEqual(index.getVirtualFile(virtualKey), "virtual");
    });
});
