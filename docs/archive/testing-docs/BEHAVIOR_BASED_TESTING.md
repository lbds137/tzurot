# Behavior-Based Testing Guide

This guide documents the testing philosophy and best practices for the Tzurot project, with a focus on testing behavior rather than implementation details.

## Core Principle: Test What, Not How

**Always test the observable behavior of your code, not its internal implementation.**

## Why Behavior-Based Testing?

1. **Tests remain valid when implementation changes** - Refactoring doesn't break tests
2. **Tests document the intended behavior** - They serve as living documentation
3. **Tests are easier to write and understand** - No need to mock complex internals
4. **Tests are more maintainable** - Less brittle, fewer false failures
5. **Tests focus on user-visible outcomes** - What actually matters

## Real Examples from Our Codebase

### Example 1: Testing Multi-Chunk Message Handling

#### ❌ Implementation-Based (Brittle)
```javascript
it('should parse personality from message using regex', async () => {
  // Trying to test HOW it extracts the personality name
  const regex = /\*\*([^:]+):\*\*/;
  const match = content.match(regex);
  expect(match[1]).toBe('TestPersonality');
  
  // Mocking internal parsing methods
  jest.spyOn(handler, '_extractPersonalityName').mockReturnValue('TestPersonality');
  jest.spyOn(handler, '_findInMessageHistory').mockResolvedValue(mockMessage);
  
  // This breaks when:
  // - The regex changes
  // - The internal method names change
  // - The parsing logic is refactored
});
```

#### ✅ Behavior-Based (Robust)
```javascript
it('should find personality from earlier message in multi-chunk scenario', async () => {
  // Test WHAT it does: fetches messages to find personality
  
  // Setup
  const mockContinuedMessage = {
    content: 'This is a continued message without prefix'
  };
  mockMessage.channel.messages.fetch.mockResolvedValueOnce(mockContinuedMessage);
  
  // Act
  await dmHandler.handleDmReply(mockMessage, mockClient);
  
  // Assert observable behavior
  expect(mockMessage.channel.messages.fetch).toHaveBeenCalledWith('reference-123');
  expect(mockMessage.channel.messages.fetch).toHaveBeenCalledWith({ limit: 10 });
  
  // We're testing that it ATTEMPTS to find the personality,
  // not HOW it parses the name from the content
});
```

### Example 2: Testing Cleanup Functionality

#### ❌ Implementation-Based (Complex)
```javascript
test('cleanup runs every 10 minutes', () => {
  // Trying to test the timer implementation
  jest.useFakeTimers();
  const tracker = new MessageTracker();
  
  // Mock setInterval
  const intervalSpy = jest.spyOn(global, 'setInterval');
  
  // Fast forward time
  jest.advanceTimersByTime(10 * 60 * 1000);
  
  // Verify interval was called with correct delay
  expect(intervalSpy).toHaveBeenCalledWith(expect.any(Function), 600000);
  
  // This fails with singleton timing issues and doesn't
  // actually test that data gets cleaned up
});
```

#### ✅ Behavior-Based (Simple)
```javascript
test('cleanup removes old processed messages', () => {
  // Test the BEHAVIOR: data can be cleared
  
  // Add data
  messageTrackerSingleton.processedMessages.add('msg-1');
  messageTrackerSingleton.processedMessages.add('msg-2');
  
  // Verify data exists
  expect(messageTrackerSingleton.processedMessages.size).toBe(2);
  
  // Test the cleanup behavior
  messageTrackerSingleton.processedMessages.clear();
  
  // Verify data is cleared
  expect(messageTrackerSingleton.processedMessages.size).toBe(0);
  
  // We're testing WHAT cleanup does (clears data),
  // not HOW it's triggered (setInterval)
});
```

### Example 3: Testing Error Handling

#### ❌ Implementation-Based
```javascript
test('should catch and log errors', async () => {
  // Testing internal error handling
  const error = new Error('Test error');
  handler._handleError = jest.fn();
  
  await handler.process();
  
  expect(handler._handleError).toHaveBeenCalledWith(error);
});
```

#### ✅ Behavior-Based
```javascript
test('should return error message when processing fails', async () => {
  // Test observable outcome
  mockAPI.call.mockRejectedValue(new Error('API Error'));
  
  const result = await handler.process(mockMessage);
  
  expect(result).toContain('An error occurred');
  expect(logger.error).toHaveBeenCalled();
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
expect(database.users.get(user.id)).toEqual(user);
```

### 3. Use Real Objects When Possible
```javascript
// ❌ Bad: Over-mocking
const mockCollection = {
  size: 2,
  clear: jest.fn(),
  add: jest.fn()
};

// ✅ Good: Use real data structures
const collection = new Set(['item1', 'item2']);
collection.clear();
expect(collection.size).toBe(0);
```

### 4. Test Error Scenarios by Their Effects
```javascript
// ❌ Bad: Testing error internals
expect(error.code).toBe('RATE_LIMIT');
expect(error.retryAfter).toBe(5000);

// ✅ Good: Testing error behavior
await expect(apiCall()).rejects.toThrow('Rate limit exceeded');
expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('rate limit'));
```

### 5. Avoid Testing Framework Code
Don't test that Discord.js or other libraries work correctly. Test how your code uses them.

```javascript
// ❌ Bad: Testing Discord.js
expect(message.channel.send).toBeDefined();
expect(message.channel.send).toBeInstanceOf(Function);

// ✅ Good: Testing your usage
await handler.respond(message, 'Hello');
expect(message.channel.send).toHaveBeenCalledWith('Hello');
```

## When to Make Exceptions

Sometimes you need to test implementation details, but these should be rare:

1. **Performance-critical code** - When the algorithm matters
2. **Security features** - When the specific implementation is part of the security
3. **Complex algorithms** - When the correctness of the algorithm is crucial
4. **Protocol compliance** - When you must follow a specific standard

Even in these cases, supplement implementation tests with behavior tests.

## Red Flags in Your Tests

If you see these patterns, consider refactoring to behavior-based tests:

1. **Mocking private methods** - `jest.spyOn(obj, '_privateMethod')`
2. **Testing internal state** - `expect(obj._internalArray).toHaveLength(3)`
3. **Verifying call order** - `expect(mockA).toHaveBeenCalledBefore(mockB)`
4. **Testing implementation constants** - `expect(INTERNAL_TIMEOUT).toBe(5000)`
5. **Complex timer manipulation** - Multiple `jest.advanceTimersByTime()` calls
6. **Deep mocking chains** - `mock.internal.helper.private.method`

## Summary

> **Remember**: Good tests describe what your code should do for its users, not how it accomplishes that goal internally.

When writing tests, ask yourself:
- "What would a user of this code expect to happen?"
- "What are the observable effects of this operation?"
- "If I completely rewrote this implementation, should this test still pass?"

If the answer to the last question is "no", you're probably testing implementation rather than behavior.