# Fake Timers Strategy

## Current Situation

1. **No tests use fake timers** - 0 occurrences of `jest.useFakeTimers()`
2. **Tests are slow** - Average 2.1s per test file (should be < 0.5s)
3. **Checks exist but miss the real issue** - We check for `setTimeout` in tests, but the real problem is unmocked heavy modules

## Why Tests Are Slow (The Real Issue)

Tests aren't slow because of direct timer usage. They're slow because:

1. **Heavy module imports** - Loading real src files like webhookManager.js (2800+ lines)
2. **Module initialization** - Many modules create timers/intervals on load
3. **Cascading imports** - One import loads dozens of other modules

Example:

```javascript
// This looks innocent but loads 2800+ lines of code
const webhookManager = require('../../../src/webhookManager');

// Which imports these...
const aiService = require('./aiService'); // 1700+ lines
const logger = require('./logger'); // Which initializes winston
const { RateLimiter } = require('./utils/rateLimiter'); // Creates timers
// ... and more
```

## Why Global Fake Timers Break Things

When we enabled `jest.useFakeTimers()` globally, 8 tests failed because:

1. **Some tests expect real async behavior** - Network mocks need real promises
2. **Setup timing issues** - Mocks initialized before fake timers
3. **Third-party libraries** - Some libraries break with fake timers

## The Right Solution: Three-Phase Approach

### Phase 1: Mock Heavy Modules (Biggest Impact)

Add to test files:

```javascript
// Mock ALL src imports at the top
jest.mock('../../../src/webhookManager');
jest.mock('../../../src/aiService');
jest.mock('../../../src/logger');

// Then import
const webhookManager = require('../../../src/webhookManager');
```

This alone will cut test time by 50%+.

### Phase 2: Add Fake Timers Where Appropriate

For tests that deal with timers:

```javascript
describe('Component with timers', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should handle delays', () => {
    // Now delays are instant
    jest.advanceTimersByTime(5000);
  });
});
```

### Phase 3: Smart Global Setup

Once most tests are fixed, we can enable a smart global setup:

```javascript
// In setup.js
beforeEach(() => {
  // Only use fake timers if test explicitly doesn't disable them
  if (!global.REAL_TIMERS_REQUIRED) {
    jest.useFakeTimers({
      // Use modern fake timers with better compatibility
      advanceTimers: true,
      doNotFake: ['nextTick', 'setImmediate', 'process.hrtime', 'process.nextTick'],
    });
  }
});

// Tests that need real timers can opt out:
beforeAll(() => {
  global.REAL_TIMERS_REQUIRED = true;
});
```

## Enforcement Strategy

### 1. Enhanced Timer Pattern Checker

Update `check-test-antipatterns.js` to catch:

- Unmocked src imports
- Module requires without jest.mock
- Heavy module loading

### 2. New Rule: Mock First, Import Second

```javascript
// ❌ BAD - Import before mock
const webhookManager = require('../../../src/webhookManager');
jest.mock('../../../src/webhookManager');

// ✅ GOOD - Mock before import
jest.mock('../../../src/webhookManager');
const webhookManager = require('../../../src/webhookManager');
```

### 3. Automated Mock Generation

Create a script to auto-add mocks:

```bash
node scripts/add-missing-mocks.js tests/unit/some.test.js
```

## Why We Don't Catch This Currently

Our checks look for:

- Direct `setTimeout` usage ✓
- Promise with setTimeout ✓
- Long test timeouts ✓

But miss:

- Unmocked heavy imports ✗
- Module initialization timers ✗
- Cascading import chains ✗

## Action Items

1. **Update anti-pattern checker** to flag unmocked src imports
2. **Create mock templates** for heavy modules
3. **Document timer-safe modules** (which ones can be imported safely)
4. **Add performance budget** - Fail tests that run > 1 second

## Expected Results

With proper mocking and selective fake timers:

- Test suite: 40s → 15s
- Individual tests: 2s → 0.2s
- No breaking changes
- Better test isolation
