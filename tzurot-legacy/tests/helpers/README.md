# Test Helpers

This directory contains utility functions and helpers to make writing tests easier and more consistent.

## testTimeouts.js

Provides utilities for handling timeouts in tests without actually waiting for real time to pass.

### Usage

```javascript
const { 
  setupFakeTimers, 
  cleanupFakeTimers, 
  mockTimeoutFetch 
} = require('../helpers/testTimeouts');

describe('MyComponent', () => {
  beforeEach(() => {
    setupFakeTimers();
  });
  
  afterEach(() => {
    cleanupFakeTimers();
  });
  
  it('should handle timeout', async () => {
    const timeoutMock = mockTimeoutFetch(nodeFetch);
    
    const promise = downloadFile('https://example.com/file.mp3');
    
    // Advance time to trigger timeout
    timeoutMock.advanceToTimeout();
    
    await expect(promise).rejects.toThrow();
  });
});
```

### Available Functions

- `setupFakeTimers()` - Initialize fake timers for the test
- `cleanupFakeTimers()` - Restore real timers after test
- `mockTimeoutFetch(mockFetch, delay)` - Mock a fetch that will timeout
- `mockSlowOperation(mockFn, resolveValue, delay)` - Mock a slow async operation
- `setupAbortableOperation(mockFetch, options)` - Setup operation with AbortController

## Best Practices

1. **Always use fake timers** for tests involving timeouts or delays
2. **Set reasonable test timeouts** (< 5 seconds) in your test files
3. **Mock all external dependencies** including network calls and file I/O
4. **Clean up timers** in afterEach to prevent test pollution

## Common Patterns

### Testing Timeout Behavior

```javascript
it('should timeout after 30 seconds', async () => {
  jest.useFakeTimers();
  
  const promise = operationWithTimeout();
  
  // Fast-forward time
  jest.advanceTimersByTime(30000);
  
  await expect(promise).rejects.toThrow('timeout');
  
  jest.useRealTimers();
});
```

### Testing Retry Logic

```javascript
it('should retry 3 times before failing', async () => {
  jest.useFakeTimers();
  
  let attempts = 0;
  mockFetch.mockImplementation(() => {
    attempts++;
    return Promise.reject(new Error('Network error'));
  });
  
  const promise = fetchWithRetry('https://api.example.com/data');
  
  // Advance through retry delays
  for (let i = 0; i < 3; i++) {
    await Promise.resolve(); // Let promises settle
    jest.advanceTimersByTime(1000); // 1 second retry delay
  }
  
  await expect(promise).rejects.toThrow('Network error');
  expect(attempts).toBe(3);
  
  jest.useRealTimers();
});
```

## Troubleshooting

### Test Still Takes Too Long

1. Check if you're using `jest.useFakeTimers()`
2. Ensure you're advancing timers with `jest.advanceTimersByTime()`
3. Check for real network calls or file I/O that isn't mocked
4. Look for promises that never resolve

### Open Handle Warnings

If you see warnings about open handles:

1. Ensure all timers are cleared in `afterEach`
2. Check for unclosed network connections
3. Use `--detectOpenHandles` flag to identify the source

### Flaky Timeout Tests

If timeout tests are inconsistent:

1. Use fake timers consistently
2. Avoid mixing real and fake timers in the same test
3. Ensure proper promise settling with `await Promise.resolve()`