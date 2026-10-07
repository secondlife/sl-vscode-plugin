import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { ObjectContentService } from "#sl-ide-ws-client";
import { ObjectContentSync } from "../../vscode/objectcontentsync";
import { PushEntry } from "../../objectsyncutils";
import {
    createFakeScriptSync,
    createTestSynchService,
    masterKeyFor,
} from "./helpers/synchServiceTestHelpers";

function makeIntakeSync(): { sync: ObjectContentSync }
{
    const sync = new ObjectContentSync(
        {} as any,
        {} as any,
        () => true,
        () => { /* logInfo: no-op for this test */ },
        () => { /* logWarning: no-op for this test */ },
    );
    return { sync };
}

function makeSync(contentService: ObjectContentService): ObjectContentSync
{
    return new ObjectContentSync(
        contentService,
        createTestSynchService().service,
        () => true,
        () => { /* logInfo: no-op for this test */ },
        () => { /* logWarning: no-op for this test */ },
    );
}

suite("Push selection intake", () => {
    let tempDir: string;

    setup(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "push-intake-"));
    });

    teardown(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test("derives a push set from a mix of files", async () => {
        fs.writeFileSync(path.join(tempDir, "widget.luau"), "print('hi')", "utf8");
        fs.writeFileSync(path.join(tempDir, "config.txt"), "hello", "utf8");

        const { sync } = makeIntakeSync();
        const result = await sync.pushSelectedFiles([
            vscode.Uri.file(path.join(tempDir, "widget.luau")),
            vscode.Uri.file(path.join(tempDir, "config.txt")),
        ]);

        assert.strictEqual(result.nestedDirectories, 0);
        assert.strictEqual(result.skippedNotText, 0);
        assert.strictEqual(result.entries.length, 2);

        const widget = result.entries.find((e) => e.targetName === "widget");
        assert.ok(widget);
        assert.strictEqual(widget!.type, "script");
        assert.strictEqual(widget!.vm, "luau");
        assert.strictEqual(widget!.matchName, "widget.luau");

        const config = result.entries.find((e) => e.targetName === "config.txt");
        assert.ok(config);
        assert.strictEqual(config!.type, "notecard");
    });

    test("expands a selected folder one level, taking files only and counting nested directories", async () => {
        fs.writeFileSync(path.join(tempDir, "a.luau"), "-- a", "utf8");
        fs.writeFileSync(path.join(tempDir, "b.luau"), "-- b", "utf8");
        const nested = path.join(tempDir, "nested");
        fs.mkdirSync(nested);
        fs.writeFileSync(path.join(nested, "c.luau"), "-- c, never visited", "utf8");

        const { sync } = makeIntakeSync();
        const result = await sync.pushSelectedFiles([vscode.Uri.file(tempDir)]);

        assert.strictEqual(result.nestedDirectories, 1);
        assert.strictEqual(result.entries.length, 2);
        assert.deepStrictEqual(
            result.entries.map((e) => e.targetName).sort(),
            ["a", "b"],
        );
    });

    test("skips a file that does not decode as UTF-8, counting it and excluding it from the push set", async () => {
        fs.writeFileSync(path.join(tempDir, "ok.luau"), "-- fine", "utf8");
        // 0xC0 0x80 is an overlong, invalid UTF-8 encoding; 0xFF is never valid.
        fs.writeFileSync(path.join(tempDir, "binary.luau"), Buffer.from([0xC0, 0x80, 0xFF]));

        const { sync } = makeIntakeSync();
        const result = await sync.pushSelectedFiles([
            vscode.Uri.file(path.join(tempDir, "ok.luau")),
            vscode.Uri.file(path.join(tempDir, "binary.luau")),
        ]);

        assert.strictEqual(result.skippedNotText, 1);
        assert.strictEqual(result.entries.length, 1);
        assert.strictEqual(result.entries[0].targetName, "ok");
    });
});

suite("Push entry resolution against a live inventory snapshot", () => {
    const contentService = ObjectContentService.getInstance();

    teardown(() => {
        contentService.clear();
    });

    test("resolves to create when nothing in the prim matches", () => {
        contentService.handlePublish({
            object: {
                object_id: "root-id",
                object_name: "Widget Maker",
                inventory: [],
            },
        });

        const entry: PushEntry = {
            id: "widget.luau", masterId: "m1", type: "script", vm: "luau",
            targetName: "widget", matchName: "widget.luau",
        };

        const [resolved] = makeSync(contentService).resolvePushEntries("root-id", "root-id", [entry]);

        assert.deepStrictEqual(resolved.destinations, [{ disposition: "create" }]);
    });

    test("resolves to reuse when an unowned item of the correct type and name exists", () => {
        contentService.handlePublish({
            object: {
                object_id: "root-id",
                object_name: "Widget Maker",
                inventory: [
                    { item_id: "item-1", name: "widget", type: "script", subtype: 1 },
                ],
            },
        });

        const entry: PushEntry = {
            id: "widget.luau", masterId: "m1", type: "script", vm: "luau",
            targetName: "widget", matchName: "widget.luau",
        };

        const [resolved] = makeSync(contentService).resolvePushEntries("root-id", "root-id", [entry]);

        assert.strictEqual(resolved.destinations.length, 1);
        assert.strictEqual(resolved.destinations[0].disposition, "reuse");
    });

    test("resolves multiple entries independently against the same snapshot", () => {
        contentService.handlePublish({
            object: {
                object_id: "root-id",
                object_name: "Widget Maker",
                inventory: [
                    { item_id: "item-1", name: "widget", type: "script", subtype: 1 },
                ],
            },
        });

        const entries: PushEntry[] = [
            {
                id: "widget.luau", masterId: "m1", type: "script", vm: "luau",
                targetName: "widget", matchName: "widget.luau",
            },
            {
                id: "new.luau", masterId: "m2", type: "script", vm: "luau",
                targetName: "new", matchName: "new.luau",
            },
        ];

        const resolved = makeSync(contentService).resolvePushEntries("root-id", "root-id", entries);

        assert.strictEqual(resolved[0].destinations[0].disposition, "reuse");
        assert.strictEqual(resolved[1].destinations[0].disposition, "create");
    });
});

suite("Push entry resolution with master ownership", () => {
    const contentService = ObjectContentService.getInstance();

    teardown(() => {
        contentService.clear();
    });

    test("marks a destination linked-update when this entry's master already owns it on the target prim", () => {
        contentService.handlePublish({
            object: {
                object_id: "root-id",
                object_name: "Widget Maker",
                inventory: [
                    { item_id: "item-1", name: "widget_v2", type: "script", subtype: 1 },
                ],
            },
        });

        const masterUri = vscode.Uri.file("/workspace/widget.luau");
        const { service, activeSyncs } = createTestSynchService();
        const fake = createFakeScriptSync({
            masterUri,
            snapshots: [{
                kind: "virtual",
                identity: { rootId: "root-id", primId: null, itemId: "item-1" },
            }],
        });
        activeSyncs.set(masterKeyFor(masterUri), fake.sync);

        const sync = new ObjectContentSync(contentService, service, () => true, () => {}, () => {});

        const entry: PushEntry = {
            id: "widget.luau", masterId: masterUri.fsPath, type: "script", vm: "luau",
            targetName: "widget", matchName: "widget.luau",
        };

        const [resolved] = sync.resolvePushEntries("root-id", "root-id", [entry]);

        assert.strictEqual(resolved.destinations.length, 1);
        assert.strictEqual(resolved.destinations[0].disposition, "linked-update");
        assert.strictEqual((resolved.destinations[0] as { item: { item_id: string } }).item.item_id, "item-1");
    });

    test("marks a name match as relink when the item is owned by a different master", () => {
        contentService.handlePublish({
            object: {
                object_id: "root-id",
                object_name: "Widget Maker",
                inventory: [
                    { item_id: "item-1", name: "widget", type: "script", subtype: 1 },
                ],
            },
        });

        const otherMasterUri = vscode.Uri.file("/workspace/old-widget.luau");
        const { service, activeSyncs } = createTestSynchService();
        const fake = createFakeScriptSync({
            masterUri: otherMasterUri,
            snapshots: [{
                kind: "virtual",
                identity: { rootId: "root-id", primId: null, itemId: "item-1" },
            }],
        });
        activeSyncs.set(masterKeyFor(otherMasterUri), fake.sync);

        const sync = new ObjectContentSync(contentService, service, () => true, () => {}, () => {});

        const entry: PushEntry = {
            id: "widget.luau", masterId: "/workspace/widget.luau", type: "script", vm: "luau",
            targetName: "widget", matchName: "widget.luau",
        };

        const [resolved] = sync.resolvePushEntries("root-id", "root-id", [entry]);

        assert.strictEqual(resolved.destinations.length, 1);
        assert.strictEqual(resolved.destinations[0].disposition, "relink");
        assert.strictEqual(
            (resolved.destinations[0] as { relinkedFromMasterId: string }).relinkedFromMasterId,
            otherMasterUri.fsPath,
        );
    });

    test("falls through to create when the entry's master has no active sync", () => {
        contentService.handlePublish({
            object: {
                object_id: "root-id",
                object_name: "Widget Maker",
                inventory: [],
            },
        });

        const { service } = createTestSynchService();
        const sync = new ObjectContentSync(contentService, service, () => true, () => {}, () => {});

        const entry: PushEntry = {
            id: "widget.luau", masterId: "/workspace/widget.luau", type: "script", vm: "luau",
            targetName: "widget", matchName: "widget.luau",
        };

        const [resolved] = sync.resolvePushEntries("root-id", "root-id", [entry]);

        assert.deepStrictEqual(resolved.destinations, [{ disposition: "create" }]);
    });
});

suite("Push planning: collision check composed with real resolution", () => {
    const contentService = ObjectContentService.getInstance();

    teardown(() => {
        contentService.clear();
    });

    test("aborts with a collision when two entries resolve to the same item", () => {
        contentService.handlePublish({
            object: {
                object_id: "root-id",
                object_name: "Widget Maker",
                inventory: [
                    { item_id: "item-1", name: "widget", type: "script", subtype: 1 },
                ],
            },
        });

        const masterUri = vscode.Uri.file("/workspace/widget.luau");
        const { service, activeSyncs } = createTestSynchService();
        const fake = createFakeScriptSync({
            masterUri,
            snapshots: [{
                kind: "virtual",
                identity: { rootId: "root-id", primId: null, itemId: "item-1" },
            }],
        });
        activeSyncs.set(masterKeyFor(masterUri), fake.sync);

        const sync = new ObjectContentSync(contentService, service, () => true, () => {}, () => {});

        // Entry A is linked to item-1; entry B's name also matches it. Both
        // would write item-1, which is the collision.
        const entries: PushEntry[] = [
            {
                id: "widget.luau", masterId: masterUri.fsPath, type: "script", vm: "luau",
                targetName: "widget", matchName: "widget.luau",
            },
            {
                id: "alias.luau", masterId: "/workspace/alias.luau", type: "script", vm: "luau",
                targetName: "widget", matchName: "widget.luau",
            },
        ];

        const outcome = sync.planPush("root-id", "root-id", entries);

        assert.strictEqual(outcome.outcome, "collision");
        if (outcome.outcome === "collision")
        {
            assert.strictEqual(outcome.collisions.length, 1);
            assert.strictEqual(outcome.collisions[0].kind, "overlapping-destination");
        }
    });

    test("aborts with a collision when two entries would both create the same name", () => {
        contentService.handlePublish({
            object: { object_id: "root-id", object_name: "Widget Maker", inventory: [] },
        });

        const { service } = createTestSynchService();
        const sync = new ObjectContentSync(contentService, service, () => true, () => {}, () => {});

        const entries: PushEntry[] = [
            {
                id: "a.luau", masterId: "/workspace/a.luau", type: "script", vm: "luau",
                targetName: "widget", matchName: "a.luau",
            },
            {
                id: "b.luau", masterId: "/workspace/b.luau", type: "script", vm: "luau",
                targetName: "widget", matchName: "b.luau",
            },
        ];

        const outcome = sync.planPush("root-id", "root-id", entries);

        assert.strictEqual(outcome.outcome, "collision");
        if (outcome.outcome === "collision")
        {
            assert.strictEqual(outcome.collisions[0].kind, "duplicate-create-name");
        }
    });

    test("resolves normally when nothing collides", () => {
        contentService.handlePublish({
            object: {
                object_id: "root-id", object_name: "Widget Maker",
                permissions: { owner: 0x4000 }, inventory: [],
            },
        });

        const { service } = createTestSynchService();
        const sync = new ObjectContentSync(contentService, service, () => true, () => {}, () => {});

        const entries: PushEntry[] = [
            {
                id: "a.luau", masterId: "/workspace/a.luau", type: "script", vm: "luau",
                targetName: "a", matchName: "a.luau",
            },
        ];

        const outcome = sync.planPush("root-id", "root-id", entries);

        assert.strictEqual(outcome.outcome, "resolved");
        if (outcome.outcome === "resolved")
        {
            assert.strictEqual(outcome.resolved.length, 1);
            assert.strictEqual(outcome.resolved[0].destinations[0].disposition, "create");
        }
    });
});

suite("Push planning: pre-flight validation", () => {
    const contentService = ObjectContentService.getInstance();

    teardown(() => {
        contentService.clear();
    });

    const validEntry: PushEntry = {
        id: "a.luau", masterId: "/workspace/a.luau", type: "script", vm: "luau",
        targetName: "a", matchName: "a.luau",
    };

    test("aborts as not-connected even when the object is not published either", () => {
        const { service } = createTestSynchService();
        const sync = new ObjectContentSync(contentService, service, () => false, () => {}, () => {});

        const outcome = sync.planPush("root-id", "root-id", [validEntry]);

        assert.deepStrictEqual(outcome, { outcome: "invalid", failure: { reason: "not-connected" } });
    });

    test("aborts as object-not-published when connected but the object isn't tracked", () => {
        const { service } = createTestSynchService();
        const sync = new ObjectContentSync(contentService, service, () => true, () => {}, () => {});

        const outcome = sync.planPush("root-id", "root-id", [validEntry]);

        assert.deepStrictEqual(outcome, { outcome: "invalid", failure: { reason: "object-not-published" } });
    });

    test("aborts as no-modify-on-prim for a root prim lacking PERM_MODIFY", () => {
        contentService.handlePublish({
            object: {
                object_id: "root-id", object_name: "Widget Maker",
                permissions: { owner: 0 }, inventory: [],
            },
        });

        const { service } = createTestSynchService();
        const sync = new ObjectContentSync(contentService, service, () => true, () => {}, () => {});

        const outcome = sync.planPush("root-id", "root-id", [validEntry]);

        assert.deepStrictEqual(outcome, { outcome: "invalid", failure: { reason: "no-modify-on-prim" } });
    });

    test("aborts as no-modify-on-prim for a linked prim lacking PERM_MODIFY", () => {
        contentService.handlePublish({
            object: {
                object_id: "root-id", object_name: "Widget Maker",
                permissions: { owner: 0x4000 }, inventory: [],
                linked_objects: [
                    { link_id: "link-2", link_number: 2, link_name: "Child", permissions: { owner: 0 }, inventory: [] },
                ],
            },
        });

        const { service } = createTestSynchService();
        const sync = new ObjectContentSync(contentService, service, () => true, () => {}, () => {});

        const outcome = sync.planPush("root-id", "link-2", [validEntry]);

        assert.deepStrictEqual(outcome, { outcome: "invalid", failure: { reason: "no-modify-on-prim" } });
    });

    test("aborts as no-modify-on-items, naming the item, when an existing destination lacks PERM_MODIFY", () => {
        contentService.handlePublish({
            object: {
                object_id: "root-id", object_name: "Widget Maker",
                permissions: { owner: 0x4000 },
                inventory: [
                    { item_id: "item-1", name: "a", type: "script", subtype: 1, permissions: { owner: 0, next_owner: 0 } },
                ],
            },
        });

        const { service } = createTestSynchService();
        const sync = new ObjectContentSync(contentService, service, () => true, () => {}, () => {});

        const outcome = sync.planPush("root-id", "root-id", [validEntry]);

        assert.deepStrictEqual(
            outcome,
            { outcome: "invalid", failure: { reason: "no-modify-on-items", itemIds: ["item-1"] } },
        );
    });

    test("resolves normally when connected, published, and every permission check passes", () => {
        contentService.handlePublish({
            object: {
                object_id: "root-id", object_name: "Widget Maker",
                permissions: { owner: 0x4000 }, inventory: [],
            },
        });

        const { service } = createTestSynchService();
        const sync = new ObjectContentSync(contentService, service, () => true, () => {}, () => {});

        const outcome = sync.planPush("root-id", "root-id", [validEntry]);

        assert.strictEqual(outcome.outcome, "resolved");
    });
});

suite("Push planning: dirty-file partitioning before save", () => {
    test("excludes an already-linked master, keeping an unrelated dirty file safe to save", async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "push-dirty-"));
        const linkedPath = path.join(tempDir, "linked.luau");
        const unrelatedPath = path.join(tempDir, "unrelated.luau");
        fs.writeFileSync(linkedPath, "-- original", "utf8");
        fs.writeFileSync(unrelatedPath, "-- original", "utf8");

        const linkedDoc = await vscode.workspace.openTextDocument(vscode.Uri.file(linkedPath));
        const unrelatedDoc = await vscode.workspace.openTextDocument(vscode.Uri.file(unrelatedPath));
        const edit = new vscode.WorkspaceEdit();
        edit.insert(linkedDoc.uri, new vscode.Position(0, 0), "-- edited\n");
        edit.insert(unrelatedDoc.uri, new vscode.Position(0, 0), "-- edited\n");
        await vscode.workspace.applyEdit(edit);

        const { service, activeSyncs } = createTestSynchService();
        const fake = createFakeScriptSync({ masterUri: linkedDoc.uri });
        activeSyncs.set(masterKeyFor(linkedDoc.uri), fake.sync);

        const sync = new ObjectContentSync(
            ObjectContentService.getInstance(), service, () => true, () => {}, () => {},
        );

        const entries: PushEntry[] = [
            {
                id: "linked.luau", masterId: linkedPath, type: "script", vm: "luau",
                targetName: "linked", matchName: "linked.luau",
            },
            {
                id: "unrelated.luau", masterId: unrelatedPath, type: "script", vm: "luau",
                targetName: "unrelated", matchName: "unrelated.luau",
            },
        ];

        const { safeToSave, alreadyLinked } = sync.partitionDirtyPushFiles(entries);

        assert.deepStrictEqual(
            safeToSave.map((u) => u.fsPath),
            [vscode.Uri.file(unrelatedPath).fsPath],
        );
        assert.deepStrictEqual(
            alreadyLinked.map((u) => u.fsPath),
            [vscode.Uri.file(linkedPath).fsPath],
        );

        await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
        fs.rmSync(tempDir, { recursive: true, force: true });
    });
});
