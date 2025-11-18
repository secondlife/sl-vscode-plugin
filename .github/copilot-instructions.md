# Second Life External Scripting Extension - AI Assistant Guide

This VS Code extension provides preprocessing and external editing capabilities for Second Life's LSL (Linden Scripting Language) and SLua (Second Life Lua) scripts.

## Architecture Overview

### Core Service Pattern

The extension uses a **singleton service architecture** with three main services:

- `ConfigService` - Configuration management and settings
- `LanguageService` - Script preprocessing, mapping, and language features
- `SynchService` - WebSocket communication with Second Life viewer

All services follow the pattern: `Service.getInstance(context?)` and implement `vscode.Disposable`.

### Service Dependencies

```
SynchService → LanguageService → Preprocessor
               ↘
                ViewerEditWSClient
```

## Key Components

### Lexing-Based Preprocessor (2025-10 Addition)

**Location**: `src/shared/lexingpreprocessor.ts`

A new token-based preprocessor implementation is being developed alongside the existing regex-based preprocessor (`preprocessservice.ts`). This represents a modern, more accurate approach to preprocessing.

**Architecture**:
- **Lexer**: Tokenizes source code character-by-character with proper context awareness
- **Parser**: Processes token stream and handles directives
- **LexingPreprocessor**: High-level interface coordinating lexer and parser

**Key Design Principle - Language Agnostic**:

The lexer uses a **configuration-based approach** instead of hardcoded language checks:

```typescript
interface LanguageLexerConfig {
    lineCommentPrefix: string;        // e.g., "//" or "--" or "#"
    blockCommentStart: string | null; // e.g., "/*" or "--[[" or null
    blockCommentEnd: string | null;   // e.g., "*/" or "]]" or null
    directivePrefix: string;          // e.g., "#" or "--#" or "@"
    directiveKeywords: string[];      // e.g., ["include", "define", "ifdef"]
}
```

**Usage**:
```typescript
// Predefined language
const lexer = new Lexer(source, "lsl");  // or "luau"

// Custom language configuration
const customConfig: LanguageLexerConfig = {
    lineCommentPrefix: "#",
    blockCommentStart: null,
    blockCommentEnd: null,
    directivePrefix: "@",
    directiveKeywords: ["import", "define"],
};
const lexer = new Lexer(source, customConfig);
```

**Design Benefits**:
- ✅ No `if (language === "lsl")` conditionals in lexer code
- ✅ Easy to add support for new languages
- ✅ Users can define custom preprocessor syntax
- ✅ Cleaner, more testable code

**Documentation**:
- `doc/lexing-preprocessor.md` - Architecture overview
- `doc/lexing-preprocessor-language-config.md` - Configuration guide with examples
- `doc/lexing-preprocessor-quickstart.md` - Developer guide
- `doc/lexing-preprocessor-diagrams.md` - Visual architecture

**Current Status**: Tokenization complete with proper comment handling. Macro processor (`MacroProcessor`) and conditional processor (`ConditionalProcessor`) classes implemented.

**Testing**: `src/test/suite/lexingpreprocessor.test.ts` - 18 tests covering tokenization, comment handling, and custom configurations.

### Conditional Processor (2025-10 Addition)

**Location**: `src/shared/conditionalprocessor.ts`

A dedicated class for managing conditional compilation state in the lexing preprocessor. Replaces the simple array-based approach with a robust, stack-based processor.

**Architecture**:
- **ConditionalBlock**: State tracking for each `#if`/`#ifdef`/`#ifndef` block
- **Stack-based**: Maintains nested conditional blocks with proper parent/child relationships
- **Language-aware**: Constructed with `ScriptLanguage` parameter for future language-specific behavior

**Key Design Pattern - Encapsulation**:

Similar to `MacroProcessor`, the conditional processor encapsulates all state management:

```typescript
class ConditionalProcessor {
    // State queries
    isActive(): boolean              // Should code be included?
    getDepth(): number              // Current nesting depth
    hasUnclosedBlocks(): boolean    // Unmatched directives?

    // Directive processors
    processIfdef(macroName, macros, line): ConditionalResult
    processIfndef(macroName, macros, line): ConditionalResult
    processIf(tokens, macros, line): ConditionalResult
    processElif(tokens, macros, line): ConditionalResult
    processElse(line): ConditionalResult
    processEndif(line): ConditionalResult
}
```

**Conditional Logic**:
- Code is included only when **all** nested blocks are active
- In `#if`/`#elif`/`#else` chains, only the **first** satisfied branch is taken
- Parent block state determines whether children can be active
- Tracks whether any branch in a chain has been taken to prevent multiple activations

**Error Handling**:
All processors return `ConditionalResult` with:
- `success`: Whether directive was valid
- `shouldInclude`: Whether code should be included after this directive
- `message`: Error/warning text if applicable

**Integration**:
- `ParserState` uses `conditionals: ConditionalProcessor` instead of simple object
- Parser directive handlers delegate to processor methods
- Token emission checks `conditionals.isActive()` before output

**Documentation**: `doc/conditional-processor-implementation.md` - Full implementation guide with examples

**TODO**: Full expression evaluator for `#if` conditions (currently simplified to handle basic cases)

**Testing**: Unit tests needed for nesting, branch chains, error cases, and expression evaluation.

### Script Preprocessing (`src/llpreprocessservice.ts`)

The preprocessor is the extension's core feature, handling:

- **Include directives**: `#include "file.lsl"` (LSL) syntax
- **SLua require syntax**: `require("filename.luau")` treated as inline include with function wrapping
- **Nested requires**: Recursively processes `require()` statements in included files (up to 10 levels deep)
- **Macro definitions**: `#define` with function-like macro support (LSL only)
- **Conditional compilation**: `#ifdef`, `#ifndef`, `#if`, `#elif`, `#else`, `#endif`

**Critical**: Always check `slVscodeEdit.preprocessor.enable` config before preprocessing.

#### SLua Require Processing (2025-10 Update)

The `processInlineRequires()` method handles `require("file.luau")` syntax by:
1. Recursively processing nested requires (depth limit: configurable via `maxIncludeDepth`, default 5)
2. Wrapping each module in `(function() ... end)()` IIFE
3. Adding line directives for source tracking
4. **Allowing multiple inclusions**: Unlike `#include`, `require()` does NOT use include guards - the same module can be required multiple times
5. Skipping requires in comments (using line-aware comment detection)

**Key Behavioral Difference**:
- `require()` (SLua): Allows multiple inclusions of the same file, protected from infinite recursion only by depth limiting
- `#include` (LSL): Uses include guards to prevent duplicate inclusions, ensuring each file is processed only once

The maximum include/require depth is controlled by the `slVscodeEdit.preprocessor.maxIncludeDepth` configuration (default: 5, range: 1-50). This same limit applies to both LSL `#include` directives and SLua `require()` statements.

See `doc/nested-require-implementation.md` for detailed algorithm and examples.

### WebSocket Integration (`src/llviewereditwsclient.ts`)

Connects to Second Life viewer on configurable port (default 9020) for external script editing.

## Development Workflows

### Building and Testing

```bash
npm run compile      # Build TypeScript
npm run watch        # Watch mode (available as VS Code task)
npm run test         # Full test suite
npm run test-unit    # Unit tests only
```

### Test Structure

Tests run in specific order (see `src/test/suite/index.ts`):

1. `directive-parser.test.js` - Core directive parsing
2. `macro-processor.test.js` - Macro expansion
3. `conditional-processor.test.js` - Conditional compilation
4. `preprocessor.test.js` - Full preprocessing integration

## Project Conventions

### Language Detection

The extension determines script type by file extension:

- `.lsl` files → LSL language
- `.luau` files → SLua language
- Uses different comment markers: `//` (LSL) vs `--` (SLua)

### Configuration Structure

Settings use nested structure: `slVscodeEdit.{category}.{setting}`

- `slVscodeEdit.preprocessor.*` - Preprocessing options
- `slVscodeEdit.network.*` - WebSocket settings
- `slVscodeEdit.storage.*` - File storage preferences

## Integration Points

### External Dependencies

The extension depends on existing language servers:

- `Kampfkarren.selene-vscode` - SLua/Luau language support
- `johnnymorganz.luau-lsp` - Additional Luau features

### Non-VSCode Host (NodeHost) (2025-09)

A standalone Node runtime implementation of `HostInterface` now exists at `src/server/nodehost.ts`. It enables running the preprocessor and related core logic in a future language server process without VS Code APIs.

Capabilities:
* File I/O (read/write text, JSON, YAML, TOML) using native fs + `js-yaml` + `@iarna/toml`.
* Include resolution logic ported from the VS Code host: supports relative paths, explicit `.` / `./subdir`, workspace-root relative paths, and wildcard directory patterns (e.g. `**/include/`). Uses `glob` for wildcard matching.
* Path normalization with `NormalizedPath` branding preserved.
* Workspace roots provided at construction (`new NodeHost({ roots, config })`).
* Minimal logger injection (optional) with no-op defaults.
* Config access fully delegated to injected `FullConfigInterface` implementation—no direct env or global lookups inside NodeHost.

Testing: `src/test/suite/nodehost.test.ts` covers read/write, JSON/YAML/TOML, and include resolution (including wildcard). Paths are compared case-insensitively on Windows where needed.

Usage Pattern (future LSP bootstrap sketch):
```ts
import { NodeHost } from '../server/nodehost';
import { SomeConfigImpl } from '../server/config'; // hypothetical
const config = new SomeConfigImpl(workspaceRoots);
const host = new NodeHost({ roots: workspaceRoots, config, logger });
// pass host into preprocessor / language services
```

Guidelines:
1. Do not introduce VS Code imports into `src/server/`.
2. Keep feature parity between extension host and NodeHost include resolution.
3. Add new serialization helpers via optional methods (feature-detect in callers) rather than expanding core method contracts.
4. Always return `NormalizedPath` for resolved files.

Future Extensions:
* Optional file watching (likely via `fs.watch` or chokidar) for cache invalidation.
* Pluggable logger upgrade to structured logging with levels forwarded to LSP connection.
* Security hardening for include path traversal (Todo 36) – add explicit root boundary enforcement (partially present) and denial list.

### Data Files

- `data/sl-lua-defs.json` - Lua type definitions for Second Life API
- `data/sl-lua-defs.schema.json` - JSON schema for type definitions
- `data/luatypes.llsd` - LLSD format type data

## Common Patterns

### Error Handling

Most services use optional chaining and the `maybe()` utility for safe property access.

### File Path Handling

Always use workspace-relative paths for security. Include paths are configurable via `includePaths` setting with patterns like `["./include/", "include/", "*/include/", "."]`.

#### NormalizedPath Abstraction (2025-09 Update)

All internal path handling in the preprocessor layer now uses `NormalizedPath`, a branded string type produced by `normalizePath()` (see `llsharedutils`). This replaces previous reliance on `vscode.Uri` within core logic and tests.

Key guidelines:
- Do not store or compare raw/relative paths directly; always normalize first.
- Equality checks are simple strict equality (`===`) because normalization canonicalizes separators and casing rules (platform appropriate).
- Tests must no longer access `.fsPath` or other `Uri` properties—compare the `NormalizedPath` values directly.
- When constructing mappings (`LineMapping`), assign `sourceFile: NormalizedPath`.

#### HostInterface for Includes (formerly FileInterface)

`IncludeProcessor` now depends on an injected `HostInterface` (renamed from earlier `FileInterface` for broader future responsibilities) instead of directly using VS Code APIs. Implementations must provide:

```
readFile(path: NormalizedPath): Promise<string | null>
exists(path: NormalizedPath): Promise<boolean>
resolveFile(filename: string, from: NormalizedPath, extensions?: string[], includePaths?: string[]): Promise<NormalizedPath | null>
```

Test shims may implement minimal logic (e.g., in-memory maps). For realistic include resolution tests, provide a hybrid in-memory + disk implementation and pass it to `new IncludeProcessor(fsImpl)`.

##### Extended HostInterface Capabilities (2025-09 Updates)

Refactor consolidated configuration & path responsibilities into `FullConfigInterface` (exposed as `host.config`). HostInterface now focuses on file/serialization utilities plus optional discovery.

Core I/O (optional):
- `writeFile(path, content)`
- `readJSON(path)` / `writeJSON(path, data, pretty?)`
- `writeYAML(path, data)` / `writeTOML(path, data)` (if provided)

Workspace:
- `listWorkspaceFolders()` (optional for workspace-aware hosts)

Configuration (centralized):
- Removed: `updateConfiguration`, `getConfiguration`, `getConfigPath`, `getGlobalConfigPath`, `getExtensionInstallPath` from HostInterface.
- Use `host.config` methods instead: `getConfig`, `setConfig`, `getWorkspaceConfigPath`, `getGlobalConfigPath`, `getExtensionInstallPath`, `getSessionValue`, `setSessionValue`, `useLocalConfig`.

Discovery:
- `isExtensionAvailable(id)` (optional)

Design Notes (current):
1. All configuration must route through `host.config` (no free helpers, no host-level duplication).
2. Path-returning methods reside only on `FullConfigInterface` ensuring normalization.
3. Feature-detect optional capabilities: `if (host.writeJSON) { ... }`.
4. Test hosts may implement a minimal `config` with just required getters.
5. Extend `FullConfigInterface` for new settings rather than re-expanding HostInterface.

Deprecated/Removed (late Sept 2025): free helpers `getConfig` / `setConfig`.

#### IncludeProcessor API Change

`processInclude` signature:
```
processInclude(filename: string, sourceFile: NormalizedPath, isRequire: boolean, state: PreprocessorState)
```
Static helper methods like `pathToGlobPattern` and `getIncludeDirectories` have been removed; tests referring to them should be deleted or rewritten.

#### Require Wrapping

Inline Luau `require("file")` handling wraps included module content as:
```
(function()\n@line ...<line directive>\n<module content>\nend)()
```
Tests should assert wrapper starts with `(function()` and ends with `end)()` (allowing optional trailing whitespace) instead of JavaScript-style IIFE patterns.

### Script Synchronization

When connecting to viewer:

1. Establish WebSocket connection
2. Perform handshake with viewer capabilities
3. Subscribe to specific script editing sessions
4. Sync changes bidirectionally with preprocessing

### Testing Workspace

Use `src/test/workspace/` for test files - includes both LSL and Luau examples with include directories.

### Test Helpers (2025-09 Update)

To reduce duplication in line mapping assertions, use the helper utilities in `src/test/suite/helpers/expectMapping.ts`:

```
expectMapping(mapping, processedLine, originalLine, filePathNormalized);
expectMappings(arrayOfMappings, [ [processed, original, file], ... ]);
```

Adopt these helpers when adding or modifying mapping tests. They perform strict equality on `NormalizedPath` and provide clearer failure messaging.

## Maintaining These Instructions

**Important**: When you receive new coding style guidelines, patterns, or architectural decisions during development sessions, you should update this `copilot-instructions.md` file to reflect those changes. This ensures future AI assistance remains consistent with established project conventions and recent decisions.

Examples of updates to include:
- New naming conventions or patterns
- Architectural decisions about service interactions
- Code organization preferences
- Testing strategies or patterns
- Build process changes
- Documentation standards

### 2025-09 Late Refactor Summary

- Removed legacy global configuration helpers (`getConfig`, `setConfig`); explicit dependency injection via `host.config` only.
- HostInterface trimmed: configuration & path access consolidated under `FullConfigInterface` implementation (`LLConfigService`).
- Updated services and sync logic to use `LLConfigService.getInstance()` only at composition boundaries; core logic depends on abstracted `HostInterface` + `FullConfigInterface`.
- Ensured path branding (`NormalizedPath`) throughout preprocessing and language data flows.
- Guidance: New settings belong in `ConfigKey` + `LLConfigService`; avoid reintroducing host-level config APIs.

### 2025-10 Nested Require Processing (Oct 10)

**Problem**: The `require()` directive in SLua files was not processing nested requires. When a required module itself contained `require()` statements, those nested requires were ignored because the regex only operated on the original line content.

**Solution**: Refactored `processInlineRequires()` into a recursive implementation:
- Split into `processInlineRequires()` (entry point) and `processInlineRequiresRecursive()` (recursive helper)
- Added depth limiting (max 10 levels) to prevent infinite recursion in circular dependencies
- Process matches in reverse order to maintain correct string indices during replacement
- Improved comment detection using `lastIndexOf` with newline tracking
- Pass resolved path as context for nested requires so they resolve relative to their containing file

**Testing**: Added comprehensive test suite (`src/test/suite/nested-require.test.ts`) with 8 tests covering:
- Single and multi-level nesting
- Circular dependency protection
- Path resolution from subdirectories
- Comment handling
- Include guard behavior

**Documentation**: See `doc/nested-require-implementation.md` for detailed algorithm and transformation examples.

**Impact**: Enables proper module system for SLua with nested dependencies while maintaining backwards compatibility.

### 2025-10 Conditional Processor Implementation (Oct 30)

**Problem**: The lexing-based preprocessor had a simple array-based conditional state tracking that was tightly coupled to the parser. Needed a dedicated, encapsulated processor class similar to `MacroProcessor`.

**Solution**: Created `ConditionalProcessor` class with proper state management:
- Implemented stack-based tracking of nested conditional blocks
- Each block tracks parent/child relationships, branch states, and error context
- Clean API for directive processing with `ConditionalResult` return type
- Proper error detection for malformed directives (#elif without #if, etc.)
- Efficient `isActive()` method for determining code inclusion

**Architecture Changes**:
- New file: `src/shared/conditionalprocessor.ts`
- Updated `ParserState` interface to use `conditionals: ConditionalProcessor` instead of simple object
- Refactored all conditional directive handlers in `parser.ts` to delegate to processor
- Removed `enterConditionalBlock()`, `exitConditionalBlock()` helper methods from parser

**Key Features**:
- Language-aware construction (like `MacroProcessor`)
- Returns `ConditionalResult` with success/failure/message for all directives
- Tracks start line and directive type for better error reporting
- `getUnclosedBlocks()` for end-of-file validation
- `reset()` method for processing new files

**defined() Operator**:
- Added to LSL `directiveKeywords` in lexer configuration
- Lexer recognizes `defined` as `TokenType.DIRECTIVE` for LSL
- Processing implemented in `MacroProcessor.processDefined()` method
- Scans token stream for: `DIRECTIVE("defined")` + `PAREN_OPEN` + `IDENTIFIER` + `PAREN_CLOSE`
- Returns new token stream with `defined(MACRO)` replaced by `NUMBER_LITERAL("1")` or `NUMBER_LITERAL("0")`
- `ConditionalProcessor.evaluateCondition()` delegates to `macros.processDefined()` before expression evaluation

**Architectural Decision**: The `defined()` operator was initially implemented in `ConditionalProcessor` but was moved to `MacroProcessor` because:
- It's fundamentally a macro-related operation (checks if macro exists)
- Keeps macro-related logic consolidated in one place
- Better separation of concerns: ConditionalProcessor manages state, MacroProcessor handles macro operations

**Testing**: Complete test suite with 56 tests covering all directives, nesting, and defined() operator

**Documentation**: `doc/conditional-processor-implementation.md` - Complete implementation guide

**Next Steps**:
1. Implement full expression evaluator for `#if` conditions (currently simplified)
2. Add support for arithmetic, comparison, and logical operators
3. Integrate with include processor for conditionals around includes
