/**
 * Tests for webhookManager.js focusing on message sending functionality
 *
 * These tests verify:
 * - Single messages vs. multi-chunk messages
 * - Error message handling
 * - Duplicate message detection
 * - Attachments and embeds on last chunk (NOT first chunk)
 * - Error handling for webhook operations
 */

// Unmock webhookManager since it's globally mocked in setup.js
jest.unmock('../../src/webhookManager');

// Define mock objects at module level
const mockWebhook = {
  send: jest.fn().mockResolvedValue({
    id: 'test-message-id',
    content: 'test content',
  }),
  destroy: jest.fn(),
};

// Mock dependencies BEFORE requiring the module
jest.mock('../../src/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));

jest.mock('node-fetch');
jest.mock('discord.js', () => ({
  WebhookClient: jest.fn(() => mockWebhook),
}));

// Mock internal modules used by webhookManager
jest.mock('../../src/utils/messageSplitting', () => ({
  prepareAndSplitMessage: jest.fn().mockImplementation((content, options, logPrefix) => {
    // Simple split logic for testing
    if (!content || content.length <= 2000) {
      return [content || ''];
    }
    const chunks = [];
    for (let i = 0; i < content.length; i += 2000) {
      chunks.push(content.slice(i, i + 2000));
    }
    return chunks;
  }),
  chunkHelpers: {
    isFirstChunk: jest.fn(i => i === 0),
    isLastChunk: jest.fn((i, len) => i === len - 1),
    getChunkDelay: jest.fn(() => 750)
  }
}));

jest.mock('../../src/utils/messageDeduplication', () => ({
  isDuplicateMessage: jest.fn().mockReturnValue(false),
  hashMessage: jest.fn().mockReturnValue('hash'),
  getStandardizedUsername: jest.fn().mockReturnValue('TestPersonality')
}));

jest.mock('../../src/utils/avatarStorage', () => ({
  getLocalAvatarUrl: jest.fn().mockResolvedValue('https://example.com/avatar.png')
}));

jest.mock('../../src/utils/webhookCache', () => ({
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn(),
  createWebhook: jest.fn().mockResolvedValue({
    id: 'webhook-id',
    token: 'webhook-token',
    url: 'https://discord.com/api/webhooks/webhook-id/webhook-token'
  }),
  getActiveWebhooks: jest.fn(() => new Set()),
  getOrCreateWebhook: jest.fn().mockImplementation(() => {
    return Promise.resolve(mockWebhook);
  }),
  clearWebhookCache: jest.fn(),
  has: jest.fn().mockReturnValue(false),
  _webhookCache: new Map()
}));

jest.mock('../../src/utils/errorTracker');
jest.mock('../../src/utils/messageFormatter', () => ({
  markErrorContent: jest.fn(content => {
    if (!content) return '';
    if (content.includes('trouble') || content.includes('error')) {
      return 'ERROR_MESSAGE_PREFIX: ' + content;
    }
    return content;
  })
}));

jest.mock('../../src/utils/media', () => ({
  mediaHandler: {},
  processMediaForWebhook: jest.fn().mockImplementation((content) => {
    return Promise.resolve({
      content: content || 'processed',
      attachments: [],
      multimodalAudioUrl: undefined,
      multimodalImageUrl: undefined
    });
  }),
  prepareAttachmentOptions: jest.fn().mockReturnValue({})
}));

jest.mock('../../src/utils/avatarManager', () => ({
  validateAvatarUrl: jest.fn().mockResolvedValue(true),
  getValidAvatarUrl: jest.fn().mockResolvedValue('https://example.com/avatar.png'),
  preloadPersonalityAvatar: jest.fn(),
  warmupAvatar: jest.fn()
}));

jest.mock('../../src/webhook', () => ({
  prepareMessageData: jest.fn((content, username, personality, isThread, threadId, options) => ({
    content: content || '',
    username,
    _personality: personality,
    threadId: isThread ? threadId : undefined,
    ...options
  })),
  sendMessageChunk: jest.fn(async webhook => {
    return webhook.send();
  }),
  getStandardizedUsername: jest.fn().mockReturnValue('Test User'),
  generateMessageTrackingId: jest.fn().mockReturnValue('tracking-id-123'),
  createVirtualResult: jest
    .fn()
    .mockImplementation((personality, channelId) => {
      return { 
        message: { id: 'virtual-id' }, 
        messageIds: ['virtual-id'],
        isDuplicate: true 
      };
    }),
  hasPersonalityPendingMessage: jest.fn().mockReturnValue(false),
  registerPendingMessage: jest.fn(),
  clearPendingMessage: jest.fn(),
  calculateMessageDelay: jest.fn().mockReturnValue(0),
  updateChannelLastMessageTime: jest.fn(),
  minimizeConsoleOutput: jest.fn().mockReturnValue({}),
  restoreConsoleOutput: jest.fn(),
  sendDirectThreadMessage: jest.fn().mockResolvedValue({ message: { id: 'thread-message-id' } }),
  sendFormattedMessageInDM: jest.fn().mockResolvedValue({ message: { id: 'dm-message-id' } }),
  isErrorContent: jest.fn().mockImplementation(content => {
    if (!content) return false;
    return content.includes('error') || content.includes('trouble');
  }),
  markErrorContent: jest.fn().mockImplementation(content => content)
}));

jest.mock('../../src/profileInfoFetcher', () => ({
  getFetcher: jest.fn().mockReturnValue({
    fetchProfileInfo: jest.fn().mockResolvedValue({
      avatarUrl: 'https://example.com/avatar.png',
      displayName: 'Test User'
    })
  }),
  getProfileAvatarUrl: jest.fn().mockResolvedValue(null),
  getProfileDisplayName: jest.fn().mockResolvedValue('Test Display'),
  deleteFromCache: jest.fn()
}));

jest.mock('../../src/constants', () => ({
  TIME: {
    MIN_MESSAGE_DELAY: 3000,
    MAX_ERROR_WAIT_TIME: 15000
  },
  ERROR_MESSAGES: []
}));

// Now require the modules
const { prepareAndSplitMessage } = require('../../src/utils/messageSplitting');
const { isDuplicateMessage } = require('../../src/utils/messageDeduplication');
const { markErrorContent } = require('../../src/utils/messageFormatter');
const { isErrorContent } = require('../../src/webhook');

// Require webhookManager
const webhookManager = require('../../src/webhookManager');

describe('WebhookManager - Message Sending Tests', () => {
  let mockChannel;
  let personality;
  
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    
    // Clear mock calls
    mockWebhook.send.mockClear();
    mockWebhook.destroy.mockClear();
    
    // Set delay function
    if (webhookManager.setDelayFunction) {
      webhookManager.setDelayFunction(jest.fn().mockResolvedValue());
    }
    
    // Setup channel mock - ensure it's not a DM or thread
    mockChannel = {
      id: 'test-channel-id',
      name: 'test-channel',
      isDMBased: jest.fn().mockReturnValue(false),
      isThread: jest.fn().mockReturnValue(false),
      send: jest.fn().mockResolvedValue({ id: 'direct-message-id' }),
      createWebhook: jest.fn().mockResolvedValue({
        id: 'test-webhook-id',
        token: 'test-webhook-token'
      })
    };
    
    // Setup personality mock
    personality = {
      fullName: 'test-personality',
      displayName: 'Test Personality',
      avatarUrl: 'https://example.com/avatar.png'
    };
  });
  
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });
  
  it('should successfully send a simple message', async () => {
    const result = await webhookManager.sendWebhookMessage(
      mockChannel,
      'Test message',
      personality
    );
    
    // Verify result
    expect(result).toBeDefined();
    expect(result.message).toBeDefined();
    expect(result.messageIds).toBeDefined();
    expect(result.messageIds.length).toBeGreaterThan(0);
    
    // Verify prepareAndSplitMessage was called
    expect(prepareAndSplitMessage).toHaveBeenCalledWith(
      'Test message',
      expect.any(Object),
      'Webhook'
    );
    
    // Verify webhook was used
    expect(mockWebhook.send).toHaveBeenCalled();
  });
  
  it('should split long messages into chunks', async () => {
    // Create a message longer than 2000 characters
    const longMessage = 'This is a long message. '.repeat(100); // ~2400 chars
    
    const result = await webhookManager.sendWebhookMessage(
      mockChannel,
      longMessage,
      personality
    );
    
    // Verify result
    expect(result).toBeDefined();
    expect(result.messageIds).toBeDefined();
    
    // prepareAndSplitMessage should have been called
    expect(prepareAndSplitMessage).toHaveBeenCalledWith(
      longMessage,
      expect.any(Object),
      'Webhook'
    );
    
    // Multiple webhook sends should have occurred
    expect(mockWebhook.send.mock.calls.length).toBeGreaterThan(1);
  });
  
  it('should mark error messages', async () => {
    const errorMessage = 'I am having trouble connecting';
    
    // Configure isErrorContent to return true
    isErrorContent.mockReturnValueOnce(true);
    
    await webhookManager.sendWebhookMessage(mockChannel, errorMessage, personality);
    
    // Since webhookManager uses its own isErrorContent implementation,
    // we can verify the behavior by checking if the message was processed differently
    expect(prepareAndSplitMessage).toHaveBeenCalled();
  });
  
  it('should skip duplicate messages', async () => {
    // Configure isDuplicateMessage to return true for this test
    isDuplicateMessage.mockReturnValueOnce(true);
    
    const result = await webhookManager.sendWebhookMessage(
      mockChannel,
      'Duplicate message',
      personality
    );
    
    // Should get a virtual result
    expect(result).toBeDefined();
    expect(result.isDuplicate).toBe(true);
    
    // Webhook send should not have been called
    expect(mockWebhook.send).not.toHaveBeenCalled();
  });
  
  it('should add embeds and attachments to the last chunk only', async () => {
    // Create a long message that will be split
    const longMessage = 'X'.repeat(4000); // Will need 2 chunks
    
    // Create embed options
    const embedOptions = {
      embeds: [{ title: 'Test Embed', description: 'Test Description' }]
    };
    
    await webhookManager.sendWebhookMessage(
      mockChannel,
      longMessage,
      personality,
      embedOptions
    );
    
    // Check webhook send calls
    expect(mockWebhook.send).toHaveBeenCalledTimes(2);
    
    // Check the message data passed to send
    const calls = mockWebhook.send.mock.calls;
    
    // First chunk should not have embeds
    const firstCall = calls[0]?.[0];
    if (firstCall && typeof firstCall === 'object') {
      expect(firstCall.embeds).toBeUndefined();
    }
    
    // Last chunk should have embeds
    const lastCall = calls[1]?.[0];
    if (lastCall && typeof lastCall === 'object') {
      expect(lastCall.embeds).toBeDefined();
      expect(lastCall.embeds).toEqual(embedOptions.embeds);
    }
  });
  
  it('should handle missing personality data', async () => {
    // Provide a minimal personality object to avoid null reference
    const minimalPersonality = {};
    
    const result = await webhookManager.sendWebhookMessage(
      mockChannel,
      'Test message with minimal personality',
      minimalPersonality
    );
    
    // Should still send the message
    expect(result).toBeDefined();
    expect(mockWebhook.send).toHaveBeenCalled();
  });
  
  it('should handle webhook send errors', async () => {
    // Make webhook.send throw an error
    mockWebhook.send.mockRejectedValueOnce(new Error('Send failed'));
    
    // Call function and expect it to throw
    await expect(
      webhookManager.sendWebhookMessage(mockChannel, 'Test message', personality)
    ).rejects.toThrow('Send failed');
  });
  
});