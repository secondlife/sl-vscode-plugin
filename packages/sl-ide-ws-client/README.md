# @secondlife/sl-ide-ws-client

WebSocket / JSON-RPC client and object content model for the Second Life viewer
edit protocol.

See [doc/Message_Interfaces.md](doc/Message_Interfaces.md) for the wire protocol
these types describe.

## Installation

Not yet published so this isn't relevant at this time

## Connecting to a viewer

`ViewerEditWSClient` connects to the WebSocket server the viewer exposes
(`ws://localhost:9020` by default). `setup()` registers your protocol handlers
and returns a `Disposable` that releases the connection watchers it creates.

```typescript
import { ViewerEditWSClient, SessionHandshake, SessionHandshakeResponse } from "@secondlife/sl-ide-ws-client";

const client = new ViewerEditWSClient({
    url: "ws://localhost:9020",
    // Optional logger component
    logger: { debug: (m) => console.log(m), error: (m, e) => console.error(m, e) },
});

const subscription = client.setup({
    // The viewer opens every session with a handshake; reply to identify yourself.
    onHandshake: (msg: SessionHandshake): SessionHandshakeResponse => {
        console.log(`viewer ${msg.viewer_name} ${msg.viewer_version}, agent ${msg.agent_name}`);
        return {
            client_name: "my-editor",
            client_version: "1.0",
            protocol_version: msg.protocol_version,
            languages: ["lsl", "luau"],
            features: {},
        };
    },

    onHandshakeOk: () => console.log("session established"),

    onCompilationResult: (result) => {
        if (result.success) {
            console.log("compiled cleanly");
            return;
        }
        for (const d of result.diagnostics ?? []) {
            console.error(`${d.level} at ${d.row}:${d.column} — ${d.message}`);
        }
    },

    onRuntimeError: (err) => console.error(`${err.object_name}: ${err.message}`),
    onConnectionClosed: () => console.log("viewer went away"),
});

const { success, message } = await client.connect();
if (!success) {
    throw new Error(`connection failed: ${message}`);
}

// Optional: detect a viewer that stops responding. The client closes the
// connection after two consecutive ping failures.
client.startPingTimer(30_000);
```

Shut down in the reverse order. `sendDisconnect()` tells the viewer why you are
leaving before the socket closes; `dispose()` closes immediately without it.

```typescript
client.sendDisconnect(0, "editor closing");
subscription.dispose();
client.dispose();
```

## Reading and writing object inventory

Once a session is up, in-world objects are addressed by prim and inventory item
UUID. These calls are thin wrappers over JSON-RPC requests, so each one rejects
if the viewer reports a transport-level error and otherwise resolves with the
response shown in the protocol types.

```typescript
const { objects } = await client.getObjectList();

for (const object of objects) {
    console.log(`${object.object_name} (${object.object_id})`);

    for (const item of object.inventory) {
        if (item.type !== "script") {
            continue;
        }

        const current = await client.getObjectContent({
            prim_id: object.object_id,
            item_id: item.item_id,
        });

        const saved = await client.saveObjectContent({
            prim_id: object.object_id,
            item_id: item.item_id,
            content: current.content.replace(/\bllOwnerSay\b/g, "llSay"),
            running: true,
        });

        if (!saved.compiled) {
            console.error(saved.diagnostics);
        }
    }
}

await client.setScriptRunning({ prim_id, item_id, running: false });
await client.resetScript({ prim_id, item_id });
```

## Tracking published objects

The viewer pushes `object.publish`, `object.unpublish` and `object.update`
notifications as the user works. `ObjectContentService` keeps the resulting
inventory tree in memory and emits events when it changes. Feed it the
notifications from your handlers and it becomes the model your UI reads from.

```typescript
import { ObjectContentService } from "@secondlife/sl-ide-ws-client";

const objects = ObjectContentService.getInstance();

const watcher = objects.onDidChangeObjects((e) => {
    console.log(`${e.object_id} ${e.type}, now tracking ${objects.getObjects().length} objects`);
});

client.setup({
    onObjectPublish: (msg) => objects.handlePublish(msg),
    onObjectUnpublish: (msg) => objects.handleUnpublish(msg),
    onObjectUpdate: (msg) => objects.handleUpdate(msg),
    // ...handshake handlers as above
});

// Later: look up an item without another round trip to the viewer.
const found = objects.getItemInObject(object_id, undefined, item_id);
if (found) {
    console.log(`${found.item.name} lives in prim ${found.prim_id}`);
}

watcher.dispose();
```

`onDidChangeContent`, `onDidChangeRunningState` and `onDidChangeScriptVm` cover
cached content invalidation and per-script state. The `Event` and `Disposable`
types are shaped like their VS Code counterparts, so these subscriptions can be
consumed directly by an extension without adapters.

## Development

```bash
npm run build --workspace @secondlife/sl-ide-ws-client
```

Compiles `src` to `dist` with declarations. The root `compile` script runs this
before building the extension, so a normal `npm run compile` covers both.
