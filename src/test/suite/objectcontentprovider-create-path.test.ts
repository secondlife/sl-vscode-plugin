import * as assert from "assert";
import * as vscode from "vscode";
import { ObjectContentService } from "#sl-ide-ws-client";
import { ObjectContentProvider, createUri, rootUri, linkedPrimUri } from "../../vscode/objectcontentprovider";

function makeProvider(contentService: ObjectContentService): ObjectContentProvider
{
    return new ObjectContentProvider(
        contentService,
        () => undefined,
        () => { /* addSaveDiagnostics: no-op for this test */ },
    );
}

suite("ObjectContentProvider: /+create/ path parsing", () => {
    const contentService = ObjectContentService.getInstance();

    setup(() => {
        contentService.handlePublish({
            object: {
                object_id: "object-1",
                object_name: "Widget Maker",
                inventory: [],
                linked_objects: [{
                    link_id: "link-1",
                    link_number: 2,
                    link_name: "Child",
                    inventory: [],
                }],
            },
        });
    });

    teardown(() => {
        contentService.clear();
    });

    test("stats the bare root-prim /+create directory without throwing", () => {
        const provider = makeProvider(contentService);
        const bareCreateUri = vscode.Uri.from({
            scheme: rootUri("object-1").scheme,
            authority: rootUri("object-1").authority,
            path: "/object-1/+create",
        });

        const stat = provider.stat(bareCreateUri);

        assert.strictEqual(stat.type, vscode.FileType.Directory);
        assert.strictEqual(stat.permissions, undefined);
    });

    test("stats the bare linked-prim /+create directory without throwing", () => {
        const provider = makeProvider(contentService);
        const bareCreateUri = vscode.Uri.from({
            scheme: linkedPrimUri("object-1", "link-1").scheme,
            authority: linkedPrimUri("object-1", "link-1").authority,
            path: "/object-1/link-1/+create",
        });

        const stat = provider.stat(bareCreateUri);

        assert.strictEqual(stat.type, vscode.FileType.Directory);
        assert.strictEqual(stat.permissions, undefined);
    });

    test("still stats the full /+create/{filename} path as a writable file", () => {
        const provider = makeProvider(contentService);
        const fullCreateUri = createUri("object-1", "object-1", "widget.lsl");

        const stat = provider.stat(fullCreateUri);

        assert.strictEqual(stat.type, vscode.FileType.File);
        assert.strictEqual(stat.permissions, undefined);
    });
});
