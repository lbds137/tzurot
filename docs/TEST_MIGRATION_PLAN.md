# Test Migration Plan

This document outlines the steps to migrate legacy command tests to the new standardized test structure.

## Current State

We have two types of command tests:

1. **Old tests** in the root `tests/unit/` directory (e.g., `commands.alias.test.js`)
2. **New tests** in the module-specific structure (e.g., `tests/unit/commands/handlers/alias.test.js`)

The tests need to be consolidated to use the new structure and patterns.

## Migration Process

For each command test that needs to be migrated:

1. Check if there's already a test in the new structure
   - If yes, compare the coverage to ensure nothing is lost
   - If no, create a new test file in the appropriate location

2. Review the old test to understand its coverage
   - Identify core functionality being tested
   - Note any edge cases or specific behaviors
   - List all mocks and assertions

3. Create or update the test in the new structure
   - Use the standardized patterns and helper functions
   - Ensure all original functionality is tested
   - Add any missing test cases

4. Run the new test to verify it works
   - Fix any failing tests
   - Ensure at least the same level of coverage

5. Keep both versions temporarily
   - Verify both pass and provide similar coverage
   - Document any differences or improvements

6. Eventually remove the old tests
   - Once all tests for a command are migrated
   - After thorough testing and validation

## Test Structure Pattern

New tests should follow this structure:

```javascript
// 1. Mock dependencies
jest.mock('discord.js');
jest.mock('../../../../src/logger');
jest.mock('../../../../config', () => ({
  botPrefix: '!tz'
}));

// 2. Import the test helpers
const helpers = require('../../../utils/commandTestHelpers');

// 3. Import and mock dependencies
const { EmbedBuilder } = require('discord.js');
const logger = require('../../../../src/logger');

// 4. Mock logger functions
logger.info = jest.fn();
logger.debug = jest.fn();
logger.error = jest.fn();

describe('Command Name Handler', () => {
  // 5. Setup module mocks before requiring the module
  let mockMessage;
  let mockDirectSend;
  let dependencies;
  let commandModule;
  
  beforeEach(() => {
    // 6. Reset modules between tests
    jest.resetModules();
    jest.clearAllMocks();
    
    // 7. Setup dependency mocks
    jest.doMock('path/to/dependency', () => ({
      // Mock implementation
    }));
    
    // 8. Create mock message
    mockMessage = helpers.createMockMessage();
    mockMessage.channel.send = jest.fn().mockResolvedValue({
      id: 'sent-message-123'
    });
    
    // 9. Setup directSend mock
    mockDirectSend = jest.fn().mockImplementation(content => {
      return mockMessage.channel.send(content);
    });
    
    // 10. Import and set up dependencies after mocking
    dependencies = require('path/to/dependency');
    validator = require('../../../../src/commands/utils/commandValidator');
    validator.createDirectSend.mockReturnValue(mockDirectSend);
    
    // 11. Import the command module after all mocks are set up
    commandModule = require('path/to/command/module');
  });
  
  // 12. Test metadata
  test('should have the correct metadata', () => {
    expect(commandModule.meta).toEqual({
      name: 'commandname',
      description: expect.any(String),
      usage: expect.any(String),
      aliases: expect.any(Array),
      permissions: expect.any(Array)
    });
  });
  
  // 13. Test functionality
  test('should do something specific', async () => {
    // Setup test-specific mocks or state
    
    // Execute the command
    await commandModule.execute(mockMessage, ['arg1', 'arg2']);
    
    // Verify expected behaviors
    expect(dependencies.someFunction).toHaveBeenCalledWith('arg1');
    expect(mockMessage.channel.send).toHaveBeenCalledWith(
      expect.stringContaining('expected response')
    );
  });
})
```

## Tests to Migrate

The following tests need to be migrated to the new structure:

1. commands.alias.test.js → tests/unit/commands/handlers/alias.test.js (already done, needs verification)
2. commands.remove.test.js → tests/unit/commands/handlers/remove.test.js
3. commands.deactivate.test.js → tests/unit/commands/handlers/deactivate.test.js
4. commands.add.test.js → tests/unit/commands/handlers/add.test.js
5. commands.list.test.js → tests/unit/commands/handlers/list.test.js
6. commands.activate.test.js → tests/unit/commands/handlers/activate.test.js
7. commands.auth.test.js → tests/unit/commands/handlers/auth.test.js
8. commands.simulated.test.js → tests/unit/commands/utils/simulated.test.js
9. commands.aliases.test.js → tests/unit/commands/handlers/alias.test.js (consolidate)
10. commands.test.js → (distribute tests to appropriate handler test files)

## Priority

1. First, migrate tests for core commands (add, list, auth)
2. Then migrate tests for management commands (activate, deactivate, remove)
3. Finally, migrate tests for utility features (aliases, simulated)

## Verification

For each migrated test:

1. Run the old test and record its coverage
2. Run the new test and compare coverage
3. Verify that all test cases are preserved
4. Check for any edge cases that might be missed

Once all tests are migrated and verified, we can remove the old test files and consolidate the test documentation.

## Documentation

After migration, update the following documents:

1. COMMAND_TEST_STATUS.md - Update with latest progress
2. TEST_STANDARDIZATION.md - Add any new patterns discovered during migration
3. COMMAND_REFACTORING_SUMMARY.md - Note completion of test migration