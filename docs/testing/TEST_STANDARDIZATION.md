# Test Standardization Plan

This document outlines the plan for standardizing tests in the Tzurot Discord bot project, particularly focusing on command tests.

## Current State

The codebase currently has several test patterns:

1. Tests in the root `tests/unit` directory (e.g., `commands.*.test.js`)
2. Tests that have already been moved to a module-specific structure (e.g., `tests/unit/commands/activate.test.js`)
3. Tests that follow different patterns for mocking and asserting

## Target Structure

We're moving towards a more modular test structure that mirrors the source code:

```
tests/
  unit/
    commands/
      handlers/        - Command handler tests
      middleware/      - Middleware tests
      utils/           - Utility function tests
```

## Testing Issues

Key issues identified during the standardization process:

1. The command handlers have been refactored to use `validator.createDirectSend()` which returns a function, but many tests aren't properly mocking this function.
2. The new command structure uses a modular pattern that requires careful mock setup.
3. Existing tests are failing due to structural changes in the codebase.
4. The directSend mockup must be done at both the validator level and the utils level for tests to work correctly.

## Testing Approach

For new or migrated command handler tests:

1. **Mock setup**: Mock all dependencies before requiring the module
   ```javascript
   jest.mock('discord.js');
   jest.mock('../../../../src/logger');
   jest.mock('../../../../config', () => ({
     botPrefix: '!tz'
   }));
   jest.mock('../../../../src/personalityManager');
   jest.mock('../../../../src/conversationManager');
   // Other mocks as needed
   
   // Critical: Mock utils and commandValidator with implementations that correctly handle directSend
   jest.mock('../../../../src/utils', () => ({
     createDirectSend: jest.fn().mockImplementation((message) => {
       return async (content) => {
         return message.channel.send(content);
       };
     }),
     // Add other utility functions as needed
     validateAlias: jest.fn().mockReturnValue(true),
     cleanupTimeout: jest.fn(),
     safeToLowerCase: jest.fn(str => str ? str.toLowerCase() : ''),
     getAllAliasesForPersonality: jest.fn().mockReturnValue([])
   }));
   
   jest.mock('../../../../src/commands/utils/commandValidator', () => {
     return {
       createDirectSend: jest.fn().mockImplementation((message) => {
         return async (content) => {
           return message.channel.send(content);
         };
       }),
       // Add other validator functions as needed
       isAdmin: jest.fn().mockReturnValue(false),
       canManageMessages: jest.fn().mockReturnValue(false),
       isNsfwChannel: jest.fn().mockReturnValue(false),
       getPermissionErrorMessage: jest.fn().mockReturnValue('Permission error')
     };
   });
   ```

2. **Helper Import**: Use the test helpers
   ```javascript
   const helpers = require('../../../utils/commandTestHelpers');
   ```

3. **Mock Configuration**: In `beforeEach`:
   ```javascript
   // Create mock message with standard channel.send mock
   mockMessage = helpers.createMockMessage();
   mockMessage.channel.send = jest.fn().mockResolvedValue({
     id: 'sent-message-123',
     embeds: [{title: 'Command Response'}]
   });
   
   // Import command after setting up mocks
   commandModule = require('../../../../src/commands/handlers/commandName');
   ```

4. **Command Import**: Import the command after setting up all mocks
   ```javascript
   // Import the command after setting up mocks
   commandModule = require('../../../../src/commands/handlers/commandName');
   ```

5. **Testing Patterns**: Use consistent verification
   ```javascript
   // For success responses with channel.send
   expect(mockMessage.channel.send).toHaveBeenCalled();
   
   // For embed responses
   expect(mockMessage.channel.send).toHaveBeenCalledWith(
     expect.objectContaining({
       embeds: expect.arrayContaining([
         expect.objectContaining({
           title: 'Expected Title'
         })
       ])
     })
   );
   
   // For text responses
   expect(mockMessage.channel.send).toHaveBeenCalledWith(
     expect.stringContaining('expected message text')
   );
   
   // For error responses
   expect(mockMessage.channel.send).toHaveBeenCalledWith(
     expect.stringContaining('expected error message')
   );
   ```

## Migration Plan

1. **Create directory structure** (completed)
2. **Establish testing patterns** (completed)
3. **Fix common errors in tests**:
   - Ensure all tests follow the same mocking pattern
   - Fix the `directSend is not a function` error
   - Make tests work with the current codebase structure
4. **Gradual replacement**:
   - Keep old tests until new ones are verified to work
   - Run tests on both old and new implementations to ensure no functionality loss
   - Remove old tests only after new ones are working correctly

## Issues & Considerations

- The command.js file has been heavily refactored into a modular structure
- Tests created before this refactoring may have assumptions that no longer hold
- Some tests may need to be completely rewritten rather than just moved
- We may need to temporarily skip tests that can't be fixed quickly
- The key to fixing the tests is properly mocking both utils.createDirectSend and validator.createDirectSend
- Both mocks must return a function that delegates to message.channel.send

## Next Steps

1. Focus on fixing one test at a time
2. Start with critical commands: add, help, auth
3. Create a migration checklist for each file
4. Apply the directSend mocking pattern consistently across all tests
5. Document any patterns we discover to make future migrations easier

## Working Solution for DirectSend Mocking

The main challenge with the test refactoring has been properly mocking the directSend function. Here's the working solution:

1. Mock both src/utils.js and src/commands/utils/commandValidator.js to provide proper implementations of createDirectSend
2. Ensure mock functions return a function that delegates to message.channel.send
3. Mock message.channel.send for each test case to control the response
4. Update assertions to verify channel.send was called with the expected parameters

This approach solves the "directSend is not a function" error that was breaking tests.

## Advanced Mocking with doMock

When dealing with more complex test cases, use jest.doMock for better control over mocking:

```javascript
describe('Command Test', () => {
  // Setup module mocks before requiring the module
  let mockMessage;
  let personalityManager;
  let validator;
  let commandModule;
  
  beforeEach(() => {
    // Reset modules between tests
    jest.resetModules();
    jest.clearAllMocks();
    
    // Setup mocks
    jest.doMock('../../../../src/personalityManager', () => ({
      someFunction: jest.fn()
    }));
    
    jest.doMock('../../../../src/commands/utils/commandValidator', () => {
      return {
        createDirectSend: jest.fn()
      };
    });
    
    // Import modules after mocking
    personalityManager = require('../../../../src/personalityManager');
    validator = require('../../../../src/commands/utils/commandValidator');
    
    // Create mock message with standard channel.send mock
    mockMessage = helpers.createMockMessage();
    mockMessage.channel.send = jest.fn().mockResolvedValue({
      id: 'sent-message-123',
      embeds: [{title: 'Command Response'}]
    });
    
    // Setup directSend mock to use channel.send
    const mockDirectSend = jest.fn().mockImplementation(content => {
      return mockMessage.channel.send(content);
    });
    validator.createDirectSend.mockReturnValue(mockDirectSend);
    
    // Import the command after all mocks are setup
    commandModule = require('../../../../src/commands/handlers/commandName');
  });
  
  afterEach(() => {
    jest.resetModules();
  });
  
  // Tests go here
});
```

This pattern is especially useful for complex tests where you need more control over the mock implementations. It allows you to:

1. Reset modules completely between tests
2. Set up specific mock implementations per test
3. Control the import order to ensure mocks are properly set up
4. Override mock behaviors for specific test cases

## Working Example: ping.test.js

We've created a minimal working example for the ping command test that demonstrates the correct approach:

```javascript
// Mock dependencies before requiring the module
jest.mock('discord.js');
jest.mock('../../../../src/logger');
jest.mock('../../../../config', () => ({
  botPrefix: '!tz'
}));

// Mock utils and commandValidator
jest.mock('../../../../src/utils', () => ({
  createDirectSend: jest.fn().mockImplementation((message) => {
    return async (content) => {
      return message.channel.send(content);
    };
  })
}));

jest.mock('../../../../src/commands/utils/commandValidator', () => {
  return {
    createDirectSend: jest.fn().mockImplementation((message) => {
      return async (content) => {
        return message.channel.send(content);
      };
    })
  };
});

// Import test helpers
const helpers = require('../../../utils/commandTestHelpers');

// Import mocked modules
const logger = require('../../../../src/logger');
const validator = require('../../../../src/commands/utils/commandValidator');

describe('Ping Command', () => {
  let pingCommand;
  let mockMessage;
  
  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Create mock message with standard channel.send mock
    mockMessage = helpers.createMockMessage();
    mockMessage.channel.send = jest.fn().mockResolvedValue({
      id: 'sent-message-123',
      content: 'Pong! Tzurot is operational.'
    });
    
    // Import command module after mock setup
    pingCommand = require('../../../../src/commands/handlers/ping');
  });
  
  it('should reply with a pong message', async () => {
    const result = await pingCommand.execute(mockMessage, []);
    
    // Verify that createDirectSend was called with the message
    expect(validator.createDirectSend).toHaveBeenCalledWith(mockMessage);
    
    // Verify that channel.send was called with the correct message
    expect(mockMessage.channel.send).toHaveBeenCalledWith('Pong! Tzurot is operational.');
    
    // Verify the response matches our mock
    expect(result).toEqual({
      id: 'sent-message-123',
      content: 'Pong! Tzurot is operational.'
    });
  });
});
```

This test passes successfully and demonstrates the recommended pattern for testing command handlers with directSend.

## Handling DM Channels

When testing commands that need to handle direct message (DM) channels, you need to properly mock the channel behavior:

```javascript
// Create a DM channel mock message
const dmMockMessage = {
  ...helpers.createMockMessage(),
  channel: {
    send: jest.fn().mockResolvedValue({
      id: 'sent-message-123',
      embeds: [{title: 'Command Response'}]
    }),
    sendTyping: jest.fn().mockResolvedValue(true),
    isDMBased: jest.fn().mockReturnValue(true)  // This is the critical part
  }
};

// Ensure the mock directSend function is properly set up for the DM channel
const dmDirectSend = jest.fn().mockImplementation(content => {
  return dmMockMessage.channel.send(content);
});

validator.createDirectSend.mockImplementation((message) => {
  if (message === dmMockMessage) {
    return dmDirectSend;
  }
  return mockDirectSend;  // Use the regular mockDirectSend for non-DM messages
});
```

This allows you to test DM-specific behavior in your commands.

## Progress

So far, we have successfully standardized the following tests:
1. add.test.js
2. list.test.js 
3. ping.test.js
4. help.test.js
5. auth.test.js
6. miscHandlers.test.js
7. activate.test.js
8. deactivate.test.js
9. alias.test.js
10. remove.test.js
11. utils/embedsToBlock.test.js
12. utils/formatUptime.test.js
13. utils/messageTracker.test.js
14. status.test.js
15. autorespond.test.js
16. debug.test.js
17. verify.test.js
18. reset.test.js
19. info.test.js
20. clearerrors.test.js

With our recent additions, we have standardized tests for all command handlers in the `src/commands/handlers/` directory:
1. add.js
2. alias.js
3. auth.js
4. activate.js
5. autorespond.js
6. clearerrors.js
7. deactivate.js
8. debug.js
9. help.js
10. info.js
11. list.js
12. ping.js
13. remove.js
14. reset.js
15. status.js
16. verify.js

Additionally, we have created standardized tests for all middleware components:
1. auth.js - Tests authentication middleware
2. deduplication.js - Tests command deduplication middleware
3. permissions.js - Tests permission checking middleware

We have also standardized tests for command utility modules:
1. commandRegistry.js - Tests command registration and retrieval
2. commandValidator.js - Tests permission validation and error messages
3. commandLoader.js - Tests dynamic command loading functionality
4. messageTracker.js - Tests message and command tracking (existing)

### Key Learnings from Activate Test

When working with the `activate.test.js` standardization, we discovered some important patterns:

1. **EmbedBuilder Mocking**: The EmbedBuilder needs to be mocked per test for complex tests that create embeds, rather than using a global mock for the entire file:
   ```javascript
   // Within each test that uses an embed
   const mockEmbed = {
     setTitle: jest.fn().mockReturnThis(),
     setDescription: jest.fn().mockReturnThis(),
     setColor: jest.fn().mockReturnThis(),
     setFooter: jest.fn().mockReturnThis(),
     setThumbnail: jest.fn().mockReturnThis()
   };
   EmbedBuilder.mockReturnValue(mockEmbed);
   ```

2. **Simplified Assertions**: For tests that use embeds, it's more reliable to just verify that channel.send was called rather than checking the exact embed structure:
   ```javascript
   // Verify that channel.send was called (but not checking the exact content)
   expect(mockMessage.channel.send).toHaveBeenCalled();
   ```

3. **Channel.isDMBased Testing**: For tests that check whether a channel is a DM, use the helper's built-in isDM option:
   ```javascript
   const dmMockMessage = helpers.createMockMessage({isDM: true});
   ```

This approach helps ensure tests are more resilient to implementation details while still verifying the core functionality.

### Key Learnings from Deactivate Test

When standardizing the `deactivate.test.js` file, we discovered additional patterns:

1. **Logger Mocking**: When checking for error logging, ensure the logger is properly mocked at the top level:
   ```javascript
   // Mock logger functions
   logger.info = jest.fn();
   logger.debug = jest.fn();
   logger.error = jest.fn();
   ```

2. **Avoiding Over-Mocking**: Simplified the tests by removing unnecessary mocks of EmbedBuilder for tests where we don't need to validate the exact structure of the embed.

3. **Mock Clearing**: For tests that force specific errors, ensure all mocks are cleared before setting up specific behavior:
   ```javascript
   // Reset mocks to ensure clean state
   jest.clearAllMocks();
    
   // Force an error
   conversationManager.deactivatePersonality.mockImplementationOnce(() => {
     throw new Error('Test error');
   });
   ```

This helps ensure that tests are independent and don't influence each other.

### Key Learnings from Alias Test

When standardizing the `alias.test.js` file, we discovered another important pattern:

1. **Simplified Testing of Complex Objects**: Instead of trying to validate every internal detail of complex objects like embedders, a more maintainable approach is to test for the core functionality and expected behavior:
   ```javascript
   // Before - fragile approach:
   const mockEmbed = {
     setTitle: jest.fn().mockReturnThis(),
     setDescription: jest.fn().mockReturnThis(),
     setThumbnail: jest.fn().mockReturnThis()
   };
   EmbedBuilder.mockReturnValue(mockEmbed);
   
   // After test execution:
   expect(mockEmbed.setThumbnail).toHaveBeenCalled();
   ```

   ```javascript
   // After - more maintainable approach:
   await aliasCommand.execute(mockMessage, ['test-personality', 'test']);
    
   // Verify core functionality rather than implementation details
   expect(personalityManager.getPersonality).toHaveBeenCalledWith('test-personality');
   expect(personalityManager.setPersonalityAlias).toHaveBeenCalledWith(
     mockMessage.author.id, 'test-personality', 'test'
   );
   expect(mockMessage.channel.send).toHaveBeenCalled();
   ```

This approach creates tests that are less brittle and more focused on behavior, allowing for refactoring and implementation changes without breaking tests.

### Key Learnings from MessageTracker Test

When standardizing the `messageTracker.test.js` file, we discovered additional important patterns:

1. **Using the Real Implementation**: Instead of creating a mock implementation of the module being tested, it's better to import the actual module and test its behavior:
   ```javascript
   // Don't use a mock object like this
   const messageTracker = {
     // Custom mock implementation
   };

   // Instead, import the actual implementation
   const messageTracker = require('../../../../src/commands/utils/messageTracker');
   ```

2. **Testing Interface Stability**: Tests should focus on the behavior of the public interface, not implementation details:
   ```javascript
   // Instead of testing internal data structures:
   expect(messageTracker.lastCommandTime['user-123-test-command']).toBe(1000);
   
   // Test observable behavior through the public API:
   const firstCall = messageTracker.isRecentCommand('user-123', 'test-command', []);
   expect(firstCall).toBe(false);
   
   const secondCall = messageTracker.isRecentCommand('user-123', 'test-command', []);
   expect(secondCall).toBe(true);
   ```

These patterns make tests more resilient to implementation changes and focus on validating that the public API works as expected regardless of how it's implemented internally.

More tests will be standardized following the patterns established here.

## Simulated Tests

In addition to standard unit tests, we've implemented simulated tests to validate specific logic without executing the actual code path. These tests are particularly useful for:

1. Testing complex deduplication logic
2. Validating rate limiting without time delays
3. Testing registry-based tracking mechanisms
4. Simulating race conditions and edge cases

### Key Simulated Test Files

- `tests/unit/commands/utils/simulated.test.js` - Tests for command deduplication and rate limiting
- `tests/unit/commands.simulated.test.js` - Legacy simulated tests (being migrated)

### Simulated Test Patterns

1. **Mocking Time-Based Operations**:
   ```javascript
   // Set global.lastEmbedTime to a recent timestamp
   const now = Date.now();
   global.lastEmbedTime = now - 1000; // 1 second ago
   
   // Verify that we are rate limited
   expect(isRateLimited()).toBe(true);
   
   // Simulate waiting 6 seconds
   global.lastEmbedTime = now - 6000; // 6 seconds ago
   
   // Verify that we are no longer rate limited
   expect(isRateLimited()).toBe(false);
   ```

2. **Testing Global State Management**:
   ```javascript
   // Reset global state before each test
   beforeEach(() => {
     global.lastEmbedTime = 0;
     global.addRequestRegistry = new Map();
   });
   
   // Test global registry operations
   const messageKey = `add-msg-${message.id}-${args.join('-')}`;
   global.addRequestRegistry.set(messageKey, { /* state */ });
   expect(global.addRequestRegistry.has(messageKey)).toBe(true);
   ```

3. **Testing Callback Batching**:
   ```javascript
   // Use spies to verify batched operations
   const setAliasSpy = jest.spyOn(personalityManager, 'setPersonalityAlias');
   const saveAllSpy = jest.spyOn(personalityManager, 'saveAllPersonalities');
   
   await simulatedFunction();
   
   // Verify the batching pattern
   expect(setAliasSpy).toHaveBeenCalledTimes(2);
   expect(saveAllSpy).toHaveBeenCalledTimes(1);
   ```

For more details on simulated tests, refer to the [SIMULATED_TESTS_SUMMARY.md](./SIMULATED_TESTS_SUMMARY.md) document.