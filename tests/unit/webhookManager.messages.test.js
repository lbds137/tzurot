/**
 * Tests for webhookManager.js focusing on message sending functionality
 */

jest.mock('discord.js');
jest.mock('node-fetch');

jest.mock('../../src/webhookManager', () => {
  // Get the original module to preserve non-mocked functions
  const originalModule = jest.requireActual('../../src/webhookManager');
  
  // Create minimal mock versions of functions used by sendWebhookMessage
  const mockFunctions = {
    // Core functions
    minimizeConsoleOutput: jest.fn().mockReturnValue({
      originalConsoleLog: console.log,
      originalConsoleWarn: console.warn
    }),
    restoreConsoleOutput: jest.fn(),
    sendMessageChunk: jest.fn().mockImplementation(async (webhook, messageData) => {
      return { id: `mock-message-${Date.now()}` };
    }),
    createVirtualResult: jest.fn().mockImplementation((personality, channelId) => {
      return {
        message: { id: `virtual-${Date.now()}` },
        messageIds: [`virtual-${Date.now()}`],
        isDuplicate: true
      };
    }),
    
    // Deduplication and message handling
    generateMessageTrackingId: jest.fn().mockReturnValue('mock-tracking-id'),
    isErrorContent: jest.fn().mockImplementation(content => {
      if (!content) return false;
      return content.includes('error') || 
             content.includes('trouble') || 
             content.includes('HARD_BLOCKED');
    }),
    markErrorContent: jest.fn().mockImplementation(content => {
      if (!content) return '';
      if (content.includes('trouble') || content.includes('error')) {
        return 'ERROR_MESSAGE_PREFIX: ' + content;
      }
      return content;
    }),
    isDuplicateMessage: jest.fn().mockReturnValue(false),
    hasPersonalityPendingMessage: jest.fn().mockReturnValue(false),
    registerPendingMessage: jest.fn(),
    clearPendingMessage: jest.fn(),
    calculateMessageDelay: jest.fn().mockReturnValue(0),
    updateChannelLastMessageTime: jest.fn(),
    
    // Utilities
    splitMessage: originalModule.splitMessage,
    prepareMessageData: originalModule.prepareMessageData,
    getStandardizedUsername: jest.fn().mockImplementation(personality => {
      if (!personality) return 'Bot';
      return personality.displayName || 'Unknown';
    }),
    
    // The function we're testing
    sendWebhookMessage: originalModule.sendWebhookMessage,
    
    // Mock getOrCreateWebhook function
    getOrCreateWebhook: jest.fn().mockImplementation(async () => ({
      send: jest.fn().mockImplementation(data => {
        return Promise.resolve({
          id: `mock-message-${Date.now()}`,
          content: typeof data === 'string' ? data : data.content,
        });
      })
    }))
  };
  
  // Merge with the original exports to maintain all functions
  return {
    ...originalModule,
    ...mockFunctions,
  };
});

describe('WebhookManager - Message Sending Tests', () => {
  let webhookManager;
  let mockChannel;
  let personality;
  
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Import after mocking
    webhookManager = require('../../src/webhookManager');
    
    // Create test fixtures
    mockChannel = {
      id: 'test-channel-id',
      name: 'test-channel',
      isThread: jest.fn().mockReturnValue(false),
      fetchWebhooks: jest.fn().mockResolvedValue(new Map()),
      createWebhook: jest.fn().mockResolvedValue({
        id: 'mock-webhook-id',
        url: 'https://discord.com/api/webhooks/mock/token'
      })
    };
    
    personality = {
      fullName: 'test-personality',
      displayName: 'Test Personality',
      avatarUrl: 'https://example.com/avatar.png'
    };
    
    // Mock console
    console.log = jest.fn();
    console.error = jest.fn();
    console.warn = jest.fn();
    
    // Create a spy for isDuplicateMessage to control when it returns true/false
    webhookManager.isDuplicateMessage.mockImplementation((content) => {
      return content === 'DUPLICATE_TEST_MESSAGE';
    });
  });
  
  afterEach(() => {
    jest.resetModules();
  });
  
  it('should successfully send a simple message', async () => {
    const result = await webhookManager.sendWebhookMessage(
      mockChannel,
      'Test message',
      personality
    );
    
    // Verify functions were called
    expect(webhookManager.getOrCreateWebhook).toHaveBeenCalledWith(mockChannel);
    expect(webhookManager.minimizeConsoleOutput).toHaveBeenCalled();
    expect(webhookManager.getStandardizedUsername).toHaveBeenCalledWith(personality);
    expect(webhookManager.splitMessage).toHaveBeenCalledWith('Test message');
    
    // Verify result
    expect(result).toBeDefined();
    expect(result.messageIds).toBeDefined();
    expect(result.messageIds.length).toBe(1);
  });
  
  it('should split long messages into chunks', async () => {
    // Mock splitMessage to return multiple chunks
    const longMessage = 'This is a long message.'.repeat(500);
    const mockChunks = ['Chunk 1', 'Chunk 2', 'Chunk 3'];
    webhookManager.splitMessage.mockReturnValueOnce(mockChunks);
    
    const result = await webhookManager.sendWebhookMessage(
      mockChannel,
      longMessage,
      personality
    );
    
    // Verify functions were called
    expect(webhookManager.splitMessage).toHaveBeenCalledWith(longMessage);
    
    // Verify result
    expect(result).toBeDefined();
    expect(result.messageIds).toBeDefined();
    expect(result.messageIds.length).toBe(mockChunks.length);
  });
  
  it('should mark error messages', async () => {
    const errorMessage = 'I am having trouble connecting';
    
    // Make isErrorContent return true for this message
    webhookManager.isErrorContent.mockReturnValueOnce(true);
    
    await webhookManager.sendWebhookMessage(
      mockChannel,
      errorMessage,
      personality
    );
    
    // Verify error detection functions were called
    expect(webhookManager.isErrorContent).toHaveBeenCalledWith(errorMessage);
    expect(webhookManager.markErrorContent).toHaveBeenCalled();
  });
  
  it('should skip duplicate messages', async () => {
    const duplicateMessage = 'DUPLICATE_TEST_MESSAGE';
    
    const result = await webhookManager.sendWebhookMessage(
      mockChannel,
      duplicateMessage,
      personality
    );
    
    // Verify a virtual result was created
    expect(result).toBeDefined();
    expect(result.isDuplicate).toBe(true);
    
    // The send function should not have been called
    expect(webhookManager.sendMessageChunk).not.toHaveBeenCalled();
  });
  
  it('should add embeds to the first chunk only', async () => {
    // Mock splitMessage to return multiple chunks
    const mockChunks = ['Chunk 1', 'Chunk 2', 'Chunk 3'];
    webhookManager.splitMessage.mockReturnValueOnce(mockChunks);
    
    // Create embed options
    const embedOptions = {
      embed: { title: 'Test Embed', description: 'Test Description' }
    };
    
    await webhookManager.sendWebhookMessage(
      mockChannel,
      'Test message with embed',
      personality,
      embedOptions
    );
    
    // Check prepareMessageData calls
    const allCalls = webhookManager.prepareMessageData.mock.calls;
    
    // First call should include embed
    expect(allCalls[0][5]).toHaveProperty('embed');
    
    // Subsequent calls should not include embed
    if (allCalls.length > 1) {
      expect(allCalls[1][5]).toBeUndefined();
    }
  });
  
  it('should handle missing personality data', async () => {
    await webhookManager.sendWebhookMessage(
      mockChannel,
      'Test message with no personality',
      null
    );
    
    // Verify getStandardizedUsername was called with null
    expect(webhookManager.getStandardizedUsername).toHaveBeenCalledWith(null);
    
    // Default username should be 'Bot'
    expect(webhookManager.prepareMessageData.mock.calls[0][1]).toBe('Bot');
  });
  
  it('should handle webhook send errors', async () => {
    // Make sendMessageChunk throw an error
    webhookManager.sendMessageChunk.mockRejectedValueOnce(new Error('Send failed'));
    
    // Call function and expect it to throw
    await expect(webhookManager.sendWebhookMessage(
      mockChannel,
      'Test message',
      personality
    )).rejects.toThrow();
    
    // Verify restore console was called in the finally block
    expect(webhookManager.restoreConsoleOutput).toHaveBeenCalled();
  });
  
  it('should skip messages with the HARD_BLOCKED marker', async () => {
    const blockedMessage = 'This is a HARD_BLOCKED message';
    
    // Make isErrorContent detect this message
    webhookManager.isErrorContent.mockReturnValueOnce(true);
    
    // Make markErrorContent return content with the hard block marker
    webhookManager.markErrorContent.mockReturnValueOnce(
      'HARD_BLOCKED_RESPONSE_DO_NOT_DISPLAY: ' + blockedMessage
    );
    
    const result = await webhookManager.sendWebhookMessage(
      mockChannel,
      blockedMessage,
      personality
    );
    
    // Verify createVirtualResult was called
    expect(webhookManager.createVirtualResult).toHaveBeenCalled();
    
    // Verify result is a virtual result
    expect(result).toBeDefined();
    expect(result.isDuplicate).toBe(true);
  });
});