# Test Philosophy and Patterns Guide

This guide consolidates our testing philosophy, patterns, and anti-patterns into a single comprehensive resource.

## Table of Contents
1. [Core Testing Philosophy](#core-testing-philosophy)
2. [Behavior-Based Testing](#behavior-based-testing)
3. [Anti-Pattern Reference](#anti-pattern-reference)
4. [Best Practices](#best-practices)
5. [Case Studies](#case-studies)
6. [Quick Reference](#quick-reference)

## Core Testing Philosophy

### Fundamental Principle: Test What, Not How

**Always test the observable behavior of your code, not its internal implementation.**

### Why This Matters

1. **Tests remain valid when implementation changes** - Refactoring doesn't break tests
2. **Tests document the intended behavior** - They serve as living documentation
3. **Tests are easier to write and understand** - No need to mock complex internals
4. **Tests are more maintainable** - Less brittle, fewer false failures
5. **Tests focus on user-visible outcomes** - What actually matters

### Key Questions to Ask

When writing tests, ask yourself:
- "What would a user of this code expect to happen?"
- "What are the observable effects of this operation?"
- "If I completely rewrote this implementation, should this test still pass?"

If the answer to the last question is "no", you're probably testing implementation rather than behavior.

## Behavior-Based Testing

### Real Examples from Our Codebase

#### Example 1: Testing Message Handling

**❌ Implementation-Based (Brittle)**
```javascript
it('should parse personality from message using regex', async () => {
  // Trying to test HOW it extracts the personality name
  const regex = /\*\*([^:]+):\*\*/;
  const match = content.match(regex);
  expect(match[1]).toBe('TestPersonality');
  
  // Mocking internal parsing methods
  jest.spyOn(handler, '_extractPersonalityName').mockReturnValue('TestPersonality');
  jest.spyOn(handler, '_findInMessageHistory').mockResolvedValue(mockMessage);
});
```

**✅ Behavior-Based (Robust)**
```javascript
it('should handle replies to personality messages', async () => {
  // Test WHAT it does: handles the reply correctly
  
  const result = await dmHandler.handleDmReply(mockMessage, mockClient);
  
  // Assert observable behavior
  expect(result).toBe(true);
  expect(personalityHandler.handlePersonalityInteraction).toHaveBeenCalledWith(
    mockMessage,
    mockPersonality,
    null,
    mockClient
  );
});
```

#### Example 2: Testing Data Cleanup

**❌ Implementation-Based (Complex)**
```javascript
test('cleanup runs every 10 minutes', () => {
  jest.useFakeTimers();
  const tracker = new MessageTracker();
  
  // Mock setInterval and verify timing
  const intervalSpy = jest.spyOn(global, 'setInterval');
  jest.advanceTimersByTime(10 * 60 * 1000);
  
  expect(intervalSpy).toHaveBeenCalledWith(expect.any(Function), 600000);
});
```

**✅ Behavior-Based (Simple)**
```javascript
test('cleanup removes old processed messages', () => {
  // Test the BEHAVIOR: old data gets removed
  
  tracker.addMessage('msg-1', { timestamp: oldTimestamp });
  tracker.addMessage('msg-2', { timestamp: recentTimestamp });
  
  tracker.cleanup();
  
  expect(tracker.hasMessage('msg-1')).toBe(false); // Old message removed
  expect(tracker.hasMessage('msg-2')).toBe(true);  // Recent message kept
});
```

#### Example 3: Testing Error Handling

**❌ Implementation-Based**
```javascript
test('should catch and log errors', async () => {
  const error = new Error('Test error');
  handler._handleError = jest.fn();
  
  await handler.process();
  
  expect(handler._handleError).toHaveBeenCalledWith(error);
});
```

**✅ Behavior-Based**
```javascript
test('should return error message when processing fails', async () => {
  mockAPI.call.mockRejectedValue(new Error('API Error'));
  
  const result = await handler.process(mockMessage);
  
  expect(result).toContain('An error occurred');
  expect(logger.error).toHaveBeenCalled();
});
```

## Anti-Pattern Reference

### 🚫 Critical Anti-patterns (Test Failures)

#### 1. Real Timeouts
```javascript
// ❌ NEVER DO THIS
await new Promise(resolve => setTimeout(resolve, 5000));

// ✅ DO THIS
jest.useFakeTimers();
jest.advanceTimersByTime(5000);
```

#### 2. Missing Await
```javascript
// ❌ NEVER DO THIS
expect(asyncFunc()).resolves.toBe(true);

// ✅ DO THIS
await expect(asyncFunc()).resolves.toBe(true);
```

#### 3. Test Focus (.only, .skip)
```javascript
// ❌ NEVER COMMIT
it.only('should work', () => {});
it.skip('broken test', () => {});

// ✅ FIX OR REMOVE
it('should work', () => {});
```

#### 4. Real Network Calls
```javascript
// ❌ NEVER DO THIS
await fetch('https://api.example.com');

// ✅ DO THIS
jest.mock('node-fetch');
fetchMock.mockResolvedValue({ data: 'test' });
```

### ⚠️ Quality Anti-patterns (Code Smells)

#### 5. Implementation Testing
```javascript
// ❌ AVOID
expect(handler._privateMethod).toHaveBeenCalled();
expect(obj._internalState).toBe('processing');

// ✅ PREFER
expect(handler.getStatus()).toBe('processing');
```

#### 6. Over-Mocking
```javascript
// ❌ AVOID
const mockSet = {
  add: jest.fn(),
  has: jest.fn().mockReturnValue(true),
  size: 2
};

// ✅ PREFER
const realSet = new Set(['item1', 'item2']);
```

#### 7. Unmocked Console
```javascript
// ❌ AVOID
console.log('Debug info');

// ✅ ALWAYS MOCK
beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation();
  jest.spyOn(console, 'error').mockImplementation();
});
```

#### 8. Real User Data
```javascript
// ❌ AVOID
const email = 'john.doe@gmail.com';
const username = '@realuser';

// ✅ USE GENERIC
const email = 'test@example.com';
const username = '@TestUser';
```

### 🔧 Structural Anti-patterns

#### 9. Missing Cleanup
```javascript
// ❌ AVOID
jest.mock('../module');
const interval = setInterval(() => {}, 1000);

// ✅ ALWAYS CLEAN UP
afterEach(() => {
  jest.clearAllMocks();
  jest.resetModules();
  clearInterval(interval);
});
```

#### 10. Shared State
```javascript
// ❌ AVOID
let cache = {};
it('test 1', () => { cache.value = 1; });
it('test 2', () => { expect(cache.value).toBe(1); }); // Depends on test 1!

// ✅ ISOLATE TESTS
describe('cache tests', () => {
  let cache;
  beforeEach(() => { cache = {}; });
  
  it('test 1', () => { cache.value = 1; expect(cache.value).toBe(1); });
  it('test 2', () => { expect(cache.value).toBeUndefined(); });
});
```

## Best Practices

### 1. Focus on Public APIs
Test the methods that other parts of the code use, not private helper functions.

### 2. Test Outcomes, Not Steps
```javascript
// ❌ Bad: Testing steps
expect(fetchUserData).toHaveBeenCalled();
expect(validateUser).toHaveBeenCalled();
expect(saveToDatabase).toHaveBeenCalled();

// ✅ Good: Testing outcome
const user = await createUser(userData);
expect(user.id).toBeDefined();
expect(await getUser(user.id)).toEqual(user);
```

### 3. Use Real Objects When Possible
```javascript
// ❌ Bad: Over-mocking
const mockCollection = {
  size: jest.fn().mockReturnValue(2),
  clear: jest.fn()
};

// ✅ Good: Real data structures
const collection = new Set(['item1', 'item2']);
collection.clear();
expect(collection.size).toBe(0);
```

### 4. Test Error Scenarios by Effects
```javascript
// ❌ Bad: Testing error internals
expect(error.code).toBe('RATE_LIMIT');
expect(error.retryAfter).toBe(5000);

// ✅ Good: Testing error behavior
await expect(apiCall()).rejects.toThrow('Rate limit exceeded');
expect(mockMessage.reply).toHaveBeenCalledWith(
  expect.stringContaining('Please try again')
);
```

## Case Studies

### Case Study 1: The getAllReleases Bug

**Problem**: Tests passed but production failed because we mocked a non-existent method.

**Root Cause**: Over-mocking led to testing our mocks instead of the real API.

```javascript
// ❌ What we tested
const mockClient = {
  getAllReleases: jest.fn() // This method doesn't exist!
};

// ✅ What we should have tested
const { modules } = require('../../__mocks__');
const mockClient = modules.createGitHubClient(); // Real interface
```

**Lesson**: Always verify mocked methods exist on the real object.

### Case Study 2: The Timer Singleton Issue

**Problem**: Tests with timers were slow and flaky.

**Root Cause**: Singletons created during import couldn't use injectable timers.

```javascript
// ❌ The problematic code
const tracker = new MessageTracker(); // Executes on import!
module.exports = tracker;

// ✅ The solution
module.exports = {
  create: (deps) => new MessageTracker(deps)
};
```

**Lesson**: Never execute code during module import.

## Quick Reference

### Testing Checklist
- [ ] Tests pass when implementation changes but behavior stays the same
- [ ] No private methods or internal state being tested
- [ ] Using real objects instead of mocks where practical
- [ ] All async operations are awaited
- [ ] Console is mocked in beforeEach
- [ ] Cleanup in afterEach (mocks, timers, listeners)
- [ ] No real timeouts or network calls
- [ ] No .only() or .skip() in committed code
- [ ] Generic test data (no real emails/usernames)
- [ ] Tests are isolated (no shared state)

### Red Flags in Your Tests
If you see these patterns, consider refactoring:

1. **Mocking private methods**: `jest.spyOn(obj, '_privateMethod')`
2. **Testing internal state**: `expect(obj._internalArray).toHaveLength(3)`
3. **Verifying call order**: `expect(mockA).toHaveBeenCalledBefore(mockB)`
4. **Testing constants**: `expect(INTERNAL_TIMEOUT).toBe(5000)`
5. **Complex timer manipulation**: Multiple `jest.advanceTimersByTime()` calls
6. **Deep mock chains**: `mock.internal.helper.private.method`
7. **Brittle assertions**: `expect(mock.mock.calls[0][1]).toBe('value')`

### When to Make Exceptions
Sometimes you need to test implementation details, but these should be rare:

1. **Performance-critical code** - When the algorithm matters
2. **Security features** - When the implementation is part of the security
3. **Complex algorithms** - When correctness of the algorithm is crucial
4. **Protocol compliance** - When you must follow a specific standard

Even in these cases, supplement implementation tests with behavior tests.

---

> **Remember**: Good tests describe what your code should do for its users, not how it accomplishes that goal internally.