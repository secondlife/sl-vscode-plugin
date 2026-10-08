import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { ObjectContentService } from "#sl-ide-ws-client";
import { ObjectContentSync } from "../../vscode/objectcontentsync";
import { PushEntry, PushResolvedEntry, PushSummary } from "../../objectsyncutils";
import { SynchService } from "../../synchservice";
import { createFakeScriptSync, createTestSynchService, masterKeyFor } from "./helpers/synchServiceTestHelpers";

function makeSync(contentService: ObjectContentService, service?: SynchService): ObjectContentSync
{
    return new ObjectContentSync(
        contentService,
        service ?? createTestSynchService().service,
        () => true,
        () => { /* logInfo: no-op for this test */ },
        () => { /* logWarning: no-op for this test */ },
    );
}

function emptySummary(): PushSummary
{
    return {
        updated: 0,
        created: 0,
        createdContentSaveFailed: 0,
        compileFailed: 0,
        preprocessorError: 0,
        skippedNotText: 0,
        skippedNestedDirectory: 0,
        skippedTypeMismatch: 0,
        failed: 0,
        cancelled: false,
    };
}

function inventoryItem(itemId: string, name: string)
{
    return { item_id: itemId, name, type: "notecard" as const };
}

suite("Push content production", () => {
    let tempDir: string;

    setup(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "push-content-"));
    });

    teardown(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test("sends notecard content verbatim, with no preprocessing", async () => {
        const filePath = path.join(tempDir, "config.txt");
        fs.writeFileSync(filePath, "#define NOT_A_DIRECTIVE\nplain text", "utf8");

        const entry: PushEntry = {
            id: "config.txt", masterId: filePath, type: "notecard",
            targetName: "config.txt", matchName: "config.txt",
        };

        const result = await makeSync(ObjectContentService.getInstance()).producePushContent(entry);

        assert.strictEqual(result.success, true);
        assert.strictEqual(result.content, "#define NOT_A_DIRECTIVE\nplain text");
    });

    test("preprocesses a script's content", async () => {
        const filePath = path.join(tempDir, "widget.lsl");
        fs.writeFileSync(
            filePath,
            "#define GREETING \"hi\"\ndefault { state_entry() { llSay(0, GREETING); } }",
            "utf8",
        );

        const entry: PushEntry = {
            id: "widget.lsl", masterId: filePath, type: "script", vm: "mono",
            targetName: "widget", matchName: "widget.lsl",
        };

        const result = await makeSync(ObjectContentService.getInstance()).producePushContent(entry);

        assert.strictEqual(result.success, true);
        assert.ok(result.content.includes('llSay(0, "hi")'), result.content);
    });

    test("derives language from the file extension, not the compile target vm", async () => {
        // An LSL file targeting the luau VM: `vm` alone cannot say the source is LSL.
        const filePath = path.join(tempDir, "widget.lsl");
        fs.writeFileSync(
            filePath,
            "#define GREETING \"hi\"\ndefault { state_entry() { llSay(0, GREETING); } }",
            "utf8",
        );

        const entry: PushEntry = {
            id: "widget.lsl", masterId: filePath, type: "script", vm: "luau",
            targetName: "widget", matchName: "widget.lsl",
        };

        const result = await makeSync(ObjectContentService.getInstance()).producePushContent(entry);

        assert.strictEqual(result.success, true);
        assert.ok(result.content.includes('llSay(0, "hi")'), result.content);
    });

    test("prefers an already-open document's live buffer over stale disk content", async () => {
        const filePath = path.join(tempDir, "widget.luau");
        fs.writeFileSync(filePath, "print('original')", "utf8");

        const document = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
        const edit = new vscode.WorkspaceEdit();
        edit.replace(
            document.uri,
            new vscode.Range(0, 0, document.lineCount, 0),
            "print('edited')",
        );
        await vscode.workspace.applyEdit(edit);

        const entry: PushEntry = {
            id: "widget.luau", masterId: filePath, type: "script", vm: "luau",
            targetName: "widget", matchName: "widget.luau",
        };

        const result = await makeSync(ObjectContentService.getInstance()).producePushContent(entry);

        assert.strictEqual(result.success, true);
        assert.ok(result.content.includes("edited"), result.content);
        assert.ok(!result.content.includes("original"), result.content);

        await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
    });

    test("reports failure without throwing when preprocessing errors, and releases the sync it created", async () => {
        const filePath = path.join(tempDir, "broken.lsl");
        fs.writeFileSync(
            filePath,
            "#define DEBUG 1\n#ifdef DEBUG\ninteger x = 1;\n" +
            "// Missing #endif\ndefault { state_entry() {} }",
            "utf8",
        );

        const { service, activeSyncs } = createTestSynchService();
        const entry: PushEntry = {
            id: "broken.lsl", masterId: filePath, type: "script", vm: "mono",
            targetName: "broken", matchName: "broken.lsl",
        };

        const result = await makeSync(ObjectContentService.getInstance(), service).producePushContent(entry);

        assert.strictEqual(result.success, false);
        assert.strictEqual(activeSyncs.size, 0);
    });
});

suite("Push execution: update pass", () => {
    let tempDir: string;
    const contentService = ObjectContentService.getInstance();

    setup(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "push-exec-"));
        contentService.handlePublish({
            object: {
                object_id: "object-1",
                object_name: "Widget Maker",
                inventory: [],
            },
        });
    });

    teardown(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
        contentService.clear();
    });

    test("writes once per non-create destination, skipping creates", async () => {
        const filePath = path.join(tempDir, "config.txt");
        fs.writeFileSync(filePath, "plain text", "utf8");

        const entry: PushEntry = {
            id: "config.txt", masterId: filePath, type: "notecard",
            targetName: "config.txt", matchName: "config.txt",
        };
        const resolved: readonly PushResolvedEntry[] = [{
            entry,
            destinations: [
                { disposition: "reuse", item: inventoryItem("item-1", "config.txt") },
                { disposition: "create" },
            ],
        }];
        const summary = emptySummary();
        const writes: Array<{ uri: vscode.Uri; content: string }> = [];

        await makeSync(contentService).pushUpdates(
            "object-1", "object-1", resolved, summary,
            new vscode.CancellationTokenSource().token,
            async (uri, content) => { writes.push({ uri, content }); },
        );

        assert.strictEqual(writes.length, 1);
        assert.strictEqual(writes[0].content, "plain text");
        assert.strictEqual(summary.updated, 1);
    });

    test("reports progress once per destination, scaled by the provided total", async () => {
        const filePath = path.join(tempDir, "config.txt");
        fs.writeFileSync(filePath, "plain text", "utf8");

        const entry: PushEntry = {
            id: "config.txt", masterId: filePath, type: "notecard",
            targetName: "config.txt", matchName: "config.txt",
        };
        const resolved: readonly PushResolvedEntry[] = [{
            entry,
            destinations: [
                { disposition: "reuse", item: inventoryItem("item-1", "config.txt") },
                { disposition: "relink", item: inventoryItem("item-2", "config.txt"), relinkedFromMasterId: "other" },
            ],
        }];
        const summary = emptySummary();
        const reports: Array<{ message?: string; increment?: number }> = [];

        await makeSync(contentService).pushUpdates(
            "object-1", "object-1", resolved, summary,
            new vscode.CancellationTokenSource().token,
            async () => { /* write succeeds */ },
            { report: (value) => { reports.push(value); } },
            4,
        );

        assert.strictEqual(reports.length, 2);
        assert.strictEqual(reports[0].increment, 25);
        assert.strictEqual(reports[1].increment, 25);
    });

    test("reports progress for each destination even when preprocessing fails", async () => {
        const filePath = path.join(tempDir, "broken.lsl");
        fs.writeFileSync(
            filePath,
            "#define DEBUG 1\n#ifdef DEBUG\ninteger x = 1;\n" +
            "// Missing #endif\ndefault { state_entry() {} }",
            "utf8",
        );

        const entry: PushEntry = {
            id: "broken.lsl", masterId: filePath, type: "script", vm: "mono",
            targetName: "broken", matchName: "broken.lsl",
        };
        const resolved: readonly PushResolvedEntry[] = [{
            entry,
            destinations: [
                { disposition: "reuse", item: inventoryItem("item-1", "broken.lsl") },
                { disposition: "reuse", item: inventoryItem("item-2", "broken.lsl") },
            ],
        }];
        const summary = emptySummary();
        const reports: Array<{ message?: string; increment?: number }> = [];

        await makeSync(contentService).pushUpdates(
            "object-1", "object-1", resolved, summary,
            new vscode.CancellationTokenSource().token,
            async () => { /* unreachable */ },
            { report: (value) => { reports.push(value); } },
            2,
        );

        assert.strictEqual(reports.length, 2);
        assert.ok(reports[0].message?.includes("preprocessing failed"), reports[0].message);
    });

    test("preprocesses once per entry and writes the same content to every destination", async () => {
        const filePath = path.join(tempDir, "widget.lsl");
        fs.writeFileSync(
            filePath,
            "#define GREETING \"hi\"\ndefault { state_entry() { llSay(0, GREETING); } }",
            "utf8",
        );

        const entry: PushEntry = {
            id: "widget.lsl", masterId: filePath, type: "script", vm: "mono",
            targetName: "widget", matchName: "widget.lsl",
        };
        const resolved: readonly PushResolvedEntry[] = [{
            entry,
            destinations: [
                { disposition: "linked-update", item: inventoryItem("item-1", "widget.lsl") },
                { disposition: "linked-update", item: inventoryItem("item-2", "widget.lsl") },
            ],
        }];
        const summary = emptySummary();
        const writes: string[] = [];

        await makeSync(contentService).pushUpdates(
            "object-1", "object-1", resolved, summary,
            new vscode.CancellationTokenSource().token,
            async (_uri, content) => { writes.push(content); },
        );

        assert.strictEqual(writes.length, 2);
        assert.ok(writes[0].includes('llSay(0, "hi")'), writes[0]);
        assert.strictEqual(writes[0], writes[1]);
        assert.strictEqual(summary.updated, 2);
    });

    test("counts a preprocessor failure once and writes nothing for that entry", async () => {
        const filePath = path.join(tempDir, "broken.lsl");
        fs.writeFileSync(
            filePath,
            "#define DEBUG 1\n#ifdef DEBUG\ninteger x = 1;\n" +
            "// Missing #endif\ndefault { state_entry() {} }",
            "utf8",
        );

        const entry: PushEntry = {
            id: "broken.lsl", masterId: filePath, type: "script", vm: "mono",
            targetName: "broken", matchName: "broken.lsl",
        };
        const resolved: readonly PushResolvedEntry[] = [{
            entry,
            destinations: [
                { disposition: "reuse", item: inventoryItem("item-1", "broken.lsl") },
                { disposition: "reuse", item: inventoryItem("item-2", "broken.lsl") },
            ],
        }];
        const summary = emptySummary();
        const writes: string[] = [];

        await makeSync(contentService).pushUpdates(
            "object-1", "object-1", resolved, summary,
            new vscode.CancellationTokenSource().token,
            async (_uri, content) => { writes.push(content); },
        );

        assert.strictEqual(writes.length, 0);
        assert.strictEqual(summary.preprocessorError, 1);
        assert.strictEqual(summary.updated, 0);
    });

    test("skips entries whose only destination is a create", async () => {
        const filePath = path.join(tempDir, "new.txt");
        fs.writeFileSync(filePath, "new content", "utf8");

        const entry: PushEntry = {
            id: "new.txt", masterId: filePath, type: "notecard",
            targetName: "new.txt", matchName: "new.txt",
        };
        const resolved: readonly PushResolvedEntry[] = [{
            entry,
            destinations: [{ disposition: "create" }],
        }];
        const summary = emptySummary();
        const writes: string[] = [];

        await makeSync(contentService).pushUpdates(
            "object-1", "object-1", resolved, summary,
            new vscode.CancellationTokenSource().token,
            async (_uri, content) => { writes.push(content); },
        );

        assert.strictEqual(writes.length, 0);
        assert.strictEqual(summary.updated, 0);
        assert.strictEqual(summary.preprocessorError, 0);
    });

    test("stops immediately when the token is already cancelled", async () => {
        const filePath = path.join(tempDir, "config.txt");
        fs.writeFileSync(filePath, "plain text", "utf8");

        const entry: PushEntry = {
            id: "config.txt", masterId: filePath, type: "notecard",
            targetName: "config.txt", matchName: "config.txt",
        };
        const resolved: readonly PushResolvedEntry[] = [{
            entry,
            destinations: [{ disposition: "reuse", item: inventoryItem("item-1", "config.txt") }],
        }];
        const summary = emptySummary();
        const writes: string[] = [];
        const tokenSource = new vscode.CancellationTokenSource();
        tokenSource.cancel();

        await makeSync(contentService).pushUpdates(
            "object-1", "object-1", resolved, summary, tokenSource.token,
            async (_uri, content) => { writes.push(content); },
        );

        assert.strictEqual(writes.length, 0);
        assert.strictEqual(summary.cancelled, true);
    });

    test("counts a write failure without aborting the remaining destinations", async () => {
        const filePath = path.join(tempDir, "config.txt");
        fs.writeFileSync(filePath, "plain text", "utf8");

        const entry: PushEntry = {
            id: "config.txt", masterId: filePath, type: "notecard",
            targetName: "config.txt", matchName: "config.txt",
        };
        const resolved: readonly PushResolvedEntry[] = [{
            entry,
            destinations: [
                { disposition: "reuse", item: inventoryItem("item-1", "config.txt") },
                { disposition: "reuse", item: inventoryItem("item-2", "config.txt") },
            ],
        }];
        const summary = emptySummary();
        let calls = 0;

        await makeSync(contentService).pushUpdates(
            "object-1", "object-1", resolved, summary,
            new vscode.CancellationTokenSource().token,
            async () => {
                calls++;
                if (calls === 1)
                {
                    throw new Error("simulated write failure");
                }
            },
        );

        assert.strictEqual(summary.failed, 1);
        assert.strictEqual(summary.updated, 1);
    });

    test("accumulates a successfully linked destination's master URI", async () => {
        const filePath = path.join(tempDir, "config.txt");
        fs.writeFileSync(filePath, "plain text", "utf8");

        const entry: PushEntry = {
            id: "config.txt", masterId: filePath, type: "notecard",
            targetName: "config.txt", matchName: "config.txt",
        };
        const resolved: readonly PushResolvedEntry[] = [{
            entry,
            destinations: [{ disposition: "reuse", item: inventoryItem("item-1", "config.txt") }],
        }];
        const summary = emptySummary();
        const { service } = createTestSynchService();
        (service as unknown as Record<string, unknown>).linkSlItemToMaster = async () => { /* success */ };
        const linkedMasterUris: vscode.Uri[] = [];

        await makeSync(contentService, service).pushUpdates(
            "object-1", "object-1", resolved, summary,
            new vscode.CancellationTokenSource().token,
            async () => { /* write succeeds */ },
            undefined, undefined, linkedMasterUris,
        );

        assert.strictEqual(linkedMasterUris.length, 1);
        assert.strictEqual(linkedMasterUris[0].toString(), vscode.Uri.file(filePath).toString());
    });

    test("does not accumulate a master URI when linking fails", async () => {
        const filePath = path.join(tempDir, "config.txt");
        fs.writeFileSync(filePath, "plain text", "utf8");

        const entry: PushEntry = {
            id: "config.txt", masterId: filePath, type: "notecard",
            targetName: "config.txt", matchName: "config.txt",
        };
        const resolved: readonly PushResolvedEntry[] = [{
            entry,
            destinations: [{ disposition: "reuse", item: inventoryItem("item-1", "config.txt") }],
        }];
        const summary = emptySummary();
        const { service } = createTestSynchService();
        (service as unknown as Record<string, unknown>).linkSlItemToMaster = async () => {
            throw new Error("simulated link failure");
        };
        const linkedMasterUris: vscode.Uri[] = [];

        await makeSync(contentService, service).pushUpdates(
            "object-1", "object-1", resolved, summary,
            new vscode.CancellationTokenSource().token,
            async () => { /* write succeeds */ },
            undefined, undefined, linkedMasterUris,
        );

        assert.strictEqual(linkedMasterUris.length, 0);
    });

    test("links a reused destination to its master", async () => {
        const filePath = path.join(tempDir, "config.txt");
        fs.writeFileSync(filePath, "plain text", "utf8");

        const entry: PushEntry = {
            id: "config.txt", masterId: filePath, type: "notecard",
            targetName: "config.txt", matchName: "config.txt",
        };
        const resolved: readonly PushResolvedEntry[] = [{
            entry,
            destinations: [{ disposition: "reuse", item: inventoryItem("item-1", "config.txt") }],
        }];
        const summary = emptySummary();
        const { service } = createTestSynchService();
        const linkCalls: Array<{ uri: string; masterUri: string; content: string }> = [];
        (service as unknown as Record<string, unknown>).linkSlItemToMaster = async (
            uri: vscode.Uri, content: string, masterUri: vscode.Uri,
        ) => {
            linkCalls.push({ uri: uri.toString(), masterUri: masterUri.toString(), content });
        };

        await makeSync(contentService, service).pushUpdates(
            "object-1", "object-1", resolved, summary,
            new vscode.CancellationTokenSource().token,
            async () => { /* write succeeds */ },
        );

        assert.strictEqual(linkCalls.length, 1);
        assert.strictEqual(linkCalls[0].content, "plain text");
        assert.strictEqual(linkCalls[0].masterUri, vscode.Uri.file(filePath).toString());
    });

    test("does not re-link an already-linked destination", async () => {
        const filePath = path.join(tempDir, "config.txt");
        fs.writeFileSync(filePath, "plain text", "utf8");

        const entry: PushEntry = {
            id: "config.txt", masterId: filePath, type: "notecard",
            targetName: "config.txt", matchName: "config.txt",
        };
        const resolved: readonly PushResolvedEntry[] = [{
            entry,
            destinations: [{ disposition: "linked-update", item: inventoryItem("item-1", "config.txt") }],
        }];
        const summary = emptySummary();
        const { service } = createTestSynchService();
        const linkCalls: unknown[] = [];
        (service as unknown as Record<string, unknown>).linkSlItemToMaster = async () => {
            linkCalls.push(undefined);
        };

        await makeSync(contentService, service).pushUpdates(
            "object-1", "object-1", resolved, summary,
            new vscode.CancellationTokenSource().token,
            async () => { /* write succeeds */ },
        );

        assert.strictEqual(linkCalls.length, 0);
        assert.strictEqual(summary.updated, 1);
    });

    test("links a relinked destination to its new master", async () => {
        const filePath = path.join(tempDir, "config.txt");
        fs.writeFileSync(filePath, "plain text", "utf8");

        const entry: PushEntry = {
            id: "config.txt", masterId: filePath, type: "notecard",
            targetName: "config.txt", matchName: "config.txt",
        };
        const resolved: readonly PushResolvedEntry[] = [{
            entry,
            destinations: [{
                disposition: "relink", item: inventoryItem("item-1", "config.txt"),
                relinkedFromMasterId: "other-master",
            }],
        }];
        const summary = emptySummary();
        const { service } = createTestSynchService();
        const linkCalls: Array<{ masterUri: string }> = [];
        (service as unknown as Record<string, unknown>).linkSlItemToMaster = async (
            _uri: vscode.Uri, _content: string, masterUri: vscode.Uri,
        ) => {
            linkCalls.push({ masterUri: masterUri.toString() });
        };

        await makeSync(contentService, service).pushUpdates(
            "object-1", "object-1", resolved, summary,
            new vscode.CancellationTokenSource().token,
            async () => { /* write succeeds */ },
        );

        assert.strictEqual(linkCalls.length, 1);
        assert.strictEqual(linkCalls[0].masterUri, vscode.Uri.file(filePath).toString());
    });

    test("logs a warning but does not change the summary when linking fails", async () => {
        const filePath = path.join(tempDir, "config.txt");
        fs.writeFileSync(filePath, "plain text", "utf8");

        const entry: PushEntry = {
            id: "config.txt", masterId: filePath, type: "notecard",
            targetName: "config.txt", matchName: "config.txt",
        };
        const resolved: readonly PushResolvedEntry[] = [{
            entry,
            destinations: [{ disposition: "reuse", item: inventoryItem("item-1", "config.txt") }],
        }];
        const summary = emptySummary();
        const { service } = createTestSynchService();
        (service as unknown as Record<string, unknown>).linkSlItemToMaster = async () => {
            throw new Error("simulated link failure");
        };

        await makeSync(contentService, service).pushUpdates(
            "object-1", "object-1", resolved, summary,
            new vscode.CancellationTokenSource().token,
            async () => { /* write succeeds */ },
        );

        assert.strictEqual(summary.updated, 1);
        assert.strictEqual(summary.failed, 0);
    });
});


suite("Push execution: create pass", () => {
    let tempDir: string;
    const contentService = ObjectContentService.getInstance();
    let nextItemId: number;

    setup(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "push-exec-create-"));
        nextItemId = 1;
        contentService.handlePublish({
            object: {
                object_id: "object-1",
                object_name: "Widget Maker",
                inventory: [],
            },
        });
    });

    teardown(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
        contentService.clear();
    });

    // Simulates what the real FileSystemProvider's handleCreate does: register a new
    // item under a (possibly server-renamed) name, deliver content only for notecards.
    function fakeCreateWrite(name: string, type: "script" | "notecard") {
        return () => {
            contentService.addItem("object-1", "object-1", {
                item_id: `item-${nextItemId++}`,
                name,
                type,
            });
        };
    }

    test("creates a notecard, delivering its content directly with no follow-up write", async () => {
        const filePath = path.join(tempDir, "config.txt");
        fs.writeFileSync(filePath, "new content", "utf8");

        const entry: PushEntry = {
            id: "config.txt", masterId: filePath, type: "notecard",
            targetName: "config.txt", matchName: "config.txt",
        };
        const resolved: readonly PushResolvedEntry[] = [{
            entry, destinations: [{ disposition: "create" }],
        }];
        const summary = emptySummary();
        const writes: Array<{ uri: vscode.Uri; content: string }> = [];
        const onCreate = fakeCreateWrite("config.txt", "notecard");

        await makeSync(contentService).pushCreates(
            "object-1", "object-1", resolved, summary,
            new vscode.CancellationTokenSource().token,
            async (uri, content) => {
                writes.push({ uri, content });
                onCreate();
            },
        );

        assert.strictEqual(writes.length, 1);
        assert.strictEqual(writes[0].content, "new content");
        assert.strictEqual(summary.created, 1);
    });

    test("reports progress once for a successful create", async () => {
        const filePath = path.join(tempDir, "config.txt");
        fs.writeFileSync(filePath, "new content", "utf8");

        const entry: PushEntry = {
            id: "config.txt", masterId: filePath, type: "notecard",
            targetName: "config.txt", matchName: "config.txt",
        };
        const resolved: readonly PushResolvedEntry[] = [{
            entry, destinations: [{ disposition: "create" }],
        }];
        const summary = emptySummary();
        const reports: Array<{ message?: string; increment?: number }> = [];
        const onCreate = fakeCreateWrite("config.txt", "notecard");

        await makeSync(contentService).pushCreates(
            "object-1", "object-1", resolved, summary,
            new vscode.CancellationTokenSource().token,
            async () => { onCreate(); },
            { report: (value) => { reports.push(value); } },
            1,
        );

        assert.strictEqual(reports.length, 1);
        assert.strictEqual(reports[0].increment, 100);
    });

    test("reports progress once even when preprocessing fails", async () => {
        const filePath = path.join(tempDir, "broken.lsl");
        fs.writeFileSync(
            filePath,
            "#define DEBUG 1\n#ifdef DEBUG\ninteger x = 1;\n" +
            "// Missing #endif\ndefault { state_entry() {} }",
            "utf8",
        );

        const entry: PushEntry = {
            id: "broken.lsl", masterId: filePath, type: "script", vm: "mono",
            targetName: "broken", matchName: "broken.lsl",
        };
        const resolved: readonly PushResolvedEntry[] = [{
            entry, destinations: [{ disposition: "create" }],
        }];
        const summary = emptySummary();
        const reports: Array<{ message?: string; increment?: number }> = [];
        const writes: string[] = [];

        await makeSync(contentService).pushCreates(
            "object-1", "object-1", resolved, summary,
            new vscode.CancellationTokenSource().token,
            async (_uri, content) => { writes.push(content); },
            { report: (value) => { reports.push(value); } },
            1,
        );

        assert.strictEqual(writes.length, 0);
        assert.strictEqual(reports.length, 1);
        assert.ok(reports[0].message?.includes("preprocessing failed"), reports[0].message);
    });

    test("creates a script, then writes the real content via a follow-up save", async () => {
        const filePath = path.join(tempDir, "widget.lsl");
        fs.writeFileSync(
            filePath,
            "#define GREETING \"hi\"\ndefault { state_entry() { llSay(0, GREETING); } }",
            "utf8",
        );

        const entry: PushEntry = {
            id: "widget.lsl", masterId: filePath, type: "script", vm: "mono",
            targetName: "widget", matchName: "widget.lsl",
        };
        const resolved: readonly PushResolvedEntry[] = [{
            entry, destinations: [{ disposition: "create" }],
        }];
        const summary = emptySummary();
        const writes: Array<{ uri: vscode.Uri; content: string }> = [];
        const onCreate = fakeCreateWrite("widget.lsl", "script");

        await makeSync(contentService).pushCreates(
            "object-1", "object-1", resolved, summary,
            new vscode.CancellationTokenSource().token,
            async (uri, content) => {
                writes.push({ uri, content });
                if (writes.length === 1)
                {
                    onCreate();
                }
            },
        );

        assert.strictEqual(writes.length, 2);
        assert.ok(writes[1].content.includes('llSay(0, "hi")'), writes[1].content);
        assert.strictEqual(writes[0].content, writes[1].content);
        assert.strictEqual(summary.created, 1);
        assert.strictEqual(summary.createdContentSaveFailed, 0);
    });

    test("counts createdContentSaveFailed, not failed, when the follow-up write fails", async () => {
        const filePath = path.join(tempDir, "widget.lsl");
        fs.writeFileSync(
            filePath,
            "default { state_entry() {} }",
            "utf8",
        );

        const entry: PushEntry = {
            id: "widget.lsl", masterId: filePath, type: "script", vm: "mono",
            targetName: "widget", matchName: "widget.lsl",
        };
        const resolved: readonly PushResolvedEntry[] = [{
            entry, destinations: [{ disposition: "create" }],
        }];
        const summary = emptySummary();
        const onCreate = fakeCreateWrite("widget.lsl", "script");
        let calls = 0;

        await makeSync(contentService).pushCreates(
            "object-1", "object-1", resolved, summary,
            new vscode.CancellationTokenSource().token,
            async () => {
                calls++;
                if (calls === 1)
                {
                    onCreate();
                    return;
                }
                throw new Error("simulated save failure");
            },
        );

        assert.strictEqual(summary.created, 0);
        assert.strictEqual(summary.createdContentSaveFailed, 1);
        assert.strictEqual(summary.failed, 0);
    });

    test("accumulates a newly created item's master URI", async () => {
        const filePath = path.join(tempDir, "config.txt");
        fs.writeFileSync(filePath, "new content", "utf8");

        const entry: PushEntry = {
            id: "config.txt", masterId: filePath, type: "notecard",
            targetName: "config.txt", matchName: "config.txt",
        };
        const resolved: readonly PushResolvedEntry[] = [{
            entry, destinations: [{ disposition: "create" }],
        }];
        const summary = emptySummary();
        const onCreate = fakeCreateWrite("config.txt", "notecard");
        const linkedMasterUris: vscode.Uri[] = [];

        await makeSync(contentService).pushCreates(
            "object-1", "object-1", resolved, summary,
            new vscode.CancellationTokenSource().token,
            async () => { onCreate(); },
            undefined, undefined, linkedMasterUris,
        );

        assert.strictEqual(linkedMasterUris.length, 1);
        assert.strictEqual(linkedMasterUris[0].toString(), vscode.Uri.file(filePath).toString());
    });

    test("counts a preprocessor failure and performs no create", async () => {
        const filePath = path.join(tempDir, "broken.lsl");
        fs.writeFileSync(
            filePath,
            "#define DEBUG 1\n#ifdef DEBUG\ninteger x = 1;\n" +
            "// Missing #endif\ndefault { state_entry() {} }",
            "utf8",
        );

        const entry: PushEntry = {
            id: "broken.lsl", masterId: filePath, type: "script", vm: "mono",
            targetName: "broken", matchName: "broken.lsl",
        };
        const resolved: readonly PushResolvedEntry[] = [{
            entry, destinations: [{ disposition: "create" }],
        }];
        const summary = emptySummary();
        const writes: string[] = [];

        await makeSync(contentService).pushCreates(
            "object-1", "object-1", resolved, summary,
            new vscode.CancellationTokenSource().token,
            async (_uri, content) => { writes.push(content); },
        );

        assert.strictEqual(writes.length, 0);
        assert.strictEqual(summary.preprocessorError, 1);
        assert.strictEqual(summary.created, 0);
    });

    test("counts failed, with no follow-up attempted, when the initial create write throws", async () => {
        const filePath = path.join(tempDir, "widget.lsl");
        fs.writeFileSync(filePath, "default { state_entry() {} }", "utf8");

        const entry: PushEntry = {
            id: "widget.lsl", masterId: filePath, type: "script", vm: "mono",
            targetName: "widget", matchName: "widget.lsl",
        };
        const resolved: readonly PushResolvedEntry[] = [{
            entry, destinations: [{ disposition: "create" }],
        }];
        const summary = emptySummary();
        let calls = 0;

        await makeSync(contentService).pushCreates(
            "object-1", "object-1", resolved, summary,
            new vscode.CancellationTokenSource().token,
            async () => {
                calls++;
                throw new Error("simulated create failure");
            },
        );

        assert.strictEqual(calls, 1);
        assert.strictEqual(summary.failed, 1);
        assert.strictEqual(summary.created, 0);
        assert.strictEqual(summary.createdContentSaveFailed, 0);
    });

    test("identifies the created item by diffing, even when the simulator renamed it", async () => {
        const filePath = path.join(tempDir, "widget.lsl");
        fs.writeFileSync(filePath, "default { state_entry() {} }", "utf8");

        const entry: PushEntry = {
            id: "widget.lsl", masterId: filePath, type: "script", vm: "mono",
            targetName: "widget", matchName: "widget.lsl",
        };
        const resolved: readonly PushResolvedEntry[] = [{
            entry, destinations: [{ disposition: "create" }],
        }];
        const summary = emptySummary();
        const writes: Array<{ uri: vscode.Uri; content: string }> = [];
        // Simulate a server-side rename away from the requested filename.
        const onCreate = fakeCreateWrite("widget 2.lsl", "script");

        await makeSync(contentService).pushCreates(
            "object-1", "object-1", resolved, summary,
            new vscode.CancellationTokenSource().token,
            async (uri, content) => {
                writes.push({ uri, content });
                if (writes.length === 1)
                {
                    onCreate();
                }
            },
        );

        assert.strictEqual(summary.created, 1);
        assert.strictEqual(writes.length, 2);
        assert.ok(writes[1].uri.path.includes("item-1"), writes[1].uri.path);
    });

    test("skips entries with no create destination", async () => {
        const filePath = path.join(tempDir, "config.txt");
        fs.writeFileSync(filePath, "plain text", "utf8");

        const entry: PushEntry = {
            id: "config.txt", masterId: filePath, type: "notecard",
            targetName: "config.txt", matchName: "config.txt",
        };
        const resolved: readonly PushResolvedEntry[] = [{
            entry,
            destinations: [{ disposition: "reuse", item: { item_id: "item-1", name: "config.txt", type: "notecard" } }],
        }];
        const summary = emptySummary();
        const writes: string[] = [];

        await makeSync(contentService).pushCreates(
            "object-1", "object-1", resolved, summary,
            new vscode.CancellationTokenSource().token,
            async (_uri, content) => { writes.push(content); },
        );

        assert.strictEqual(writes.length, 0);
        assert.strictEqual(summary.created, 0);
    });

    test("stops immediately when the token is already cancelled", async () => {
        const filePath = path.join(tempDir, "config.txt");
        fs.writeFileSync(filePath, "plain text", "utf8");

        const entry: PushEntry = {
            id: "config.txt", masterId: filePath, type: "notecard",
            targetName: "config.txt", matchName: "config.txt",
        };
        const resolved: readonly PushResolvedEntry[] = [{
            entry, destinations: [{ disposition: "create" }],
        }];
        const summary = emptySummary();
        const writes: string[] = [];
        const tokenSource = new vscode.CancellationTokenSource();
        tokenSource.cancel();

        await makeSync(contentService).pushCreates(
            "object-1", "object-1", resolved, summary, tokenSource.token,
            async (_uri, content) => { writes.push(content); },
        );

        assert.strictEqual(writes.length, 0);
        assert.strictEqual(summary.cancelled, true);
    });

    test("links a newly created notecard to its master", async () => {
        const filePath = path.join(tempDir, "config.txt");
        fs.writeFileSync(filePath, "new content", "utf8");

        const entry: PushEntry = {
            id: "config.txt", masterId: filePath, type: "notecard",
            targetName: "config.txt", matchName: "config.txt",
        };
        const resolved: readonly PushResolvedEntry[] = [{
            entry, destinations: [{ disposition: "create" }],
        }];
        const summary = emptySummary();
        const { service } = createTestSynchService();
        const linkCalls: Array<{ uri: string; masterUri: string }> = [];
        (service as unknown as Record<string, unknown>).linkSlItemToMaster = async (
            uri: vscode.Uri, _content: string, masterUri: vscode.Uri,
        ) => {
            linkCalls.push({ uri: uri.toString(), masterUri: masterUri.toString() });
        };
        const onCreate = fakeCreateWrite("config.txt", "notecard");

        await makeSync(contentService, service).pushCreates(
            "object-1", "object-1", resolved, summary,
            new vscode.CancellationTokenSource().token,
            async () => { onCreate(); },
        );

        assert.strictEqual(linkCalls.length, 1);
        assert.ok(linkCalls[0].uri.includes("item-1"), linkCalls[0].uri);
        assert.strictEqual(linkCalls[0].masterUri, vscode.Uri.file(filePath).toString());
    });

    test("links a newly created script to its master after the follow-up write", async () => {
        const filePath = path.join(tempDir, "widget.lsl");
        fs.writeFileSync(filePath, "default { state_entry() {} }", "utf8");

        const entry: PushEntry = {
            id: "widget.lsl", masterId: filePath, type: "script", vm: "mono",
            targetName: "widget", matchName: "widget.lsl",
        };
        const resolved: readonly PushResolvedEntry[] = [{
            entry, destinations: [{ disposition: "create" }],
        }];
        const summary = emptySummary();
        const { service } = createTestSynchService();
        const linkCalls: unknown[] = [];
        (service as unknown as Record<string, unknown>).linkSlItemToMaster = async () => {
            linkCalls.push(undefined);
        };
        const onCreate = fakeCreateWrite("widget.lsl", "script");
        let writeCount = 0;

        await makeSync(contentService, service).pushCreates(
            "object-1", "object-1", resolved, summary,
            new vscode.CancellationTokenSource().token,
            async () => {
                writeCount++;
                if (writeCount === 1)
                {
                    onCreate();
                }
            },
        );

        assert.strictEqual(writeCount, 2);
        assert.strictEqual(linkCalls.length, 1);
        assert.strictEqual(summary.created, 1);
    });

    test("still links the item even when the follow-up content write fails", async () => {
        const filePath = path.join(tempDir, "widget.lsl");
        fs.writeFileSync(filePath, "default { state_entry() {} }", "utf8");

        const entry: PushEntry = {
            id: "widget.lsl", masterId: filePath, type: "script", vm: "mono",
            targetName: "widget", matchName: "widget.lsl",
        };
        const resolved: readonly PushResolvedEntry[] = [{
            entry, destinations: [{ disposition: "create" }],
        }];
        const summary = emptySummary();
        const { service } = createTestSynchService();
        const linkCalls: unknown[] = [];
        (service as unknown as Record<string, unknown>).linkSlItemToMaster = async () => {
            linkCalls.push(undefined);
        };
        const onCreate = fakeCreateWrite("widget.lsl", "script");
        let writeCount = 0;

        await makeSync(contentService, service).pushCreates(
            "object-1", "object-1", resolved, summary,
            new vscode.CancellationTokenSource().token,
            async () => {
                writeCount++;
                if (writeCount === 1)
                {
                    onCreate();
                    return;
                }
                throw new Error("simulated save failure");
            },
        );

        assert.strictEqual(summary.createdContentSaveFailed, 1);
        assert.strictEqual(linkCalls.length, 1);
    });
});

suite("Push execution: relink ownership transfer (step 30)", () => {
    let tempDir: string;
    let contentService: ObjectContentService;

    setup(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "push-exec-relink-"));
        // Fetch the live singleton fresh here, not once at suite-body scope: SynchService's
        // own methods (linkSlItemToMaster -> findSlInventoryItem) call
        // ObjectContentService.getInstance() directly, and another test file's teardown may
        // have disposed the previously-captured instance by the time this suite runs.
        contentService = ObjectContentService.getInstance();
        contentService.handlePublish({
            object: {
                object_id: "object-1",
                object_name: "Widget Maker",
                inventory: [{ item_id: "item-1", name: "widget.lsl", type: "script", subtype: 0 }],
            },
        });
    });

    teardown(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
        contentService.clear();
    });

    test("moves one endpoint to its new master, leaving every other link on both masters intact", async () => {
        const newMasterPath = path.join(tempDir, "widget.lsl");
        fs.writeFileSync(newMasterPath, "default { state_entry() {} }", "utf8");
        const oldMasterUri = vscode.Uri.file(path.join(tempDir, "old-master.lsl"));
        const newMasterUri = vscode.Uri.file(newMasterPath);

        const relinkedIdentity = { rootId: "object-1", primId: null, itemId: "item-1" };
        const oldUnrelatedIdentity = { rootId: "object-1", primId: null, itemId: "item-unrelated-old" };
        const newUnrelatedIdentity = { rootId: "object-1", primId: null, itemId: "item-unrelated-new" };

        const { service, activeSyncs } = createTestSynchService();
        const fakeOld = createFakeScriptSync({
            masterUri: oldMasterUri,
            snapshots: [
                { kind: "virtual", identity: relinkedIdentity },
                { kind: "virtual", identity: oldUnrelatedIdentity },
            ],
        });
        activeSyncs.set(masterKeyFor(oldMasterUri), fakeOld.sync);

        // The new master needs a real ScriptSync (not a fake) since producePushContent
        // calls preProcessContentWithResult on whatever getOrCreateSync returns.
        const newMasterDocument = await vscode.workspace.openTextDocument(newMasterUri);
        const { sync: realNewSync } = await service.getOrCreateSync(newMasterDocument, "lsl");
        realNewSync.subscribeVirtual(
            vscode.Uri.parse("sl://objects/object-1/item-unrelated-new"), undefined, newUnrelatedIdentity,
        );

        const entry: PushEntry = {
            id: "widget.lsl", masterId: newMasterPath, type: "script", vm: "mono",
            targetName: "widget", matchName: "widget.lsl",
        };
        const resolved: readonly PushResolvedEntry[] = [{
            entry,
            destinations: [{
                disposition: "relink",
                item: inventoryItem("item-1", "widget.lsl"),
                relinkedFromMasterId: oldMasterUri.fsPath,
            }],
        }];
        const summary = emptySummary();

        await makeSync(contentService, service).pushUpdates(
            "object-1", "object-1", resolved, summary,
            new vscode.CancellationTokenSource().token,
            async () => { /* write succeeds */ },
        );

        assert.strictEqual(fakeOld.sync.isTrackingIdentity(relinkedIdentity), false);
        assert.strictEqual(fakeOld.sync.isTrackingIdentity(oldUnrelatedIdentity), true);
        assert.strictEqual(realNewSync.isTrackingIdentity(relinkedIdentity), true);
        assert.strictEqual(realNewSync.isTrackingIdentity(newUnrelatedIdentity), true);
        assert.strictEqual(summary.updated, 1);
    });
});
