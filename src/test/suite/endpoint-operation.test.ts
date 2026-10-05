import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";
import { SynchService } from "../../synchservice";
import { ScriptSync } from "../../scriptsync";
import {
    createFakeScriptSync,
    createTestSynchService,
    masterKeyFor,
} from "./helpers/synchServiceTestHelpers";

function createQueueHost(): SynchService
{
    const service = Object.create(SynchService.prototype) as SynchService;
    (service as unknown as {
        endpointOperations: Map<string, Promise<void>>;
    }).endpointOperations = new Map();
    return service;
}

suite("Endpoint operation serialization", () => {
    test("serializes operations for the same endpoint", async () => {
        const service = createQueueHost();
        const events: string[] = [];

        const first = service.runEndpointOperation("virtual:first", async () => {
            events.push("first-start");
            await Promise.resolve();
            events.push("first-end");
        });
        const second = service.runEndpointOperation("virtual:first", async () => {
            events.push("second");
        });

        await Promise.all([first, second]);

        assert.deepStrictEqual(events, [
            "first-start",
            "first-end",
            "second",
        ]);
    });

    test("allows operations for different endpoints to start independently", async () => {
        const service = createQueueHost();
        const events: string[] = [];

        await Promise.all([
            service.runEndpointOperation("virtual:first", () => {
                events.push("first");
            }),
            service.runEndpointOperation("virtual:second", () => {
                events.push("second");
            }),
        ]);

        assert.deepStrictEqual(events.sort(), ["first", "second"]);
    });

    test("continues after a rejected operation", async () => {
        const service = createQueueHost();
        const events: string[] = [];

        const rejected = service.runEndpointOperation("virtual:first", () => {
            events.push("rejected");
            throw new Error("expected failure");
        });
        const following = service.runEndpointOperation("virtual:first", () => {
            events.push("following");
        });

        await assert.rejects(rejected, /expected failure/);
        await following;

        assert.deepStrictEqual(events, ["rejected", "following"]);
    });

    test("rejects new operations once the service is stopping", async () => {
        const service = createQueueHost();
        (service as any).stopping = true;

        await assert.rejects(
            service.runEndpointOperation("virtual:stopped", async () => {
                throw new Error("should not run");
            }),
            /SynchService is stopping/,
        );
    });

    test("reactivation clears the stale stopping flag before new setup", () => {
        const service = createQueueHost();
        (service as any).activeSyncs = new Map();
        (service as any).endpointOperations = new Map();
        (service as any).disposables = [];
        (service as any).stopping = true;

        (service as any).initialize = (): void => undefined;
        service.activate();

        assert.strictEqual((service as any).stopping, false);
    });

    test("connection close destroys all active links", () => {
        const service = createQueueHost();
        (service as any).autoLinkedObjectIds = new Set();
        (service as any).clearEmptySyncs = (): void => undefined;
        (service as any).syncedFileDecorator = { refresh: (): void => undefined };
        (service as any).sessionConnected = false;

        const sync = {
            getMasterUri: (): { fsPath: string; toString: () => string } => ({
                fsPath: "C:/tmp/master.luau",
                toString: (): string => "file:///c%3A/tmp/master.luau",
            }),
            getMasterDocument: (): { uri: { fsPath: string } } => ({
                uri: { fsPath: "C:/tmp/master.luau" },
            }),
            dispose: (): void => undefined,
            hasFilesToTrack: (): boolean => false,
        };

        const key = (service as any).masterKey(sync.getMasterUri());
        (service as any).activeSyncs = new Map([[key, sync]]);

        let destroyed = false;
        (service as any).disposeSync = (target: any): boolean => {
            if (target !== sync) {
                return false;
            }
            destroyed = true;
            return true;
        };

        (service as any).onConnectionClosed();

        assert.strictEqual(destroyed, true);
        assert.strictEqual((service as any).autoLinkedObjectIds.size, 0);
    });
});

interface PrivateSaveMethods
{
    onSaveTextDocument(document: vscode.TextDocument): Promise<void>;
}

const workspaceRoot = path.resolve(__dirname, "../../../src/test/workspace/set_1");

suite("SynchService save propagation master validation", () => {

    test("propagates handleMasterSaved when the master file still exists", async () => {
        const { service, activeSyncs } = createTestSynchService();
        const master = vscode.Uri.file(path.join(workspaceRoot, "circular_a.luau"));
        const fake = createFakeScriptSync({ masterUri: master });
        activeSyncs.set(masterKeyFor(master), fake.sync);

        const document = { uri: master } as unknown as vscode.TextDocument;
        await (service as unknown as PrivateSaveMethods).onSaveTextDocument(document);

        assert.strictEqual(fake.calls.handleMasterSaved, 1);
        assert.strictEqual(activeSyncs.has(masterKeyFor(master)), true);
    });

    test("skips handleMasterSaved and removes the link when the master was deleted", async () => {
        const { service, activeSyncs } = createTestSynchService();
        const master = vscode.Uri.file(path.join(workspaceRoot, "does-not-exist.luau"));
        const fake = createFakeScriptSync({ masterUri: master });
        activeSyncs.set(masterKeyFor(master), fake.sync);

        const document = { uri: master } as unknown as vscode.TextDocument;
        await (service as unknown as PrivateSaveMethods).onSaveTextDocument(document);

        assert.strictEqual(fake.calls.handleMasterSaved, 0);
        assert.strictEqual(activeSyncs.has(masterKeyFor(master)), false);
        assert.strictEqual(fake.calls.dispose, 1);
    });

    test("a master deleted during one sync's save propagation does not affect other active syncs' save propagation", async () => {
        const { service, activeSyncs } = createTestSynchService();
        const validMaster = vscode.Uri.file(path.join(workspaceRoot, "circular_a.luau"));
        const deletedMaster = vscode.Uri.file(path.join(workspaceRoot, "does-not-exist-step18.luau"));

        // Non-empty, so the unrelated sync's removeMasterLink()-triggered clearEmptySyncs()
        // sweep does not collaterally dispose this one before its own save event runs.
        const fakeValid = createFakeScriptSync({ masterUri: validMaster, scriptIds: ["placeholder-script"] });
        const fakeDeleted = createFakeScriptSync({ masterUri: deletedMaster });
        activeSyncs.set(masterKeyFor(validMaster), fakeValid.sync);
        activeSyncs.set(masterKeyFor(deletedMaster), fakeDeleted.sync);

        const onSave = (service as unknown as PrivateSaveMethods).onSaveTextDocument.bind(service);

        await onSave({ uri: deletedMaster } as unknown as vscode.TextDocument);
        await onSave({ uri: validMaster } as unknown as vscode.TextDocument);

        assert.strictEqual(fakeDeleted.calls.handleMasterSaved, 0);
        assert.strictEqual(activeSyncs.has(masterKeyFor(deletedMaster)), false);

        assert.strictEqual(fakeValid.calls.handleMasterSaved, 1);
        assert.strictEqual(activeSyncs.has(masterKeyFor(validMaster)), true);
    });

    test("a transient master validation failure (not a confirmed deletion) retains the link (Phase 4 Step 21)", async () => {
        const { service, activeSyncs } = createTestSynchService();
        // A directory, not a file: vscode.workspace.fs.stat() succeeds, but validateMasterUri's
        // "is it a File?" check throws a plain Error — not a FileSystemError("FileNotFound") —
        // so this must be treated as a transient/other failure, not a confirmed deletion.
        const notAFileMaster = vscode.Uri.file(workspaceRoot);
        const fake = createFakeScriptSync({ masterUri: notAFileMaster });
        activeSyncs.set(masterKeyFor(notAFileMaster), fake.sync);

        const document = { uri: notAFileMaster } as unknown as vscode.TextDocument;
        await (service as unknown as PrivateSaveMethods).onSaveTextDocument(document);

        assert.strictEqual(fake.calls.handleMasterSaved, 0);
        // The link must survive: this is not a confirmed deletion.
        assert.strictEqual(fake.calls.dispose, 0);
        assert.strictEqual(activeSyncs.has(masterKeyFor(notAFileMaster)), true);
    });
});

interface PrivateReleaseMethod
{
    releaseUnattachedSync(sync: ScriptSync, created: boolean): void;
}

suite("SynchService releaseUnattachedSync (Issue 10 — transient empty-sync window)", () => {

    test("created=true disposes only the sync this operation created, not other transient empty syncs", () => {
        const { service, activeSyncs, refreshCalls } = createTestSynchService();
        const masterA = vscode.Uri.file("C:/ws/a.luau");
        const masterB = vscode.Uri.file("C:/ws/b.luau");
        const fakeA = createFakeScriptSync({ masterUri: masterA });
        const fakeB = createFakeScriptSync({ masterUri: masterB });
        activeSyncs.set(masterKeyFor(masterA), fakeA.sync);
        activeSyncs.set(masterKeyFor(masterB), fakeB.sync);

        (service as unknown as PrivateReleaseMethod).releaseUnattachedSync(fakeA.sync, true);

        assert.strictEqual(activeSyncs.has(masterKeyFor(masterA)), false);
        assert.strictEqual(fakeA.calls.dispose, 1);
        // Targeted dispose, not a sweep: fakeB is an unrelated empty sync and must survive.
        assert.strictEqual(activeSyncs.has(masterKeyFor(masterB)), true);
        assert.strictEqual(fakeB.calls.dispose, 0);
        assert.strictEqual(refreshCalls.length, 1);
    });

    test("created=false falls back to the defensive sweep, which may dispose other empty syncs too", () => {
        const { service, activeSyncs, refreshCalls } = createTestSynchService();
        const masterA = vscode.Uri.file("C:/ws/a.luau");
        const masterB = vscode.Uri.file("C:/ws/b.luau");
        const fakeA = createFakeScriptSync({ masterUri: masterA });
        const fakeB = createFakeScriptSync({ masterUri: masterB });
        activeSyncs.set(masterKeyFor(masterA), fakeA.sync);
        activeSyncs.set(masterKeyFor(masterB), fakeB.sync);

        (service as unknown as PrivateReleaseMethod).releaseUnattachedSync(fakeA.sync, false);

        assert.strictEqual(activeSyncs.has(masterKeyFor(masterA)), false);
        assert.strictEqual(activeSyncs.has(masterKeyFor(masterB)), false);
        assert.strictEqual(fakeA.calls.dispose, 1);
        assert.strictEqual(fakeB.calls.dispose, 1);
        assert.strictEqual(refreshCalls.length, 2);
    });
});

suite("SynchService findSyncByScriptId (Issue 7 — scriptId is metadata, not a relationship key)", () => {

    test("returns the single owner in the normal case", () => {
        const { service, activeSyncs } = createTestSynchService();
        const master = vscode.Uri.file("C:/ws/a.luau");
        const fake = createFakeScriptSync({ masterUri: master, scriptIds: ["script-1"] });
        activeSyncs.set(masterKeyFor(master), fake.sync);

        assert.strictEqual(service.findSyncByScriptId("script-1"), fake.sync);
        assert.strictEqual(service.findSyncByScriptId("unknown"), undefined);
    });

    test("still returns a single deterministic owner if a scriptId is ever tracked by more than one sync", () => {
        const { service, activeSyncs } = createTestSynchService();
        const masterA = vscode.Uri.file("C:/ws/a.luau");
        const masterB = vscode.Uri.file("C:/ws/b.luau");
        const fakeA = createFakeScriptSync({ masterUri: masterA, scriptIds: ["script-1"] });
        const fakeB = createFakeScriptSync({ masterUri: masterB, scriptIds: ["script-1"] });
        activeSyncs.set(masterKeyFor(masterA), fakeA.sync);
        activeSyncs.set(masterKeyFor(masterB), fakeB.sync);

        // Never two owners: the lookup must still resolve to exactly one, deterministically.
        assert.strictEqual(service.findSyncByScriptId("script-1"), fakeA.sync);
    });
});

interface PrivateDetachEndpoint
{
    detachEndpoint(
        endpointLabel: string,
        isOwner: (sync: ScriptSync) => boolean,
        unsubscribe: (sync: ScriptSync) => void,
    ): boolean;
}

suite("SynchService detachEndpoint primitive (Phase 2 Step 8)", () => {

    test("detaches the single owner and reports changed", () => {
        const { service, activeSyncs } = createTestSynchService();
        const master = vscode.Uri.file("C:/ws/a.luau");
        const fake = createFakeScriptSync({ masterUri: master, scriptIds: ["script-1"] });
        activeSyncs.set(masterKeyFor(master), fake.sync);

        const changed = (service as unknown as PrivateDetachEndpoint).detachEndpoint(
            "script-1",
            (sync) => sync.isTrackingId("script-1"),
            (sync) => { sync.unsubscribeById("script-1"); },
        );

        assert.strictEqual(changed, true);
        assert.deepStrictEqual(fake.calls.unsubscribeById, ["script-1"]);
    });

    test("reports no change and calls nothing when there is no owner", () => {
        const { service, activeSyncs } = createTestSynchService();
        const master = vscode.Uri.file("C:/ws/a.luau");
        const fake = createFakeScriptSync({ masterUri: master, scriptIds: ["script-2"] });
        activeSyncs.set(masterKeyFor(master), fake.sync);

        const changed = (service as unknown as PrivateDetachEndpoint).detachEndpoint(
            "script-1",
            (sync) => sync.isTrackingId("script-1"),
            (sync) => { sync.unsubscribeById("script-1"); },
        );

        assert.strictEqual(changed, false);
        assert.deepStrictEqual(fake.calls.unsubscribeById, []);
    });

    test("detaches from every matching owner if the cardinality invariant is ever violated", () => {
        const { service, activeSyncs } = createTestSynchService();
        const masterA = vscode.Uri.file("C:/ws/a.luau");
        const masterB = vscode.Uri.file("C:/ws/b.luau");
        const fakeA = createFakeScriptSync({ masterUri: masterA, scriptIds: ["script-1"] });
        const fakeB = createFakeScriptSync({ masterUri: masterB, scriptIds: ["script-1"] });
        activeSyncs.set(masterKeyFor(masterA), fakeA.sync);
        activeSyncs.set(masterKeyFor(masterB), fakeB.sync);

        const changed = (service as unknown as PrivateDetachEndpoint).detachEndpoint(
            "script-1",
            (sync) => sync.isTrackingId("script-1"),
            (sync) => { sync.unsubscribeById("script-1"); },
        );

        assert.strictEqual(changed, true);
        assert.deepStrictEqual(fakeA.calls.unsubscribeById, ["script-1"]);
        assert.deepStrictEqual(fakeB.calls.unsubscribeById, ["script-1"]);
    });
});
