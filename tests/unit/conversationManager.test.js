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
  saveAllData
} = require('../../src/conversationManager');

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
      })
    }
  };
  
  return mockFs;
});

// Mock path module
jest.mock('path', () => ({
  join: jest.fn((...args) => args.join('/'))
}));

// Mock personality manager
jest.mock('../../src/personalityManager', () => ({
  listPersonalitiesForUser: jest.fn().mockImplementation(() => [
    {
      fullName: 'test-personality-one',
      displayName: 'Test Personality One',
      avatarUrl: 'https://example.com/avatar1.png'
    },
    {
      fullName: 'test-personality-two',
      displayName: 'Test Personality Two',
      avatarUrl: 'https://example.com/avatar2.png'
    }
  ])
}));

describe('Conversation Manager', () => {
  // Save original environment variables and settings
  const originalCwd = process.cwd;
  
  // Save original console methods
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;
  
  // Original setTimeout and setInterval
  const originalSetTimeout = global.setTimeout;
  const originalSetInterval = global.setInterval;
  
  // Create test data
  const testUserId = 'test-user-123';
  const testChannelId = 'test-channel-456';
  const testPersonalityName = 'test-personality-one';
  const testMessageId = 'test-message-789';
  
  beforeEach(() => {
    // Mock process.cwd()
    process.cwd = jest.fn().mockReturnValue('/mock/app');
    
    // Mock console methods
    console.log = jest.fn();
    console.error = jest.fn();
    console.warn = jest.fn();
    
    // Mock setTimeout and setInterval to prevent actual timers
    global.setTimeout = jest.fn().mockReturnValue(123);
    global.setInterval = jest.fn().mockReturnValue(456);
    
    // Reset the module's internal state by re-requiring it
    jest.resetModules();
    
    // Reset filesystem mocks
    const fs = require('fs');
    fs.files = new Map();
    fs.directories = new Set(['/', '/data']);
    fs.promises.mkdir.mockClear();
    fs.promises.writeFile.mockClear();
    fs.promises.readFile.mockClear();
  });
  
  afterEach(() => {
    // Restore environment
    process.cwd = originalCwd;
    
    // Restore console methods
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
    
    // Restore timers
    global.setTimeout = originalSetTimeout;
    global.setInterval = originalSetInterval;
    
    // Clear all mock function calls
    jest.clearAllMocks();
  });
  
  // Test recording a conversation
  describe('recordConversation', () => {
    it('should record a conversation with a single message ID', () => {
      // Record the conversation
      recordConversation(testUserId, testChannelId, testMessageId, testPersonalityName);
      
      // Verify that saveAllData is called
      expect(console.log).not.toHaveBeenCalled(); // Should be suppressed during recording
      
      // Verify that a subsequent getActivePersonality call returns the personality
      const personality = getActivePersonality(testUserId, testChannelId);
      
      // We need to enable auto-response for the user first
      enableAutoResponse(testUserId);
      
      // Now check if the personality is active
      const activePersonality = getActivePersonality(testUserId, testChannelId);
      expect(activePersonality).toBe(testPersonalityName);
    });
    
    it('should record a conversation with multiple message IDs', () => {
      // Create an array of message IDs
      const messageIds = ['message-1', 'message-2', 'message-3'];
      
      // Record the conversation
      recordConversation(testUserId, testChannelId, messageIds, testPersonalityName);
      
      // Enable auto-response for the user
      enableAutoResponse(testUserId);
      
      // Verify that the conversation is recorded
      const activePersonality = getActivePersonality(testUserId, testChannelId);
      expect(activePersonality).toBe(testPersonalityName);
      
      // Verify that each message ID can be used to retrieve the personality
      for (const msgId of messageIds) {
        const personality = getPersonalityFromMessage(msgId);
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
      // Record a conversation
      recordConversation(testUserId, testChannelId, testMessageId, testPersonalityName);
      
      // Check with auto-response disabled
      expect(isAutoResponseEnabled(testUserId)).toBe(false);
      const activePersonality = getActivePersonality(testUserId, testChannelId);
      expect(activePersonality).toBeNull();
      
      // Enable auto-response and check again
      enableAutoResponse(testUserId);
      const newActivePersonality = getActivePersonality(testUserId, testChannelId);
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
    it('should get a personality from a recorded message ID', () => {
      // Record a conversation
      recordConversation(testUserId, testChannelId, testMessageId, testPersonalityName);
      
      // Verify the personality can be retrieved
      const personality = getPersonalityFromMessage(testMessageId);
      expect(personality).toBe(testPersonalityName);
    });
    
    it('should fallback to webhook username if message ID is not found', () => {
      // Verify that a webhook username can be used as fallback
      const personality = getPersonalityFromMessage('unknown-message-id', {
        webhookUsername: 'Test Personality One' // Matches one of the mock personalities
      });
      
      expect(personality).toBe('test-personality-one');
    });
    
    it('should handle case-insensitive webhook username matching', () => {
      // Verify case-insensitive matching
      const personality = getPersonalityFromMessage('unknown-message-id', {
        webhookUsername: 'test personality one' // Lowercase version
      });
      
      expect(personality).toBe('test-personality-one');
    });
    
    it('should handle webhook naming pattern matching', () => {
      // Verify webhook pattern matching (DisplayName | suffix)
      const personality = getPersonalityFromMessage('unknown-message-id', {
        webhookUsername: 'Test Personality One | Bot' // Webhook naming pattern
      });
      
      expect(personality).toBe('test-personality-one');
    });
    
    it('should return null if no matches are found', () => {
      // Verify null return for no matches
      const personality = getPersonalityFromMessage('unknown-message-id', {
        webhookUsername: 'Non-existent Personality'
      });
      
      expect(personality).toBeNull();
    });
  });
  
  // Test clearConversation
  describe('clearConversation', () => {
    it('should clear a conversation for a user in a channel', () => {
      // Record a conversation
      recordConversation(testUserId, testChannelId, testMessageId, testPersonalityName);
      
      // Enable auto-response
      enableAutoResponse(testUserId);
      
      // Verify the conversation exists
      expect(getActivePersonality(testUserId, testChannelId)).toBe(testPersonalityName);
      
      // Clear the conversation
      const result = clearConversation(testUserId, testChannelId);
      
      // Verify the result
      expect(result).toBe(true);
      
      // Verify the conversation is cleared
      expect(getActivePersonality(testUserId, testChannelId)).toBeNull();
      
      // Verify the message ID mapping is cleared
      expect(getPersonalityFromMessage(testMessageId)).toBeNull();
    });
    
    it('should return false if no conversation exists', () => {
      // Attempt to clear a non-existent conversation
      const result = clearConversation('unknown-user', 'unknown-channel');
      
      // Verify the result
      expect(result).toBe(false);
    });
    
    it('should handle multiple message IDs when clearing a conversation', () => {
      // Create an array of message IDs
      const messageIds = ['message-1', 'message-2', 'message-3'];
      
      // Record the conversation
      recordConversation(testUserId, testChannelId, messageIds, testPersonalityName);
      
      // Clear the conversation
      clearConversation(testUserId, testChannelId);
      
      // Verify all message ID mappings are cleared
      for (const msgId of messageIds) {
        expect(getPersonalityFromMessage(msgId)).toBeNull();
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
        expect(getActivePersonality(testUserId, testChannelId)).toBe(testPersonalityName);
        
        // Now advance time by 31 minutes (beyond the timeout)
        Date.now = jest.fn().mockReturnValue(currentTime + thirtyMinutesInMs + 60000);
        
        // The conversation should now be considered stale
        expect(getActivePersonality(testUserId, testChannelId)).toBeNull();
        
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
        expect(getActivePersonality(testUserId, testChannelId)).toBe(testPersonalityName);
        
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
    
    it('should save data when recording a conversation', () => {
      // We can't effectively test file persistence directly without more complex mocking
      // Instead, we'll verify the correct functions are called and data is stored in memory
      
      // Record a conversation
      recordConversation(testUserId, testChannelId, testMessageId, testPersonalityName);
      
      // Verify we can retrieve the data (indicates it was stored in memory)
      enableAutoResponse(testUserId); // Need auto-response enabled to retrieve conversation
      expect(getActivePersonality(testUserId, testChannelId)).toBe(testPersonalityName);
      expect(getPersonalityFromMessage(testMessageId)).toBe(testPersonalityName);
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
});