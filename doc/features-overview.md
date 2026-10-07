# Second Life VS Code Plugin — User-Visible Features

A high-level catalogue of everything the extension exposes to the user. Each
section links features to the settings and commands that drive them; deeper
behavioural detail is covered in the other documents under `doc/`.

---

## 1. Viewer Connection

The extension talks to the Second Life viewer over a local WebSocket
(JSON-RPC) session.

- **Connect / Disconnect** from the Second Life view title bar (plug and
  disconnect icons) or the Command Palette.
- **Connection status** is shown at the top of the Second Life view as a
  coloured dot plus `Connected - <Region>` or `Disconnected`.
- **Status query** — `Second Life: Show WebSocket Client Status` reports the
  current session state.
- **Configurable port and timing** — `slVscodeEdit.network.websocketPort`
  (default 9020), `network.disconnectDelayMs`, `network.disposeDelayMs`.
- **Notifications** for connect / already-connected / disconnect / not-connected.

Commands: `second-life-scripting.connectWebSocket`,
`second-life-scripting.disconnectWebSocket`,
`second-life-scripting.showWebSocketClientStatus`.

---

## 2. Second Life Explorer View

A dedicated webview (`Second Life`) in the Explorer sidebar showing in-world
content published from the viewer.

### Layout

- Connection status line.
- **Refresh** button to re-query the viewer.
- **Filter** box that live-filters objects, regions, linked prims and inventory
  items as you type.
- Tree: **Object → Linked Prim → Inventory Item** (scripts and notecards).

### Tree presentation

- Distinct icons for objects, linked prims, LSL scripts, Luau scripts and
  notecards.
- **Run state** on scripts: an inline ■ / ▶ toggle button reflecting whether the
  script is running.
- **Permission badges** for No Modify / No Copy / No Transfer.
- Tooltips showing object/prim/item name, description, link number and type.
- Expansion state and filter text are remembered across view reloads.

### Actions

Each row carries a `⋮` **More actions** button (also available via right-click):

| Target | Actions |
| --- | --- |
| Object | Pull to Workspace, Link All, Rename…, New File…, Unpublish, Save Back to Contents, Teleport To…, Zoom In |
| Linked prim | Rename…, New File… |
| Script | Open, Start / Stop, Restart, Select VM (LSL2 / Mono / Luau), Rename…, Delete |
| Notecard | Open, Rename…, Delete |

- **Teleport To…**, **Zoom In** and **Save Back to Contents** are enabled only
  when the connected viewer advertises the corresponding capability.
- **Rename** and **New File** use inline, in-tree text editing (Enter to commit,
  Escape to cancel); the new-file icon updates live based on the typed
  extension (`.lsl`, `.luau`, otherwise notecard).
- **Delete** requires confirmation.
- **Link All** attempts to match every script and notecard in the object,
  including items in linked prims, with workspace files. Matching uses the same
  file-name and file-metadata rules as individual file linking. The operation
  does not open editor tabs and reports one summary when it finishes.
- **Pull to Workspace** copies every script and notecard into a workspace
  folder, mirrors linked prims as subfolders, and links each copied file
  directly to the in-world item it came from. It prompts for a destination
  folder, then, only if any target files already exist, shows one aggregate
  prompt to skip or overwrite them (warning about any that are open with
  unsaved changes and cannot be overwritten). The operation reports one
  summary when it finishes.

### Pinned objects

- Any object can be **pinned** with the pin button on its row.
- Pins persist in the workspace and are listed even while the viewer is
  disconnected, in a muted "offline" style.
- Objects can be unpinned while offline; pinned objects are re-resolved
  automatically on reconnect and flagged when no longer available.

### Keyboard support

Arrow Up/Down to move, Arrow Right/`+` to expand, Arrow Left/`-` to collapse,
Enter to open or toggle, Delete to remove an item, Escape to close menus.

### Empty states

- Disconnected: "Connect to viewer to see in-world objects" with a Connect
  button.
- Disconnected with pins: "Viewer disconnected / Pinned objects are shown
  offline".

---

## 3. Editing In-World Content Directly (`sl://` files)

Scripts and notecards open as ordinary editor tabs backed by a virtual file
system, so no temporary files need to be managed by hand.

- **Open** an item from the explorer (single click previews, double click or
  *Open* pins the tab).
- **Save** with `Ctrl+S` — content is preprocessed (if enabled) and written back
  to the object; scripts are compiled by the viewer.
- **Create**, **rename** and **delete** items straight from the tree.
- **File decorations** on `sl://` tabs: ▶ running (green), ■ stopped (red),
  ⚠ when the viewer is disconnected, each with an explanatory tooltip.
- **Friendly errors** — permission, missing-object and timeout failures from the
  viewer surface as normal VS Code file-system errors.
- Breadcrumbs and tab labels are formatted with a "Second Life" workspace
  suffix.

---

## 4. Pushing Workspace Files to an Object

Right-click one or more files (or folders) in the VS Code Explorer — anywhere
in the workspace, not just `sl://` tabs — and choose **Push selected to...**
to write them into a published object. Available only while connected to the
viewer.

- **Selection** expands a selected folder one level (files only; nested
  directories are counted and excluded, not recursed into) and drops any file
  that does not decode as UTF-8.
- **Target** is chosen with two quick-picks: the published object, then the
  root prim or a specific linked prim.
- **Matching** prefers a file already linked to a master: that link's item is
  reused or, if it is currently linked to a different master, the link moves
  to this file and every other link on both masters is left untouched.
  Otherwise a same-named item of the matching type on the target prim is
  reused; a same-named item of the *other* type is left alone, not written or
  created; and if nothing matches, a new item is created.
- **One confirmation** lists every destination and its disposition — update,
  move, or create — before anything is written; cancelling writes nothing.
- If any selected file is open and unsaved, one prompt offers to save them
  first — excluding any file already linked elsewhere, since saving that one
  would also push its other linked copies.
- **Content** is produced exactly as a normal save would: scripts are
  preprocessed, notecards are sent as-is. Existing destinations are written
  before any new items are created.
- Every destination the push writes or creates is linked to its master
  automatically, the same as **Pull to Workspace** does in reverse.
- The plugin reports one summary when the push finishes, in both a
  notification and the plugin log; an item that was created but whose content
  failed to save afterward (left empty in-world) is called out specifically.

---

## 5. External-Editor File Synchronisation

When a script is opened externally from the viewer, the extension links the
viewer's temporary file to a "master" file in the workspace.

- Saving the master file preprocesses and pushes the result to the viewer.
- Included / required files are watched; saving a dependency marks the master
  dirty so the next save picks up the change.
- **Synced file decoration** — synced local files are badged and coloured using
  the themable `secondlife.syncedfile` colour.
- **Mismatch prompt** — when the viewer copy differs from the master, a prompt
  offers *Ignore*, *Overwrite master*, *Compare* (opens a diff) or
  *Always ignore* (`slVscodeEdit.sync.askIfViewerScriptMismatchesMaster`).
- **Stop file sync** is available from the Explorer and editor-tab context menus
  while syncs are active (`second-life-scripting.stopFileSync`).
- **Link All** is available from an object context menu
  (`slVscodeEdit.autoLinkObject`). It establishes ephemeral links for all
  matching object files, including files in linked prims.
- Sync behaviour options: hash comparison before sending
  (`sync.compareHashBeforeSync`), file metadata header emission
  (`sync.includeFileMetaInOutput`, `sync.includeCreatorInFileMeta`), keeping the
  viewer temp file open (`sync.keepViewerFileOpen`), automatic linking when an
  object is explored (`sync.autoLinkOnPublish`) and a notecard comment marker
  (`sync.notecardComment`).

---

## 6. Preprocessor

Enabled by default (`slVscodeEdit.preprocessor.enable`) and applied on save for
both LSL and SLua.

### LSL

- `#include "file.lsl"` with include guards, configurable search paths and
  circular-include protection.
- `#define` constants and function-like macros, `#undef`.
- Conditional compilation: `#ifdef`, `#ifndef`, `#if`, `#elif`, `#else`,
  `#endif`, including the `defined()` operator and arbitrary nesting.
- Optional `switch` statement support
  (`slVscodeEdit.preprocessor.lsl.switchStatements`).

### SLua

- `require("module.luau")` inlines the module wrapped as an IIFE, resolved
  relative to the requiring file, with nested requires supported.
- The same module may be required more than once; runaway recursion is bounded
  by `slVscodeEdit.preprocessor.maxIncludeDepth` (default 5).
- Optional LSL-style predefined constants
  (`slVscodeEdit.preprocessor.constantsInSLua`).

### Shared

- Built-in macros: `__LINE__`, `__FILE__`, `__UNIXTIME__`.
- **Line mapping** — generated code carries `@line` markers so compile errors
  reported by the viewer are shown against the original source file and line.
- Search paths configurable via `slVscodeEdit.preprocessor.includePaths`
  (default `.`, `./include/`, `**/include/`, wildcards supported).

---

## 7. Diagnostics and Output

- **Problems panel** — compile errors and warnings returned by the viewer, plus
  preprocessor errors (missing includes, unclosed conditionals, circular
  includes), mapped back to the original file and line.
- **"Second Life" output channel** — timestamped runtime traffic from in-world
  scripts, including `llOwnerSay()` output, debug-channel chat and runtime
  errors.
- **"Second Life Plugin Log" output channel** — extension diagnostics
  (INFO/DEBUG/WARN/ERROR with stack traces).
- **Transient status-bar messages** for connection and syntax-update activity,
  auto-dismissed after `slVscodeEdit.ui.statusTimeoutSeconds`.

---

## 8. Language Tooling

- Ships Second Life language definitions (Luau type stubs, API documentation,
  LSL/Lua keyword data) and keeps them in step with the connected viewer's
  syntax version.
- **Luau LSP integration** (`johnnymorganz.luau-lsp`) — definition and
  documentation files are registered automatically and the server reloaded.
- **Selene integration** (`Kampfkarren.selene-vscode`) — a Second Life standard
  library YAML is generated and `selene.toml` updated to reference it.
- **`Second Life: Force Language Update`** refreshes all of the above on demand;
  automatic refresh can be turned off with `slVscodeEdit.syntax.autoUpdate`.
- Language is detected from the file extension: `.lsl` → LSL, `.luau` → SLua.

---

## 9. Workspace Scoping and Storage

- The extension can be disabled globally and enabled per workspace via
  `slVscodeEdit.enabled` or the `Second Life: Enable Extension in workspace`
  command; the explorer view appears only when enabled.
- Generated configuration and pin data are written into the workspace by default
  (`slVscodeEdit.storage.useLocalConfig`), or into global storage when disabled.
- A warning is shown if the extension starts without an open folder, since
  include resolution and generated configuration require a workspace.

---

## 10. Command Reference

| Command | Title |
| --- | --- |
| `second-life-scripting.enable` | Enable Extension in workspace |
| `second-life-scripting.connectWebSocket` | Connect WebSocket Client |
| `second-life-scripting.disconnectWebSocket` | Disconnect WebSocket Client |
| `second-life-scripting.showWebSocketClientStatus` | Show WebSocket Client Status |
| `second-life-scripting.forceLanguageUpdate` | Force Language Update |
| `second-life-scripting.stopFileSync` | Stop file sync with SL Viewer |
| `slVscodeEdit.openInventoryItem` | Open |
| `slVscodeEdit.saveItem` | Save |
| `slVscodeEdit.recompileScript` | Recompile |
| `slVscodeEdit.startScript` / `stopScript` / `restartScript` | Start / Stop / Restart |
| `slVscodeEdit.renameInventoryItem` / `deleteInventoryItem` | Rename… / Delete |
| `slVscodeEdit.renameObject` | Rename… (object or linked prim) |
| `slVscodeEdit.newFile` | New file… |
| `slVscodeEdit.autoLinkObject` | Link All |
| `slVscodeEdit.teleportToObject` | Teleport To |

---

## 11. Settings Summary

| Group | Keys |
| --- | --- |
| UI | `enabled`, `syntax.autoUpdate`, `ui.statusTimeoutSeconds` |
| Storage | `storage.useLocalConfig` |
| Sync | `sync.askIfViewerScriptMismatchesMaster`, `sync.compareHashBeforeSync`, `sync.includeFileMetaInOutput`, `sync.includeCreatorInFileMeta`, `sync.keepViewerFileOpen`, `sync.autoLinkOnPublish`, `sync.notecardComment` |
| Preprocessor | `preprocessor.enable`, `preprocessor.options`, `preprocessor.includePaths`, `preprocessor.maxIncludeDepth`, `preprocessor.constantsInSLua`, `preprocessor.lsl.switchStatements` |
| Network | `network.websocketPort`, `network.disconnectDelayMs`, `network.disposeDelayMs` |

All keys are prefixed with `slVscodeEdit.`.
