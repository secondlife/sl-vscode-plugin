# Testing Guide

This project includes a comprehensive unit testing framework using Mocha and VS Code's testing infrastructure.

## Test Structure

### Core Test Files (Execution Order)

- `src/test/suite/directive-parser.test.ts` - DirectiveParser comprehensive tests (28 tests)
- `src/test/suite/macro-processor.test.ts` - MacroProcessor comprehensive tests (50+ tests)
- `src/test/suite/conditional-processor.test.ts` - ConditionalProcessor comprehensive tests (40+ tests)
- `src/test/suite/preprocessor.test.ts` - LLPreprocessor integration tests (20+ tests)
- `src/test/suite/basic.test.ts` - Basic unit tests (8 tests)
- `src/test/suite/extension.test.ts` - VS Code extension integration tests

### Infrastructure Files

- `src/test/suite/index.ts` - Test discovery and runner with controlled execution order
- `src/test/runTest.ts` - VS Code integration test runner

## Running Tests

### Full Integration Tests

```bash
npm test
```

Runs all tests in VS Code environment with proper execution order:

1. **DirectiveParser** - Tests preprocessor directive parsing for LSL and SLua require() syntax
2. **MacroProcessor** - Tests macro definition, substitution, and complex scenarios
3. **ConditionalProcessor** - Tests conditional compilation (#if, #ifdef, #elif, #else, #endif)
4. **LLPreprocessor** - Tests complete preprocessing pipeline
5. **Extension Tests** - Tests VS Code extension integration
6. **Basic Tests** - Tests fundamental operations

### Basic Tests (Fallback)

```bash
npm run test-basic
```

Runs only basic unit tests without VS Code environment requirements.

## Test Results

The comprehensive test suite includes:

- ✅ **130+ passing tests** across all processors
- ⚡ Average execution time: ~400ms
- 🧪 **Full coverage** of preprocessor functionality:
  - DirectiveParser: 28 tests
  - MacroProcessor: 50+ tests
  - ConditionalProcessor: 40+ tests
  - Integration tests: 20+ tests

## Test Categories

### DirectiveParser Tests

- LSL directive parsing (`#include`, `#define`, `#if`, etc.)
- Parameter parsing (quoted filenames, function macros, etc.)
- SLua require() syntax support
- Edge cases and error handling

### MacroProcessor Tests

- Simple macro definition and substitution
- Function-like macro handling
- Nested macro expansion
- String/comment boundary detection
- Language-specific comment handling
- Complex macro scenarios

### ConditionalProcessor Tests

- `#if` with numeric and expression conditions
- `#ifdef`/`#ifndef` macro existence checks
- `#elif` chain processing
- `#else` branch handling
- `#endif` stack management
- Nested conditional structures
- Expression evaluation with operators
- `defined()` operator support
- Error handling and recovery

### Integration Tests

- Complete preprocessing pipeline
- File inclusion processing
- Multi-directive scenarios
- Language detection and processing
- Error reporting and warnings

## Test Execution Order

Tests are executed in dependency order to ensure proper validation:

1. **DirectiveParser** → Tests low-level parsing before processors use it
2. **MacroProcessor** → Tests macro system before conditional evaluation
3. **ConditionalProcessor** → Tests conditional logic before full preprocessing
4. **LLPreprocessor** → Tests complete integration of all components

## Adding New Tests

Add new test files to `src/test/suite/` directory following the naming pattern:

- `component-name.test.ts` for specific component tests
- Use descriptive suite names and test descriptions

```typescript
import * as assert from "assert";
import { YourComponent } from "../../llpreprocessservice";

// Import Mocha globals
declare const suite: any;
declare const test: any;

suite("YourComponent Test Suite", () => {
  test("Should perform expected behavior", () => {
    // Test implementation
    assert.strictEqual(actual, expected);
  });
});
```

The test discovery system will automatically find and run new tests in the proper order based on filename patterns.
