# Timer Testing Guide

This guide establishes best practices for testing code that uses timers (setTimeout, setInterval, etc.) in Jest tests.

## Key Principle: Always Use Fake Timers

**Default to fake timers for all tests.** Real timers should only be used in exceptional circumstances.

## Making Timer-Based Code Testable

### The Problem

This common pattern is difficult to test with fake timers:
```javascript
// PROBLEMATIC: Hard to test with fake timers
async function retryWithDelay() {
  try {
    return await operation();
  } catch (error) {
    await new Promise(resolve => setTimeout(resolve, 5000));
    return await operation();
  }
}
```

### The Solution: Injectable Delays

Make timer-based delays injectable through constructor options:

```javascript
// GOOD: Testable with fake timers
class MyService {
  constructor(options = {}) {
    // Allow injection of delay function for testing
    this.delay = options.delay || ((ms) => new Promise(resolve => setTimeout(resolve, ms)));
  }

  async retryWithDelay() {
    try {
      return await this.operation();
    } catch (error) {
      await this.delay(5000);
      return await this.operation();
    }
  }
}

// In tests:
const service = new MyService({
  delay: jest.fn().mockResolvedValue() // Resolves immediately
});

// Now you can verify delays without waiting
expect(service.delay).toHaveBeenCalledWith(5000);
```

### Real Example: ProfileInfoFetcher

Before refactoring (untestable):
```javascript
// Timeout retry logic
if (retryCount <= this.maxRetries) {
  const waitTime = 2000 * Math.pow(2, retryCount) + jitter;
  await new Promise(resolve => setTimeout(resolve, waitTime)); // HARD TO TEST!
  continue;
}
```

After refactoring (testable):
```javascript
// In constructor
this.delay = options.delay || ((ms) => new Promise(resolve => setTimeout(resolve, ms)));

// In retry logic
if (retryCount <= this.maxRetries) {
  const waitTime = 2000 * Math.pow(2, retryCount) + jitter;
  await this.delay(waitTime); // EASY TO TEST!
  continue;
}
```

## Why Fake Timers?

1. **Speed**: Tests run in milliseconds instead of seconds/minutes
2. **Deterministic**: No flaky tests due to timing variations
3. **Control**: Can test long delays without waiting
4. **Predictable**: Tests behave the same way every time

## Basic Setup

```javascript
beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});
```

## Common Patterns

### Testing setTimeout

```javascript
test('should retry after delay', async () => {
  const operation = startOperationWithRetry();
  
  // Let the first attempt complete
  await Promise.resolve();
  
  // Advance past the retry delay
  jest.advanceTimersByTime(5000);
  
  // Await the final result
  const result = await operation;
  expect(result).toBe(expectedValue);
});
```

### Testing Exponential Backoff

```javascript
test('should handle multiple retries with backoff', async () => {
  const promise = operationWithBackoff();
  
  // Advance through each retry
  for (let i = 0; i < maxRetries; i++) {
    await Promise.resolve(); // Flush microtasks
    jest.advanceTimersByTime(30000); // Advance past any delay
  }
  
  const result = await promise;
  expect(result).toBe(expectedValue);
});
```

### Testing with Promises and Timers

When code combines Promises with timers (common in retry logic):

```javascript
// Code being tested
async function retryOperation() {
  try {
    return await doSomething();
  } catch (error) {
    await new Promise(resolve => setTimeout(resolve, 5000));
    return await doSomething();
  }
}

// Test
test('should retry after delay', async () => {
  doSomething
    .mockRejectedValueOnce(new Error('Fail'))
    .mockResolvedValueOnce('Success');
  
  const promise = retryOperation();
  
  // Let the first call fail and start the timer
  await Promise.resolve();
  
  // Advance the timer
  jest.advanceTimersByTime(5000);
  
  // Get the result
  const result = await promise;
  expect(result).toBe('Success');
});
```

## Common Pitfalls and Solutions

### Pitfall 1: Test Timeouts

**Problem**: Test times out even with fake timers.

**Solution**: Make sure to flush microtasks between timer advances:
```javascript
await Promise.resolve(); // or await new Promise(setImmediate);
jest.advanceTimersByTime(delay);
```

### Pitfall 2: Timer Not Advancing

**Problem**: Timer doesn't seem to advance.

**Solution**: Check if the code uses Date.now() or performance.now():
```javascript
beforeEach(() => {
  jest.useFakeTimers('modern'); // Modern fake timers handle Date.now()
});
```

### Pitfall 3: Mixed Async Operations

**Problem**: Complex async operations with multiple timers.

**Solution**: Use jest.runAllTimers() carefully:
```javascript
const promise = complexAsyncOperation();

// Option 1: Run all timers at once (careful with infinite timers!)
jest.runAllTimers();

// Option 2: Step through specific intervals
for (let i = 0; i < steps; i++) {
  await Promise.resolve();
  jest.advanceTimersByTime(stepDelay);
}

const result = await promise;
```

## Handling setInterval

For periodic operations, make the scheduler injectable:

```javascript
class MessageTracker {
  constructor(options = {}) {
    // Allow injection of scheduler for testing
    this.scheduler = options.scheduler || setInterval;
    
    // Set up cleanup interval
    this.cleanupInterval = this.scheduler(() => {
      this.cleanup();
    }, 10 * 60 * 1000);
  }
  
  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }
}

// In tests:
const mockScheduler = jest.fn();
const tracker = new MessageTracker({
  scheduler: mockScheduler
});

// Verify interval was set up
expect(mockScheduler).toHaveBeenCalledWith(
  expect.any(Function),
  600000 // 10 minutes
);

// Manually trigger the cleanup
const cleanupFn = mockScheduler.mock.calls[0][0];
cleanupFn();
```

## When Real Timers Might Be Needed (Rare!)

Only consider real timers for:
1. Integration tests testing actual timing behavior
2. Tests verifying real-world timeout scenarios
3. Third-party libraries that don't work with fake timers

Even then, try to mock the timing-dependent parts instead.

## Best Practices

1. **Always start with fake timers** - Only switch to real if absolutely necessary
2. **Document why** if you must use real timers
3. **Keep timer advances explicit** - Show what delay you're skipping
4. **Flush microtasks** - Use `await Promise.resolve()` between advances
5. **Clear timers** - Always clear in afterEach to prevent interference

## Example: Migrating from Real to Fake Timers

### Before (Slow - Takes 12+ seconds)
```javascript
test('should retry on timeout', async () => {
  jest.useRealTimers();
  
  mockFetch
    .mockRejectedValueOnce(new Error('Timeout'))
    .mockResolvedValueOnce(data);
  
  const result = await fetchWithRetry(); // Waits for real delays!
  
  expect(result).toEqual(data);
}, 20000); // Long timeout needed
```

### After (Fast - Takes milliseconds)
```javascript
test('should retry on timeout', async () => {
  mockFetch
    .mockRejectedValueOnce(new Error('Timeout'))
    .mockResolvedValueOnce(data);
  
  const promise = fetchWithRetry();
  
  await Promise.resolve();
  jest.advanceTimersByTime(5000);
  
  const result = await promise;
  expect(result).toEqual(data);
}); // No timeout needed!
```

## Debugging Timer Tests

If a timer test isn't working:

1. Add console.logs to see execution order
2. Check if timers are actually fake: `jest.isMockFunction(setTimeout)`
3. Use `jest.getTimerCount()` to see pending timers
4. Try `jest.runOnlyPendingTimers()` instead of `advanceTimersByTime`

Remember: Fast tests are happy tests! Keep them fake! 🚀