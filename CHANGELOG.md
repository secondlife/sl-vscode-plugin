# Changelog

All notable changes to the Second Life External Scripting Extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
