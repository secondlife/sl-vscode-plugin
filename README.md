# Second Life VSCode Plugin

**Enhance your Second Life scripting workflow with advanced preprocessing and external editing capabilities!**

[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](https://github.com/secondlife/sl-vscode-plugin)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![VS Code](https://img.shields.io/badge/VS%20Code-1.85.0+-red.svg)](https://code.visualstudio.com/)

The Second Life External Scripting Extension transforms VS Code into a development environment for Second Life scripts, supporting both **LSL (Linden Scripting Language)** and **SLua (Second Life Lua)** with preprocessing capabilities and viewer integration.

---

## Key Features

### Script Preprocessing

- **Include System**: Modular programming with `#include` directives (LSL) and `require()` syntax (SLua)
- **Macro Processing**: Define constants and function-like macros with `#define`
- **Conditional Compilation**: Code inclusion with `#ifdef`, `#ifndef`, `#if`, `#elif`, `#else`
- **Include Guards**: Automatic prevention of duplicate file inclusion
- **Circular Protection**: Detection and prevention of infinite include loops
- **Flexible Search Paths**: Configurable include directories for organized projects

### Real-Time Viewer Integration

- **WebSocket Connection**: Direct communication with Second Life viewer
- **Live Synchronization**: Real-time script editing and updates
- **External Editing**: Edit scripts externally while maintaining viewer session
- **Configurable Networking**: Customizable WebSocket port and connection settings

### Development Tools

- **Language Definitions**: Automatic download and updating of latest Second Life language definitions
- **Compile Error Display**: Real-time display of compilation errors from Second Life viewer
- **Debug Message Monitoring**: Capture and display debug messages from `llOwnerSay()` calls and debug channel chat
- **In-World Debugging**: Monitor script output and debug information directly in VS Code

### Cross-Language Support

- **LSL (Linden Scripting Language)**: Full preprocessing with includes, macros, and conditionals
- **SLua (Second Life Lua)**: Modern Lua scripting with `require()` module system
- **Smart Detection**: Automatic language recognition based on file extensions

---

## Installation

### From VS Code Marketplace (Coming Soon)

1. Open VS Code
2. Go to Extensions (Ctrl+Shift+X)
3. Search for "Second Life External Scripting"
4. Click Install

### Manual Installation

1. Download the latest `.vsix` file from [Releases](https://github.com/secondlife/sl-vscode-plugin/releases)
2. Open VS Code
3. Press `Ctrl+Shift+P` and type "Extensions: Install from VSIX"
4. Select the downloaded file

---

## Quick Start

### Setting Up Your First Project

1. **Create a new workspace folder** for your Second Life scripts
2. **Open the folder in VS Code**
3. **Start scripting** with preprocessing features!

### Basic Include Example (LSL)

Create modular, maintainable scripts:

**utils/constants.lsl**
```lsl
#define MAX_AVATARS 10
#define CHAT_CHANNEL 42
#define DEBUG_MODE
```

**utils/helpers.lsl**
```lsl
#include "constants.lsl"

#ifdef DEBUG_MODE
    #define DEBUG_SAY(msg) llOwnerSay("[DEBUG] " + msg)
#else
    #define DEBUG_SAY(msg) // No debug output in release
#endif

string formatMessage(string message) {
    return "[" + llGetScriptName() + "] " + message;
}
```

**main.lsl**
```lsl
#include "utils/helpers.lsl"

default {
    state_entry() {
        DEBUG_SAY("Script initialized");
        llSay(PUBLIC_CHANNEL, formatMessage("Hello, world!"));
        llListen(CHAT_CHANNEL, "", NULL_KEY, "");
    }

    listen(integer channel, string name, key id, string message) {
        if (channel == CHAT_CHANNEL) {
            DEBUG_SAY("Received: " + message);
            // Process command...
        }
    }
}
```

### Modern Module System (SLua)

Use modern Lua module patterns:

**modules/math-utils.luau**
```lua
local function clamp(value, min, max)
    return math.max(min, math.min(max, value))
end

local function lerp(a, b, t)
    return a + (b - a) * clamp(t, 0, 1)
end

return {
    clamp = clamp,
    lerp = lerp
}
```

**main.luau**
```lua
local mathUtils = require("modules/math-utils")

function onTouch(avatar)
    local distance = (avatar.position - object.position).magnitude
    local alpha = mathUtils.lerp(0.2, 1.0, distance / 10.0)
    object:setAlpha(alpha)
end
```

---

## Configuration

### Preprocessor Settings

Configure preprocessing behavior in VS Code settings:

```json
{
    "slVscodeEdit.preprocessor.enable": true,
    "slVscodeEdit.preprocessor.includePaths": [
        ".",
        "./include/",
        "**/include/"
    ],
    "slVscodeEdit.preprocessor.maxIncludeDepth": 5
}
```

**Note**: The `includePaths` shown above are the defaults. You can customize them to match your project structure (e.g., add `"./lib/"`, `"./utils/"`, or `"**/common/"`).

### Network Settings

Customize viewer connection:

```json
{
    "slVscodeEdit.network.websocketPort": 9020,
    "slVscodeEdit.network.disconnectDelayMs": 100,
    "slVscodeEdit.network.disposeDelayMs": 1000
}
```

### Storage Settings

Control where configuration files are stored:

```json
{
    "slVscodeEdit.storage.useLocalConfig": true
}
```

When `true` (default), configuration files are stored in your workspace's `.vscode` directory. When `false`, they're stored in the global VS Code settings directory.

---

## Using with Second Life Viewer

### Connection Setup

1. **Enable External Script Editor** in Second Life viewer preferences
2. **Set the editor** to connect via WebSocket on port 9020 (configurable)
3. **Configure the extension** using VS Code settings for WebSocket connection

### Workflow

1. **Right-click** on an object in Second Life
2. **Select "Edit"** → **"Scripts"**
3. **Click "New Script"** or **"Edit"** on existing script
4. **Choose external editor** - VS Code will automatically open
5. **Edit in VS Code** with full preprocessing support
6. **Save** to sync changes back to the viewer

---

## Additional Features

### Conditional Compilation

Create feature-toggled and platform-specific code:

```lsl
// Feature flags
#define FEATURE_ANALYTICS
#define FEATURE_ADVANCED_PHYSICS
// #define FEATURE_BETA_FEATURES

// Environment configuration
#ifdef PRODUCTION
    #define LOG_LEVEL 1
    #define MAX_RETRIES 3
#else
    #define LOG_LEVEL 3
    #define MAX_RETRIES 10
#endif

default {
    state_entry() {
        llOwnerSay("Log level: " + (string)LOG_LEVEL);

        #ifdef FEATURE_ANALYTICS
            // Analytics code only included when feature is enabled
            initializeAnalytics();
        #endif

        #ifdef FEATURE_BETA_FEATURES
            llOwnerSay("Beta features enabled");
        #endif
    }
}
```

### Function-Like Macros

Create reusable code templates:

```lsl
// Define a logging macro with parameters
#define LOG_ERROR(category, message) \
    llOwnerSay("[ERROR][" + category + "] " + message + " at " + (string)llGetUnixTime())

#define VALIDATE_AVATAR(id, action) \
    if (id == NULL_KEY) { \
        LOG_ERROR("AVATAR", "Invalid avatar ID in " + action); \
        return; \
    }

default {
    touch_start(integer total_number) {
        key toucher = llDetectedKey(0);
        VALIDATE_AVATAR(toucher, "touch_start");

        // Macro expands to full validation and logging code
        LOG_ERROR("TOUCH", "Unexpected touch event");
    }
}
```

### Nested Requirements (SLua)

Build complex module hierarchies:

**utils/logger.luau**
```lua
local Logger = {}

function Logger.info(message)
    print("[INFO] " .. message)
end

function Logger.warn(message)
    print("[WARN] " .. message)
end

function Logger.error(message)
    print("[ERROR] " .. message)
end

return Logger
```

**services/inventory.luau**
```lua
local logger = require("utils/logger")

local function getItemCount(itemName)
    logger.info("Checking inventory for: " .. itemName)
    -- Inventory logic here
    return 5
end

local function addItem(itemName, count)
    logger.info("Adding " .. count .. " of " .. itemName)
    -- Add item logic here
end

return {
    getItemCount = getItemCount,
    addItem = addItem
}
```

**main.luau**
```lua
local inventory = require("services/inventory")
-- Logger is automatically available through nested require

function onTouch(avatar)
    local coinCount = inventory.getItemCount("coins")
    inventory.addItem("coins", 1)
end
```

---

## Commands

Access these commands via the Command Palette (`Ctrl+Shift+P`):

| Command | Description |
|---------|-----------|
| `Second Life: Force Language Update` | Refresh language definitions and features |

---

## Documentation

Comprehensive guides available in the `doc/` directory:

- **[Preprocessor Guide](doc/preprocessor-guide.md)** - Complete preprocessing reference
- **[Message Interfaces](doc/Message_Interfaces.md)** - WebSocket communication protocols

---

## Requirements

- **Visual Studio Code** 1.85.0 or later
- **Node.js** (for development and testing)
- **Second Life Viewer** with external editor support

### Recommended Extensions

For enhanced language support and features, install these language server extensions:

**For SLua/Luau files:**
- **Selene** (`kampfkarren.selene-vscode`) - Lua linter and language support
- **Luau Language Server** (`johnnymorganz.luau-lsp`) - Luau language server

**For LSL files:**
- **LSL Language Server** (such as `sekkmer.vscode-lsl-lsp`) - LSL language support with diagnostics

**Additional Extensions for Enhanced Development:**
- **StyLua** (`johnnymorganz.stylua`) - Lua code formatter
- **VSCode LSL** (`vrtlabs.vscode-lsl`) - Alternative LSL language support

**Note**: These extensions are optional but recommended for the best development experience. The preprocessor and viewer integration features work independently of these language servers.

---

## Troubleshooting

### Common Issues

#### WebSocket Connection Failed
- **Check port**: Ensure port 9020 (or configured port) is available
- **Firewall**: Allow VS Code through Windows Firewall
- **Viewer settings**: Verify external editor is enabled in viewer preferences

#### Include Files Not Found
- **Check paths**: Verify include paths in settings
- **File extensions**: Ensure `.lsl` or `.luau` extensions are used
- **Working directory**: Includes are resolved relative to workspace root

#### Preprocessing Not Working
- **Enable preprocessing**: Check `slVscodeEdit.preprocessor.enable` setting
- **File types**: Preprocessing only works on `.lsl` and `.luau` files
- **Syntax errors**: Check for malformed directive syntax

### Getting Help

- **Issues**: [GitHub Issues](https://github.com/secondlife/sl-vscode-plugin/issues)
- **Discussions**: [GitHub Discussions](https://github.com/secondlife/sl-vscode-plugin/discussions)
- **Documentation**: Check the `doc/` folder for detailed guides

---

## Contributing

We welcome contributions! Please see our contributing guidelines:

1. **Fork** the repository
2. **Create** a feature branch (`git checkout -b feature/amazing-feature`)
3. **Commit** your changes (`git commit -m 'Add amazing feature'`)
4. **Push** to the branch (`git push origin feature/amazing-feature`)
5. **Open** a Pull Request

### Development Setup

```bash
git clone https://github.com/secondlife/sl-vscode-plugin.git
cd sl-vscode-plugin
npm install
npm run compile
```

### Running Tests

```bash
npm test              # Full test suite
npm run test-unit     # Unit tests only
npm run lint          # Code linting
```

---

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## Version History

### v1.0.0 (Initial Release)
- Advanced LSL and SLua preprocessing
- WebSocket viewer integration
- Include system with search paths
- Macro processing and conditional compilation
- Include guards and circular protection
- Real-time script synchronization

