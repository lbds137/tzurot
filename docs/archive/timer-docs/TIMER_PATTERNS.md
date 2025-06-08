# Timer Patterns and Standards

This document establishes coding standards for timer-based code to ensure testability.

## Required Pattern: Injectable Timers

### ❌ Don't: Inline Timer Delays

```javascript
// BAD: Untestable with fake timers
async function retryOperation() {
  try {
    return await doSomething();
  } catch (error) {
    // This pattern blocks fake timer testing!
    await new Promise(resolve => setTimeout(resolve, 5000));
    return await doSomething();
  }
}
```

### ✅ Do: Make Delays Injectable

```javascript
// GOOD: Testable design
class MyService {
  constructor(options = {}) {
    // Injectable delay function
    this.delay = options.delay || ((ms) => new Promise(resolve => setTimeout(resolve, ms)));
  }

  async retryOperation() {
    try {
      return await this.doSomething();
    } catch (error) {
      // Now testable!
      await this.delay(5000);
      return await this.doSomething();
    }
  }
}
```

## Pattern Checklist

When implementing timer-based functionality:

- [ ] **setTimeout delays**: Use injectable `delay` function
- [ ] **setInterval**: Use injectable `scheduler` function
- [ ] **Exponential backoff**: Make base delay and multiplier configurable
- [ ] **Jitter**: Make jitter calculation injectable or configurable
- [ ] **Cleanup**: Always provide cleanup methods for intervals

## Implementation Examples

### 1. Retry with Exponential Backoff

```javascript
class RetryService {
  constructor(options = {}) {
    this.maxRetries = options.maxRetries || 3;
    this.baseDelay = options.baseDelay || 1000;
    this.delay = options.delay || ((ms) => new Promise(resolve => setTimeout(resolve, ms)));
    this.getJitter = options.getJitter || (() => Math.floor(Math.random() * 500));
  }

  async executeWithRetry(operation) {
    let lastError;
    
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        
        if (attempt < this.maxRetries) {
          const jitter = this.getJitter();
          const delay = this.baseDelay * Math.pow(2, attempt) + jitter;
          await this.delay(delay);
        }
      }
    }
    
    throw lastError;
  }
}
```

### 2. Periodic Cleanup

```javascript
class DataStore {
  constructor(options = {}) {
    this.scheduler = options.scheduler || setInterval;
    this.cleanupPeriod = options.cleanupPeriod || 10 * 60 * 1000; // 10 minutes
    
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

### 3. Self-Destructing Messages

```javascript
class MessageManager {
  constructor(options = {}) {
    this.delay = options.delay || ((ms) => new Promise(resolve => setTimeout(resolve, ms)));
    this.scheduler = options.scheduler || setTimeout;
  }

  async sendTemporaryMessage(channel, content, duration = 10000) {
    const message = await channel.send(content);
    
    // For async cleanup
    this.delay(duration).then(() => message.delete());
    
    // Or for sync cleanup
    this.scheduler(() => message.delete(), duration);
    
    return message;
  }
}
```

## Testing These Patterns

```javascript
describe('RetryService', () => {
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
});
```

## Migration Guide

To migrate existing timer code:

1. **Identify timer patterns**: Search for `setTimeout`, `setInterval`, `new Promise`
2. **Add constructor options**: Add `delay` and/or `scheduler` to constructor
3. **Replace inline timers**: Use the injected functions
4. **Update tests**: Pass mock functions in tests
5. **Verify behavior**: Ensure tests can run without real delays

## Code Review Checklist

When reviewing code with timers:

- [ ] Are delays injectable through constructor options?
- [ ] Do tests use mock delay/scheduler functions?
- [ ] Are intervals properly cleaned up?
- [ ] Is there a default implementation for production?
- [ ] Are timer IDs stored for cleanup?

## Benefits

1. **Fast Tests**: No real delays in test execution
2. **Deterministic**: Tests behave the same every time
3. **Verifiable**: Can assert on delay values and call counts
4. **Maintainable**: Clear separation of timing logic
5. **Flexible**: Easy to adjust timing in different environments