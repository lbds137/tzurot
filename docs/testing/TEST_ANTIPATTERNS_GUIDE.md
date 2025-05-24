# Test Anti-Patterns Guide

This guide documents common anti-patterns we've encountered in our test suite and how to fix them.

## Table of Contents

1. [Timeout Anti-patterns](#timeout-anti-patterns)
2. [Mock Cleanup Anti-patterns](#mock-cleanup-anti-patterns)
3. [Async/Promise Anti-patterns](#asyncpromise-anti-patterns)
4. [Test Structure Anti-patterns](#test-structure-anti-patterns)
5. [Console and Debug Anti-patterns](#console-and-debug-anti-patterns)
6. [Real Data Anti-patterns](#real-data-anti-patterns)
7. [File System Anti-patterns](#file-system-anti-patterns)
8. [Network Request Anti-patterns](#network-request-anti-patterns)
9. [Memory Leak Anti-patterns](#memory-leak-anti-patterns)
10. [Test Isolation Anti-patterns](#test-isolation-anti-patterns)

## Timeout Anti-patterns

### ❌ Bad: Real setTimeout
```javascript
it('should timeout after 30 seconds', async () => {
  await new Promise(resolve => setTimeout(resolve, 30000));
  expect(something).toBe(true);
});
```

### ✅ Good: Fake timers
```javascript
it('should timeout after 30 seconds', async () => {
  jest.useFakeTimers();
  const promise = operationWithTimeout();
  jest.advanceTimersByTime(30000);
  await expect(promise).rejects.toThrow();
  jest.useRealTimers();
});
```

## Mock Cleanup Anti-patterns

### ❌ Bad: No mock cleanup
```javascript
jest.mock('fs');

describe('FileHandler', () => {
  it('should read file', () => {
    fs.readFileSync.mockReturnValue('content');
    // test code
  });
  // No cleanup - mock persists to next test!
});
```

### ✅ Good: Proper cleanup
```javascript
jest.mock('fs');

describe('FileHandler', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should read file', () => {
    fs.readFileSync.mockReturnValue('content');
    // test code
  });
});
```

## Async/Promise Anti-patterns

### ❌ Bad: Missing await
```javascript
it('should reject with error', () => {
  expect(asyncFunction()).rejects.toThrow(); // Missing await!
});
```

### ✅ Good: Proper await
```javascript
it('should reject with error', async () => {
  await expect(asyncFunction()).rejects.toThrow();
});
```

### ❌ Bad: Empty then blocks
```javascript
promise.then().catch(error => console.log(error));
```

### ✅ Good: Use async/await
```javascript
try {
  await promise;
} catch (error) {
  console.log(error);
}
```

## Test Structure Anti-patterns

### ❌ Bad: Long test descriptions
```javascript
it('should handle the case when the user clicks the button and the form is submitted with invalid data and the server returns an error', () => {
  // test
});
```

### ✅ Good: Concise descriptions
```javascript
it('should show error for invalid form submission', () => {
  // test
});
```

### ❌ Bad: .only() in committed code
```javascript
it.only('should work', () => { // Will skip all other tests!
  // test
});
```

### ✅ Good: Remove .only() before commit
```javascript
it('should work', () => {
  // test
});
```

## Console and Debug Anti-patterns

### ❌ Bad: Unmocked console
```javascript
it('should log message', () => {
  myFunction(); // This might console.log and clutter test output
  expect(result).toBe(true);
});
```

### ✅ Good: Mock console
```javascript
beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  console.log.mockRestore();
});

it('should log message', () => {
  myFunction();
  expect(console.log).toHaveBeenCalledWith('expected message');
});
```

## Real Data Anti-patterns

### ❌ Bad: Real usernames/emails
```javascript
const testUser = {
  email: 'john.doe@gmail.com',
  username: '@RealPerson123'
};
```

### ✅ Good: Generic test data
```javascript
const testUser = {
  email: 'test@example.com',
  username: '@TestUser'
};
```

### ❌ Bad: Real URLs
```javascript
const apiUrl = 'https://api.github.com/users/octocat';
```

### ✅ Good: Example URLs
```javascript
const apiUrl = 'https://api.example.com/users/testuser';
```

## File System Anti-patterns

### ❌ Bad: Real file operations
```javascript
it('should read config', () => {
  const config = fs.readFileSync('./config.json'); // Real file I/O!
  expect(config).toBeDefined();
});
```

### ✅ Good: Mock file system
```javascript
jest.mock('fs');

it('should read config', () => {
  fs.readFileSync.mockReturnValue('{"key": "value"}');
  const config = readConfig();
  expect(config.key).toBe('value');
});
```

## Network Request Anti-patterns

### ❌ Bad: Real network calls
```javascript
it('should fetch data', async () => {
  const data = await fetch('https://api.example.com/data'); // Real network call!
  expect(data).toBeDefined();
});
```

### ✅ Good: Mock network calls
```javascript
jest.mock('node-fetch');

it('should fetch data', async () => {
  fetch.mockResolvedValue({
    json: async () => ({ data: 'test' })
  });
  const data = await fetchData();
  expect(data).toEqual({ data: 'test' });
});
```

## Memory Leak Anti-patterns

### ❌ Bad: Uncleaned intervals
```javascript
it('should poll for updates', () => {
  setInterval(() => checkUpdates(), 1000); // Never cleared!
  // test code
});
```

### ✅ Good: Clean up intervals
```javascript
it('should poll for updates', () => {
  const interval = setInterval(() => checkUpdates(), 1000);
  // test code
  clearInterval(interval);
});
```

### ❌ Bad: Uncleaned event listeners
```javascript
it('should handle events', () => {
  element.addEventListener('click', handler); // Never removed!
  // test code
});
```

### ✅ Good: Clean up listeners
```javascript
it('should handle events', () => {
  element.addEventListener('click', handler);
  // test code
  element.removeEventListener('click', handler);
});
```

## Test Isolation Anti-patterns

### ❌ Bad: Shared state
```javascript
let sharedCounter = 0;

it('test 1', () => {
  sharedCounter++;
  expect(sharedCounter).toBe(1);
});

it('test 2', () => {
  // This test depends on test 1!
  expect(sharedCounter).toBe(1); // Fails if test order changes
});
```

### ✅ Good: Reset state
```javascript
let counter;

beforeEach(() => {
  counter = 0;
});

it('test 1', () => {
  counter++;
  expect(counter).toBe(1);
});

it('test 2', () => {
  counter++;
  expect(counter).toBe(1); // Always passes
});
```

## Running the Anti-pattern Checker

```bash
# Check staged files
node scripts/check-test-antipatterns.js

# Check all test files
node scripts/check-test-antipatterns.js --all

# Add as pre-commit hook
echo 'node scripts/check-test-antipatterns.js' >> .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
```

## Best Practices Summary

1. **Always use fake timers** for time-dependent tests
2. **Always clean up mocks** in afterEach
3. **Always await async assertions**
4. **Keep test descriptions concise** (<80 chars)
5. **Mock all external dependencies** (console, fs, network)
6. **Use generic test data** (no real emails/usernames)
7. **Clean up resources** (intervals, listeners)
8. **Isolate test state** (reset in beforeEach)
9. **Never use .only()** in committed code
10. **Mock file and network operations**