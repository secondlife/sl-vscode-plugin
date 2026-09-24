import * as assert from "assert";
import { SynchService } from "../../synchservice";

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

        (service as any).initialize = () => undefined;
        service.activate();

        assert.strictEqual((service as any).stopping, false);
    });

    test("connection close destroys all active links", () => {
        const service = createQueueHost();
        (service as any).autoLinkedObjectIds = new Set();
        (service as any).clearEmptySyncs = () => undefined;
        (service as any).syncedFileDecorator = { refresh: () => undefined };
        (service as any).sessionConnected = false;

        const sync = {
            getMasterUri: () => ({
                fsPath: "C:/tmp/master.luau",
                toString: () => "file:///c%3A/tmp/master.luau",
            }),
            getMasterDocument: () => ({
                uri: { fsPath: "C:/tmp/master.luau" },
            }),
            dispose: () => undefined,
            hasFilesToTrack: () => false,
        };

        const key = (service as any).masterKey(sync.getMasterUri());
        (service as any).activeSyncs = new Map([[key, sync]]);

        let destroyed = false;
        (service as any).disposeSync = (target: any) => {
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
