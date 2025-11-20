# Complete Timer Patterns Guide

This guide consolidates all timer-related documentation for Tzurot, covering patterns, testing, enforcement, and migration.

## Table of Contents
1. [Core Concepts](#core-concepts)
2. [Required Patterns](#required-patterns)
3. [Testing with Timers](#testing-with-timers)
4. [Enforcement & CI/CD](#enforcement--cicd)
5. [Migration Guide](#migration-guide)
6. [Common Pitfalls](#common-pitfalls)
7. [Quick Reference](#quick-reference)

## Core Concepts

### Why Injectable Timers?
- **Fast Tests**: No real delays in test execution (tests run in ms, not seconds)
- **Deterministic**: Tests behave the same every time
- **Verifiable**: Can assert on delay values and call counts
- **Maintainable**: Clear separation of timing logic
- **No Flaky Tests**: Eliminates timing-based test failures

### The Problem We're Solving
```javascript
// ❌ UNTESTABLE: Forces real delays in tests
async function retryOperation() {
  try {
    return await doSomething();
  } catch (error) {
    // This blocks fake timer testing!
    await new Promise(resolve => setTimeout(resolve, 5000));
    return await doSomething();
  }
}
```

## Required Patterns

### Pattern 1: Injectable Delay Functions

```javascript
// ✅ CORRECT: Injectable delays
class MyService {
  constructor(options = {}) {
    // Injectable delay function with sensible default
    this.delay = options.delay || ((ms) => new Promise(resolve => setTimeout(resolve, ms)));
  }

  async retryOperation() {
    try {
      return await this.doSomething();
    } catch (error) {
      await this.delay(5000); // Now testable!
      return await this.doSomething();
    }
  }
}
```

### Pattern 2: Injectable Schedulers

```javascript
// ✅ CORRECT: Injectable interval/timeout
class DataStore {
  constructor(options = {}) {
    this.scheduler = options.scheduler || setInterval;
    this.cleanupPeriod = options.cleanupPeriod || 10 * 60 * 1000;
    this.cleanupInterval = null;
    
    this.startCleanup();
  }

  startCleanup() {
    this.cleanupInterval = this.scheduler(
      () => this.cleanup(),
      this.cleanupPeriod
    );
    
    // Allow Node.js to exit even if interval is active
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}
```

### Pattern 3: Module-Level Injection

```javascript
// ✅ CORRECT: Module-level timer injection
let delayFn = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function setDelayFunction(fn) {
  delayFn = fn;
}

async function myFunction() {
  await delayFn(1000);
}

module.exports = { myFunction, setDelayFunction };
```

### Pattern 4: Never Execute During Import

```javascript
// ❌ BAD: Executes immediately on import
const tracker = new MessageTracker();
module.exports = tracker;

// ✅ GOOD: Lazy initialization
module.exports = {
  MessageTracker,
  create: (deps) => new MessageTracker(deps),
  // Backward compatibility with lazy init
  get instance() {
    if (!this._instance) {
      this._instance = new MessageTracker();
    }
    return this._instance;
  }
};
```

## Testing with Timers

### Basic Test Setup

```javascript
describe('MyService', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  test('should retry after delay', async () => {
    // Create mocks
    const mockDelay = jest.fn().mockResolvedValue();
    const mockOperation = jest.fn()
      .mockRejectedValueOnce(new Error('Fail'))
      .mockResolvedValueOnce('Success');

    // Inject mocks
    const service = new MyService({
      delay: mockDelay
    });
    service.doSomething = mockOperation;

    // Execute
    const result = await service.retryOperation();

    // Verify
    expect(result).toBe('Success');
    expect(mockOperation).toHaveBeenCalledTimes(2);
    expect(mockDelay).toHaveBeenCalledWith(5000);
  });
});
```

### Testing Exponential Backoff

```javascript
test('retries with exponential backoff', async () => {
  const mockDelay = jest.fn().mockResolvedValue();
  const mockOperation = jest.fn()
    .mockRejectedValueOnce(new Error('Fail 1'))
    .mockRejectedValueOnce(new Error('Fail 2'))
    .mockResolvedValueOnce('Success');

  const service = new RetryService({
    delay: mockDelay,
    getJitter: () => 100 // Fixed jitter for testing
  });

  const result = await service.executeWithRetry(mockOperation);

  expect(result).toBe('Success');
  expect(mockOperation).toHaveBeenCalledTimes(3);
  expect(mockDelay).toHaveBeenCalledTimes(2);
  expect(mockDelay).toHaveBeenCalledWith(1100); // 1000 + 100 jitter
  expect(mockDelay).toHaveBeenCalledWith(2100); // 2000 + 100 jitter
});
```

### Testing with setInterval

```javascript
test('should set up cleanup interval', () => {
  const mockScheduler = jest.fn();
  const store = new DataStore({
    scheduler: mockScheduler,
    cleanupPeriod: 60000
  });

  // Verify interval was set up
  expect(mockScheduler).toHaveBeenCalledWith(
    expect.any(Function),
    60000
  );

  // Manually trigger cleanup
  const cleanupFn = mockScheduler.mock.calls[0][0];
  cleanupFn();

  // Verify cleanup was called
  expect(store.cleanupCallCount).toBe(1);
});
```

## Enforcement & CI/CD

### Pre-commit Hook Setup

```bash
#!/bin/bash
# .git/hooks/pre-commit

# Check for timer patterns
node scripts/check-timer-patterns.js
if [ $? -ne 0 ]; then
  echo "❌ Timer pattern issues detected. Please fix before committing."
  exit 1
fi
```

### CI/CD Integration

```yaml
# .github/workflows/ci.yml
- name: Check Timer Patterns
  run: node scripts/check-timer-patterns.js

- name: Run Tests
  run: npm test
  
- name: Verify Test Speed
  run: |
    TEST_TIME=$(npm test -- --json | jq '.testResults[].perfStats.runtime' | awk '{s+=$1} END {print s}')
    if [ $TEST_TIME -gt 30000 ]; then
      echo "❌ Tests too slow! Should complete in < 30s"
      exit 1
    fi
```

### ESLint Rules

```javascript
// .eslintrc.timer-patterns.js
module.exports = {
  rules: {
    'no-restricted-syntax': [
      'error',
      {
        selector: 'NewExpression[callee.name="Promise"] CallExpression[callee.name="setTimeout"]',
        message: 'Use injectable delay function instead of Promise-wrapped setTimeout'
      },
      {
        selector: 'CallExpression[callee.name="setTimeout"]:not([parent.type="MemberExpression"])',
        message: 'setTimeout must be injectable through constructor/options'
      }
    ]
  }
};
```

## Migration Guide

### Step 1: Identify Timer Usage
```bash
# Find all timer usage
grep -r "setTimeout\|setInterval\|new Promise" src/ --include="*.js" | grep -v node_modules
```

### Step 2: Update Class Constructors
```javascript
// Before
class MyClass {
  constructor() {
    this.timeout = setTimeout(() => {}, 1000);
  }
}

// After
class MyClass {
  constructor(options = {}) {
    this.scheduler = options.scheduler || setTimeout;
    this.timeout = this.scheduler(() => {}, 1000);
  }
}
```

### Step 3: Update Promise Delays
```javascript
// Before
async function wait() {
  await new Promise(resolve => setTimeout(resolve, 1000));
}

// After
async function wait(delay = defaultDelay) {
  await delay(1000);
}

const defaultDelay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
```

### Step 4: Update Tests
```javascript
// Before
test('waits for delay', async () => {
  const result = await functionWithDelay();
  expect(result).toBe(true);
}, 10000); // Long timeout

// After
test('waits for delay', async () => {
  const mockDelay = jest.fn().mockResolvedValue();
  const result = await functionWithDelay(mockDelay);
  expect(result).toBe(true);
  expect(mockDelay).toHaveBeenCalledWith(5000);
}); // No timeout needed!
```

## Common Pitfalls

### Pitfall 1: Mixing Real and Fake Timers
```javascript
// ❌ BAD: Inconsistent timer usage
test('mixed timers', async () => {
  jest.useFakeTimers();
  const promise = operationWithDelay();
  
  // This won't work - Promise uses real setTimeout internally
  jest.advanceTimersByTime(5000);
  
  await promise; // Will hang!
});

// ✅ GOOD: Consistent injectable approach
test('mixed timers', async () => {
  const mockDelay = jest.fn().mockResolvedValue();
  const result = await operationWithDelay({ delay: mockDelay });
  expect(mockDelay).toHaveBeenCalledWith(5000);
});
```

### Pitfall 2: Forgetting Cleanup
```javascript
// ❌ BAD: No cleanup
class Service {
  constructor() {
    this.interval = setInterval(() => {}, 1000);
  }
}

// ✅ GOOD: Proper cleanup
class Service {
  constructor(options = {}) {
    this.scheduler = options.scheduler || setInterval;
    this.interval = this.scheduler(() => {}, 1000);
  }
  
  destroy() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }
}
```

### Pitfall 3: Global Timer State
```javascript
// ❌ BAD: Global state
let retryCount = 0;
setTimeout(() => { retryCount++; }, 1000);

// ✅ GOOD: Encapsulated state
class RetryManager {
  constructor(options = {}) {
    this.scheduler = options.scheduler || setTimeout;
    this.retryCount = 0;
    this.scheduleRetry();
  }
  
  scheduleRetry() {
    this.scheduler(() => { this.retryCount++; }, 1000);
  }
}
```

## Quick Reference

### Do's ✅
- Make all timers injectable through constructor options
- Provide sensible defaults for production
- Always clean up intervals and timeouts
- Use fake timers in all tests
- Store timer IDs for cleanup
- Document any use of real timers in tests

### Don'ts ❌
- Use setTimeout/setInterval directly in classes
- Create Promise delays inline
- Execute timer code during module import
- Mix real and fake timers in tests
- Forget to clean up intervals
- Use arbitrary sleep/delay in tests

### Code Review Checklist
- [ ] All `setTimeout` calls are injectable
- [ ] All `setInterval` calls are injectable  
- [ ] Promise-wrapped timers use injectable delays
- [ ] Tests provide mock timers, not real ones
- [ ] Timer IDs are stored for cleanup
- [ ] No timer code executes during import
- [ ] Cleanup methods exist for all intervals

### Metrics to Track
- **Timer Pattern Violations**: Should be 0
- **Test Execution Time**: Should be < 30s for full suite
- **Flaky Test Count**: Should be 0 for timer-related tests
- **Test Timeout Overrides**: Should be 0 (no `test(..., 10000)`)

## Resources

- [Timer Pattern Checker Script](/scripts/check-timer-patterns.js)
- [Example Refactoring PRs](#) (add links to successful refactors)
- [Jest Timer Mocking Docs](https://jestjs.io/docs/timer-mocks)

---

By following these patterns, we ensure our codebase remains testable, our tests run fast, and timer-related bugs become a thing of the past!