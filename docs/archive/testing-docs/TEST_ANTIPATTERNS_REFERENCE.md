# Test Anti-patterns Reference

This document lists all the anti-patterns that our automated checker detects. These patterns have caused us significant grief and test quality issues.

## 1. Timeout Anti-patterns ❌

### Problem: Real timeouts in tests
```javascript
// ❌ BAD
await new Promise(resolve => setTimeout(resolve, 5000));
setTimeout(() => doSomething(), 10000);
```

### Solution: Use fake timers
```javascript
// ✅ GOOD
jest.useFakeTimers();
jest.advanceTimersByTime(5000);
```

## 2. Mock Cleanup Anti-patterns ⚠️

### Problem: Mocks without cleanup
```javascript
// ❌ BAD
jest.mock('../module');
// No cleanup!
```

### Solution: Clean up in afterEach
```javascript
// ✅ GOOD
afterEach(() => {
  jest.clearAllMocks();
  jest.resetModules();
});
```

## 3. Async/Promise Anti-patterns ❌

### Problem: Missing await
```javascript
// ❌ BAD
expect(asyncFunc()).resolves.toBe(true);
```

### Solution: Always await
```javascript
// ✅ GOOD
await expect(asyncFunc()).resolves.toBe(true);
```

## 4. Test Structure Anti-patterns ❌

### Problem: .only() and .skip()
```javascript
// ❌ BAD
it.only('should work', () => {});
it.skip('broken test', () => {});
```

### Solution: Fix or remove, never commit .only()
```javascript
// ✅ GOOD
it('should work', () => {});
```

## 5. Console Anti-patterns ⚠️

### Problem: Unmocked console
```javascript
// ❌ BAD
console.log('Debug info');
```

### Solution: Mock console
```javascript
// ✅ GOOD
beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation();
});
```

## 6. Real Data Anti-patterns ⚠️

### Problem: Real emails/usernames
```javascript
// ❌ BAD
const email = 'john.doe@gmail.com';
const username = '@realuser';
```

### Solution: Use generic test data
```javascript
// ✅ GOOD
const email = 'test@example.com';
const username = '@TestUser';
```

## 7. File System Anti-patterns ❌

### Problem: Unmocked fs operations
```javascript
// ❌ BAD
fs.readFileSync('config.json');
```

### Solution: Mock fs
```javascript
// ✅ GOOD
jest.mock('fs');
```

## 8. Network Anti-patterns ❌

### Problem: Real network calls
```javascript
// ❌ BAD
await fetch('https://api.example.com');
```

### Solution: Mock network
```javascript
// ✅ GOOD
jest.mock('node-fetch');
```

## 9. Memory Leak Anti-patterns ❌

### Problem: Uncleaned intervals/listeners
```javascript
// ❌ BAD
setInterval(() => check(), 1000);
element.addEventListener('click', handler);
```

### Solution: Clean up
```javascript
// ✅ GOOD
const interval = setInterval(() => check(), 1000);
afterEach(() => clearInterval(interval));
```

## 10. Test Isolation Anti-patterns ℹ️

### Problem: Shared state
```javascript
// ❌ BAD
let cache = {};
it('test 1', () => { cache.value = 1; });
it('test 2', () => { /* uses dirty cache */ });
```

### Solution: Reset state
```javascript
// ✅ GOOD
let cache;
beforeEach(() => { cache = {}; });
```

## 11. Implementation Testing Anti-patterns ❌ (NEW!)

### Problem: Testing internals
```javascript
// ❌ BAD
expect(obj._privateMethod).toHaveBeenCalled();
expect(mock.mock.calls[0][1]).toBe('internal');
expect(spy).toHaveBeenCalledTimes(7); // brittle!
```

### Solution: Test behavior
```javascript
// ✅ GOOD
expect(result).toBe('expected outcome');
expect(visibleSideEffect).toHaveOccurred();
```

## 12. Mock Misuse Anti-patterns ⚠️ (NEW!)

### Problem: Conflicting mocks
```javascript
// ❌ BAD
jest.fn()
  .mockResolvedValue('success')
  .mockRejectedValue('error'); // ???
```

### Solution: Use *Once methods
```javascript
// ✅ GOOD
jest.fn()
  .mockResolvedValueOnce('success')
  .mockRejectedValueOnce('error');
```

## 13. Flaky Test Anti-patterns ❌ (NEW!)

### Problem: Non-deterministic tests
```javascript
// ❌ BAD
expect(Date.now()).toBeGreaterThan(before);
expect(Math.random()).toBeLessThan(0.5);
```

### Solution: Mock non-deterministic values
```javascript
// ✅ GOOD
jest.spyOn(Date, 'now').mockReturnValue(1234567890);
jest.spyOn(Math, 'random').mockReturnValue(0.4);
```

## 14. Discord.js Anti-patterns ❌ (NEW!)

### Problem: Real Discord objects
```javascript
// ❌ BAD
const client = new Client();
message.channel.send('test');
```

### Solution: Use mocks
```javascript
// ✅ GOOD
const client = createMockClient();
message.channel.send.mockResolvedValue();
```

## 15. Test Data Anti-patterns ⚠️ (NEW!)

### Problem: Lazy test data
```javascript
// ❌ BAD
{ id: '123', name: 'personality1' }
{ test: 'test' }
```

### Solution: Realistic test data
```javascript
// ✅ GOOD
{ id: '123456789012345678', name: 'TestAssistant' }
{ username: 'TestUser', content: 'Hello, world!' }
```

## 16. Assertion Anti-patterns ❌ (NEW!)

### Problem: Meaningless assertions
```javascript
// ❌ BAD
expect(true).toBe(true);
expect(func).toBeDefined();
expect(func).toBe(func);
```

### Solution: Test behavior
```javascript
// ✅ GOOD
expect(result).toBe(expectedValue);
expect(func()).toReturn(expected);
```

## 17. Import Anti-patterns ❌ (NEW!)

### Problem: Importing real modules
```javascript
// ❌ BAD
const realModule = require('../../../src/heavyModule');
```

### Solution: Mock imports
```javascript
// ✅ GOOD
jest.mock('../../../src/heavyModule');
const mockModule = require('../../../src/heavyModule');
```

## Severity Levels

- **❌ Error**: Must fix before committing
- **⚠️ Warning**: Should fix (may become errors later)
- **ℹ️ Info**: Good to fix for code quality

## Running the Checker

```bash
# Check all test files
node scripts/check-test-antipatterns.js

# Check specific files
node scripts/check-test-antipatterns.js tests/unit/mytest.test.js

# Automatically runs on pre-commit for staged test files
```

## Key Principles

1. **Test behavior, not implementation**
2. **Mock all external dependencies**
3. **Keep tests deterministic**
4. **Clean up after each test**
5. **Use meaningful test data**
6. **Write assertions that can fail**

By avoiding these anti-patterns, our tests will be:
- ✅ Fast (no real I/O or timers)
- ✅ Reliable (no flaky failures)
- ✅ Maintainable (test behavior, not internals)
- ✅ Clear (meaningful data and assertions)