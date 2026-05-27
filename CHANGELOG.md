# Changelog

All notable changes to the Second Life External Scripting Extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.4] - 2026-05-27

## What's Changed
* Reduce config switches for meta output by @WolfGangS in https://github.com/secondlife/sl-vscode-plugin/pull/50
* Linux-specific instructions by @tapple in https://github.com/secondlife/sl-vscode-plugin/pull/52
* Add the option to treat the viewer file as master by @tapple in https://github.com/secondlife/sl-vscode-plugin/pull/55
* Spelling corrections by @FelixWolf in https://github.com/secondlife/sl-vscode-plugin/pull/53
* Fix default config, and support for custom port by @WolfGangS in https://github.com/secondlife/sl-vscode-plugin/pull/51
* Luau type fixes for luau-lsp by @tapple in https://github.com/secondlife/sl-vscode-plugin/pull/57
* Always try to match a master file by `@file` meta by @tapple in https://github.com/secondlife/sl-vscode-plugin/pull/61
* Disable-auto-language-update by @tapple in https://github.com/secondlife/sl-vscode-plugin/pull/62
* Switch support for lsl preproc by @WolfGangS in https://github.com/secondlife/sl-vscode-plugin/pull/59

## New Contributors
* @tapple made their first contribution in https://github.com/secondlife/sl-vscode-plugin/pull/52
* @FelixWolf made their first contribution in https://github.com/secondlife/sl-vscode-plugin/pull/53

**Full Changelog**: https://github.com/secondlife/sl-vscode-plugin/compare/v1.0.3...v1.0.4


## [1.0.0] - 2025-11-18

### Added

- Include system with `#include` directives for LSL files
- SLua `require()` syntax support for modular Lua scripting with nested require processing
- Macro processing with `#define` support for constants and function-like macros
- Conditional compilation with `#ifdef`, `#ifndef`, `#if`, `#elif`, `#else`, `#endif` directives
- `defined()` operator support in conditional expressions
- Automatic include guards and circular dependency protection
- Configurable include search paths with wildcard pattern support
- Configurable maximum include/require depth limit (default: 5, range: 1-50)
- WebSocket connection to Second Life viewer for live script synchronization
- External script editing capabilities with real-time updates
- Automatic download and updating of Second Life language definitions
- Real-time compilation error display from Second Life viewer
- Debug message monitoring from `llOwnerSay()` and debug channel chat
- Full LSL (Linden Scripting Language) preprocessing capabilities
- SLua (Second Life Lua) module system with nested require support
- Automatic language detection based on file extensions (`.lsl`, `.luau`)
- Workspace-restricted file operations for security
- Lexing-based preprocessor with proper comment and string handling
- Comprehensive test suite with 377 tests
- Commands for WebSocket connection management and language updates

### Initial Release Features

This is the initial public release of the Second Life External Scripting Extension, providing comprehensive preprocessing and external editing capabilities for Second Life script development in Visual Studio Code.
