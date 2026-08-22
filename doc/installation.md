# Installing the Second Life VS Code Plugin

This guide covers installing the Second Life VS Code Plugin and connecting it
to a compatible Second Life viewer.

## Before You Begin

You need:

- Visual Studio Code 1.85 or later. For more information about installing and
  configuring Visual Studio Code, see the official setup guide for
  [Windows](https://code.visualstudio.com/docs/setup/windows),
  [macOS](https://code.visualstudio.com/docs/setup/mac), or
  [Linux](https://code.visualstudio.com/docs/setup/linux).
- A Second Life viewer that supports the external editor WebSocket bridge,
  version 26.4 or later.
- The VS Code `code` command available on your system `PATH` when using VS
  Code Tight Integration.

### Install Luau Language Support

Install the **Luau Language Server** extension by `johnnymorganz.luau-lsp` so
VS Code can provide language support for SLua scripts.

1. Open the Extensions view with `Ctrl+Shift+X`.
2. Search for `Luau Language Server`.
3. Confirm that the publisher is `JohnnyMorganz`.
4. Select **Install**.

### Install LSL Language Support

Install the **LSL Language Server** extension by Jeremy Fairelander
(`jyaoma.lsl-lsp`) for language support when editing LSL scripts.

1. Open the Extensions view with `Ctrl+Shift+X`.
2. Search for `LSL Language Server`.
3. Confirm that the publisher is `Jeremy Fairelander`.
4. Select **Install**.

## Install from the Marketplace

1. Open Visual Studio Code.
2. Open the Extensions view with `Ctrl+Shift+X`.
3. Search for `Second Life VSCode Plugin`.
4. Confirm that the publisher is `Linden Lab`.
5. Select **Install**.

The extension is enabled by default. The standard viewer connection does not
require changing the extension's WebSocket port setting.

Start Visual Studio Code after installation, unless you plan to use **VS Code Tight Integration**. With Tight Integration enabled, selecting **Explore in IDE** can launch VS Code automatically.

## Enable Viewer Integration

1. Start the Second Life viewer.
2. Open **Me > Preferences > Advanced > Script Development**.
3. Enable **Enable external editor WebSocket sync**.
4. Enable **VS Code Tight Integration**.

The setting enables the viewer-side WebSocket synchronization. Start the Script Editor Server using one of the actions below.

## Start the Script Editor Server

The viewer's Script Editor Server provides the local WebSocket connection used
by the extension. You can start it in either of these ways.

### Start from the Build menu

Select **Build > Scripts > Script Editor Server**. A check mark indicates that
the server is running.

This starts the server only; it does not launch Visual Studio Code. Open VS
Code and select the **Connect** button (plug icon) in the title bar of the
**Second Life** view in the Explorer. You can also run **Second Life: Connect
WebSocket Client** from the Command Palette.

### Explore an object in the IDE

1. Select an editable object in-world and open the **Build** floater.
2. Select the **Content** tab.
3. Select **Explore in IDE**.

This starts the Script Editor Server if it is not already running. When **VS
Code Tight Integration** is enabled and VS Code is not already running, the
viewer launches VS Code. The selected object's editable inventory becomes
visible in the **Second Life** Explorer view.

When in Tight Integration mode, opening the script in the viewer's Script Editor
and selecting "Edit" will also start the Script Editor Server, launch Visual
Studio Code if it is not already running, add the object to the explorer, and open
the script for editing.

## Troubleshooting

### VS Code does not connect to the viewer

**Problem:** The extension does not show an active viewer connection.

**Answer:** Confirm that the viewer's external editor WebSocket sync setting
is enabled. Then select the **Connect** button (plug icon) in the title bar of
the **Second Life** view in the Explorer. You can also run **Second Life:
Connect WebSocket Client** from the Command Palette. The connection uses the
port configured in `slVscodeEdit.network.websocketPort`.

### The viewer cannot find Visual Studio Code

**Problem:** The viewer reports that it cannot launch Visual Studio Code, or
VS Code Tight Integration does not open VS Code.

**Answer:** Make the VS Code `code` command available on your system `PATH`.
In VS Code, open the Command Palette and run **Shell Command: Install 'code'
command in PATH**. Restart the viewer after installing the command. You can
also start VS Code yourself and use **Second Life: Connect WebSocket Client**
to connect to the viewer.

#### Set the system PATH

If the command is still unavailable, add the directory containing the `code`
command to your system `PATH`.

**Windows:**

1. Press `Win`, search for **Edit environment variables for your account**,
  and open it.
2. Under **User variables**, select `Path`, then select **Edit**.
3. Select **New** and add the VS Code `bin` directory. The default per-user
  installation path is `%LOCALAPPDATA%\Programs\Microsoft VS Code\bin`; a
  system-wide installation commonly uses `C:\Program Files\Microsoft VS
  Code\bin`.
4. Select **OK** on each dialog, then restart the viewer.

**macOS:** In VS Code, run **Shell Command: Install 'code' command in PATH**.
Restart Terminal for the new `PATH` value to take effect, then restart the
viewer.

**Linux:** Add the directory containing the VS Code `code` command to `PATH`
in your shell startup file, such as `~/.profile` or `~/.bashrc`. Distribution
packages commonly install it in `/usr/bin`; Flatpak installations use the
`flatpak` command instead of `code`.
