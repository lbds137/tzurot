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

## Running Tests

### Running All Tests
```bash
npm test                    # Run all tests with coverage
npm run test:watch         # Run tests in watch mode during development
```

### Running Specific Tests
```bash
npx jest tests/unit/bot.test.js                    # Run a specific test file
npx jest tests/unit/commands/                       # Run all tests in a directory
npx jest --testNamePattern="should handle errors"   # Run tests matching a pattern
npx jest --watch tests/unit/bot.test.js           # Watch a specific file
```

## Debugging Tests

### Common Test Issues and Solutions

1. **Mock Not Working**
   ```javascript
   // Problem: Mock not being called
   // Solution: Ensure mock is set up before importing the module
   jest.mock('../../src/logger');
   const logger = require('../../src/logger');
   const componentToTest = require('../../src/component');
   ```

2. **Async Test Timeout**
   ```javascript
   // Problem: Test times out
   // Solution: Increase timeout for slow operations
   it('should handle slow operation', async () => {
     await someSlowOperation();
   }, 10000); // 10 second timeout
   ```

3. **Test Interference**
   ```javascript
   // Problem: Tests pass individually but fail together
   // Solution: Reset all mocks and state between tests
   beforeEach(() => {
     jest.clearAllMocks();
     jest.resetModules();
   });
   ```

4. **Debugging with console.log**
   ```javascript
   // Temporarily bypass console mocking for debugging
   beforeEach(() => {
     global.console.log = console.log; // Restore real console.log
   });
   ```

### Using Jest Debug Mode
```bash
# Run Jest with Node debugger
node --inspect-brk node_modules/.bin/jest --runInBand tests/unit/bot.test.js

# Then attach your debugger (VS Code, Chrome DevTools, etc.)
```

## Test Types

### Unit Tests
- Test individual functions or components in isolation
- Mock all external dependencies
- Located in `tests/unit/`
- Fast execution, focused on specific logic

### Integration Tests
- Test multiple components working together
- May use fewer mocks
- Test real interactions between modules
- Slower but more comprehensive

### When to Use Each Type
- **Unit Tests**: For testing business logic, utilities, and individual functions
- **Integration Tests**: For testing command flows, API interactions, and complex workflows

## Coverage Requirements

- Maintain or improve existing test coverage
- Focus on testing edge cases and error handling
- Use the jest.spyOn approach for verifying function calls
- Aim for:
  - 80%+ coverage for new code
  - 70%+ coverage for critical components
  - 100% coverage for utility functions