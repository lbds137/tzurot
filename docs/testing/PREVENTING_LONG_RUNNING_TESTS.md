# Preventing Long-Running Tests

This guide provides best practices and patterns to avoid creating tests that take excessive time to run.

## Common Causes of Long-Running Tests

1. **Real Timeouts**: Tests that wait for actual time to pass (e.g., 30-second timeouts)
2. **Network Operations**: Unmocked network requests that timeout
3. **File I/O**: Large file operations without mocking
4. **Promises that Never Resolve**: Hanging promises in test code
5. **Missing Timer Cleanup**: Fake timers not properly cleaned up

## Best Practices

### 1. Always Use Fake Timers for Time-Dependent Tests

```javascript
const { setupFakeTimers, cleanupFakeTimers } = require('../../helpers/testTimeouts');

describe('MyComponent', () => {
  beforeEach(() => {
    setupFakeTimers();
  });
  
  afterEach(() => {
    cleanupFakeTimers();
  });
  
  it('should handle timeout', async () => {
    const promise = someOperationWithTimeout();
    
    // Advance time instead of waiting
    jest.advanceTimersByTime(30000);
    
    await expect(promise).rejects.toThrow();
  });
});
```

### 2. Mock All External Dependencies

```javascript
// Bad - Real network call that could timeout
it('should fetch data', async () => {
  const data = await fetchFromAPI('https://api.example.com/data');
  expect(data).toBeDefined();
});

// Good - Mocked network call
it('should fetch data', async () => {
  mockFetch.mockResolvedValueOnce({ data: 'test' });
  const data = await fetchFromAPI('https://api.example.com/data');
  expect(data).toBeDefined();
});
```

### 3. Set Test Timeouts

```javascript
// Set a reasonable timeout for the entire test file
jest.setTimeout(5000); // 5 seconds

// Or for individual tests
it('should complete quickly', async () => {
  // test code
}, 5000); // 5 second timeout
```

### 4. Pattern for Testing Timeout Behavior

```javascript
const { mockTimeoutFetch } = require('../../helpers/testTimeouts');

it('should handle download timeout', async () => {
  jest.useFakeTimers();
  
  // Set up the mock to simulate a timeout
  const timeoutMock = mockTimeoutFetch(nodeFetch);
  
  // Start the operation
  const downloadPromise = downloadFile('https://example.com/large-file.mp3');
  
  // Advance time to trigger timeout
  timeoutMock.advanceToTimeout();
  
  // Verify the timeout was handled
  await expect(downloadPromise).rejects.toThrow();
  
  jest.useRealTimers();
});
```

### 5. Avoid These Anti-Patterns

```javascript
// ❌ Bad - Waits for real time
it('should timeout after 30 seconds', async () => {
  const promise = operationWithTimeout();
  await new Promise(resolve => setTimeout(resolve, 30000));
  expect(promise).rejects.toThrow();
});

// ❌ Bad - Promise that might never resolve
it('should handle slow operation', async () => {
  const promise = new Promise(resolve => {
    if (someCondition) {
      resolve();
    }
    // No else - promise never resolves if condition is false!
  });
  await promise;
});

// ✅ Good - Uses fake timers
it('should timeout after 30 seconds', async () => {
  jest.useFakeTimers();
  const promise = operationWithTimeout();
  jest.advanceTimersByTime(30000);
  await expect(promise).rejects.toThrow();
  jest.useRealTimers();
});
```

## Checklist for New Tests

Before committing a test, ensure:

- [ ] No real `setTimeout` or `setInterval` calls without fake timers
- [ ] All network requests are mocked
- [ ] All file I/O operations are mocked
- [ ] Test has a reasonable timeout set (< 5 seconds)
- [ ] All promises either resolve or reject
- [ ] Fake timers are cleaned up in `afterEach`
- [ ] No `await new Promise(resolve => setTimeout(resolve, X))` patterns

## Testing Async Operations with Timeouts

For operations that use AbortController or have built-in timeouts:

```javascript
it('should abort operation on timeout', async () => {
  jest.useFakeTimers();
  
  // Mock the fetch to never resolve
  let rejectFn;
  nodeFetch.mockImplementationOnce(() => new Promise((resolve, reject) => {
    rejectFn = reject;
  }));
  
  // Start the operation
  const promise = downloadWithTimeout('https://example.com/file.mp3', 5000);
  
  // Advance time to trigger abort
  jest.advanceTimersByTime(5000);
  
  // Manually reject to simulate abort
  const abortError = new Error('The operation was aborted');
  abortError.name = 'AbortError';
  rejectFn(abortError);
  
  // Verify it was aborted
  await expect(promise).rejects.toThrow('aborted');
  
  jest.useRealTimers();
});
```

## Enforcing Test Timeouts

Add to your Jest configuration (`jest.config.js`):

```javascript
module.exports = {
  // ... other config
  testTimeout: 5000, // 5 seconds default for all tests
  // ... other config
};
```

Or in your test setup file:

```javascript
// tests/setup.js
jest.setTimeout(5000); // 5 seconds default for all tests
```

## Debugging Long-Running Tests

If a test is taking too long:

1. Run with `--detectOpenHandles` to find hanging operations:
   ```bash
   npm test -- --detectOpenHandles
   ```

2. Add console logs to identify where it's hanging:
   ```javascript
   console.log('Before operation');
   await someOperation();
   console.log('After operation'); // If this doesn't print, the operation is hanging
   ```

3. Check for missing mocks:
   ```javascript
   // Ensure all external dependencies are mocked
   jest.mock('node-fetch');
   jest.mock('fs');
   ```

## Example: Refactoring a Long-Running Test

### Before (Takes 30+ seconds):
```javascript
it('should handle timeout during download', async () => {
  nodeFetch.mockImplementationOnce(() => 
    new Promise((resolve) => {
      setTimeout(() => resolve({
        ok: true,
        headers: { get: jest.fn().mockReturnValue('audio/mpeg') },
        arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(1024))
      }), 60000); // Waits 60 seconds!
    })
  );
  
  await expect(audioHandler.downloadAudioFile('https://example.com/slow.mp3'))
    .rejects.toThrow();
});
```

### After (Takes milliseconds):
```javascript
it('should handle timeout during download', async () => {
  jest.useFakeTimers();
  
  const abortError = new Error('The operation was aborted');
  abortError.name = 'AbortError';
  
  let rejectFn;
  nodeFetch.mockImplementationOnce(() => new Promise((resolve, reject) => {
    rejectFn = reject;
  }));
  
  const downloadPromise = audioHandler.downloadAudioFile('https://example.com/slow.mp3');
  
  // Simulate timeout
  jest.advanceTimersByTime(30000);
  if (rejectFn) rejectFn(abortError);
  
  await expect(downloadPromise).rejects.toThrow();
  
  jest.useRealTimers();
});
```

## Continuous Prevention

1. **Code Reviews**: Always check for timeout patterns in PR reviews
2. **CI/CD**: Set a maximum test execution time in your CI pipeline
3. **Pre-commit Hooks**: Add a check for common timeout anti-patterns
4. **Documentation**: Keep this guide updated with new patterns as they're discovered