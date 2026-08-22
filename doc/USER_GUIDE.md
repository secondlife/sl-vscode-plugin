# Second Life VS Code Plugin - User Guide

## Overview

The Second Life VS Code Plugin brings Second Life scripting into Visual Studio
Code. It supports both **LSL (Linden Scripting Language)** and **Lua** and
connects the editor directly to the Second Life viewer.

The plugin also supports workspace-based source files, preprocessing, viewer
compilation diagnostics, script runtime output, and language tooling for Second
Life APIs. It is designed to let you move between in-world content and the
source files used to develop it without leaving VS Code.

The **Second Life** view remains available while disconnected. After the viewer
connects, it becomes the starting point for finding published objects and
opening their contents. Pinned objects can remain visible between connections.

## Configuring the Plugin in the Viewer

The viewer-side settings are in **Preferences > Advanced > Script Development**.
These settings control how the viewer launches the external editor and how it
communicates with the plugin.

![Second Life viewer Script Development settings](images/Script%20Config.png)

### External Script Editor

Set **External Script Editor** to the path of the VS Code executable. On
Windows, this is commonly the `Code.exe` installed with Visual Studio Code.
Use **Browse...** to select the executable instead of entering the path by
hand.

The viewer uses this executable when it opens a script for external editing.
The `%s` at the end of the field is the file argument supplied to the editor.

When **VS Code Tight Integration** is enabled, the viewer ignores the
**External Script Editor** field and uses the tight integration workflow instead.

### Script error display

Enable **Show script errors in** to choose where viewer compilation errors are
displayed:

- **Nearby chat** displays the errors in the nearby chat area.
- **Separate window** displays the errors in a dedicated viewer window.

This setting controls the viewer's own error display. It is separate from the
plugin's Problems panel, which can also receive compilation diagnostics through
the WebSocket connection.

### VS Code Tight Integration

Enable **VS Code Tight Integration** to allow the viewer and VS Code to work
together as an external editing pair. This setting is required for the viewer
to use the plugin's integration workflow. Tight integration also enables the
viewer WebSocket connection.

### WebSocket synchronization

Enable **Enable WebSocket Sync** to allow the viewer to communicate with the
plugin over WebSocket.

Set **WebSocket Listen Port** to the port on which the viewer listens for the
plugin connection. The default shown in the viewer is `9020`; the viewer and
the plugin must use the same port.

### Forwarding errors and debug output

Enable **Forward script errors and debug to WebSocket clients** to send viewer
script compilation errors and runtime debug output to connected WebSocket
clients. With this enabled, the plugin can show diagnostics in VS Code and
runtime messages in its Second Life output channel.

## Configuring the Plugin in VS Code

The plugin options are available in **File > Preferences > Settings**. Search
for `SL Scripting` to display the settings contributed by the plugin. All
settings use the `slVscodeEdit.` prefix.

### UI

| Setting | Type | Default | Purpose |
| --- | --- | --- | --- |
| `slVscodeEdit.enabled` | Boolean | `true` | Enables the plugin and controls whether the Second Life view is shown. |
| `slVscodeEdit.syntax.autoUpdate` | Boolean | `true` | Automatically updates Luau-LSP and Selene configuration when language definitions change. |
| `slVscodeEdit.ui.statusTimeoutSeconds` | Number | `3` | Sets how long temporary plugin status messages are displayed. Allowed range: 1–30 seconds. |

### Storage

| Setting | Type | Default | Purpose |
| --- | --- | --- | --- |
| `slVscodeEdit.storage.useLocalConfig` | Boolean | `true` | Stores generated configuration files in the local workspace instead of global VS Code settings. |

### Sync

| Setting | Type | Default | Purpose |
| --- | --- | --- | --- |
| `slVscodeEdit.sync.askIfViewerScriptMismatchesMaster` | Boolean | `true` | Asks what to do when the viewer script differs from its master file. |
| `slVscodeEdit.sync.compareHashBeforeSync` | Boolean | `false` | Checks for content changes before sending a file to the viewer. |
| `slVscodeEdit.sync.includeFileMetaInOutput` | Boolean | `false` | Includes file metadata in processed script output. |
| `slVscodeEdit.sync.includeCreatorInFileMeta` | Boolean | `false` | Includes the current Second Life user in file metadata. |
| `slVscodeEdit.sync.keepViewerFileOpen` | Boolean | `true` | Keeps the viewer's temporary file open during editing. |
| `slVscodeEdit.sync.notecardComment` | String | `null` | Defines the comment text used to match external files with notecards. |

### Preprocessor

| Setting | Type | Default | Purpose |
| --- | --- | --- | --- |
| `slVscodeEdit.preprocessor.enable` | Boolean | `true` | Enables preprocessing for script files. |
| `slVscodeEdit.preprocessor.options` | String | Not set | Provides preprocessor options. |
| `slVscodeEdit.preprocessor.includePaths` | Array of strings | `[".", "./include/", "**/include/"]` | Lists paths searched for include files. |
| `slVscodeEdit.preprocessor.maxIncludeDepth` | Number | `5` | Limits nested `#include` and `require()` processing. Allowed range: 1–50. |
| `slVscodeEdit.preprocessor.constantsInSLua` | Boolean | `false` | Enables predefined LSL-style preprocessor constants in Lua. |
| `slVscodeEdit.preprocessor.lsl.switchStatements` | Boolean | `false` | Enables LSL switch statement preprocessing. |

### Network

| Setting | Type | Default | Purpose |
| --- | --- | --- | --- |
| `slVscodeEdit.network.websocketPort` | Number | `9020` | Sets the WebSocket server port used for synchronization with the viewer. Allowed range: 1–65535. |
| `slVscodeEdit.network.disconnectDelayMs` | Number | `100` | Sets the delay before the WebSocket closes after a disconnect message. |
| `slVscodeEdit.network.disposeDelayMs` | Number | `1000` | Sets the delay before resources are disposed after a session disconnects. |

## Starting WebSocket Sync

The viewer provides the WebSocket server used by the plugin. Start it using
either of these viewer-side actions.

### From the Build menu

1. Open the viewer's **Build** menu.
2. Select **Scripts > Script Editor Server**.

![Starting the Script Editor Server from the Build menu](images/Build%20Menu.png)

### From the Build floater

1. Open the Build floater for the selected object.
2. Open the **Content** tab.
3. Select **Explore in IDE**.

![Starting the Script Editor Server with Explore in IDE](images/Build%20Floater.png)

Selecting **Explore in IDE** starts the server, launches VS Code, and begins the
workflow for the selected object. The viewer first checks for an already
connected editor; if none is found, it launches VS Code and instructs the
plugin to connect to the viewer. The viewer can then communicate with the
plugin over WebSocket.

The plugin connects as a WebSocket client when you select the plug icon in the
**Second Life** view or run **Second Life: Connect WebSocket Client**. The
viewer and plugin must use the same **WebSocket Listen Port**, which defaults
to `9020`.

After the connection succeeds, the Second Life view shows the connected state
and the plugin can receive explored objects, synchronize scripts, and receive
viewer compilation errors and runtime debug output.

## Connecting the Plugin to the Viewer

After the viewer's Script Editor Server is running, connect the plugin to the
viewer from the **Second Life** view in VS Code.

### Manual connection

You can start the connection in either of these ways:

- Select the large blue **Connect** button in the disconnected Second Life
	view.
- Select the **plug icon** in the title bar of the Second Life view.

![Connecting the plugin with the blue Connect button](images/plugin_disconnected_B.png)

The plugin connects to the viewer using the configured WebSocket listen port.
When the connection succeeds, the view changes from **DISCONNECTED** to
**Connected** and the explored objects become available.

### Automatic connection

When VS Code is launched by selecting **Explore in IDE** in the viewer's Build
floater, the plugin connects automatically after VS Code starts. No manual
selection of the blue **Connect** button or plug icon is required.

## Disconnecting from the Viewer

You can disconnect from the viewer at any time by selecting the **broken plug
icon** at the top of the **Second Life** Explorer view.

## Working in the Plugin

![Editing an explored file in VS Code](images/Full%20Edit%20Window%20A.png)

The inventory rows in the explored object use icons and indicators to show the
type, permissions, and current state of each item. The connected explorer
image above shows these indicators next to the inventory names.

| Indicator | Meaning |
| --- | --- |
| <img src="../icons/Inv_Script.png" alt="LSL script icon" width="16"> | The item is an LSL script. The plugin displays the `.lsl` file name when it is opened. |
| <img src="../icons/Inv_Script_Luau.png" alt="Luau script icon" width="16"> | The item is a Luau script. The plugin displays the `.luau` file name when it is opened. |
| <img src="../icons/Inv_Notecard.png" alt="Notecard icon" width="16"> | The item is a notecard. Notecards are opened as text documents. |
| 🟢 | The script is running. |
| 🔴 | The script is stopped. |
| ▶️ | Select to start a stopped script. |
| ⏹️ | Select to stop a running script. |
| <img src="../icons/no-mod.png" alt="No Modify badge" width="16"> | The item cannot be modified with the current permissions. |
| <img src="../icons/no-copy.png" alt="No Copy badge" width="16"> | The item cannot be copied with the current permissions. |
| <img src="../icons/no-trans.png" alt="No Transfer badge" width="16"> | The item cannot be transferred with the current permissions. |

### Editing Explored Files

To edit a file explored directly from the viewer, click the script name in the
explored object. VS Code opens the script in an editor, where you can type and
edit normally. Saving the file sends it to the viewer and triggers a script
compile. Editing an explored file this way does not invoke the plugin's
preprocessor.

### Using a Workspace

![Editing an explored file with a VS Code workspace](images/Full%20Edit%20Workspace.png)

When you open or select a script from an explored object while a VS Code
workspace is open, the plugin automatically looks for a workspace file with
the same name. If it finds a matching file, the plugin links the explored file
to that workspace file and opens the workspace file in the editor.

You can identify the linked master file by the link icon displayed next to its
name.

When you save the linked workspace file, the plugin invokes the preprocessor
and sends the processed result to the viewer. The viewer then compiles the
resulting script. For details about includes and requires, macros, conditionals,
and other preprocessor behavior, see the [Preprocessor Guide](preprocessor-guide.md).

## Pinning Objects

You can pin explored objects in the **Second Life** view so they are restored
when the plugin reconnects. Pinned objects are remembered across reconnects,
which makes it easier to return to previously explored content without having
to re-explore it each time.

To pin an object, select the pin icon next to it in the **Second Life**
explorer. Pinned objects remain in the restored list until you unpin them. This
is useful when you want the same object set to be available after reconnecting
the viewer and plugin.

If the viewer cannot find a restored object, it appears grayed out while the
plugin is connected. If you do not have permission to modify the object, it is
shown in red and displays the **No Modify** badge.

## Context Menus

### Item Context Menu

![Item context menu in the Second Life explorer](images/Item%20Contex%201.png)

Right-click an item in the **Second Life** explorer to open its context menu.
The available actions depend on the item type, but common actions include:

- **Open**: Opens the selected file in the editor.
- **Start / Stop**: Starts or stops a script.
- **Restart**: Resets a running script.
- **Select VM**: Lets the user choose the virtual machine the script will
  compile against, such as LSL, Mono, or Luau.
- **Rename...**: Changes the item's name. For scripts, changing the file
  extension switches the language between LSL and Lua, while the extension
  itself is not shown in the displayed item name. For notecards, the
  extension is part of the item's visible name.
- **Delete**: Permanently deletes the item from the object's inventory in the
  world.

Use the item context menu to quickly open, manage, or remove explored content
without navigating back to the build floater in the viewer.

### Object Context Menu

![Object context menu in the Second Life explorer](images/Context%20Menu%20Objects.png)

Right-click an object in the **Second Life** explorer to open its context menu.
The available actions include:

- **Rename...**: Changes the object's name.
- **New File...**: Prompts for a filename. If the name ends with `.lsl`, the
  new item is created as an LSL script; if it ends with `.luau`, it is created
  as a Luau script; otherwise, it is created as a notecard.
- **Unexplore**: Removes the selected object from publication in the viewer.
- **Save Back to Contents**: If the object was rezzed directly from another object,
  it is saved back to that rezzing object's inventory.
- **Teleport To**: Teleports the agent in the viewer to the object's
  location.
- **Zoom In**: Focuses the viewer camera on the selected object.

Use the object context menu to manage the selected object directly from the
explorer without leaving the workspace flow.

## Message Capture

![Message routing diagram](images/message_routing.png)

Message Capture forwards messages from explored objects that are sent on the
**DEBUG_CHANNEL**, emitted with owner say (`llOwnerSay()` / `print()`), or
raised as runtime errors. You can view the message stream in VS Code by opening
the **Output** tab and selecting **Second Life** from the dropdown.

This lets you monitor script output and runtime issues as part of the same
object-exploration workflow used for editing and testing.
