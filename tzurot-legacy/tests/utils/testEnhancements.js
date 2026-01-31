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
    config: () =>
      jest.mock('../../../../config', () => ({
        botPrefix: '!tz',
      })),
    commandValidator: () => jest.mock('../../../../src/commands/utils/commandValidator'),
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
 * Enhanced utility test helpers for utility/library tests
 * These provide standardization for utility module tests
 */
function createUtilityTest() {
  return {
    /**
     * Create standard utility mocks
     */
    createUtilityMocks: () => {
      return {
        logger: {
          info: jest.fn(),
          debug: jest.fn(),
          warn: jest.fn(),
          error: jest.fn(),
        },
        personalityManager: {
          listPersonalitiesForUser: jest.fn(),
          personalityAliases: new Map(),
          getPersonality: jest.fn(),
          registerPersonality: jest.fn(),
        },
        dataStorage: {
          saveData: jest.fn().mockResolvedValue(),
          loadData: jest.fn().mockResolvedValue({}),
        },
        discord: {
          EmbedBuilder: jest.fn().mockImplementation(() => ({
            setTitle: jest.fn().mockReturnThis(),
            setDescription: jest.fn().mockReturnThis(),
            setColor: jest.fn().mockReturnThis(),
            addFields: jest.fn().mockReturnThis(),
            setFooter: jest.fn().mockReturnThis(),
            setThumbnail: jest.fn().mockReturnThis(),
            data: {
              title: '',
              description: '',
              fields: [],
            },
          })),
        },
      };
    },

    /**
     * Console mocking for utility tests
     */
    mockConsole: () => {
      const originalConsole = {
        error: console.error,
        log: console.log,
        debug: console.debug,
        warn: console.warn,
      };

      console.error = jest.fn();
      console.log = jest.fn();
      console.debug = jest.fn();
      console.warn = jest.fn();

      return {
        restore: () => {
          console.error = originalConsole.error;
          console.log = originalConsole.log;
          console.debug = originalConsole.debug;
          console.warn = originalConsole.warn;
        },
      };
    },
  };
}

/**
 * Enhanced bot test helpers that reduce duplication
 * These provide standardization for bot integration tests
 */
function createBotIntegrationTest() {
  return {
    /**
     * Create comprehensive bot environment mock
     */
    createBotEnvironment: () => {
      const mockAiService = {
        getAiResponse: jest.fn().mockResolvedValue({ content: 'This is a mock AI response', metadata: null }),
      };

      const mockWebhookManager = {
        getOrCreateWebhook: jest.fn().mockResolvedValue({
          send: jest.fn().mockResolvedValue({ id: 'mock-webhook-message' }),
        }),
        sendWebhookMessage: jest.fn().mockResolvedValue({
          message: { id: 'mock-webhook-message' },
          messageIds: ['mock-webhook-message'],
        }),
        registerEventListeners: jest.fn(),
      };

      const mockConversationManager = {
        recordConversation: jest.fn(),
        getActivePersonality: jest.fn(),
        getPersonalityFromMessage: jest.fn(),
        getActivatedPersonality: jest.fn(),
      };

      const mockCommandLoader = {
        processCommand: jest.fn().mockResolvedValue({
          success: true,
          message: 'Command processed successfully',
        }),
      };

      const mockPersonalityManager = {
        getPersonalityByAlias: jest.fn(),
        getPersonality: jest.fn(),
        registerPersonality: jest.fn(),
      };

      const mockLogger = {
        info: jest.fn(),
        debug: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      };

      return {
        aiService: mockAiService,
        webhookManager: mockWebhookManager,
        conversationManager: mockConversationManager,
        commandLoader: mockCommandLoader,
        personalityManager: mockPersonalityManager,
        logger: mockLogger,
        config: { botPrefix: '!tz' },
      };
    },

    /**
     * Create enhanced Discord message mock for bot tests
     */
    createBotMessage: (options = {}) => {
      const {
        id = 'test-message-123',
        content = 'Test message content',
        authorId = 'user-123',
        channelId = 'channel-123',
        isBot = false,
        embeds = [],
        isDM = false,
      } = options;

      const mockMessage = {
        id,
        content,
        author: {
          id: authorId,
          bot: isBot,
          username: isBot ? 'MockBot' : 'TestUser',
        },
        channel: {
          id: channelId,
          type: isDM ? 1 : 0, // 1 = DM, 0 = Guild Text
          send: jest.fn().mockResolvedValue({ id: 'sent-message-123' }),
          sendTyping: jest.fn().mockResolvedValue(undefined),
        },
        guild: isDM ? null : { id: 'guild-123' },
        embeds,
        delete: jest.fn().mockResolvedValue(),
        reply: jest.fn().mockResolvedValue({ id: 'reply-message-123' }),
      };

      return mockMessage;
    },

    /**
     * Setup global state for bot tests
     */
    setupBotGlobals: () => {
      global.lastEmbedTime = 0;
      global.embedDeduplicationWindow = 5000;
      global.processedBotMessages = new Set();
      global.seenBotMessages = new Set();
    },

    /**
     * Cleanup global state after bot tests
     */
    cleanupBotGlobals: () => {
      delete global.lastEmbedTime;
      delete global.embedDeduplicationWindow;
      delete global.processedBotMessages;
      delete global.seenBotMessages;
    },

    /**
     * Console mocking utilities for bot tests
     */
    mockConsole: () => {
      const original = {
        log: console.log,
        error: console.error,
        warn: console.warn,
        debug: console.debug,
      };

      console.log = jest.fn();
      console.error = jest.fn();
      console.warn = jest.fn();
      console.debug = jest.fn();

      return {
        restore: () => {
          console.log = original.log;
          console.error = original.error;
          console.warn = original.warn;
          console.debug = original.debug;
        },
      };
    },
  };
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
      mockMessage.channel.send =
        mockMessage.channel.send ||
        jest.fn().mockResolvedValue({
          id: 'sent-message-123',
          content: 'Mock response',
        });

      mockMessage.channel.sendTyping =
        mockMessage.channel.sendTyping || jest.fn().mockResolvedValue(undefined);

      return mockMessage;
    },

    /**
     * Create a standard command validator mock
     */
    createValidatorMock: () => {
      const mockDirectSend = jest.fn().mockImplementation(content => {
        return Promise.resolve({
          id: 'direct-send-123',
          content: typeof content === 'string' ? content : JSON.stringify(content),
        });
      });

      return {
        createDirectSend: jest.fn().mockReturnValue(mockDirectSend),
        isAdmin: jest.fn().mockReturnValue(false),
        canManageMessages: jest.fn().mockReturnValue(false),
        isNsfwChannel: jest.fn().mockReturnValue(false),
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
              avatarUrl: 'https://example.com/avatar.png',
            },
          }),
          personalityAliases: new Map(),
        },
        webhookManager: {
          preloadPersonalityAvatar: jest.fn().mockResolvedValue(true),
        },
        messageTracker: {
          isAddCommandProcessed: jest.fn().mockReturnValue(false),
          markAddCommandAsProcessed: jest.fn(),
          isAddCommandCompleted: jest.fn().mockReturnValue(false),
          markAddCommandCompleted: jest.fn(),
          hasFirstEmbed: jest.fn().mockReturnValue(false),
          markGeneratedFirstEmbed: jest.fn(),
        },
      };
    },
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
        permissions: expect.any(Array),
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
    },
  };
}

/**
 * Migration utility to gradually adopt new patterns
 * This allows tests to be updated incrementally
 */
function createMigrationHelper(testType = 'command') {
  const standardTest = testType === 'command' ? createStandardCommandTest() : null;
  const botTest = testType === 'bot' ? createBotIntegrationTest() : null;
  const utilityTest = testType === 'utility' ? createUtilityTest() : null;
  const assertions = createStandardAssertions();

  // Bridge utilities for connecting new and old systems
  const bridge = {
    getMockEnvironment: (options = {}) => {
      if (testType === 'bot') {
        return {
          modules: botTest.createBotEnvironment(),
          discord: {
            createMessage: botTest.createBotMessage,
          },
        };
      } else if (testType === 'utility') {
        return {
          modules: utilityTest.createUtilityMocks(),
          discord: null, // Utility tests don't typically need Discord mocks
        };
      } else {
        // Command test environment
        return {
          modules: standardTest.createModuleMocks(),
          discord: {
            createMessage: standardTest.createMockMessage,
          },
        };
      }
    },

    createCompatibleMockMessage: (options = {}) => {
      if (testType === 'bot') {
        return botTest.createBotMessage(options);
      } else {
        return standardTest.createMockMessage(options);
      }
    },

    setupCommonMocks: (mockEnv, customMocks = {}) => {
      // Setup common Jest mocks for migration
      return mockEnv;
    },

    // Bot-specific utilities
    setupBotGlobals: botTest ? botTest.setupBotGlobals : undefined,
    cleanupBotGlobals: botTest ? botTest.cleanupBotGlobals : undefined,
    mockConsole:
      testType === 'bot'
        ? botTest.mockConsole
        : testType === 'utility'
          ? utilityTest.mockConsole
          : undefined,

    // Utility for getting modules with proper Jest mocking
    getModule: modulePath => {
      // Reset modules to ensure fresh mocks
      jest.resetModules();
      return require(modulePath);
    },
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
    },
  };

  return {
    // Bridge utilities
    bridge,

    // New enhanced methods
    enhanced: {
      createMessage:
        testType === 'bot'
          ? botTest.createBotMessage
          : testType === 'utility'
            ? null
            : standardTest.createMockMessage,
      createValidator:
        testType === 'bot' || testType === 'utility' ? null : standardTest.createValidatorMock,
      createMocks:
        testType === 'bot'
          ? botTest.createBotEnvironment
          : testType === 'utility'
            ? utilityTest.createUtilityMocks
            : standardTest.createModuleMocks,
      assert: enhancedAssertions,
    },

    // Legacy compatibility
    legacy: {
      createMockMessage:
        testType === 'bot'
          ? botTest.createBotMessage
          : require('./commandTestHelpers').createMockMessage,
    },

    // Utilities
    getMocks: testType === 'command' ? getCommandTestMocks : undefined,
  };
}

module.exports = {
  getCommandTestMocks,
  setupBotTestMocks,
  createStandardCommandTest,
  createBotIntegrationTest,
  createUtilityTest,
  createStandardAssertions,
  createMigrationHelper,
};
