# Testing Guidelines

This CLAUDE.md file provides guidance for working with and creating tests for Tzurot.

## Testing Framework

- Jest is used as the testing framework
- Tests are organized in a directory structure matching the source code
- Mocks are used extensively to isolate components for testing

## Test Organization

- `tests/unit/` - Unit tests for individual components
- `tests/mocks/` - Custom mocks for Discord.js and other dependencies
- `tests/__mocks__/` - Jest mocks for npm packages

## Test File Naming

- Test files should match the source file with a `.test.js` suffix
- Specialized tests can use descriptive names like `aiService.error.test.js`

## Test Structure

```javascript
// Require the component to test
const { functionToTest } = require('../../src/someModule');

// Mock dependencies
jest.mock('../../src/dependency');

describe('Component Name', () => {
  // Setup before each test
  beforeEach(() => {
    // Reset mocks and state
    jest.clearAllMocks();
  });

  // Individual test cases
  it('should perform some specific action', () => {
    // Arrange - set up test data
    const testData = { /* ... */ };
    
    // Act - call the function
    const result = functionToTest(testData);
    
    // Assert - verify the result
    expect(result).toBe(expectedValue);
  });
  
  // Test error conditions
  it('should handle errors properly', () => {
    // Arrange - set up to cause an error
    const mockFunction = jest.fn().mockRejectedValue(new Error('Test error'));
    
    // Assert that it throws an error
    expect(async () => {
      await functionUsingMock();
    }).rejects.toThrow('Test error');
  });
});
```

## Test Mocks

IMPORTANT: Use the provided mocks when testing:

1. Discord.js mocks in `tests/mocks/discord.js.mock.js`
2. Profile fetcher mocks in `tests/mocks/profileInfoFetcher.mocks.js`
3. Node-fetch mocks in `tests/__mocks__/node-fetch.js`

Example mock usage:
```javascript
const { createMockClient, createMockMessage } = require('../mocks/discord.js.mock.js');

// Create a mock message
const message = createMockMessage({
  content: '!tz command arg1 arg2',
  author: { id: '123', tag: 'user#1234' }
});
```

## Testing Async Code

For testing asynchronous code:
```javascript
it('should handle async operations', async () => {
  // Use async/await with Jest
  const result = await asyncFunction();
  expect(result).toBe(expectedValue);
});
```

## Testing Commands

For testing commands, use the command test helpers:
```javascript
const { setupCommandTest } = require('../utils/commandTestHelpers');

describe('Command: example', () => {
  it('should process valid arguments', async () => {
    // Setup the command test environment
    const { command, message, mockReply } = setupCommandTest('example', ['arg1']);
    
    // Execute the command
    await command.execute(message, ['arg1']);
    
    // Verify the response
    expect(mockReply).toHaveBeenCalledWith(expect.stringContaining('Success'));
  });
});
```

## Coverage Requirements

- Maintain or improve existing test coverage
- Focus on testing edge cases and error handling
- Use the jest.spyOn approach for verifying function calls