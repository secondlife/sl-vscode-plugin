# Changelog

All notable changes to the Second Life External Scripting Extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2025-10-24

### Added

- **Script Preprocessing System**
  - Include system with `#include` directives for LSL files
  - SLua `require()` syntax support for modular Lua scripting
  - Macro processing with `#define` support for constants and function-like macros
  - Conditional compilation with `#ifdef`, `#ifndef`, `#if`, `#elif`, `#else`, `#endif`
  - Automatic include guards and circular dependency protection
  - Configurable include search paths

- **Real-Time Viewer Integration**
  - WebSocket connection to Second Life viewer
  - Live script synchronization between VS Code and viewer
  - External script editing capabilities

- **Development Tools**
  - Automatic download and updating of Second Life language definitions
  - Real-time compilation error display from Second Life viewer
  - Debug message monitoring from `llOwnerSay()` and debug channel chat
  - In-world debugging support

- **Cross-Language Support**
  - Full LSL (Linden Scripting Language) preprocessing capabilities
  - SLua (Second Life Lua) module system with nested require support
  - Automatic language detection based on file extensions

- **Security & Performance**
  - Workspace-restricted file operations for security
  - Robust error handling and graceful degradation

### Initial Release Features

This is the initial public release of the Second Life External Scripting Extension, providing comprehensive preprocessing and external editing capabilities for Second Life script development in Visual Studio Code.
