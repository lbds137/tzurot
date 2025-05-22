/**
 * Test Enhancement Utilities
 * 
 * These utilities enhance the existing test patterns without replacing them completely.
 * They provide shortcuts and standardization while maintaining compatibility with 
 * the current Jest mocking approach.
 */

/**
 * Get standard mock definitions for command tests
 * Returns an object with the mock setup functions rather than calling jest.mock directly
 * This avoids path resolution issues when called from different directories
 */
function getCommandTestMocks() {
  return {
    discord: () => jest.mock('discord.js'),
    logger: () => jest.mock('../../../../src/logger'),
    config: () => jest.mock('../../../../config', () => ({
      botPrefix: '!tz'
    })),
    commandValidator: () => jest.mock('../../../../src/commands/utils/commandValidator')
  };
}

/**
 * Standard Jest mock setup for bot integration tests
 */
function setupBotTestMocks() {
  jest.mock('discord.js');
  jest.mock('../../src/personalityManager');
  jest.mock('../../src/conversationManager');
  jest.mock('../../src/aiService');
  jest.mock('../../src/webhookManager');
  jest.mock('../../src/commands');
  jest.mock('../../config');
  jest.mock('../../src/logger');
}

/**
 * Enhanced command test helpers that reduce duplication
 * These work with the existing commandTestHelpers but provide more standardization
 */
function createStandardCommandTest() {
  const helpers = require('./commandTestHelpers');
  
  return {
    /**
     * Create a standard mock message for command testing
     */
    createMockMessage: (options = {}) => {
      const mockMessage = helpers.createMockMessage(options);
      
      // Ensure standard methods are available
      mockMessage.channel.send = mockMessage.channel.send || jest.fn().mockResolvedValue({
        id: 'sent-message-123',
        content: 'Mock response'
      });
      
      mockMessage.channel.sendTyping = mockMessage.channel.sendTyping || jest.fn().mockResolvedValue(undefined);
      
      return mockMessage;
    },
    
    /**
     * Create a standard command validator mock
     */
    createValidatorMock: () => {
      const mockDirectSend = jest.fn().mockImplementation(content => {
        return Promise.resolve({
          id: 'direct-send-123',
          content: typeof content === 'string' ? content : JSON.stringify(content)
        });
      });
      
      return {
        createDirectSend: jest.fn().mockReturnValue(mockDirectSend),
        isAdmin: jest.fn().mockReturnValue(false),
        canManageMessages: jest.fn().mockReturnValue(false),
        isNsfwChannel: jest.fn().mockReturnValue(false)
      };
    },
    
    /**
     * Create standard module mocks for commands
     */
    createModuleMocks: () => {
      return {
        personalityManager: {
          getPersonality: jest.fn().mockReturnValue(null),
          registerPersonality: jest.fn().mockResolvedValue({
            personality: {
              fullName: 'test-personality',
              displayName: 'Test Personality',
              avatarUrl: 'https://example.com/avatar.png'
            }
          }),
          personalityAliases: new Map()
        },
        webhookManager: {
          preloadPersonalityAvatar: jest.fn().mockResolvedValue(true)
        },
        messageTracker: {
          isAddCommandProcessed: jest.fn().mockReturnValue(false),
          markAddCommandAsProcessed: jest.fn(),
          isAddCommandCompleted: jest.fn().mockReturnValue(false),
          markAddCommandCompleted: jest.fn(),
          hasFirstEmbed: jest.fn().mockReturnValue(false),
          markGeneratedFirstEmbed: jest.fn()
        }
      };
    }
  };
}

/**
 * Standard assertions for command tests
 * Reduces repetitive assertion code
 */
function createStandardAssertions() {
  return {
    /**
     * Assert that a command has correct metadata
     */
    assertCommandMetadata: (command, expectedName) => {
      expect(command.meta).toEqual({
        name: expectedName,
        description: expect.any(String),
        usage: expect.any(String),
        aliases: expect.any(Array),
        permissions: expect.any(Array)
      });
    },
    
    /**
     * Assert that a message was sent successfully
     */
    assertMessageSent: (mockMessage, expectedContent) => {
      expect(mockMessage.channel.send).toHaveBeenCalled();
      if (expectedContent) {
        expect(mockMessage.channel.send).toHaveBeenCalledWith(expectedContent);
      }
    },
    
    /**
     * Assert that an error was handled gracefully
     */
    assertErrorHandled: (mockLogger, mockMessage) => {
      expect(mockLogger.error).toHaveBeenCalled();
      // Could also check that error message was sent to user
    }
  };
}

/**
 * Migration utility to gradually adopt new patterns
 * This allows tests to be updated incrementally
 */
function createMigrationHelper(testType = 'command') {
  const standardTest = createStandardCommandTest();
  const assertions = createStandardAssertions();
  
  // Bridge utilities for connecting new and old systems
  const bridge = {
    getMockEnvironment: (options = {}) => {
      // Create a basic mock environment for testing
      return {
        modules: standardTest.createModuleMocks(),
        discord: {
          createMessage: standardTest.createMockMessage
        }
      };
    },
    
    createCompatibleMockMessage: (options = {}) => {
      return standardTest.createMockMessage(options);
    },
    
    setupCommonMocks: (mockEnv, customMocks = {}) => {
      // Setup common Jest mocks for migration
      return mockEnv;
    }
  };
  
  // Enhanced assertions with additional helpful methods
  const enhancedAssertions = {
    ...assertions,
    
    assertFunctionCalled: (mockFn, description) => {
      expect(mockFn).toHaveBeenCalled();
    },
    
    assertFunctionCalledWith: (mockFn, expectedArgs, description) => {
      expect(mockFn).toHaveBeenCalledWith(...expectedArgs);
    },
    
    assertFunctionNotCalled: (mockFn, description) => {
      expect(mockFn).not.toHaveBeenCalled();
    }
  };
  
  return {
    // Bridge utilities
    bridge,
    
    // New enhanced methods
    enhanced: {
      createMessage: standardTest.createMockMessage,
      createValidator: standardTest.createValidatorMock,
      createMocks: standardTest.createModuleMocks,
      assert: enhancedAssertions
    },
    
    // Legacy compatibility
    legacy: {
      createMockMessage: require('./commandTestHelpers').createMockMessage
    },
    
    // Utilities
    getMocks: testType === 'command' ? getCommandTestMocks : undefined
  };
}

module.exports = {
  getCommandTestMocks,
  setupBotTestMocks,
  createStandardCommandTest,
  createStandardAssertions,
  createMigrationHelper
};