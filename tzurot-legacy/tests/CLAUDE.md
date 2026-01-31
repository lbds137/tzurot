# Testing Guidelines

This CLAUDE.md file provides guidance for working with and creating tests for Tzurot.

## MCP Integration for Testing

### High-Value MCP Usage for Tests

1. **Edge Case Discovery**
   ```javascript
   mcp__gemini-collab__gemini_test_cases({
     code_or_feature: "Message deduplication with race conditions",
     test_type: "edge cases"
   })
   ```

2. **Test Coverage Gaps**
   ```javascript
   mcp__gemini-collab__gemini_brainstorm({
     topic: "Test scenarios for webhook rate limiting with concurrent requests",
     constraints: "Must use fake timers, test observable behavior only"
   })
   ```

3. **Mock Verification**
   ```javascript
   mcp__gemini-collab__gemini_code_review({
     code: testCode,
     focus: "Mock usage and test isolation",
     language: "javascript"
   })
   ```

### When to Consult MCP for Tests
- Complex async flows with multiple promises
- Race condition testing strategies
- Security-sensitive test scenarios
- Performance test design
- Mock isolation verification

## 🚨 CRITICAL: Test Philosophy

**Always test BEHAVIOR, not IMPLEMENTATION. If you're testing private methods, mock internals, or exact call counts, you're doing it wrong.**

## Testing Framework & Performance

- Jest is used as the testing framework
- Tests MUST run in < 30 seconds total (currently ~14s)
- Individual test files MUST run in < 5 seconds
- Global mocks are loaded from `tests/setup-global-mocks.js`
- ALWAYS use fake timers - real delays will fail PR checks

## Test Organization

- `tests/unit/` - Unit tests for individual components
- `tests/__mocks__/` - Consolidated mock system (USE THESE!)
- `tests/mocks/` - Legacy mocks (being phased out)
- `tests/helpers/` - Test utilities and helpers
- `tests/setup.js` - Global test setup
- `tests/setup-global-mocks.js` - Performance-critical global mocks

## Test File Naming

- Test files MUST match the source file with a `.test.js` suffix
- Specialized tests can use descriptive names like `aiService.error.test.js`
- Keep test files in the same relative path as source files

## 🚨 Mock Pattern Enforcement (CRITICAL UPDATE)

### ⚠️ CURRENT STATE WARNING
- Only ~5% of tests use the consolidated mock system
- This led directly to the `getAllReleases` production bug
- **NEW RULE**: All new tests MUST verify mocked methods exist

### Required for All New Tests

1. **Use Consolidated Mocks** (preferred):
   ```javascript
   const { presets } = require('../../__mocks__');
   const mockEnv = presets.commandTest();
   const message = mockEnv.discord.createMessage();
   ```

2. **Migration Helper** (for updates):
   ```javascript
   const { createMigrationHelper } = require('../../../utils/testEnhancements');
   const migrationHelper = createMigrationHelper();
   const mockMessage = migrationHelper.bridge.createCompatibleMockMessage();
   ```

3. **NEVER Create Ad-hoc Mocks**:
   ```javascript
   // ❌ THIS CAUSED THE getAllReleases BUG!
   const mockClient = {
     getAllReleases: jest.fn(), // Method doesn't exist!
   };
   
   // ✅ USE CONSOLIDATED MOCKS OR VERIFY METHODS
   const { modules } = require('../../__mocks__');
   const mockClient = modules.createGitHubClient(); // Safe!
   ```

### Patterns That Will FAIL Enforcement
- ❌ `jest.doMock()` - Deprecated, use standard mocks
- ❌ `helpers.createMockMessage()` - Use migration helper instead
- ❌ `require('mockFactories')` - Use consolidated mocks
- ❌ `jest.resetModules()` - Breaks imports, use `jest.clearAllMocks()`

### Enforcement Active In:
- **Pre-commit hooks** - Blocks commits with violations
- **npm run lint:test-mocks** - Manual check all files
- **CI/CD pipeline** - Blocks PRs with violations

See `docs/testing/MOCK_SYSTEM_GUIDE.md` for complete rules.

## 🏕️ The Boy Scout Rule

**When touching ANY test file, leave it better than you found it:**

1. **Fix your immediate task** (required)
2. **Migrate at least ONE other test** to consolidated mocks (expected)
3. **Track progress** in commit messages (e.g., "Mock migration: 9/133 files")

Why? We're at 5% migration. Without active improvement, we'll keep hitting bugs like `getAllReleases`.

Example:
```javascript
// While fixing a test, also migrate another one in the same file:
// ❌ OLD TEST (unmigrated)
const mockManager = {
  someMethod: jest.fn()
};

// ✅ MIGRATED TEST
const { modules } = require('../../__mocks__');
const mockManager = modules.createSomeManager();
```

## Proper Test Structure (Copy This!)

```javascript
// ALWAYS mock before imports
jest.mock('../../src/dependency');
jest.mock('../../src/externalService');

// Import mocks and component
const { functionToTest } = require('../../src/someModule');
const dependency = require('../../src/dependency');

describe('Component Name', () => {
  // Required setup
  beforeEach(() => {
    // ALWAYS reset mocks
    jest.clearAllMocks();
    jest.resetModules();
    
    // ALWAYS use fake timers
    jest.useFakeTimers();
    
    // ALWAYS mock console
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('specific method or feature', () => {
    it('should describe the expected BEHAVIOR', async () => {
      // Arrange - set up test data
      const input = { id: '123456789012345678', name: 'TestUser' };
      dependency.someMethod.mockResolvedValue({ success: true });
      
      // Act - call the function
      const result = await functionToTest(input);
      
      // Assert - test OUTCOMES not implementation
      expect(result).toEqual({ status: 'completed' });
      expect(dependency.someMethod).toHaveBeenCalledWith(
        expect.objectContaining({ id: input.id })
      );
    });
    
    it('should handle errors gracefully', async () => {
      // Arrange
      dependency.someMethod.mockRejectedValue(new Error('API Error'));
      
      // Act & Assert - test user-visible error
      await expect(functionToTest({})).rejects.toThrow('Something went wrong');
    });
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

## 🚫 Critical Anti-patterns (Will Fail PR!)

Our automated checks will REJECT your PR if you:

### 1. Use Real Timers
```javascript
// ❌ NEVER DO THIS
await new Promise(resolve => setTimeout(resolve, 1000));

// ✅ DO THIS
jest.useFakeTimers();
await act(async () => {
  jest.advanceTimersByTime(1000);
});
```

### 2. Test Implementation Details
```javascript
// ❌ NEVER DO THIS
expect(handler._privateMethod).toHaveBeenCalled();
expect(mock.mock.calls[0][1]).toBe('internal');

// ✅ DO THIS
expect(result.visibleOutcome).toBe('expected');
```

### 3. Import Without Mocking
```javascript
// ❌ NEVER DO THIS
const realModule = require('../../src/heavyModule');

// ✅ DO THIS
jest.mock('../../src/heavyModule');
const mockModule = require('../../src/heavyModule');
```

### 4. Skip or .only Tests
```javascript
// ❌ NEVER DO THIS
it.skip('broken test', () => {});
it.only('debugging', () => {});

// ✅ FIX THE TEST OR REMOVE IT
```

## Quality Enforcement

### Pre-commit Checks
- Timer pattern violations
- Test anti-patterns
- ESLint errors
- Test failures in changed files

### Available Scripts
```bash
# Check for test anti-patterns
node scripts/check-test-antipatterns.js

# Check for timer issues
node scripts/check-timer-patterns.js

# Analyze test performance
node scripts/comprehensive-test-timing-analysis.js

# Run quality checks
npm run quality
```

## Coverage Requirements

- Maintain or improve existing test coverage
- Focus on testing edge cases and error handling
- Current target: Tests run in < 30 seconds
- Aim for:
  - 80%+ coverage for new code
  - 70%+ coverage for critical components
  - 100% coverage for utility functions

## Discord.js Specific Testing

### Always Use Mock Factories
```javascript
const { createMockClient, createMockMessage } = require('../__mocks__/discord.js');

const mockMessage = createMockMessage({
  content: '!tz test',
  author: { id: '123456789012345678', username: 'TestUser' },
  channel: { id: '987654321098765432' }
});
```

### Mock Webhook Responses
```javascript
const mockWebhook = {
  send: jest.fn().mockResolvedValue({ id: 'message-id' }),
  edit: jest.fn().mockResolvedValue({}),
  delete: jest.fn().mockResolvedValue({})
};
```

## Performance Tips

1. **Use Global Mocks**: Already loaded in setup-global-mocks.js
2. **Avoid File I/O**: Mock all fs operations
3. **Mock Network Calls**: Never make real HTTP requests
4. **Use Fake Timers**: Real timers slow tests dramatically
5. **Batch Test Data**: Create reusable test fixtures

## Debugging Slow Tests

```bash
# Identify slow tests
node scripts/identify-slow-tests.js

# Check for unmocked imports
node scripts/comprehensive-test-timing-analysis.js
```

## Final Checklist

Before submitting your test:
- [ ] Uses fake timers for ALL delays
- [ ] Mocks ALL external dependencies
- [ ] Tests behavior, not implementation
- [ ] Runs in < 500ms
- [ ] No .skip() or .only()
- [ ] Uses realistic test data
- [ ] Handles both success and error cases
- [ ] Cleans up in afterEach()