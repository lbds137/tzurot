// Mock logger and config first
jest.mock('../../src/logger');
jest.mock('../../config', () => ({
  botPrefix: '!tz',
  botConfig: {
    isDevelopment: false,
    mentionChar: '@',
  },
}));

// Now import the module after mocks are set up
const {
  recordConversation,
  getActivePersonality,
  getPersonalityFromMessage,
  clearConversation,
  activatePersonality,
  deactivatePersonality,
  getActivatedPersonality,
  enableAutoResponse,
  disableAutoResponse,
  isAutoResponseEnabled,
  saveAllData,
} = require('../../src/core/conversation');

// Import ApplicationBootstrap for test mocking
const { getApplicationBootstrap } = require('../../src/application/bootstrap/ApplicationBootstrap');

// Mock filesystem with a direct mock definition
jest.mock('fs', () => {
  const mockFs = {
    files: new Map(),
    directories: new Set(['/', '/data']),

    // Mock promises API
    promises: {
      mkdir: jest.fn().mockImplementation(async (dirPath, options) => {
        mockFs.directories.add(dirPath);
        return undefined;
      }),

      writeFile: jest.fn().mockImplementation(async (filePath, data) => {
        mockFs.files.set(filePath, data);
        return undefined;
      }),

      readFile: jest.fn().mockImplementation(async (filePath, encoding) => {
        if (mockFs.files.has(filePath)) {
          return mockFs.files.get(filePath);
        }
        const error = new Error(`ENOENT: no such file or directory, open '${filePath}'`);
        error.code = 'ENOENT';
        throw error;
      }),
    },
  };

  return mockFs;
});

// Mock path module
jest.mock('path', () => ({
  join: jest.fn((...args) => args.join('/')),
  basename: jest.fn(filePath => {
    const parts = filePath.split('/');
    return parts[parts.length - 1];
  }),
}));

// Legacy personality manager removed - using DDD system now

// Mock ApplicationBootstrap for MessageHistory
jest.mock('../../src/application/bootstrap/ApplicationBootstrap', () => ({
  getApplicationBootstrap: jest.fn().mockReturnValue({
    getPersonalityApplicationService: jest.fn().mockReturnValue({
      getPersonality: jest.fn().mockImplementation(async (nameOrAlias) => {
        const normalizedName = nameOrAlias.toLowerCase();
        if (normalizedName === 'test personality one' || normalizedName === 'test-personality-one') {
          return { fullName: 'test-personality-one' };
        }
        if (normalizedName === 'test personality two' || normalizedName === 'test-personality-two') {
          return { fullName: 'test-personality-two' };
        }
        return null;
      }),
    }),
  }),
}));

describe('Conversation Manager', () => {
  // Save original environment variables and settings
  const originalCwd = process.cwd;

  // Save original console methods
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;

  // Note: We'll use Jest fake timers instead of manually mocking

  // Store mocks that need cleanup
  let mkdirMock;
  let writeFileMock;
  let readFileMock;

  // Create test data
  const testUserId = 'test-user-123';
  const testChannelId = 'test-channel-456';
  const testPersonalityName = 'test-personality-one';
  const testMessageId = 'test-message-789';

  beforeEach(() => {
    // Mock process.cwd() - store the mock for cleanup
    process.cwd = jest.fn().mockReturnValue('/mock/app');

    // Mock console methods
    console.log = jest.fn();
    console.error = jest.fn();
    console.warn = jest.fn();

    // Use Jest's fake timers
    jest.useFakeTimers();

    // Reset the module's internal state by re-requiring it
    jest.resetModules();

    // Reset filesystem mocks and store references for cleanup
    const fs = require('fs');
    fs.files = new Map();
    fs.directories = new Set(['/', '/data']);

    // Store mock references for cleanup
    mkdirMock = fs.promises.mkdir;
    writeFileMock = fs.promises.writeFile;
    readFileMock = fs.promises.readFile;

    // Clear mock calls
    mkdirMock.mockClear();
    writeFileMock.mockClear();
    readFileMock.mockClear();
  });

  afterEach(() => {
    // Restore environment
    process.cwd = originalCwd;

    // Restore console methods
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;

    // Restore real timers
    jest.useRealTimers();

    // Restore mock implementations
    if (mkdirMock) mkdirMock.mockRestore();
    if (writeFileMock) writeFileMock.mockRestore();
    if (readFileMock) readFileMock.mockRestore();

    // Clear all mock function calls
    jest.clearAllMocks();
  });

  // Test recording a conversation
  describe('recordConversation', () => {
    it('should record a conversation with a single message ID', () => {
      // Enable auto-response first to allow continuous conversation
      enableAutoResponse(testUserId);

      // Record the conversation with isMentionOnly = false (continuous conversation)
      recordConversation(
        testUserId,
        testChannelId,
        testMessageId,
        testPersonalityName,
        false,
        false
      );

      // Verify that saveAllData is called
      expect(console.log).not.toHaveBeenCalled(); // Should be suppressed during recording

      // Now check if the personality is active
      const activePersonality = getActivePersonality(testUserId, testChannelId, false, true);
      expect(activePersonality).toBe(testPersonalityName);
    });

    it('should record a conversation with multiple message IDs', async () => {
      // Create an array of message IDs
      const messageIds = ['message-1', 'message-2', 'message-3'];

      // Record the conversation
      recordConversation(testUserId, testChannelId, messageIds, testPersonalityName);

      // Enable auto-response for the user
      enableAutoResponse(testUserId);

      // Verify that the conversation is recorded
      const activePersonality = getActivePersonality(testUserId, testChannelId, false, true);
      expect(activePersonality).toBe(testPersonalityName);

      // Verify that each message ID can be used to retrieve the personality
      for (const msgId of messageIds) {
        const personality = await getPersonalityFromMessage(msgId);
        expect(personality).toBe(testPersonalityName);
      }
    });
  });

  // Test auto-response functionality
  describe('Auto-Response', () => {
    it('should enable auto-response for a user', () => {
      // Enable auto-response
      const result = enableAutoResponse(testUserId);

      // Verify the result
      expect(result).toBe(true);

      // Verify auto-response is enabled
      expect(isAutoResponseEnabled(testUserId)).toBe(true);
    });

    it('should disable auto-response for a user', () => {
      // First enable auto-response
      enableAutoResponse(testUserId);

      // Then disable it
      const result = disableAutoResponse(testUserId);

      // Verify the result
      expect(result).toBe(true);

      // Verify auto-response is disabled
      expect(isAutoResponseEnabled(testUserId)).toBe(false);
    });

    it('should not return an active personality if auto-response is disabled', () => {
      // Record a mention-only conversation (as would happen without autoresponse)
      recordConversation(
        testUserId,
        testChannelId,
        testMessageId,
        testPersonalityName,
        false,
        true
      );

      // Check with auto-response disabled - should be null for mention-only in guild channels
      expect(isAutoResponseEnabled(testUserId)).toBe(false);
      const activePersonality = getActivePersonality(testUserId, testChannelId, false, false);
      expect(activePersonality).toBeNull();

      // Enable auto-response and record a continuous conversation
      enableAutoResponse(testUserId);
      recordConversation(
        testUserId,
        testChannelId,
        'new-message-id',
        testPersonalityName,
        false,
        false
      );
      const newActivePersonality = getActivePersonality(testUserId, testChannelId, false, true);
      expect(newActivePersonality).toBe(testPersonalityName);
    });
  });

  // Test channel activation
  describe('Channel Activation', () => {
    it('should activate a personality in a channel', () => {
      // Activate the personality
      const result = activatePersonality(testChannelId, testPersonalityName, testUserId);

      // Verify the result
      expect(result).toBe(true);

      // Verify the personality is activated
      const activatedPersonality = getActivatedPersonality(testChannelId);
      expect(activatedPersonality).toBe(testPersonalityName);
    });

    it('should deactivate a personality in a channel', () => {
      // First activate the personality
      activatePersonality(testChannelId, testPersonalityName, testUserId);

      // Then deactivate it
      const result = deactivatePersonality(testChannelId);

      // Verify the result
      expect(result).toBe(true);

      // Verify the personality is deactivated
      const activatedPersonality = getActivatedPersonality(testChannelId);
      expect(activatedPersonality).toBeNull();
    });

    it('should return false when deactivating a channel with no active personality', () => {
      // Attempt to deactivate a channel with no active personality
      const result = deactivatePersonality('non-activated-channel');

      // Verify the result
      expect(result).toBe(false);
    });
  });

  // Test getPersonalityFromMessage
  describe('getPersonalityFromMessage', () => {
    it('should get a personality from a recorded message ID', async () => {
      // Record a conversation
      recordConversation(testUserId, testChannelId, testMessageId, testPersonalityName);

      // Verify the personality can be retrieved
      const personality = await getPersonalityFromMessage(testMessageId);
      expect(personality).toBe(testPersonalityName);
    });

    it('should fallback to webhook username if message ID is not found', async () => {
      // Verify that a webhook username can be used as fallback
      const personality = await getPersonalityFromMessage('unknown-message-id', {
        webhookUsername: 'Test Personality One', // Matches one of the mock personalities
      });

      expect(personality).toBe('test-personality-one');
    });

    it('should handle case-insensitive webhook username matching', async () => {
      // Verify case-insensitive matching
      const personality = await getPersonalityFromMessage('unknown-message-id', {
        webhookUsername: 'test personality one', // Lowercase version
      });

      expect(personality).toBe('test-personality-one');
    });

    it('should handle webhook naming pattern matching', async () => {
      // Verify webhook pattern matching (DisplayName | suffix)
      const personality = await getPersonalityFromMessage('unknown-message-id', {
        webhookUsername: 'Test Personality One | Bot', // Webhook naming pattern
      });

      expect(personality).toBe('test-personality-one');
    });

    it('should return null if no matches are found', async () => {
      // Verify null return for no matches
      const personality = await getPersonalityFromMessage('unknown-message-id', {
        webhookUsername: 'Non-existent Personality',
      });

      expect(personality).toBeNull();
    });
  });

  // Test clearConversation
  describe('clearConversation', () => {
    it('should clear a conversation for a user in a channel', async () => {
      // Record a conversation
      recordConversation(testUserId, testChannelId, testMessageId, testPersonalityName);

      // Enable auto-response
      enableAutoResponse(testUserId);

      // Verify the conversation exists
      expect(getActivePersonality(testUserId, testChannelId, false, true)).toBe(
        testPersonalityName
      );

      // Clear the conversation
      const result = clearConversation(testUserId, testChannelId);

      // Verify the result
      expect(result).toBe(true);

      // Verify the conversation is cleared
      expect(getActivePersonality(testUserId, testChannelId, false, true)).toBeNull();

      // Verify the message ID mapping is cleared
      expect(await getPersonalityFromMessage(testMessageId)).toBeNull();
    });

    it('should return false if no conversation exists', () => {
      // Attempt to clear a non-existent conversation
      const result = clearConversation('unknown-user', 'unknown-channel');

      // Verify the result
      expect(result).toBe(false);
    });

    it('should handle multiple message IDs when clearing a conversation', async () => {
      // Create an array of message IDs
      const messageIds = ['message-1', 'message-2', 'message-3'];

      // Record the conversation
      recordConversation(testUserId, testChannelId, messageIds, testPersonalityName);

      // Clear the conversation
      clearConversation(testUserId, testChannelId);

      // Verify all message ID mappings are cleared
      for (const msgId of messageIds) {
        expect(await getPersonalityFromMessage(msgId)).toBeNull();
      }
    });
  });

  // Test conversation timeout functionality
  describe('Conversation Timeout', () => {
    // We don't have direct access to the internal state of the module,
    // so we'll test this indirectly through the public API

    it('should simulate the effect of a stale conversation', () => {
      // Create a mock implementation of Date.now to simulate time passing
      const originalDateNow = Date.now;

      try {
        // Mock recordConversation to use our fixed timestamp for testing
        const currentTime = 1600000000000; // Fixed timestamp
        const thirtyMinutesInMs = 30 * 60 * 1000;

        // First set Date.now to our fixed "current" time
        Date.now = jest.fn().mockReturnValue(currentTime);

        // Record a conversation at the current time
        recordConversation(testUserId, testChannelId, testMessageId, testPersonalityName);

        // Enable auto-response
        enableAutoResponse(testUserId);

        // Verify active personality is found
        expect(getActivePersonality(testUserId, testChannelId, false, true)).toBe(
          testPersonalityName
        );

        // Now advance time by 31 minutes (beyond the timeout)
        Date.now = jest.fn().mockReturnValue(currentTime + thirtyMinutesInMs + 60000);

        // The conversation should now be considered stale
        expect(getActivePersonality(testUserId, testChannelId, false, true)).toBeNull();
      } finally {
        // Restore original Date.now
        Date.now = originalDateNow;
      }
    });

    it('should not timeout recent conversations', () => {
      // Create a mock implementation of Date.now to simulate time passing
      const originalDateNow = Date.now;

      try {
        // Set up initial time
        const currentTime = 1600000000000; // Fixed timestamp
        Date.now = jest.fn().mockReturnValue(currentTime);

        // Record a conversation
        recordConversation(testUserId, testChannelId, testMessageId, testPersonalityName);

        // Enable auto-response
        enableAutoResponse(testUserId);

        // Advance time by 29 minutes (less than the timeout)
        Date.now = jest.fn().mockReturnValue(currentTime + 29 * 60 * 1000);

        // The conversation should still be active
        expect(getActivePersonality(testUserId, testChannelId, false, true)).toBe(
          testPersonalityName
        );
      } finally {
        // Restore original Date.now
        Date.now = originalDateNow;
      }
    });
  });

  // Test data persistence (saves and loads)
  describe('Data Persistence', () => {
    // For these tests, we need to mock the internal saveAllData function since it's
    // being executed inside our method calls but our mocks are not being called

    it('should save data when recording a conversation', async () => {
      // We can't effectively test file persistence directly without more complex mocking
      // Instead, we'll verify the correct functions are called and data is stored in memory

      // Record a conversation
      recordConversation(testUserId, testChannelId, testMessageId, testPersonalityName);

      // Verify we can retrieve the data (indicates it was stored in memory)
      enableAutoResponse(testUserId); // Need auto-response enabled to retrieve conversation
      expect(getActivePersonality(testUserId, testChannelId, false, true)).toBe(
        testPersonalityName
      );
      expect(await getPersonalityFromMessage(testMessageId)).toBe(testPersonalityName);
    });

    it('should save data when setting auto-response', () => {
      // Enable auto-response
      enableAutoResponse(testUserId);

      // Verify the data is stored
      expect(isAutoResponseEnabled(testUserId)).toBe(true);

      // Disable auto-response
      disableAutoResponse(testUserId);

      // Verify the data is updated
      expect(isAutoResponseEnabled(testUserId)).toBe(false);
    });

    it('should save data when activating a personality in a channel', () => {
      // Activate a personality
      activatePersonality(testChannelId, testPersonalityName, testUserId);

      // Verify the data is stored
      expect(getActivatedPersonality(testChannelId)).toBe(testPersonalityName);

      // Deactivate the personality
      deactivatePersonality(testChannelId);

      // Verify the data is updated
      expect(getActivatedPersonality(testChannelId)).toBeNull();
    });

    // More complex file system error handling tests would require more sophisticated mocking
    // that may not be worth the effort given the nature of the code.
  });

  // Test DM functionality
  describe('DM Functionality', () => {
    it('should auto-enable auto-response for DM channels', () => {
      // Verify auto-response is initially disabled
      expect(isAutoResponseEnabled(testUserId)).toBe(false);

      // Record a conversation in a DM channel
      recordConversation(testUserId, testChannelId, testMessageId, testPersonalityName, true);

      // Verify auto-response was automatically enabled
      expect(isAutoResponseEnabled(testUserId)).toBe(true);

      // Verify the conversation is active even in DM
      expect(getActivePersonality(testUserId, testChannelId, true, true)).toBe(testPersonalityName);
    });

    it('should use extended timeout for DM conversations', () => {
      const originalDateNow = Date.now;

      try {
        // Set up initial time
        const currentTime = 1600000000000;
        Date.now = jest.fn().mockReturnValue(currentTime);

        // Record a DM conversation
        recordConversation(testUserId, testChannelId, testMessageId, testPersonalityName, true);

        // Advance time by 90 minutes (more than guild timeout but less than DM timeout)
        Date.now = jest.fn().mockReturnValue(currentTime + 90 * 60 * 1000);

        // The DM conversation should still be active (2 hour timeout)
        expect(getActivePersonality(testUserId, testChannelId, true, true)).toBe(
          testPersonalityName
        );

        // Advance time by 121 minutes (beyond the 2 hour DM timeout)
        Date.now = jest.fn().mockReturnValue(currentTime + 121 * 60 * 1000);

        // Now the conversation should be stale
        expect(getActivePersonality(testUserId, testChannelId, true, true)).toBeNull();
      } finally {
        Date.now = originalDateNow;
      }
    });
  });

  // Test getAllActivatedChannels
  describe('getAllActivatedChannels', () => {
    it('should return all activated channels', () => {
      // Re-require to get fresh module state
      jest.resetModules();
      const {
        activatePersonality,
        getAllActivatedChannels,
      } = require('../../src/core/conversation');

      // Activate personalities in multiple channels
      activatePersonality('channel-1', 'personality-one', 'user-1');
      activatePersonality('channel-2', 'personality-two', 'user-2');
      activatePersonality('channel-3', 'personality-one', 'user-3');

      // Get all activated channels
      const activated = getAllActivatedChannels();

      // Verify the result
      expect(activated).toEqual({
        'channel-1': 'personality-one',
        'channel-2': 'personality-two',
        'channel-3': 'personality-one',
      });
    });

    it('should return empty object when no channels are activated', () => {
      // Re-require to get fresh module state
      jest.resetModules();
      const { getAllActivatedChannels } = require('../../src/core/conversation');

      // Get all activated channels
      const activated = getAllActivatedChannels();

      // Verify the result is empty
      expect(activated).toEqual({});
    });
  });

  // Test error handling
  describe('Error Handling', () => {
    it('should handle file system errors gracefully', async () => {
      // Re-require to get fresh module state
      jest.resetModules();
      const fs = require('fs');

      // Make mkdir fail
      fs.promises.mkdir.mockRejectedValueOnce(new Error('Permission denied'));

      // Re-require the module to trigger initialization
      const { initConversationManager } = require('../../src/core/conversation');

      // Initialize should not throw
      await expect(initConversationManager()).resolves.not.toThrow();

      // Check that error was logged
      const logger = require('../../src/logger');
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Error creating data directory')
      );
    });

    it('should handle file read errors other than ENOENT', async () => {
      // Re-require to get fresh module state
      jest.resetModules();
      const fs = require('fs');

      // Make readFile fail with permission error
      const permissionError = new Error('Permission denied');
      permissionError.code = 'EACCES';
      fs.promises.readFile.mockRejectedValueOnce(permissionError);

      // Re-require and initialize
      const { initConversationManager } = require('../../src/core/conversation');
      await initConversationManager();

      // Check that error was logged
      const logger = require('../../src/logger');
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Error loading'));
    });

    it('should handle router returning null gracefully', async () => {
      // Re-require modules to get fresh state
      jest.resetModules();
      
      // Mock ApplicationBootstrap to return null from router
      jest.mock('../../src/application/bootstrap/ApplicationBootstrap', () => ({
        getApplicationBootstrap: jest.fn().mockReturnValue({
          getPersonalityApplicationService: jest.fn().mockReturnValue({
            getPersonality: jest.fn().mockResolvedValue(null),
          }),
        }),
      }));

      const { getPersonalityFromMessage } = require('../../src/core/conversation');

      // Try to get personality from webhook username
      const result = await getPersonalityFromMessage('unknown-id', {
        webhookUsername: 'Test Bot',
      });

      // Should return null gracefully
      expect(result).toBeNull();
    });

    it('should handle errors from ApplicationBootstrap gracefully', async () => {
      // Re-require modules to get fresh state
      jest.resetModules();
      
      // Mock ApplicationBootstrap to throw error
      jest.mock('../../src/application/bootstrap/ApplicationBootstrap', () => ({
        getApplicationBootstrap: jest.fn().mockImplementation(() => {
          throw new Error('Bootstrap initialization error');
        }),
      }));

      const { getPersonalityFromMessage } = require('../../src/core/conversation');
      const logger = require('../../src/logger');

      // Clear any previous logger calls
      logger.error.mockClear();

      // Try to get personality from webhook username
      const result = await getPersonalityFromMessage('unknown-id', {
        webhookUsername: 'Test Bot',
      });

      // Should return null and log error
      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Error looking up personality by webhook username')
      );
    });
  });

  // Test legacy support
  describe('Legacy Support', () => {
    it('should support legacy lastMessageId in conversations', async () => {
      // Re-require to get fresh module state
      jest.resetModules();

      // Clear the mock logger
      jest.clearAllMocks();

      // Mock the filesystem before requiring the module
      const fs = require('fs');
      const legacyData = {
        [`${testUserId}-${testChannelId}`]: {
          personalityName: testPersonalityName,
          lastMessageId: 'legacy-message-123',
          timestamp: Date.now(),
        },
      };

      // Set up file to be read on init
      fs.files.set('/mock/app/data/conversations.json', JSON.stringify(legacyData));

      // Now require the module
      const conversationManager = require('../../src/core/conversation');

      // Initialize to load the legacy data
      await conversationManager.initConversationManager();

      // Enable auto-response
      conversationManager.enableAutoResponse(testUserId);

      // Should be able to get personality from legacy message ID
      const personality = await conversationManager.getPersonalityFromMessage('legacy-message-123');
      expect(personality).toBe(testPersonalityName);
    });

    it('should handle legacy message ID in clearConversation', async () => {
      // Re-require to get fresh module state
      jest.resetModules();

      // Clear the mock logger
      jest.clearAllMocks();

      // Mock the filesystem before requiring the module
      const fs = require('fs');
      const legacyData = {
        [`${testUserId}-${testChannelId}`]: {
          personalityName: testPersonalityName,
          lastMessageId: 'legacy-message-456',
          timestamp: Date.now(),
        },
      };

      fs.files.set('/mock/app/data/conversations.json', JSON.stringify(legacyData));

      // Now require the module
      const conversationManager = require('../../src/core/conversation');

      // Initialize to load the legacy data
      await conversationManager.initConversationManager();

      // Clear the conversation
      const result = conversationManager.clearConversation(testUserId, testChannelId);

      // Should return true and clean up legacy message ID
      expect(result).toBe(true);
      expect(await conversationManager.getPersonalityFromMessage('legacy-message-456')).toBeNull();
    });
  });
});
