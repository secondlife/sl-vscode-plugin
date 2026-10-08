import * as assert from "assert";
import type { ObjectInventoryItem, PublishedObject } from "#sl-ide-ws-client";
import {
    buildCollisionPromptMessage,
    buildPushConfirmationMessage,
    findAmbiguousPushEntries,
    findConflictingPushEntries,
    findPushCollisions,
    planPullExport,
    planPullTargets,
    planPushSet,
    PullPathProbeResult,
    PushConfirmationContext,
    PushEntry,
    PushFile,
    PushInventoryItem,
    PushPublishedObjectSummary,
    PushResolvedEntry,
    resolveDirectorySegmentName,
    resolveFileSegmentName,
    resolvePullCollisionMode,
    resolvePullDestination,
    resolvePushDestinations,
    resolvePushTarget,
    snapshotPullObject,
    stripGeneratedScriptMetadata,
    summarizePushTargets,
    UnsafePullPathError,
} from "../../objectsyncutils";

suite("Object content sync", () => {
    test("flattens root and child inventories into a stable work list", () => {
        const object: PublishedObject = {
            object_id: "root-id",
            object_name: "Root Object",
            inventory: [
                {
                    item_id: "root-script",
                    name: "root",
                    type: "script",
                    subtype: 1,
                    permissions: { owner: 0xc000, next_owner: 0 },
                },
            ],
            linked_objects: [
                {
                    link_id: "child-id",
                    link_number: 2,
                    link_name: "Child Prim",
                    inventory: [
                        {
                            item_id: "child-notecard",
                            name: "notes",
                            type: "notecard",
                            permissions: { owner: 0x8000, next_owner: 0 },
                        },
                    ],
                },
            ],
        };

        const snapshot = snapshotPullObject(object);

        assert.deepStrictEqual(
            snapshot.items.map((item) => ({
                primId: item.primId,
                primName: item.primName,
                linkNumber: item.linkNumber,
                isRoot: item.isRoot,
                itemId: item.item.item_id,
            })),
            [
                {
                    primId: "root-id",
                    primName: "Root Object",
                    linkNumber: 1,
                    isRoot: true,
                    itemId: "root-script",
                },
                {
                    primId: "child-id",
                    primName: "Child Prim",
                    linkNumber: 2,
                    isRoot: false,
                    itemId: "child-notecard",
                },
            ],
        );
    });

    test("does not change when the published object is updated later", () => {
        const object: PublishedObject = {
            object_id: "root-id",
            object_name: "Original Root",
            inventory: [
                {
                    item_id: "root-script",
                    name: "original",
                    type: "script",
                    permissions: { owner: 0xc000, next_owner: 0 },
                },
            ],
        };

        const snapshot = snapshotPullObject(object);
        object.object_name = "Updated Root";
        object.inventory[0].name = "updated";
        object.inventory[0].permissions!.owner = 0;

        assert.strictEqual(snapshot.objectName, "Original Root");
        assert.strictEqual(snapshot.items[0].item.name, "original");
        assert.strictEqual(snapshot.items[0].item.permissions!.owner, 0xc000);
    });
});

suite("Object content pull eligibility", () => {
    test("exports only copyable items and links only modify-permitted items", () => {
        const object: PublishedObject = {
            object_id: "root-id",
            object_name: "Root Object",
            inventory: [
                {
                    item_id: "modifiable-script",
                    name: "modifiable",
                    type: "script",
                    permissions: { owner: 0xc000, next_owner: 0 },
                },
                {
                    item_id: "no-modify-notecard",
                    name: "readable notes",
                    type: "notecard",
                    permissions: { owner: 0x8000, next_owner: 0 },
                },
                {
                    item_id: "no-modify-script",
                    name: "protected script",
                    type: "script",
                    permissions: { owner: 0x8000, next_owner: 0 },
                },
                {
                    item_id: "no-copy-notecard",
                    name: "protected notes",
                    type: "notecard",
                    permissions: { owner: 0x4000, next_owner: 0 },
                },
                {
                    item_id: "unknown-permissions",
                    name: "unknown",
                    type: "notecard",
                },
            ],
        };

        const plan = planPullExport(snapshotPullObject(object));

        assert.deepStrictEqual(
            plan.exportable.map((item) => ({
                itemId: item.item.item_id,
                canLink: item.canLink,
            })),
            [
                { itemId: "modifiable-script", canLink: true },
                { itemId: "no-modify-notecard", canLink: false },
            ],
        );
        assert.deepStrictEqual(
            plan.skipped.map((item) => ({
                itemId: item.item.item.item_id,
                reason: item.reason,
            })),
            [
                { itemId: "no-modify-script", reason: "no-modify" },
                { itemId: "no-copy-notecard", reason: "no-copy" },
                { itemId: "unknown-permissions", reason: "permissions-unavailable" },
            ],
        );
    });
});

suite("Object content pull layout", () => {
    test("uses sanitized stable filenames and child-prim folders", () => {
        const object: PublishedObject = {
            object_id: "root-id",
            object_name: "Root Object",
            inventory: [
                {
                    item_id: "b-item",
                    name: "a/b",
                    type: "script",
                    subtype: 1,
                    permissions: { owner: 0xc000, next_owner: 0 },
                },
                {
                    item_id: "a-item",
                    name: "a:b",
                    type: "script",
                    subtype: 1,
                    permissions: { owner: 0xc000, next_owner: 0 },
                },
            ],
            linked_objects: [
                {
                    link_id: "child-id",
                    link_number: 2,
                    link_name: "Door/Panel",
                    inventory: [
                        {
                            item_id: "child-notecard",
                            name: "Card:One",
                            type: "notecard",
                            permissions: { owner: 0xc000, next_owner: 0 },
                        },
                    ],
                },
                {
                    link_id: "excluded-child-id",
                    link_number: 3,
                    link_name: "Excluded Child",
                    inventory: [
                        {
                            item_id: "excluded-item",
                            name: "protected",
                            type: "notecard",
                            permissions: { owner: 0x4000, next_owner: 0 },
                        },
                    ],
                },
                {
                    link_id: "empty-child-id",
                    link_number: 4,
                    link_name: "Empty Child",
                    inventory: [],
                },
            ],
        };

        const targets = planPullTargets(
            planPullExport(snapshotPullObject(object)),
        );

        assert.deepStrictEqual(
            targets.map((target) => ({
                itemId: target.item.item.item_id,
                relativeDirectory: target.relativeDirectory,
                fileName: target.fileName,
            })),
            [
                {
                    itemId: "a-item",
                    relativeDirectory: [],
                    fileName: "a_b.luau",
                },
                {
                    itemId: "b-item",
                    relativeDirectory: [],
                    fileName: "a_b_2.luau",
                },
                {
                    itemId: "child-notecard",
                    relativeDirectory: ["Door_Panel_2"],
                    fileName: "Card_One",
                },
            ],
        );
        assert.ok(
            targets.every(
                (target) => !target.relativeDirectory.includes("Empty_Child_4"),
            ),
        );
    });
});

function createProbe(
    entries: Map<string, PullPathProbeResult>,
): { calls: string[]; probe: (candidateName: string) => Promise<PullPathProbeResult> }
{
    const calls: string[] = [];

    return {
        calls,
        async probe(candidateName): Promise<PullPathProbeResult>
        {
            calls.push(candidateName);
            return entries.get(candidateName) ?? "missing";
        },
    };
}

suite("Object content pull directory segment resolution", () => {
    test("uses the exact name when it is missing", async () => {
        const { probe, calls } = createProbe(new Map());
        const name = await resolveDirectorySegmentName("Door_2", { probe });
        assert.strictEqual(name, "Door_2");
        assert.deepStrictEqual(calls, ["Door_2"]);
    });

    test("reuses the exact name when it is already a directory", async () => {
        const { probe } = createProbe(new Map([["Door_2", "directory"]]));
        const name = await resolveDirectorySegmentName("Door_2", { probe });
        assert.strictEqual(name, "Door_2");
    });

    test("unique-ifies the directory name when it is occupied by a file", async () => {
        const { probe, calls } = createProbe(
            new Map([
                ["Door_2", "file"],
                ["Door_2_2", "file"],
                ["Door_2_3", "missing"],
            ]),
        );
        const name = await resolveDirectorySegmentName("Door_2", { probe });
        assert.strictEqual(name, "Door_2_3");
        assert.deepStrictEqual(calls, ["Door_2", "Door_2_2", "Door_2_3"]);
    });

    test("rejects a symbolic link or junction", async () => {
        const { probe } = createProbe(new Map([["Door_2", "symlink"]]));
        await assert.rejects(
            resolveDirectorySegmentName("Door_2", { probe }),
            UnsafePullPathError,
        );
    });
});

suite("Object content pull file segment resolution", () => {
    test("uses the exact name when it is missing", async () => {
        const { probe } = createProbe(new Map());
        const resolved = await resolveFileSegmentName("script.lsl", { probe });
        assert.deepStrictEqual(resolved, { name: "script.lsl", existingFile: false });
    });

    test("reports an existing-file collision at the exact name", async () => {
        const { probe } = createProbe(new Map([["script.lsl", "file"]]));
        const resolved = await resolveFileSegmentName("script.lsl", { probe });
        assert.deepStrictEqual(resolved, { name: "script.lsl", existingFile: true });
    });

    test("unique-ifies the filename, preserving the extension, when occupied by a directory", async () => {
        const { probe, calls } = createProbe(new Map([["script.lsl", "directory"]]));
        const resolved = await resolveFileSegmentName("script.lsl", { probe });
        assert.deepStrictEqual(resolved, { name: "script_2.lsl", existingFile: false });
        assert.deepStrictEqual(calls, ["script.lsl", "script_2.lsl"]);
    });

    test("rejects a symbolic link or junction", async () => {
        const { probe } = createProbe(new Map([["script.lsl", "symlink"]]));
        await assert.rejects(
            resolveFileSegmentName("script.lsl", { probe }),
            UnsafePullPathError,
        );
    });
});

suite("Object content pull collision message", () => {
    test("builds a message naming existing files with no dirty warning", () => {
        const message = buildCollisionPromptMessage({
            existingNames: ["door.lsl"],
            dirtyNames: [],
        });

        assert.match(message, /1 file\(s\) already exist/);
        assert.match(message, /door\.lsl/);
        assert.doesNotMatch(message, /unsaved changes/);
    });
});

suite("Object content pull collision mode", () => {
    test("proceeds without prompting when nothing collides", async () => {
        let prompted = false;

        const mode = await resolvePullCollisionMode(
            { existingNames: [], dirtyNames: [] },
            {
                async promptCollisionMode() {
                    prompted = true;
                    return "overwrite";
                },
            },
        );

        assert.strictEqual(mode, "skip");
        assert.strictEqual(prompted, false);
    });

    test("prompts with a short name list when files collide", async () => {
        let promptedMessage = "";

        const mode = await resolvePullCollisionMode(
            { existingNames: ["door.lsl", "trigger.luau"], dirtyNames: [] },
            {
                async promptCollisionMode(message) {
                    promptedMessage = message;
                    return "skip";
                },
            },
        );

        assert.strictEqual(mode, "skip");
        assert.match(promptedMessage, /2 file\(s\)/);
        assert.match(promptedMessage, /door\.lsl, trigger\.luau/);
    });

    test("summarizes a long name list by count instead of listing every name", async () => {
        const existingNames = Array.from({ length: 11 }, (_, i) => `script_${i}.lsl`);
        let promptedMessage = "";

        await resolvePullCollisionMode(
            { existingNames, dirtyNames: [] },
            {
                async promptCollisionMode(message) {
                    promptedMessage = message;
                    return "overwrite";
                },
            },
        );

        assert.match(promptedMessage, /11 file\(s\)/);
        assert.match(promptedMessage, /11 files\./);
        assert.doesNotMatch(promptedMessage, /script_0\.lsl/);
    });

    test("warns about dirty files that cannot be overwritten", async () => {
        let promptedMessage = "";

        await resolvePullCollisionMode(
            { existingNames: ["door.lsl"], dirtyNames: ["door.lsl"] },
            {
                async promptCollisionMode(message) {
                    promptedMessage = message;
                    return "skip";
                },
            },
        );

        assert.match(promptedMessage, /1 of these are open with unsaved changes/);
    });

    test("returns undefined when the user cancels the prompt", async () => {
        const mode = await resolvePullCollisionMode(
            { existingNames: ["door.lsl"], dirtyNames: [] },
            {
                async promptCollisionMode() {
                    return undefined;
                },
            },
        );

        assert.strictEqual(mode, undefined);
    });
});

suite("Object content pull destination", () => {
    test("returns undefined without workspace roots", async () => {
        let rootPrompted = false;
        let folderPrompted = false;

        const destination = await resolvePullDestination(
            [],
            "Object",
            {
                async selectWorkspaceRoot() {
                    rootPrompted = true;
                    return undefined;
                },
                async enterDestinationFolder() {
                    folderPrompted = true;
                    return undefined;
                },
            },
        );

        assert.strictEqual(destination, undefined);
        assert.strictEqual(rootPrompted, false);
        assert.strictEqual(folderPrompted, false);
    });

    test("uses the only workspace root without prompting for it", async () => {
        let rootPrompted = false;
        let defaultFolderName = "";
        const root = { id: "root" };

        const destination = await resolvePullDestination(
            [{ label: "Workspace", value: root }],
            "Object/Name",
            {
                async selectWorkspaceRoot() {
                    rootPrompted = true;
                    return undefined;
                },
                async enterDestinationFolder(defaultName) {
                    defaultFolderName = defaultName;
                    return defaultName;
                },
            },
        );

        assert.strictEqual(rootPrompted, false);
        assert.strictEqual(defaultFolderName, "Object_Name");
        assert.deepStrictEqual(destination, {
            workspaceRoot: root,
            folderName: "Object_Name",
        });
    });

    test("prompts for multiple roots and sanitizes one folder segment", async () => {
        const firstRoot = { id: "first" };
        const secondRoot = { id: "second" };

        const destination = await resolvePullDestination(
            [
                { label: "First", value: firstRoot },
                { label: "Second", value: secondRoot },
            ],
            "Object",
            {
                async selectWorkspaceRoot(roots) {
                    assert.strictEqual(roots.length, 2);
                    return roots[1];
                },
                async enterDestinationFolder() {
                    return "Pulled/Objects";
                },
            },
        );

        assert.deepStrictEqual(destination, {
            workspaceRoot: secondRoot,
            folderName: "Pulled_Objects",
        });
    });

    test("returns undefined when the user cancels a destination prompt", async () => {
        const destination = await resolvePullDestination(
            [{ label: "Workspace", value: "root" }],
            "Object",
            {
                async selectWorkspaceRoot() {
                    return undefined;
                },
                async enterDestinationFolder() {
                    return undefined;
                },
            },
        );

        assert.strictEqual(destination, undefined);
    });
});

suite("Object content generated metadata", () => {
    test("removes a complete LSL plugin metadata block at the start", () => {
        const content = [
            "// ================ sl-vscode-plugin meta ================",
            "// @file scripts/main.lsl",
            "// @hash abc123",
            "// @date 2026-10-01 12:00:00",
            "// =======================================================",
            "default {",
            "    state_entry() { }",
            "}",
        ].join("\n");

        assert.strictEqual(
            stripGeneratedScriptMetadata(content, "//"),
            ["default {", "    state_entry() { }", "}"].join("\n"),
        );
    });

    test("removes generated LSL comments with compact and indented prefixes", () => {
        const content = [
            "// @line 1 \"file:///main.lsl\"",
            "    //@module 1",
            "\t// @creator Example Resident",
            "// authored comment",
            "string marker = \"// @line is text\";",
        ].join("\n");

        assert.strictEqual(
            stripGeneratedScriptMetadata(content, "//"),
            [
                "// authored comment",
                "string marker = \"// @line is text\";",
            ].join("\n"),
        );
    });

    test("removes generated Luau comments", () => {
        const content = [
            "-- @line 1 \"file:///main.luau\"",
            "--@module 1",
            "print(\"hello\")",
        ].join("\r\n");

        assert.strictEqual(
            stripGeneratedScriptMetadata(content, "--"),
            "print(\"hello\")",
        );
    });

    test("keeps user-authored @-tagged comments that are not a known generated tag", () => {
        const content = [
            "// @line 1 \"file:///main.lsl\"",
            "// @todo revisit this",
            "// @author Example Resident",
            "default { state_entry() { } }",
        ].join("\n");

        assert.strictEqual(
            stripGeneratedScriptMetadata(content, "//"),
            [
                "// @todo revisit this",
                "// @author Example Resident",
                "default { state_entry() { } }",
            ].join("\n"),
        );
    });

    test("treats a metadata block outside the first line as normal content", () => {
        const content = [
            "default {",
            "    // ================ sl-vscode-plugin meta ================",
            "    state_entry() { }",
            "}",
        ].join("\n");

        assert.strictEqual(stripGeneratedScriptMetadata(content, "//"), content);
    });

    test("leaves non-script content untouched", () => {
        const content = "// @file not a real banner, no commentPrefix passed";
        assert.strictEqual(stripGeneratedScriptMetadata(content, ""), content);
    });

    test("retains an incomplete metadata block while removing its generated lines", () => {
        const content = [
            "// ================ sl-vscode-plugin meta ================",
            "// @file scripts/main.lsl",
            "default { state_entry() { } }",
        ].join("\n");

        assert.strictEqual(
            stripGeneratedScriptMetadata(content, "//"),
            [
                "// ================ sl-vscode-plugin meta ================",
                "default { state_entry() { } }",
            ].join("\n"),
        );
    });
});

function inventoryItem(
    item_id: string,
    name: string,
    type: "script" | "notecard" = "script",
    subtype?: number,
): ObjectInventoryItem
{
    return { item_id, name, type, subtype };
}

suite("Push planning: file derivation", () => {
    test("derives a Luau script: type, vm and a target name without the extension", () => {
        const [entry] = planPushSet([
            { id: "file-1", masterId: "master-1", fileName: "widget.luau" },
        ]);

        assert.deepStrictEqual(entry, {
            id: "file-1",
            masterId: "master-1",
            type: "script",
            vm: "luau",
            targetName: "widget",
            matchName: "widget.luau",
        });
    });

    test("derives an LSL script as mono, matching the Phase 0 default", () => {
        const [entry] = planPushSet([
            { id: "file-2", masterId: "master-1", fileName: "widget.lsl" },
        ]);

        assert.strictEqual(entry.type, "script");
        assert.strictEqual(entry.vm, "mono");
        assert.strictEqual(entry.targetName, "widget");
        assert.strictEqual(entry.matchName, "widget.lsl");
    });

    test("derives a notecard: no vm, and the target name keeps the extension verbatim", () => {
        const [entry] = planPushSet([
            { id: "file-3", masterId: "master-1", fileName: "config.txt" },
        ]);

        assert.strictEqual(entry.type, "notecard");
        assert.strictEqual(entry.vm, undefined);
        assert.strictEqual(entry.targetName, "config.txt");
        assert.strictEqual(entry.matchName, "config.txt");
    });

    test("processes multiple files independently, preserving id and masterId", () => {
        const files: readonly PushFile[] = [
            { id: "a", masterId: "master-a", fileName: "one.luau" },
            { id: "b", masterId: "master-b", fileName: "two.lsl" },
        ];

        const entries = planPushSet(files);

        assert.strictEqual(entries.length, 2);
        assert.strictEqual(entries[0].id, "a");
        assert.strictEqual(entries[0].masterId, "master-a");
        assert.strictEqual(entries[1].id, "b");
        assert.strictEqual(entries[1].masterId, "master-b");
    });

    test("derives targetName from the same sanitised name as matchName, so two files that sanitise identically collide", () => {
        const files: readonly PushFile[] = [
            { id: "a", masterId: "master-a", fileName: "a:b.lsl" },
            { id: "b", masterId: "master-b", fileName: "a?b.lsl" },
        ];

        const entries = planPushSet(files);

        assert.strictEqual(entries[0].matchName, "a_b.lsl");
        assert.strictEqual(entries[1].matchName, "a_b.lsl");
        assert.strictEqual(entries[0].targetName, entries[1].targetName);
        assert.strictEqual(entries[0].targetName, "a_b");
    });
});

suite("Push planning: destination resolution", () => {
    test("link-first: a single linked item becomes the whole destination set", () => {
        const entry: PushEntry = {
            id: "e1", masterId: "master-1", type: "script", vm: "luau", targetName: "widget", matchName: "widget.luau",
        };
        const inventory: PushInventoryItem[] = [
            { item: inventoryItem("item-1", "widget", "script", 1), linkedMasterId: "master-1" },
        ];

        const [resolved] = resolvePushDestinations([entry], inventory);

        assert.deepStrictEqual(resolved.destinations, [
            { disposition: "linked-update", item: inventory[0].item },
        ]);
        assert.strictEqual(resolved.ambiguousType, undefined);
    });

    test("link-first: fans out to every item this master owns on the prim, ignoring a same-named unlinked item", () => {
        const entry: PushEntry = {
            id: "e1", masterId: "master-1", type: "script", vm: "luau", targetName: "widget", matchName: "widget.luau",
        };
        const linkedA = { item: inventoryItem("item-a", "widget_a", "script", 1), linkedMasterId: "master-1" };
        const linkedB = { item: inventoryItem("item-b", "widget_b", "script", 1), linkedMasterId: "master-1" };
        const unrelatedNameMatch = { item: inventoryItem("item-c", "widget", "script", 1) };
        const inventory: PushInventoryItem[] = [linkedA, linkedB, unrelatedNameMatch];

        const [resolved] = resolvePushDestinations([entry], inventory);

        assert.deepStrictEqual(resolved.destinations, [
            { disposition: "linked-update", item: linkedA.item },
            { disposition: "linked-update", item: linkedB.item },
        ]);
    });

    test("name match: reuses an unowned item of the correct type", () => {
        const entry: PushEntry = {
            id: "e1", masterId: "master-1", type: "notecard", targetName: "config.txt", matchName: "config.txt",
        };
        const inventory: PushInventoryItem[] = [
            { item: inventoryItem("item-1", "config.txt", "notecard") },
        ];

        const [resolved] = resolvePushDestinations([entry], inventory);

        assert.deepStrictEqual(resolved.destinations, [
            { disposition: "reuse", item: inventory[0].item },
        ]);
    });

    test("name match: an item owned by a different master is a relink, naming the previous owner", () => {
        const entry: PushEntry = {
            id: "e1", masterId: "master-new", type: "script", vm: "luau", targetName: "widget", matchName: "widget.luau",
        };
        const inventory: PushInventoryItem[] = [
            { item: inventoryItem("item-1", "widget", "script", 1), linkedMasterId: "master-old" },
        ];

        const [resolved] = resolvePushDestinations([entry], inventory);

        assert.deepStrictEqual(resolved.destinations, [
            { disposition: "relink", item: inventory[0].item, relinkedFromMasterId: "master-old" },
        ]);
    });

    test("name match: a same-named item of the other type marks the entry ambiguous, excluding it", () => {
        const entry: PushEntry = {
            id: "e1", masterId: "master-1", type: "script", vm: "mono", targetName: "config", matchName: "config.lsl",
        };
        const inventory: PushInventoryItem[] = [
            { item: inventoryItem("item-1", "config.lsl", "notecard") },
        ];

        const [resolved] = resolvePushDestinations([entry], inventory);

        assert.deepStrictEqual(resolved.destinations, []);
        assert.strictEqual(resolved.ambiguousType, "notecard");
    });

    test("no link and no name match: resolves to create", () => {
        const entry: PushEntry = {
            id: "e1", masterId: "master-1", type: "script", vm: "luau", targetName: "brand-new", matchName: "brand-new.luau",
        };

        const [resolved] = resolvePushDestinations([entry], []);

        assert.deepStrictEqual(resolved.destinations, [{ disposition: "create" }]);
        assert.strictEqual(resolved.ambiguousType, undefined);
    });
});

suite("Push planning: collisions", () => {
    test("reports two entries that would write the same item", () => {
        const sharedItem = inventoryItem("item-1", "widget", "script", 1);
        const resolved: PushResolvedEntry[] = [
            {
                entry: { id: "e1", masterId: "master-a", type: "script", vm: "luau", targetName: "widget", matchName: "widget.luau" },
                destinations: [{ disposition: "reuse", item: sharedItem }],
            },
            {
                entry: { id: "e2", masterId: "master-b", type: "script", vm: "luau", targetName: "widget-alias", matchName: "widget-alias.luau" },
                destinations: [{ disposition: "relink", item: sharedItem, relinkedFromMasterId: "master-a" }],
            },
        ];

        const collisions = findPushCollisions(resolved);

        assert.deepStrictEqual(collisions, [
            { kind: "overlapping-destination", entryIds: ["e1", "e2"], itemId: "item-1" },
        ]);
    });

    test("reports two entries that would both create the same target name", () => {
        const resolved: PushResolvedEntry[] = [
            {
                entry: { id: "e1", masterId: "master-a", type: "script", vm: "luau", targetName: "widget", matchName: "widget.luau" },
                destinations: [{ disposition: "create" }],
            },
            {
                entry: { id: "e2", masterId: "master-b", type: "script", vm: "luau", targetName: "widget", matchName: "widget.luau" },
                destinations: [{ disposition: "create" }],
            },
        ];

        const collisions = findPushCollisions(resolved);

        assert.deepStrictEqual(collisions, [
            { kind: "duplicate-create-name", entryIds: ["e1", "e2"], targetName: "widget" },
        ]);
    });

    test("does not report a collision for two entries sharing a target name but resolving to different items", () => {
        const itemA = inventoryItem("item-a", "widget", "script", 1);
        const itemB = inventoryItem("item-b", "widget", "script", 1);
        const resolved: PushResolvedEntry[] = [
            {
                entry: { id: "e1", masterId: "master-a", type: "script", vm: "luau", targetName: "widget", matchName: "widget.luau" },
                destinations: [{ disposition: "linked-update", item: itemA }],
            },
            {
                entry: { id: "e2", masterId: "master-b", type: "script", vm: "luau", targetName: "widget", matchName: "widget.luau" },
                destinations: [{ disposition: "linked-update", item: itemB }],
            },
        ];

        assert.deepStrictEqual(findPushCollisions(resolved), []);
    });

    test("reports no collisions for a clean batch", () => {
        const resolved: PushResolvedEntry[] = [
            {
                entry: { id: "e1", masterId: "master-a", type: "script", vm: "luau", targetName: "one", matchName: "one.luau" },
                destinations: [{ disposition: "create" }],
            },
            {
                entry: { id: "e2", masterId: "master-b", type: "notecard", targetName: "two.txt", matchName: "two.txt" },
                destinations: [{ disposition: "create" }],
            },
        ];

        assert.deepStrictEqual(findPushCollisions(resolved), []);
    });
});

suite("Push planning: ambiguous entries", () => {
    test("returns only entries excluded by a same-named item of a different type", () => {
        const resolved: PushResolvedEntry[] = [
            {
                entry: { id: "e1", masterId: "master-a", type: "script", vm: "luau", targetName: "widget", matchName: "widget.luau" },
                destinations: [],
                ambiguousType: "notecard",
            },
            {
                entry: { id: "e2", masterId: "master-b", type: "notecard", targetName: "two.txt", matchName: "two.txt" },
                destinations: [{ disposition: "create" }],
            },
        ];

        assert.deepStrictEqual(findAmbiguousPushEntries(resolved), [resolved[0]]);
    });

    test("returns an empty list when nothing is ambiguous", () => {
        const resolved: PushResolvedEntry[] = [
            {
                entry: { id: "e1", masterId: "master-a", type: "script", vm: "luau", targetName: "widget", matchName: "widget.luau" },
                destinations: [{ disposition: "create" }],
            },
        ];

        assert.deepStrictEqual(findAmbiguousPushEntries(resolved), []);
    });
});

suite("Push planning: conflicting entries", () => {
    test("returns entries with a reuse, relink, or linked-update destination", () => {
        const item = inventoryItem("item-1", "widget", "script", 1);
        const resolved: PushResolvedEntry[] = [
            {
                entry: { id: "e1", masterId: "master-a", type: "script", vm: "luau", targetName: "widget", matchName: "widget.luau" },
                destinations: [{ disposition: "reuse", item }],
            },
            {
                entry: { id: "e2", masterId: "master-b", type: "notecard", targetName: "two.txt", matchName: "two.txt" },
                destinations: [{ disposition: "create" }],
            },
        ];

        assert.deepStrictEqual(findConflictingPushEntries(resolved), [resolved[0]]);
    });

    test("returns an empty list when every entry is a pure create", () => {
        const resolved: PushResolvedEntry[] = [
            {
                entry: { id: "e1", masterId: "master-a", type: "script", vm: "luau", targetName: "widget", matchName: "widget.luau" },
                destinations: [{ disposition: "create" }],
            },
        ];

        assert.deepStrictEqual(findConflictingPushEntries(resolved), []);
    });

    test("treats a relink destination as a conflict", () => {
        const item = inventoryItem("item-1", "widget", "script", 1);
        const resolved: PushResolvedEntry[] = [
            {
                entry: { id: "e1", masterId: "master-a", type: "script", vm: "luau", targetName: "widget", matchName: "widget.luau" },
                destinations: [{ disposition: "relink", item, relinkedFromMasterId: "master-c" }],
            },
        ];

        assert.deepStrictEqual(findConflictingPushEntries(resolved), [resolved[0]]);
    });
});

suite("Push planning: confirmation message", () => {
    const context: PushConfirmationContext = {
        objectName: "Widget Maker",
        region: "Test Region",
        primLabel: "root prim",
    };

    test("leads with object, region and target prim", () => {
        const message = buildPushConfirmationMessage(context, [], { nestedDirectories: 0, notText: 0 });
        const lines = message.split("\n");

        assert.strictEqual(lines[0], "Push to Widget Maker (Test Region)");
        assert.strictEqual(lines[1], "Target: root prim");
    });

    test("omits the region parenthetical when absent", () => {
        const message = buildPushConfirmationMessage(
            { objectName: "Widget Maker", primLabel: "root prim" },
            [],
            { nestedDirectories: 0, notText: 0 },
        );

        assert.strictEqual(message.split("\n")[0], "Push to Widget Maker");
    });

    test("lists linked-update, reuse and create dispositions with resolved names", () => {
        const resolved: PushResolvedEntry[] = [
            {
                entry: { id: "a.luau", masterId: "m1", type: "script", vm: "luau", targetName: "a", matchName: "a.luau" },
                destinations: [{ disposition: "linked-update", item: inventoryItem("i1", "a", "script", 1) }],
            },
            {
                entry: { id: "b.txt", masterId: "m2", type: "notecard", targetName: "b.txt", matchName: "b.txt" },
                destinations: [{ disposition: "reuse", item: inventoryItem("i2", "b.txt", "notecard") }],
            },
            {
                entry: { id: "c.luau", masterId: "m3", type: "script", vm: "luau", targetName: "c", matchName: "c.luau" },
                destinations: [{ disposition: "create" }],
            },
        ];

        const message = buildPushConfirmationMessage(context, resolved, { nestedDirectories: 0, notText: 0 });

        assert.ok(message.includes('a.luau: linked update "a.luau"'));
        assert.ok(message.includes('b.txt: reuse "b.txt"'));
        assert.ok(message.includes('c.luau: create "c"'));
    });

    test("names the previous master on a relink line", () => {
        const resolved: PushResolvedEntry[] = [
            {
                entry: { id: "a.luau", masterId: "m-new", type: "script", vm: "luau", targetName: "a", matchName: "a.luau" },
                destinations: [{
                    disposition: "relink",
                    item: inventoryItem("i1", "a", "script", 1),
                    relinkedFromMasterId: "m-old",
                }],
            },
        ];

        const message = buildPushConfirmationMessage(context, resolved, { nestedDirectories: 0, notText: 0 });

        assert.ok(message.includes('a.luau: relink "a.luau" (currently updated by m-old)'));
    });

    test("pluralizes and includes exclusion counts only when nonzero", () => {
        const withOne = buildPushConfirmationMessage(context, [], { nestedDirectories: 1, notText: 0 });
        const withMany = buildPushConfirmationMessage(context, [], { nestedDirectories: 3, notText: 2 });
        const withNone = buildPushConfirmationMessage(context, [], { nestedDirectories: 0, notText: 0 });

        assert.ok(withOne.includes("1 nested directory ignored"));
        assert.ok(withMany.includes("3 nested directories ignored"));
        assert.ok(withMany.includes("2 file(s) skipped (not text)"));
        assert.ok(!withNone.includes("ignored"));
        assert.ok(!withNone.includes("skipped (not text)"));
    });

    test("lists ambiguous entries in exclusions, naming the found type, and excludes them from the destination lines", () => {
        const resolved: PushResolvedEntry[] = [
            {
                entry: { id: "config.lsl", masterId: "m1", type: "script", vm: "mono", targetName: "config.lsl", matchName: "config.lsl" },
                destinations: [],
                ambiguousType: "notecard",
            },
        ];

        const message = buildPushConfirmationMessage(context, resolved, { nestedDirectories: 0, notText: 0 });

        assert.ok(message.includes('config.lsl: skipped, found existing notecard named "config.lsl"'));
        assert.ok(!message.includes("linked update"));
        assert.ok(!message.includes("create"));
    });
});

suite("Push target selection: summarizing published objects", () => {
    test("summarizes root prim first, then every linked prim labeled with its link number", () => {
        const object: PublishedObject = {
            object_id: "root-id",
            object_name: "Widget Maker",
            region: "Test Region",
            inventory: [],
            linked_objects: [
                { link_id: "link-2", link_number: 2, link_name: "Gear", inventory: [] },
                { link_id: "link-3", link_number: 3, link_name: "Dial", inventory: [] },
            ],
        };

        const [summary] = summarizePushTargets([object]);

        assert.strictEqual(summary.objectId, "root-id");
        assert.strictEqual(summary.objectName, "Widget Maker");
        assert.strictEqual(summary.region, "Test Region");
        assert.deepStrictEqual(summary.prims, [
            { primId: "root-id", primLabel: "root prim" },
            { primId: "link-2", primLabel: "Gear (link 2)" },
            { primId: "link-3", primLabel: "Dial (link 3)" },
        ]);
    });

    test("summarizes an object with no linked prims as root only", () => {
        const object: PublishedObject = {
            object_id: "root-id",
            object_name: "Lone Object",
            inventory: [],
        };

        const [summary] = summarizePushTargets([object]);

        assert.deepStrictEqual(summary.prims, [{ primId: "root-id", primLabel: "root prim" }]);
    });
});

suite("Push target selection: resolving the picker sequence", () => {
    function objectSummary(
        overrides: Partial<PushPublishedObjectSummary> = {},
    ): PushPublishedObjectSummary
    {
        return {
            objectId: "root-id",
            objectName: "Widget Maker",
            region: "Test Region",
            prims: [
                { primId: "root-id", primLabel: "root prim" },
                { primId: "link-2", primLabel: "Gear (link 2)" },
            ],
            ...overrides,
        };
    }

    test("returns the combined object and prim selection", async () => {
        const object = objectSummary();

        const selection = await resolvePushTarget([object], {
            async selectObject(choices) {
                assert.strictEqual(choices.length, 1);
                return choices[0].value;
            },
            async selectPrim(choices) {
                assert.strictEqual(choices.length, 2);
                return choices[1].value;
            },
        });

        assert.deepStrictEqual(selection, {
            objectId: "root-id",
            objectName: "Widget Maker",
            region: "Test Region",
            primId: "link-2",
            primLabel: "Gear (link 2)",
        });
    });

    test("returns undefined without prompting for a prim when the object pick is dismissed", async () => {
        let primPrompted = false;

        const selection = await resolvePushTarget([objectSummary()], {
            async selectObject() {
                return undefined;
            },
            async selectPrim(choices) {
                primPrompted = true;
                return choices[0]?.value;
            },
        });

        assert.strictEqual(selection, undefined);
        assert.strictEqual(primPrompted, false);
    });

    test("returns undefined when the prim pick is dismissed", async () => {
        const selection = await resolvePushTarget([objectSummary()], {
            async selectObject(choices) {
                return choices[0].value;
            },
            async selectPrim() {
                return undefined;
            },
        });

        assert.strictEqual(selection, undefined);
    });

    test("returns undefined without prompting when there are no published objects", async () => {
        let objectPrompted = false;

        const selection = await resolvePushTarget([], {
            async selectObject(choices) {
                objectPrompted = true;
                return choices[0]?.value;
            },
            async selectPrim(choices) {
                return choices[0]?.value;
            },
        });

        assert.strictEqual(selection, undefined);
        assert.strictEqual(objectPrompted, false);
    });
});
