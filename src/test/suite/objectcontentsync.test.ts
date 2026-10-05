import * as assert from "assert";
import type { PublishedObject } from "#sl-ide-ws-client";
import {
    planPullExport,
    planPullTargets,
    resolvePullDestination,
    snapshotPullObject,
    stripGeneratedScriptMetadata,
} from "../../objectcontentsync";

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
