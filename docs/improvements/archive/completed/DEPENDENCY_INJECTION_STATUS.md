# Dependency Injection Status

## Overview

The codebase has good dependency injection support, but adoption in tests is very low.

## Current Status

### ✅ DI Support Available
- **29 modules** support timer injection
- All command handlers support `context` parameter
- Most services support constructor options
- Many utilities have configurable timers

### ❌ Low Test Adoption
- Only **3 out of 205** test files use DI
- Most tests import real modules directly
- Leading to open handles and slow tests

## Quick Stats

| Module Type | DI Support | Test Usage |
|-------------|------------|------------|
| Commands | 100% (context param) | 2/18 (11%) |
| Services | 80% (constructor) | 0/15 (0%) |
| Utilities | 60% (configure) | 1/30 (3%) |
| Overall | 29/50+ modules | 3/205 tests |

## Key Problems

1. **Open Handles**: Tests leave 20+ timers running
2. **Slow Tests**: Real delays instead of fake timers
3. **Flaky Tests**: Timing-dependent behavior
4. **Hard to Test**: Can't control time flow

## Recent Progress

- Fixed `add.test.js` to use proper scheduler injection
- Created comprehensive documentation
- Identified all modules needing fixes

## Next Steps

1. **High Priority**: Fix remaining command tests
   - They already have DI support
   - Just need `mockContext` with proper scheduler

2. **Medium Priority**: Update service tests
   - Pass timer options to constructors
   - Use fake timers throughout

3. **Low Priority**: Update utility tests
   - Use configure methods where available
   - Mock modules that don't support DI

## Migration Path

See [DEPENDENCY_INJECTION_GUIDE.md](../testing/DEPENDENCY_INJECTION_GUIDE.md) for detailed instructions.

## Goal

- 100% of timer-using tests should use DI
- 0 open handles in test suite
- < 30 second total test runtime