# Second Life Script Preprocessor - Complete Guide

The Second Life Script Preprocessor is a comprehensive tool that supports advanced preprocessing directives for LSL (Linden Scripting Language) scripts. This preprocessor enables modular programming, code reuse, conditional compilation, and macro expansion to create maintainable and configurable scripts. For SLua (Second Life Lua) scripts, the extension supports `require()` syntax for file inclusion.

## Table of Contents

1. [Overview](#overview)
2. [Directive Syntax](#directive-syntax)
3. [Include Directives](#include-directives)
4. [Require Syntax (SLua/Luau)](#require-syntax-sluaaluau)
5. [Include vs Require Behavior](#include-vs-require-behavior)
6. [Macro Definitions (Defines)](#macro-definitions-defines)
7. [Conditional Processing](#conditional-processing)
8. [Complete Examples](#complete-examples)
9. [Best Practices](#best-practices)
10. [Limitations](#limitations)
11. [Integration with VS Code Extension](#integration-with-vs-code-extension)

## Overview

The Second Life Script Preprocessor allows you to:

- **Modular Programming**: Split large scripts into smaller, manageable files using include directives
- **Code Reuse**: Create reusable libraries and utility functions shared across multiple scripts
- **Macro System**: Define constants and function-like macros for cleaner, more maintainable code
- **Conditional Compilation**: Include or exclude code blocks based on compile-time conditions
- **Feature Toggles**: Enable/disable features, debugging, and platform-specific code paths
- **Source Mapping**: Track relationships between original source files and processed output

## Directive Syntax

### LSL Format

```lsl
#<directive> [parameters]
```



### Supported Directives

| Directive | Purpose                                  | LSL |
| --------- | ---------------------------------------- | --- |
| `include` | Include file content                     | ✓   |
| `define`  | Define macros and constants              | ✓   |
| `ifdef`   | Conditional compilation (if defined)     | ✓   |
| `ifndef`  | Conditional compilation (if not defined) | ✓   |
| `if`      | Conditional compilation with expressions | ✓   |
| `elif`    | Else-if conditional                      | ✓   |
| `else`    | Default conditional case                 | ✓   |
| `endif`   | End conditional block                    | ✓   |

## Include Directives

Include directives allow you to include the content of other script files into your main script during preprocessing, enabling code reuse and modular programming.

### Basic Include Syntax

**LSL:**

```lsl
#include filename
#include "filename with spaces"
#include <system_filename>
```

### Include Formats

#### Basic Include

Simple filename without quotes (no spaces allowed):

```lsl
#include mylib.lsl
#include ../common/utilities.lsl
```

#### Quoted Filenames

Filenames with spaces must be quoted:

```lsl
#include "my library with spaces.lsl"
#include 'single quoted file.lsl'
```

#### Angle Bracket Includes

System or library files:

```lsl
#include <system_library.lsl>
#include <math_utils.lsl>
```



### Include Guards and File Tracking

The preprocessor automatically (for `#include` directives only):

- Prevents multiple inclusion of the same file using include guards
- Detects and prevents circular inclusions
- Adds file tracking comments to mark included content boundaries

> **Note**: Include guards only apply to `#include` directives in LSL. The SLua `require()` syntax allows multiple inclusions. See [Include vs Require Behavior](#include-vs-require-behavior) below.

**Line tracking comment format:**

```lsl
// @line 0 "path/to/included/file.lsl"    // LSL format
```

```luau
-- @line 0 "path/to/included/file.luau"   -- Luau format
```

These line directives help map processed code back to original source files for error reporting and debugging.

## Require Syntax (SLua/Luau)

For SLua (Second Life Lua) scripts, the preprocessor supports `require()` syntax for including module files. This provides a more Lua-idiomatic way to organize code into reusable modules.

### Basic Require Syntax

```luau
local module = require("module_name.luau")
local utils = require("utils/helper.luau")
local math_lib = require("include/math_utils.luau")
```

> **Important**: The path to the required file must be **relative** to the file containing the `require()` statement. Unlike `#include`, `require()` does **not** use the configured include paths search. Absolute paths are not supported.

**Path Resolution Examples:**

```luau
-- All paths are relative to the file containing the require() statement

-- Same directory as current file
local sibling = require("sibling_module.luau")

-- Subdirectory relative to current file
local sub = require("subfolder/module.luau")

-- Parent directory relative to current file
local parent = require("../parent_module.luau")

-- Subdirectory with nested path
local helper = require("include/helper.luau")  -- If include/ exists relative to current file
```

> **Note**: If you have a file structure like `/project/src/main.luau` and `/project/include/utils.luau`, you would use `require("../include/utils.luau")` from main.luau, NOT `require("utils.luau")`.

### How Require Works

When the preprocessor encounters a `require()` statement:

1. **File Resolution**: Resolves the module path relative to the current file
2. **Content Loading**: Reads the module file content
3. **Recursive Processing**: Processes any nested `require()` statements in the module
4. **IIFE Wrapping**: Wraps the module content in an immediately-invoked function expression:
   ```luau
   (function()
   -- @line 0 "path/to/module.luau"
   -- module content here
   end)()
   ```
5. **Inline Replacement**: Replaces the `require()` call with the wrapped module content

### Nested Requires

Modules can require other modules, creating a dependency tree:

**main.luau:**
```luau
local data = require("data_manager.luau")
print("Starting application")
```

**data_manager.luau:**
```luau
local validator = require("validator.luau")
local storage = require("storage.luau")

return {
    validate = validator.validate,
    save = storage.save
}
```

The preprocessor recursively processes all nested requires up to the configured depth limit (default: 5 levels).

### Depth Limiting

To prevent infinite recursion in circular dependencies, the preprocessor limits nesting depth:

- **Default maximum depth**: 5 levels
- **Configurable**: Set `slVscodeEdit.preprocessor.maxIncludeDepth` in VS Code settings (range: 1-50)
- **Error on exceed**: Generates a preprocessor error when the depth limit is reached

**Example of depth limit error:**

```luau
-- If circular_a.luau requires circular_b.luau
-- and circular_b.luau requires circular_a.luau
-- This will hit the depth limit after 5 iterations
local module = require("circular_a.luau")
-- Error: Maximum require() nesting depth (5) reached in file: circular_a.luau
```

### Comment Handling

The preprocessor correctly ignores `require()` statements in comments:

```luau
-- This won't be processed: require("ignored.luau")
--[[
Multi-line comment with require("also_ignored.luau")
]]--

local real = require("processed.luau")  -- This WILL be processed
```

## Include vs Require Behavior

Understanding the differences between `#include` (LSL) and `require()` (SLua) is crucial for correct usage:

### Comparison Table

| Feature | `#include` (LSL) | `require()` (SLua) |
|---------|------------------|-------------------|
| **Language** | LSL only | SLua/Luau only |
| **Path resolution** | Uses configured include paths | Relative to current file only |
| **Multiple inclusions** | ❌ Prevented by include guards | ✅ Allowed - same file can be required multiple times |
| **Include guards** | ✅ Automatic | ❌ Not used |
| **Circular protection** | Include guards + depth limit | Depth limit only |
| **Depth limit** | 5 (configurable) | 5 (configurable) |
| **Error on depth exceeded** | ✅ Yes | ✅ Yes |
| **Wrapping** | No wrapping | Wrapped in `(function()...end)()` |
| **Use case** | Header files, constants, preventing redefinitions | Module reuse, flexible composition |

### Multiple Inclusion Examples

**LSL `#include` - Single Inclusion:**

```lsl
// file: main.lsl
#include "constants.lsl"  // Included
#include "constants.lsl"  // Skipped - include guard prevents duplicate

// Result: constants.lsl content appears ONCE
```

**SLua `require()` - Multiple Inclusions Allowed:**

```luau
-- file: main.luau
local math1 = require("math_utils.luau")  -- Included (first instance)
local math2 = require("math_utils.luau")  -- Included again (second instance)

-- Result: math_utils.luau content appears TWICE, each wrapped separately
```

### When to Use Each

**Use `#include` (LSL) when:**
- Defining constants and global variables
- Including header files with function declarations
- Preventing duplicate symbol definitions
- Traditional C-style header/implementation pattern

**Use `require()` (SLua) when:**
- Loading reusable modules multiple times in different contexts
- Building flexible module systems
- Creating independent instances of module functionality
- Following Lua's module pattern

### Circular Dependency Handling

**`#include` with Include Guards:**

```lsl
// header_a.lsl
#ifndef HEADER_A
#define HEADER_A

#include "header_b.lsl"  // First inclusion of B works
// ... code ...

#endif

// header_b.lsl
#ifndef HEADER_B
#define HEADER_B

#include "header_a.lsl"  // Second inclusion of A is skipped (guard)
// ... code ...

#endif

// Result: No infinite loop, each file included once
```

**`require()` with Depth Limiting:**

```luau
-- module_a.luau
local b = require("module_b.luau")  -- Depth 0 -> 1
return { name = "A", b = b }

-- module_b.luau
local a = require("module_a.luau")  -- Depth 1 -> 2, 2 -> 3, ... up to 5
return { name = "B", a = a }

-- Result: Processes up to depth 5, then generates error:
-- "Maximum require() nesting depth (5) reached in file: module_a.luau"
```

### Error Reporting

Both directives generate consistent errors when limits are exceeded:

**Depth Limit Error:**

```
// #include error:
Maximum include depth (5) exceeded for file: deeply_nested.lsl

// require() error:
Maximum require() nesting depth (5) reached in file: deeply_nested.luau
```

**File Not Found Error:**

```
// #include error:
Include file "missing.lsl" not found

// require() error:
Failed to resolve require: "missing.luau"
```

Both errors cause `result.success = false` and are reported in the preprocessor issues collection.

## Macro Definitions (Defines)

The preprocessor supports C-style `#define` directives for creating reusable constants, macros, and function-like macros.

### Predefined System Macros

The preprocessor automatically defines the following system macros that are available in all scripts:

| Macro | Description | Example Value |
|-------|-------------|---------------|
| `__AGENTID__` | Agent UUID (formatted) | `"550e8400-e29b-41d4-a716-446655440000"` |
| `__AGENTIDRAW__` | Raw agent ID format (not stringized) | `550e8400e29b41d4a716446655440000` |
| `__AGENTKEY__` | Alternate name for `__AGENTID__` | `"550e8400-e29b-41d4-a716-446655440000"` |
| `__AGENTNAME__` | Agent display name | `"Resident Name"` |
| `__ASSETID__` | Script asset UUID | `"123e4567-e89b-12d3-a456-426614174000"` |
| `__DATE__` | Current date | `"Oct 24 2025"` |
| `__FILE__` | Full path/name of current file being processed | `"scripts/main.lsl"` |
| `__LINE__` | Current line number being processed | `42` |
| `__SHORTFILE__` | Short filename without path | `"main.lsl"` |
| `__TIME__` | Current time | `"14:30:00"` |
| `__TIMESTAMP__` | Combined date/time timestamp | `"Oct 24 2025 14:30:00"` |

**Usage Example:**

```lsl
default {
    state_entry() {
        llOwnerSay("Script: " + __SHORTFILE__ + " (Agent: " + __AGENTNAME__ + ")");
        llOwnerSay("Compiled on " + __DATE__ + " at " + __TIME__);
        llOwnerSay("Running on line " + (string)__LINE__);
    }
}
```

### Simple Defines

Replace a macro name with a fixed value:

**LSL:**

```lsl
#define MAX_ITEMS 10
#define DEBUG_MODE TRUE
#define PI 3.14159265
#define GREETING "Hello, avatar!"
```



### Function-like Macros

Accept parameters and perform text substitution:

**Single Parameter:**

```lsl
#define SQUARE(x) ((x) * (x))
#define ABS(x) ((x) < 0 ? -(x) : (x))
#define TO_RADIANS(degrees) ((degrees) * PI / 180.0)
```



**Multiple Parameters:**

```lsl
#define MAX(a, b) ((a) > (b) ? (a) : (b))
#define MIN(a, b) ((a) < (b) ? (a) : (b))
#define LERP(a, b, t) ((a) + (t) * ((b) - (a)))
#define DISTANCE_2D(x1, y1, x2, y2) llSqrt(((x2) - (x1)) * ((x2) - (x1)) + ((y2) - (y1)) * ((y2) - (y1)))
```



### Nested Macro Expansion

The preprocessor supports nested macro calls:

```lsl
#define SQUARE(x) ((x) * (x))
#define ADD(a, b) (a + b)
#define CUBE(x) ((x) * SQUARE(x))

// Nested expansion
integer result = SQUARE(ADD(2, 3));  // Expands to ((2 + 3) * (2 + 3))
integer result2 = CUBE(ADD(1, 2));   // Expands to ((1 + 2) * ((1 + 2) * (1 + 2)))
```

### Stringization Operator (#)

The stringization operator (`#`) converts macro parameters into string literals. This is particularly useful for debugging, logging, and creating dynamic messages.

**Basic Stringization:**

```lsl
#define STRINGIFY(x) #x
#define DEBUG_VAR(var) llOwnerSay("Variable " + #var + " = " + (string)(var))

// Usage examples
string name = STRINGIFY(hello_world);      // Expands to: string name = "hello_world";
DEBUG_VAR(myVariable);                     // Expands to: llOwnerSay("Variable " + "myVariable" + " = " + (string)(myVariable));
```



**Advanced Stringization:**

```lsl
#define LOG_ERROR(tag, expr) llOwnerSay("ERROR [" + #tag + "]: " + #expr + " = " + (string)(expr))
#define ASSERT(condition) if (!(condition)) llOwnerSay("Assertion failed: " + #condition)

// Complex expressions
LOG_ERROR(MATH, x + y * 2);               // Expands to: llOwnerSay("ERROR [" + "MATH" + "]: " + "x + y * 2" + " = " + (string)(x + y * 2));
ASSERT(value > 0);                        // Expands to: if (!(value > 0)) llOwnerSay("Assertion failed: " + "value > 0");
```



**Mixed Parameter Usage:**

```lsl
#define TRACE_FUNC(name, result) llOwnerSay("Function " + #name + "() returned: " + (string)(result))

// The macro uses both stringized (#name) and normal (result) parameter substitution
TRACE_FUNC(calculateDistance, distance);  // Expands to: llOwnerSay("Function " + "calculateDistance" + "() returned: " + (string)(distance));
```

**Important Notes about Stringization:**

- The `#` operator converts the exact text of the argument into a string literal
- Leading and trailing whitespace is automatically trimmed
- Quotes and backslashes in arguments are properly escaped
- Stringization happens before normal parameter substitution
- Can be combined with regular parameter substitution in the same macro

### Token Pasting Operator (##)

The token pasting operator (`##`) concatenates adjacent tokens by removing whitespace between them. This is useful for creating identifiers, combining prefixes/suffixes, and building complex tokens dynamically.

**Basic Token Pasting:**

```lsl
#define PASTE(x, y) x ## y
#define VAR_NAME(suffix) variable ## suffix

// Usage examples
integer PASTE(my, Variable) = 42;         // Expands to: integer myVariable = 42;
float VAR_NAME(Count) = 3.14;             // Expands to: float variableCount = 3.14;
```



**Creating Function Names:**

```lsl
#define DEFINE_GETTER(type, name) type get ## name() { return this.name; }
#define DEFINE_SETTER(type, name) void set ## name(type value) { this.name = value; }

// Usage examples
DEFINE_GETTER(string, PlayerName)          // Expands to: string getPlayerName() { return this.PlayerName; }
DEFINE_SETTER(integer, Health)             // Expands to: void setHealth(integer value) { this.Health = value; }
```



**Multiple Token Pasting:**

```lsl
#define TRIPLE_PASTE(a, b, c) a ## b ## c
#define NAMESPACE_FUNC(ns, module, func) ns ## _ ## module ## _ ## func

// Usage examples
TRIPLE_PASTE(get, Item, Count)();          // Expands to: getItemCount();
NAMESPACE_FUNC(game, player, getName)();   // Expands to: game_player_getName();
```

**Combining with Stringization:**

```lsl
#define DEBUG_MEMBER(obj, member) llOwnerSay(#member + " = " + (string)(obj ## . ## member))
#define LOG_VAR(prefix, name) llOwnerSay("Variable " + #prefix #name + " = " + (string)(prefix ## name))

// Usage examples
DEBUG_MEMBER(player, health);              // Expands to: llOwnerSay("health" + " = " + (string)(player.health));
LOG_VAR(my, Count);                        // Expands to: llOwnerSay("Variable " + "myCount" + " = " + (string)(myCount));
```

**Advanced Patterns:**

```lsl
#define DECLARE_PROPERTIES(type, name) type name ## _value; \
                                      type get ## name() { return name ## _value; } \
                                      void set ## name(type value) { name ## _value = value; }

// Usage
DECLARE_PROPERTIES(string, PlayerName)
// Expands to:
// string PlayerName_value;
// string getPlayerName() { return PlayerName_value; }
// void setPlayerName(string value) { PlayerName_value = value; }
```

**Important Notes about Token Pasting:**

- The `##` operator removes all whitespace around it when concatenating
- Token pasting happens after parameter substitution but before stringization
- Can be used to create valid identifiers, operators, or any token sequence
- Multiple `##` operators in sequence are processed left to right
- Empty tokens are handled gracefully (effectively removing the empty part)

### Macro Definition Output

When processing `#define` directives, the preprocessor outputs tracking comments:

**Format:**

```lsl
//@ define: MACRO_NAME=value
//@ define: FUNCTION_MACRO(param1,param2)=body
```

### Line Continuation

The preprocessor supports line continuation for creating long macro definitions and multi-line expressions that span multiple lines for better readability.

#### Explicit Line Continuation

Use a backslash (`\`) at the end of a line to explicitly continue the definition on the next line:

**LSL:**

```lsl
#define LONG_MESSAGE "This is a very long message that \
                     spans multiple lines for better \
                     readability and maintainability"

#define COMPLEX_CALCULATION(x, y) ((x) * (y) + \
                                  (x) * (x) + \
                                  (y) * (y))
```



#### Automatic Line Continuation

The preprocessor automatically detects and combines multi-line expressions that span multiple lines without requiring explicit backslash continuation. This is particularly useful for function calls with complex arguments:

**Automatic continuation is triggered when:**

- Line ends with concatenation operator (`..`), arithmetic operators (`+`, `-`, `*`, `/`), assignment (`=`), comma (`,`), or open parenthesis (`(`)
- Line has unmatched parentheses

**LSL Example:**

```lsl
// This multi-line function call is automatically combined
LOG_INFO("Avatar: " + avatar_name +
         ", Position: " + (string)pos +
         ", Region: " + region_name);

// Function calls with multiple parameters
some_function(first_parameter,
              second_parameter,
              third_parameter);
```



#### Line Continuation Behavior

**Automatic continuation respects statement boundaries:**

- Continuation stops when the next line starts with keywords like `local`, `function`, `if`, `for`, `while`, `end`, `return`, `break`
- Continuation stops when the next line starts with preprocessor directives (`#`)
- Continuation stops when the next line starts with new function calls like `print(`

**Example of proper boundary detection:**

```lua
-- These remain separate statements
LOG_INFO("First message: " ..
         "continued part")
local variable = 42         -- This starts a new statement
LOG_INFO("Second message")  -- This starts a new statement
```

## Conditional Processing

Conditional processing allows you to include or exclude code blocks based on compile-time conditions.

### Basic Conditional Directives

#### `ifdef` - If Defined

Includes code only if a macro is defined:

```lsl
#define DEBUG
#ifdef DEBUG
    llOwnerSay("Debug mode enabled");
#endif
```



#### `ifndef` - If Not Defined

Includes code only if a macro is NOT defined:

```lsl
#ifndef PRODUCTION
    llOwnerSay("Development build");
#endif
```



### Advanced Conditional Directives

#### `if` - Conditional Expression

Evaluates a condition expression:

```lsl
#define VERSION 2
#if VERSION > 1
    llOwnerSay("Using new API features");
#endif
```



#### `elif` - Else If

Provides alternative conditions:

```lsl
#define API_VERSION 2
#if API_VERSION == 1
    llSay(0, "Version 1.0");
#elif API_VERSION == 2
    llRegionSayTo(llGetOwner(), 0, "Version 2.0");
#elif API_VERSION >= 3
    llOwnerSay("Version 3.0+");
#endif
```

#### `else` - Default Case

Includes code if all previous conditions were false:

```lsl
#define ENVIRONMENT "production"
#if ENVIRONMENT == "development"
    llOwnerSay("Development environment");
#elif ENVIRONMENT == "testing"
    llOwnerSay("Testing environment");
#else
    llOwnerSay("Production environment");
#endif
```

### Condition Expressions

#### Supported Expression Types

1. **Macro Existence**: `#ifdef MACRO_NAME`, `#ifndef MACRO_NAME`
2. **Macro Values**: `#if ENABLED` (true if defined and non-zero)
3. **Numeric Literals**: `#if 1` (true), `#if 0` (false)
4. **Boolean Constants**: `#if TRUE`, `#if false` (case-insensitive)
5. **Comparison Operations**: `==`, `!=`, `>`, `>=`, `<`, `<=`
6. **defined() Function**: `#if defined(MACRO_NAME)`

## Complete Examples

### Feature Toggle System

**LSL:**

```lsl
#define ENABLE_SOUND 1
#define ENABLE_PARTICLES 0
#define DEBUG_MODE 1

default {
    state_entry() {
        llOwnerSay("Script starting...");

        #if ENABLE_SOUND
        llPlaySound("startup_sound", 0.5);
        #endif

        #if ENABLE_PARTICLES
        llParticleSystem([
            PSYS_SRC_PATTERN, PSYS_SRC_PATTERN_EXPLODE,
            PSYS_PART_START_COLOR, <1,1,1>,
            PSYS_PART_END_COLOR, <1,1,1>
        ]);
        #endif

        #ifdef DEBUG_MODE
        llOwnerSay("Debug: Initialization complete");
        #endif
    }

    touch_start(integer total_number) {
        #if DEBUG_MODE
        llOwnerSay("Debug: Touch detected by " + llDetectedName(0));
        #endif

        llOwnerSay("Hello, " + llDetectedName(0) + "!");
    }
}
```

### Modular Library System

**File Structure:**

```
project/
├── main.lsl
├── include/
│   ├── constants.lsl
│   └── common.lsl
├── libs/
│   ├── math/
│   │   └── geometry.lsl
│   └── ui/
│       └── dialogs.lsl
└── utils/
    └── helpers.lsl
```

**constants.lsl:**

```lsl
#define PI 3.14159265
#define MAX_OBJECTS 100
#define DEBUG_CHANNEL -12345
#define VERSION 2
```

**math/geometry.lsl:**

```lsl
#include <constants.lsl>

#define CIRCLE_AREA(r) (PI * (r) * (r))
#define SPHERE_VOLUME(r) (4.0 / 3.0 * PI * (r) * (r) * (r))

float circleArea(float radius) {
    return CIRCLE_AREA(radius);
}

float sphereVolume(float radius) {
    return SPHERE_VOLUME(radius);
}
```

**main.lsl:**

```lsl
#include <constants.lsl>
#include "../libs/math/geometry.lsl"

#define BUILD_TYPE "debug"

#if BUILD_TYPE == "debug"
#define DEBUG 1
#else
#define DEBUG 0
#endif

default {
    state_entry() {
        #if DEBUG
        llOwnerSay("Debug build - Version " + (string)VERSION);
        #endif

        float area = circleArea(5.0);
        llOwnerSay("Circle area: " + (string)area);

        float volume = sphereVolume(3.0);
        llOwnerSay("Sphere volume: " + (string)volume);
    }
}
```



### Debug Logging System

**LSL:**

```lsl
#define DEBUG_ENABLED TRUE
#define LOG_LEVEL_ERROR 0
#define LOG_LEVEL_WARN 1
#define LOG_LEVEL_INFO 2
#define LOG_LEVEL_DEBUG 3
#define CURRENT_LOG_LEVEL LOG_LEVEL_DEBUG

#define LOG_ERROR(msg) if (DEBUG_ENABLED && CURRENT_LOG_LEVEL >= LOG_LEVEL_ERROR) llOwnerSay("[ERROR] " + (msg))
#define LOG_WARN(msg) if (DEBUG_ENABLED && CURRENT_LOG_LEVEL >= LOG_LEVEL_WARN) llOwnerSay("[WARN] " + (msg))
#define LOG_INFO(msg) if (DEBUG_ENABLED && CURRENT_LOG_LEVEL >= LOG_LEVEL_INFO) llOwnerSay("[INFO] " + (msg))
#define LOG_DEBUG(msg) if (DEBUG_ENABLED && CURRENT_LOG_LEVEL >= LOG_LEVEL_DEBUG) llOwnerSay("[DEBUG] " + (msg))

default {
    state_entry() {
        LOG_INFO("Script started");

        integer value = 42;
        LOG_DEBUG("Processing value: " + (string)value);

        if (value < 0) {
            LOG_ERROR("Invalid negative value: " + (string)value);
        }

        LOG_INFO("Script initialization complete");
    }
}
```

### Advanced Debugging with Stringization

**LSL:**

```lsl
#define DEBUG 1
#define STRINGIFY(x) #x
#define DEBUG_VAR(var) if (DEBUG) llOwnerSay("DEBUG: " + #var + " = " + (string)(var))
#define ASSERT(condition) if (!(condition)) llOwnerSay("ASSERTION FAILED: " + #condition + " at line " + (string)__LINE__)
#define TRACE_FUNC(name, args) if (DEBUG) llOwnerSay("TRACE: Calling " + #name + "(" + #args + ")")

// Function that demonstrates stringization
calculate_distance(vector pos1, vector pos2) {
    TRACE_FUNC(calculate_distance, pos1 + ", " + pos2);

    float distance = llVecDist(pos1, pos2);
    DEBUG_VAR(distance);

    ASSERT(distance >= 0.0);

    return distance;
}

default {
    state_entry() {
        vector start = <0, 0, 0>;
        vector end = <10, 5, 3>;

        DEBUG_VAR(start);
        DEBUG_VAR(end);

        float result = calculate_distance(start, end);

        llOwnerSay("Final result: " + STRINGIFY(distance_calculation) + " = " + (string)result);
    }
}
```



## Best Practices

### 1. File Organization

- Keep related functionality in separate files
- Use meaningful file and directory names
- Group similar files in subdirectories
- Place common constants and utilities in an `include/` directory

### 2. Macro Design

- **Use Parentheses Liberally**: Always wrap macro parameters and entire macro body in parentheses

  ```lsl
  // ✅ Good
  #define SQUARE(x) ((x) * (x))
  // ❌ Bad
  #define SQUARE(x) x * x
  ```

- **Use Descriptive Names**: Choose clear, descriptive names for macros

  ```lsl
  // ✅ Good
  #define METERS_TO_FEET(m) ((m) * 3.28084)
  // ❌ Bad
  #define M2F(m) ((m) * 3.28084)
  ```

- **Group Related Defines**: Organize related defines together

  ```lsl
  // Physics constants
  #define GRAVITY 9.81
  #define SPEED_OF_LIGHT 299792458.0
  #define PI 3.14159265359

  // Conversion macros
  #define DEGREES_TO_RADIANS(deg) ((deg) * PI / 180.0)
  #define RADIANS_TO_DEGREES(rad) ((rad) * 180.0 / PI)
  ```

- **Use Stringization for Debugging**: The `#` operator is excellent for creating self-documenting debug messages

  ```lsl
  // ✅ Good - Self-documenting
  #define DEBUG_VAR(var) llOwnerSay("DEBUG: " + #var + " = " + (string)(var))
  #define ASSERT(cond) if (!(cond)) llOwnerSay("ASSERTION FAILED: " + #cond)

  // ❌ Bad - Manual string maintenance
  #define DEBUG_VAR(var) llOwnerSay("DEBUG: var = " + (string)(var))  // Doesn't show actual variable name
  ```

- **Combine Stringization with Normal Substitution**: Mix `#param` and `param` for flexible macros

  ```lsl
  // ✅ Good - Shows both the expression and its value
  #define LOG_EXPR(expr) llOwnerSay("Expression " + #expr + " = " + (string)(expr))

  // Usage: LOG_EXPR(x + y * 2)
  // Output: "Expression x + y * 2 = 42"
  ```

- **Keep Stringized Output Readable**: Ensure stringized expressions remain meaningful

  ```lsl
  // ✅ Good - Clear, readable output
  #define TRACE_CALL(func, args) llOwnerSay("Calling " + #func + " with " + #args)

  // ❌ Avoid - Overly complex expressions that become unreadable when stringized
  #define BAD_TRACE(x) llOwnerSay(#x)  // If x is a complex nested expression, output may be confusing
  ```

### 3. Line Continuation Usage

- **Use Explicit Continuation for Complex Macros**: Use backslash (`\`) for very long macro definitions

  ```lsl
  #define COMPLEX_FORMULA(x, y, z) ((x) * (y) + \
                               (y) * (z) + \
                               (z) * (x))
  ```

- **Rely on Automatic Continuation for Function Calls**: Multi-line function calls work automatically

  ```lua
  LOG_INFO("Complex message: " ..
           variable_name ..
           " with additional data")
  ```

- **Format for Readability**: Use consistent indentation for continued lines

  ```lsl
  some_function(first_parameter,
                second_parameter,
                third_parameter);
  ```

- **Mind the Boundaries**: Ensure continuation doesn't accidentally combine separate statements
  ```lua
  -- Good: Proper separation
  result = calculate_value(param1,
                          param2)
  local next_var = 42  -- This remains separate
  ```

### 4. Include Strategy

#### For LSL (`#include`)

- Include only what you need to minimize processing time
- Use relative paths for project-specific files
- Use angle brackets `<>` for system/library files
- Use quotes for files with spaces or special characters
- Rely on include guards to prevent duplicate definitions

**Example:**
```lsl
#include "constants.lsl"      // Project constants
#include <math_library.lsl>   // Shared library
#include "utils/helpers.lsl"  // Utility functions
```

#### For SLua (`require()`)

- Use `require()` when you need multiple independent instances of a module
- Be mindful that the same module can be required multiple times
- Keep module dependencies shallow to avoid hitting depth limits
- Use clear module naming to make dependencies obvious

**Example:**
```luau
-- Multiple instances are allowed and independent
local logger1 = require("logger.luau")  -- First instance
local logger2 = require("logger.luau")  -- Second instance (separate)

-- Nested dependencies
local main = require("modules/main.luau")  -- May require other modules internally
```

#### Choosing Between Include and Require

**Use `#include` (LSL) when you want:**
- Single, shared definitions across entire script
- Traditional header file pattern
- Automatic duplicate prevention
- Constants and global state

**Use `require()` (SLua) when you want:**
- Multiple independent module instances
- Flexible, dynamic module loading
- Lua-style module patterns
- Each require to execute module initialization

### 5. Depth Limit Management

- **Default limit (5)** is sufficient for most projects
- **Increase limit** only if you have legitimately deep module hierarchies
- **Refactor** if you frequently hit depth limits - this may indicate overly complex dependencies
- **Use flat imports** where possible instead of deep nesting

**Configure depth limit in VS Code settings:**
```json
{
  "slVscodeEdit.preprocessor.maxIncludeDepth": 5
}
```

### 6. Conditional Compilation

- Use descriptive macro names for feature flags
- Group related configurations together
- Use comments to explain complex conditions
- Maintain consistent indentation in nested conditionals

### 7. Documentation

- Document complex macros and their behavior
- Include usage examples for function-like macros
- Explain the purpose of conditional compilation blocks
- Maintain a clear project structure documentation

## Limitations

### 1. General Limitations

- **No Recursive Expansion Prevention**: Recursive macros will cause issues
- **String Literal Protection**: Macros inside string literals are not expanded
- **Workspace-Only Access**: Only files within current workspace are accessible
- **Line Continuation Boundaries**: Automatic continuation stops at statement boundaries (keywords like `local`, `function`, etc.)

### 2. Macro Limitations

- Parameter names must be valid identifiers
- Should avoid LSL/Lua keywords as parameter names
- Complex expressions may require careful parenthesization

### 3. Include/Require Limitations

#### Common to Both

- Maximum nesting depth (default: 5, configurable up to 50)
- Very deep hierarchies may impact processing performance
- Binary files cannot be included/required
- File encoding must be compatible with VS Code
- Absolute paths are not supported

#### `#include` Specific (LSL)

- Uses configured include paths for file resolution (e.g., `include/`, `**/include/`, `.`)
- Supports relative paths, quoted paths, and angle bracket syntax
- Include guards automatically prevent multiple inclusions
- Circular includes are prevented by both guards and depth limiting
- Once a file is included, subsequent includes of the same file are skipped

#### `require()` Specific (SLua)

- **Paths are always relative** to the file containing the `require()` statement
- Does not use the configured include paths search (unlike `#include`)
- Path resolution: relative to current file's directory only
- **No include guards** - same file can be required multiple times
- Circular requires are only prevented by depth limiting
- Each `require()` creates a new wrapped instance: `(function()...end)()`
- More overhead than `#include` due to function wrapping
- Be cautious with circular dependencies - they consume depth budget quickly

### 4. Conditional Processing

- Limited expression evaluation (no complex arithmetic)
- Boolean evaluation follows C-style rules (0 = false, non-zero = true)
- No support for complex logical operators (&&, ||)

## Integration with VS Code Extension

When using the Second Life Script External Editor extension:

1. **Automatic Processing**: Defines, includes, and conditionals are processed when you save files
2. **Seamless Sync**: Processed scripts automatically sync back to Second Life
3. **Error Mapping**: Errors in processed scripts map back to original source locations
4. **IntelliSense Support**: Macro definitions provide autocomplete and hover information
5. **Go-to-Definition**: Navigate from macro usage to definition across included files

This preprocessor system enables you to write clean, maintainable, and modular Second Life scripts while working seamlessly with the Second Life scripting environment and VS Code development tools.
