import * as assert from "assert";
import {
    LinkedObject,
    ObjectContentChangeEvent,
    ObjectContentService,
    ObjectInventoryItem,
    ObjectTreeChangeEvent,
} from "#sl-ide-ws-client";

const rootId = "11111111-1111-4111-8111-111111111111";
const childPrimId = "22222222-2222-4222-8222-222222222222";
const retainedItemId = "33333333-3333-4333-8333-333333333333";
const removedItemId = "44444444-4444-4444-8444-444444444444";

function scriptItem(item_id: string, name: string): ObjectInventoryItem
{
    return {
        item_id,
        name,
        type: "script",
    };
}

function publishedObject(
    inventory: ObjectInventoryItem[] = [],
    linked_objects: LinkedObject[] = [],
)
{
    return {
        object_id: rootId,
        object_name: "Test Object",
        inventory,
        linked_objects,
    };
}

suite("ObjectContentService inventory removal events", () => {
    let service: ObjectContentService;

    setup(() => {
        service = ObjectContentService.getInstance();
    });

    teardown(() => {
        service.dispose();
    });

    test("reports removed root inventory items from delta updates", () => {
        service.handlePublish({
            object: publishedObject([
                scriptItem(removedItemId, "Removed.luau"),
            ]),
        });

        let event: ObjectTreeChangeEvent | undefined;
        service.onDidChangeObjects((change) => {
            event = change;
        });

        service.handleUpdate({
            object_id: rootId,
            changes: {
                inventory: {
                    removed: [removedItemId],
                },
            },
        });

        assert.deepStrictEqual(event?.removed_items, [
            { prim_id: rootId, item_id: removedItemId },
        ]);
    });

    test("reports removed items from a full root inventory replacement", () => {
        service.handlePublish({
            object: publishedObject([
                scriptItem(retainedItemId, "Retained.luau"),
                scriptItem(removedItemId, "Removed.luau"),
            ]),
        });

        let event: ObjectTreeChangeEvent | undefined;
        service.onDidChangeObjects((change) => {
            event = change;
        });

        service.handleUpdate({
            object_id: rootId,
            inventory: [
                scriptItem(retainedItemId, "Retained.luau"),
            ],
        });

        assert.deepStrictEqual(event?.removed_items, [
            { prim_id: rootId, item_id: removedItemId },
        ]);
    });

    test("reports removed items from a full linked-prim inventory replacement", () => {
        service.handlePublish({
            object: publishedObject([], [
                {
                    link_id: childPrimId,
                    link_number: 2,
                    link_name: "Child",
                    inventory: [
                        scriptItem(removedItemId, "Removed.luau"),
                    ],
                },
            ]),
        });

        let event: ObjectTreeChangeEvent | undefined;
        service.onDidChangeObjects((change) => {
            event = change;
        });

        service.handleUpdate({
            object_id: rootId,
            linked_objects: [
                {
                    link_id: childPrimId,
                    link_number: 2,
                    link_name: "Child",
                    inventory: [],
                },
            ],
        });

        assert.deepStrictEqual(event?.removed_items, [
            { prim_id: childPrimId, item_id: removedItemId },
        ]);
        assert.deepStrictEqual(event?.removed_link_ids, []);
    });

    test("reports all items when a linked prim is removed", () => {
        service.handlePublish({
            object: publishedObject([], [
                {
                    link_id: childPrimId,
                    link_number: 2,
                    link_name: "Child",
                    inventory: [
                        scriptItem(removedItemId, "Removed.luau"),
                    ],
                },
            ]),
        });

        let event: ObjectTreeChangeEvent | undefined;
        service.onDidChangeObjects((change) => {
            event = change;
        });

        service.handleUpdate({
            object_id: rootId,
            linked_objects: [],
        });

        assert.deepStrictEqual(event?.removed_link_ids, [childPrimId]);
        assert.deepStrictEqual(event?.removed_items, [
            { prim_id: childPrimId, item_id: removedItemId },
        ]);
    });

    test("keeps content invalidation separate for surviving items", () => {
        service.handlePublish({
            object: publishedObject([
                scriptItem(retainedItemId, "Retained.luau"),
            ]),
        });

        let treeEvent: ObjectTreeChangeEvent | undefined;
        let contentEvent: ObjectContentChangeEvent | undefined;
        service.onDidChangeObjects((change) => {
            treeEvent = change;
        });
        service.onDidChangeContent((change) => {
            contentEvent = change;
        });

        service.handleUpdate({
            object_id: rootId,
            changes: {
                inventory: {
                    content_changed: [retainedItemId],
                },
            },
        });

        assert.strictEqual(treeEvent?.removed_items, undefined);
        assert.deepStrictEqual(contentEvent, {
            object_id: rootId,
            prim_id: rootId,
            item_id: retainedItemId,
        });
    });
});
