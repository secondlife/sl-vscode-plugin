# Changelog

All notable changes to the Second Life External Scripting Extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.6] - 2026-08-21

## What's Changed
* chore: prepare release v1.0.5 by @github-actions[bot] in https://github.com/secondlife/sl-vscode-plugin/pull/82
* Improve the VSCode plugin setup instructions by @tapple in https://github.com/secondlife/sl-vscode-plugin/pull/86
* Bump the npm_and_yarn group across 1 directory with 4 updates by @dependabot[bot] in https://github.com/secondlife/sl-vscode-plugin/pull/84
* Next plugin version by @Rider-Linden in https://github.com/secondlife/sl-vscode-plugin/pull/94
* Bump brace-expansion from 1.1.12 to 1.1.18 in the npm_and_yarn group across 1 directory by @dependabot[bot] in https://github.com/secondlife/sl-vscode-plugin/pull/87
* Update the Readme with another lsl Extension and refine wording a little by @WolfGangS in https://github.com/secondlife/sl-vscode-plugin/pull/104
* Make paths for luau-lsp config defintion files relative by @WolfGangS in https://github.com/secondlife/sl-vscode-plugin/pull/102
* Remove dependancy on autobuild and replace with js script by @WolfGangS in https://github.com/secondlife/sl-vscode-plugin/pull/101
* Allow notecards without extension in name to still link by @WolfGangS in https://github.com/secondlife/sl-vscode-plugin/pull/105
* Bump js-yaml from 4.3.0 to 4.3.1 in the npm_and_yarn group across 1 directory by @dependabot[bot] in https://github.com/secondlife/sl-vscode-plugin/pull/100
* Hide the sl explorer view if plugin is not enabled, and give it it's own icon by @WolfGangS in https://github.com/secondlife/sl-vscode-plugin/pull/103
* Fix #107 bug with duplicate extensions when renaming an inworld item by @WolfGangS in https://github.com/secondlife/sl-vscode-plugin/pull/108
* Fix #106 active syncs not switching to new names if script is renamed by @WolfGangS in https://github.com/secondlife/sl-vscode-plugin/pull/110
* Rider/runtime msging by @Rider-Linden in https://github.com/secondlife/sl-vscode-plugin/pull/112
* Issue #109: Initialize the language server with SL defs at startup. by @Rider-Linden in https://github.com/secondlife/sl-vscode-plugin/pull/114
* Start writing some actual documentation. by @Rider-Linden in https://github.com/secondlife/sl-vscode-plugin/pull/116


**Full Changelog**: https://github.com/secondlife/sl-vscode-plugin/compare/v1.0.5...v1.0.6


## [1.0.5] - 2026-07-29

## What's Changed
* chore: prepare release v1.0.4 by @github-actions[bot] in https://github.com/secondlife/sl-vscode-plugin/pull/74
* Update README.md with marketplace url by @WolfGangS in https://github.com/secondlife/sl-vscode-plugin/pull/76
* Prim publishing by @Rider-Linden in https://github.com/secondlife/sl-vscode-plugin/pull/69


**Full Changelog**: https://github.com/secondlife/sl-vscode-plugin/compare/v1.0.4...v1.0.5


## [1.0.4] - 2026-05-27

## What's Changed
* Fix for incorrect luau-lsp config use by @WolfGangS in https://github.com/secondlife/sl-vscode-plugin/pull/2
* Bump the npm_and_yarn group across 1 directory with 2 updates by @dependabot[bot] in https://github.com/secondlife/sl-vscode-plugin/pull/1
* Switch from class to extern syntax for luau-lsp defs and move DetecteEvent by @WolfGangS in https://github.com/secondlife/sl-vscode-plugin/pull/4
* Fix selene yaml gen and toml config by @WolfGangS in https://github.com/secondlife/sl-vscode-plugin/pull/5
* Fix for selene yaml self on `:` calls by @WolfGangS in https://github.com/secondlife/sl-vscode-plugin/pull/6
* Fix default data to have eventname for LLEvents:off by @WolfGangS in https://github.com/secondlife/sl-vscode-plugin/pull/7
* Make saves of included/required files trigger 'saves' on actively sync'd file by @WolfGangS in https://github.com/secondlife/sl-vscode-plugin/pull/12
* Fix precomp require generating invalid code for files with no trailing line ending by @WolfGangS in https://github.com/secondlife/sl-vscode-plugin/pull/10
* Add fallback lookup for matching file, if the default glob finds nothing by @WolfGangS in https://github.com/secondlife/sl-vscode-plugin/pull/9
* Add config to enable/disable the extension, and a command to do it quickly by @WolfGangS in https://github.com/secondlife/sl-vscode-plugin/pull/8
* Update Package Name Across Project to fix README Links and be Consistent with Repo Name by @GalaxyLittlepaws in https://github.com/secondlife/sl-vscode-plugin/pull/11
* Implement a check to prevent saving over a file with identicle content by @WolfGangS in https://github.com/secondlife/sl-vscode-plugin/pull/14
* Add __UNIXTIME__ macro for lsl by @WolfGangS in https://github.com/secondlife/sl-vscode-plugin/pull/15
* Add LLEvents:once do data for default generation by @WolfGangS in https://github.com/secondlife/sl-vscode-plugin/pull/18
* Add support to lexer for luau [[ style strings by @WolfGangS in https://github.com/secondlife/sl-vscode-plugin/pull/24
* Selene warnign about list type in ll funcs by @WolfGangS in https://github.com/secondlife/sl-vscode-plugin/pull/21
* Alter path in selene.toml to be relative by @WolfGangS in https://github.com/secondlife/sl-vscode-plugin/pull/26
* Add support to slua require for aliases and default init files by @WolfGangS in https://github.com/secondlife/sl-vscode-plugin/pull/29
* Add extra filemeta to the output and support using it to match files by @WolfGangS in https://github.com/secondlife/sl-vscode-plugin/pull/30
* LSL Preproc drop comments after defines by @WolfGangS in https://github.com/secondlife/sl-vscode-plugin/pull/35
* Add support to lsl preprocessing for <> style includes by @WolfGangS in https://github.com/secondlife/sl-vscode-plugin/pull/34
* Fix #define #undef and #include being executed inside false conditional blocks by @WolfGangS in https://github.com/secondlife/sl-vscode-plugin/pull/36
* Perform a dry run of the preprocessor when initializing a sync by @WolfGangS in https://github.com/secondlife/sl-vscode-plugin/pull/31
* Add slencode and sldecode functions for lljson by @mikelittman in https://github.com/secondlife/sl-vscode-plugin/pull/40
* Delay initial definition generation to opening of first luau file by @WolfGangS in https://github.com/secondlife/sl-vscode-plugin/pull/42
* Switch require to use new `dangerouslyexecuterequiredmodule` function by @WolfGangS in https://github.com/secondlife/sl-vscode-plugin/pull/45
* Add support for alternative LLEvents event subscription style by @WolfGangS in https://github.com/secondlife/sl-vscode-plugin/pull/41
* Add support for preproc style macro's as system constants by @WolfGangS in https://github.com/secondlife/sl-vscode-plugin/pull/46
* Fix non relative paths in @line and @module comments by @WolfGangS in https://github.com/secondlife/sl-vscode-plugin/pull/47
* Fix casing of learn more links in luau-lsp docs by @WolfGangS in https://github.com/secondlife/sl-vscode-plugin/pull/48
* Reduce config switches for meta output by @WolfGangS in https://github.com/secondlife/sl-vscode-plugin/pull/50
* Linux-specific instructions by @tapple in https://github.com/secondlife/sl-vscode-plugin/pull/52
* Add the option to treat the viewer file as master by @tapple in https://github.com/secondlife/sl-vscode-plugin/pull/55
* Spelling corrections by @FelixWolf in https://github.com/secondlife/sl-vscode-plugin/pull/53
* Fix default config, and support for custom port by @WolfGangS in https://github.com/secondlife/sl-vscode-plugin/pull/51
* Luau type fixes for luau-lsp by @tapple in https://github.com/secondlife/sl-vscode-plugin/pull/57
* Always try to match a master file by `@file` meta by @tapple in https://github.com/secondlife/sl-vscode-plugin/pull/61
* Disable-auto-language-update by @tapple in https://github.com/secondlife/sl-vscode-plugin/pull/62
* Switch support for lsl preproc by @WolfGangS in https://github.com/secondlife/sl-vscode-plugin/pull/59
* Notecard link and `@file` meta linking improvements by @WolfGangS in https://github.com/secondlife/sl-vscode-plugin/pull/64
* Change how file sync's are ended, and add icons to indicate files that are synced by @WolfGangS in https://github.com/secondlife/sl-vscode-plugin/pull/65
* Retrieve pregenerated tool config files from cache on viewer.  by @Rider-Linden in https://github.com/secondlife/sl-vscode-plugin/pull/66
* Rider test by @Rider-Linden in https://github.com/secondlife/sl-vscode-plugin/pull/73

## New Contributors
* @WolfGangS made their first contribution in https://github.com/secondlife/sl-vscode-plugin/pull/2
* @dependabot[bot] made their first contribution in https://github.com/secondlife/sl-vscode-plugin/pull/1
* @GalaxyLittlepaws made their first contribution in https://github.com/secondlife/sl-vscode-plugin/pull/11
* @mikelittman made their first contribution in https://github.com/secondlife/sl-vscode-plugin/pull/40
* @tapple made their first contribution in https://github.com/secondlife/sl-vscode-plugin/pull/52
* @FelixWolf made their first contribution in https://github.com/secondlife/sl-vscode-plugin/pull/53
* @Rider-Linden made their first contribution in https://github.com/secondlife/sl-vscode-plugin/pull/66

**Full Changelog**: https://github.com/secondlife/sl-vscode-plugin/commits/v1.0.4


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
