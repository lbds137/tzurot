# Open Handles Issue in Test Suite

## Problem Description

As of the CI/CD setup merge, Jest is detecting 2 open handles that are preventing clean test exits. While the tests pass successfully, these open handles indicate timers that aren't being properly cleaned up.

## Current Status
- **Test Results**: All 2206 tests pass across 143 test suites
- **Execution Time**: ~46 seconds
- **Impact**: Tests complete but Jest warns about potential memory leaks

## Open Handles Details

Both open handles originate from the same pattern:

```
●  Timeout
    54 |   
    55 |   // For shorter delays, use real setTimeout
  > 56 |   return originalSetTimeout(callback, delay, ...args);
       |                            ^
    57 | });
    58 |
    59 | // Use real clear functions but make them safe for mocked timers
```

### Affected Test Files
1. `tests/unit/webhookManager.exports.test.js:225:24`
2. `tests/unit/webhookManager.test.js:241:24`

### Call Stack
```
tests/setup.js:56:28 (originalSetTimeout)
  → tests/setup.js:95:40 (apply wrapper)
    → src/webhook/messageThrottler.js:31:55 (injectable timer)
      → src/webhook/messageThrottler.js:31:13 (setTimeout call)
        → src/webhook/messageThrottler.js:98:36 (registerPendingMessage)
          → test file (registerPendingMessage call)
```

## Root Cause Analysis

The issue stems from the interaction between:
1. **Global test setup** (`tests/setup.js`) that wraps setTimeout
2. **Injectable timers** in `messageThrottler.js`
3. **Pending message registration** that creates timeouts

The `registerPendingMessage` function in `messageThrottler.js` creates a timeout that isn't being cleared in tests, likely because:
- The timeout is created with the real setTimeout (not Jest's fake timers)
- The test cleanup doesn't account for these specific timeouts
- The pending message system expects the timeout to either fire or be explicitly cleared

## Temporary Workaround

Currently, the tests include `jest.clearAllTimers()` in the affected test files' `afterEach` blocks, but this doesn't catch timers created with the real setTimeout through our injectable pattern.

## Proposed Solutions

### Option 1: Enhanced Test Cleanup (Recommended)
Track all timeouts created during tests and clear them explicitly:

```javascript
// In affected tests
let activeTimeouts = [];

beforeEach(() => {
  const originalRegister = webhookManager.registerPendingMessage;
  webhookManager.registerPendingMessage = (...args) => {
    const result = originalRegister.apply(webhookManager, args);
    // Track the timeout if one was created
    activeTimeouts.push(/* timeout id */);
    return result;
  };
});

afterEach(() => {
  activeTimeouts.forEach(id => clearTimeout(id));
  activeTimeouts = [];
});
```

### Option 2: Mock messageThrottler in Tests
Mock the entire messageThrottler module to avoid real timeouts:

```javascript
jest.mock('../../src/webhook/messageThrottler', () => ({
  registerPendingMessage: jest.fn(),
  hasThrottledMessage: jest.fn().mockReturnValue(false),
  clearThrottledMessage: jest.fn()
}));
```

### Option 3: Refactor Pending Message System
Make the pending message system more test-friendly by:
- Exposing a method to clear all pending timeouts
- Using dependency injection for the entire timeout system
- Implementing a test mode that uses immediate timeouts

## Implementation Priority

**Priority: Medium**
- Tests still pass and functionality is not affected
- This is a test hygiene issue rather than a functional bug
- Should be addressed before it accumulates more technical debt

## Related Files to Review
- `/tests/setup.js` - Global timer wrapping logic
- `/src/webhook/messageThrottler.js` - Pending message timeout creation
- `/tests/unit/webhookManager.test.js` - Test with open handle
- `/tests/unit/webhookManager.exports.test.js` - Test with open handle

## Next Steps
1. Investigate the exact timeout IDs being created
2. Implement Option 1 as a quick fix
3. Consider Option 3 for long-term maintainability
4. Add to timer pattern documentation to prevent similar issues

## References
- [Jest Open Handle Detection](https://jestjs.io/docs/cli#--detectopenhandles)
- [Timer Injection Refactor](./TIMER_INJECTION_REFACTOR.md)
- [Mock Pattern Rules](../testing/MOCK_PATTERN_RULES.md)